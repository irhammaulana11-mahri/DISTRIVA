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

    /** @param string|list<string> $apps */
    private function plan(string|array $apps, ?string $warehouse = null, array $over = [], string $by = 'niaga')
    {
        return $this->as($this->users[$by])->postJson('/api/sr-reservations', ['application_ids' => (array) $apps, 'warehouse_id' => $warehouse ?? $this->ulpWarehouse] + $over);
    }

    private function stockFor(string $reservation, string $warehouse, float $quantity = 1000): void
    {
        $snapshot = (string) Str::uuid();
        DB::table('stock_snapshots')->insert(['id' => $snapshot, 'warehouse_id' => $warehouse, 'as_of' => '2026-01-02', 'created_by' => $this->users['konstruksi']->getKey(), 'created_at' => now()]);
        foreach (DB::table('sr_reservation_lines')->where('sr_reservation_id', $reservation)->pluck('khs_item_id') as $khs) {
            DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snapshot, 'khs_item_id' => $khs, 'on_hand' => $quantity]);
        }
    }

    /** @return array<string,array<string,mixed>> lines of the reservation by KHS code */
    private function lines(string $reservation): array
    {
        return collect($this->detail($reservation)['lines'])->keyBy('khs_code')->all();
    }

    /** @return array<string,mixed> */
    private function detail(string $reservation): array
    {
        return $this->as($this->users['niaga'])->getJson("/api/sr-reservations/{$reservation}")->assertOk()->json('data');
    }

    private function act(string $reservation, string $action, array $body = [], string $by = 'niaga')
    {
        return $this->as($this->users[$by])->postJson("/api/sr-reservations/{$reservation}/{$action}", $body);
    }

    /** A requested reservation of the given applications, with stock. */
    private function requested(array $apps): string
    {
        $id = $this->plan($apps)->assertCreated()->json('data.id');
        $this->stockFor($id, $this->ulpWarehouse);
        $this->act($id, 'request', ['reservation_no' => '900123'])->assertOk();

        return $id;
    }

    private function realize(string $reservation, array $items)
    {
        return $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$reservation}/realization", ['items' => $items]);
    }

    /** What one 1-phase agenda realises: one meter, one MCB, its cable. */
    private function realised(string $app, string $suffix, float $cable = 35, array $seals = []): array
    {
        return ['application_id' => $app, 'cable_m' => $cable, 'seals' => $seals, 'serials' => [['khs_code' => 'JTMR949', 'serial_number' => "KWH-{$suffix}"], ['khs_code' => 'JTMR826', 'serial_number' => "MCB-{$suffix}"]]];
    }

    #[Test]
    public function the_phase_follows_the_pln_power_steps(): void
    {
        foreach ([450 => 1, 5500 => 1, 6600 => 3, 7700 => 1, 10600 => 3, 11000 => 1, 13200 => 3, 41500 => 3] as $va => $phase) {
            $this->assertSame($phase, SrReservationService::phaseOf($va), "{$va} VA");
        }
    }

    #[Test]
    public function one_reservation_holds_many_agendas_with_totals_per_material_and_the_contracted_executor(): void
    {
        [$a, $b] = [$this->paid(), $this->paid()];
        $this->plan([$a, $b])->assertStatus(409)->assertJsonFragment(['message' => 'ULP ini belum punya kontrak pelaksana 1 phasa yang berlaku hari ini.']);
        $this->contract();
        $this->plan([$a, $b], null, ['vendor_company_id' => $this->otherVendor])->assertStatus(409);

        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertOk()->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.default_vendor.id', $this->contractor);
        $id = $this->plan([$a, $b])->assertCreated()->json('data.id');

        $detail = $this->detail($id);
        $this->assertSame([$this->contractor, 'DRAFT', 2, 'ULP', 35], [$detail['vendor']['id'], $detail['status'], $detail['applications_count'], $detail['source_level'], (int) $detail['sr_length_m']]);
        $lines = $this->lines($id);
        $this->assertEquals(70, $lines['JTMR938']['quantity']);                  // SR cable: 35 m per customer
        $this->assertEquals(2, $lines['JTMR949']['quantity']);                   // one meter each
        $this->assertArrayNotHasKey('JTMR950', $lines);                          // a service line, no material
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertJsonPath('meta.total', 0);
        $this->plan($a)->assertStatus(409);                                      // one running reservation per application
    }

    #[Test]
    public function agendas_of_another_phase_or_unfit_ones_stop_the_whole_reservation(): void
    {
        $this->contract();
        $good = $this->paid();
        $unpaid = $this->paid();
        DB::table('applications')->where('id', $unpaid)->update(['current_status' => 'APPROVED']);

        $this->plan([$good, $this->paid(powerVa: 6600)])->assertStatus(409)->assertJsonFragment(['message' => 'Satu reservasi tidak boleh mencampur sambungan 1 phasa dan 3 phasa.']);
        $this->plan([$good, $unpaid])->assertStatus(409);
        $this->plan([$good], $this->up3Warehouse, [], 'konstruksi')->assertStatus(409)->assertJsonFragment(['message' => 'Sambungan 1 phasa hanya mengambil stok ULP: pilih gudang aktif milik ULP permohonan.']);

        $this->assertSame(0, DB::table('sr_reservations')->count());
    }

    #[Test]
    public function an_agenda_already_reserved_in_mims_is_marked_and_not_reserved_again(): void
    {
        $this->contract();
        $reserved = $this->paid();
        $free = $this->paid();
        $agenda = DB::table('application_external_references')->where('application_id', $reserved)->where('reference_type', 'AGENDA')->value('reference_number');
        DB::table('mims_reservation_customers')->insert(['id' => (string) Str::uuid(), 'reservation_no' => 'R-77', 'agenda_no' => $agenda]);

        $rows = collect($this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertOk()->json('data'))->keyBy('application_id');
        $this->assertSame([true, ['R-77']], [$rows[$reserved]['already_reserved'], $rows[$reserved]['mims_reservation_numbers']]);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending?reserved=0')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.application_id', $free);
        $this->plan($reserved)->assertStatus(409);
        $this->plan($this->surveyed(extension: true))->assertStatus(409);         // a survey that found an extension wins
    }

    #[Test]
    public function a_three_phase_reservation_needs_a_chosen_executor(): void
    {
        $this->importBom(['group' => 'PBPD_6_41', 'source' => 'uji', 'inputs' => [], 'lines' => [['sequence' => 10, 'khs_code' => 'JTMR764', 'description' => 'Kabel SR 3 phasa', 'H' => '1*20', 'source' => 'uji']]]);
        $app = $this->surveyed(powerVa: 6600);

        $this->plan($app)->assertStatus(409)->assertJsonFragment(['message' => 'Sambungan 3 phasa: pelaksana wajib dipilih.']);
        $this->plan($app, null, ['vendor_company_id' => $this->vendor('TIANG')])->assertStatus(409);
        $this->plan($app, $this->up3Warehouse, ['vendor_company_id' => $this->otherVendor])->assertForbidden();      // a UP3 warehouse is Konstruksi's
        $id = $this->plan($app, $this->up3Warehouse, ['vendor_company_id' => $this->otherVendor, 'sr_length_m' => 42], 'konstruksi')->assertCreated()->json('data.id');

        $this->assertEquals(42, $this->lines($id)['JTMR764']['quantity']);
    }

    #[Test]
    public function totals_follow_the_agendas_while_a_typed_correction_keeps_its_difference(): void
    {
        $this->contract();
        [$a, $b, $c] = [$this->paid(), $this->paid(), $this->paid()];
        $id = $this->plan([$a, $b])->assertCreated()->json('data.id');
        $put = fn (array $body) => $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", $body);
        $put(['corrections' => [['khs_code' => 'JTMR949', 'quantity' => 3]]])->assertStatus(409);
        $put(['corrections' => [['khs_code' => 'JTMR949', 'quantity' => 3, 'reason' => 'meter cadangan']]])->assertOk();

        $put(['add_application_ids' => [$c], 'sr_length_m' => 40])->assertOk();
        $this->assertEquals([4, 120], [$this->lines($id)['JTMR949']['quantity'], $this->lines($id)['JTMR938']['quantity']]);
        $this->act($id, "applications/{$a}/remove", [])->assertStatus(422);
        $this->act($id, "applications/{$a}/remove", ['reason' => 'batal pasang'])->assertOk();

        $this->assertEquals([3, 80], [$this->lines($id)['JTMR949']['quantity'], $this->lines($id)['JTMR938']['quantity']]);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending')->assertJsonPath('data.0.application_id', $a);
        $this->act($id, "applications/{$b}/remove", ['reason' => 'x'])->assertOk();
        $this->act($id, "applications/{$c}/remove", ['reason' => 'x'])->assertStatus(409);        // the last one: cancel instead
    }

    #[Test]
    public function the_request_number_holds_the_stock_without_any_approval(): void
    {
        $this->contract();
        [$a, $b] = [$this->paid(), $this->paid()];
        $this->plan([$a, $b], null, [], 'konstruksi')->assertForbidden();
        $this->plan([$a, $b], null, [], 'niagaLain')->assertNotFound();
        $id = $this->plan([$a, $b])->assertCreated()->json('data.id');
        $this->act($id, 'request', ['reservation_no' => '900123'])->assertStatus(409);             // no stock recorded for the warehouse
        $this->stockFor($id, $this->ulpWarehouse, 100);
        $this->act($id, 'request', ['reservation_no' => '900123'])->assertOk();

        $cable = $this->khs('JTMR938');
        $available = fn (): float => app(StockService::class)->position([$this->ulpWarehouse], now()->toDateString())[$cable]['available'];
        $this->assertEquals(30, $available());
        $this->assertSame('REQUESTED', $this->detail($id)['status']);
        $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", ['sr_length_m' => 20])->assertStatus(409);
        $this->act($id, 'cancel', ['reason' => 'batal'])->assertOk();
        $this->assertEquals(100, $available());
    }

    #[Test]
    public function sap_takes_the_reservation_only_when_every_agenda_is_complete_and_the_totals_equal_what_was_used(): void
    {
        $this->contract();
        [$a, $b] = [$this->paid(), $this->paid()];
        $id = $this->requested([$a, $b]);
        $this->act($id, 'sap')->assertStatus(409);
        $this->realize($id, [$this->realised($a, '1', 30, ['S-1']), $this->realised($b, '2', 32, ['S-2'])])->assertOk();

        $this->act($id, 'sap')->assertStatus(409);                                                   // cable: 70 reserved, 62 used
        $blockers = $this->detail($id)['sap_blockers'];
        $this->assertSame(['KHS JTMR938: total reservasi 70, realisasi 62. Samakan totalnya.'], $blockers);
        $this->act($id, 'match')->assertOk();
        $this->assertEquals(62, $this->lines($id)['JTMR938']['quantity']);
        $this->assertSame('Disamakan dengan realisasi per agenda', $this->lines($id)['JTMR938']['correction_reason']);
        $this->act($id, 'sap', ['sap_reference' => 'SAP-1'])->assertOk();

        $this->assertSame(['SAP_SENT', 'SAP-1'], [$this->detail($id)['status'], $this->detail($id)['sap_reference']]);
        $this->assertEquals(30, SrReservationService::reservedFor($a)[$this->khs('JTMR938')]);       // what was really used
        $this->act($id, 'cancel', ['reason' => 'x'])->assertStatus(409);
    }

    #[Test]
    public function serial_and_seal_numbers_are_not_used_twice_and_only_meters_and_mcbs_have_serials(): void
    {
        $this->contract();
        [$a, $b] = [$this->paid(), $this->paid()];
        $id = $this->requested([$a, $b]);
        $this->realize($id, [$this->realised($a, '1', 35, ['S-1'])])->assertOk();

        $this->realize($id, [$this->realised($b, '1')])->assertStatus(409)->assertJsonFragment(['message' => 'Nomor seri KWH-1 sudah dipakai.']);
        $this->realize($id, [['application_id' => $b, 'seals' => ['S-1']]])->assertStatus(409);
        $this->realize($id, [['application_id' => $b, 'serials' => [['khs_code' => 'JTMR944', 'serial_number' => 'X']]]])->assertStatus(409);

        $this->assertSame([], collect($this->detail($id)['applications'])->firstWhere('application_id', $b)['serials']);
    }

    #[Test]
    public function teknik_reports_that_the_connection_needs_an_extension_and_a_survey_can_then_start_while_the_reserved_material_stays(): void
    {
        $this->contract();
        $app = $this->paid();
        $id = $this->requested([$app]);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CONNECTION_IN_PROGRESS']);
        $survey = fn () => $this->as($this->users['manager'])->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->users['teknik']->getKey()]);
        $survey()->assertStatus(409);                                              // connection in progress: closed until a finding opens it
        $report = fn (string $by) => $this->as($this->users[$by])->postJson("/api/applications/{$app}/sr-extension", ['reason' => 'jarak ke tiang 120 m', 'distance_m' => 120]);

        $report('niaga')->assertForbidden();
        $report('teknik')->assertCreated();
        $report('teknik')->assertStatus(409);

        $survey()->assertCreated();
        $this->assertSame('REQUESTED', DB::table('sr_reservations')->where('id', $id)->value('status'));
        $this->assertEquals(1, SrReservationService::reservedFor($app)[$this->khs('JTMR949')]);
        $this->as($this->users['niaga'])->getJson("/api/applications/{$app}/sr-reservations")->assertJsonPath('data.extension_finding.distance_m', 120)->assertJsonPath('data.reservations.0.id', $id);
    }

    #[Test]
    public function a_finding_takes_the_agenda_out_of_a_draft_and_is_refused_for_three_phase(): void
    {
        $this->contract();
        [$a, $b] = [$this->paid(), $this->paid()];
        $id = $this->plan([$a, $b])->assertCreated()->json('data.id');
        $report = fn (string $application) => $this->as($this->users['teknik'])->postJson("/api/applications/{$application}/sr-extension", ['reason' => 'jaringan jauh']);

        $report($a)->assertCreated();
        $this->assertSame([1, 'DRAFT'], [$this->detail($id)['applications_count'], $this->detail($id)['status']]);
        $report($b)->assertCreated();
        $this->assertSame('CANCELLED', $this->detail($id)['status']);
        $report($this->paid(powerVa: 6600))->assertStatus(409);
        $this->plan($a)->assertStatus(409);
        $this->as($this->users['niaga'])->getJson('/api/sr-reservations/pending?phase=1')->assertJsonPath('meta.total', 0);
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

    /** Maps two ERP numbers to the MCB and one to the cable, with stock per number in the ULP warehouse. */
    private function erpNumbers(): void
    {
        foreach (['3250050' => 'JTMR826', '3250052' => 'JTMR826', '2190224' => 'JTMR938'] as $no => $code) {
            DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $this->khs($code), 'material_no' => (string) $no, 'created_by' => $this->users['konstruksi']->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function numberStock(array $quantities): void
    {
        $snapshot = DB::table('stock_snapshots')->where('warehouse_id', $this->ulpWarehouse)->value('id');
        foreach ($quantities as $no => $quantity) {
            DB::table('stock_snapshot_materials')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snapshot, 'material_no' => (string) $no, 'material_name' => "Material {$no}", 'unit' => 'BH', 'stock_ready' => $quantity]);
        }
    }

    #[Test]
    public function the_sap_material_numbers_are_chosen_per_line_and_must_cover_the_total_from_stock(): void
    {
        $this->contract();
        $this->erpNumbers();
        $id = $this->plan([$this->paid(), $this->paid()])->assertCreated()->json('data.id');
        $this->stockFor($id, $this->ulpWarehouse);
        $this->numberStock(['3250050' => 1, '3250052' => 5, '2190224' => 500]);
        $request = fn () => $this->act($id, 'request', ['reservation_no' => '900123']);
        $choose = fn (array $items) => $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", ['materials' => [['khs_code' => 'JTMR826', 'items' => $items]]]);

        $this->assertSame([['material_no' => '2190224', 'quantity' => 70]], $this->lines($id)['JTMR938']['materials']);       // only one number: nothing to choose
        $this->assertSame(['3250050', '3250052'], array_column($this->lines($id)['JTMR826']['material_options'], 'material_no'));
        $request()->assertStatus(409)->assertJsonFragment(['message' => 'KHS JTMR826: pilih nomor material SAP; terpilih 0 dari 2.']);
        $choose([['material_no' => '9999999', 'quantity' => 2]])->assertStatus(409);
        $choose([['material_no' => '3250050', 'quantity' => 2]])->assertOk();
        $request()->assertStatus(409)->assertJsonFragment(['message' => 'Stok gudang tidak cukup. Nomor 3250050: butuh 2, tersedia 1.']);
        $choose([['material_no' => '3250050', 'quantity' => 1], ['material_no' => '3250052', 'quantity' => 1]])->assertOk();
        $request()->assertOk();

        $this->assertEquals([1, 1], array_column($this->lines($id)['JTMR826']['materials'], 'quantity'));
    }

    #[Test]
    public function with_several_numbers_each_serial_names_its_number_and_the_split_follows_the_serials(): void
    {
        $this->contract();
        $this->erpNumbers();
        [$a, $b] = [$this->paid(), $this->paid()];
        $id = $this->plan([$a, $b])->assertCreated()->json('data.id');
        $this->stockFor($id, $this->ulpWarehouse);
        $this->numberStock(['3250050' => 5, '3250052' => 5, '2190224' => 500]);
        $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", ['materials' => [['khs_code' => 'JTMR826', 'items' => [['material_no' => '3250050', 'quantity' => 2]]]]])->assertOk();
        $this->act($id, 'request', ['reservation_no' => '900123'])->assertOk();
        $this->as($this->users['niaga'])->putJson("/api/sr-reservations/{$id}", ['materials' => [['khs_code' => 'JTMR826', 'items' => [['material_no' => '3250050', 'quantity' => 1], ['material_no' => '3250052', 'quantity' => 1]]]]])->assertOk();
        $item = fn (string $app, string $n, ?string $number) => ['application_id' => $app, 'cable_m' => 35, 'seals' => ["S-{$n}"],
            'serials' => [['khs_code' => 'JTMR949', 'serial_number' => "KWH-{$n}"], ['khs_code' => 'JTMR826', 'serial_number' => "MCB-{$n}", 'material_no' => $number]]];

        $this->realize($id, [$item($a, '1', null), $item($b, '2', '3250052')])->assertOk();
        $this->act($id, 'sap')->assertStatus(409)->assertJsonFragment(['message' => 'KHS JTMR826: tiap nomor seri harus menyebut nomor materialnya.']);
        $this->realize($id, [$item($a, '1', '3250052')])->assertOk();
        $this->act($id, 'sap')->assertStatus(409);                                  // chosen 1 + 1, used 0 + 2
        $this->act($id, 'match')->assertOk();

        $this->assertSame([['material_no' => '3250052', 'quantity' => 2]], $this->lines($id)['JTMR826']['materials']);
        $this->act($id, 'sap')->assertOk();
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
    public function one_ulp_cannot_hold_two_contracts_on_the_same_date(): void
    {
        $this->contract();

        $this->as($this->users['konstruksi'])->postJson('/api/sr-vendor-contracts', ['organizational_unit_id' => $this->ulp->getKey(), 'vendor_company_id' => $this->otherVendor,
            'contract_number' => 'KTR-2', 'valid_from' => '2026-06-01'])->assertStatus(409);
        $this->as($this->users['niaga'])->postJson('/api/sr-vendor-contracts', ['organizational_unit_id' => $this->ulp->getKey(), 'vendor_company_id' => $this->otherVendor,
            'contract_number' => 'KTR-3', 'valid_from' => '2027-06-01'])->assertForbidden();
    }
}
