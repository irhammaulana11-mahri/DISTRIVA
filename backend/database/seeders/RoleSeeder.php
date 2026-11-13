<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function (): void {
            foreach ([
                'SYS_ADMIN',
                'UP3_ADMIN',
                'UP3_MANAGER',
                'NIAGA_RETAIL',
                'TEKNIK',
                'ENGINEERING',
                'PERENCANAAN',
                'KONSTRUKSI_UP3',
                'VENDOR',
                'VIEWER',
                'MANAGER_ULP',
                'ASMAN_PERENCANAAN',
                'ASMAN_NIAGA',
                'ASMAN_KONSTRUKSI',
            ] as $name) {
                $identity = [
                    'name' => $name,
                    'guard_name' => config('distriva.authorization_guard'),
                ];
                $requiresUnitScope = $name !== 'SYS_ADMIN';
                $role = Role::query()->where($identity)->lockForUpdate()->first();
                $before = $role?->only(['name', 'guard_name', 'requires_unit_scope']);

                if ($role === null) {
                    $role = Role::query()->create($identity + ['requires_unit_scope' => $requiresUnitScope]);
                } elseif ((bool) $role->requires_unit_scope !== $requiresUnitScope) {
                    if ($requiresUnitScope && DB::table('user_role_assignments')
                        ->where('role_id', $role->getKey())
                        ->whereNull('organizational_unit_id')
                        ->exists()) {
                        throw new \RuntimeException(
                            "Cannot make role [{$name}] unit-scoped while global assignments exist.",
                        );
                    }

                    $role->requires_unit_scope = $requiresUnitScope;
                    $role->save();
                } else {
                    continue;
                }

                DB::table('authorization_change_histories')->insert([
                    'id' => (string) str()->uuid(),
                    'event_type' => 'ROLE_METADATA_CHANGED',
                    'role_id' => $role->getKey(),
                    'before_values' => $before === null ? null : json_encode($before, JSON_THROW_ON_ERROR),
                    'after_values' => json_encode(
                        $role->only(['name', 'guard_name', 'requires_unit_scope']),
                        JSON_THROW_ON_ERROR,
                    ),
                    'reason' => 'Initial role catalog seed or alignment with approved unit-scope policy.',
                    'changed_at' => now(),
                ]);
            }
        });
    }
}
