<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Analisa dan tren pengusahaan (docs/91): satu katalog metrik bulanan per ULP dari laporan EIS, data gangguan, dan permohonan.
 * Tiap sumber menghasilkan angka mentah yang dapat dijumlahkan antar-ULP dan antar-bulan (mis. respons × jumlah gangguan), lalu seri dihitung
 * sebagai pembilang/penyebut. Dengan begitu UP3 = gabungan ULP di bawahnya, rata-rata waktu tertimbang jumlah kejadian, dan SAIDI/SAIFI tertimbang pelanggan.
 */
class BusinessMetricService
{
    /** Kelompok tarif laporan 309 (baris "JUMLAH x" untuk S/R/B/I/P, baris tunggal untuk T/C/L). */
    private const TARIFF_GROUPS = ['S' => 'Sosial', 'R' => 'Rumah tangga', 'B' => 'Bisnis', 'I' => 'Industri', 'P' => 'Pemerintah', 'T' => 'Traksi', 'C' => 'Curah', 'L' => 'Layanan khusus'];

    /** Masukan bulanan (nilai bulan itu, bukan kumulatif) => nama. kWh beli wajib untuk susut; E-Min dan PSSD dianggap 0 bila kosong. */
    public const INPUT_CODES = ['kwh-beli' => 'kWh beli', 'e-min' => 'E-Min', 'pssd' => 'PSSD'];

    /** Kelompok umur tunggakan menurut jumlah lembar (bulan), berurutan. */
    public const AGE_BUCKETS = ['1 bulan', '2 bulan', '3 bulan', '4-6 bulan', '7-12 bulan', '> 12 bulan'];

    /** Baris TAGSUS yang bukan P2TL: tagihan susulan kWh (TS kWh) dan koreksi rekening (DKRP). */
    private const NON_P2TL = ['KWH', 'DKRP'];

    /**
     * Katalog. `series`: key, name, unit, num (angka mentah), den (penyebut, opsional), factor; `ytd`: cara kumulatif tahun berjalan
     * (last = posisi akhir, sum = jumlah nilai bulanan, ratio = jumlah mentah lalu dibagi). `polarity`: up = makin besar makin baik, down = sebaliknya.
     * `breakdown`: nama dimensi rincian (angka mentah "bd" = pembilang seri pertama per dimensi).
     *
     * @var array<string, array<string, mixed>>
     */
    public const CATALOG = [
        'pelanggan' => ['name' => 'Pelanggan', 'source' => 'Laporan 309 (baris JUMLAH)', 'family' => '309', 'polarity' => 'up', 'ytd' => 'last', 'breakdown' => 'Kelompok tarif',
            'series' => [['key' => 'pelanggan', 'name' => 'Jumlah pelanggan', 'unit' => 'plg', 'num' => 'pelanggan']],
            'companion' => ['source' => 'Permohonan EIS (tersambung menurut status PEREMAJAAN, permohonan masuk menurut tanggal masuk)', 'forecast' => ['kind' => 'CUSTOMERS_ADDED'],
                'series' => [['key' => 'pb', 'name' => 'Pasang baru (PB) tersambung', 'unit' => 'plg', 'num' => 'pb'], ['key' => 'req_pb', 'name' => 'Permohonan PB masuk', 'unit' => 'permohonan', 'num' => 'req_pb']],
                'reconcile' => [['key' => 'pelanggan', 'mode' => 'net', 'unit' => 'plg', 'official_name' => 'Tambahan bersih (selisih jumlah pelanggan Laporan 309)', 'official' => ['num' => ['pelanggan']],
                    'companion_name' => 'PB tersambung (permohonan)', 'companion' => ['num' => ['pb']]]]]],        'daya' => ['name' => 'Daya tersambung', 'source' => 'Laporan 309 (baris JUMLAH)', 'family' => '309', 'polarity' => 'up', 'ytd' => 'last', 'breakdown' => 'Kelompok tarif',
                        'series' => [['key' => 'daya', 'name' => 'Daya tersambung', 'unit' => 'MVA', 'num' => 'daya_va', 'factor' => 1e-6]],
                        'companion' => ['source' => 'Permohonan EIS (tersambung menurut status PEREMAJAAN)', 'forecast' => ['kind' => 'VA_ADDED'],
                            'series' => [['key' => 'pb_kva', 'name' => 'Daya PB tersambung', 'unit' => 'MVA', 'num' => 'pb_kva', 'factor' => 1e-3], ['key' => 'pd_net_kva', 'name' => 'Perubahan daya (PD) neto', 'unit' => 'MVA', 'num' => 'pd_net_kva', 'factor' => 1e-3]],
                            'reconcile' => [['key' => 'daya', 'mode' => 'net', 'unit' => 'MVA', 'official_name' => 'Tambahan bersih (selisih daya tersambung Laporan 309)', 'official' => ['num' => ['daya_va'], 'factor' => 1e-6],
                                'companion_name' => 'Daya PB + PD neto (permohonan)', 'companion' => ['num' => ['pb_kva', 'pd_net_kva'], 'factor' => 1e-3]]]]],        'kwh-jual' => ['name' => 'kWh jual', 'source' => 'Laporan 309 (baris JUMLAH)', 'family' => '309', 'polarity' => 'up', 'ytd' => 'ratio', 'breakdown' => 'Kelompok tarif',
                                    'series' => [['key' => 'kwh', 'name' => 'kWh jual', 'unit' => 'kWh', 'num' => 'kwh']],
                                    'companion' => ['source' => 'Permohonan EIS (daya PB tersambung per kelompok tarif) dikali kWh per kVA aktual kelompok itu dari Laporan 309 (perkiraan, bukan angka resmi)', 'forecast' => null,
                                        'series' => [['key' => 'est_kwh', 'name' => 'Perkiraan kWh dari pelanggan baru (PB 12 bulan terakhir)', 'unit' => 'kWh', 'num' => 'est_kwh']],
                                        'reconcile' => [['key' => 'kwh', 'mode' => 'yoy', 'unit' => 'kWh', 'official_name' => 'Kenaikan kWh jual dibanding tahun lalu (Laporan 309)', 'official' => ['num' => ['kwh']],
                                            'companion_name' => 'Perkiraan sumbangan pelanggan baru', 'companion' => ['num' => ['est_kwh']]]]]],
        'pendapatan' => ['name' => 'Pendapatan', 'source' => 'Laporan 309 (rupiah JUMLAH)', 'family' => '309', 'polarity' => 'up', 'ytd' => 'ratio', 'breakdown' => 'Kelompok tarif',
            'series' => [['key' => 'rp', 'name' => 'Pendapatan', 'unit' => 'Rp', 'num' => 'rp'], ['key' => 'rp_per_kwh', 'name' => 'Harga jual rata-rata', 'unit' => 'Rp/kWh', 'num' => 'rp', 'den' => 'kwh']],
            'companion' => ['source' => 'Permohonan EIS (daya PB tersambung per kelompok tarif) dikali rupiah per kVA aktual kelompok itu dari Laporan 309 (perkiraan, bukan angka resmi)', 'forecast' => null,
                'series' => [['key' => 'est_rp', 'name' => 'Perkiraan pendapatan dari pelanggan baru (PB 12 bulan terakhir)', 'unit' => 'Rp', 'num' => 'est_rp']],
                'reconcile' => [['key' => 'rp', 'mode' => 'yoy', 'unit' => 'Rp', 'official_name' => 'Kenaikan pendapatan dibanding tahun lalu (Laporan 309)', 'official' => ['num' => ['rp']],
                    'companion_name' => 'Perkiraan sumbangan pelanggan baru', 'companion' => ['num' => ['est_rp']]]]]],
        'piutang-prabayar' => ['name' => 'Piutang prabayar', 'source' => 'PIUTANGLPB_EIS (BARU, BERJALAN, TUNGGAKAN)', 'family' => 'PIUTANGLPB_EIS', 'polarity' => 'down', 'ytd' => 'last', 'breakdown' => 'Status piutang',
            'series' => [['key' => 'saldo', 'name' => 'Saldo piutang', 'unit' => 'Rp', 'num' => 'saldo'], ['key' => 'lembar', 'name' => 'Jumlah lembar', 'unit' => 'lbr', 'num' => 'lembar']]],
        'piutang-pascabayar' => ['name' => 'Piutang pascabayar', 'source' => 'AKHIEPERIODE_EIS (per kogol)', 'family' => 'AKHIEPERIODE_EIS', 'polarity' => 'down', 'ytd' => 'last', 'breakdown' => 'Kogol',
            'series' => [['key' => 'saldo', 'name' => 'Saldo lewat tanggal 20', 'unit' => 'Rp', 'num' => 'saldo'], ['key' => 'rek_baru', 'name' => 'Rekening baru', 'unit' => 'Rp', 'num' => 'rek_baru'],
                ['key' => 'persen', 'name' => 'Saldo terhadap rekening baru', 'unit' => '%', 'num' => 'saldo', 'den' => 'rek_baru', 'factor' => 100], ['key' => 'lembar', 'name' => 'Lembar saldo', 'unit' => 'lbr', 'num' => 'lembar']]],
        'piutang-pascabayar-umur' => ['name' => 'Tunggakan pascabayar per umur', 'source' => 'UMURPIUTANG (rekap tunggakan per jumlah lembar dan kogol)', 'family' => 'UMURPIUTANG', 'polarity' => 'down', 'ytd' => 'last',
            'breakdown' => 'Umur tunggakan', 'breakdown_keys' => self::AGE_BUCKETS, 'breakdown2' => 'Kogol',
            'series' => [['key' => 'rp', 'name' => 'Tunggakan', 'unit' => 'Rp', 'num' => 'rp'], ['key' => 'pelanggan', 'name' => 'Pelanggan menunggak', 'unit' => 'plg', 'num' => 'plg'],
                ['key' => 'lembar', 'name' => 'Lembar tunggakan', 'unit' => 'lbr', 'num' => 'lbr'], ['key' => 'umur_rata', 'name' => 'Umur rata-rata', 'unit' => 'bulan', 'num' => 'lbr', 'den' => 'plg'],
                ['key' => 'lebih_3_bulan', 'name' => 'Tunggakan lebih dari 3 bulan', 'unit' => '%', 'num' => 'rp_lebih3', 'den' => 'rp', 'factor' => 100]]],
        'rpt-rct-keluhan' => ['name' => 'RPT-RCT keluhan', 'source' => 'KLHALL', 'family' => 'KLHALL', 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'rpt', 'name' => 'Response time rata-rata', 'unit' => 'jam', 'num' => 'rpt_x_n', 'den' => 'n'], ['key' => 'rct', 'name' => 'Recovery (selesai) rata-rata', 'unit' => 'jam', 'num' => 'rct_x_n', 'den' => 'n'],
                ['key' => 'jumlah', 'name' => 'Jumlah keluhan', 'unit' => 'kali', 'num' => 'n'], ['key' => 'rpt_sla', 'name' => 'Respons dalam SLA', 'unit' => '%', 'num' => 'rpt_in', 'den' => 'rpt_all', 'factor' => 100]]],
        'rpt-rct-gangguan' => ['name' => 'RPT-RCT gangguan', 'source' => 'GGNALL', 'family' => 'GGNALL', 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'rpt', 'name' => 'Response time rata-rata', 'unit' => 'menit', 'num' => 'rpt_x_n', 'den' => 'n'], ['key' => 'rct', 'name' => 'Recovery time rata-rata', 'unit' => 'menit', 'num' => 'rct_x_n', 'den' => 'n'],
                ['key' => 'jumlah', 'name' => 'Jumlah gangguan', 'unit' => 'kali', 'num' => 'n'], ['key' => 'rpt_sla', 'name' => 'Respons dalam SLA', 'unit' => '%', 'num' => 'rpt_in', 'den' => 'rpt_all', 'factor' => 100]]],
        'saidi-saifi' => ['name' => 'SAIDI dan SAIFI', 'source' => 'Laporan DIFI (ringkasan)', 'family' => 'DIFI', 'polarity' => 'down', 'ytd' => 'sum', 'breakdown' => null,
            'series' => [['key' => 'saidi', 'name' => 'SAIDI', 'unit' => 'menit/plg', 'num' => 'saidi_x_plg', 'den' => 'plg'], ['key' => 'saifi', 'name' => 'SAIFI', 'unit' => 'kali/plg', 'num' => 'saifi_x_plg', 'den' => 'plg']],
            'companion' => ['source' => 'Data gangguan penyulang tersinkron (APKT): gangguan lebih dari ambang menit, pelanggan penyulang dari potret DIL (batas atas)', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'],
                'series' => [['key' => 'saidi_hitung', 'name' => 'SAIDI hitung DISTRIVA', 'unit' => 'menit/plg', 'num' => 'saidi_x_base', 'den' => 'base'], ['key' => 'saifi_hitung', 'name' => 'SAIFI hitung DISTRIVA', 'unit' => 'kali/plg', 'num' => 'saifi_x_base', 'den' => 'base']],
                'reconcile' => [['key' => 'saidi', 'mode' => 'flow', 'unit' => 'menit/plg', 'official_name' => 'SAIDI Laporan DIFI', 'official' => ['num' => ['saidi_x_plg'], 'den' => 'plg'], 'companion_name' => 'SAIDI hitung DISTRIVA', 'companion' => ['num' => ['saidi_x_base'], 'den' => 'base']],
                    ['key' => 'saifi', 'mode' => 'flow', 'unit' => 'kali/plg', 'official_name' => 'SAIFI Laporan DIFI', 'official' => ['num' => ['saifi_x_plg'], 'den' => 'plg'], 'companion_name' => 'SAIFI hitung DISTRIVA', 'companion' => ['num' => ['saifi_x_base'], 'den' => 'base']]]]],
        'ens' => ['name' => 'ENS', 'source' => 'Laporan DIFI (TOTAL KELOMPOK Distribusi)', 'family' => 'DIFI', 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'ens', 'name' => 'Energi tak tersalurkan', 'unit' => 'MWh', 'num' => 'ens_kwh', 'factor' => 1e-3]],
            'companion' => ['source' => 'Data gangguan penyulang tersinkron (kolom ENS sheet, menurut ULP peristiwa)', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'],
                'series' => [['key' => 'ens_sheet', 'name' => 'ENS data gangguan tersinkron', 'unit' => 'MWh', 'num' => 'ens_kwh', 'factor' => 1e-3]],
                'reconcile' => [['key' => 'ens', 'mode' => 'flow', 'unit' => 'MWh', 'official_name' => 'ENS Laporan DIFI', 'official' => ['num' => ['ens_kwh'], 'factor' => 1e-3], 'companion_name' => 'ENS data gangguan tersinkron', 'companion' => ['num' => ['ens_kwh'], 'factor' => 1e-3]]]]],
        'kwh-p2tl' => ['name' => 'kWh P2TL', 'source' => 'TAGSUS (golongan P1-P4, K2, tanpa golongan; tanpa TS kWh dan DKRP)', 'family' => 'TAGSUS', 'polarity' => 'up', 'ytd' => 'ratio', 'breakdown' => 'Golongan pelanggaran',
            'series' => [['key' => 'kwh', 'name' => 'kWh P2TL', 'unit' => 'kWh', 'num' => 'kwh'], ['key' => 'rp', 'name' => 'Rupiah tagihan susulan', 'unit' => 'Rp', 'num' => 'rp'], ['key' => 'jumlah', 'name' => 'Jumlah pelanggan', 'unit' => 'plg', 'num' => 'n']]],
        'gangguan' => ['name' => 'Gangguan penyulang', 'source' => 'Data gangguan tersinkron', 'family' => null, 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => 'Jenis gangguan',
            'series' => [['key' => 'jumlah', 'name' => 'Jumlah gangguan', 'unit' => 'kali', 'num' => 'n'], ['key' => 'permanen', 'name' => 'Permanen', 'unit' => 'kali', 'num' => 'permanen'], ['key' => 'temporer', 'name' => 'Temporer', 'unit' => 'kali', 'num' => 'temporer']],
            'companion' => ['source' => 'Laporan DIFI (TOTAL KELOMPOK Distribusi, jumlah gangguan)', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'],
                'series' => [['key' => 'difi_jumlah', 'name' => 'Jumlah gangguan menurut Laporan DIFI', 'unit' => 'kali', 'num' => 'n']],
                'reconcile' => [['key' => 'gangguan', 'mode' => 'flow', 'unit' => 'kali', 'official_name' => 'Jumlah gangguan data tersinkron', 'official' => ['num' => ['n']], 'companion_name' => 'Jumlah gangguan Laporan DIFI', 'companion' => ['num' => ['n']]]]]],
        'hpl-bp' => ['name' => 'HPL biaya penyambungan', 'source' => 'Permohonan PB/PD lunas (biaya, tanggal bayar)', 'family' => null, 'polarity' => 'up', 'ytd' => 'ratio', 'breakdown' => 'Jenis permohonan',
            'series' => [['key' => 'rp', 'name' => 'Biaya penyambungan', 'unit' => 'Rp', 'num' => 'rp'], ['key' => 'jumlah', 'name' => 'Jumlah permohonan lunas', 'unit' => 'permohonan', 'num' => 'n']]],
        'susut' => ['name' => 'Susut', 'source' => 'Masukan bulanan kWh beli, E-Min, PSSD (pengusahaan) dan kWh jual laporan 309', 'family' => null, 'zero_fill' => false, 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'susut', 'name' => 'Susut', 'unit' => '%', 'num' => 'susut_kwh', 'den' => 'beli_net', 'factor' => 100], ['key' => 'susut_kwh', 'name' => 'Susut', 'unit' => 'kWh', 'num' => 'susut_kwh'],
                ['key' => 'beli', 'name' => 'kWh beli', 'unit' => 'kWh', 'num' => 'beli'], ['key' => 'jual', 'name' => 'kWh jual', 'unit' => 'kWh', 'num' => 'jual']]],
    ];

    /**
     * Angka mentah per ULP per bulan (YYYY-MM) beserta rincian.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>> unit => bulan => data
     */
    public function raw(string $code, array $units, string $from, string $to): array
    {
        $fromDate = $from.'-01';
        $toDate = $to.'-01';

        return match ($code) {
            'pelanggan', 'daya', 'kwh-jual', 'pendapatan' => $this->eis('309', $units, $fromDate, $toDate, fn (array $lines) => $this->from309($lines, $code)),
            'piutang-prabayar' => $this->eis('PIUTANGLPB_EIS', $units, $fromDate, $toDate, fn (array $lines) => $this->fromPiutangLpb($lines)),
            'piutang-pascabayar-umur' => $this->eis('UMURPIUTANG', $units, $fromDate, $toDate, fn (array $lines) => $this->fromUmurPiutang($lines)),
            'piutang-pascabayar' => $this->eis('AKHIEPERIODE_EIS', $units, $fromDate, $toDate, fn (array $lines) => $this->fromAkhirPeriode($lines)),
            'rpt-rct-keluhan' => $this->eis('KLHALL', $units, $fromDate, $toDate, fn (array $lines) => $this->fromResponse($lines, 'response_rata_jam', 'selesai_rata_jam')),
            'rpt-rct-gangguan' => $this->eis('GGNALL', $units, $fromDate, $toDate, fn (array $lines) => $this->fromResponse($lines, 'response_rata_menit', 'recovery_rata_menit')),
            'saidi-saifi', 'ens' => $this->eis('DIFI', $units, $fromDate, $toDate, fn (array $lines, array $summary) => $this->fromDifi($lines, $summary)),
            'grup-309' => $this->eis('309', $units, $fromDate, $toDate, fn (array $lines) => $this->fromGroups309($lines)),
            'difi-gangguan' => $this->eis('DIFI', $units, $fromDate, $toDate, fn (array $lines, array $summary) => $this->fromDifiCount($lines, $summary)),
            'kwh-p2tl' => $this->eis('TAGSUS', $units, $fromDate, $toDate, fn (array $lines) => $this->fromTagsus($lines)),
            'gangguan' => $this->outages($units, $fromDate, $toDate),
            'hpl-bp' => $this->connectionFees($units, $fromDate, $toDate),
            'susut' => $this->losses($units, $fromDate, $toDate),
            default => [],
        };
    }

    /**
     * Bulan yang laporannya belum ada per ULP (hanya metrik berbasis laporan EIS; sumber lain tidak punya konsep laporan).
     *
     * @param  list<string>  $units
     * @param  list<string>  $months
     * @return array<string, list<string>> unit => bulan kosong
     */
    public function missingMonths(string $code, array $units, array $months): array
    {
        if ($code === 'susut' && $months !== []) {
            $have = [];
            foreach ($this->losses($units, $months[0].'-01', end($months).'-01') as $u => $byMonth) {
                $have[$u] = array_keys($byMonth);
            }

            return array_filter(array_combine($units, array_map(fn ($u) => array_values(array_diff($months, $have[$u] ?? [])), $units)));
        }
        $family = self::CATALOG[$code]['family'] ?? null;
        if ($family === null || $months === []) {
            return [];
        }
        $have = DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)
            ->whereBetween('period', [$months[0].'-01', end($months).'-01'])->get(['organizational_unit_id', 'period'])
            ->groupBy('organizational_unit_id')->map(fn ($rows) => $rows->map(fn ($r) => substr((string) $r->period, 0, 7))->all());
        $out = [];
        foreach ($units as $u) {
            $gap = array_values(array_diff($months, $have[$u] ?? []));
            if ($gap !== []) {
                $out[$u] = $gap;
            }
        }

        return $out;
    }

    /**
     * @param  list<string>  $units
     * @param  callable(list<array{label: string, values: array<string, mixed>}>, array<string, mixed>): ?array{raw: array<string, float>, bd: array<string, float>}  $extract
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    private function eis(string $family, array $units, string $from, string $to, callable $extract): array
    {
        $files = DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)
            ->whereBetween('period', [$from, $to])->get(['id', 'organizational_unit_id', 'period', 'summary']);
        $lines = DB::table('eis_report_lines')->whereIn('file_id', $files->pluck('id'))->orderBy('line_no')->get(['file_id', 'label', 'values'])->groupBy('file_id');
        $out = [];
        foreach ($files as $f) {
            $rows = ($lines[$f->id] ?? collect())->map(fn ($l) => ['label' => trim((string) $l->label), 'values' => json_decode((string) $l->values, true) ?: []])->all();
            $data = $extract($rows, json_decode((string) ($f->summary ?? '{}'), true) ?: []);
            if ($data !== null) {
                $out[$f->organizational_unit_id][substr((string) $f->period, 0, 7)] = $data;
            }
        }

        return $out;
    }

    /** @param list<array{label: string, values: array<string, mixed>}> $lines */
    private function from309(array $lines, string $code): ?array
    {
        $field = ['pelanggan' => 'pelanggan', 'daya' => 'daya_va', 'kwh-jual' => 'kwh_jumlah', 'pendapatan' => 'rp_jumlah'][$code];
        $total = null;
        $bd = [];
        foreach ($lines as $l) {
            if ($l['label'] === 'JUMLAH') {
                $total = $l['values'];
            } elseif (preg_match('/^JUMLAH ([SRBIP])$/', $l['label'], $m)) {
                $bd[self::TARIFF_GROUPS[$m[1]]] = (float) ($l['values'][$field] ?? 0);
            } elseif (preg_match('/^([TCL]) \//', $l['label'], $m)) {
                $bd[self::TARIFF_GROUPS[$m[1]]] = ($bd[self::TARIFF_GROUPS[$m[1]]] ?? 0) + (float) ($l['values'][$field] ?? 0);
            }
        }
        if ($total === null) {
            return null;
        }

        return ['raw' => ['pelanggan' => (float) ($total['pelanggan'] ?? 0), 'daya_va' => (float) ($total['daya_va'] ?? 0), 'kwh' => (float) ($total['kwh_jumlah'] ?? 0), 'rp' => (float) ($total['rp_jumlah'] ?? 0)], 'bd' => $bd];
    }

    /** @param list<array{label: string, values: array<string, mixed>}> $lines */
    private function fromPiutangLpb(array $lines): ?array
    {
        $bd = [];
        $lembar = 0.0;
        foreach ($lines as $l) {
            if (in_array($l['label'], ['BARU', 'BERJALAN', 'TUNGGAKAN'], true)) {
                $bd[ucfirst(strtolower($l['label']))] = ($bd[ucfirst(strtolower($l['label']))] ?? 0) + (float) ($l['values']['rptag'] ?? 0);
                $lembar += (float) ($l['values']['jumlah'] ?? 0);
            }
        }

        return $bd === [] ? null : ['raw' => ['saldo' => array_sum($bd), 'lembar' => $lembar], 'bd' => $bd];
    }

    /** @param list<array{label: string, values: array<string, mixed>}> $lines */
    private function fromAkhirPeriode(array $lines): ?array
    {
        $raw = ['saldo' => 0.0, 'rek_baru' => 0.0, 'lembar' => 0.0];
        $bd = [];
        foreach ($lines as $l) {
            if (! preg_match('/^\d+$/', $l['label'])) {
                continue;   // baris "SEMUA KOGOL" adalah total
            }
            $raw['saldo'] += (float) ($l['values']['rp_saldo_20'] ?? 0);
            $raw['rek_baru'] += (float) ($l['values']['rp_rek_baru'] ?? 0);
            $raw['lembar'] += (float) ($l['values']['lbr_saldo_20'] ?? 0);
            $bd['Kogol '.$l['label']] = (float) ($l['values']['rp_saldo_20'] ?? 0);
        }

        return $bd === [] ? null : ['raw' => $raw, 'bd' => $bd];
    }

    /**
     * Tunggakan per umur: LABEL = jumlah lembar (bulan menunggak). bd = rupiah per kelompok umur, bd2 = rupiah per kogol, bdm = rupiah per "kogol|umur".
     *
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     */
    private function fromUmurPiutang(array $lines): ?array
    {
        $raw = ['rp' => 0.0, 'plg' => 0.0, 'lbr' => 0.0, 'rp_lebih3' => 0.0];
        $bd = array_fill_keys(self::AGE_BUCKETS, 0.0);
        $bd2 = [];
        $bdm = [];
        foreach ($lines as $l) {
            $months = (int) $l['label'];
            if ($months < 1) {
                continue;
            }
            $rp = (float) ($l['values']['gabungan'] ?? 0);
            $bucket = match (true) {
                $months <= 3 => self::AGE_BUCKETS[$months - 1],
                $months <= 6 => self::AGE_BUCKETS[3],
                $months <= 12 => self::AGE_BUCKETS[4],
                default => self::AGE_BUCKETS[5],
            };
            $kogol = 'Kogol '.($l['values']['kogol'] ?? '-');
            $raw['rp'] += $rp;
            $raw['plg'] += (float) ($l['values']['plg'] ?? 0);
            $raw['lbr'] += (float) ($l['values']['lbr'] ?? 0);
            $months > 3 && $raw['rp_lebih3'] += $rp;
            $bd[$bucket] += $rp;
            $bd2[$kogol] = ($bd2[$kogol] ?? 0) + $rp;
            $bdm["{$kogol}|{$bucket}"] = ($bdm["{$kogol}|{$bucket}"] ?? 0) + $rp;
        }
        ksort($bd2);

        return $lines === [] ? null : ['raw' => $raw, 'bd' => $bd, 'bd2' => $bd2, 'bdm' => $bdm];
    }

    /** @param list<array{label: string, values: array<string, mixed>}> $lines */
    private function fromResponse(array $lines, string $responseKey, string $recoveryKey): ?array
    {
        $raw = ['n' => 0.0, 'rpt_x_n' => 0.0, 'rct_x_n' => 0.0, 'rpt_in' => 0.0, 'rpt_all' => 0.0];
        foreach ($lines as $l) {
            if (strtoupper($l['label']) === 'TOTAL') {
                continue;   // baris total laporan menggandakan baris posko
            }
            $v = $l['values'];
            $n = (float) ($v['total'] ?? 0);
            $raw['n'] += $n;
            $raw['rpt_x_n'] += (float) ($v[$responseKey] ?? 0) * $n;
            $raw['rct_x_n'] += (float) ($v[$recoveryKey] ?? 0) * $n;
            $raw['rpt_in'] += (float) ($v['response_dalam_sla'] ?? 0);
            $raw['rpt_all'] += (float) ($v['response_dalam_sla'] ?? 0) + (float) ($v['response_lewat_sla'] ?? 0);
        }

        return $lines === [] ? null : ['raw' => $raw, 'bd' => []];
    }

    /**
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     * @param  array<string, mixed>  $summary
     */
    private function fromDifi(array $lines, array $summary): ?array
    {
        if (! isset($summary['saidi_menit'], $summary['saifi_kali'])) {
            return null;
        }
        $plg = (float) ($summary['pelanggan'] ?? 0) ?: 1.0;   // tanpa jumlah pelanggan, ULP berbobot sama
        $ens = 0.0;
        foreach ($lines as $l) {
            if ($l['label'] === 'TOTAL KELOMPOK Distribusi') {
                $ens = (float) ($l['values']['kwh_tak_tersalurkan'] ?? 0);
            }
        }

        return ['raw' => ['plg' => $plg, 'saidi_x_plg' => (float) $summary['saidi_menit'] * $plg, 'saifi_x_plg' => (float) $summary['saifi_kali'] * $plg, 'ens_kwh' => $ens], 'bd' => []];
    }

    /**
     * Daya, kWh, dan rupiah per kelompok tarif laporan 309 (kunci `daya_R`, `kwh_R`, `rp_R`, dst.; huruf = S R B I P T C L), untuk menghitung kWh dan rupiah per kVA aktual tiap kelompok.
     *
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     */
    private function fromGroups309(array $lines): ?array
    {
        $raw = [];
        foreach ($lines as $l) {
            if (preg_match('/^JUMLAH ([SRBIP])$/', $l['label'], $m) || preg_match('/^([TCL]) \//', $l['label'], $m)) {
                $g = $m[1];
                $raw["daya_{$g}"] = ($raw["daya_{$g}"] ?? 0) + (float) ($l['values']['daya_va'] ?? 0);
                $raw["kwh_{$g}"] = ($raw["kwh_{$g}"] ?? 0) + (float) ($l['values']['kwh_jumlah'] ?? 0);
                $raw["rp_{$g}"] = ($raw["rp_{$g}"] ?? 0) + (float) ($l['values']['rp_jumlah'] ?? 0);
            }
        }

        return $raw === [] ? null : ['raw' => $raw, 'bd' => []];
    }

    /**
     * Jumlah gangguan menurut laporan DIFI (baris TOTAL KELOMPOK Distribusi); pembanding data gangguan tersinkron, bukan metrik sendiri.
     *
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     * @param  array<string, mixed>  $summary
     */
    private function fromDifiCount(array $lines, array $summary): ?array
    {
        foreach ($lines as $l) {
            if ($l['label'] === 'TOTAL KELOMPOK Distribusi') {
                return ['raw' => ['n' => (float) ($l['values']['jumlah_gangguan'] ?? 0)], 'bd' => []];
            }
        }

        return null;
    }

    /** @param list<array{label: string, values: array<string, mixed>}> $lines */
    private function fromTagsus(array $lines): ?array
    {
        $raw = ['kwh' => 0.0, 'rp' => 0.0, 'n' => 0.0];
        $bd = [];
        foreach ($lines as $l) {
            if ($l['label'] === '' || str_contains(strtoupper($l['label']), 'TOTAL') || in_array(strtoupper($l['label']), self::NON_P2TL, true)) {
                continue;
            }
            $raw['kwh'] += (float) ($l['values']['kwh'] ?? 0);
            $raw['rp'] += (float) ($l['values']['rp_total'] ?? 0);
            $raw['n'] += (float) ($l['values']['jumlah'] ?? 0);
            $bd[$l['label']] = ($bd[$l['label']] ?? 0) + (float) ($l['values']['kwh'] ?? 0);
        }

        return $lines === [] ? null : ['raw' => $raw, 'bd' => $bd];
    }

    /**
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    private function outages(array $units, string $from, string $to): array
    {
        $end = date('Y-m-d', strtotime($to.' +1 month'));
        $rows = DB::table('outage_events')->whereIn('organizational_unit_id', $units)->whereNull('source_removed_at')
            ->whereRaw("(occurred_at at time zone 'Asia/Jakarta') >= ?", [$from])->whereRaw("(occurred_at at time zone 'Asia/Jakarta') < ?", [$end])
            ->selectRaw("organizational_unit_id as u, to_char(occurred_at at time zone 'Asia/Jakarta', 'YYYY-MM') as m, coalesce(outage_type, 'TIDAK DIKETAHUI') as t, count(*) as n")
            ->groupBy('u', 'm', 't')->get();
        $out = [];
        foreach ($rows as $r) {
            $cell = &$out[$r->u][$r->m];
            $cell ??= ['raw' => ['n' => 0.0, 'permanen' => 0.0, 'temporer' => 0.0], 'bd' => []];
            $cell['raw']['n'] += (float) $r->n;
            $r->t === 'PERMANEN' && $cell['raw']['permanen'] += (float) $r->n;
            $r->t === 'TEMPORER' && $cell['raw']['temporer'] += (float) $r->n;
            $cell['bd'][ucfirst(strtolower($r->t))] = ($cell['bd'][ucfirst(strtolower($r->t))] ?? 0) + (float) $r->n;
            unset($cell);
        }

        return $out;
    }

    /**
     * Susut bulanan = (kWh beli − E-Min − PSSD − kWh jual) / (kWh beli − E-Min − PSSD). kWh beli, E-Min, PSSD dari masukan bulanan; kWh jual dari baris JUMLAH laporan 309.
     * Bulan dihitung hanya bila kWh beli dan laporan 309 ada. Kumulatif (rasio jumlah) sama dengan rumus susut NKO.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    public function losses(array $units, string $from, string $to): array
    {
        $inputs = [];
        foreach (DB::table('business_monthly_inputs')->whereIn('organizational_unit_id', $units)->whereBetween('period', [$from, $to])->get(['organizational_unit_id', 'period', 'code', 'value']) as $r) {
            $inputs[$r->organizational_unit_id][substr((string) $r->period, 0, 7)][$r->code] = (float) $r->value;
        }
        $sales = $this->eis('309', $units, $from, $to, fn (array $lines) => $this->from309($lines, 'kwh-jual'));
        $out = [];
        foreach ($inputs as $u => $byMonth) {
            foreach ($byMonth as $m => $v) {
                if (! isset($v['kwh-beli'], $sales[$u][$m])) {
                    continue;
                }
                $net = $v['kwh-beli'] - ($v['e-min'] ?? 0) - ($v['pssd'] ?? 0);
                $jual = $sales[$u][$m]['raw']['kwh'];
                $out[$u][$m] = ['raw' => ['beli' => $v['kwh-beli'], 'beli_net' => $net, 'jual' => $jual, 'susut_kwh' => $net - $jual], 'bd' => []];
            }
        }

        return $out;
    }

    /**
     * Biaya penyambungan (BP) = total biaya permohonan PB/PD menurut bulan lunas (paid_at, zona bisnis), tanpa yang dibatalkan atau direstitusi.
     * Kolom BP laporan AKHIRBULAN_EIS bernilai nol pada semua bulan contoh, sehingga sumbernya permohonan.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    private function connectionFees(array $units, string $from, string $to): array
    {
        $end = date('Y-m-d', strtotime($to.' +1 month'));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $units)->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw("(paid_at at time zone 'Asia/Jakarta') >= ?", [$from])->whereRaw("(paid_at at time zone 'Asia/Jakarta') < ?", [$end])
            ->selectRaw("organizational_unit_id as u, to_char(paid_at at time zone 'Asia/Jakarta', 'YYYY-MM') as m, coalesce(application_type, '-') as t, count(*) as n, coalesce(sum(total_cost), 0) as rp")
            ->groupBy('u', 'm', 't')->get();
        $out = [];
        foreach ($rows as $r) {
            $cell = &$out[$r->u][$r->m];
            $cell ??= ['raw' => ['rp' => 0.0, 'n' => 0.0], 'bd' => []];
            $cell['raw']['rp'] += (float) $r->rp;
            $cell['raw']['n'] += (float) $r->n;
            $cell['bd'][$r->t] = ($cell['bd'][$r->t] ?? 0) + (float) $r->rp;
            unset($cell);
        }

        return $out;
    }
}
