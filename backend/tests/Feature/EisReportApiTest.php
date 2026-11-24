<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\EisReportPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class EisReportApiTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $admin;

    private User $niagaA;

    private User $teknikB;

    private User $viewerNoGrant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(EisReportPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpA->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $this->ulpB->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->admin = $mk('SYS_ADMIN', null);
        $this->niagaA = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->viewerNoGrant = $mk('VIEWER', $this->ulpA);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function upload(string $ulp, string $name, string $month = 'April 2026', bool $titled = false): UploadedFile
    {
        $s = new Spreadsheet;
        $ws = $s->getActiveSheet();
        $titled && $ws->setCellValue('B5', 'LAPORAN PENJUALAN TENAGA LISTRIK VERSI PUSAT TOTAL');
        $ws->setCellValue('C3', 'UP3 MOJOKERTO');
        $ws->setCellValue('C4', $ulp);
        $ws->setCellValue('B6', "BULAN :  {$month}");
        $ws->setCellValue('B16', '1');
        $ws->setCellValue('F16', '2');
        $ws->setCellValue('B17', 'JUMLAH');
        $ws->setCellValue('F17', 1000);
        $path = tempnam(sys_get_temp_dir(), 'eis').'.xlsx';
        (new Xlsx($s))->save($path);

        return new UploadedFile($path, $name, null, null, true);
    }

    #[Test]
    public function import_is_limited_to_units_in_scope_and_reports_each_file_separately(): void
    {
        $res = $this->as($this->niagaA)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP JOMBANG', '309-51453-042026.xlsx'), $this->upload('ULP NGORO', '309-51454-042026.xlsx'), $this->upload('ULP JOMBANG', 'asal.xlsx')]], ['Accept' => 'application/json'])->assertOk();
        $r = $res->json('data');
        $this->assertTrue($r[0]['ok']);
        $this->assertSame('BARU', $r[0]['status']);
        $this->assertFalse($r[1]['ok']);
        $this->assertStringContainsString('tidak berwenang', $r[1]['message']);
        $this->assertFalse($r[2]['ok']);
        $this->assertSame(1, DB::table('eis_report_files')->count());
    }

    #[Test]
    public function a_user_without_the_import_grant_is_refused_and_a_sys_admin_may_import_for_any_unit(): void
    {
        $this->as($this->teknikB)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP NGORO', '309-51454-042026.xlsx')]], ['Accept' => 'application/json'])->assertForbidden();
        $this->as($this->viewerNoGrant)->getJson('/api/eis-reports')->assertForbidden();
        $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP NGORO', '309-51454-042026.xlsx')]], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.0.ok', true);
        $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP NGORO', '309-51454-042026.docx')]], ['Accept' => 'application/json'])->assertStatus(422);
    }

    #[Test]
    public function listing_coverage_and_lines_follow_the_unit_scope(): void
    {
        $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP JOMBANG', '309-51453-042026.xlsx'), $this->upload('ULP NGORO', '309-51454-042026.xlsx')]], ['Accept' => 'application/json'])->assertOk();
        $list = $this->as($this->niagaA)->getJson('/api/eis-reports')->assertOk();
        $this->assertSame(['ULP Jombang'], array_column($list->json('data'), 'unit_name'));
        $this->assertSame('2026-04', $list->json('data.0.period'));
        $this->assertCount(2, $this->as($this->admin)->getJson('/api/eis-reports')->json('data'));
        $this->assertCount(1, $this->as($this->admin)->getJson('/api/eis-reports?unit_id='.$this->ulpB->getKey())->json('data'));

        $cov = $this->as($this->niagaA)->getJson('/api/eis-reports/coverage?year=2026&unit_id='.$this->ulpA->getKey())->assertOk();
        $this->assertTrue($cov->json('data.families.309.4'));
        $this->assertFalse($cov->json('data.families.309.5'));
        $this->as($this->niagaA)->getJson('/api/eis-reports/coverage?year=2026&unit_id='.$this->ulpB->getKey())->assertNotFound();

        $fileA = DB::table('eis_report_files')->where('organizational_unit_id', $this->ulpA->getKey())->value('id');
        $fileB = DB::table('eis_report_files')->where('organizational_unit_id', $this->ulpB->getKey())->value('id');
        $this->as($this->niagaA)->getJson("/api/eis-reports/{$fileA}/lines")->assertOk()->assertJsonPath('data.lines.0.label', 'JUMLAH')->assertJsonPath('data.lines.0.values.pelanggan', 1000);
        $this->as($this->niagaA)->getJson("/api/eis-reports/{$fileB}/lines")->assertNotFound();
    }

    #[Test]
    public function the_access_map_for_the_frontend_includes_the_report_keys(): void
    {
        $this->as($this->niagaA)->getJson('/api/planning/access')->assertOk()->assertJson(['can' => ['eis_reports.view' => true, 'eis_reports.import' => true]]);
        $this->as($this->teknikB)->getJson('/api/planning/access')->assertOk()->assertJson(['can' => ['eis_reports.view' => true, 'eis_reports.import' => false]]);
    }

    private function piutang(int $unitCode): string
    {
        $s = new Spreadsheet;
        $s->getActiveSheet()->fromArray([['Grand Total'], ['UNITUP', 'GOLONGAN', 'SKEMA_BAYAR', 'KET_PIUTANG', 'JUMLAH'], [$unitCode, 0, 'NO REGISTER', 'BARU', 144]]);
        $path = tempnam(sys_get_temp_dir(), 'eis').'.xlsx';
        (new Xlsx($s))->save($path);

        return $path;
    }

    #[Test]
    public function zip_berisi_unduhan_eis_apa_adanya_diimpor_per_berkas_dengan_bulan_dari_nama_folder(): void
    {
        $zipPath = tempnam(sys_get_temp_dir(), 'eis').'.zip';
        $zip = new \ZipArchive;
        $zip->open($zipPath, \ZipArchive::CREATE);
        $zip->addFile($this->upload('ULP JOMBANG', 'x', 'Oktober 2026', true)->getRealPath(), 'UP3 MOJOKERTO/JOMBANG/Rekap.xlsx');
        $zip->addFile($this->upload('ULP NGORO', 'x', 'Oktober 2026', true)->getRealPath(), 'UP3 MOJOKERTO/NGORO/Rekap.xlsx');
        $zip->addFile($this->piutang(51454), 'UP3 MOJOKERTO/NGORO/2026-10/Rekap (1).xlsx');
        $zip->addFile($this->piutang(51453), 'UP3 MOJOKERTO/JOMBANG/Rekap (1).xlsx');   // tanpa folder bulan: ditolak per berkas
        $zip->addFromString('UP3 MOJOKERTO/catatan.txt', 'bukan excel');
        $zip->addFromString('__MACOSX/UP3 MOJOKERTO/._Rekap.xlsx', 'sampah');
        $zip->close();

        $res = $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [new UploadedFile($zipPath, 'oktober.zip', null, null, true)]], ['Accept' => 'application/json'])->assertOk();

        $byName = collect($res->json('data'))->keyBy('name');
        $this->assertCount(5, $byName);
        $this->assertSame(['309', 'ULP Jombang', '2026-10'], [$byName['oktober.zip › UP3 MOJOKERTO/JOMBANG/Rekap.xlsx']['family'], $byName['oktober.zip › UP3 MOJOKERTO/JOMBANG/Rekap.xlsx']['unit'], $byName['oktober.zip › UP3 MOJOKERTO/JOMBANG/Rekap.xlsx']['period']]);
        $this->assertSame('ULP Ngoro', $byName['oktober.zip › UP3 MOJOKERTO/NGORO/Rekap.xlsx']['unit']);
        $this->assertSame(['PIUTANGLPB_EIS', '2026-10'], [$byName['oktober.zip › UP3 MOJOKERTO/NGORO/2026-10/Rekap (1).xlsx']['family'], $byName['oktober.zip › UP3 MOJOKERTO/NGORO/2026-10/Rekap (1).xlsx']['period']]);
        $this->assertStringContainsString('pilih bulan', $byName['oktober.zip › UP3 MOJOKERTO/JOMBANG/Rekap (1).xlsx']['message']);
        $this->assertStringContainsString('Bukan berkas Excel', $byName['oktober.zip › UP3 MOJOKERTO/catatan.txt']['message']);
        $this->assertSame(3, DB::table('eis_report_files')->count());

        // pilihan bulan pada form melengkapi berkas yang tidak menyebut bulan
        $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [new UploadedFile($this->piutang(51453), 'Rekap.xlsx', null, null, true)], 'period' => '2026-09'], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('data.0.period', '2026-09')->assertJsonPath('data.0.unit', 'ULP Jombang');
        // pilihan unit di luar kewenangan ditolak
        $this->as($this->niagaA)->post('/api/eis-reports/import', ['files' => [new UploadedFile($this->piutang(51453), 'Rekap.xlsx', null, null, true)], 'unit_id' => $this->ulpB->getKey()], ['Accept' => 'application/json'])->assertForbidden();
    }

    #[Test]
    public function kelengkapan_satu_up3_menampilkan_tiap_ulp_dan_laporan_yang_belum_masuk(): void
    {
        $this->as($this->admin)->post('/api/eis-reports/import', ['files' => [$this->upload('ULP JOMBANG', '309-51453-042025.xlsx', 'April 2025')]], ['Accept' => 'application/json'])->assertOk();

        $cov = $this->as($this->admin)->getJson('/api/eis-reports/coverage?year=2025&up3_id='.$this->up3->getKey())->assertOk();
        $this->assertSame(12, $cov->json('data.expected_until_month'));
        $units = collect($cov->json('data.units'))->keyBy('unit_name');
        $this->assertSame(['ULP Jombang', 'ULP Ngoro'], $units->keys()->sort()->values()->all());
        $families = count($cov->json('data.families_list'));
        $this->assertTrue($units['ULP Jombang']['families']['309'][4]);
        $this->assertSame($families * 12 - 1, $units['ULP Jombang']['missing_count']);
        $this->assertNotContains(['family' => '309', 'month' => 4], $units['ULP Jombang']['missing']);
        $this->assertSame($families * 12, $units['ULP Ngoro']['missing_count']);
        $this->assertSame($families * 12 * 2 - 1, $cov->json('data.missing_total'));

        // peran ULP hanya melihat ULP-nya
        $own = $this->as($this->niagaA)->getJson('/api/eis-reports/coverage?year=2025&up3_id='.$this->up3->getKey())->assertOk();
        $this->assertSame(['ULP Jombang'], array_column($own->json('data.units'), 'unit_name'));
        $this->as($this->admin)->getJson('/api/eis-reports/coverage?year=2025')->assertStatus(422);
    }
}
