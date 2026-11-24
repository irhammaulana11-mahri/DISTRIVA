<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoRealizationResolver;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class BusinessAnalyticsTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $planner;

    private User $viewer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(NkoPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpA->forceFill(['name' => 'ULP A'])->save();
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $this->ulpB->forceFill(['name' => 'ULP B'])->save();
        $this->planner = $this->makeUser();
        $this->assign($this->planner, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->up3);
        $this->viewer = $this->makeUser();
        $this->assign($this->viewer, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** @param list<array{0: string, 1: array<string, mixed>}> $lines */
    private function report(OrganizationalUnit $unit, string $family, string $period, array $lines, array $summary = []): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => $family, 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "{$family}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => json_encode($summary), 'line_count' => count($lines), 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ($lines as $i => [$label, $values]) {
            DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => $i + 1, 'label' => $label, 'values' => json_encode($values)]);
        }
    }

    private function sales(OrganizationalUnit $unit, string $period, float $kwhR, float $kwhB): void
    {
        $this->report($unit, '309', $period, [['JUMLAH R', ['kwh_jumlah' => $kwhR]], ['JUMLAH B', ['kwh_jumlah' => $kwhB]], ['JUMLAH', ['kwh_jumlah' => $kwhR + $kwhB, 'pelanggan' => 10, 'daya_va' => 1000, 'rp_jumlah' => 0]]]);
    }

    #[Test]
    public function up3_menggabungkan_ulp_dengan_pembanding_tahun_lalu_kumulatif_rincian_dan_kelengkapan(): void
    {
        foreach (['2025-01-01' => [60, 40], '2025-02-01' => [70, 30], '2026-01-01' => [80, 40], '2026-02-01' => [90, 30]] as $period => [$r, $b]) {
            $this->sales($this->ulpA, $period, $r, $b);
        }
        foreach (['2025-01-01', '2025-02-01', '2026-01-01'] as $period) {   // ULP B belum mengunggah Februari 2026
            $this->sales($this->ulpB, $period, 50, 0);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}&from=2026-01&to=2026-02")->assertOk()->json('data');

        $this->assertSame(['2026-01', '2026-02'], $d['months']);
        $this->assertEquals([170, 120], $d['series'][0]['values']);
        $this->assertEquals([150, 150], $d['series'][0]['previous_year']);
        $s = $d['summary'][0];
        $this->assertEquals(120, $s['latest']);
        $this->assertEqualsWithDelta(20.0, $s['yoy_pct'], 1e-9);   // setara: hanya ULP A (ULP B belum melapor Februari 2026): 120 lawan 100, bukan 120 lawan 150
        $this->assertSame([2, 1], $d['units_reporting']);
        $this->assertSame(2, $d['units_expected']);
        $this->assertEquals(290, $s['ytd']);   // kumulatif memakai bulan yang ada; ULP B Februari kosong dilaporkan pada kelengkapan
        $this->assertEquals(300, $s['ytd_previous_year']);
        $this->assertEqualsWithDelta(20.0, $s['ytd_pct'], 1e-9);   // setara: ULP A 240 lawan 200
        $this->assertSame('Rumah tangga', $d['breakdown']['rows'][0]['key']);
        $this->assertEqualsWithDelta(75.0, $d['breakdown']['rows'][0]['share_pct'], 1e-9);
        $this->assertSame(['ULP A', 'ULP B'], array_column($d['comparison'], 'unit_name'));
        $this->assertSame([['unit_id' => $this->ulpB->id, 'unit_name' => 'ULP B', 'months' => ['2026-02']]], $d['coverage']['missing']);
        $this->assertSame('perhatian', $d['insights'][0]['level']);
        $this->assertStringContainsString('hanya mencakup 1 dari 2 ULP', $d['insights'][0]['text']);
    }

    #[Test]
    public function waktu_respons_gangguan_tertimbang_jumlah_kejadian_tanpa_baris_total(): void
    {
        $this->report($this->ulpA, 'GGNALL', '2026-03-01', [['POSKO A', ['total' => 10, 'response_rata_menit' => 20, 'recovery_rata_menit' => 60, 'response_dalam_sla' => 8, 'response_lewat_sla' => 2]],
            ['Total', ['total' => 10, 'response_rata_menit' => 20, 'recovery_rata_menit' => 60, 'response_dalam_sla' => 8, 'response_lewat_sla' => 2]]]);
        $this->report($this->ulpB, 'GGNALL', '2026-03-01', [['POSKO B', ['total' => 30, 'response_rata_menit' => 40, 'recovery_rata_menit' => 100, 'response_dalam_sla' => 15, 'response_lewat_sla' => 15]]]);

        $s = collect($this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data.summary'))->keyBy('key');

        $this->assertEqualsWithDelta(35.0, $s['rpt']['latest'], 1e-9);   // (20x10 + 40x30) / 40
        $this->assertEqualsWithDelta(90.0, $s['rct']['latest'], 1e-9);
        $this->assertEquals(40, $s['jumlah']['latest']);
        $this->assertEqualsWithDelta(57.5, $s['rpt_sla']['latest'], 1e-9);
    }

    #[Test]
    public function peran_ulp_hanya_melihat_ulp_sendiri(): void
    {
        $this->sales($this->ulpB, '2026-01-01', 1, 1);

        $units = $this->as($this->viewer)->getJson('/api/pengusahaan/metrics')->assertOk()->json('data.units');
        $this->assertSame([$this->ulpA->id], array_column($units, 'id'));
        $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpB->id}")->assertNotFound();
        $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}")->assertNotFound();
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/tidak-ada?unit_id={$this->up3->id}")->assertNotFound();
        $this->assertCount(3, $this->as($this->planner)->getJson('/api/pengusahaan/metrics')->json('data.units'));
    }

    #[Test]
    public function susut_dari_masukan_bulanan_kwh_beli_dan_kwh_jual_309_bulanan_dan_kumulatif(): void
    {
        $this->sales($this->ulpA, '2026-01-01', 900, 0);
        $this->sales($this->ulpA, '2026-02-01', 950, 0);
        $put = fn (array $items) => $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => $items]);
        $put([['period' => '2026-01', 'code' => 'kwh-beli', 'value' => 1000], ['period' => '2026-01', 'code' => 'e-min', 'value' => 20], ['period' => '2026-01', 'code' => 'pssd', 'value' => 30],
            ['period' => '2026-02', 'code' => 'kwh-beli', 'value' => 1000]])->assertOk()->assertJsonPath('changed', 4);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-01&to=2026-02")->assertOk()->json('data');
        $this->assertEqualsWithDelta(50 / 950 * 100, $d['series'][0]['values'][0], 1e-9);   // (1000 - 20 - 30 - 900) / 950
        $this->assertEqualsWithDelta(5.0, $d['series'][0]['values'][1], 1e-9);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $d['summary'][0]['ytd'], 1e-9);   // kumulatif = jumlah susut / jumlah beli bersih

        $nko = app(NkoRealizationResolver::class)->systemValues($this->ulpA->id, 2026, 2);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $nko['susut-distribusi-tanpa-e-min'], 1e-9);   // NKO memakai masukan bulanan yang sama

        $grid = $this->as($this->planner)->getJson("/api/pengusahaan/inputs?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data');
        $this->assertEquals(1000, $grid['months'][0]['inputs']['kwh-beli']['value']);
        $this->assertNull($grid['months'][2]['inputs']['kwh-beli']);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $grid['months'][1]['susut_kumulatif_pct'], 1e-9);
        $this->assertTrue($grid['can_edit']);

        $put([['period' => '2026-02', 'code' => 'kwh-beli', 'value' => 1000]])->assertOk()->assertJsonPath('changed', 0);
        $put([['period' => '2026-02', 'code' => 'kwh-beli', 'value' => null]])->assertOk()->assertJsonPath('changed', 1);
        $this->assertNull($this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-02&to=2026-02")->json('data.series.0.values.0'));
    }

    #[Test]
    public function masukan_bulanan_hanya_untuk_pengisi_berwenang_pada_ulp(): void
    {
        $item = [['period' => '2026-01', 'code' => 'kwh-beli', 'value' => 1]];
        $this->as($this->viewer)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => $item])->assertForbidden();
        $this->assertFalse($this->as($this->viewer)->getJson("/api/pengusahaan/inputs?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data.can_edit'));
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->up3->id, 'items' => $item])->assertNotFound();   // masukan hanya per ULP
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => [['period' => '2026-01', 'code' => 'kwh-jual', 'value' => 1]]])->assertStatus(422);
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => [['period' => '2026-01', 'code' => 'kwh-beli', 'value' => -5]]])->assertStatus(422);
    }

    #[Test]
    public function templat_excel_diisi_lalu_diimpor_dan_ditolak_seluruhnya_bila_ada_baris_salah(): void
    {
        $other = $this->makeUnit('UP3');
        $foreign = $this->makeUnit('ULP', $other);
        $download = $this->as($this->planner)->get("/api/pengusahaan/inputs/template?year=2026&unit_id={$this->up3->id}")->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'kb').'.xlsx';
        file_put_contents($path, $download->streamedContent());
        $book = IOFactory::load($path);
        $ws = $book->getActiveSheet();
        $this->assertSame(['KODE ULP', 'NAMA ULP', 'BULAN', 'KWH BELI', 'PSSD', 'E-MIN', 'CATATAN'], $ws->rangeToArray('A1:G1')[0]);
        $this->assertSame(25, $ws->getHighestRow());   // 2 ULP x 12 bulan + judul
        $ws->setCellValue('D2', 1000);   // baris ULP pertama, Januari 2026
        $ws->setCellValue('E2', 30);
        $ws->setCellValueExplicit('D3', '1.200.000,5', 's');   // teks format Indonesia
        (new Xlsx($book))->save($path);
        $upload = fn () => new UploadedFile($path, 'kwh.xlsx', null, null, true);

        $r = $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertOk()->json('data');
        $this->assertSame(['rows' => 3, 'changed' => 3, 'unchanged' => 0], $r);
        $first = $ws->getCell('A2')->getValue();
        $unitId = DB::table('organizational_units')->where('code', $first)->value('id');
        $this->assertEquals(1000, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-01-01'])->value('value'));
        $this->assertEquals(1200000.5, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-02-01'])->value('value'));
        $this->assertEquals(30, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'pssd', 'period' => '2026-01-01'])->value('value'));
        $this->assertSame(0, $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->json('data.changed'));

        $ws->setCellValue('D2', 5000);
        $ws->setCellValueExplicit('A26', (string) $foreign->code, 's');
        $ws->setCellValue('C26', '2026-01');
        $ws->setCellValue('D26', 10);
        (new Xlsx($book))->save($path);
        $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertStatus(422)->assertJsonFragment(['message' => "Impor dibatalkan, perbaiki baris berikut: Baris 26: {$foreign->name} di luar kewenangan Anda."]);
        $this->assertEquals(1000, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-01-01'])->value('value'));   // tidak ada yang tersimpan

        $this->as($this->viewer)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertForbidden();
        $this->as($this->viewer)->get('/api/pengusahaan/inputs/template?year=2026')->assertForbidden();
    }
}
