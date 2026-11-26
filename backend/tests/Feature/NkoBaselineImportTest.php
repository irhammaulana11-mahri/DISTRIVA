<?php

namespace Tests\Feature;

use App\Services\Nko\NkoBaselineImportService;
use App\Services\Nko\NkoImportException;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Impor baseline adjustment (BA) Penjualan TL dari tab "PENJUALAN TL" workbook TRP (docs/90). */
class NkoBaselineImportTest extends PostgresTestCase
{
    /** Tab bertata letak workbook TRP: judul blok di kolom A, "NO." dan "ULP" di baris judul kolom, baris ULP bernomor, baris UP3 sebagai jumlah. */
    private function workbook(?string $sheetName = 'PENJUALAN TL', int $deltaYear = 2026): string
    {
        $book = new Spreadsheet;
        $ws = $book->getActiveSheet();
        $ws->setTitle($sheetName);
        $blocks = [[1, 'TARGET KWH JUAL BULANAN TAHUN 2026 satuan kWh ==> Polarisasi Positif', ['JOMBANG' => 47_241_668.5, 'NGORO' => 30_000_000.0]],
            [17, 'TARGET KWH JUAL KOMULATIF TAHUN 2026 satuan kWh ==> Polarisasi Positif', ['JOMBANG' => 1.0, 'NGORO' => 1.0]],
            [33, "TARGET DELTA KWH JUAL BULANAN TAHUN {$deltaYear} satuan kWh ==> Polarisasi Positif", ['JOMBANG' => 2_668_693.5, 'NGORO' => 1_000_000.0]]];
        foreach ($blocks as [$row, $title, $units]) {
            $ws->setCellValue("A{$row}", $title);
            $ws->setCellValue('A'.($row + 1), 'NO.');
            $ws->setCellValue('B'.($row + 1), 'ULP');
            $n = 0;
            foreach ($units as $name => $jan) {
                $r = $row + 3 + $n;
                $ws->setCellValue("A{$r}", ++$n);
                $ws->setCellValue("B{$r}", $name);
                $ws->setCellValue("C{$r}", $jan);
                $ws->setCellValue("D{$r}", $jan + 100);
            }
            $ws->setCellValue('B'.($row + 3 + $n), 'UP3 MOJOKERTO');
            $ws->setCellValue('C'.($row + 3 + $n), 999);
        }
        $ws->setCellValue('B6', 'BEKASI');   // ULP yang tidak dikenal dilewati
        $path = tempnam(sys_get_temp_dir(), 'ba').'.xlsx';
        (new Xlsx($book))->save($path);

        return $path;
    }

    #[Test]
    public function baseline_adalah_target_jual_bulanan_dikurangi_target_delta_per_ulp_dan_impor_ulang_memperbarui(): void
    {
        $up3 = $this->makeUnit('UP3');
        $jombang = $this->makeUnit('ULP', $up3);
        $jombang->forceFill(['name' => 'ULP Jombang'])->save();
        $ngoro = $this->makeUnit('ULP', $up3);
        $ngoro->forceFill(['name' => 'ULP Ngoro'])->save();
        $path = $this->workbook();

        $r = app(NkoBaselineImportService::class)->import($path, 'trp.xlsx');

        $this->assertSame(2026, $r['year']);
        $this->assertSame([2, 4], [$r['units'], $r['rows']]);                       // 2 ULP x 2 bulan terisi (Januari, Februari); bulan kosong dilewati
        $value = fn ($unit, int $month) => DB::table('kpi_baselines')->where('organizational_unit_id', $unit->id)->where('year', 2026)->where('month', $month)->value('value');
        $this->assertEqualsWithDelta(47_241_668.5 - 2_668_693.5, $value($jombang, 1), 1e-6);
        $this->assertEqualsWithDelta(47_241_768.5 - 2_668_793.5, $value($jombang, 2), 1e-6);
        $this->assertEqualsWithDelta(29_000_000.0, $value($ngoro, 1), 1e-6);
        $this->assertSame(0, DB::table('kpi_baselines')->where('organizational_unit_id', $up3->id)->count());   // UP3 dijumlahkan dari ULP, tidak disimpan

        app(NkoBaselineImportService::class)->import($path, 'trp-ulang.xlsx');
        $this->assertSame(4, DB::table('kpi_baselines')->count());                  // impor ulang memperbarui, tidak menggandakan
        $this->assertSame('trp-ulang.xlsx', DB::table('kpi_baselines')->value('source'));
        @unlink($path);
    }

    #[Test]
    public function tab_atau_tahun_yang_tidak_sesuai_ditolak_dengan_pesan_jelas(): void
    {
        $path = $this->workbook('LAIN');
        try {
            app(NkoBaselineImportService::class)->import($path, 'x.xlsx');
            $this->fail('Tab yang tidak ada seharusnya ditolak.');
        } catch (NkoImportException $e) {
            $this->assertStringContainsString('PENJUALAN TL', $e->getMessage());
        }
        @unlink($path);

        $path = $this->workbook('PENJUALAN TL', 2025);
        $this->expectException(NkoImportException::class);
        $this->expectExceptionMessage('berbeda');
        app(NkoBaselineImportService::class)->import($path, 'x.xlsx');
    }
}
