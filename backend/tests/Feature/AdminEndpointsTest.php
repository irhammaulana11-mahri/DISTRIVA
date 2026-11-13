<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Authorization\AuthorizationContext;
use App\Services\Authorization\AuthorizationScopeMode;
use App\Services\Authorization\ScopedAuthorizationService;
use Database\Seeders\FoundationPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Spatie\Permission\Models\Permission;
use Tests\PostgresTestCase;

class AdminEndpointsTest extends PostgresTestCase
{
    private OrganizationalUnit $upA;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $upB;

    private OrganizationalUnit $ulpB;

    private User $adminA;

    private User $adminA2;

    private User $adminB;

    private User $sysAdmin;

    private User $tekA;

    private User $tekB;

    private User $multi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(FoundationPermissionSeeder::class);

        $this->upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->upA);
        $this->upB = $this->makeUnit('UP3');
        $this->ulpB = $this->makeUnit('ULP', $this->upB);

        $admin = Role::query()->where('name', 'UP3_ADMIN')->firstOrFail();
        $teknik = Role::query()->where('name', 'TEKNIK')->firstOrFail();
        $sys = Role::query()->where('name', 'SYS_ADMIN')->firstOrFail();

        $this->adminA = $this->makeUser();
        $this->adminA2 = $this->makeUser();
        $this->adminB = $this->makeUser();
        $this->sysAdmin = $this->makeUser();
        $this->tekA = $this->makeUser();
        $this->tekB = $this->makeUser();
        $this->multi = $this->makeUser();

        $this->assign($this->adminA, $admin, $this->upA);
        $this->assign($this->adminA2, $admin, $this->upA);
        $this->assign($this->adminB, $admin, $this->upB);
        $this->assign($this->sysAdmin, $sys, null);
        $this->assign($this->tekA, $teknik, $this->ulpA);
        $this->assign($this->tekB, $teknik, $this->ulpB);
        $this->assign($this->multi, $teknik, $this->ulpA);
        $this->assign($this->multi, $teknik, $this->ulpB);

        // Keep the per-route throttle out of the way; it is covered in AuthApiTest.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    /** @param bool $mfa SYS_ADMIN tokens are MFA-verified by default; pass false for a freshly logged-in token. */
    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    private function role(string $name): Role
    {
        return Role::query()->where('name', $name)->firstOrFail();
    }

    private function body(User $target, string $role, OrganizationalUnit $unit, array $extra = []): array
    {
        return $extra + [
            'user_id' => $target->getKey(), 'role_id' => $this->role($role)->getKey(),
            'organizational_unit_id' => $unit->getKey(), 'valid_from' => '2026-01-01',
            'reason' => 'Mutasi', 'assignment_document' => 'SK-001',
        ];
    }

    // ---- catalog / seeder ----------------------------------------------------------------

    #[Test]
    public function the_seeder_creates_only_the_approved_keys_and_grants_and_is_idempotent(): void
    {
        $this->seed(FoundationPermissionSeeder::class);

        $this->assertSame(9, DB::table('permissions')->count());
        $this->assertSame(16, DB::table('role_has_permissions')->count()); // 7 keys x {UP3_ADMIN, SYS_ADMIN} + 2 unit-write keys x SYS_ADMIN only (D-4 A)
        $this->assertSame(0, Role::query()->where('name', 'TEKNIK')->firstOrFail()->permissions()->count());
        $this->assertSame(25, DB::table('authorization_change_histories')->whereIn('event_type', ['PERMISSION_CATALOG_CHANGED', 'ROLE_PERMISSION_GRANTED'])->count());
    }

    // ---- access without a grant ---------------------------------------------------------

    #[Test]
    public function users_without_a_grant_get_403_everywhere_and_cannot_probe_ids(): void
    {
        $someAssignment = DB::table('user_role_assignments')->value('id');
        $teknik = $this->tekA;

        $this->as($teknik)->getJson('/api/admin/users')->assertForbidden();
        $this->as($teknik)->getJson('/api/admin/organizational-units')->assertForbidden();
        $this->as($teknik)->getJson("/api/admin/users/{$this->tekB->getKey()}/assignments")->assertForbidden();
        // Same 403 for valid and bogus ids and for an empty body: grant is checked before validation.
        $this->as($teknik)->postJson('/api/admin/role-assignments', [])->assertForbidden();
        $this->as($teknik)->postJson('/api/admin/role-assignments', $this->body($this->tekB, 'TEKNIK', $this->ulpB))->assertForbidden();
        $this->as($teknik)->postJson("/api/admin/role-assignments/{$someAssignment}/end", [])->assertForbidden();
        $this->as($teknik)->postJson("/api/admin/users/{$this->tekB->getKey()}/status", [])->assertForbidden();
    }

    #[Test]
    public function an_expired_or_inactive_admin_assignment_and_a_suspended_admin_lose_access(): void
    {
        DB::table('user_role_assignments')->where('user_id', $this->adminB->getKey())->update(['valid_until' => '2026-01-02']);
        $this->as($this->adminB)->getJson('/api/admin/users')->assertForbidden();

        DB::table('user_role_assignments')->where('user_id', $this->adminA2->getKey())->update(['is_active' => false]);
        $this->as($this->adminA2)->getJson('/api/admin/users')->assertForbidden();

        $token = $this->adminA->createToken('t')->plainTextToken;
        $this->adminA->forceFill(['account_status' => 'SUSPENDED'])->save();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/admin/users')->assertForbidden();
    }

    #[Test]
    public function guests_are_unauthorized(): void
    {
        $this->getJson('/api/admin/users')->assertUnauthorized();
        $this->postJson('/api/admin/role-assignments', [])->assertUnauthorized();
    }

    // ---- read scope ---------------------------------------------------------------------

    #[Test]
    public function up3_admin_sees_only_own_up3_and_child_ulp_units_and_users_with_scope_before_pagination(): void
    {
        $units = $this->as($this->adminA)->getJson('/api/admin/organizational-units')->assertOk();
        $this->assertEqualsCanonicalizing([$this->upA->getKey(), $this->ulpA->getKey()], array_column($units->json('data'), 'id'));
        $this->assertSame(2, $units->json('meta.total'));

        $users = $this->as($this->adminA)->getJson('/api/admin/users?per_page=2')->assertOk();
        $this->assertSame(4, $users->json('meta.total')); // adminA, adminA2, tekA, multi
        $this->assertCount(2, $users->json('data'));
        $this->assertSame(2, $users->json('meta.last_page'));

        $all = collect($this->as($this->adminA)->getJson('/api/admin/users?per_page=100')->json('data'))->pluck('id');
        $this->assertTrue($all->contains($this->tekA->getKey()));
        $this->assertTrue($all->contains($this->multi->getKey())); // has an assignment in A's ULP
        $this->assertFalse($all->contains($this->tekB->getKey()));
        $this->assertFalse($all->contains($this->adminB->getKey()));
        $this->assertFalse($all->contains($this->sysAdmin->getKey()));
    }

    #[Test]
    public function user_assignments_are_filtered_to_scope_and_hide_other_units_and_unknown_ids(): void
    {
        $res = $this->as($this->adminA)->getJson("/api/admin/users/{$this->multi->getKey()}/assignments")->assertOk();
        $this->assertSame([$this->ulpA->getKey()], array_column($res->json('data'), 'organizational_unit_id')); // B-side row hidden

        $this->as($this->adminA)->getJson("/api/admin/users/{$this->tekB->getKey()}/assignments")->assertNotFound();
        $this->as($this->adminA)->getJson('/api/admin/users/'.fake()->uuid().'/assignments')->assertNotFound();
    }

    #[Test]
    public function filters_cannot_reach_outside_scope_and_search_escapes_wildcards(): void
    {
        $this->as($this->adminA)->getJson('/api/admin/users?unit_id='.$this->ulpB->getKey())->assertNotFound();

        $res = $this->as($this->adminA)->getJson('/api/admin/users?search=%25')->assertOk();
        $this->assertSame(0, $res->json('meta.total')); // '%' is literal, not a wildcard

        $this->as($this->adminA)->getJson('/api/admin/users?status=BOGUS')->assertUnprocessable();
        $this->as($this->adminA)->getJson('/api/admin/users?per_page=100000')->assertOk()->assertJsonPath('meta.per_page', 100);
    }

    #[Test]
    public function sys_admin_can_read_everything_but_the_response_has_no_secrets(): void
    {
        $res = $this->as($this->sysAdmin)->getJson('/api/admin/users?per_page=100')->assertOk();
        $this->assertSame(7, $res->json('meta.total')); // all 7 seeded users
        $this->assertStringNotContainsString('"password":', json_encode($res->json()));
        $this->assertStringNotContainsString('remember_token', json_encode($res->json()));
        $this->as($this->sysAdmin)->getJson('/api/admin/organizational-units')->assertOk()->assertJsonPath('meta.total', 4);
    }

    // ---- assign -------------------------------------------------------------------------

    #[Test]
    public function up3_admin_can_assign_a_role_inside_scope_with_audit_and_actor(): void
    {
        $new = $this->makeUser();
        $res = $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->ulpA))->assertCreated();

        $this->assertSame('TEKNIK', $res->json('data.role'));
        $this->assertDatabaseHas('user_role_assignments', ['user_id' => $new->getKey(), 'assigned_by' => $this->adminA->getKey(), 'assignment_document' => 'SK-001']);
        $h = DB::table('user_role_assignment_histories')->where('event_type', 'CREATED')->latest('changed_at')->first();
        $this->assertSame($this->adminA->getKey(), $h->actor_user_id);
        $this->assertSame('Mutasi', $h->reason);
    }

    #[Test]
    public function assign_requires_the_document_and_valid_input(): void
    {
        $new = $this->makeUser();
        $body = $this->body($new, 'TEKNIK', $this->ulpA);
        unset($body['assignment_document']);
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $body)->assertUnprocessable()->assertJsonValidationErrors('assignment_document');
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->ulpA, ['valid_until' => '2025-01-01']))->assertUnprocessable();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->ulpA, ['reason' => '  ']))->assertUnprocessable();
    }

    #[Test]
    public function assign_is_denied_outside_scope_with_404_even_when_the_unit_id_is_forged_in_the_body(): void
    {
        $new = $this->makeUser();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->ulpB))->assertNotFound();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->upB))->assertNotFound();
        $this->assertDatabaseMissing('user_role_assignments', ['user_id' => $new->getKey()]);
    }

    #[Test]
    public function assign_blocks_escalation_self_service_and_wrong_unit_types(): void
    {
        $new = $this->makeUser();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'SYS_ADMIN', $this->upA))->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'VENDOR', $this->ulpA))->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'UP3_ADMIN', $this->ulpA))->assertForbidden(); // UP3_ADMIN only on UP3 units
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($this->adminA, 'TEKNIK', $this->ulpA))->assertForbidden(); // self
        $this->assertDatabaseMissing('user_role_assignments', ['user_id' => $new->getKey()]);

        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'UP3_ADMIN', $this->upA))->assertCreated(); // allowed on own UP3
    }

    #[Test]
    public function assign_maps_overlap_to_409_and_inactive_unit_to_409(): void
    {
        $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($this->tekA, 'TEKNIK', $this->ulpA, ['valid_from' => '2026-06-01']))->assertStatus(409);

        $this->ulpA->update(['is_active' => false]);
        $new = $this->makeUser();
        $res = $this->as($this->adminA)->postJson('/api/admin/role-assignments', $this->body($new, 'TEKNIK', $this->ulpA));
        $this->assertContains($res->getStatusCode(), [404, 409]); // inactive child drops out of scope or is rejected by the DB rule
        $this->assertDatabaseMissing('user_role_assignments', ['user_id' => $new->getKey()]);
    }

    // ---- end ----------------------------------------------------------------------------

    #[Test]
    public function up3_admin_can_end_an_assignment_in_scope_and_it_is_audited(): void
    {
        $id = DB::table('user_role_assignments')->where('user_id', $this->tekA->getKey())->value('id');
        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$id}/end", ['reason' => 'Mutasi keluar'])->assertOk()->assertJsonPath('data.is_active', false);

        $this->assertDatabaseHas('user_role_assignment_histories', ['user_role_assignment_id' => $id, 'event_type' => 'REVOKED', 'actor_user_id' => $this->adminA->getKey()]);
        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$id}/end", ['reason' => 'lagi'])->assertStatus(409); // already ended
    }

    #[Test]
    public function end_is_hidden_outside_scope_and_blocked_for_system_roles_and_self(): void
    {
        $other = DB::table('user_role_assignments')->where('user_id', $this->tekB->getKey())->value('id');
        $sys = DB::table('user_role_assignments')->where('user_id', $this->sysAdmin->getKey())->value('id');
        $own = DB::table('user_role_assignments')->where('user_id', $this->adminA->getKey())->value('id');

        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$other}/end", ['reason' => 'x'])->assertNotFound();
        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$sys}/end", ['reason' => 'x'])->assertNotFound(); // global row is outside any UP3 scope
        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$own}/end", ['reason' => 'x'])->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/role-assignments/'.fake()->uuid().'/end', ['reason' => 'x'])->assertNotFound();
    }

    #[Test]
    public function the_last_up3_admin_of_a_unit_cannot_be_ended_but_a_non_last_one_can(): void
    {
        $a2 = DB::table('user_role_assignments')->where('user_id', $this->adminA2->getKey())->value('id');
        $a1 = DB::table('user_role_assignments')->where('user_id', $this->adminA->getKey())->value('id');

        $this->as($this->adminA)->postJson("/api/admin/role-assignments/{$a2}/end", ['reason' => 'rotasi'])->assertOk(); // adminA remains
        // adminA2 is now ended; adminA is the last one. A different actor with the grant (MFA gate off) must be refused.
        config(['distriva.system_writes_require_mfa' => false]);
        $this->as($this->sysAdmin)->postJson("/api/admin/role-assignments/{$a1}/end", ['reason' => 'x'])->assertStatus(409);
    }

    // ---- status -------------------------------------------------------------------------

    #[Test]
    public function up3_admin_can_suspend_a_user_fully_inside_scope_and_tokens_are_revoked(): void
    {
        $this->tekA->createToken('t');
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->tekA->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'Cuti'])->assertOk()->assertJsonPath('data.account_status', 'SUSPENDED');

        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $this->tekA->getKey())->count());
        $this->assertDatabaseHas('authorization_change_histories', ['event_type' => 'USER_STATUS_CHANGED', 'user_id' => $this->tekA->getKey(), 'actor_user_id' => $this->adminA->getKey()]);
    }

    #[Test]
    public function status_change_is_hidden_for_users_partly_or_fully_outside_scope_and_blocked_for_self_and_system_accounts(): void
    {
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->tekB->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertNotFound();
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->multi->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertNotFound(); // also assigned in B
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->sysAdmin->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertNotFound();
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->adminA->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/users/'.fake()->uuid().'/status', ['status' => 'SUSPENDED', 'reason' => 'x'])->assertNotFound();
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->tekA->getKey()}/status", ['status' => 'BOGUS', 'reason' => 'x'])->assertUnprocessable();
        $this->assertSame('ACTIVE', $this->tekB->fresh()->account_status);
    }

    #[Test]
    public function the_last_active_up3_admin_cannot_be_suspended(): void
    {
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->adminA2->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertOk(); // adminA stays
        config(['distriva.system_writes_require_mfa' => false]);
        $this->as($this->sysAdmin)->postJson("/api/admin/users/{$this->adminA->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertStatus(409);
        $this->assertSame('ACTIVE', $this->adminA->fresh()->account_status);
    }

    // ---- SYS_ADMIN / MFA gate -----------------------------------------------------------

    #[Test]
    public function an_mfa_unverified_sys_admin_token_can_do_nothing_but_the_mfa_flow(): void
    {
        $new = $this->makeUser();
        $this->as($this->sysAdmin, false)->postJson('/api/admin/role-assignments', $this->body($new, 'UP3_ADMIN', $this->upA))->assertForbidden()->assertJsonPath('message', 'Verifikasi MFA diperlukan.');
        $this->as($this->sysAdmin, false)->postJson("/api/admin/users/{$this->tekA->getKey()}/status", ['status' => 'SUSPENDED', 'reason' => 'x'])->assertForbidden();
        $this->as($this->sysAdmin, false)->getJson('/api/admin/users')->assertForbidden()->assertJsonPath('mfa.required', true);
        $this->as($this->sysAdmin, false)->getJson('/api/me')->assertOk();
        $this->assertDatabaseMissing('user_role_assignments', ['user_id' => $new->getKey()]);
    }

    // ---- scope service ------------------------------------------------------------------

    #[Test]
    public function delegation_mode_works_only_for_admin_keys_and_only_for_the_up3_admin_role(): void
    {
        $svc = $this->app->make(ScopedAuthorizationService::class);
        $ctx = fn ($unit) => new AuthorizationContext(AuthorizationScopeMode::UP3_ADMIN_DELEGATION, $unit);

        $this->assertTrue($svc->allows($this->adminA, 'role_assignments.assign', $ctx($this->ulpA)));
        $this->assertFalse($svc->allows($this->adminA, 'role_assignments.assign', $ctx($this->ulpB)));
        $this->assertFalse($svc->allows($this->adminA, 'applications.view', $ctx($this->ulpA))); // not an admin key
        // a role other than UP3_ADMIN holding the key does not get delegation
        $perm = Permission::query()->where('name', 'users.view')->firstOrFail();
        $this->role('UP3_MANAGER')->permissions()->attach($perm->getKey());
        $mgr = $this->makeUser();
        $this->assign($mgr, $this->role('UP3_MANAGER'), $this->upA);
        $this->assertFalse($svc->allows($mgr, 'users.view', $ctx($this->ulpA)));
    }

    // ---- UI support endpoints -----------------------------------------------------------

    #[Test]
    public function access_reports_capabilities_per_actor_and_never_errors_for_plain_users(): void
    {
        $admin = $this->as($this->adminA)->getJson('/api/admin/access')->assertOk();
        $this->assertTrue($admin->json('can')['users.view']);
        $this->assertTrue($admin->json('can_write')['role_assignments.assign']);

        $plain = $this->as($this->tekA)->getJson('/api/admin/access')->assertOk();
        $this->assertNotContains(true, $plain->json('can'));
        $this->assertNotContains(true, $plain->json('can_write'));

        $sys = $this->as($this->sysAdmin)->getJson('/api/admin/access')->assertOk();
        $this->assertTrue($sys->json('can')['users.view']);
        $this->assertTrue($sys->json('can_write')['users.change_status']); // MFA-verified token
        $this->as($this->sysAdmin, false)->getJson('/api/admin/access')->assertForbidden();
    }

    #[Test]
    public function roles_list_excludes_system_and_vendor_roles_for_up3_admin_and_needs_the_grant(): void
    {
        $names = array_column($this->as($this->adminA)->getJson('/api/admin/roles')->assertOk()->json('data'), 'name');
        $this->assertContains('TEKNIK', $names);
        $this->assertContains('UP3_ADMIN', $names);
        $this->assertNotContains('SYS_ADMIN', $names);
        $this->assertNotContains('VENDOR', $names);

        $this->as($this->tekA)->getJson('/api/admin/roles')->assertForbidden();
    }

    #[Test]
    public function user_detail_is_scoped_and_hides_unknown_and_out_of_scope_users(): void
    {
        $this->as($this->adminA)->getJson("/api/admin/users/{$this->tekA->getKey()}")->assertOk()->assertJsonPath('data.id', $this->tekA->getKey());
        $this->as($this->adminA)->getJson("/api/admin/users/{$this->multi->getKey()}")->assertOk();
        $this->as($this->adminA)->getJson("/api/admin/users/{$this->tekB->getKey()}")->assertNotFound();
        $this->as($this->adminA)->getJson('/api/admin/users/'.fake()->uuid())->assertNotFound();
        $this->as($this->tekA)->getJson("/api/admin/users/{$this->tekA->getKey()}")->assertForbidden();
    }

    // ---- organizational units: D-4 option A (only SYS_ADMIN writes, closed until MFA) -----------

    #[Test]
    public function the_seeder_revokes_a_stale_foundation_grant_with_an_audit_row_and_is_idempotent(): void
    {
        $perm = Permission::query()->where('name', 'organizational_units.create')->firstOrFail();
        $role = Role::query()->where('name', 'UP3_ADMIN')->firstOrFail();
        $role->permissions()->attach($perm->getKey()); // stale grant left by an old seeding

        $this->seed(FoundationPermissionSeeder::class);
        $this->assertFalse($role->permissions()->whereKey($perm->getKey())->exists());
        $this->assertSame(1, DB::table('authorization_change_histories')->where('event_type', 'ROLE_PERMISSION_REVOKED')->where('role_id', $role->getKey())->where('permission_id', $perm->getKey())->count());

        $this->seed(FoundationPermissionSeeder::class);
        $this->assertSame(1, DB::table('authorization_change_histories')->where('event_type', 'ROLE_PERMISSION_REVOKED')->count());
    }

    #[Test]
    public function up3_admin_holds_no_unit_write_grant_and_the_ui_hint_says_so(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['SYS_ADMIN'], $holders('organizational_units.create'));
        $this->assertSame(['SYS_ADMIN'], $holders('organizational_units.update'));
        $this->assertSame(['SYS_ADMIN', 'UP3_ADMIN'], $holders('organizational_units.view'));

        $can = $this->as($this->adminA)->getJson('/api/admin/access')->assertOk()->json('can');
        $this->assertTrue($can['organizational_units.view']);
        $this->assertFalse($can['organizational_units.create']);
        $this->assertFalse($can['organizational_units.update']);
    }

    #[Test]
    public function up3_admin_cannot_create_or_update_units_and_gets_403_before_validation(): void
    {
        $this->as($this->adminA)->postJson('/api/admin/organizational-units', [])->assertForbidden();
        $body = ['code' => 'ULP-NEW', 'name' => 'ULP Baru', 'unit_type' => 'ULP', 'parent_id' => $this->upA->getKey(), 'reason' => 'x'];
        $this->as($this->adminA)->postJson('/api/admin/organizational-units', $body)->assertForbidden();
        $this->as($this->adminA)->patchJson("/api/admin/organizational-units/{$this->ulpA->getKey()}", ['name' => 'Ganti', 'reason' => 'x'])->assertForbidden();
        $this->as($this->adminA)->patchJson("/api/admin/organizational-units/{$this->upA->getKey()}", ['is_active' => false, 'reason' => 'x'])->assertForbidden();
        $this->as($this->adminA)->patchJson("/api/admin/organizational-units/{$this->upB->getKey()}", ['name' => 'x', 'reason' => 'x'])->assertForbidden(); // same 403 for units outside the tree

        $this->assertDatabaseMissing('organizational_units', ['code' => 'ULP-NEW']);
        $this->assertSame('Unit ULP', $this->ulpA->fresh()->name); // untouched
    }

    #[Test]
    public function users_without_the_view_grant_cannot_touch_units_at_all(): void
    {
        $this->as($this->tekA)->postJson('/api/admin/organizational-units', [])->assertForbidden();
        $this->as($this->tekA)->patchJson("/api/admin/organizational-units/{$this->ulpA->getKey()}", ['name' => 'x', 'reason' => 'x'])->assertForbidden();
        $this->as($this->tekA)->getJson("/api/admin/organizational-units/{$this->ulpA->getKey()}")->assertForbidden();
    }

    #[Test]
    public function sys_admin_unit_writes_are_closed_by_the_mfa_gate(): void
    {
        $body = ['code' => 'ULP-NEW', 'name' => 'ULP Baru', 'unit_type' => 'ULP', 'parent_id' => $this->upA->getKey(), 'reason' => 'Pembentukan'];
        $this->as($this->sysAdmin, false)->postJson('/api/admin/organizational-units', $body)->assertForbidden()->assertJsonPath('message', 'Verifikasi MFA diperlukan.');
        $this->as($this->sysAdmin, false)->postJson('/api/admin/organizational-units', ['code' => 'UP3-NEW', 'name' => 'UP3 Baru', 'unit_type' => 'UP3', 'reason' => 'x'])->assertForbidden();
        $this->as($this->sysAdmin, false)->patchJson("/api/admin/organizational-units/{$this->ulpA->getKey()}", ['name' => 'Ganti', 'reason' => 'x'])->assertForbidden();
        $this->assertDatabaseMissing('organizational_units', ['code' => 'ULP-NEW']);
    }

    #[Test]
    public function once_mfa_exists_sys_admin_creates_and_updates_units_with_history_and_the_hierarchy_rules(): void
    {
        config(['distriva.system_writes_require_mfa' => false]); // stands in for "MFA satisfied"

        $up3 = $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'UP3-NEW', 'name' => 'UP3 Baru', 'unit_type' => 'UP3', 'reason' => 'Pembentukan'])->assertCreated()->json('data.id');
        $ulp = $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'ULP-NEW', 'name' => 'ULP Baru', 'unit_type' => 'ULP', 'parent_id' => $up3, 'address' => 'Jl. A', 'reason' => 'Pembentukan'])->assertCreated()->assertJsonPath('data.parent_name', 'UP3 Baru')->json('data.id');
        $this->assertSame(2, DB::table('organizational_unit_histories')->whereIn('organizational_unit_id', [$up3, $ulp])->count());

        // validation and hierarchy
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'ULP-NEW', 'name' => 'x', 'unit_type' => 'ULP', 'parent_id' => $up3, 'reason' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('code'); // codes are never reused
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'BAD CODE', 'name' => 'x', 'unit_type' => 'UP3', 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'ULP-X', 'name' => 'x', 'unit_type' => 'ULP', 'reason' => 'x'])->assertStatus(409);                       // ULP needs a parent
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'UP3-X', 'name' => 'x', 'unit_type' => 'UP3', 'parent_id' => $up3, 'reason' => 'x'])->assertStatus(409); // UP3 has none
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'ULP-Y', 'name' => 'x', 'unit_type' => 'ULP', 'parent_id' => $ulp, 'reason' => 'x'])->assertStatus(409);   // parent must be UP3
        $this->as($this->sysAdmin)->postJson('/api/admin/organizational-units', ['code' => 'ULP-Z', 'name' => 'x', 'unit_type' => 'ULP', 'parent_id' => $up3])->assertUnprocessable()->assertJsonValidationErrors('reason');

        // update: only name/address/active; code is immutable; an UP3 with an active child cannot be deactivated
        $this->as($this->sysAdmin)->patchJson("/api/admin/organizational-units/{$ulp}", ['name' => 'ULP Baru Sekali', 'code' => 'HACK', 'unit_type' => 'UP3', 'reason' => 'Ganti nama'])->assertOk()->assertJsonPath('data.name', 'ULP Baru Sekali')->assertJsonPath('data.code', 'ULP-NEW');
        $this->as($this->sysAdmin)->patchJson("/api/admin/organizational-units/{$up3}", ['is_active' => false, 'reason' => 'x'])->assertStatus(409);
        $this->as($this->sysAdmin)->patchJson("/api/admin/organizational-units/{$ulp}", ['is_active' => false, 'reason' => 'Ditutup'])->assertOk()->assertJsonPath('data.is_active', false);
        $this->as($this->sysAdmin)->patchJson("/api/admin/organizational-units/{$up3}", ['is_active' => false, 'reason' => 'Ditutup'])->assertOk();
        $this->as($this->sysAdmin)->patchJson("/api/admin/organizational-units/{$ulp}", ['reason' => 'x'])->assertStatus(409);                   // nothing to change
        $this->as($this->sysAdmin)->patchJson('/api/admin/organizational-units/'.fake()->uuid(), ['name' => 'x', 'reason' => 'x'])->assertNotFound();
        $this->assertSame('ULP-NEW', DB::table('organizational_units')->where('id', $ulp)->value('code'));
    }

    #[Test]
    public function the_unit_detail_is_scoped_and_lists_children_and_history(): void
    {
        $detail = $this->as($this->adminA)->getJson("/api/admin/organizational-units/{$this->upA->getKey()}")->assertOk();
        $this->assertSame([$this->ulpA->getKey()], array_column($detail->json('data.children'), 'id'));
        $this->assertIsArray($detail->json('data.histories'));

        $this->as($this->adminA)->getJson("/api/admin/organizational-units/{$this->upB->getKey()}")->assertNotFound();      // other UP3
        $this->as($this->adminA)->getJson('/api/admin/organizational-units/'.fake()->uuid())->assertNotFound();
        $this->as($this->sysAdmin)->getJson("/api/admin/organizational-units/{$this->upB->getKey()}")->assertOk();           // global read
    }
}
