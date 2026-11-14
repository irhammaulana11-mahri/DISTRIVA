<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Bom\BomCalculator;
use App\Services\Forecast\ForecastService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class ForecastTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $planner;

    private User $asman;

    private User $teknikA;

    private User $teknikB;

    private User $vendor;

    private User $up3Manager;

    /** @var array<string,string> */
    private array $sub = [];

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->planner = $mk('PERENCANAAN', $this->up3);
        $this->asman = $mk('ASMAN_PERENCANAAN', $this->up3);
        $this->up3Manager = $mk('UP3_MANAGER', $this->up3);
        $this->teknikA = $mk('TEKNIK', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->vendor = $mk('VENDOR', $this->ulpA);
        foreach ([['A1', $this->ulpA], ['A2', $this->ulpA], ['A3', $this->ulpA], ['B1', $this->ulpB]] as [$code, $unit]) {
            $this->sub[$code] = (string) Str::uuid();
            DB::table('substations')->insert(['id' => $this->sub[$code], 'code' => "G-{$code}", 'name' => "Gardu {$code}", 'organizational_unit_id' => $unit->getKey(), 'feeder_code' => 'PNY1', 'capacity_kva' => 100,
                'transformer_count' => 1, 'ownership' => 'PLN', 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->dir = sys_get_temp_dir().'/forecast-test-'.Str::random(6);
        File::makeDirectory($this->dir);
        config(['distriva.forecast.detach' => false]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->dir);
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function item(string $code, float $last, float $h1, float $h3, float $h5, ?float $p90h3 = null): array
    {
        $q = fn (float $p50) => ['p10' => round($p50 - 0.1, 4), 'p50' => $p50, 'p90' => round($p50 + 0.1, 4)];
        $horizons = ['1' => $q($h1), '3' => $q($h3), '5' => $q($h5)];
        $p90h3 !== null && $horizons['3']['p90'] = $p90h3;

        return ['substation_id' => $this->sub[$code], 'capacity_kva' => 100.0, 'last_reading_on' => '2026-09-01', 'last_ratio' => $last, 'history_readings' => 5, 'stale' => $code === 'A3', 'horizons' => $horizons,
            'exceed_80' => ['state' => 'none', 'date' => null], 'exceed_100' => $last >= 1 ? ['state' => 'already', 'date' => '2026-09-01'] : ['state' => 'forecast', 'date' => '2028-03-01']];
    }

    /** @return array<string,mixed> */
    private function payload(): array
    {
        return ['model' => ['name' => 'GRU-kuantil (ansambel)', 'version' => '1', 'seeds' => 3], 'window' => ['first_reading' => '2022-01-02', 'last_reading' => '2026-11-09'],
            'counts' => ['substations' => 4, 'forecast_substations' => 4, 'samples' => 100, 'train' => 60, 'validation' => 20, 'test' => 20], 'seconds' => 12.5,
            'metrics' => ['all' => ['n' => 20, 'mae_pp' => 11.9, 'wape' => 0.22, 'bias_pp' => 1.2, 'coverage_p10_p90' => 0.8, 'persistence_mae_pp' => 12.8], 'by_horizon' => []],
            'results' => [$this->item('A1', 1.1, 1.15, 1.2, 1.3), $this->item('A2', 0.8, 0.9, 1.05, 1.1), $this->item('A3', 0.6, 0.7, 0.8, 1.02), $this->item('B1', 0.5, 0.5, 0.55, 0.6)]];
    }

    private function storedRun(): string
    {
        $id = $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202)->json('data.id');
        app(ForecastService::class)->store($id, $this->payload());

        return $id;
    }

    /** A stand-in for the Python service: checks the exported CSVs and writes a ready result (or fails like the real one does). */
    private function stub(bool $fail = false): void
    {
        File::put("{$this->dir}/result.json", json_encode($this->payload()));
        File::put("{$this->dir}/stub.sh", $fail ? "#!/bin/sh\necho 'ERROR: Data pembacaan terlalu sedikit untuk melatih model (latih 3, validasi 1).' >&2\nexit 2\n" : <<<'SH'
#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in --readings) R="$2";; --substations) S="$2";; --out) O="$2";; esac; shift; done
[ -s "$R" ] && [ -s "$S" ] || exit 3
cp "$(dirname "$0")/result.json" "$O"
SH);
        config(['distriva.forecast.python' => '/bin/sh', 'distriva.forecast.script' => "{$this->dir}/stub.sh"]);
    }

    #[Test]
    public function the_forecast_keys_are_granted_to_the_intended_roles_only(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'], $holders('forecast.run'));
        $this->assertSame(['ASMAN_PERENCANAAN', 'SYS_ADMIN', 'UP3_MANAGER'], $holders('forecast.review'));
        $this->assertContains('TEKNIK', $holders('forecast.view'));
        $this->assertNotContains('VENDOR', $holders('forecast.view'));
    }

    #[Test]
    public function a_run_exports_the_data_calls_the_service_and_stores_the_forecast_with_its_model_window_and_metrics(): void
    {
        DB::table('substation_readings')->insert(['id' => (string) Str::uuid(), 'substation_id' => $this->sub['A1'], 'measured_on' => '2026-09-01', 'load_kva' => 70, 'capacity_kva' => 100, 'source' => 'IMPORT', 'created_at' => now()]);
        $this->stub();
        $id = $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202)->assertJsonPath('data.status', 'RUNNING')->json('data.id');
        $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(409);                // one run at a time
        app(ForecastService::class)->execute($id);

        $run = DB::table('forecast_runs')->where('id', $id)->first();
        $this->assertSame(['SUCCEEDED', 'DRAFT', '2026-11-09'], [$run->status, $run->review_status, substr((string) $run->data_cutoff, 0, 10)]);
        $this->assertSame('GRU-kuantil (ansambel)', json_decode($run->model, true)['name']);
        $this->assertSame(4, DB::table('forecast_gardu_results')->where('run_id', $id)->count());
        $this->assertNotNull($run->assumptions);
        $this->assertFalse(File::isDirectory(storage_path("app/forecast/{$id}")));                       // the exported files are removed
    }

    #[Test]
    public function a_failing_service_ends_the_run_as_failed_with_its_message_and_frees_the_next_run(): void
    {
        $this->stub(fail: true);
        $id = $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202)->json('data.id');
        DB::table('substation_readings')->insert(['id' => (string) Str::uuid(), 'substation_id' => $this->sub['A1'], 'measured_on' => '2026-09-01', 'load_kva' => 70, 'capacity_kva' => 100, 'source' => 'IMPORT', 'created_at' => now()]);
        app(ForecastService::class)->execute($id);
        $run = DB::table('forecast_runs')->where('id', $id)->first();
        $this->assertSame('FAILED', $run->status);
        $this->assertStringContainsString('Data pembacaan terlalu sedikit', $run->error);
        $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202);
        DB::table('forecast_runs')->where('status', 'RUNNING')->update(['started_at' => now()->subHours(5)]);
        $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202);                // a stuck run is closed after 3 hours
    }

    #[Test]
    public function the_summary_and_the_list_are_scoped_to_the_readers_units_and_classify_the_risk(): void
    {
        $id = $this->storedRun();
        $a = $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}")->assertOk()->json('data');
        $this->assertCount(1, $a['summary']);                                                            // ULP A only
        $this->assertSame([3, 1, 1, 1, 1], [$a['summary'][0]['total'], $a['summary'][0]['kritis'], $a['summary'][0]['tinggi'], $a['summary'][0]['waspada'], $a['summary'][0]['stale']]);
        $this->assertSame(0.22, $a['metrics']['all']['wape']);

        $up3 = $this->as($this->up3Manager)->getJson("/api/forecast/runs/{$id}")->json('data.summary');
        $this->assertSame(2, count($up3));                                                               // the UP3 sees both ULPs

        $list = $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/substations")->assertOk();
        $this->assertSame(['KRITIS', 'TINGGI', 'WASPADA'], array_column($list->json('data'), 'risk'));  // worst first
        $this->assertSame(['G-A1', 'G-A2', 'G-A3'], array_column($list->json('data'), 'code'));
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/substations?risk=TINGGI")->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.code', 'G-A2');
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/substations?search=a3")->assertJsonPath('meta.total', 1);
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/substations?stale=1")->assertJsonPath('data.0.code', 'G-A3');
        $this->as($this->teknikB)->getJson("/api/forecast/runs/{$id}/substations")->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.code', 'G-B1');
        $this->as($this->teknikB)->getJson("/api/forecast/runs/{$id}/substations?unit_id={$this->ulpA->getKey()}")->assertJsonPath('meta.total', 0);   // another ULP's substations never show
        $this->as($this->vendor)->getJson("/api/forecast/runs/{$id}")->assertForbidden();
        $this->as($this->teknikA)->getJson('/api/forecast/runs/'.Str::uuid())->assertNotFound();
    }

    #[Test]
    public function only_the_planning_side_runs_and_the_review_is_by_someone_else_exactly_once(): void
    {
        $this->as($this->teknikA)->postJson('/api/forecast/runs')->assertForbidden();
        $id = $this->storedRun();
        $this->as($this->teknikA)->postJson("/api/forecast/runs/{$id}/review")->assertForbidden();
        $this->as($this->planner)->postJson("/api/forecast/runs/{$id}/review")->assertForbidden();   // PERENCANAAN does not review
        $this->as($this->asman)->postJson("/api/forecast/runs/{$id}/review", ['note' => 'Sesuai kondisi lapangan'])->assertOk();
        $this->as($this->up3Manager)->postJson("/api/forecast/runs/{$id}/review")->assertStatus(409);
        $show = $this->as($this->asman)->getJson("/api/forecast/runs/{$id}")->json('data');
        $this->assertSame(['REVIEWED', 'Sesuai kondisi lapangan'], [$show['review_status'], $show['review_note']]);
        $this->as($this->teknikA)->getJson('/api/forecast/runs')->assertOk()->assertJsonPath('data.0.review_status', 'REVIEWED')->assertJsonPath('can.run', false);

        $mine = (string) Str::uuid();
        DB::table('forecast_runs')->insert(['id' => $mine, 'kind' => 'GARDU_LOAD', 'status' => 'SUCCEEDED', 'started_by' => $this->up3Manager->getKey(), 'started_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->as($this->up3Manager)->postJson("/api/forecast/runs/{$mine}/review")->assertStatus(409);   // the starter never reviews their own run
    }

    /** @return array<string,mixed> */
    private function demandPayload(string $status = 'SUCCEEDED'): array
    {
        $months = fn (float $p50) => array_map(fn ($i) => ['month' => sprintf('2026-%02d', $i + 1), 'p10' => round($p50 * 0.8, 3), 'p50' => $p50, 'p90' => round($p50 * 1.3, 3)], range(11, 11)) + [];
        $series = fn (string $id, string $kind, string $unit, ?string $item, float $p50) => ['series_id' => $id, 'kind' => $kind, 'unit_id' => $unit, 'item_code' => $item, 'item_label' => $item ? "Material {$item}" : null, 'history_months' => 30,
            'last_12_months' => $p50 * 12, 'months' => array_map(fn ($i) => ['month' => sprintf('2026-%02d', $i), 'p10' => round($p50 * 0.8, 3), 'p50' => $p50, 'p90' => round($p50 * 1.3, 3)], range(1, 12)),
            'totals' => ['3' => ['p10' => $p50 * 2.4, 'p50' => $p50 * 3, 'p90' => $p50 * 3.9], '6' => ['p10' => $p50 * 4.8, 'p50' => $p50 * 6, 'p90' => $p50 * 7.8], '12' => ['p10' => $p50 * 9.6, 'p50' => $p50 * 12, 'p90' => $p50 * 15.6]]];
        $base = ['cutoff' => '2026-10', 'coverage' => ['CUSTOMERS_ADDED' => ['months' => 6, 'first_month' => '2026-05', 'series' => 2, 'sufficient_series' => 0]], 'counts' => ['series' => 3, 'sufficient_series' => $status === 'SUCCEEDED' ? 3 : 0],
            'model' => ['name' => 'GRU-kuantil bulanan (ansambel)', 'version' => '1'], 'seconds' => 3.2];
        if ($status !== 'SUCCEEDED') {
            return $base + ['status' => 'INSUFFICIENT', 'message' => 'Riwayat belum cukup: butuh seri dengan minimal 24 bulan riwayat.', 'results' => []];
        }

        return $base + ['status' => 'SUCCEEDED', 'metrics' => ['all' => ['n' => 40, 'wape' => 0.31, 'bias_pct' => -2.0, 'coverage_p10_p90' => 0.78, 'persistence_wape' => 0.4, 'wape_gain_vs_persistence_pct' => 22.5], 'by_horizon' => []],
            'results' => [$series("CUSTOMERS_ADDED|{$this->ulpA->getKey()}", 'CUSTOMERS_ADDED', $this->ulpA->getKey(), null, 40.0), $series("VA_ADDED|{$this->ulpA->getKey()}", 'VA_ADDED', $this->ulpA->getKey(), null, 900.0),
                $series("MATERIAL_ISSUE|{$this->ulpB->getKey()}|3110025", 'MATERIAL_ISSUE', $this->ulpB->getKey(), '3110025', 12.0)]];
    }

    private function demandStub(string $status): void
    {
        File::put("{$this->dir}/demand.json", json_encode($this->demandPayload($status)));
        File::put("{$this->dir}/demand.sh", <<<'SH'
#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in --series) R="$2";; --cutoff) C="$2";; --out) O="$2";; esac; shift; done
[ -s "$R" ] && [ -n "$C" ] || exit 3
cp "$(dirname "$0")/demand.json" "$O"
SH);
        config(['distriva.forecast.python' => '/bin/sh', 'distriva.forecast.monthly_script' => "{$this->dir}/demand.sh"]);
    }

    #[Test]
    public function the_demand_export_counts_customers_and_kva_per_ulp_month_and_material_issues_once_per_reservation_with_complete_months_only(): void
    {
        $cust = (string) Str::uuid();
        DB::table('customers')->insert(['id' => $cust, 'customer_number' => 'C-1', 'name' => 'Pelanggan Uji', 'created_at' => now(), 'updated_at' => now()]);
        $app = fn (string $type, string $status, string $at, ?float $delta, ?OrganizationalUnit $unit = null) => DB::table('applications')->insert(['id' => (string) Str::uuid(), 'application_number' => 'A-'.Str::random(8), 'application_type' => $type,
            'transaction_type' => 'X', 'customer_id' => $cust, 'organizational_unit_id' => ($unit ?? $this->ulpA)->getKey(), 'current_status' => $status, 'delta_power_kva' => $delta, 'source_created_at' => $at, 'created_by' => $this->planner->getKey(), 'created_at' => $at, 'updated_at' => $at]);
        $app('PB', 'APPROVED', '2026-08-10 09:00:00', 10.0);
        $app('PB', 'PAID', '2026-08-20 09:00:00', 5.5);
        $app('PD', 'PAID', '2026-08-25 09:00:00', 3.0);
        $app('PB', 'CANCELLED', '2026-08-26 09:00:00', 99.0);                    // cancelled: not demand
        $app('PB', 'APPROVED', '2026-11-05 09:00:00', 77.0);                     // the current month is incomplete: left out
        $app('PB', 'APPROVED', '2026-08-12 09:00:00', 4.0, $this->ulpB);
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'WH-T', 'name' => 'Gudang Uji', 'organizational_unit_id' => $this->ulpA->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        foreach ([['D1', 'R1', '2026-09-03'], ['D2', 'R1', '2026-09-20'], ['D3', 'R2', '2026-10-02']] as [$doc, $res, $day]) {      // R1 has two documents: counted once, in September
            DB::table('mims_issue_documents')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh, 'material_document' => $doc, 'reservation_no' => $res, 'issued_on' => $day, 'fetched_at' => now()]);
        }
        foreach ([['R1', 10], ['R2', 4]] as [$res, $qty]) {
            DB::table('mims_issue_lines')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh, 'reservation_no' => $res, 'material_no' => '3110025', 'material_name' => 'Kabel TIC', 'quantity' => $qty]);
        }

        app(ForecastService::class)->exportDemand($this->dir, '2026-10');
        $rows = collect(array_map('str_getcsv', file("{$this->dir}/series.csv", FILE_IGNORE_NEW_LINES)))->skip(1)->map(fn ($r) => [$r[1], $r[2], $r[3], $r[5], (float) $r[6]])->sort()->values()->all();
        $a = $this->ulpA->getKey();
        $b = $this->ulpB->getKey();
        $expected = [['CUSTOMERS_ADDED', $a, '', '2026-08', 2.0], ['CUSTOMERS_ADDED', $b, '', '2026-08', 1.0], ['MATERIAL_ISSUE', $a, '3110025', '2026-09', 10.0], ['MATERIAL_ISSUE', $a, '3110025', '2026-10', 4.0],
            ['VA_ADDED', $a, '', '2026-08', 18.5], ['VA_ADDED', $b, '', '2026-08', 4.0]];
        usort($expected, fn ($x, $y) => $x <=> $y);
        $this->assertSame($expected, $rows);
    }

    #[Test]
    public function a_demand_run_stores_the_series_or_ends_as_insufficient_with_the_coverage_and_the_message(): void
    {
        $this->demandStub('SUCCEEDED');
        $gardu = $this->as($this->planner)->postJson('/api/forecast/runs')->assertStatus(202)->json('data.id');          // a gardu run does not block a demand run
        $id = $this->as($this->planner)->postJson('/api/forecast/runs', ['kind' => 'DEMAND'])->assertStatus(202)->json('data.id');
        $this->as($this->planner)->postJson('/api/forecast/runs', ['kind' => 'DEMAND'])->assertStatus(409);
        $this->as($this->planner)->postJson('/api/forecast/runs', ['kind' => 'NOPE'])->assertStatus(422);
        app(ForecastService::class)->execute($id);
        $run = DB::table('forecast_runs')->where('id', $id)->first();
        $this->assertSame(['SUCCEEDED', 'DEMAND'], [$run->status, $run->kind]);
        $this->assertSame(3, DB::table('forecast_series_results')->where('run_id', $id)->count());
        $this->assertNotNull($run->assumptions);

        $this->as($this->teknikA)->getJson('/api/forecast/runs?kind=DEMAND')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.kind', 'DEMAND');
        $this->as($this->teknikA)->getJson('/api/forecast/runs')->assertJsonPath('data.0.id', $gardu);
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}")->assertOk()->assertJsonPath('data.kind', 'DEMAND')->assertJsonPath('data.metrics.all.wape', 0.31);
        $rows = $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/series")->assertOk();
        $this->assertSame(['CUSTOMERS_ADDED', 'VA_ADDED'], array_column($rows->json('data'), 'kind'));                       // ULP A only
        $this->assertSame(12, count($rows->json('data.0.months')));
        $this->assertEquals(480.0, $rows->json('data.0.totals.12.p50'));
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$id}/series?kind=VA_ADDED")->assertJsonPath('meta.total', 1);
        $this->as($this->teknikB)->getJson("/api/forecast/runs/{$id}/series?search=3110025")->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.item_label', 'Material 3110025');
        $this->as($this->teknikB)->getJson("/api/forecast/runs/{$id}/series?unit_id={$this->ulpA->getKey()}")->assertJsonPath('meta.total', 0);
        $this->as($this->teknikA)->getJson("/api/forecast/runs/{$gardu}/series")->assertNotFound();                        // not a demand run
        $this->as($this->vendor)->getJson("/api/forecast/runs/{$id}/series")->assertForbidden();

        $this->demandStub('INSUFFICIENT');
        $thin = $this->as($this->planner)->postJson('/api/forecast/runs', ['kind' => 'DEMAND'])->assertStatus(202)->json('data.id');
        app(ForecastService::class)->execute($thin);
        $run = DB::table('forecast_runs')->where('id', $thin)->first();
        $this->assertSame('INSUFFICIENT', $run->status, (string) $run->error);
        $this->assertStringContainsString('Riwayat belum cukup', $run->error);
        $this->assertSame(6, json_decode($run->data_window, true)['coverage']['CUSTOMERS_ADDED']['months']);
        $this->assertSame(0, DB::table('forecast_series_results')->where('run_id', $thin)->count());
        $this->as($this->planner)->postJson('/api/forecast/runs', ['kind' => 'DEMAND'])->assertStatus(202);                  // an insufficient run frees the next one
    }

    #[Test]
    public function the_derived_need_replaces_transformers_above_80_percent_by_the_next_step_and_counts_only_pln_material_for_the_new_customers(): void
    {
        $this->app->instance(BomCalculator::class, new class extends BomCalculator
        {
            public function calculate(string $headerId, array $inputs, array $params = []): array
            {
                $row = fn (string $code, float $qty) => ['sequence' => 1, 'khs_code' => $code, 'aggregate' => false, 'description' => null, 'material' => $qty, 'install' => 0.0, 'remove' => 0.0, 'return' => 0.0];
                if (isset($params['PBPD:PSG_1'])) {
                    return [$row('SRM', (float) $params['PBPD:PSG_1']), $row('SRX', 3.0 * (float) $params['PBPD:PSG_1'])];
                }

                return [$row('T160', array_sum(array_column($inputs, 'psg')))];
            }
        });
        $user = $this->planner;
        $khs = [];
        foreach (['T160' => 'Trafo Distribusi 20 KV 3 Phasa 160 KVA', 'T315' => 'Trafo Distribusi 20 KV 3 Phasa 315 KVA', 'SRM' => 'kWh Meter 1 Phs', 'SRX' => 'Paku Beton'] as $code => $name) {
            $khs[$code] = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $khs[$code], 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $khs[$code], 'version_number' => 1, 'name' => $name, 'unit_text' => 'BH', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
                'created_by' => $user->getKey(), 'approved_by' => $this->asman->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        $book = (string) Str::uuid();
        DB::table('price_books')->insert(['id' => $book, 'name' => 'Kontrak uji', 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'created_by' => $user->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        foreach (['T160' => 'PLN', 'T315' => 'PLN', 'SRM' => 'PLN', 'SRX' => 'PRICED'] as $code => $status) {
            DB::table('price_book_items')->insert(['id' => (string) Str::uuid(), 'price_book_id' => $book, 'khs_item_id' => $khs[$code], 'material_status' => $status, 'material_price' => $status === 'PRICED' ? 100 : null, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('price_books')->where('id', $book)->update(['status' => 'APPROVED', 'approved_by' => $this->asman->getKey(), 'approved_at' => now()]);
        $type = (string) Str::uuid();
        DB::table('construction_types')->insert(['id' => $type, 'group_code' => 'GTT_UMUM', 'code' => 'GTT_UMUM-07', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('construction_type_versions')->insert(['id' => (string) Str::uuid(), 'construction_type_id' => $type, 'version_number' => 1, 'name' => 'Trf. 160 kVA', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $user->getKey(), 'approved_by' => $this->asman->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        foreach (['GTT_UMUM', 'SR1PH'] as $group) {
            DB::table('bom_headers')->insert(['id' => (string) Str::uuid(), 'group_code' => $group, 'version_number' => 1, 'name' => $group, 'valid_from' => '2025-01-01', 'status' => 'APPROVED', 'parameters' => '[]',
                'created_by' => $user->getKey(), 'approved_by' => $this->asman->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }

        $payload = $this->payload();
        $payload['results'][1]['capacity_kva'] = 250.0;
        $payload['results'][1]['last_ratio'] = 0.9;
        $payload['results'][2]['last_ratio'] = 0.95;                                         // A3 is stale: never counted
        $run = $this->as($user)->postJson('/api/forecast/runs')->assertStatus(202)->json('data.id');
        app(ForecastService::class)->store($run, $payload);
        $demand = $this->as($user)->postJson('/api/forecast/runs', ['kind' => 'DEMAND'])->assertStatus(202)->json('data.id');
        $d = $this->demandPayload();
        $d['results'][2]['item_label'] = 'Tiang Beton 9m - 200 daN';
        app(ForecastService::class)->storeDemand($demand, $d);

        $a = $this->as($this->teknikA)->getJson('/api/forecast/derived')->assertOk()->assertJsonPath('data.gardu.trigger_count', 2)->assertJsonPath('data.customers.status', 'SUCCEEDED');
        $this->assertEquals(480.0, $a->json('data.customers.new_customers.p50'));
        $byCode = collect($a->json('data.materials'))->keyBy('code');
        $this->assertSame(['SRM', 'T160', 'T315'], $byCode->keys()->sort()->values()->all());     // the contractor's material (SRX) is left out
        $this->assertEquals(1.0, $byCode['T160']['gardu']);                                       // 100 kVA -> 160 kVA
        $this->assertEquals(1.0, $byCode['T315']['gardu']);                                       // 250 kVA -> 315 kVA (no construction row: the transformer alone)
        $this->assertEquals([384.0, 480.0, 624.0], [$byCode['SRM']['total']['p10'], $byCode['SRM']['total']['p50'], $byCode['SRM']['total']['p90']]);
        $this->assertSame([], $a->json('data.poles'));

        $b = $this->as($this->teknikB)->getJson('/api/forecast/derived')->assertOk()->assertJsonPath('data.gardu.trigger_count', 0);
        $this->assertSame(['Tiang Beton 9m - 200 daN'], array_column($b->json('data.poles'), 'item_label'));
        $this->as($this->vendor)->getJson('/api/forecast/derived')->assertForbidden();
    }

    #[Test]
    public function the_monthly_schedule_starts_each_kind_once_a_month_in_turn_only_when_enabled_and_due(): void
    {
        $svc = app(ForecastService::class);
        $this->assertNull($svc->runScheduledIfDue());                                                   // off by default
        $this->as($this->teknikA)->putJson('/api/forecast/schedule', ['auto_enabled' => true, 'day_of_month' => 1, 'run_time' => '03:00'])->assertForbidden();
        $this->as($this->planner)->putJson('/api/forecast/schedule', ['auto_enabled' => true, 'day_of_month' => 29, 'run_time' => '03:00'])->assertStatus(422);
        $this->as($this->planner)->putJson('/api/forecast/schedule', ['auto_enabled' => true, 'day_of_month' => 5, 'run_time' => '03:00'])->assertOk()->assertJsonPath('data.day_of_month', 5);
        $this->as($this->teknikA)->getJson('/api/forecast/schedule')->assertOk()->assertJsonPath('data.auto_enabled', true)->assertJsonPath('data.updated_by_name', $this->planner->name);

        $tz = config('distriva.business_timezone');
        $this->travelTo(now($tz)->startOfMonth()->addDays(2)->setTime(12, 0));                           // the 3rd: before the 5th
        $this->assertNull($svc->runScheduledIfDue());
        $this->travelTo(now($tz)->startOfMonth()->addDays(4)->setTime(2, 0));                            // the 5th, before 03:00
        $this->assertNull($svc->runScheduledIfDue());
        $this->travelTo(now($tz)->startOfMonth()->addDays(4)->setTime(3, 5));
        $first = $svc->runScheduledIfDue();
        $this->assertNotNull($first);
        $this->assertSame(['GARDU_LOAD', 'AUTO'], [DB::table('forecast_runs')->where('id', $first)->value('kind'), DB::table('forecast_runs')->where('id', $first)->value('trigger')]);
        $this->assertNull($svc->runScheduledIfDue());                                                   // one runs at a time: the next kind waits
        DB::table('forecast_runs')->where('id', $first)->update(['status' => 'FAILED', 'finished_at' => now()]);   // a failed run still counts for the month
        $second = $svc->runScheduledIfDue();
        $this->assertSame('DEMAND', DB::table('forecast_runs')->where('id', $second)->value('kind'));
        DB::table('forecast_runs')->where('id', $second)->update(['status' => 'INSUFFICIENT', 'finished_at' => now()]);
        $this->assertNull($svc->runScheduledIfDue());                                                   // both done this month
        $this->travelTo(now($tz)->addMonthNoOverflow()->startOfMonth()->addDays(10));
        $this->assertNotNull($svc->runScheduledIfDue());                                                // next month starts again
        $this->travelBack();
    }
}
