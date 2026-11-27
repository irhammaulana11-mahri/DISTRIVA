<?php

namespace Tests\Feature;

use App\Jobs\Middleware\LimitSyncSource;
use App\Jobs\RunSyncJob;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Outages\OutageSyncService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\MasterDataPermissionSeeder;
use Database\Seeders\OutagePermissionSeeder;
use Database\Seeders\SubstationPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class SyncParallelTest extends PostgresTestCase
{
    private OrganizationalUnit $up3A;

    private OrganizationalUnit $up3B;

    private User $adminA;

    private User $adminA2;

    private User $adminB;

    private User $sysAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(OutagePermissionSeeder::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $this->seed(SubstationPermissionSeeder::class);
        config(['distriva.outage.run_inline' => false, 'distriva.maximo_sync.run_inline' => false]);
        $this->up3A = $this->makeUnit('UP3');
        $this->up3B = $this->makeUnit('UP3');
        $this->makeUnit('ULP', $this->up3A);
        $this->makeUnit('ULP', $this->up3A);
        $this->makeUnit('ULP', $this->up3B);
        $this->adminA = $this->actor('PERENCANAAN', $this->up3A, 'Admin A');
        $this->adminA2 = $this->actor('PERENCANAAN', $this->up3A, 'Admin A Dua');
        $this->adminB = $this->actor('PERENCANAAN', $this->up3B, 'Admin B');
        $this->sysAdmin = $this->actor('SYS_ADMIN', null, 'Sys');
        foreach ([[$this->adminA, 'a'], [$this->adminB, 'b']] as [$admin, $letter]) {
            $this->as($admin)->putJson('/api/outages/sync/settings', ['sheet_url' => 'https://docs.google.com/spreadsheets/d/'.str_repeat($letter, 40).'/edit?gid=7', 'auto_enabled' => false, 'auto_time' => '06:30',
                'saidi_min_minutes' => 5, 'saidi_only_permanent' => false])->assertOk();
        }
    }

    private function actor(string $role, ?OrganizationalUnit $unit, string $name): User
    {
        $user = $this->makeUser();
        $user->forceFill(['name' => $name])->save();
        $this->assign($user, Role::query()->where('name', $role)->firstOrFail(), $unit);

        return $user;
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** @return array{0: OrganizationalUnit, 1: OrganizationalUnit, 2: User, 3: User} dua ULP di UP3 A beserta admin masing-masing */
    private function twoUlps(): array
    {
        [$one, $two] = OrganizationalUnit::query()->where('parent_id', $this->up3A->getKey())->orderBy('code')->get()->all();
        $one->forceFill(['name' => 'ULP Satu'])->save();
        $two->forceFill(['name' => 'ULP Dua'])->save();

        return [$one, $two, $this->actor('PERENCANAAN', $one, 'Admin Satu'), $this->actor('PERENCANAAN', $two, 'Admin Dua')];
    }

    private function maximoSettings(?string $username): void
    {
        $this->as($this->adminA)->putJson('/api/maximo-sync/settings', ['maximo_url' => 'http://maximo.test', 'maximo_username' => $username, 'maximo_password' => $username === null ? null : 'rahasia-up3',
            'work_type' => 'INS', 'lookback_days' => 7, 'auto_enabled' => false, 'auto_time' => '06:00'])->assertOk();
    }

    private function ulpAccount(User $actor, OrganizationalUnit $ulp, string $username)
    {
        return $this->as($actor)->putJson('/api/sync/accounts', ['source' => 'maximo', 'unit_id' => $ulp->getKey(), 'username' => $username, 'password' => 'rahasia-'.$username]);
    }

    #[Test]
    public function ulps_with_their_own_accounts_sync_in_parallel_and_the_up3_run_blocks_them(): void
    {
        Queue::fake();
        [$one, $two, $adminOne, $adminTwo] = $this->twoUlps();
        $this->maximoSettings('akun-up3');
        $this->ulpAccount($adminOne, $one, 'akun-satu')->assertOk();
        $this->ulpAccount($adminTwo, $two, 'akun-dua')->assertOk();

        $first = $this->as($adminOne)->postJson('/api/maximo-sync/runs')->assertStatus(202)->json('data');
        $second = $this->as($adminTwo)->postJson('/api/maximo-sync/runs')->assertStatus(202)->json('data');

        $this->assertSame(['ULP Satu', 'ULP Dua'], [$first['account']['name'], $second['account']['name']]);
        $this->as($this->adminA)->postJson('/api/maximo-sync/runs')->assertStatus(409)->assertJsonPath('scope.type', 'ULP');
        $groups = [];
        Queue::assertPushed(RunSyncJob::class, function (RunSyncJob $job) use (&$groups) {
            $groups[] = $job->group;

            return true;
        });
        $this->assertSame(["sync:maximo:{$one->getKey()}", "sync:maximo:{$two->getKey()}"], $groups);     // akun berbeda tidak saling menunggu

        DB::table('maximo_sync_runs')->update(['status' => 'OK']);
        $this->assertSame(0, DB::table('sync_locks')->count());                                          // kunci lepas begitu run selesai
    }

    #[Test]
    public function an_up3_run_splits_per_account_and_a_ulp_is_told_the_up3_is_running_it(): void
    {
        Queue::fake();
        [$one, $two, $adminOne, $adminTwo] = $this->twoUlps();
        $this->maximoSettings('akun-up3');
        $this->ulpAccount($this->adminA, $one, 'akun-satu')->assertOk();

        $this->as($adminTwo)->postJson('/api/maximo-sync/runs')->assertStatus(409)->assertJsonFragment(['message' => 'ULP Dua belum punya akun Maximo sendiri; akun UP3 hanya dapat dipakai dari tingkat UP3.']);

        $runs = $this->as($this->adminA)->postJson('/api/maximo-sync/runs')->assertStatus(202)->json('runs');
        $this->assertSame(['ULP Satu', $this->up3A->name], array_column(array_column($runs, 'account'), 'name'));

        $this->as($adminOne)->postJson('/api/maximo-sync/runs')->assertStatus(409)
            ->assertJsonPath('message', "ULP Satu sedang disinkronkan oleh run {$this->up3A->name} (dipicu Admin A); tunggu sampai selesai.")
            ->assertJsonPath('active_run_id', $runs[0]['id'])->assertJsonPath('scope.type', 'UP3')->assertJsonPath('conflicts.0.name', 'ULP Satu');

        // semua atau tidak sama sekali: satu ULP yang bentrok menolak seluruh permintaan UP3
        DB::table('maximo_sync_runs')->where('id', $runs[1]['id'])->update(['status' => 'OK']);
        $this->as($this->adminA)->postJson('/api/maximo-sync/runs')->assertStatus(409);
        $this->assertSame(2, DB::table('maximo_sync_runs')->count());
    }

    #[Test]
    public function a_ulp_admin_manages_only_its_own_account_and_the_password_is_never_returned(): void
    {
        [$one, $two, $adminOne] = $this->twoUlps();

        $this->ulpAccount($adminOne, $one, 'akun-satu')->assertOk();
        $this->ulpAccount($adminOne, $two, 'akun-curian')->assertNotFound();
        $this->ulpAccount($this->adminB, $one, 'akun-curian')->assertNotFound();

        $list = $this->as($adminOne)->getJson('/api/sync/accounts?source=maximo')->assertOk();
        $this->assertSame([['ULP Satu', true, 'akun-satu']], array_map(fn (array $r) => [$r['name'], $r['has_own_account'], $r['username']], $list->json('data')));
        $this->assertStringNotContainsString('rahasia-akun-satu', $list->getContent().json_encode(DB::table('sync_accounts')->get()));
        $this->assertCount(2, $this->as($this->adminA)->getJson('/api/sync/accounts?source=maximo')->json('data'));
        $this->as($adminOne)->deleteJson("/api/sync/accounts/maximo/{$one->getKey()}")->assertOk();
        $this->assertSame(0, DB::table('sync_accounts')->count());
    }

    #[Test]
    public function up3_sync_settings_are_changed_only_from_the_up3_level(): void
    {
        [, , $adminOne] = $this->twoUlps();
        $maximo = ['maximo_url' => 'http://maximo.test', 'maximo_username' => 'ambil-alih', 'maximo_password' => 'x', 'work_type' => 'INS', 'lookback_days' => 7, 'auto_enabled' => false, 'auto_time' => '06:00'];
        $gangguan = ['auto_enabled' => false, 'auto_time' => '06:30', 'saidi_min_minutes' => 1, 'saidi_only_permanent' => false];

        $this->as($adminOne)->putJson('/api/maximo-sync/settings', $maximo)->assertForbidden();
        $this->as($adminOne)->putJson('/api/outages/sync/settings', $gangguan)->assertForbidden();
        $this->as($adminOne)->getJson('/api/maximo-sync')->assertOk()->assertJsonPath('data.can_manage_settings', false);

        $this->as($this->adminA)->putJson('/api/maximo-sync/settings', $maximo)->assertOk();
        $this->as($this->adminA)->getJson('/api/maximo-sync')->assertOk()->assertJsonPath('data.can_manage_settings', true);
    }

    #[Test]
    public function the_mims_settings_give_the_page_the_up3_choices_like_the_other_sync_pages(): void
    {
        $konstruksi = $this->actor('KONSTRUKSI', $this->up3A, 'Gudang A');

        $this->as($konstruksi)->getJson('/api/master-data/stock-sync/settings')->assertOk()->assertJsonPath('data.up3_id', $this->up3A->getKey())->assertJsonCount(1, 'data.up3s');
        $all = $this->as($this->sysAdmin)->getJson('/api/master-data/stock-sync/settings?up3_id='.$this->up3B->getKey())->assertOk();
        $all->assertJsonPath('data.up3_id', $this->up3B->getKey())->assertJsonCount(2, 'data.up3s');
    }

    #[Test]
    public function a_source_runs_no_more_than_its_limit_at_once(): void
    {
        config(['distriva.sync.concurrency.maximo' => 1]);
        $job = new class
        {
            public int $timeout = 60;

            public ?int $releasedFor = null;

            public function release(int $seconds): void
            {
                $this->releasedFor = $seconds;
            }
        };
        $busy = Cache::lock('sync-slot:maximo:1', 60);
        $this->assertTrue($busy->get());
        $ran = 0;
        $limit = new LimitSyncSource('maximo');

        $limit->handle($job, function () use (&$ran) {
            $ran++;
        });
        $this->assertSame([0, 30], [$ran, $job->releasedFor]);

        $busy->release();
        $limit->handle($job, function () use (&$ran) {
            $ran++;
        });
        $this->assertSame(1, $ran);
    }

    private function csv(string $feeder): string
    {
        $head = ['NO', 'TANGGAL', 'RAYON', 'GI', 'PENYULANG', 'PMT/RECLOSER', 'JAM', 'LAMA PADAM', 'TEMPORER/ PERMANEN'];
        $out = fopen('php://temp', 'r+');
        fputcsv($out, $head, ',', '"', '');
        fputcsv($out, ['1', '01 January 2020', '', 'GI', $feeder, 'PMT', '10:00', '0:10', 'PERMANEN'], ',', '"', '');
        rewind($out);

        return stream_get_contents($out);
    }

    #[Test]
    public function two_up3_run_the_same_source_in_parallel_and_the_same_up3_gets_409_with_the_active_run(): void
    {
        Queue::fake();

        $a = $this->as($this->adminA)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');
        $b = $this->as($this->adminB)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');

        Queue::assertPushedOn('sync-light', RunSyncJob::class);
        Queue::assertPushed(RunSyncJob::class, 2);
        $this->as($this->adminA2)->postJson('/api/outages/sync/runs')->assertStatus(409)
            ->assertJsonPath('active_run_id', $a)->assertJsonPath('triggered_by.name', 'Admin A')->assertJsonPath('triggered_by.id', $this->adminA->getKey());
        $this->assertSame([$this->up3A->getKey(), $this->up3B->getKey()], [DB::table('outage_sync_runs')->where('id', $a)->value('up3_id'), DB::table('outage_sync_runs')->where('id', $b)->value('up3_id')]);
    }

    #[Test]
    public function each_up3_sees_only_its_own_runs_and_sys_admin_sees_all_and_may_choose(): void
    {
        Queue::fake();
        $a = $this->as($this->adminA)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');
        $this->travel(1)->seconds();
        $b = $this->as($this->adminB)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');

        $mine = $this->as($this->adminB)->getJson('/api/sync/active')->assertOk()->json('data');
        $this->assertSame([$b], array_column($mine, 'id'));
        $this->assertSame(['gangguan', 'events', 'QUEUED', 'sync-light', 2, 'Admin B'], [$mine[0]['source'], $mine[0]['dataset'], $mine[0]['state'], $mine[0]['queue'], $mine[0]['queue_position'], $mine[0]['triggered_by']['name']]);
        $this->assertSame([$a, $b], array_column($this->as($this->sysAdmin)->getJson('/api/sync/active')->json('data'), 'id'));
        $this->assertSame([$b], array_column($this->as($this->adminB)->getJson('/api/outages/sync')->assertOk()->json('data.runs'), 'id'));
        $this->as($this->adminB)->getJson("/api/outages/sync/runs/{$a}")->assertNotFound();
        $this->as($this->adminB)->getJson('/api/outages/sync?up3_id='.$this->up3A->getKey())->assertNotFound();
        $this->as($this->adminB)->postJson('/api/outages/sync/runs', ['up3_id' => $this->up3A->getKey()])->assertNotFound();
        $this->assertSame([$b], array_column($this->as($this->sysAdmin)->getJson('/api/outages/sync?up3_id='.$this->up3B->getKey())->assertOk()->json('data.runs'), 'id'));
    }

    #[Test]
    public function syncing_one_up3_never_marks_or_overwrites_the_events_of_another(): void
    {
        config(['distriva.outage.run_inline' => true]);
        Http::fake(['docs.google.com/spreadsheets/d/aaaa*' => Http::response($this->csv('ALFA')), 'docs.google.com/spreadsheets/d/bbbb*' => Http::response($this->csv('BRAVO'))]);

        $this->as($this->adminA)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $this->as($this->adminB)->postJson('/api/outages/sync/runs')->assertStatus(202);

        $events = DB::table('outage_events')->orderBy('feeder_name')->get(['up3_id', 'feeder_name', 'source_removed_at']);
        $this->assertSame([[$this->up3A->getKey(), 'ALFA', null], [$this->up3B->getKey(), 'BRAVO', null]], $events->map(fn ($e) => [$e->up3_id, $e->feeder_name, $e->source_removed_at])->all());
    }

    #[Test]
    public function the_queued_job_runs_the_sync_and_notifies_the_person_who_started_it(): void
    {
        Queue::fake();
        Http::fake(['docs.google.com/*' => Http::response($this->csv('ALFA'))]);
        $id = $this->as($this->adminA)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');

        Queue::assertPushed(RunSyncJob::class, function (RunSyncJob $job) {
            $job->handle();

            return true;
        });

        $run = $this->as($this->adminA)->getJson("/api/outages/sync/runs/{$id}")->assertOk()->json('data');
        $this->assertSame(['OK', 'SUCCEEDED', 1, 1, null], [$run['status'], $run['state'], $run['progress']['done_units'], $run['progress']['total_units'], $run['queue_position']]);
        $this->assertDatabaseHas('user_notifications', ['user_id' => $this->adminA->getKey(), 'level' => 'success', 'title' => 'Sinkronisasi Data gangguan (events) selesai']);
        $this->assertDatabaseMissing('user_notifications', ['user_id' => $this->adminB->getKey()]);
    }

    #[Test]
    public function a_waiting_run_with_its_job_still_queued_is_not_expired(): void
    {
        $id = $this->as($this->adminA)->postJson('/api/outages/sync/runs')->assertStatus(202)->json('data.id');      // antrean database sync_jobs

        $this->assertSame(1, DB::table('jobs')->where('queue', 'sync-light')->count());
        $this->travel(1)->hours();
        app(OutageSyncService::class)->expireStale();
        $this->assertSame('QUEUED', DB::table('outage_sync_runs')->where('id', $id)->value('status'));

        DB::table('jobs')->delete();
        app(OutageSyncService::class)->expireStale();
        $this->assertSame('FAILED', DB::table('outage_sync_runs')->where('id', $id)->value('status'));
    }

    #[Test]
    public function a_pasted_mims_token_waits_encrypted_and_never_enters_the_queue_table(): void
    {
        $secret = 'rahasia-token-antrean-123';
        config(['distriva.mims.base_url' => 'https://mims-antre.test', 'distriva.mims.run_inline' => false]);
        $konstruksi = $this->actor('KONSTRUKSI', $this->up3A, 'Gudang A');
        foreach ([[$this->up3A, '2810'], [$this->up3B, '2850']] as [$up3, $loc]) {
            DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => '5118-'.$loc, 'name' => 'Gd '.$loc, 'organizational_unit_id' => $up3->getKey(), 'plant' => '5118', 'stor_loc' => $loc, 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }

        $run = $this->as($konstruksi)->postJson('/api/master-data/stock-sync/runs', ['token' => $secret])->assertStatus(202)->json('data');

        $this->assertSame(['QUEUED', 'mims', $this->up3A->getKey()], [$run['state'], $run['source'], $run['up3']['id']]);
        $this->assertArrayNotHasKey('token_encrypted', $run['options']);
        $this->assertCount(1, $run['options']['warehouse_ids']);     // hanya gudang UP3 pemicu
        $this->assertStringNotContainsString($secret, DB::table('jobs')->value('payload').DB::table('mims_pull_runs')->value('options'));
    }
}
