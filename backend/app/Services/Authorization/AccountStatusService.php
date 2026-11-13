<?php

namespace App\Services\Authorization;

use App\Events\AuthorizationScopeChanged;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sole write path for users.account_status. Writes the change and an append-only
 * authorization_change_histories row in one transaction; revokes API tokens when
 * the account stops being ACTIVE. Caller must authorize the actor first (O-033).
 */
class AccountStatusService
{
    public const STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];

    public function change(User $target, string $newStatus, string $reason, User $actor): User
    {
        if (! in_array($newStatus, self::STATUSES, true)) {
            throw new AssignmentRuleViolation('Unknown account status.');
        }
        if (trim($reason) === '') {
            throw new AssignmentRuleViolation('A reason is required.');
        }
        if (! $actor->exists || $actor->account_status !== 'ACTIVE') {
            throw new AssignmentRuleViolation('The actor must be an existing ACTIVE account.');
        }
        if ($target->getKey() === $actor->getKey()) {
            throw new AssignmentRuleViolation('An actor cannot change their own account status.');
        }

        return DB::transaction(function () use ($target, $newStatus, $reason, $actor) {
            $locked = User::query()->whereKey($target->getKey())->lockForUpdate()->firstOrFail();
            $old = $locked->account_status;

            if ($old === $newStatus) {
                throw new AssignmentRuleViolation('Account already has this status.');
            }

            // A status change also clears any login lockout (an admin decision supersedes the automatic lock).
            $locked->forceFill(['account_status' => $newStatus, 'failed_login_attempts' => 0, 'locked_until' => null])->save();

            if ($newStatus !== 'ACTIVE') {
                $locked->tokens()->delete();
            }

            DB::table('authorization_change_histories')->insert([
                'id' => (string) Str::uuid(),
                'event_type' => 'USER_STATUS_CHANGED',
                'user_id' => $locked->getKey(),
                'actor_user_id' => $actor->getKey(),
                'before_values' => json_encode(['account_status' => $old]),
                'after_values' => json_encode(['account_status' => $newStatus]),
                'reason' => trim($reason),
                'changed_at' => now(),
            ]);

            DB::afterCommit(fn () => event(new AuthorizationScopeChanged($locked->getKey())));

            return $locked;
        });
    }
}
