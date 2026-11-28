<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Bom\BomService;
use App\Services\Inventory\SrReservationService;
use App\Services\Inventory\StockService;
use App\Services\Reports\ReportService;
use App\Services\Tasks\ServiceSlaService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Reservation of a connection without network extension (docs/95): executor, material from the APP BOM, approval by the level of the source warehouse, MIMS number. */
class SrReservationTest extends PostgresTestCase
{
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhWpDwwAAAABJRU5ErkJggg==';

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    /** @var array<string,User> */
    private array $users;

    private string $ulpWarehouse;

    private string $up3Warehouse;

    private string $contractor;

    private string $otherVendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        config(['distriva.survey_requires_kko' => false]);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(SurveyPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);

        $this->up3 = $this->makeUnit('UP3');
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $otherUlp = $this->makeUnit('ULP', $this->up3);
        foreach (['niaga' => ['NIAGA_RETAIL', $this->ulp], 'niagaLain' => ['NIAGA_RETAIL', $otherUlp], 'manager' => ['MANAGER_ULP', $this->ulp], 'teknik' => ['TEKNIK', $this->ulp],
            'konstruksi' => ['KONSTRUKSI', $this->up3], 'asman' => ['ASMAN_KONSTRUKSI', $this->up3]] as $key => [$role, $unit]) {
            $this->users[$key] = $this->makeUser();
            $this->assign($this->users[$key], Role::query()->where('name', $role)->firstOrFail(), $unit);
        }
        $this->ulpWarehouse = $this->warehouse($this->ulp);
        $this->up3Warehouse = $this->warehouse($this->up3);
        $this->contractor = $this->vendor('JARINGAN');
        $this->otherVendor = $this->vendor('KEDUANYA');
        $this->approvedSr1Bom();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function warehouse(OrganizationalUnit $unit): string
    {
        $id = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $id, 'code' => 'GD-'.Str::random(6), 'name' => 'Gudang '.$unit->unit_type, 'organizational_unit_id' => $unit->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function vendor(string $scope): string
    {
        $id = (string) Str::uuid();
        DB::table('vendor_companies')->insert(['id' => $id, 'code' => 'V-'.Str::random(6), 'name' => 'CV '.Str::random(5), 'status' => 'ACTIVE', 'work_scope' => $scope,
            'created_by' => $this->users['konstruksi']->getKey(), 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function khs(string $code): string
    {
        $existing = DB::table('khs_items')->where('code', $code)->value('id');
        if ($existing !== null) {
            return $existing;
        }
        $id = (string) Str::uuid();
        DB::table('khs_items')->insert(['id' => $id, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => "Butir {$code}", 'unit_text' => 'B', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $this->users['konstruksi']->getKey(), 'approved_by' => $this->users['asman']->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function importBom(array $doc): void
    {
        foreach ($doc['lines'] as $l) {
            if (($l['khs_code'] ?? null) !== null) {
                $this->khs((string) $l['khs_code']);
            }
        }
        app(BomService::class)->import($doc, '2025-01-01', 'uji', false, $this->users['konstruksi']);
        app(BomService::class)->approve([(string) DB::table('bom_headers')->where('group_code', $doc['group'])->value('id')], $this->users['asman'], 'uji');
    }

    private function approvedSr1Bom(): void
    {
        $this->importBom(json_decode((string) file_get_contents(base_path('tests/fixtures/bom_SR1PH.json')), true, 512, JSON_THROW_ON_ERROR));
    }

    /** An application of the ULP whose survey the ULP manager accepted. */
    private function surveyed(bool $extension = false, int $powerVa = 1300): string
    {
        $app = $this->as($this->users['niaga'])->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulp->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => $powerVa, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->users['niaga'])->postJson("/api/applications/{$app}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        $survey = $this->as($this->users['manager'])->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->users['teknik']->getKey()])->assertCreated();
        [$s, $v] = [$survey->json('data.id'), $survey->json('data.versions.0.id')];
        $this->as($this->users['teknik'])->patchJson("/api/surveys/{$s}/versions/{$v}", ['survey_date' => '2026-11-05', 'findings' => 'ok', 'technical_recommendation' => 'ok', 'requires_drawing' => false,
            'requires_network_extension' => $extension, 'requires_feasibility_study' => false, 'network_distance_m' => 20, 'sr_length_m' => 28])->assertOk();
        $this->as($this->users['teknik'])->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => UploadedFile::fake()->createWithContent('foto.png', (string) base64_decode(self::PNG)), 'title' => 'Foto'], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->users['teknik'])->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();
        $this->as($this->users['manager'])->postJson("/api/surveys/{$s}/versions/{$v}/decisions", ['step' => 'ULP_MANAGER', 'decision' => 'APPROVED'])->assertOk();

        return $app;
    }

    /** A paid 1-phase application of the ULP: installed directly, no survey. */
    private function paid(int $powerVa = 1300): string
    {
        $app = $this->as($this->users['niaga'])->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulp->getKey(),
            'customer' => ['name' => 'Budi '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. B', 'new_power_value' => $powerVa, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->users['niaga'])->postJson("/api/applications/{$app}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        DB::table('applications')->where('id', $app)->update(['current_status' => 'PAID']);

        return $app;
    }

    private function contract(?string $vendor = null): void
    {
        $this->as($this->users['konstruksi'])->postJson('/api/sr-vendor-contracts', ['organizational_unit_id' => $this->ulp->getKey(), 'vendor_company_id' => $vendor ?? $this->contractor,
            'contract_number' => 'KTR-1PH', 'valid_from' => '2026-01-01'])->assertCreated();
    }

    private function plan(string $app, ?string $warehouse = null, array $over = [], string $by = 'niaga')
    {
        return $this->as($this->users[$by])->postJson("/api/applications/{$app}/sr-reservations", ['warehouse_id' => $warehouse ?? $this->ulpWarehouse] + $over);
    }

    private function stockFor(string $reservation, string $warehouse, float $quantity = 1000): void
    {
        $snapshot = (string) Str::uuid();
        DB::table('stock_snapshots')->insert(['id' => $snapshot, 'warehouse_id' => $warehouse, 'as_of' => '2026-01-02', 'created_by' => $this->users['konstruksi']->getKey(), 'created_at' => now()]);
        foreach (DB::table('sr_reservation_lines')->where('sr_reservation_id', $reservation)->pluck('khs_item_id') as $khs) {
            DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snapshot, 'khs_item_id' => $khs, 'on_hand' => $quantity]);
        }
    }

    /** @return array<string,array<string,mixed>> lines of the plan by KHS code */
    private function lines(string $reservation): array
    {
        return collect($this->as($this->users['niaga'])->getJson("/api/sr-reservations/{$reservation}")->assertOk()->json('data.lines'))->keyBy('khs_code')->all();
    }

    #[Test]
    public function the_phase_follows_the_pln_power_steps(): void
    {
        foreach ([450 => 1, 5500 => 1, 6600 => 3, 7700 => 1, 10600 => 3, 11000 => 1, 13200 => 3, 41500 => 3] as $va => $phase) {
            $this->assertSame($phase, SrReservationService::phaseOf($va), "{$va} VA");
        }
    }

    #[Test]
    public function a_one_phase_plan_takes_the_contracted_executor_and_the_bom_material_with_35_metres_of_cable(): void
    {
        $app = $this->paid();
        $this->plan($app)->assertStatus(409)->assertJsonFragment(['message' => 'ULP ini belum punya kontrak pelaksana 1 phasa yang berlaku hari ini.']);
        $this->contract();
        $this->plan($app, null, ['vendor_company_id' => $this->otherVendor])->assertStatus(409);

        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertOk()->assertJsonPath('data.0.application_id', $app)->assertJsonPath('data.0.default_vendor.id', $this->contractor);
        $id = $this->plan($app)->assertCreated()->json('data.id');

        $this->as($this->users['niaga'])->getJson("/api/sr-reservations/{$id}")->assertJsonPath('data.vendor.id', $this->contractor)->assertJsonPath('data.phase', 1)
            ->assertJsonPath('data.source_level', 'ULP')->assertJsonPath('data.sr_length_m', 35);
        $lines = $this->lines($id);
        $this->assertEquals(35, $lines['JTMR938']['quantity']);                  // SR cable: the planned length, not the factor of the BOM
        $this->assertEquals(1, $lines['JTMR949']['quantity']);                   // one meter
        $this->assertArrayNotHasKey('JTMR950', $lines);                          // a service line, no material
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertJsonPath('meta.total', 0);
        $this->plan($app)->assertStatus(409);                                    // one running plan per application
    }

    #[Test]
    public function a_one_phase_customer_needs_no_survey_but_must_have_paid_and_takes_only_ulp_stock(): void
    {
        $this->contract();
        $app = $this->paid();
        $this->plan($app, $this->up3Warehouse, [], 'konstruksi')->assertStatus(409)->assertJsonFragment(['message' => 'Sambungan 1 phasa hanya mengambil stok ULP: pilih gudang aktif milik ULP permohonan.']);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'APPROVED']);
        $this->plan($app)->assertStatus(409);

        DB::table('applications')->where('id', $app)->update(['current_status' => 'PK_PRINTED']);
        $this->as($this->users['niaga'])->postJson("/api/applications/{$app}/sr-reservations", [])->assertCreated();       // the only ULP warehouse is the default
        $this->plan($this->surveyed(extension: true))->assertStatus(409);                                                  // a survey that found an extension wins
    }

    #[Test]
    public function an_agenda_already_reserved_in_mims_is_marked_and_not_planned_again(): void
    {
        $this->contract();
        $reserved = $this->paid();
        $free = $this->paid();
        $agenda = DB::table('application_external_references')->where('application_id', $reserved)->where('reference_type', 'AGENDA')->value('reference_number');
        DB::table('mims_reservation_customers')->insert(['id' => (string) Str::uuid(), 'reservation_no' => 'R-77', 'agenda_no' => $agenda]);

        $rows = collect($this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertOk()->json('data'))->keyBy('application_id');
        $this->assertSame([true, ['R-77']], [$rows[$reserved]['already_reserved'], $rows[$reserved]['mims_reservation_numbers']]);
        $this->assertFalse($rows[$free]['already_reserved']);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending?reserved=0')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.application_id', $free);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending?reserved=1')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.application_id', $reserved);
        $this->plan($reserved)->assertStatus(409)->assertJsonFragment(['message' => 'Nomor agenda ini sudah punya reservasi di MIMS (R-77): tidak direservasi dua kali.']);
    }

    #[Test]
    public function many_one_phase_plans_are_made_approved_and_numbered_at_once_and_each_failure_stays_its_own(): void
    {
        $this->contract();
        [$a, $b] = [$this->paid(), $this->paid()];
        $unpaid = $this->paid();
        DB::table('applications')->where('id', $unpaid)->update(['current_status' => 'APPROVED']);

        $made = $this->as($this->users['niaga'])->postJson('/api/sr-reservations/batch', ['application_ids' => [$a, $b, $unpaid]])->assertOk()->assertJsonPath('summary', ['succeeded' => 2, 'failed' => 1]);
        $ids = collect($made->json('data'))->where('ok', true)->pluck('id')->values()->all();
        $this->stockFor($ids[0], $this->ulpWarehouse);
        $act = fn (array $body) => $this->as($this->users['niaga'])->postJson('/api/sr-reservations/batch-actions', ['ids' => $ids] + $body)->assertOk()->assertJsonPath('summary.succeeded', 2);
        $act(['action' => 'submit']);
        $act(['action' => 'approve']);
        $act(['action' => 'mims', 'reservation_no' => '900555']);

        $this->assertSame(2, DB::table('sr_reservations')->where('status', 'RECORDED')->where('mims_reservation_no', '900555')->count());
        $this->as($this->users['konstruksi'])->postJson('/api/sr-reservations/batch-actions', ['ids' => $ids, 'action' => 'mims', 'reservation_no' => '1'])->assertJsonPath('summary.failed', 2);
    }

    #[Test]
    public function teknik_reports_that_the_connection_needs_an_extension_and_a_survey_can_then_start_while_the_reserved_material_stays(): void
    {
        $this->contract();
        $app = $this->paid();
        $id = $this->plan($app)->assertCreated()->json('data.id');
        $this->stockFor($id, $this->ulpWarehouse);
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/submit")->assertOk();
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'APPROVE'])->assertOk();
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CONNECTION_IN_PROGRESS']);
        $survey = fn () => $this->as($this->users['manager'])->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->users['teknik']->getKey()]);
        $survey()->assertStatus(409);                                              // connection in progress: closed until a finding opens it
        $report = fn (string $by) => $this->as($this->users[$by])->postJson("/api/applications/{$app}/sr-extension", ['reason' => 'jarak ke tiang 120 m', 'distance_m' => 120]);

        $report('niaga')->assertForbidden();
        $report('teknik')->assertCreated();
        $report('teknik')->assertStatus(409);

        $survey()->assertCreated();
        $this->assertSame('APPROVED', DB::table('sr_reservations')->where('id', $id)->value('status'));
        $this->assertEquals(1, SrReservationService::reservedFor($app)[$this->khs('JTMR949')]);
        $this->as($this->users['niaga'])->getJson("/api/applications/{$app}/sr-reservations")->assertJsonPath('data.extension_finding.distance_m', 120);
    }

    #[Test]
    public function a_finding_marked_by_mistake_is_withdrawn_unless_extension_work_already_followed(): void
    {
        $this->contract();
        $app = $this->paid();
        $url = "/api/applications/{$app}/sr-extension";
        $report = fn () => $this->as($this->users['teknik'])->postJson($url, ['reason' => 'jaringan jauh']);
        $withdraw = fn (string $by = 'teknik') => $this->as($this->users[$by])->postJson("{$url}/cancel", ['reason' => 'salah pelanggan']);

        $withdraw()->assertStatus(409);
        $report()->assertCreated();
        $withdraw('niaga')->assertForbidden();
        $withdraw()->assertOk();
        $this->plan($app)->assertCreated();                                        // back on the direct path

        $report()->assertCreated();                                                // can be marked again
        $this->as($this->users['manager'])->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->users['teknik']->getKey()])->assertCreated();
        $withdraw()->assertStatus(409);
        $this->assertSame(1, DB::table('sr_extension_findings')->where('application_id', $app)->whereNull('cancelled_at')->count());
    }

    #[Test]
    public function a_paid_one_phase_customer_is_ready_to_install_without_survey_until_a_finding_says_otherwise(): void
    {
        $direct = $this->paid();
        $threePhase = $this->paid(powerVa: 6600);
        $ready = fn () => collect($this->as($this->users['niaga'])->getJson('/api/applications?ready_to_install=1&per_page=100')->assertOk()->json('data'))->pluck('id')->all();
        $detail = fn (string $id) => $this->as($this->users['niaga'])->getJson("/api/applications/{$id}")->assertOk();

        $this->assertSame([$direct], $ready());
        $detail($direct)->assertJsonPath('data.ready_to_install', true)->assertJsonPath('data.survey_required', false);
        $detail($threePhase)->assertJsonPath('data.ready_to_install', false)->assertJsonPath('data.survey_required', true);

        $this->as($this->users['teknik'])->postJson("/api/applications/{$direct}/sr-extension", ['reason' => 'jaringan jauh'])->assertCreated();

        $this->assertSame([], $ready());
        $detail($direct)->assertJsonPath('data.ready_to_install', false)->assertJsonPath('data.survey_required', true)->assertJsonPath('data.extension_finding', true);
    }

    #[Test]
    public function reports_do_not_expect_a_survey_from_a_one_phase_customer(): void
    {
        $direct = $this->paid();
        $threePhase = $this->paid(powerVa: 6600);
        DB::table('applications')->whereIn('id', [$direct, $threePhase])->update(['created_at' => now()->subDays(10)]);

        $rows = collect(app(ReportService::class)->sla([$this->ulp->getKey()], null, null)['rows'])->keyBy('id');

        $this->assertSame(['Penyambungan', 'Survei Lapangan'], [$rows[$direct]['current_stage'], $rows[$threePhase]['current_stage']]);
        $this->assertSame(['LAYANAN', 'UMUM'], [$rows[$direct]['sla_basis'], $rows[$threePhase]['sla_basis']]);
    }

    #[Test]
    public function a_one_phase_connection_has_four_working_days_and_the_old_backlog_is_listed_but_not_announced(): void
    {
        config(['distriva.sr_reservation.sla_since' => now()->subDays(20)->toDateString()]);
        [$fresh, $late, $backlog, $oldDone] = [$this->paid(), $this->paid(), $this->paid(), $this->paid()];
        DB::table('applications')->where('id', $fresh)->update(['paid_at' => now()]);
        DB::table('applications')->where('id', $late)->update(['paid_at' => now()->subDays(15)]);
        DB::table('applications')->where('id', $backlog)->update(['paid_at' => now()->subDays(60)]);
        DB::table('applications')->where('id', $oldDone)->update(['paid_at' => now()->subDays(60), 'current_status' => 'CONNECTION_DONE']);

        $rows = app(ServiceSlaService::class)->compute([$fresh, $late, $backlog, $oldDone]);

        $this->assertSame(['LAYANAN_TANPA_PERLUASAN', 4], [$rows[$fresh]['category'], $rows[$fresh]['working_days']]);
        $this->assertContains($rows[$fresh]['status'], ['ON_TRACK', 'DUE_SOON']);
        $this->assertSame(['OVERDUE', true], [$rows[$late]['status'], $rows[$late]['announce']]);
        $this->assertSame(['OVERDUE', false], [$rows[$backlog]['status'], $rows[$backlog]['announce']]);
        $this->assertArrayNotHasKey($oldDone, $rows);                              // connected before the rule: not judged by it
    }

    #[Test]
    public function a_finding_cancels_a_plan_that_has_not_been_approved_and_is_refused_for_three_phase(): void
    {
        $this->contract();
        $app = $this->paid();
        $id = $this->plan($app)->assertCreated()->json('data.id');
        $report = fn (string $application) => $this->as($this->users['teknik'])->postJson("/api/applications/{$application}/sr-extension", ['reason' => 'jaringan jauh']);

        $report($app)->assertCreated();
        $report($this->paid(powerVa: 6600))->assertStatus(409);

        $this->assertSame('CANCELLED', DB::table('sr_reservations')->where('id', $id)->value('status'));
        $this->plan($app)->assertStatus(409);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending?phase=1')->assertJsonPath('meta.total', 0);
    }

    #[Test]
    public function a_three_phase_plan_needs_a_chosen_executor(): void
    {
        $this->importBom(['group' => 'PBPD_6_41', 'source' => 'uji', 'inputs' => [], 'lines' => [['sequence' => 10, 'khs_code' => 'JTMR764', 'description' => 'Kabel SR 3 phasa', 'H' => '1*20', 'source' => 'uji']]]);
        $app = $this->surveyed(powerVa: 6600);

        $this->plan($app)->assertStatus(409)->assertJsonFragment(['message' => 'Sambungan 3 phasa: pelaksana wajib dipilih.']);
        $this->plan($app, null, ['vendor_company_id' => $this->vendor('TIANG')])->assertStatus(409);
        $id = $this->plan($app, null, ['vendor_company_id' => $this->otherVendor, 'sr_length_m' => 42])->assertCreated()->json('data.id');

        $this->assertEquals(42, $this->lines($id)['JTMR764']['quantity']);
    }

    #[Test]
    public function corrections_need_a_reason_and_a_new_cable_length_replaces_the_cable_quantity(): void
    {
        $this->contract();
        $id = $this->plan($this->paid())->assertCreated()->json('data.id');
        $put = fn (array $body) => $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", $body);

        $put(['corrections' => [['khs_code' => 'JTMR949', 'quantity' => 2]]])->assertStatus(409);
        $put(['corrections' => [['khs_code' => 'JTMR949', 'quantity' => 2, 'reason' => 'meter cadangan']], 'sr_length_m' => 50])->assertOk();

        $lines = $this->lines($id);
        $this->assertSame([2, 'meter cadangan'], [(int) $lines['JTMR949']['quantity'], $lines['JTMR949']['correction_reason']]);
        $this->assertEquals([50, 50], [$lines['JTMR938']['quantity_bom'], $lines['JTMR938']['quantity']]);
    }

    #[Test]
    public function niaga_of_the_ulp_alone_prepares_approves_and_records_a_ulp_warehouse_plan_and_the_stock_is_held(): void
    {
        $this->contract();
        $app = $this->paid();
        $this->plan($app, null, [], 'konstruksi')->assertForbidden();
        $this->plan($app, null, [], 'niagaLain')->assertNotFound();
        $id = $this->plan($app)->assertCreated()->json('data.id');
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/mims", ['reservation_no' => '900123'])->assertStatus(409);   // not approved yet
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/submit")->assertOk();
        $approve = fn () => $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'APPROVE']);
        $approve()->assertStatus(409);                                           // no stock recorded for the warehouse
        $this->stockFor($id, $this->ulpWarehouse, 100);
        $approve()->assertOk();

        $cable = $this->khs('JTMR938');
        $this->assertEquals(65, app(StockService::class)->position([$this->ulpWarehouse], now()->toDateString())[$cable]['available']);
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/mims", ['reservation_no' => '900123'])->assertOk();
        $this->as($this->users['niaga'])->getJson("/api/sr-reservations/{$id}")->assertJsonPath('data.status', 'RECORDED')->assertJsonPath('data.mims_reservation_no', '900123');

        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/cancel", ['reason' => 'batal pasang'])->assertOk();
        $this->assertEquals(100, app(StockService::class)->position([$this->ulpWarehouse], now()->toDateString())[$cable]['available']);
    }

    #[Test]
    public function a_up3_warehouse_plan_is_prepared_by_konstruksi_and_approved_by_the_asman(): void
    {
        $this->importBom(['group' => 'PBPD_6_41', 'source' => 'uji', 'inputs' => [], 'lines' => [['sequence' => 10, 'khs_code' => 'JTMR764', 'description' => 'Kabel SR 3 phasa', 'H' => '1*20', 'source' => 'uji']]]);
        $app = $this->surveyed(powerVa: 6600);
        $vendor = ['vendor_company_id' => $this->otherVendor];
        $this->plan($app, $this->up3Warehouse, $vendor)->assertForbidden();
        $id = $this->plan($app, $this->up3Warehouse, $vendor, 'konstruksi')->assertCreated()->json('data.id');
        $this->stockFor($id, $this->up3Warehouse);
        $this->as($this->users['konstruksi'])->postJson("/api/sr-reservations/{$id}/submit")->assertOk();
        $this->as($this->users['konstruksi'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'APPROVE'])->assertForbidden();
        $this->as($this->users['niaga'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'APPROVE'])->assertForbidden();

        $this->as($this->users['asman'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'RETURN'])->assertStatus(409);
        $this->as($this->users['asman'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'RETURN', 'reason' => 'periksa kabel'])->assertOk();
        $this->as($this->users['konstruksi'])->postJson("/api/sr-reservations/{$id}/submit")->assertOk();
        $this->as($this->users['asman'])->postJson("/api/sr-reservations/{$id}/decision", ['decision' => 'APPROVE'])->assertOk();

        $this->as($this->users['asman'])->getJson("/api/sr-reservations/{$id}")->assertJsonPath('data.status', 'APPROVED');
    }

    #[Test]
    public function one_ulp_cannot_hold_two_contracts_on_the_same_date(): void
    {
        $this->contract();

        $this->as($this->users['konstruksi'])->postJson('/api/sr-vendor-contracts', ['organizational_unit_id' => $this->ulp->getKey(), 'vendor_company_id' => $this->otherVendor,
            'contract_number' => 'KTR-2', 'valid_from' => '2026-06-01'])->assertStatus(409);
        $this->as($this->users['niaga'])->postJson('/api/sr-vendor-contracts', ['organizational_unit_id' => $this->ulp->getKey(), 'vendor_company_id' => $this->otherVendor,
            'contract_number' => 'KTR-3', 'valid_from' => '2027-06-01'])->assertForbidden();
    }
}
