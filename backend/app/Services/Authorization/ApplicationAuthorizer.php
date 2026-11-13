<?php

namespace App\Services\Authorization;

use App\Exceptions\AdministrationDenied;
use App\Models\OrganizationalUnit;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\MfaService;
use Illuminate\Support\Collection;

/**
 * Authorization for PB/PD applications (docs/62). Applications belong to an ULP:
 *  - ULP-assigned role holding the key  -> that ULP (SAME_UNIT);
 *  - UP3-assigned role holding a READ key -> the UP3's active child ULPs (UP3_DESCENDANT_READ); never for write keys, except `applications.import` (owner 2026-11-09: the UP3 Niaga account runs the EIS sync for its ULPs);
 *  - SYS_ADMIN (global assignment)       -> everything, writes only on an MFA-verified token;
 *  - VENDOR never qualifies here (deny-all until the vendor relation exists, O-029).
 * Ownership comes from persisted rows, never from request input.
 */
class ApplicationAuthorizer
{
    public function __construct(private readonly ScopedAuthorizationService $scoped, private readonly MfaService $mfa) {}

    /** @return Collection<int, UserRoleAssignment> */
    public function effectiveAssignments(User $actor)
    {
        return $this->scoped->effectiveAssignments($actor);
    }

    /** @return array{unrestricted: bool, units: list<string>} */
    public function scopeFor(User $actor, string $permission): array
    {
        if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SYSTEM))) {
            return ['unrestricted' => true, 'units' => []];
        }

        $read = in_array($permission, (array) config('distriva_permissions.applications_descendant_keys'), true);
        $units = [];
        foreach ($this->scoped->effectiveAssignments($actor) as $assignment) {
            $unit = $assignment->organizationalUnit;
            if ($unit === null || $assignment->role?->name === 'VENDOR') {
                continue;
            }
            if ($unit->unit_type === 'ULP') {
                if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit))) {
                    $units[] = $unit->getKey();
                }

                continue;
            }
            if ($read && $unit->unit_type === 'UP3') {
                foreach (OrganizationalUnit::query()->where('parent_id', $unit->getKey())->where('is_active', true)->get() as $child) {
                    if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::UP3_DESCENDANT_READ, $child))) {
                        $units[] = $child->getKey();
                    }
                }
            }
        }

        return ['unrestricted' => false, 'units' => array_values(array_unique($units))];
    }

    /** Name of the (first) effective role of the actor that holds the permission — recorded with a decision. */
    public function roleFor(User $actor, string $permission): ?string
    {
        $guard = (string) config('distriva.authorization_guard');
        foreach ($this->scoped->effectiveAssignments($actor) as $a) {
            if ($a->role !== null && $a->role->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard)) {
                return $a->role->name;
            }
        }

        return null;
    }

    /** @return list<string> every effective role of the actor that holds the permission */
    public function rolesFor(User $actor, string $permission): array
    {
        $guard = (string) config('distriva.authorization_guard');
        $out = [];
        foreach ($this->scoped->effectiveAssignments($actor) as $a) {
            if ($a->role !== null && $a->role->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard)) {
                $out[] = $a->role->name;
            }
        }

        return array_values(array_unique($out));
    }

    public function can(User $actor, string $permission): bool
    {
        $scope = $this->scopeFor($actor, $permission);

        return $scope['unrestricted'] || $scope['units'] !== [];
    }

    /**
     * @return array{unrestricted: bool, units: list<string>}
     *
     * @throws AdministrationDenied 403 without any grant
     */
    public function authorizeScope(User $actor, string $permission): array
    {
        $scope = $this->scopeFor($actor, $permission);
        if (! $scope['unrestricted'] && $scope['units'] === []) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }

        return $scope;
    }

    /**
     * Action on a given ULP: 403 without the grant, 404 when the unit is outside the actor's scope (hidden),
     * 403 when SYS_ADMIN writes without a verified MFA token.
     *
     * @throws AdministrationDenied
     */
    public function authorizeOnUnit(User $actor, string $permission, string $unitId): void
    {
        $scope = $this->authorizeScope($actor, $permission);
        if ($scope['unrestricted']) {
            if (! $this->mfa->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }

            return;
        }
        if (! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    /** Does the actor hold the permission on this UP3 itself (an assignment AT the UP3, same unit), or system-wide? Used by the UP3-level keys (RKM plan/validation/decision). */
    public function holdsOnUp3(User $actor, string $permission, string $up3UnitId): bool
    {
        if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SYSTEM))) {
            return true;
        }
        $unit = OrganizationalUnit::query()->find($up3UnitId);

        return $unit !== null && $unit->unit_type === 'UP3' && $this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit));
    }

    /**
     * Write action on a UP3: 403 without the grant anywhere, 404 when the grant is held for another unit (hidden), 403 when SYS_ADMIN writes without a verified MFA token.
     *
     * @throws AdministrationDenied
     */
    public function authorizeOnUp3(User $actor, string $permission, string $up3UnitId): void
    {
        if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SYSTEM))) {
            if (! $this->mfa->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }

            return;
        }
        if ($this->holdsOnUp3($actor, $permission, $up3UnitId)) {
            return;
        }

        throw $this->roleFor($actor, $permission) === null ? new AdministrationDenied('Tidak berwenang.', 403) : new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
