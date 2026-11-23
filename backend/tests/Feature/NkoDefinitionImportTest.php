<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoImportException;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PHPUnit\Framework\Attributes\Test;
use Tests\Concerns\BuildsNkoWorkbook;
use Tests\PostgresTestCase;

class NkoDefinitionImportTest extends PostgresTestCase
{
    use BuildsNkoWorkbook;

    protected function setUp(): void
    {
        parent::setUp();
        $up3 = $this->makeUnit('UP3');
        $up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $ulp = $this->makeUnit('ULP', $up3);
        $ulp->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
    }

    #[Test]
    public function memuat_definisi_polaritas_bobot_target_dan_aturan_per_tingkat_unit(): void
    {
        $r = app(NkoDefinitionImportService::class)->import($this->workbook(), 'nko.xlsx');

        $this->assertSame(2026, $r['year']);
        $this->assertSame(['UP3', 'ULP'], array_column($r['sets'], 'level'));
        $this->assertSame(['BARU', 'BARU'], array_column($r['sets'], 'status'));

        $ulp = DB::table('kpi_definition_sets')->where('unit_level', 'ULP')->first();
        $this->assertSame('AKTIF', $ulp->status);
        $saidi = DB::table('kpi_definitions')->where('set_id', $ulp->id)->where('code', 'saidi')->first();
        $this->assertSame(1, (int) $saidi->polarity);
        $this->assertSame('SAIDI', $saidi->source_sheet);
        $this->assertSame('STANDARD', $saidi->scoring_rule);
        $this->assertSame('ITEM', $saidi->nilai_rule);
        $this->assertSame(6.0, (float) $saidi->weight);
        $parent = DB::table('kpi_definitions')->where('id', $saidi->parent_id)->first();
        $this->assertSame('keandalan-penyaluran-tenaga-listrik', $parent->code);

        $sales = DB::table('kpi_definitions')->where('set_id', $ulp->id)->where('code', 'penjualan-tenaga-listrik')->first();
        $this->assertSame('FLOOR_60', $sales->scoring_rule);
        $this->assertSame('PENJUALAN TL', $sales->source_sheet);

        $jombang = OrganizationalUnit::query()->where('code', '51453')->value('id');
        $feb = DB::table('kpi_targets')->where('definition_id', $saidi->id)->where('organizational_unit_id', $jombang)->where('period', '2026-02-01')->first();
        $this->assertSame(7.0, (float) $feb->target_value);
        $this->assertSame(2, DB::table('kpi_targets')->where('definition_id', $saidi->id)->count());

        $months = json_decode($ulp->month_rules, true)['months'];
        $this->assertSame('=SUM(AC11:AC14)', $months['1']['total_formula']);
        $this->assertStringContainsString('(100-$F$13)', $months['1']['final_formula']);
    }

    #[Test]
    public function impor_ulang_isi_sama_tidak_membuat_versi_dan_isi_berbeda_menggantikan(): void
    {
        $svc = app(NkoDefinitionImportService::class);
        $original = $this->workbook();   // berkas yang sama dipakai ulang: xlsx yang dibangun ulang memuat cap waktu sehingga isinya berbeda
        $svc->import($original, 'nko.xlsx');

        $same = $svc->import($original, 'nko.xlsx');
        $this->assertSame(['DUPLIKAT', 'DUPLIKAT'], array_column($same['sets'], 'status'));
        $this->assertSame(2, DB::table('kpi_definition_sets')->count());

        $changed = $svc->import($this->workbook(saidiWeight: 7), 'nko-rev.xlsx');
        $this->assertSame(['DIGANTIKAN', 'DIGANTIKAN'], array_column($changed['sets'], 'status'));
        $this->assertSame(2, DB::table('kpi_definition_sets')->where('status', 'AKTIF')->count());
        $this->assertSame(2, DB::table('kpi_definition_sets')->where('status', 'ARSIP')->count());
        $this->assertSame(2, (int) DB::table('kpi_definition_sets')->where('status', 'AKTIF')->where('unit_level', 'ULP')->value('version'));

        $old = $svc->import($original, 'nko.xlsx');
        $this->assertSame(['SUDAH_DIGANTIKAN', 'SUDAH_DIGANTIKAN'], array_column($old['sets'], 'status'));
        $this->assertSame(2, DB::table('kpi_definition_sets')->where('status', 'AKTIF')->count());
    }

    #[Test]
    public function unit_tidak_dikenal_dilaporkan_dan_targetnya_dilewati(): void
    {
        $r = app(NkoDefinitionImportService::class)->import($this->workbook(['ULP JOMBANG', 'ULP BARU']), 'nko.xlsx');

        $this->assertSame(['JOMBANG'], $r['sets'][0]['units']);
        $this->assertStringContainsString('ULP BARU: unit tidak ada di master unit', implode(' ', $r['sets'][0]['warnings']));
    }

    #[Test]
    public function perbedaan_definisi_antar_tab_sejenis_dilaporkan(): void
    {
        $path = $this->workbook(['ULP JOMBANG', 'ULP BARU']);
        $book = IOFactory::load($path);
        $book->getSheetByName('ULP BARU')->setCellValue('F13', 9);
        $this->save($book, $path);

        $r = app(NkoDefinitionImportService::class)->import($path, 'nko.xlsx');

        $this->assertStringContainsString('weight indikator "SAIDI" berbeda', implode(' ', $r['sets'][0]['warnings']));
    }

    #[Test]
    public function workbook_tanpa_tab_nko_ditolak(): void
    {
        $book = new Spreadsheet;
        $book->getActiveSheet()->setTitle('Lain');
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        $this->save($book, $path);

        $this->expectException(NkoImportException::class);
        app(NkoDefinitionImportService::class)->import($path, 'x.xlsx');
    }
}
