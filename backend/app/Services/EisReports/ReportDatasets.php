<?php

namespace App\Services\EisReports;

use Illuminate\Support\Facades\DB;

/**
 * Katalog dataset sumber pengusahaan (docs/88): satu nama baku `SUMBER.DATASET` untuk setiap data yang dimasukkan dari AP2T, APKT, atau EIS, di mana disimpan, dan menu mana yang memakainya.
 * Dipakai matriks kelengkapan dan dapat dipakai menu lain yang membutuhkan data yang sama. Dataset bersumber berkas laporan EIS (`family`) atau tabel hasil penarikan APKT (`table`);
 * `parts` = jumlah baris per ULP per bulan yang harus ada supaya bulan itu dianggap lengkap (mis. dua varian clear temper, atau jenis berulang dan rating negatif).
 */
class ReportDatasets
{
    /** @var array<string, array{name: string, source: string, storage: string, family?: string, table?: string, parts?: int, used_by: list<string>}> */
    public const ACTIVE = [
        'AP2T.PENJUALAN_309' => ['name' => 'Penjualan Tenaga Listrik (309)', 'source' => 'AP2T', 'storage' => 'file', 'family' => '309', 'used_by' => ['pelanggan', 'daya', 'kwh-jual', 'pendapatan', 'susut']],
        'AP2T.TAGSUS' => ['name' => 'Realisasi Tagihan Susulan (P2TL)', 'source' => 'AP2T', 'storage' => 'file', 'family' => 'TAGSUS', 'used_by' => ['kwh-p2tl']],
        'APKT.SAIDI_SAIFI' => ['name' => 'Laporan SAIDI SAIFI', 'source' => 'APKT', 'storage' => 'file', 'family' => 'DIFI', 'used_by' => ['saidi-saifi', 'ens', 'gangguan']],
        'APKT.RPT_RCT_GANGGUAN' => ['name' => 'Jumlah dan Durasi RPT RCT Gangguan', 'source' => 'APKT', 'storage' => 'table', 'table' => 'apkt_rpt_rct_records', 'parts' => 2, 'used_by' => ['rpt-rct-gangguan']],
        'APKT.RPT_RCT_KELUHAN' => ['name' => 'Jumlah dan Durasi RPT RCT Keluhan', 'source' => 'APKT', 'storage' => 'table', 'table' => 'apkt_rpt_rct_keluhan_records', 'parts' => 1, 'used_by' => ['rpt-rct-keluhan']],
        'APKT.ANOMALI_GANGGUAN' => ['name' => 'Anomali Pengaduan Gangguan', 'source' => 'APKT', 'storage' => 'table', 'table' => 'apkt_anomali_gangguan_records', 'parts' => 2, 'used_by' => ['anomali-gangguan']],
        'APKT.ANOMALI_KELUHAN' => ['name' => 'Anomali Pengaduan Keluhan', 'source' => 'APKT', 'storage' => 'table', 'table' => 'apkt_anomali_keluhan_records', 'parts' => 2, 'used_by' => ['anomali-keluhan']],
        'EIS.PIUTANG_PRABAYAR' => ['name' => 'Piutang Prabayar (PIUTANGLPB_EIS)', 'source' => 'EIS', 'storage' => 'file', 'family' => 'PIUTANGLPB_EIS', 'used_by' => ['piutang-prabayar']],
        'EIS.PIUTANG_PASCABAYAR' => ['name' => 'Piutang Pascabayar (AKHIEPERIODE_EIS)', 'source' => 'EIS', 'storage' => 'file', 'family' => 'AKHIEPERIODE_EIS', 'used_by' => ['piutang-pascabayar']],
        'EIS.REKENING_AKHIR_BULAN' => ['name' => 'Rekening Akhir Bulan (AKHIRBULAN_EIS)', 'source' => 'EIS', 'storage' => 'file', 'family' => 'AKHIRBULAN_EIS', 'used_by' => []],
        'EIS.UMUR_PIUTANG' => ['name' => 'Umur Tunggakan Pascabayar (UMURPIUTANG)', 'source' => 'EIS', 'storage' => 'file', 'family' => 'UMURPIUTANG', 'used_by' => ['piutang-pascabayar-umur']],
    ];

    /** Jenis laporan EIS lama yang tidak lagi dipakai menu mana pun (digantikan penarikan APKT); tetap dapat diunggah dan disimpan, tidak masuk hitungan kelengkapan. */
    public const LEGACY_FAMILIES = ['309EIS', 'GGNALL', 'GGNPERJENIS', 'GGNBERULANG', 'GGNNEGATIF', 'KLHALL', 'KLHBERULANG', 'KLHNEGATIF'];

    /**
     * Metadata dataset aktif untuk tampilan.
     *
     * @return list<array<string, mixed>>
     */
    public static function list(): array
    {
        return array_map(fn (string $code, array $d) => ['code' => $code, 'name' => $d['name'], 'source' => $d['source'], 'storage' => $d['storage'], 'family' => $d['family'] ?? null, 'used_by' => $d['used_by']], array_keys(self::ACTIVE), self::ACTIVE);
    }

    /**
     * Bulan yang sudah ada per ULP per dataset pada satu tahun.
     *
     * @param  list<string>  $unitIds
     * @return array<string, array<string, array<int, bool>>> unit => kode dataset => (bulan 1-12 => ada)
     */
    public function months(array $unitIds, int $year): array
    {
        $out = [];
        foreach ($unitIds as $u) {
            foreach (array_keys(self::ACTIVE) as $code) {
                $out[$u][$code] = array_fill(1, 12, false);
            }
        }
        $range = ["{$year}-01-01", "{$year}-12-01"];
        $byFamily = [];
        foreach (self::ACTIVE as $code => $d) {
            isset($d['family']) && $byFamily[$d['family']] = $code;
        }
        foreach (DB::table('eis_report_files')->whereIn('organizational_unit_id', $unitIds)->where('status', 'AKTIF')->whereIn('family', array_keys($byFamily))->whereBetween('period', $range)->get(['organizational_unit_id', 'family', 'period']) as $r) {
            $out[$r->organizational_unit_id][$byFamily[$r->family]][(int) substr((string) $r->period, 5, 2)] = true;
        }
        foreach (self::ACTIVE as $code => $d) {
            if (! isset($d['table'])) {
                continue;
            }
            $rows = DB::table($d['table'])->whereIn('organizational_unit_id', $unitIds)->whereBetween('period', $range)->groupBy('organizational_unit_id', 'period')->get(['organizational_unit_id', 'period', DB::raw('count(*) as parts')]);
            foreach ($rows as $r) {
                $out[$r->organizational_unit_id][$code][(int) substr((string) $r->period, 5, 2)] = (int) $r->parts >= $d['parts'];
            }
        }

        return $out;
    }
}
