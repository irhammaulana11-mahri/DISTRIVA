<?php

namespace App\Services;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sole write path for organizational_units. Writes the change and an
 * organizational_unit_histories row in one transaction.
 *
 * Code, type and parent are immutable after creation: re-coding/re-parenting is
 * governed by open issue O-030 (retired code reuse) and has no approved rule.
 * Caller must authorize the actor first (O-033).
 */
class OrganizationalUnitWriteService
{
    public function create(string $code, string $name, string $type, ?OrganizationalUnit $parent, ?string $address, string $reason, User $actor): OrganizationalUnit
    {
        $this->requireReason($reason);
        $this->requireActiveActor($actor);

        try {
            return DB::transaction(function () use ($code, $name, $type, $parent, $address, $reason, $actor) {
                $unit = OrganizationalUnit::query()->create([
                    'code' => trim($code), 'name' => trim($name), 'unit_type' => $type,
                    'parent_id' => $parent?->getKey(), 'address' => $address, 'is_active' => true,
                ]);
                $this->history($unit, null, $reason, $actor);

                return $unit;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** @param array{name?: string, address?: ?string, is_active?: bool} $changes */
    public function update(OrganizationalUnit $unit, array $changes, string $reason, User $actor): OrganizationalUnit
    {
        $this->requireReason($reason);
        $this->requireActiveActor($actor);

        $forbidden = array_diff(array_keys($changes), ['name', 'address', 'is_active']);
        if ($forbidden !== []) {
            throw new AssignmentRuleViolation('Immutable fields cannot be changed: '.implode(', ', $forbidden));
        }

        try {
            return DB::transaction(function () use ($unit, $changes, $reason, $actor) {
                $locked = OrganizationalUnit::query()->whereKey($unit->getKey())->lockForUpdate()->firstOrFail();
                $before = $locked->only(['code', 'name', 'unit_type', 'parent_id', 'is_active']);
                $locked->fill($changes);

                if (! $locked->isDirty(['name', 'address', 'is_active'])) {
                    throw new AssignmentRuleViolation('No changes to apply.');
                }

                $locked->save();
                $this->history($locked, $before, $reason, $actor);

                return $locked;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
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

    private function history(OrganizationalUnit $u, ?array $before, string $reason, User $actor): void
    {
        DB::table('organizational_unit_histories')->insert([
            'id' => (string) Str::uuid(),
            'organizational_unit_id' => $u->getKey(),
            'old_code' => $before['code'] ?? null, 'new_code' => $u->code,
            'old_name' => $before['name'] ?? null, 'new_name' => $u->name,
            'old_unit_type' => $before['unit_type'] ?? null, 'new_unit_type' => $u->unit_type,
            'old_parent_id' => $before['parent_id'] ?? null, 'new_parent_id' => $u->parent_id,
            'old_is_active' => $before['is_active'] ?? null, 'new_is_active' => $u->is_active,
            'reason' => trim($reason),
            'changed_by' => $actor->getKey(),
            'changed_at' => now(),
        ]);
    }

    private function translate(QueryException $e): AssignmentRuleViolation|QueryException
    {
        return match ($e->getCode()) {
            '23505' => new AssignmentRuleViolation('Unit code already exists (codes are never reused).', 0, $e),
            'P0001', '23514' => new AssignmentRuleViolation('Change violates the organizational hierarchy rules.', 0, $e),
            default => $e,
        };
    }
}
