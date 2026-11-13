<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Seeds ONLY the technical-drawing keys/grants from config/distriva_permissions.php ('drawings'). Idempotent; every new key/grant writes an
 * authorization_change_histories row; grants no longer in the config are revoked (audited).
 */
class DrawingPermissionSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(RoleSeeder::class);
        $guard = (string) config('distriva.authorization_guard');

        DB::transaction(function () use ($guard): void {
            foreach ((array) config('distriva_permissions.drawings') as $key => $roles) {
                $permission = Permission::query()->where(['name' => $key, 'guard_name' => $guard])->first();
                if ($permission === null) {
                    $permission = Permission::query()->create(['name' => $key, 'guard_name' => $guard]);
                    $this->history('PERMISSION_CATALOG_CHANGED', null, $permission->getKey(), null, ['name' => $key], "Drawing key {$key} (owner decision 2026-11-06, docs/62 section 10).");
                }
                foreach ($permission->roles()->where('roles.guard_name', $guard)->get() as $held) {
                    if (! in_array($held->name, $roles, true)) {
                        $held->permissions()->detach($permission->getKey());
                        $this->history('ROLE_PERMISSION_REVOKED', $held->getKey(), $permission->getKey(), ['role' => $held->name, 'permission' => $key], ['role' => $held->name, 'permission' => $key, 'revoked' => true], "Grant {$held->name} -> {$key} withdrawn: not in the approved catalog.");
                    }
                }
                foreach ($roles as $roleName) {
                    $role = Role::query()->where(['name' => $roleName, 'guard_name' => $guard])->firstOrFail();
                    if (! $role->permissions()->whereKey($permission->getKey())->exists()) {
                        $role->permissions()->attach($permission->getKey());
                        $this->history('ROLE_PERMISSION_GRANTED', $role->getKey(), $permission->getKey(), null, ['role' => $roleName, 'permission' => $key], "Drawing grant {$roleName} -> {$key}.");
                    }
                }
            }
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /** @param array<string,mixed>|null $before @param array<string,mixed> $after */
    private function history(string $event, ?int $roleId, int $permissionId, ?array $before, array $after, string $reason): void
    {
        DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(), 'event_type' => $event, 'role_id' => $roleId, 'permission_id' => $permissionId,
            'before_values' => $before === null ? null : json_encode($before), 'after_values' => json_encode($after), 'reason' => $reason, 'changed_at' => now(),
        ]);
    }
}
