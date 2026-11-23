<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoImportException;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class NkoDefinitionImportTest extends PostgresTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $up3 = $this->makeUnit('UP3');
        $up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $ulp = $this->makeUnit('ULP', $up3);
        $ulp->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
    }

    /**
     * Workbook kecil bertata letak NKO: dua kelompok, satu indikator berpolaritas 1 (SAIDI) dan satu 3 (penjualan), target kumulatif Jan-Feb.
     *
     * @param  list<string>  $tabs
     */
    private function workbook(array $tabs = ['UP3 MOJOKERTO', 'ULP JOMBANG'], float $saidiWeight = 6, ?string $unitMissingTab = null): string
    {
        $book = new Spreadsheet;
        $book->removeSheetByIndex(0);
        foreach ($tabs as $i => $name) {
            $ws = $book->createSheet($i);
            $ws->setTitle($name);
            foreach (['A9' => 'NO', 'B9' => 'KPI', 'C9' => 'POLARITAS', 'D9' => 'FORMULA', 'E9' => 'SATUAN', 'F9' => 'BOBOT', 'H9' => 'TARGET 2026', 'Z9' => 'TARGET JANUARI', 'AA9' => 'REALISASI JANUARI', 'AB9' => 'PENCAPAIAN (%)', 'AC9' => 'NILAI',
                'AH9' => 'TARGET FEBRUARI', 'AI9' => 'REALISASI FEBRUARI', 'AJ9' => 'PENCAPAIAN (%)', 'AK9' => 'NILAI', 'M10' => 'JAN', 'N10' => 'FEB'] as $c => $v) {
                $ws->setCellValueExplicit($c, $v, 's');
            }
            $ws->setCellValue('AC10', '=SUM(AC11:AC14)');
            // kelompok 1: penjualan (kelompok sekaligus indikator)
            $ws->setCellValueExplicit('A11', '1', 's');
            $ws->setCellValueExplicit('B11', 'Penjualan Tenaga Listrik', 's');
            $ws->setCellValue('C11', 3);
            $ws->setCellValueExplicit('E11', 'GWh', 's');
            $ws->setCellValue('F11', 14);
            $ws->setCellValue('M11', 2.5);
            $ws->setCellValue('N11', 5.1);
            $ws->setCellValue('AA11', "='[48]PENJUALAN TL'!\$C\$144/1000000");
            $ws->setCellValue('AB11', '=IF(AA11/Z11<1,(AA11/Z11)*0.4+0.6,IF(AA11/Z11>=1.1,1.1,AA11/Z11))*100');
            $ws->setCellValue('AC11', '=IF(AB11<=0,0,IF(AB11<=110,AB11/100*F11,IF(AB11>110,F11*1.1,0)))');
            // kelompok 3 dengan indikator a. SAIDI
            $ws->setCellValueExplicit('A12', '3', 's');
            $ws->setCellValueExplicit('B12', 'Keandalan Penyaluran Tenaga Listrik', 's');
            $ws->setCellValue('F12', 14);
            $ws->setCellValueExplicit('B13', 'a. SAIDI (sesuai kewenangan)', 's');
            $ws->setCellValue('C13', 1);
            $ws->setCellValueExplicit('E13', 'menit/plg', 's');
            $ws->setCellValue('F13', $saidiWeight);
            $ws->setCellValue('M13', 3.7);
            $ws->setCellValue('N13', 7.0);
            $ws->setCellValue('AA13', "='[48] SAIDI'!\$F\$23");
            $ws->setCellValue('AB13', '=IFERROR((IF(ISBLANK($C13),"",IF(AND($C13=1,$E13>0,(2-(AA13/Z13))<=0),0,(2-(AA13/Z13))*1))*100),0)');
            $ws->setCellValue('AC13', '=IF(AB13<=0,0,IF(AB13<=110,AB13/100*F13,IF(AB13>110,F13*1.1,0)))');
            $ws->setCellValueExplicit('B15', 'TOTAL', 's');
            $ws->setCellValueExplicit('A16', 'Note : target disesuaikan', 's');
            $ws->setCellValue('AC16', '=+AC15/(100-$F$13)*100');
        }
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        $this->save($book, $path);

        return $path;
    }

    private function save(Spreadsheet $book, string $path): void
    {
        $writer = new Xlsx($book);
        $writer->setPreCalculateFormulas(false);
        $writer->save($path);
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
        $svc->import($this->workbook(), 'nko.xlsx');

        $same = $svc->import($this->workbook(), 'nko.xlsx');
        $this->assertSame(['DUPLIKAT', 'DUPLIKAT'], array_column($same['sets'], 'status'));
        $this->assertSame(2, DB::table('kpi_definition_sets')->count());

        $changed = $svc->import($this->workbook(saidiWeight: 7), 'nko-rev.xlsx');
        $this->assertSame(['DIGANTIKAN', 'DIGANTIKAN'], array_column($changed['sets'], 'status'));
        $this->assertSame(2, DB::table('kpi_definition_sets')->where('status', 'AKTIF')->count());
        $this->assertSame(2, DB::table('kpi_definition_sets')->where('status', 'ARSIP')->count());
        $this->assertSame(2, (int) DB::table('kpi_definition_sets')->where('status', 'AKTIF')->where('unit_level', 'ULP')->value('version'));

        $old = $svc->import($this->workbook(), 'nko.xlsx');
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
