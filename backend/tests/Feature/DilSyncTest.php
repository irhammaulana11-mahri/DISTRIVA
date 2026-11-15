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
        $head = ['IDPEL', 'UNITUP', 'NAMA', 'TARIF', 'DAYA', 'JENISLAYANAN', 'NOMOR_GARDU', 'NAMA_GARDU', 'STATUS_DIL', 'NIK', 'NO_HP'];
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
