<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Substations\DilSyncService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\KkoPermissionSeeder;
use Database\Seeders\SubstationPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** DIL sync from Master Pelanggan: only the inbox folder is read, only the allowed columns are taken, names are masked, a loaded file moves to diproses/, and it is idempotent. */
class DilSyncTest extends PostgresTestCase
{
    private string $inbox;

    private OrganizationalUnit $ulp;

    private User $planning;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(KkoPermissionSeeder::class);
        $this->seed(SubstationPermissionSeeder::class);
        $this->inbox = sys_get_temp_dir().'/dil-inbox-'.uniqid();
        config(['distriva.dil.inbox' => $this->inbox, 'distriva.dil.detach' => false]);
        $up3 = $this->makeUnit('UP3');
        $this->ulp = $this->makeUnit('ULP', $up3);
        $this->planning = $this->makeUser();
        $this->assign($this->planning, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $up3);
        $this->vendor = $this->makeUser();
        $this->assign($this->vendor, Role::query()->where('name', 'VENDOR')->firstOrFail(), $this->ulp);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->inbox);
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function csv(string $name, array $rows): void
    {
        File::ensureDirectoryExists($this->inbox);
        $head = ['IDPEL', 'UNITUP', 'NAMA', 'TARIF', 'DAYA', 'JENISLAYANAN', 'NOMOR_GARDU', 'NAMA_GARDU', 'STATUS_DIL', 'NIK', 'NO_HP', 'TGLNYALA_PB'];
        $fh = fopen($this->inbox.'/'.$name, 'w');
        fputcsv($fh, $head, ',', '"', '');
        foreach ($rows as $r) {
            fputcsv($fh, array_map(fn ($h) => $r[$h] ?? '', $head), ',', '"', '');
        }
        fclose($fh);
    }

    #[Test]
    public function the_inbox_lists_only_dil_files_and_the_run_loads_masks_archives_and_is_safe_to_repeat(): void
    {
        $this->csv('DIL_SALDO_MASK_UP_202603_51453.csv', [
            ['IDPEL' => '514530000001', 'UNITUP' => $this->ulp->code, 'NAMA' => 'BUDI SANTOSO', 'TARIF' => 'R1', 'DAYA' => '900', 'JENISLAYANAN' => 'PRABAYAR', 'NOMOR_GARDU' => 'HD0001', 'STATUS_DIL' => 'AKTIF', 'NIK' => '3573000000000001', 'NO_HP' => '0812'],
            ['IDPEL' => '514530000002', 'UNITUP' => $this->ulp->code, 'NAMA' => 'SIT*****', 'TARIF' => 'R1', 'DAYA' => '450', 'STATUS_DIL' => 'AKTIF'],
            ['IDPEL' => 'RUSAK', 'UNITUP' => $this->ulp->code, 'STATUS_DIL' => 'AKTIF'],                                          // not a 12-digit IDPEL: rejected, never stored
        ]);
        file_put_contents($this->inbox.'/catatan.txt', 'bukan DIL');                                                                // another file type is ignored
        symlink($this->inbox.'/catatan.txt', $this->inbox.'/tautan.csv');                                                          // a symbolic link is ignored

        $info = $this->as($this->planning)->getJson('/api/master-data/customer-connections/sync')->assertOk()->json('data');
        $this->assertSame(['DIL_SALDO_MASK_UP_202603_51453.csv'], array_column($info['files'], 'name'));
        $this->assertSame(['51453', '202603', false], [$info['files'][0]['ulp_code'], $info['files'][0]['month'], $info['needs_mdbtools']]);

        $run = $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs')->assertStatus(202)->json('data');
        app(DilSyncService::class)->execute($run['id']);

        $done = $this->as($this->planning)->getJson("/api/master-data/customer-connections/sync/runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame(['OK', 3], [$done['status'], $done['rows_done']]);
        $this->assertSame(2, DB::table('customer_connections')->count());
        $this->assertSame('BUD*********', DB::table('customer_connections')->where('idpel', '514530000001')->value('name'));       // masked here, the real name never reaches the table
        $this->assertSame('SIT*****', DB::table('customer_connections')->where('idpel', '514530000002')->value('name'));            // already masked: kept
        $this->assertStringNotContainsString('3573000000000001', json_encode(DB::table('customer_connections')->get()));            // NIK is never read
        $this->assertSame(1, $done['results'][0]['counts']['invalid'] ?? 0);
        $this->assertSame([], array_column($this->as($this->planning)->getJson('/api/master-data/customer-connections/sync')->json('data.files'), 'name'));   // the loaded file moved away
        $this->assertCount(1, glob($this->inbox.'/diproses/*.csv'));

        $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs')->assertStatus(409);                // nothing left to load
    }

    #[Test]
    public function the_energized_date_is_read_from_iso_dd_mm_yyyy_and_the_mdb_export_default_mm_dd_yy_formats(): void
    {
        $row = fn (string $idpel, string $date) => ['IDPEL' => $idpel, 'UNITUP' => $this->ulp->code, 'NAMA' => 'SIT*****', 'TARIF' => 'R1', 'DAYA' => '450', 'STATUS_DIL' => 'AKTIF', 'TGLNYALA_PB' => $date];
        $this->csv('DIL_SALDO_MASK_UP_202603_51453.csv', [
            $row('514530000011', '2019-02-18 00:00:00'),                                                                    // mdb-export -T
            $row('514530000012', '18/02/2019'),                                                                             // CSV export, day first
            $row('514530000013', '02/18/19 00:00:00'),                                                                      // mdb-export default: month first, two-digit year
            $row('514530000014', '12/31/98 00:00:00'),                                                                      // 30 to 99 are the 1900s
            $row('514530000015', '13/45/19 00:00:00'),                                                                      // impossible date: empty, not a wrong date
            $row('514530000016', ''),
        ]);
        $run = $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs')->assertStatus(202)->json('data');
        app(DilSyncService::class)->execute($run['id']);

        $on = DB::table('customer_connections')->pluck('energized_on', 'idpel')->map(fn ($d) => $d === null ? null : substr((string) $d, 0, 10))->all();
        $this->assertSame(['514530000011' => '2019-02-18', '514530000012' => '2019-02-18', '514530000013' => '2019-02-18', '514530000014' => '1998-12-31', '514530000015' => null, '514530000016' => null], $on);
    }

    #[Test]
    public function the_run_loops_over_the_chosen_units_one_failing_unit_does_not_stop_the_others_and_each_unit_reports_its_own_result(): void
    {
        $row = fn (string $idpel) => ['IDPEL' => $idpel, 'UNITUP' => $this->ulp->code, 'NAMA' => 'AB*****', 'STATUS_DIL' => 'AKTIF'];
        $this->csv('DIL_SALDO_MASK_UP_202609_51453.csv', [$row('514530000001'), $row('514530000002')]);
        $this->csv('DIL_SALDO_MASK_UP_202609_51454.csv', [$row('514540000001')]);
        File::put($this->inbox.'/DIL_SALDO_MASK_UP_202609_51455.csv', 'KOLOM,LAIN
1,2
');                                   // a file the loader cannot read
        $svc = app(DilSyncService::class);

        $info = $this->as($this->planning)->getJson('/api/master-data/customer-connections/sync')->assertOk()->json('data');
        $byCode = collect($info['units'])->keyBy('code');
        $this->assertSame([1, 1, 1], [count($byCode['51453']['files']), count($byCode['51454']['files']), count($byCode['51455']['files'])]);   // one entry per unit, with the file waiting for it

        $run = $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs', ['units' => ['51453', '51455']])->assertStatus(202)->json('data');
        $this->assertSame(['51453', '51455'], collect($run['files'])->pluck('ulp_code')->all());                                // 51454 is not part of this run
        $svc->execute($run['id']);
        $done = $svc->show($run['id']);
        $this->assertSame(['PARTIAL', 2, 2], [$done['status'], $done['units_done'], $done['units_total']]);
        $this->assertSame(['OK', 'FAILED'], collect($done['results'])->pluck('status')->all());                                  // the failure of 51455 did not stop the loop (51453 ran first)
        $this->assertSame(['51453', '51455'], collect($done['results'])->pluck('ulp_code')->all());
        $this->assertSame(2, DB::table('customer_connections')->count());
        $left = collect($svc->files())->pluck('name')->sort()->values()->all();
        $this->assertSame(['DIL_SALDO_MASK_UP_202609_51454.csv', 'DIL_SALDO_MASK_UP_202609_51455.csv'], $left);                // the loaded unit moved away; the failed and the unchosen stay

        $after = collect($svc->info()['units'])->keyBy('code');
        $this->assertSame(['OK', 'FAILED', null], [$after['51453']['last_result']['status'], $after['51455']['last_result']['status'], $after['51454']['last_result']['status'] ?? null]);
        $h = $svc->info()['history'][0];                                                                                         // monitoring: which units loaded and which failed, with the reason
        $this->assertSame([$run['id'], 'PARTIAL', 1, 1, '51455'], [$h['id'], $h['status'], $h['units_ok'], $h['units_failed'], $h['failed'][0]['ulp_code']]);
        $this->assertStringContainsString('Kolom wajib', (string) $h['failed'][0]['message']);
        $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs', ['units' => ['99999']])->assertStatus(409);   // a unit without a file: nothing to run
        $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs', ['units' => ['abc']])->assertStatus(422);
    }

    #[Test]
    public function only_users_who_may_import_can_see_or_start_it_and_a_second_run_waits(): void
    {
        $this->csv('DIL_202603_'.$this->ulp->code.'.csv', [['IDPEL' => '514530000009', 'UNITUP' => $this->ulp->code, 'STATUS_DIL' => 'AKTIF']]);
        $this->as($this->vendor)->getJson('/api/master-data/customer-connections/sync')->assertForbidden();
        $this->as($this->vendor)->postJson('/api/master-data/customer-connections/sync/runs')->assertForbidden();

        $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs')->assertStatus(202);              // registered, not executed yet
        $this->as($this->planning)->postJson('/api/master-data/customer-connections/sync/runs')->assertStatus(409);
        $this->assertSame(0, DB::table('customer_connections')->count());
    }
}
