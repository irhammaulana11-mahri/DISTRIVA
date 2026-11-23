<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\EisReports\EisReportException;
use App\Services\EisReports\EisReportImportService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class EisReportImportTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    private OrganizationalUnit $ulpOther;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('documents');
        $this->up3 = $this->makeUnit('UP3');
        $this->up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $this->ulp->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
        $this->ulpOther = $this->makeUnit('ULP', $this->up3);
        $this->ulpOther->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
    }

    /** @param list<list<mixed>> $rows baris 1.. ; null = sel kosong */
    private function book(array $rows): string
    {
        $s = new Spreadsheet;
        $ws = $s->getActiveSheet();
        foreach ($rows as $r => $cells) {
            foreach ($cells as $c => $v) {
                $v !== null && $ws->setCellValueExplicit([$c + 1, $r + 1], $v, is_string($v) ? 's' : 'n');
            }
        }
        $path = tempnam(sys_get_temp_dir(), 'eis').'.xlsx';
        (new Xlsx($s))->save($path);

        return $path;
    }

    private function report309(string $ulpName = 'ULP JOMBANG', string $month = 'April 2026', int $plg = 1352): string
    {
        return $this->book([
            2 => [null, null, 'UP3 MOJOKERTO'], 3 => [null, null, $ulpName], 4 => [null, 'LAPORAN PENJUALAN TENAGA LISTRIK'], 5 => [null, "BULAN :  {$month}"],
            15 => [null, '1', null, null, null, '2', '3', '4=5+6'],
            16 => [null, 'S.1 / 450  VA I', null, null, null, $plg, 608400, '90,653.2', '47,742.2', 0, 0, 3672000, null, 10899085],
            17 => [null, 'II', null, null, null, 0, 0, 0, '15,855'],
            18 => [null, 'JUMLAH', null, null, null, $plg + 100, 6084000, '100,000.5', null, null, null, 3672000, null, 10899085],
        ]);
    }

    private function service(): EisReportImportService
    {
        return app(EisReportImportService::class);
    }

    #[Test]
    public function a_309_report_is_stored_by_label_with_its_row_numbers_and_numbers_with_thousand_commas_are_read(): void
    {
        $r = $this->service()->import($this->report309(), '309-51453-042026.xlsx');
        $this->assertSame('BARU', $r['status']);
        $this->assertSame(3, $r['lines']);
        $line = DB::table('eis_report_lines')->where('label', 'S.1 / 450  VA I')->first();
        $this->assertSame(17, $line->line_no);
        $v = json_decode($line->values, true);
        $this->assertEquals(1352, $v['pelanggan']);
        $this->assertEquals(90653.2, $v['kwh_jumlah']);
        $this->assertEquals(10899085, $v['rp_kwh']);
        $tier = json_decode(DB::table('eis_report_lines')->where('label', 'II')->value('values'), true);
        $this->assertEquals(15855, $tier['kwh_lwbp']);
        $this->assertSame('S.1 / 450  VA I', DB::table('eis_report_lines')->where('label', 'II')->value('group_label'));
        $this->assertSame($this->ulp->getKey(), DB::table('eis_report_files')->value('organizational_unit_id'));
        Storage::disk('documents')->assertExists(EisReportImportService::storageKey(DB::table('eis_report_files')->first()));
    }

    #[Test]
    public function the_same_content_is_not_imported_twice_and_changed_content_replaces_the_active_file_but_keeps_the_history(): void
    {
        $this->assertSame('BARU', $this->service()->import($this->report309(), '309-51453-042026.xlsx')['status']);
        $this->assertSame('DUPLIKAT', $this->service()->import($this->report309(), '309-51453-042026.xlsx')['status']);
        $this->assertSame('DIGANTIKAN', $this->service()->import($this->report309(plg: 1400), '309-51453-042026.xlsx')['status']);
        $this->assertSame(1, DB::table('eis_report_files')->where('status', 'AKTIF')->count());
        $this->assertSame(1, DB::table('eis_report_files')->where('status', 'DIGANTIKAN')->count());
        $active = DB::table('eis_report_files')->where('status', 'AKTIF')->value('id');
        $this->assertEquals(1400, json_decode(DB::table('eis_report_lines')->where('file_id', $active)->where('line_no', 17)->value('values'), true)['pelanggan']);
    }

    #[Test]
    public function a_file_whose_month_or_unit_disagrees_with_its_name_is_refused(): void
    {
        try {
            $this->service()->import($this->report309(month: 'Mei 2026'), '309-51453-042026.xlsx');
            $this->fail('bulan berbeda harus ditolak');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('berbeda dengan nama berkas', $e->getMessage());
        }
        try {
            $this->service()->import($this->report309('ULP NGORO'), '309-51453-042026.xlsx');
            $this->fail('unit berbeda harus ditolak');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('tidak cocok dengan isi berkas', $e->getMessage());
        }
        $this->expectException(EisReportException::class);
        $this->service()->import($this->report309(), 'laporan-april.xlsx');
    }

    #[Test]
    public function an_unknown_unit_code_is_recovered_from_the_content_with_a_warning_and_an_unknown_unit_is_refused(): void
    {
        $r = $this->service()->import($this->report309(), '309-15453-042026.xlsx');
        $this->assertSame('ULP Jombang', $r['unit']);
        $this->assertStringContainsString('dibaca dari isi berkas', $r['warnings'][0]);
        $this->expectException(EisReportException::class);
        $this->expectExceptionMessage('tidak ada pada master unit aktif');
        $this->service()->import($this->report309('ULP PONOROGO'), '309-51540-042026.xlsx');
    }

    #[Test]
    public function an_actor_outside_the_unit_scope_cannot_import_for_that_unit(): void
    {
        $this->expectException(EisReportException::class);
        $this->expectExceptionMessage('tidak berwenang');
        $this->service()->import($this->report309(), '309-51453-042026.xlsx', null, [$this->ulpOther->getKey()]);
    }

    #[Test]
    public function difi_reads_the_header_with_decimal_commas_and_the_cause_table_and_a_sheet_without_known_layout_is_refused(): void
    {
        $path = $this->book([
            3 => ['UNIT PELAKSANA PELAYANAN PELANGGAN : UP3 MOJOKERTO'], 4 => ['UNIT LAYANAN PELANGGAN : ULP JOMBANG'], 7 => ['LAPORAN SAIDI SAIFI'], 8 => ['Desember 2023'],
            9 => ['Jumlah Pelanggan :', '179.257', '(Plg)'], 11 => ['SAIDI :', '0,3437', '(Jam/Plg)', '20,6200'], 12 => ['SAIFI :', '0,2813', '(Kali/Plg)'],
            15 => ["NO. KODE\n(a)", 'PENYEBAB'], 16 => ['11', 'SUB KELOMPOK Padam', '-', '-'], 17 => ['11111', 'MV Cell', 0, 0, 0, 0, 0, 0, 0], 18 => [null, 'TOTAL KESELURUHAN', 50432, '61617.3', '0.3437', '0.2813', 603, '330.84', 12],
        ]);
        $this->assertSame('BARU', $this->service()->import($path, 'DIFI-51453-122023.xlsx')['status']);
        $file = DB::table('eis_report_files')->first();
        $s = json_decode($file->summary, true);
        $this->assertEquals(179257, $s['pelanggan']);
        $this->assertEquals(0.3437, $s['saidi_jam']);
        $this->assertEquals(20.62, $s['saidi_menit']);
        $this->assertEquals(0.2813, $s['saifi_kali']);
        $total = json_decode(DB::table('eis_report_lines')->where('label', 'TOTAL KESELURUHAN')->value('values'), true);
        $this->assertEquals(0.3437, $total['saidi_jam']);
        $this->assertSame('2023-12-01', substr($file->period, 0, 10));

        $this->expectException(EisReportException::class);
        $this->service()->import($this->book([1 => ['apa saja']]), 'GGNALL-51453-122025.xlsx');
    }

    #[Test]
    public function response_times_in_days_hours_minutes_are_stored_as_minutes(): void
    {
        $path = $this->book([
            2 => ['UNIT PELAKSANA PELAYANAN PELANGGAN : UP3 MOJOKERTO'], 3 => ['POSKO : POSKO ULP JOMBANG'], 7 => ['PERIODE TANGGAL : 1-Desember-2025 s/d 31-Desember-2025'],
            9 => ['Nama Unit', 'Total'], 11 => ['POSKO ULP JOMBANG', '2,688', '2,688', 100, 0, 0, 1.25, '0 - 0 : 39 : 45', '0 - 0 : 0 : 0', 101, '2,171', 18.93, '0 - 2 : 3 : 10'],
        ]);
        $this->service()->import($path, 'GGNALL-51453-122025.xlsx');
        $v = json_decode(DB::table('eis_report_lines')->value('values'), true);
        $this->assertEquals(2688, $v['total']);
        $this->assertEquals(39.75, $v['dispatch_maks_menit']);
        $this->assertEquals(123.17, $v['response_maks_menit']);
        $this->assertEquals(2171, $v['dispatch_dalam_sla']);
    }

    #[Test]
    public function the_susulan_list_keeps_only_totals_per_tariff_class_and_never_names_or_addresses(): void
    {
        $head = [1 => ['PT. PLN'], 2 => ['UP3 MOJOKERTO'], 3 => ['ULP JOMBANG', null, null, 'DAFTAR REALISASI'], 4 => ['BULAN  DESEMBER    TAHUN  2025'], 6 => ['NO', null, null, 'IDPEL', 'NAMA', null, null, 'GOL', 'ALAMAT']];
        $at = function (array $byCol): array {
            $row = [];
            foreach ($byCol as $col => $v) {
                $row[Coordinate::columnIndexFromString($col) - 1] = $v;
            }
            ksort($row);

            return $row;
        };
        $rows = $head + [8 => [1, 2, null, 3, 4, null, null, 5],
            9 => $at(['A' => 1, 'B' => 'P2TL/1', 'D' => '514531674558', 'E' => 'RAHASIA NAMA', 'H' => 'K2', 'I' => 'ALAMAT RAHASIA', 'K' => 'R1T/900', 'L' => 142, 'M' => 0, 'N' => 85910, 'P' => 85910, 'Z' => 90000, 'AB' => 50000, 'AC' => 40000]),
            10 => $at(['A' => 2, 'B' => 'P2TL/2', 'D' => '514531569209', 'E' => 'NAMA LAIN', 'H' => 'K2', 'I' => 'ALAMAT LAIN', 'K' => 'R1T/900', 'L' => 100, 'M' => 0, 'N' => 10000, 'P' => 10000, 'Z' => 10000, 'AB' => 10000, 'AC' => 0])];
        $this->service()->import($this->book($rows), 'TAGSUS-15453-122025.xlsx');
        $line = DB::table('eis_report_lines')->first();
        $v = json_decode($line->values, true);
        $this->assertSame('K2', $line->label);
        $this->assertEquals(2, $v['jumlah']);
        $this->assertEquals(242, $v['kwh']);
        $this->assertEquals(100000, $v['rp_total']);
        $this->assertEquals(60000, $v['rp_tunai']);
        $this->assertEquals(40000, $v['rp_angsuran']);
        $this->assertStringNotContainsString('RAHASIA', json_encode(DB::table('eis_report_lines')->get()));
    }
}
