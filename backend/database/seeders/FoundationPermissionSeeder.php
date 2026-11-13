<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Seeds ONLY the approved foundation-administration keys/grants from config/distriva_permissions.php.
 * Idempotent; every new key and grant writes an append-only authorization_change_histories row.
 * Requires the roles from RoleSeeder.
 */
class FoundationPermissionSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(RoleSeeder::class);
        $guard = (string) config('distriva.authorization_guard');

        DB::transaction(function () use ($guard): void {
            foreach ((array) config('distriva_permissions.foundation') as $key => $roles) {
                $permission = Permission::query()->where(['name' => $key, 'guard_name' => $guard])->first();

                if ($permission === null) {
                    $permission = Permission::query()->create(['name' => $key, 'guard_name' => $guard]);
                    $this->history('PERMISSION_CATALOG_CHANGED', null, $permission->getKey(), null, ['name' => $key], "Approved foundation key {$key} (docs/54).");
                }

                // Config is the source of truth for foundation keys: grants no longer listed are revoked (audited).
                foreach ($permission->roles()->where('roles.guard_name', $guard)->get() as $held) {
                    if (! in_array($held->name, $roles, true)) {
                        $held->permissions()->detach($permission->getKey());
                        $this->history('ROLE_PERMISSION_REVOKED', $held->getKey(), $permission->getKey(), ['role' => $held->name, 'permission' => $key], ['role' => $held->name, 'permission' => $key, 'revoked' => true], "Grant {$held->name} -> {$key} withdrawn: not in the approved catalog (owner decision D-4 A, 2026-11-06).");
                    }
                }

                foreach ($roles as $roleName) {
                    $role = Role::query()->where(['name' => $roleName, 'guard_name' => $guard])->firstOrFail();

                    if (! $role->permissions()->whereKey($permission->getKey())->exists()) {
                        $role->permissions()->attach($permission->getKey());
                        $this->history('ROLE_PERMISSION_GRANTED', $role->getKey(), $permission->getKey(), null, ['role' => $roleName, 'permission' => $key], "Approved grant {$roleName} -> {$key} (docs/54 §3).");
                    }
                }
            }
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    private function history(string $event, ?int $roleId, int $permissionId, ?array $before, array $after, string $reason): void
    {
        DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(),
            'event_type' => $event,
            'role_id' => $roleId,
            'permission_id' => $permissionId,
            'before_values' => $before === null ? null : json_encode($before),
            'after_values' => json_encode($after),
            'reason' => $reason,
            'changed_at' => now(),
        ]);
    }
}
