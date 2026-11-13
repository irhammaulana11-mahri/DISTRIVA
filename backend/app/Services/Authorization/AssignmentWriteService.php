<?php

namespace App\Services\Authorization;

use App\Events\AuthorizationScopeChanged;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sole write path for user_role_assignments (doc 32 section 5).
 *
 * Business change and append-only history row are written in one transaction.
 * This service does NOT decide whether the actor may assign: callers (future
 * Policy, blocked on O-033) must authorize first. Actor identity is recorded
 * for audit but is not trusted as authorization.
 */
class AssignmentWriteService
{
    public function assign(
        User $target,
        Role $role,
        ?OrganizationalUnit $unit,
        string $validFrom,
        ?string $validUntil,
        string $reason,
        User $actor,
        ?UserRoleAssignment $actorAssignment = null,
        ?string $document = null,
    ): UserRoleAssignment {
        $this->requireReason($reason);
        $this->requireActiveActor($actor);

        if ($actorAssignment !== null && $actorAssignment->user_id !== $actor->getKey()) {
            throw new AssignmentRuleViolation('Actor assignment does not belong to the actor.');
        }

        try {
            $assignment = DB::transaction(function () use ($target, $role, $unit, $validFrom, $validUntil, $reason, $actor, $actorAssignment, $document) {
                $assignment = UserRoleAssignment::query()->create([
                    'user_id' => $target->getKey(),
                    'role_id' => $role->getKey(),
                    'organizational_unit_id' => $unit?->getKey(),
                    'valid_from' => $validFrom,
                    'valid_until' => $validUntil,
                    'is_active' => true,
                    'assigned_by' => $actor->getKey(),
                    'assignment_document' => $document,
                ]);

                $this->history($assignment, 'CREATED', null, $this->snapshot($assignment->refresh()), $reason, $actor, $actorAssignment);
                DB::afterCommit(fn () => event(new AuthorizationScopeChanged($target->getKey())));

                return $assignment;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }

        return $assignment;
    }

    public function revoke(
        UserRoleAssignment $assignment,
        string $reason,
        User $actor,
        ?UserRoleAssignment $actorAssignment = null,
        ?CarbonImmutable $asOf = null,
    ): UserRoleAssignment {
        $this->requireReason($reason);
        $this->requireActiveActor($actor);

        if ($actorAssignment !== null && $actorAssignment->user_id !== $actor->getKey()) {
            throw new AssignmentRuleViolation('Actor assignment does not belong to the actor.');
        }

        $today = ($asOf ?? CarbonImmutable::now(config('distriva.business_timezone')))->toDateString();

        return DB::transaction(function () use ($assignment, $reason, $actor, $actorAssignment, $today) {
            $locked = UserRoleAssignment::query()->whereKey($assignment->getKey())->lockForUpdate()->first();

            if ($locked === null) {
                throw new AssignmentRuleViolation('Assignment does not exist.');
            }
            if (! $locked->is_active) {
                throw new AssignmentRuleViolation('Assignment is already revoked.');
            }

            $before = $this->snapshot($locked);
            $locked->is_active = false;
            // Keep valid_until >= valid_from (DB check) when revoking before the start date.
            if ($locked->valid_until === null || $locked->valid_until->toDateString() > $today) {
                $locked->valid_until = $locked->valid_from->toDateString() > $today ? $locked->valid_from : $today;
            }
            $locked->save();

            $this->history($locked, 'REVOKED', $before, $this->snapshot($locked->refresh()), $reason, $actor, $actorAssignment);
            DB::afterCommit(fn () => event(new AuthorizationScopeChanged($locked->user_id)));

            return $locked;
        });
    }

    private function requireActiveActor(User $actor): void
    {
        if (! $actor->exists || $actor->account_status !== 'ACTIVE') {
            throw new AssignmentRuleViolation('The actor must be an existing ACTIVE account.');
        }
    }

    private function requireReason(string $reason): void
    {
        if (trim($reason) === '') {
            throw new AssignmentRuleViolation('A reason is required.');
        }
    }

    /** @return array<string, mixed> */
    private function snapshot(UserRoleAssignment $a): array
    {
        return [
            'user_id' => $a->user_id,
            'role_id' => $a->role_id,
            'organizational_unit_id' => $a->organizational_unit_id,
            'valid_from' => $a->valid_from?->toDateString(),
            'valid_until' => $a->valid_until?->toDateString(),
            'is_active' => (bool) $a->is_active,
            'assignment_document' => $a->assignment_document,
        ];
    }

    private function history(UserRoleAssignment $a, string $event, ?array $before, array $after, string $reason, User $actor, ?UserRoleAssignment $actorAssignment): void
    {
        DB::table('user_role_assignment_histories')->insert([
            'id' => (string) Str::uuid(),
            'user_role_assignment_id' => $a->getKey(),
            'event_type' => $event,
            'before_values' => $before === null ? null : json_encode($before),
            'after_values' => json_encode($after),
            'reason' => trim($reason),
            'actor_user_id' => $actor->getKey(),
            'actor_assignment_id' => $actorAssignment?->getKey(),
            'changed_at' => now(),
        ]);
    }

    private function translate(QueryException $e): AssignmentRuleViolation|QueryException
    {
        return match ($e->getCode()) {
            '23P01' => new AssignmentRuleViolation('An overlapping active assignment already exists.', 0, $e),
            'P0001', '23514' => new AssignmentRuleViolation('Assignment violates organizational or role rules.', 0, $e),
            default => $e,
        };
    }
}
