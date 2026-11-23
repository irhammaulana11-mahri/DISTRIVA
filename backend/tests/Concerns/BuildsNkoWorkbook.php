<?php

namespace Tests\Concerns;

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/** Workbook NKO kecil bertata letak sama dengan workbook realisasi, untuk tes impor dan perhitungan (docs/89, docs/90). */
trait BuildsNkoWorkbook
{
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
}
