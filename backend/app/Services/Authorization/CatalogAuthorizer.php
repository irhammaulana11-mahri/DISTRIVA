<?php

namespace App\Services\Authorization;

use App\Exceptions\AdministrationDenied;
use App\Models\Role;
use App\Models\User;

/**
 * Authorization for CENTRAL reference data (master data): no unit target. The actor needs any effective
 * assignment (active account, valid dates, active unit, guard `web`) whose role holds the permission in the
 * catalog. VENDOR never qualifies (deny-all until the vendor relation exists, O-029) and neither does a role
 * that merely has a matching name: the grant must exist in role_has_permissions.
 */
class CatalogAuthorizer
{
    public function __construct(private readonly ScopedAuthorizationService $scoped) {}

    public function allows(User $actor, string $permission): bool
    {
        $guard = (string) config('distriva.authorization_guard');

        foreach ($this->scoped->effectiveAssignments($actor) as $assignment) {
            $role = $assignment->role;

            if (! $role instanceof Role || $role->name === 'VENDOR') {
                continue;
            }
            if ($role->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard)) {
                return true;
            }
        }

        return false;
    }

    /** @throws AdministrationDenied 403 */
    public function authorize(User $actor, string $permission): void
    {
        if (! $this->allows($actor, $permission)) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
    }

    /** @return array<string, bool> every master-data key -> allowed (UI hint only) */
    public function capabilities(User $actor): array
    {
        return collect(array_keys((array) config('distriva_permissions.master_data')))
            ->mapWithKeys(fn (string $key) => [$key => $this->allows($actor, $key)])
            ->all();
    }
}
