<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Applications\ApplicationService;
use Database\Seeders\ApplicationPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class ApplicationsTest extends PostgresTestCase
{
    private OrganizationalUnit $upA;

    private OrganizationalUnit $ulpA1;

    private OrganizationalUnit $ulpA2;

    private OrganizationalUnit $upB;

    private OrganizationalUnit $ulpB1;

    private User $retailA1;

    private User $retailA2;

    private User $retailB1;

    private User $managerUlpA1;

    private User $up3ManagerA;

    private User $teknikA2;

    private User $vendor;

    private User $sysAdmin;

    private User $viewer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);

        $this->upA = $this->makeUnit('UP3');
        $this->ulpA1 = $this->makeUnit('ULP', $this->upA);
        $this->ulpA2 = $this->makeUnit('ULP', $this->upA);
        $this->upB = $this->makeUnit('UP3');
        $this->ulpB1 = $this->makeUnit('ULP', $this->upB);

        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retailA1 = $mk('NIAGA_RETAIL', $this->ulpA1);
        $this->retailA2 = $mk('NIAGA_RETAIL', $this->ulpA2);
        $this->retailB1 = $mk('NIAGA_RETAIL', $this->ulpB1);
        $this->managerUlpA1 = $mk('MANAGER_ULP', $this->ulpA1);
        $this->up3ManagerA = $mk('UP3_MANAGER', $this->upA);
        $this->teknikA2 = $mk('TEKNIK', $this->ulpA2);
        $this->vendor = $mk('VENDOR', $this->ulpA1);
        $this->viewer = $mk('VIEWER', $this->ulpA1);
        $this->sysAdmin = $mk('SYS_ADMIN', null);
    }

    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    /** @param array<string,mixed> $over */
    private function body(OrganizationalUnit $unit, array $over = []): array
    {
        return array_replace_recursive([
            'application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $unit->getKey(),
            'customer' => ['name' => 'Siti Aminah', 'phone' => '081234567890', 'idpel' => '532100123456'],
            'service_address' => 'Jl. Merdeka 1', 'new_tariff_code' => 'R1', 'new_power_value' => 900, 'new_power_unit' => 'VA',
        ], $over);
    }

    private function create(User $by, OrganizationalUnit $unit, array $over = []): string
    {
        return $this->as($by)->postJson('/api/applications', $this->body($unit, $over))->assertCreated()->json('data.id');
    }

    // ---- authorization ------------------------------------------------------------------

    #[Test]
    public function the_seeder_creates_only_the_application_keys_and_grants_and_is_idempotent(): void
    {
        $this->seed(ApplicationPermissionSeeder::class);
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();

        $this->assertSame(7, DB::table('permissions')->count());
        $this->assertSame(['NIAGA_RETAIL', 'SYS_ADMIN'], $holders('applications.create'));
        $this->assertSame(['NIAGA_RETAIL', 'SYS_ADMIN'], $holders('applications.submit'));
        $this->assertNotContains('VENDOR', $holders('applications.view'));
        $this->assertNotContains('VIEWER', $holders('applications.view'));
        $this->assertNotContains('UP3_ADMIN', $holders('applications.view'));
    }

    #[Test]
    public function only_niaga_retail_of_the_ulp_can_create_and_scope_hides_other_units(): void
    {
        $this->as($this->managerUlpA1)->postJson('/api/applications', $this->body($this->ulpA1))->assertForbidden();   // view only
        $this->as($this->up3ManagerA)->postJson('/api/applications', $this->body($this->ulpA1))->assertForbidden();
        $this->as($this->vendor)->postJson('/api/applications', $this->body($this->ulpA1))->assertForbidden();
        $this->as($this->viewer)->postJson('/api/applications', $this->body($this->ulpA1))->assertForbidden();
        $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA2))->assertNotFound();          // another ULP of the same UP3
        $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpB1))->assertNotFound();          // another UP3
        $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->upA))->assertNotFound();           // a UP3 is outside the ULP scope
        $this->assertSame(0, DB::table('applications')->count());
    }

    #[Test]
    public function grant_is_checked_before_validation(): void
    {
        $this->as($this->vendor)->postJson('/api/applications', [])->assertForbidden();
        $this->as($this->retailA1)->postJson('/api/applications', [])->assertUnprocessable();
    }

    #[Test]
    public function reading_follows_the_hierarchy_ulp_exact_up3_down_to_children_and_never_sideways(): void
    {
        $a1 = $this->create($this->retailA1, $this->ulpA1);
        $a2 = $this->create($this->retailA2, $this->ulpA2, ['customer' => ['idpel' => '999']]);
        $b1 = $this->create($this->retailB1, $this->ulpB1, ['customer' => ['idpel' => '888']]);

        $ids = fn (User $u) => collect($this->as($u)->getJson('/api/applications')->assertOk()->json('data'))->pluck('id')->sort()->values()->all();
        $this->assertSame([$a1], $ids($this->retailA1));
        $this->assertSame([$a1], $ids($this->managerUlpA1));
        $this->assertSame([$a2], $ids($this->teknikA2));
        $this->assertSame(collect([$a1, $a2])->sort()->values()->all(), $ids($this->up3ManagerA));    // child ULPs, not UP3 B
        $this->assertSame(collect([$a1, $a2, $b1])->sort()->values()->all(), $ids($this->sysAdmin));

        $this->as($this->retailA1)->getJson("/api/applications/{$a2}")->assertNotFound();
        $this->as($this->up3ManagerA)->getJson("/api/applications/{$b1}")->assertNotFound();
        $this->as($this->up3ManagerA)->getJson("/api/applications/{$a2}")->assertOk();
        $this->as($this->vendor)->getJson('/api/applications')->assertForbidden();
        $this->as($this->viewer)->getJson('/api/applications')->assertForbidden();

        // an UP3 manager reads but never writes
        $this->as($this->up3ManagerA)->patchJson("/api/applications/{$a1}", ['service_address' => 'x'])->assertForbidden();
        $this->as($this->managerUlpA1)->postJson("/api/applications/{$a1}/cancel", ['reason' => 'x'])->assertForbidden();
    }

    #[Test]
    public function an_expired_assignment_or_suspended_account_loses_access_and_sys_admin_writes_need_mfa(): void
    {
        $id = $this->create($this->retailA1, $this->ulpA1);
        DB::table('user_role_assignments')->where('user_id', $this->retailA1->getKey())->update(['valid_until' => '2026-01-02']);
        $this->as($this->retailA1)->getJson("/api/applications/{$id}")->assertForbidden();

        $this->as($this->sysAdmin, false)->getJson('/api/applications')->assertForbidden();                              // unverified token: MFA middleware
        $this->as($this->sysAdmin)->postJson('/api/applications', $this->body($this->ulpB1, ['customer' => ['idpel' => '777']]))->assertCreated();
    }

    #[Test]
    public function access_reports_capabilities_and_the_units_the_actor_may_create_in(): void
    {
        $r = $this->as($this->retailA1)->getJson('/api/applications/access')->assertOk();
        $this->assertTrue($r->json('can')['applications.create']);
        $this->assertSame([$this->ulpA1->getKey()], array_column($r->json('create_units'), 'id'));

        $m = $this->as($this->managerUlpA1)->getJson('/api/applications/access')->assertOk();
        $this->assertTrue($m->json('can')['applications.view']);
        $this->assertFalse($m->json('can')['applications.create']);
        $this->assertSame([], $m->json('create_units'));
        $this->assertNotContains(true, $this->as($this->vendor)->getJson('/api/applications/access')->assertOk()->json('can'));
    }

    // ---- creation rules -----------------------------------------------------------------

    #[Test]
    public function pb_uses_old_power_zero_and_the_delta_is_derived_in_kva_from_the_source_unit(): void
    {
        $r = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1))->assertCreated();
        $this->assertSame('DRAFT', $r->json('data.status'));
        $this->assertSame(0.9, $r->json('data.delta_power_kva'));             // 900 VA = 0.9 kVA
        $this->assertEquals(['value' => 900, 'unit' => 'VA'], $r->json('data.new_power'));
        $this->assertNull($r->json('data.old_power'));

        // an old power sent with a PB is ignored (PB = old power zero)
        $r2 = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['customer' => ['idpel' => '2'], 'old_power_value' => 450, 'old_power_unit' => 'VA', 'old_tariff_code' => 'R1']))->assertCreated();
        $this->assertNull($r2->json('data.old_power'));
        $this->assertNull($r2->json('data.old_tariff_code'));
        $this->assertSame(0.9, $r2->json('data.delta_power_kva'));
    }

    #[Test]
    public function pd_uses_new_minus_old_with_mixed_units_and_needs_both_values_for_a_delta(): void
    {
        $r = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['application_type' => 'PD', 'transaction_type' => 'TAMBAH DAYA',
            'old_power_value' => 900, 'old_power_unit' => 'VA', 'old_tariff_code' => 'R1', 'new_power_value' => 2.2, 'new_power_unit' => 'kVA']))->assertCreated();
        $this->assertSame(1.3, $r->json('data.delta_power_kva'));             // 2.2 kVA - 0.9 kVA

        $r2 = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['application_type' => 'PD', 'customer' => ['idpel' => '3']]))->assertCreated();
        $this->assertNull($r2->json('data.delta_power_kva'));                 // PD without old power: no delta yet
    }

    #[Test]
    public function power_and_numeric_inputs_are_validated_and_never_guessed(): void
    {
        foreach ([['new_power_value' => 900, 'new_power_unit' => null], ['new_power_value' => 900, 'new_power_unit' => 'W'], ['new_power_value' => -1, 'new_power_unit' => 'VA'], ['new_power_unit' => 'VA', 'new_power_value' => null],
            ['total_cost' => -5], ['application_type' => 'XX'], ['transaction_type' => ''], ['organizational_unit_id' => 'not-a-uuid']] as $bad) {
            $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, $bad))->assertUnprocessable();
        }
        $this->assertSame(0, DB::table('applications')->count());
    }

    #[Test]
    public function application_numbers_are_unique_sequential_per_ulp_and_year_and_never_reused(): void
    {
        $n1 = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1))->json('data.application_number');
        $n2 = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['customer' => ['idpel' => '2']]))->json('data.application_number');
        $m1 = $this->as($this->retailA2)->postJson('/api/applications', $this->body($this->ulpA2, ['customer' => ['idpel' => '3']]))->json('data.application_number');
        $year = now(config('distriva.business_timezone'))->format('Y');

        $this->assertSame("PBPD-{$this->ulpA1->code}-{$year}-00001", $n1);
        $this->assertSame("PBPD-{$this->ulpA1->code}-{$year}-00002", $n2);
        $this->assertSame("PBPD-{$this->ulpA2->code}-{$year}-00001", $m1);
    }

    // ---- customer and IDPEL -----------------------------------------------------------------

    #[Test]
    public function phone_is_normalised_to_e164_stored_as_text_and_invalid_numbers_are_refused(): void
    {
        $this->assertSame('+6281234567890', ApplicationService::normalizePhone('0812-3456 7890'));
        $this->assertSame('+6281234567890', ApplicationService::normalizePhone('6281234567890'));
        $this->assertSame('+6281234567890', ApplicationService::normalizePhone('+62 812 3456 7890'));
        $this->assertNull(ApplicationService::normalizePhone('abc'));
        $this->assertNull(ApplicationService::normalizePhone('123'));

        $r = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1))->assertCreated();
        $this->assertSame('+6281234567890', $r->json('data.customer.phone'));
        $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['customer' => ['phone' => 'abc', 'idpel' => '55']]))->assertStatus(409);
    }

    #[Test]
    public function one_customer_can_have_many_applications_and_an_existing_idpel_is_never_merged_automatically(): void
    {
        $first = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1))->assertCreated();
        $cid = $first->json('data.customer.id');

        // second application for the same customer (PD later), by id
        $second = $this->as($this->retailA1)->postJson('/api/applications', ['application_type' => 'PD', 'transaction_type' => 'TAMBAH DAYA', 'organizational_unit_id' => $this->ulpA1->getKey(), 'customer_id' => $cid,
            'old_power_value' => 900, 'old_power_unit' => 'VA', 'new_power_value' => 1300, 'new_power_unit' => 'VA'])->assertCreated();
        $this->assertSame($cid, $second->json('data.customer.id'));
        $this->assertSame(1, DB::table('customers')->count());
        $this->assertSame(2, DB::table('applications')->where('customer_id', $cid)->count());

        // the same IDPEL typed as a "new" customer is refused, not merged and not duplicated
        $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1))->assertStatus(409);
        $this->assertSame(1, DB::table('customers')->count());
        $this->assertSame('532100123456', DB::table('customer_external_references')->value('reference_value'));
    }

    #[Test]
    public function an_unknown_customer_id_is_not_found(): void
    {
        $this->as($this->retailA1)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA1->getKey(), 'customer_id' => (string) Str::uuid()])->assertNotFound();
    }

    // ---- update, submit, cancel ------------------------------------------------------------

    #[Test]
    public function submit_requires_a_complete_application_and_moves_it_to_submitted_with_history(): void
    {
        $id = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['customer' => ['phone' => null], 'service_address' => null]))->assertCreated()->json('data.id');

        $r = $this->as($this->retailA1)->postJson("/api/applications/{$id}/submit")->assertStatus(409);
        $this->assertStringContainsString('nomor telepon pelanggan', $r->json('message'));
        $this->assertStringContainsString('alamat layanan', $r->json('message'));

        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['customer' => ['phone' => '0812 3456 7890'], 'service_address' => 'Jl. Baru 5'])->assertOk()->assertJsonPath('data.customer.phone', '+6281234567890');
        $done = $this->as($this->retailA1)->postJson("/api/applications/{$id}/submit")->assertOk();
        $this->assertSame('SUBMITTED', $done->json('data.status'));
        $this->assertNotNull($done->json('data.submitted_at'));
        $this->assertSame([[null, 'DRAFT'], ['DRAFT', 'SUBMITTED']], array_map(fn ($h) => [$h['from_status'], $h['to_status']], $done->json('data.status_history')));

        $this->as($this->retailA1)->postJson("/api/applications/{$id}/submit")->assertStatus(409);                       // not twice
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['service_address' => 'x'])->assertStatus(409);  // draft only
    }

    #[Test]
    public function pd_needs_the_old_power_before_submit(): void
    {
        $id = $this->as($this->retailA1)->postJson('/api/applications', $this->body($this->ulpA1, ['application_type' => 'PD', 'transaction_type' => 'TAMBAH DAYA']))->assertCreated()->json('data.id');
        $this->assertStringContainsString('daya lama', $this->as($this->retailA1)->postJson("/api/applications/{$id}/submit")->assertStatus(409)->json('message'));
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['old_power_value' => 450, 'old_power_unit' => 'VA'])->assertOk()->assertJsonPath('data.delta_power_kva', 0.45);
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/submit")->assertOk();
    }

    #[Test]
    public function update_recomputes_the_delta_and_changes_nothing_when_nothing_is_sent(): void
    {
        $id = $this->create($this->retailA1, $this->ulpA1);
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['new_power_value' => 1.3, 'new_power_unit' => 'kVA'])->assertOk()->assertJsonPath('data.delta_power_kva', 1.3);
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", [])->assertStatus(409);
        $this->as($this->retailA2)->patchJson("/api/applications/{$id}", ['service_address' => 'x'])->assertNotFound();
        $this->as($this->retailA1)->patchJson('/api/applications/'.Str::uuid(), ['service_address' => 'x'])->assertNotFound();
    }

    #[Test]
    public function cancel_needs_a_reason_works_from_draft_or_submitted_and_is_final(): void
    {
        $draft = $this->create($this->retailA1, $this->ulpA1);
        $this->as($this->retailA1)->postJson("/api/applications/{$draft}/cancel", [])->assertUnprocessable();
        $this->as($this->retailA1)->postJson("/api/applications/{$draft}/cancel", ['reason' => 'Salah input'])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->as($this->retailA1)->postJson("/api/applications/{$draft}/cancel", ['reason' => 'lagi'])->assertStatus(409);
        $this->as($this->retailA1)->postJson("/api/applications/{$draft}/submit")->assertStatus(409);

        $sub = $this->create($this->retailA1, $this->ulpA1, ['customer' => ['idpel' => '11']]);
        $this->as($this->retailA1)->postJson("/api/applications/{$sub}/submit")->assertOk();
        $r = $this->as($this->retailA1)->postJson("/api/applications/{$sub}/cancel", ['reason' => 'Pelanggan membatalkan'])->assertOk();
        $history = $r->json('data.status_history');
        $last = $history[count($history) - 1];
        $this->assertSame(['SUBMITTED', 'CANCELLED', 'Pelanggan membatalkan'], [$last['from_status'], $last['to_status'], $last['reason']]);
    }

    // ---- external references ----------------------------------------------------------------

    #[Test]
    public function agenda_and_register_numbers_are_strings_attached_to_the_application_and_corrections_keep_history(): void
    {
        $id = $this->create($this->retailA1, $this->ulpA1);
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => '0012345'])->assertCreated();
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'PAYMENT_REGISTER', 'reference_number' => '0077'])->assertCreated();
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => '0012345'])->assertStatus(409);   // same number again
        $r = $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => '0012346'])->assertCreated();   // correction

        $agenda = collect($r->json('data.external_references'))->where('reference_type', 'AGENDA')->values();
        $this->assertSame([['0012345', false], ['0012346', true]], $agenda->map(fn ($x) => [$x['reference_number'], $x['is_active']])->all());   // leading zeros kept; old number kept as history
        $this->assertSame(3, DB::table('application_external_references')->where('application_id', $id)->count());

        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'OTHER', 'reference_number' => '1'])->assertUnprocessable();
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'bad number!'])->assertUnprocessable();
        $this->as($this->managerUlpA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => '9'])->assertForbidden();
    }

    #[Test]
    public function an_active_agenda_number_cannot_belong_to_two_applications_and_a_cancelled_application_takes_no_numbers(): void
    {
        $a = $this->create($this->retailA1, $this->ulpA1);
        $b = $this->create($this->retailA1, $this->ulpA1, ['customer' => ['idpel' => '2']]);
        $this->as($this->retailA1)->postJson("/api/applications/{$a}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG-1'])->assertCreated();
        $this->as($this->retailA1)->postJson("/api/applications/{$b}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG-1'])->assertStatus(409);

        $this->as($this->retailA1)->postJson("/api/applications/{$b}/cancel", ['reason' => 'x'])->assertOk();
        $this->as($this->retailA1)->postJson("/api/applications/{$b}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG-2'])->assertStatus(409);
    }

    // ---- listing ------------------------------------------------------------------------------

    #[Test]
    public function listing_filters_by_status_type_unit_and_searches_number_customer_idpel_and_agenda(): void
    {
        $a = $this->create($this->retailA1, $this->ulpA1);
        $b = $this->create($this->retailA1, $this->ulpA1, ['application_type' => 'PD', 'transaction_type' => 'TAMBAH DAYA', 'customer' => ['name' => 'Budi Santoso', 'idpel' => '8765']]);
        $this->as($this->retailA1)->postJson("/api/applications/{$a}/submit")->assertOk();
        $this->as($this->retailA1)->postJson("/api/applications/{$b}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG-77'])->assertCreated();

        $ids = fn (string $qs) => collect($this->as($this->up3ManagerA)->getJson('/api/applications'.$qs)->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$a], $ids('?status=SUBMITTED'));
        $this->assertSame([$b], $ids('?type=PD'));
        $this->assertSame([$b], $ids('?search=budi'));
        $this->assertSame([$b], $ids('?search=8765'));
        $this->assertSame([$b], $ids('?search=AG-77'));
        $this->assertSame([$a], $ids('?search=532100'));
        $this->assertSame([], $ids('?unit_id='.$this->ulpA2->getKey()));
        $this->as($this->up3ManagerA)->getJson('/api/applications?status=BOGUS')->assertUnprocessable();
        $this->as($this->up3ManagerA)->getJson('/api/applications?per_page=100000')->assertOk()->assertJsonPath('meta.per_page', 100);
    }

    // ---- database integrity ---------------------------------------------------------------------

    #[Test]
    public function the_database_rejects_a_non_ulp_unit_identity_changes_and_history_edits(): void
    {
        $id = $this->create($this->retailA1, $this->ulpA1);
        $this->assertDbRejects(fn () => DB::table('applications')->where('id', $id)->update(['organizational_unit_id' => $this->upA->getKey()]));       // a UP3
        $this->assertDbRejects(fn () => DB::table('applications')->where('id', $id)->update(['organizational_unit_id' => $this->ulpA2->getKey()]));     // identity is immutable
        $this->assertDbRejects(fn () => DB::table('applications')->where('id', $id)->update(['application_number' => 'X']));
        $this->assertDbRejects(fn () => DB::table('applications')->where('id', $id)->update(['current_status' => 'DONE']));
        $this->assertDbRejects(fn () => DB::table('applications')->where('id', $id)->update(['new_power_unit' => 'W']));
        $this->assertDbRejects(fn () => DB::table('application_status_histories')->where('application_id', $id)->update(['to_status' => 'SUBMITTED']));
        $this->assertDbRejects(fn () => DB::table('application_status_histories')->where('application_id', $id)->delete());
        $this->assertDbRejects(fn () => DB::table('customers')->where('id', DB::table('applications')->where('id', $id)->value('customer_id'))->update(['phone' => '0812']));
    }

    #[Test]
    public function the_idpel_of_a_manual_application_is_completed_later_once_and_never_replaced_or_taken_from_another_customer(): void
    {
        $id = $this->create($this->retailA1, $this->ulpA1, ['customer' => ['idpel' => null]]);                    // entered without an IDPEL
        $idpelOf = fn (string $app) => DB::table('customer_external_references')->where('customer_id', DB::table('applications')->where('id', $app)->value('customer_id'))->where('reference_type', 'IDPEL')->pluck('reference_value')->all();
        $patch = fn (string $app, array $customer, ?User $by = null) => $this->as($by ?? $this->retailA1)->patchJson("/api/applications/{$app}", ['customer' => $customer]);
        $this->assertSame([], $idpelOf($id));

        $patch($id, ['idpel' => '51 45'])->assertUnprocessable();                                                  // format
        $patch($id, ['idpel' => '514530857574'])->assertOk();                                                      // completed while still a draft
        $this->assertSame(['514530857574'], $idpelOf($id));
        $patch($id, ['idpel' => '514530857574'])->assertOk();                                                      // the same value again changes nothing
        $this->assertSame(['514530857574'], $idpelOf($id));
        $patch($id, ['idpel' => '514530999999'])->assertStatus(409);                                              // a recorded IDPEL is never replaced here
        $this->assertSame(['514530857574'], $idpelOf($id));
        $this->as($this->retailA2)->patchJson("/api/applications/{$id}", ['customer' => ['idpel' => '514530111111']])->assertNotFound();   // another ULP

        $other = $this->create($this->retailA1, $this->ulpA1, ['customer' => ['name' => 'Budi', 'idpel' => null]]);
        $patch($other, ['idpel' => '514530857574'])->assertStatus(409);                                            // belongs to another customer: never merged automatically
        $this->as($this->retailA1)->postJson("/api/applications/{$other}/submit")->assertOk();
        $patch($other, ['idpel' => '514530222222'])->assertOk();                                                   // still allowed after submission, with the agenda and the register
        $this->as($this->retailA1)->postJson("/api/applications/{$other}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG-OTHER-1'])->assertCreated();
        $this->as($this->retailA1)->postJson("/api/applications/{$other}/external-references", ['reference_type' => 'PAYMENT_REGISTER', 'reference_number' => 'REG-OTHER-1'])->assertCreated();
        $patch($other, ['phone' => '0812 0000 1111'])->assertOk();
        $this->assertSame('APPROVED', DB::table('applications')->where('id', $other)->value('current_status'));
        $patch($other, ['name' => 'Nama Lain'])->assertStatus(409);                                                // after the draft the name stays; only phone, e-mail and IDPEL are completed

        $third = $this->create($this->retailA1, $this->ulpA1, ['customer' => ['name' => 'Candra', 'idpel' => null]]);
        $this->as($this->retailA1)->postJson("/api/applications/{$third}/cancel", ['reason' => 'Dibatalkan pelanggan'])->assertOk();
        $patch($third, ['idpel' => '514530333333'])->assertStatus(409);                                            // a cancelled application is closed
    }
}
