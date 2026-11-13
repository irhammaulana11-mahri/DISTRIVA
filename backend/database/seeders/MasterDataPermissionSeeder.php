<?php

namespace Database\Seeders;

use App\Models\MaterialCategory;
use App\Models\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Seeds ONLY the master-data keys/grants from config/distriva_permissions.php ('master_data') and the nine initial
 * material categories of docs/23 §2.1. Idempotent; each new key/grant writes an authorization_change_histories row.
 */
class MasterDataPermissionSeeder extends Seeder
{
    private const CATEGORIES = [
        'KWH_METER' => 'KWH Meter', 'MCB_1_PHASE' => 'MCB 1 Phase', 'MCB_3_PHASE' => 'MCB 3 Phase', 'PENGHANTAR' => 'Penghantar',
        'BOX_APP' => 'Box APP', 'TRAFO' => 'Trafo', 'PHBTR' => 'PHBTR', 'PENGAMAN' => 'Pengaman', 'KUBIKEL' => 'Kubikel',
    ];

    public function run(): void
    {
        $this->call(RoleSeeder::class);
        $guard = (string) config('distriva.authorization_guard');

        DB::transaction(function () use ($guard): void {
            foreach ((array) config('distriva_permissions.master_data') as $key => $roles) {
                $permission = Permission::query()->where(['name' => $key, 'guard_name' => $guard])->first();

                if ($permission === null) {
                    $permission = Permission::query()->create(['name' => $key, 'guard_name' => $guard]);
                    $this->history('PERMISSION_CATALOG_CHANGED', null, $permission->getKey(), ['name' => $key], "Master data key {$key} (owner decision 2026-11-06).");
                }

                foreach ($roles as $roleName) {
                    $role = Role::query()->where(['name' => $roleName, 'guard_name' => $guard])->firstOrFail();

                    if (! $role->permissions()->whereKey($permission->getKey())->exists()) {
                        $role->permissions()->attach($permission->getKey());
                        $this->history('ROLE_PERMISSION_GRANTED', $role->getKey(), $permission->getKey(), ['role' => $roleName, 'permission' => $key], "Master data grant {$roleName} -> {$key}.");
                    }
                }
            }

            foreach (self::CATEGORIES as $code => $name) {
                MaterialCategory::query()->firstOrCreate(['code' => $code], ['name' => $name, 'is_active' => true]);
            }
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    private function history(string $event, ?int $roleId, int $permissionId, array $after, string $reason): void
    {
        DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(), 'event_type' => $event, 'role_id' => $roleId, 'permission_id' => $permissionId,
            'before_values' => null, 'after_values' => json_encode($after), 'reason' => $reason, 'changed_at' => now(),
        ]);
    }
}
