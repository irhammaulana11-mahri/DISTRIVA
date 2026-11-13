<?php

namespace App\Services\Authorization;

use App\Exceptions\AdministrationDenied;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\MfaService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Authorization for foundation administration (docs/54). Every method either returns or throws
 * AdministrationDenied (403 forbidden, 404 out of scope / hidden, 409 protected state).
 * Ownership comes from persisted rows, never from request input.
 */
class AdministrationAuthorizer
{
    public function __construct(private readonly ScopedAuthorizationService $scoped) {}

    /**
     * Visible administrative scope for a permission.
     * `unrestricted` = global SYS_ADMIN grant; otherwise `units` lists the allowed unit ids.
     *
     * @return array{unrestricted: bool, units: list<string>}
     */
    public function scopeFor(User $actor, string $permission, ?CarbonImmutable $asOf = null): array
    {
        if ($this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::SYSTEM), $asOf)) {
            return ['unrestricted' => true, 'units' => []];
        }

        $units = [];
        foreach ($this->scoped->effectiveAssignments($actor, $asOf) as $assignment) {
            $unit = $assignment->organizationalUnit;
            if ($assignment->role?->name !== 'UP3_ADMIN' || $unit === null) {
                continue;
            }
            if (! $this->scoped->allows($actor, $permission, new AuthorizationContext(AuthorizationScopeMode::UP3_ADMIN_DELEGATION, $unit), $asOf)) {
                continue;
            }
            $units[] = $unit->getKey();
            if ($unit->unit_type === 'UP3') {
                $units = array_merge($units, OrganizationalUnit::query()
                    ->where('parent_id', $unit->getKey())->where('is_active', true)->pluck('id')->all());
            }
        }

        return ['unrestricted' => false, 'units' => array_values(array_unique($units))];
    }

    /** Read permission: returns the scope or throws 403 when the actor has no grant at all. */
    public function authorizeView(User $actor, string $permission): array
    {
        $scope = $this->scopeFor($actor, $permission);

        if (! $scope['unrestricted'] && $scope['units'] === []) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }

        return $scope;
    }

    /** Write permission over a target unit. SYS_ADMIN writes stay closed until MFA exists (D-3/D-4). */
    public function authorizeWrite(User $actor, string $permission, ?OrganizationalUnit $unit): array
    {
        $scope = $this->authorizeView($actor, $permission);

        if ($scope['unrestricted']) {
            if (! app(MfaService::class)->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }

            return $scope;
        }

        if ($unit === null || ! in_array($unit->getKey(), $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $scope;
    }

    public function authorizeAssign(User $actor, ?User $target, Role $role, OrganizationalUnit $unit): void
    {
        $this->authorizeWrite($actor, 'role_assignments.assign', $unit);
        $this->denySelf($actor, $target, 'Tidak boleh mengubah penugasan diri sendiri.');

        if (in_array($role->name, (array) config('distriva_permissions.up3_admin_forbidden_roles'), true)) {
            throw new AdministrationDenied("Role {$role->name} tidak dapat diberikan oleh UP3_ADMIN.", 403);
        }
        if ($role->guard_name !== config('distriva.authorization_guard')) {
            throw new AdministrationDenied('Role tidak valid.', 403);
        }
        if ($role->name === 'UP3_ADMIN' && $unit->unit_type !== 'UP3') {
            throw new AdministrationDenied('UP3_ADMIN hanya dapat ditugaskan pada unit UP3.', 403);
        }
    }

    /** users.create needs both the create grant and the right to give that first assignment in the unit. */
    public function authorizeCreateUser(User $actor, Role $role, OrganizationalUnit $unit): void
    {
        $this->authorizeWrite($actor, 'users.create', $unit);
        $this->authorizeAssign($actor, null, $role, $unit); // the new account cannot be the actor
    }

    /** Re-sending the invitation: same scope rules as other user administration; only for accounts not yet activated. */
    public function authorizeResendInvitation(User $actor, User $target): void
    {
        $scope = $this->authorizeView($actor, 'users.create');

        if ($scope['unrestricted']) {
            if (! app(MfaService::class)->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }
        } else {
            $this->requireTargetFullyInScope($target, $scope['units']);
        }
        $this->denySelf($actor, $target, 'Tidak boleh mengirim undangan untuk diri sendiri.');

        if ($target->account_status !== 'PENDING_ACTIVATION') {
            throw new AdministrationDenied('Pengguna sudah diaktifkan; undangan aktivasi tidak diperlukan.', 409);
        }
    }

    public function authorizeEnd(User $actor, UserRoleAssignment $assignment): void
    {
        $this->authorizeWrite($actor, 'role_assignments.end', $assignment->organizationalUnit);
        $this->denySelf($actor, $assignment->user, 'Tidak boleh mengakhiri penugasan diri sendiri.');

        if (in_array($assignment->role?->name, (array) config('distriva_permissions.up3_admin_forbidden_roles'), true)) {
            throw new AdministrationDenied('Penugasan role ini tidak dapat diakhiri oleh UP3_ADMIN.', 403);
        }
        $this->protectLastAdmin($assignment);
    }

    public function authorizeStatusChange(User $actor, User $target, string $newStatus): void
    {
        $scope = $this->authorizeView($actor, 'users.change_status');

        if ($scope['unrestricted']) {
            if (! app(MfaService::class)->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }
        } else {
            $this->requireTargetFullyInScope($target, $scope['units']);
        }

        $this->denySelf($actor, $target, 'Tidak boleh mengubah status akun sendiri.');

        if ($newStatus !== 'ACTIVE' && $target->account_status === 'ACTIVE') {
            foreach ($this->effectiveAdminAssignments($target) as $assignment) {
                $this->protectLastAdmin($assignment, ignoreUser: $target->getKey());
            }
        }
    }

    /** @param list<string> $units */
    private function requireTargetFullyInScope(User $target, array $units): void
    {
        $assignments = UserRoleAssignment::query()->with('role')->where('user_id', $target->getKey())->get();

        if ($assignments->isEmpty() || $assignments->contains(fn ($a) => ! in_array($a->organizational_unit_id, $units, true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        if ($assignments->contains(fn ($a) => in_array($a->role?->name, (array) config('distriva_permissions.up3_admin_forbidden_roles'), true))) {
            throw new AdministrationDenied('Akun ini tidak dapat diubah oleh UP3_ADMIN.', 403);
        }
    }

    private function denySelf(User $actor, ?User $target, string $message): void
    {
        if ($target !== null && $actor->getKey() === $target->getKey()) {
            throw new AdministrationDenied($message, 403);
        }
    }

    /** @return Collection<int, UserRoleAssignment> */
    private function effectiveAdminAssignments(User $user)
    {
        $today = CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();

        return UserRoleAssignment::query()->with('role')
            ->where('user_id', $user->getKey())->where('is_active', true)
            ->whereDate('valid_from', '<=', $today)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhereDate('valid_until', '>=', $today))
            ->get()
            ->filter(fn ($a) => in_array($a->role?->name, ['UP3_ADMIN'], true));
    }

    /** At least one other ACTIVE user must keep an effective UP3_ADMIN assignment on the same unit (D-8). */
    private function protectLastAdmin(UserRoleAssignment $assignment, ?string $ignoreUser = null): void
    {
        if ($assignment->role?->name !== 'UP3_ADMIN' || $assignment->organizational_unit_id === null) {
            return;
        }

        $today = CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();
        $others = DB::table('user_role_assignments as a')
            ->join('users as u', 'u.id', '=', 'a.user_id')
            ->where('a.role_id', $assignment->role_id)
            ->where('a.organizational_unit_id', $assignment->organizational_unit_id)
            ->where('a.is_active', true)
            ->where('a.id', '!=', $assignment->getKey())
            ->where('a.user_id', '!=', $ignoreUser ?? $assignment->user_id)
            ->where('u.account_status', 'ACTIVE')
            ->whereDate('a.valid_from', '<=', $today)
            ->where(fn ($q) => $q->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today))
            ->exists();

        if (! $others) {
            throw new AdministrationDenied('Tidak dapat menghapus/menonaktifkan UP3_ADMIN terakhir pada unit ini.', 409);
        }
    }
}
