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

    private function upload(string $ulp, string $name, string $month = 'April 2026'): UploadedFile
    {
        $s = new Spreadsheet;
        $ws = $s->getActiveSheet();
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
}
