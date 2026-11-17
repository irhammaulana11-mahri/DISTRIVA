<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\Substations\MaximoSyncService;
use Database\Seeders\SubstationPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** The Maximo sync started from DISTRIVA: settings (password never returned), manual and scheduled runs, the tool's arguments and environment, and the load of what it wrote into readings. */
class MaximoSyncTest extends PostgresTestCase
{
    private User $planning;

    private User $teknik;

    private User $vendor;

    private string $gardu;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(SubstationPermissionSeeder::class);
        $up3 = $this->makeUnit('UP3');
        $ulp = $this->makeUnit('ULP', $up3);
        $mk = function (string $role) use ($up3): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $up3);

            return $u;
        };
        $this->planning = $mk('PERENCANAAN');
        $this->teknik = $mk('TEKNIK');                              // may read and enter readings, but not run the sync
        $this->vendor = $mk('VENDOR');
        $this->gardu = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $this->gardu, 'code' => 'HD0744', 'organizational_unit_id' => $ulp->getKey(), 'ownership' => 'PLN', 'capacity_kva' => 200, 'status' => 'AKTIF', 'transformer_count' => 1, 'needs_review' => false,
            'created_at' => now(), 'updated_at' => now()]);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** A stand-in for tools/maximo_sync: records what it was given, prints what the real tool prints and writes the cumulative CSV; "fail" as the user makes it exit 1. */
    private function fakeTool(): string
    {
        $dir = sys_get_temp_dir().'/maximo-fake-'.bin2hex(random_bytes(4));
        mkdir($dir.'/out', 0777, true);
        $at = now()->subDays(2)->format('Y-m-d').' 09:00:00';
        $py = <<<PY
import os, sys, json
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'seen.json'), 'w').write(json.dumps({'args': sys.argv[1:], 'user': os.environ.get('MAXIMO_USERNAME'), 'pw': os.environ.get('MAXIMO_PASSWORD'), 'url': os.environ.get('MAXIMO_URL')}))
if os.environ.get('MAXIMO_USERNAME') == 'fail':
    print('GAGAL login'); sys.exit(1)
print('Daftar: 3 WO cocok'); print('  1/1 WO, gagal 0'); print('RINGKASAN daftar=3 dipilih=1 diambil=1 gagal=0')
open(os.path.join(here, 'out', 'maximo-wo-pengukuran.csv'), 'w').write('wonum,gardu,measured_at,pembebanan_trafo_pct,vrn,vsn,vtn,iar,ias,iat,ian\\n100000001,HD744,{$at},52.65,226,228,230,55,82,60,42\\n100000002,ZZ999,{$at},40,,,,,,,\\n')
PY;
        file_put_contents($dir.'/main.py', $py);
        config(['distriva.maximo_sync.dir' => $dir, 'distriva.maximo_sync.run_inline' => true]);

        return $dir;
    }

    /** @param array<string,mixed> $o */
    private function body(array $o = []): array
    {
        return $o + ['maximo_url' => 'http://maximo.test', 'maximo_username' => 'petugas.mx', 'maximo_password' => 'Rahasia#123', 'work_type' => 'inst1', 'lookback_days' => 5, 'auto_enabled' => false, 'auto_time' => '19:30'];
    }

    #[Test]
    public function only_the_roles_with_the_sync_permission_can_save_the_settings_and_the_password_is_never_returned(): void
    {
        $this->as($this->teknik)->getJson('/api/maximo-sync')->assertForbidden();
        $this->as($this->vendor)->getJson('/api/maximo-sync')->assertForbidden();
        $this->as($this->teknik)->putJson('/api/maximo-sync/settings', $this->body())->assertForbidden();
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['auto_time' => '25:99']))->assertUnprocessable();
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['maximo_url' => 'ftp://x']))->assertUnprocessable();
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['lookback_days' => 0]))->assertUnprocessable();
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['maximo_username' => '', 'maximo_password' => '', 'auto_enabled' => true]))->assertStatus(409);   // nothing to log in with

        $saved = $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body())->assertOk()->json('data');
        $this->assertSame(['petugas.mx', true, 'INST1', 5, 'http://maximo.test'], [$saved['maximo_username'], $saved['has_password'], $saved['work_type'], $saved['lookback_days'], $saved['maximo_url']]);
        $this->assertStringNotContainsString('Rahasia#123', json_encode($this->as($this->planning)->getJson('/api/maximo-sync')->assertOk()->json()));
        $this->assertNotSame('Rahasia#123', DB::table('maximo_sync_settings')->value('maximo_password_encrypted'));                          // stored encrypted
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['maximo_password' => '']))->assertOk();                  // an empty password keeps the saved one
        $this->assertTrue($this->as($this->planning)->getJson('/api/maximo-sync')->json('data.settings.has_password'));
    }

    #[Test]
    public function a_manual_run_gives_the_tool_the_account_the_window_and_the_choice_then_loads_the_readings_and_keeps_the_log(): void
    {
        $dir = $this->fakeTool();
        $this->as($this->planning)->postJson('/api/maximo-sync/runs')->assertStatus(409);                                                  // no Maximo account yet
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body())->assertOk();
        $this->as($this->teknik)->postJson('/api/maximo-sync/runs')->assertForbidden();
        $this->as($this->planning)->postJson('/api/maximo-sync/runs', ['since' => '2999-01-01'])->assertUnprocessable();

        $run = $this->as($this->planning)->postJson('/api/maximo-sync/runs', ['since' => '2026-10-01', 'all_work_orders' => true])->assertStatus(202)->json('data');
        $seen = json_decode((string) file_get_contents($dir.'/seen.json'), true);
        $this->assertSame(['ambil', '--sejak', '01/10/2026', '--tipe', 'INST1', '--tambah', '--semua'], $seen['args']);
        $this->assertSame(['petugas.mx', 'Rahasia#123', 'http://maximo.test'], [$seen['user'], $seen['pw'], $seen['url']]);

        $done = $this->as($this->planning)->getJson("/api/maximo-sync/runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame(['OK', 0, 'MANUAL', true], [$done['status'], $done['exit_code'], $done['trigger'], $done['all_work_orders']]);
        $this->assertSame([3, 1, 1, 0], [$done['summary']['listed'], $done['summary']['chosen'], $done['summary']['fetched'], $done['summary']['failed']]);
        $this->assertSame([2, 1, 1], [$done['summary']['load']['rows'], $done['summary']['load']['readings_stored'], $done['summary']['load']['unknown_gardu']]);
        $this->assertStringContainsString('Pemuatan ke pembacaan gardu', $done['log']);
        $this->assertStringContainsString('ZZ0999', $done['log']);                                                                          // a gardu that is not in the master is reported
        $this->assertStringNotContainsString('Rahasia#123', json_encode($done));
        $reading = DB::table('substation_readings')->where('substation_id', $this->gardu)->first();
        $this->assertSame([226.0, 52.65], [(float) $reading->base_voltage_r_v, (float) $reading->loading_pct]);

        $again = $this->as($this->planning)->postJson('/api/maximo-sync/runs')->assertStatus(202)->json('data');                               // the default window; the load is idempotent
        $this->assertSame('OK', $this->as($this->planning)->getJson("/api/maximo-sync/runs/{$again['id']}")->json('data.status'));
        $this->assertNotContains('--semua', json_decode((string) file_get_contents($dir.'/seen.json'), true)['args']);
        $this->assertSame(1, DB::table('substation_readings')->where('substation_id', $this->gardu)->count());
        $this->assertSame(2, $this->as($this->planning)->getJson('/api/maximo-sync/runs')->assertOk()->json('meta.total'));

        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['maximo_username' => 'fail']))->assertOk();            // a failing tool is a FAILED run and nothing is loaded
        $bad = $this->as($this->planning)->postJson('/api/maximo-sync/runs')->assertStatus(202)->json('data.id');
        $this->assertSame(['FAILED', 1], [DB::table('maximo_sync_runs')->where('id', $bad)->value('status'), (int) DB::table('maximo_sync_runs')->where('id', $bad)->value('exit_code')]);

        DB::table('maximo_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'RUNNING', 'started_by' => $this->planning->getKey(), 'created_at' => now()]);   // one run at a time
        $this->as($this->planning)->postJson('/api/maximo-sync/runs')->assertStatus(409);
    }

    #[Test]
    public function the_scheduled_run_starts_once_a_day_at_the_set_time_with_the_look_back_window(): void
    {
        $dir = $this->fakeTool();
        $svc = app(MaximoSyncService::class);
        $this->assertNull($svc->runScheduledIfDue());                                                                                          // disabled
        $this->as($this->planning)->putJson('/api/maximo-sync/settings', $this->body(['auto_enabled' => true, 'auto_time' => '23:59', 'lookback_days' => 4]))->assertOk();
        $this->travelTo(now(config('distriva.business_timezone'))->setTime(10, 0));
        $this->assertNull($svc->runScheduledIfDue());                                                                                          // not yet its time
        $this->travelTo(now(config('distriva.business_timezone'))->setTime(23, 59, 30));
        $id = $svc->runScheduledIfDue();
        $this->assertNotNull($id);
        $row = DB::table('maximo_sync_runs')->where('id', $id)->first();
        $this->assertSame(['AUTO', 'OK', $this->planning->getKey(), false], [$row->trigger, $row->status, $row->started_by, (bool) $row->all_work_orders]);
        $this->assertSame(now(config('distriva.business_timezone'))->subDays(4)->toDateString(), (string) $row->since);                       // only the configured window
        $args = json_decode((string) file_get_contents($dir.'/seen.json'), true)['args'];
        $this->assertSame(now(config('distriva.business_timezone'))->subDays(4)->format('d/m/Y'), $args[array_search('--sejak', $args, true) + 1]);
        $this->assertNull($svc->runScheduledIfDue());                                                                                          // once per business day
    }
}
