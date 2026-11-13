<?php

namespace App\Services\Authorization;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\Relation;

class ScopedAuthorizationService
{
    public function __construct(
        private readonly VendorScopeAuthorizer $vendorScopeAuthorizer,
    ) {}

    /**
     * @return Collection<int, UserRoleAssignment>
     */
    public function effectiveAssignments(
        User $user,
        ?CarbonImmutable $asOf = null,
    ): Collection {
        if ($user->account_status !== 'ACTIVE' || ! $user->exists || $user->getKey() === null) {
            return new Collection;
        }

        $businessDate = $this->businessDate($asOf);
        $guard = (string) config('distriva.authorization_guard');

        $assignments = UserRoleAssignment::query()
            ->where('user_id', $user->getKey())
            ->where('is_active', true)
            ->whereDate('valid_from', '<=', $businessDate)
            ->where(static function (Builder $query) use ($businessDate): void {
                $query->whereNull('valid_until')
                    ->orWhereDate('valid_until', '>=', $businessDate);
            })
            ->with([
                'role' => static fn (Relation $query) => $query->where('guard_name', $guard),
                'role.permissions' => static fn (Relation $query) => $query->where('guard_name', $guard),
                'organizationalUnit',
            ])
            ->get();

        return $assignments
            ->filter(fn (UserRoleAssignment $assignment): bool => $this->isEffectiveAssignment(
                $assignment,
                $guard,
                $businessDate,
            ))
            ->values();
    }

    public function allows(
        User $user,
        string $permission,
        AuthorizationContext $context,
        ?CarbonImmutable $asOf = null,
    ): bool {
        if (
            $user->account_status !== 'ACTIVE'
            || ! $user->exists
            || $user->getKey() === null
            || trim($permission) === ''
            || ! $this->hasValidContext($context)
        ) {
            return false;
        }

        if (
            $context->scopeMode === AuthorizationScopeMode::UP3_ADMIN_DELEGATION
            && ! in_array($permission, (array) config('distriva_permissions.admin_delegation_keys'), true)
        ) {
            return false;
        }

        $guard = (string) config('distriva.authorization_guard');
        $businessDate = $this->businessDate($asOf);

        foreach ($this->effectiveAssignments($user, $asOf) as $assignment) {
            if ($assignment->user_id !== $user->getKey()) {
                continue;
            }

            $role = $assignment->role;

            if (! $role instanceof Role || ! $this->roleHasPermission($role, $permission, $guard)) {
                continue;
            }

            if (! $this->assignmentMatchesContext($assignment, $context)) {
                continue;
            }

            if (
                $role->name === 'VENDOR'
                && (
                    ! $context->hasCompleteVendorScope()
                    || ! $this->vendorScopeAuthorizer->allows($assignment, $context)
                )
            ) {
                continue;
            }

            if ($this->isEffectiveAssignment($assignment, $guard, $businessDate)) {
                return true;
            }
        }

        return false;
    }

    private function roleHasPermission(Role $role, string $permission, string $guard): bool
    {
        if ($role->guard_name !== $guard) {
            return false;
        }

        return $role->permissions->contains(
            static fn ($catalogPermission): bool => $catalogPermission->name === $permission
                && $catalogPermission->guard_name === $guard,
        );
    }

    private function assignmentMatchesContext(
        UserRoleAssignment $assignment,
        AuthorizationContext $context,
    ): bool {
        $role = $assignment->role;

        if ($context->scopeMode === AuthorizationScopeMode::SYSTEM) {
            return $context->organizationalUnit === null
                && $role?->name === 'SYS_ADMIN'
                && $assignment->organizational_unit_id === null;
        }

        if (
            $context->organizationalUnit === null
            || ! $context->organizationalUnit->exists
            || ! $context->organizationalUnit->is_active
            || $context->organizationalUnit->getKey() === null
            || $role?->name === 'SYS_ADMIN'
            || $assignment->organizational_unit_id === null
        ) {
            return false;
        }

        if ($assignment->organizational_unit_id === $context->organizationalUnit->getKey()) {
            return true;
        }

        if ($context->scopeMode === AuthorizationScopeMode::UP3_ADMIN_DELEGATION && $role?->name !== 'UP3_ADMIN') {
            return false;
        }

        if (! in_array($context->scopeMode, [AuthorizationScopeMode::UP3_DESCENDANT_READ, AuthorizationScopeMode::UP3_ADMIN_DELEGATION], true)) {
            return false;
        }

        $assignedUnit = $assignment->organizationalUnit;
        $targetUnit = $context->organizationalUnit;

        return $assignedUnit instanceof OrganizationalUnit
            && $assignedUnit->exists
            && $assignedUnit->is_active
            && $assignedUnit->unit_type === 'UP3'
            && $targetUnit->unit_type === 'ULP'
            && $targetUnit->parent_id === $assignedUnit->getKey();
    }

    private function isEffectiveAssignment(
        UserRoleAssignment $assignment,
        string $guard,
        string $businessDate,
    ): bool {
        $role = $assignment->role;

        if (
            ! $assignment->exists
            || ! $assignment->is_active
            || ! $role instanceof Role
            || ! $role->exists
            || $role->guard_name !== $guard
            || ! $this->isDateInRange($assignment->valid_from, $assignment->valid_until, $businessDate)
        ) {
            return false;
        }

        if ($role->requires_unit_scope) {
            return $assignment->organizational_unit_id !== null
                && $assignment->organizationalUnit instanceof OrganizationalUnit
                && $assignment->organizationalUnit->exists
                && $assignment->organizationalUnit->is_active;
        }

        return $role->name === 'SYS_ADMIN'
            && $assignment->organizational_unit_id === null;
    }

    private function isDateInRange(
        CarbonInterface|string|null $validFrom,
        CarbonInterface|string|null $validUntil,
        string $businessDate,
    ): bool {
        if ($validFrom === null) {
            return false;
        }

        $from = $this->dateValue($validFrom);
        $until = $validUntil === null ? null : $this->dateValue($validUntil);

        return $from <= $businessDate && ($until === null || $until >= $businessDate);
    }

    private function dateValue(CarbonInterface|string $date): string
    {
        return $date instanceof CarbonInterface
            ? $date->toDateString()
            : CarbonImmutable::parse($date, config('distriva.business_timezone'))->toDateString();
    }

    private function businessDate(?CarbonImmutable $asOf): string
    {
        $timezone = (string) config('distriva.business_timezone');

        return ($asOf ?? CarbonImmutable::now($timezone))
            ->setTimezone($timezone)
            ->toDateString();
    }

    private function hasValidContext(AuthorizationContext $context): bool
    {
        if ($context->scopeMode === AuthorizationScopeMode::SYSTEM) {
            return $context->organizationalUnit === null;
        }

        return $context->organizationalUnit !== null
            && $context->organizationalUnit->exists
            && $context->organizationalUnit->getKey() !== null;
    }
}
