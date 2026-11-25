<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Analytics\BusinessTrendBuilder;
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
    public function rekap_umur_piutang_menyimpan_baris_per_lembar_dan_kogol_tanpa_subtotal_dan_total(): void
    {
        $path = $this->book([
            0 => [null, null, null, null, null, 'Grand Total'],
            1 => ['UNITUPI', 'THBLLAP', 'JENIS_LAPORAN', 'LABEL', 'KOGOL', 'PLG', 'LBR', 'GABUNGAN', 'PAL'],
            2 => [51, 202610, 'PERLEMBAR', 1, 0, 9, 9, 2021480, 1741345],
            3 => [null, null, null, null, 2, 2, 2, 9989837, 9989837],   // sel LABEL gabungan: lembar 1
            4 => [null, null, null, 1, null, 11, 11, 12011317, 11731182],   // subtotal lembar 1
            5 => [null, null, null, 7, 1, 24, 168, 529896607, 529896607],
            6 => [null, null, 'PERLEMBAR Total', null, null, 35, 179, 541907924, 541627789],
        ]);

        $r = $this->service()->import($path, 'UMURPIUTANG-51453-102026.xls');

        $this->assertSame(3, $r['lines']);
        $lines = DB::table('eis_report_lines')->orderBy('line_no')->get(['label', 'code', 'values']);
        $this->assertSame(['1', '1', '7'], $lines->pluck('label')->all());
        $this->assertSame(['0', '2', '1'], $lines->pluck('code')->all());
        $this->assertEquals(9989837, json_decode($lines[1]->values, true)['gabungan']);
        $this->assertSame($this->ulp->getKey(), DB::table('eis_report_files')->value('organizational_unit_id'));   // unit dari nama berkas
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
    }

    #[Test]
    public function an_unknown_unit_code_is_recovered_from_the_content_with_a_warning_and_an_unknown_unit_is_refused(): void
    {
        $r = $this->service()->import($this->report309(), '309-15453-042026.xlsx');
        $this->assertSame('ULP Jombang', $r['unit']);
        $this->assertStringContainsString('dibaca dari nama unit di isi berkas', $r['warnings'][0]);
        $this->expectException(EisReportException::class);
        $this->expectExceptionMessage('tidak ada pada master unit aktif');
        $this->service()->import($this->report309('ULP PONOROGO'), '309-51540-042026.xlsx');
    }

    #[Test]
    public function a_unit_written_with_another_name_in_the_content_is_matched_through_the_alias_list(): void
    {
        $mojokerto = $this->makeUnit('ULP', $this->up3);
        $mojokerto->forceFill(['code' => '51452', 'name' => 'ULP Mojokerto'])->save();

        $r = $this->service()->import($this->report309('ULP MOJOKERTO UTARA'), '309.xls', null, null, ['unit_code' => '51452']);
        $this->assertSame(['ULP Mojokerto', '2026-04'], [$r['unit'], $r['period']]);

        $r = $this->service()->import($this->report309('ULP MOJOKERTO UTARA', 'Mei 2026'), '309-51452-052026.xls');
        $this->assertSame('ULP Mojokerto', $r['unit']);
    }

    /** Laporan anomali penanganan pengaduan (GGN: kolom B..R, KLH: B..L); $v = nilai baris data ULP. */
    private function anomalyReport(string $title, string $jenis, array $v, string $month, bool $twoTables = false): string
    {
        $rows = [
            2 => ['UNIT PELAKSANA PELAYANAN PELANGGAN : UP3 MOJOKERTO'], 3 => ['UNIT LAYANAN PELANGGAN : ULP JOMBANG'], 4 => ["JENIS LAPORAN : {$jenis}"], 6 => [$title], 7 => ["PERIODE TANGGAL : 1-{$month} SD TGL 31-{$month}"],
            9 => ['Nama Unit', 'Total WO'], 10 => [null, 'CC 123', 'PLN Mobile', 'Loket', 'Lainnya', 'Total'],
            11 => array_merge(['ULP JOMBANG'], $v),
        ];
        if ($twoTables) {
            $rows[13] = ['Nama Unit', 'Total WO PLN Mobile'];
            $rows[14] = ['ULP JOMBANG', '1.366', null, null, null, null, 0, null, null, 0];
        }

        return $this->book($rows);
    }

    #[Test]
    public function laporan_anomali_tata_letak_lama_membaca_cacah_dengan_titik_ribuan_dan_baru_dengan_koma_tanpa_mengubah_persen(): void
    {
        $title = 'LAPORAN ANOMALI PENANGANAN PENGADUAN GANGGUAN';
        // tata letak lama: "1.104" = 1104, "3.14" = 3140 (nol di belakang hilang); persen "0.09%" apa adanya; tabel kedua (hanya PLN Mobile) menyusul
        $old = $this->anomalyReport($title, 'LAPORAN RATING NEGATIF', ['1.104', '1.828', 1, 207, '3.14', 0, 0, 0, 2, 0, 2, 0, 0, 0, '0.09%', 0, '0.09%'], 'Maret-2025', true);
        $r = $this->service()->import($old, 'GGNNEGATIF-51453-032025.xlsx');
        $this->assertSame('GGNNEGATIF', $r['family']);
        $row = DB::table('eis_report_lines')->where('file_id', $r['id'])->orderBy('line_no')->first();
        $v = json_decode((string) $row->values, true);
        $this->assertEquals([1104, 1828, 1, 207, 3140, 2, 2], [$v['c_B'], $v['c_C'], $v['c_D'], $v['c_E'], $v['c_F'], $v['c_J'], $v['c_L']]);
        $this->assertEqualsWithDelta(0.09, $v['c_P'], 1e-9);                                       // kolom persen tidak dikalikan seribu
        // tata letak baru: teks dengan koma ribuan
        $new = $this->anomalyReport($title, 'LAPORAN BERULANG UNIT', ['775', '1,755', 0, 99, '2,629', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'Oktober-2026');
        $n = $this->service()->import($new, 'GGNBERULANG-51453-102026.xlsx');
        $this->assertEquals([775, 1755, 2629], array_values(array_intersect_key(json_decode((string) DB::table('eis_report_lines')->where('file_id', $n['id'])->value('values'), true), array_flip(['c_B', 'c_C', 'c_F']))));
        // keluhan: kolom jumlah B..I, persen J..L
        $klh = $this->anomalyReport('LAPORAN ANOMALI PENANGANAN PENGADUAN KELUHAN', 'LAPORAN RATING NEGATIF', ['54', '1.283', 0, 52, '1.389', 13, 2, 15, '3.34', '0.51', '3.85'], 'Oktober-2026');
        $k = json_decode((string) DB::table('eis_report_lines')->where('file_id', $this->service()->import($klh, 'KLHNEGATIF-51453-102026.xlsx')['id'])->value('values'), true);
        $this->assertEquals([1283, 1389, 15], [$k['c_C'], $k['c_F'], $k['c_I']]);
        $this->assertEqualsWithDelta(3.34, $k['c_J'], 1e-9);
    }

    #[Test]
    public function baca_ulang_arsip_memperbaiki_baris_lama_di_tempat_dan_dry_run_tidak_mengubah(): void
    {
        $path = $this->anomalyReport('LAPORAN ANOMALI PENANGANAN PENGADUAN GANGGUAN', 'LAPORAN RATING NEGATIF', ['1.104', '1.828', 1, 207, '3.14', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'Maret-2025');
        $r = $this->service()->import($path, 'GGNNEGATIF-51453-032025.xlsx');
        $fix = fn () => (float) json_decode((string) DB::table('eis_report_lines')->where('file_id', $r['id'])->value('values'), true)['c_F'];
        $this->assertSame(3140.0, $fix());
        $wrong = json_decode((string) DB::table('eis_report_lines')->where('file_id', $r['id'])->value('values'), true);
        $wrong['c_F'] = 3.14;                                                                         // keadaan sebelum perbaikan parser
        DB::table('eis_report_lines')->where('file_id', $r['id'])->update(['values' => json_encode($wrong)]);

        $this->artisan('distriva:eis-reparse', ['family' => ['GGNNEGATIF'], '--dry-run' => true])->expectsOutputToContain('akan diperbarui')->assertSuccessful();
        $this->assertSame(3.14, $fix());                                                              // dry-run: tidak berubah
        $this->artisan('distriva:eis-reparse', ['family' => ['GGNNEGATIF']])->expectsOutputToContain('1 diperbarui')->assertSuccessful();
        $this->assertSame(3140.0, $fix());
        $this->artisan('distriva:eis-reparse')->expectsOutputToContain('1 sama')->assertSuccessful();   // sudah benar: tidak ada yang berubah
        $this->assertSame(1, DB::table('eis_report_files')->where('id', $r['id'])->where('status', 'AKTIF')->count());   // berkas tetap yang sama
    }

    #[Test]
    public function saldo_prabayar_per_tarif_dibaca_dengan_tarifnya_dan_metrik_piutang_prabayar_menjumlahkan_tanpa_baris_total(): void
    {
        // tata letak "PERTARIF" (saldo prabayar bulan lalu): UNITUP, TARIF_LAP, SKEMA_BAYAR, KET_PIUTANG, JUMLAH, RPPTL, RPTAG; baris subtotal "NO REGISTER Total" dan total unit tanpa KET_PIUTANG
        $path = $this->book([
            1 => [null, null, null, null, 'Grand Total'],
            2 => ['UNITUP', 'TARIF_LAP', 'SKEMA_BAYAR', 'KET_PIUTANG', 'JUMLAH', 'RPPTL', 'RPTAG'],
            3 => ['51453', 'B1', 'NO REGISTER', 'BERJALAN', 1, 2316000, 2316000],
            4 => [null, null, null, 'TUNGGAKAN', 10, 1476928, 1476928],
            5 => [null, null, 'NO REGISTER Total', null, 11, 3792928, 3792928],
            6 => [null, 'R1', 'NO REGISTER', 'BARU', 51, 0, 21496500],
            7 => [null, null, null, 'BERJALAN', 7, 770704, 770704],
            8 => [null, null, null, 'TUNGGAKAN', 50, 2545789, 2899000],
            9 => [null, null, 'NO REGISTER Total', null, 108, 3316493, 25166204],
            10 => ['51453 Total', null, null, null, 119, 7109421, 28959132],
        ]);

        $r = $this->service()->import($path, 'Rekap.xlsx', null, null, ['unit_code' => '51453', 'period' => '2026-10']);

        $this->assertSame(['PIUTANGLPB_EIS', '2026-10'], [$r['family'], $r['period']]);
        $baru = DB::table('eis_report_lines')->where('file_id', $r['id'])->where('label', 'BARU')->first();
        $v = json_decode((string) $baru->values, true);
        $this->assertSame(['R1', 'NO REGISTER', 'BARU'], [$v['tarif_lap'], $v['skema_bayar'], $v['ket_piutang']]);        // tarif ikut disimpan dan dibawa ke baris berikutnya
        $berjalan = json_decode((string) DB::table('eis_report_lines')->where('file_id', $r['id'])->where('label', 'BERJALAN')->orderByDesc('line_no')->value('values'), true);
        $this->assertSame('R1', $berjalan['tarif_lap']);
        $d = app(BusinessTrendBuilder::class)->build('piutang-prabayar', [$this->ulp->id], [], '2026-10', '2026-10');
        $this->assertEquals(2316000 + 1476928 + 21496500 + 770704 + 2899000, $d['summary'][0]['latest']);                     // saldo tagihan BARU + BERJALAN + TUNGGAKAN; baris total tidak ikut
        $this->assertEquals(1 + 10 + 51 + 7 + 50, $d['summary'][1]['latest']);                                                // lembar
        $this->assertEquals(21496500, collect($d['breakdown']['rows'])->firstWhere('key', 'Baru')['value']);
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

    /** Kontrol 309 EIS kecil: dasar TUL III-07, satu penetapan P2TL beserta rincian tunainya, satu pembatalan, RUMUS, dan catatan LPB setelahnya. */
    private function kontrol309(string $unit = '51453', float $rumusKwh = 1090): string
    {
        $head = ['UNIT', 'NOMOR', 'KODE', 'KETERANGAN', 'SUMBER_LAPORAN', 'JMLPLG', 'JMLDAYA', 'JMLKWH', 'KELBKVARH', 'RPBEBAN', 'RPKWH', 'RPKVARH', 'RPPTL', 'PEMBUKUAN'];
        $row = fn (int $n, ?string $label, ?string $source, float $kwh, float $rp) => [$unit, (string) $n, null, $label, $source, 0, 0, $kwh, 0, 0, 0, 0, $rp, 'plus'];
        $nbsp = fn (int $n) => str_repeat(' ', $n);

        return $this->book([
            $head,
            $row(1, 'TUL III-07 (11)', 'T_307NEW', 1000, 10000), $row(2, 'PENAMBAHAN', null, 0, 0),
            $row(3, $nbsp(8).'Penetapan TS P2TL', 'PENETAPAN_P2TL', 100, 2000), $row(4, $nbsp(16).'DP / Tunai P2TL', 'P2TL_TUNAI', 100, 2000),
            $row(5, 'SUB TOTAL 1 ( + )', null, 1100, 12000), $row(6, 'PENGURANGAN', null, 0, 0),
            $row(7, $nbsp(8).'Pembatalan Rekening (MEMO4)', 'DKRPLAMA', 10, 100), $row(8, 'SUB TOTAL 2 ( - )', null, 10, 100),
            $row(9, 'RUMUS (SUBTOTAL 1-2)', null, $rumusKwh, 11900),
            $row(10, 'CATATAN LPB', null, 0, 0), $row(11, $nbsp(8).'PRA BAYAR (Pembelian Token PPOB)', 'PRABAYAR_PPOB', 5000, 50000),
        ]);
    }

    #[Test]
    public function kontrol_309_membandingkan_totalnya_dengan_laporan_309_dan_menolak_kode_unit_yang_berbeda(): void
    {
        // tanpa laporan 309 bulan itu: tidak ada pembanding, tidak ada peringatan
        $first = $this->service()->import($this->kontrol309(), '309EIS-51453-102026.xlsx');
        $this->assertSame(['309EIS', 'BARU', []], [$first['family'], $first['status'], $first['warnings']]);

        $this->service()->import($this->report309('ULP JOMBANG', 'Oktober 2026'), '309-51453-102026.xlsx');
        DB::table('eis_report_lines')->where('label', 'JUMLAH')->update(['values' => json_encode(['pelanggan' => 1, 'daya_va' => 1, 'kwh_jumlah' => 1090])]);
        $same = $this->service()->import($this->kontrol309('51453', 1090.5), '309EIS-51453-102026.xlsx');                          // selisih 0,5 kWh: dalam toleransi
        $this->assertSame([], $same['warnings']);

        $off = $this->service()->import($this->kontrol309('51453', 2000), '309EIS-51453-102026.xlsx');
        $this->assertCount(1, $off['warnings']);
        $this->assertStringContainsString('Total kontrol 309 (2.000,00 kWh) tidak sama dengan laporan 309 bulan itu (1.090,00 kWh)', $off['warnings'][0]);

        try {
            $this->service()->import($this->kontrol309('51454'), '309EIS-51453-102026.xlsx');                                         // kolom UNIT 51454, nama berkas 51453
            $this->fail('Seharusnya ditolak');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('Kode unit di dalam berkas (51454) berbeda dengan nama berkas (51453)', $e->getMessage());
        }
    }

    #[Test]
    public function laporan_belum_realisasi_dikenali_sebagai_jenis_sendiri_dan_tidak_menggantikan_tagsus(): void
    {
        $rows = fn (string $title) => [1 => ['PT. PLN'], 2 => ['UP3 MOJOKERTO'], 3 => ['ULP JOMBANG', null, null, $title], 4 => ['BULAN  OKTOBER    TAHUN  2026'], 6 => ['NO', null, null, 'IDPEL', 'NAMA', null, null, 'GOL'],
            9 => [1, null, null, '514531674558', 'NAMA', null, null, 'K2', null, null, null, 142, 0, 85910, null, 85910, null, null, null, null, null, null, null, null, null, 90000]];
        $realisasi = $this->service()->import($this->book($rows('DAFTAR REALISASI PENDAPATAN PENETAPAN TAGIHAN SUSULAN (TUNAI DAN ANGSURAN)')), 'TAGSUS-51453-102026.xlsx');
        $this->assertSame('BARU', $realisasi['status']);

        // nama bebas: jenis dari judul
        $free = $this->service()->import($this->book($rows('DAFTAR PENDAPATAN PENETAPAN TAGIHAN SUSULAN YANG BELUM REALISASI')), 'Rekap (5).xlsx');
        $this->assertSame(['TAGSUS_BELUM', '2026-10'], [$free['family'], $free['period']]);
        $this->assertSame('AKTIF', DB::table('eis_report_files')->where('family', 'TAGSUS')->value('status'));                  // realisasi tidak tergantikan

        // nama berpola TAGSUS tetapi isi belum realisasi: ditolak, tidak menimpa realisasi
        try {
            $this->service()->import($this->book($rows('DAFTAR PENDAPATAN PENETAPAN TAGIHAN SUSULAN YANG BELUM REALISASI')), 'TAGSUS-51453-102026.xlsx');
            $this->fail('Seharusnya ditolak');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('Isi berkas adalah laporan TAGSUS_BELUM, bukan TAGSUS', $e->getMessage());
        }
        $this->assertSame(1, DB::table('eis_report_files')->where('family', 'TAGSUS')->where('status', 'AKTIF')->count());
    }

    #[Test]
    public function unduhan_eis_bernama_bebas_dikenali_dari_isi_dan_pilihan_unit_atau_bulan_hanya_mengisi_yang_tidak_tertulis(): void
    {
        // 309: jenis dari judul, bulan dan ULP dari kepala laporan; pilihan unit lain diabaikan karena isi menyebut ULP
        $r = $this->service()->import($this->report309(), 'Rekap (3).xlsx', null, null, ['unit_code' => '51454']);
        $this->assertSame(['309', 'ULP Jombang', '2026-04'], [$r['family'], $r['unit'], $r['period']]);

        // piutang prabayar: unit dari kolom UNITUP, bulan tidak tertulis sehingga wajib dipilih
        $piutang = $this->book([
            0 => [null, null, null, null, 'Grand Total'],
            1 => ['UNITUP', 'GOLONGAN', 'SKEMA_BAYAR', 'KET_PIUTANG', 'JUMLAH', 'RPPTL'],
            2 => [51454, 0, 'NO REGISTER', 'BARU', 144, 60696000],
        ]);
        try {
            $this->service()->import($piutang, 'Rekap.xls');
            $this->fail('bulan tidak tertulis harus ditolak tanpa pilihan bulan');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('pilih bulan', $e->getMessage());
        }
        $r = $this->service()->import($piutang, 'Rekap.xls', null, null, ['period' => '2026-10']);
        $this->assertSame(['PIUTANGLPB_EIS', 'ULP Ngoro', '2026-10'], [$r['family'], $r['unit'], $r['period']]);

        // umur piutang: bulan dari THBLLAP, unit tidak tertulis (UNITUPI hanya kode induk) sehingga wajib dipilih
        $umur = $this->book([
            0 => [null, null, null, null, null, 'Grand Total'],
            1 => ['UNITUPI', 'THBLLAP', 'JENIS_LAPORAN', 'LABEL', 'KOGOL', 'PLG', 'LBR', 'GABUNGAN'],
            2 => [51, 202610, 'PERLEMBAR', 1, 0, 9, 9, 2021480],
        ]);
        try {
            $this->service()->import($umur, 'Rekap (1).xls', null, null, ['period' => '2026-01']);
            $this->fail('unit tidak tertulis harus ditolak tanpa pilihan unit');
        } catch (EisReportException $e) {
            $this->assertStringContainsString('pilih unit', $e->getMessage());
        }
        $r = $this->service()->import($umur, 'Rekap (1).xls', null, null, ['unit_code' => '51453', 'period' => '2026-01']);
        $this->assertSame(['UMURPIUTANG', 'ULP Jombang', '2026-10'], [$r['family'], $r['unit'], $r['period']]);   // bulan dari isi, bukan pilihan

        // isi yang bukan laporan EIS dikenal tetap ditolak
        $this->expectException(EisReportException::class);
        $this->expectExceptionMessage('tidak dikenali dari isi');
        $this->service()->import($this->book([0 => ['Daftar hadir'], 1 => ['Nama', 'Jam']]), 'Rekap.xlsx', null, null, ['unit_code' => '51453', 'period' => '2026-10']);
    }
}
