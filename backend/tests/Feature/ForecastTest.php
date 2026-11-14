<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
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
}
