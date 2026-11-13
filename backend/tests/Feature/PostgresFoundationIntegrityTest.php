<?php

namespace Tests\Feature;

use App\Models\Role;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class PostgresFoundationIntegrityTest extends PostgresTestCase
{
    #[Test]
    public function it_runs_against_the_disposable_test_database(): void
    {
        $this->assertSame('distriva_backend_test', DB::selectOne('select current_database() as d')->d);
    }

    #[Test]
    public function foundation_tables_exist_and_spatie_user_pivots_do_not(): void
    {
        foreach (['users', 'organizational_units', 'user_role_assignments', 'roles', 'permissions', 'role_has_permissions', 'personal_access_tokens'] as $t) {
            $this->assertTrue(\Schema::hasTable($t), $t);
        }
        $this->assertFalse(\Schema::hasTable('model_has_roles'));
        $this->assertFalse(\Schema::hasTable('model_has_permissions'));
    }

    #[Test]
    public function user_and_org_check_constraints_reject_invalid_rows(): void
    {
        $this->assertDbRejects(fn () => DB::table('users')->insert([
            'id' => (string) Str::uuid(), 'name' => 'x', 'email' => 'UPPER@example.com', 'password' => 'x',
            'account_status' => 'ACTIVE', 'created_at' => now(), 'updated_at' => now(),
        ]));
        $this->assertDbRejects(fn () => $this->makeUser('BOGUS'));
        $this->assertDbRejects(fn () => DB::table('organizational_units')->insert([
            'id' => (string) Str::uuid(), 'code' => 'X1', 'name' => 'x', 'unit_type' => 'REGION',
            'created_at' => now(), 'updated_at' => now(),
        ]));
    }

    #[Test]
    public function organizational_hierarchy_triggers_are_enforced(): void
    {
        $up3 = $this->makeUnit('UP3');
        $ulp = $this->makeUnit('ULP', $up3);

        $this->assertDbRejects(fn () => $this->makeUnit('ULP'));                 // ULP without parent
        $this->assertDbRejects(fn () => $this->makeUnit('UP3', $up3));            // UP3 with parent
        $this->assertDbRejects(fn () => $this->makeUnit('ULP', $ulp));            // parent not UP3
        $this->assertDbRejects(fn () => $this->makeUnit('ULP', $this->makeUnit('UP3', null, false))); // inactive parent
        $this->assertDbRejects(fn () => $up3->update(['is_active' => false]));    // active child
        $this->assertDbRejects(fn () => $up3->update(['unit_type' => 'ULP']));    // has children
    }

    #[Test]
    public function role_scope_constraint_and_assignment_triggers_are_enforced(): void
    {
        $this->assertDbRejects(fn () => Role::query()->create(['name' => 'SYS_ADMIN', 'guard_name' => 'web', 'requires_unit_scope' => true]));
        $this->assertDbRejects(fn () => Role::query()->create(['name' => 'TEKNIK', 'guard_name' => 'web', 'requires_unit_scope' => false]));

        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $teknik = $this->makeRole('TEKNIK');

        $this->assertDbRejects(fn () => $this->assign($user, $teknik, null));                       // scoped role needs unit
        $this->assertDbRejects(fn () => $this->assign($user, $teknik, $this->makeUnit('UP3', null, false))); // inactive unit
        $this->assertDbRejects(fn () => $this->assign($user, $teknik, $unit, '2026-02-01', '2026-01-01')); // bad dates

        $this->assign($user, $this->makeRole('SYS_ADMIN', false), null);
        $this->assertDatabaseCount('user_role_assignments', 1);
    }

    #[Test]
    public function overlapping_active_assignments_are_rejected_but_adjacent_or_inactive_are_allowed(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $other = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');

        $this->assign($user, $role, $unit, '2026-01-01', '2026-06-30');

        $this->assertDbRejects(fn () => $this->assign($user, $role, $unit, '2026-06-30', null)); // inclusive overlap
        $this->assign($user, $role, $unit, '2026-07-01', null);                                  // adjacent ok
        $this->assign($user, $role, $other, '2026-01-01', null);                                 // other unit ok
        $this->assign($user, $role, $unit, '2026-03-01', '2026-04-01', false);                   // inactive ok

        $admin = $this->makeRole('SYS_ADMIN', false);
        $this->assign($user, $admin, null, '2026-01-01', '2026-12-31');
        $this->assertDbRejects(fn () => $this->assign($user, $admin, null, '2026-12-31', null));
    }

    #[Test]
    public function role_cannot_become_unit_scoped_while_global_assignments_exist(): void
    {
        $role = $this->makeRole('SYS_ADMIN', false);
        $this->assign($this->makeUser(), $role, null);

        $this->assertDbRejects(fn () => DB::table('roles')->where('id', $role->getKey())->update(['requires_unit_scope' => true]));
    }

    #[Test]
    public function history_tables_are_append_only(): void
    {
        $user = $this->makeUser();
        $assignment = $this->assign($user, $this->makeRole('TEKNIK'), $this->makeUnit('UP3'));
        $id = (string) Str::uuid();

        DB::table('user_role_assignment_histories')->insert([
            'id' => $id, 'user_role_assignment_id' => $assignment->getKey(), 'event_type' => 'CREATED',
            'reason' => 'test', 'actor_user_id' => $user->getKey(), 'changed_at' => now(),
        ]);

        $this->assertDbRejects(fn () => DB::table('user_role_assignment_histories')->where('id', $id)->update(['reason' => 'x']));
        $this->assertDbRejects(fn () => DB::table('user_role_assignment_histories')->where('id', $id)->delete());
        $this->assertDbRejects(fn () => DB::statement('TRUNCATE user_role_assignment_histories'));

        $this->assertDbRejects(fn () => DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(), 'event_type' => 'USER_STATUS_CHANGED', 'role_id' => $assignment->role_id, 'changed_at' => now(),
        ])); // target check
    }

    #[Test]
    public function referenced_rows_cannot_be_deleted(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $this->assign($user, $this->makeRole('TEKNIK'), $unit);

        $this->assertDbRejects(fn () => DB::table('users')->where('id', $user->getKey())->delete());
        $this->assertDbRejects(fn () => DB::table('organizational_units')->where('id', $unit->getKey())->delete());
    }

    #[Test]
    public function timestamptz_values_written_by_the_app_are_the_correct_instant(): void
    {
        // Regression: the session time zone differed from app.timezone and shifted every timestamptz by 7h.
        $this->assertSame('UTC', DB::selectOne('show timezone')->TimeZone);

        $user = $this->makeUser();
        $assignment = $this->assign($user, $this->makeRole('TEKNIK'), $this->makeUnit('UP3'));
        $id = (string) Str::uuid();
        DB::table('user_role_assignment_histories')->insert([
            'id' => $id, 'user_role_assignment_id' => $assignment->getKey(), 'event_type' => 'CREATED',
            'reason' => 't', 'changed_at' => now(),
        ]);

        $diff = DB::selectOne('select extract(epoch from (now() - changed_at)) as d from user_role_assignment_histories where id = ?', [$id])->d;
        $this->assertEqualsWithDelta(0, (float) $diff, 30);
    }
}
