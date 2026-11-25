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
        // sumber tunggal APKT (apkt_rpt_rct_records): "Semua Laporan" (dengan clear temper) sebagai angka utama, "Laporan Tanpa Clear Temper" sebagai pembanding; durasi dalam menit. GGNALL tidak dipakai lagi di menu ini
        // (angkanya sama persis dengan Semua Laporan, Jombang Oktober 2026 26,4 dan 62,85 menit dari 2.080 WO); APKT tidak memuat SLA sehingga seri SLA tidak ada.
        'rpt-rct-gangguan' => ['name' => 'RPT-RCT gangguan', 'source' => 'APKT – Jumlah dan Durasi RPT RCT Gangguan (Semua Laporan; pembanding Laporan Tanpa Clear Temper)', 'family' => null, 'zero_fill' => false, 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'rpt', 'name' => 'RPT – Semua laporan (APKT)', 'unit' => 'menit', 'num' => 'rpt_total', 'den' => 'rpt_count'], ['key' => 'rct', 'name' => 'RCT – Semua laporan (APKT)', 'unit' => 'menit', 'num' => 'rct_total', 'den' => 'rct_count'],
                ['key' => 'jumlah', 'name' => 'Jumlah WO – Semua laporan (APKT)', 'unit' => 'kali', 'num' => 'rpt_count'],
                ['key' => 'rpt_tanpa_ct', 'name' => 'RPT – Tanpa clear temper (APKT)', 'unit' => 'menit', 'num' => 'rpt_total_nct', 'den' => 'rpt_count_nct'], ['key' => 'rct_tanpa_ct', 'name' => 'RCT – Tanpa clear temper (APKT)', 'unit' => 'menit', 'num' => 'rct_total_nct', 'den' => 'rct_count_nct'],
                ['key' => 'jumlah_tanpa_ct', 'name' => 'Jumlah WO – Tanpa clear temper (APKT)', 'unit' => 'kali', 'num' => 'rpt_count_nct'],
                ['key' => 'porsi_clear_temper', 'name' => 'Porsi WO clear temper', 'unit' => '%', 'num' => 'n_ct', 'den' => 'rpt_count', 'factor' => 100]]],
        'anomali-keluhan' => ['name' => 'Anomali keluhan', 'source' => 'KLHBERULANG dan KLHNEGATIF (anomali penanganan pengaduan keluhan: berulang dan rating negatif)', 'family' => 'KLHBERULANG', 'families' => ['KLHBERULANG', 'KLHNEGATIF'], 'polarity' => 'down', 'ytd' => 'ratio',
            'breakdown' => 'Kanal pengaduan masuk', 'breakdown2' => 'Anomali menurut jenis dan kanal', 'no_matrix' => true,
            'series' => [['key' => 'wo', 'name' => 'Total pengaduan keluhan (WO)', 'unit' => 'kali', 'num' => 'wo'], ['key' => 'berulang', 'name' => 'Keluhan berulang', 'unit' => 'kali', 'num' => 'ber'], ['key' => 'berulang_pct', 'name' => 'Keluhan berulang terhadap total', 'unit' => '%', 'num' => 'ber', 'den' => 'wo', 'factor' => 100],
                ['key' => 'negatif', 'name' => 'Rating negatif', 'unit' => 'kali', 'num' => 'neg'], ['key' => 'negatif_pct', 'name' => 'Rating negatif terhadap total', 'unit' => '%', 'num' => 'neg', 'den' => 'neg_wo', 'factor' => 100]]],
        'anomali-gangguan' => ['name' => 'Anomali gangguan', 'source' => 'GGNBERULANG dan GGNNEGATIF (anomali penanganan pengaduan gangguan: berulang dan rating negatif)', 'family' => 'GGNBERULANG', 'families' => ['GGNBERULANG', 'GGNNEGATIF'], 'polarity' => 'down', 'ytd' => 'ratio',
            'breakdown' => 'Kanal pengaduan masuk', 'breakdown2' => 'Anomali menurut jenis, kanal, dan penandaan', 'no_matrix' => true,
            'series' => [['key' => 'wo', 'name' => 'Total pengaduan gangguan (WO)', 'unit' => 'kali', 'num' => 'wo'], ['key' => 'berulang', 'name' => 'Gangguan berulang', 'unit' => 'kali', 'num' => 'ber'], ['key' => 'berulang_pct', 'name' => 'Gangguan berulang terhadap total', 'unit' => '%', 'num' => 'ber', 'den' => 'wo', 'factor' => 100],
                ['key' => 'negatif', 'name' => 'Rating negatif', 'unit' => 'kali', 'num' => 'neg'], ['key' => 'negatif_pct', 'name' => 'Rating negatif terhadap total', 'unit' => '%', 'num' => 'neg', 'den' => 'neg_wo', 'factor' => 100],
                ['key' => 'negatif_nonmarking', 'name' => 'Rating negatif tanpa marking (ukuran NKO)', 'unit' => 'kali', 'num' => 'neg_non']]],
        'saidi-saifi' => ['name' => 'SAIDI dan SAIFI', 'source' => 'Laporan DIFI (ringkasan; rincian tingkat penyulang dari baris Gardu Induk 20 kV dan Penyulang)', 'family' => 'DIFI', 'polarity' => 'down', 'ytd' => 'sum', 'breakdown' => null,
            'series' => [['key' => 'saidi', 'name' => 'SAIDI', 'unit' => 'menit/plg', 'num' => 'saidi_x_plg', 'den' => 'plg'], ['key' => 'saifi', 'name' => 'SAIFI', 'unit' => 'kali/plg', 'num' => 'saifi_x_plg', 'den' => 'plg'],
                ['key' => 'saidi_penyulang', 'name' => 'SAIDI karena gangguan penyulang', 'unit' => 'menit/plg', 'num' => 'pny_ggn_saidi_x_plg', 'den' => 'plg'], ['key' => 'saifi_penyulang', 'name' => 'SAIFI karena gangguan penyulang', 'unit' => 'kali/plg', 'num' => 'pny_ggn_plg', 'den' => 'plg']],
            'companion' => ['source' => 'Data gangguan penyulang dari spreadsheet: gangguan lebih dari ambang menit, pelanggan penyulang dari potret DIL (batas atas)', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'],
                'series' => [['key' => 'saidi_hitung', 'name' => 'SAIDI hitung DISTRIVA', 'unit' => 'menit/plg', 'num' => 'saidi_x_base', 'den' => 'base'], ['key' => 'saifi_hitung', 'name' => 'SAIFI hitung DISTRIVA', 'unit' => 'kali/plg', 'num' => 'saifi_x_base', 'den' => 'base']],
                // pembanding hanya bagian gangguan penyulang DIFI: spreadsheet hanya memuat gangguan penyulang, sedangkan SAIDI/SAIFI total DIFI juga memuat padam JTR, sambungan rumah, dan pemeliharaan
                'reconcile' => [['key' => 'saidi', 'mode' => 'flow', 'unit' => 'menit/plg', 'official_name' => 'SAIDI gangguan penyulang (DIFI)', 'official' => ['num' => ['pny_ggn_saidi_x_plg'], 'den' => 'plg'], 'companion_name' => 'SAIDI hitung DISTRIVA', 'companion' => ['num' => ['saidi_x_base'], 'den' => 'base']],
                    ['key' => 'saifi', 'mode' => 'flow', 'unit' => 'kali/plg', 'official_name' => 'SAIFI gangguan penyulang (DIFI)', 'official' => ['num' => ['pny_ggn_plg'], 'den' => 'plg'], 'companion_name' => 'SAIFI hitung DISTRIVA', 'companion' => ['num' => ['saifi_x_base'], 'den' => 'base']]]]],
        'ens' => ['name' => 'ENS', 'source' => 'Laporan DIFI (TOTAL KELOMPOK Distribusi; rincian tingkat penyulang dari baris Gardu Induk 20 kV dan Penyulang)', 'family' => 'DIFI', 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => null,
            'series' => [['key' => 'ens', 'name' => 'Energi tak tersalurkan', 'unit' => 'MWh', 'num' => 'ens_kwh', 'factor' => 1e-3], ['key' => 'ens_penyulang', 'name' => 'ENS karena gangguan penyulang', 'unit' => 'MWh', 'num' => 'pny_ggn_kwh', 'factor' => 1e-3]],
            'companion' => ['source' => 'Data gangguan penyulang dari spreadsheet (kolom ENS, menurut ULP peristiwa)', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'],
                'series' => [['key' => 'ens_sheet', 'name' => 'ENS data gangguan penyulang', 'unit' => 'MWh', 'num' => 'ens_kwh', 'factor' => 1e-3]],
                'reconcile' => [['key' => 'ens', 'mode' => 'flow', 'unit' => 'MWh', 'official_name' => 'ENS gangguan penyulang (DIFI)', 'official' => ['num' => ['pny_ggn_kwh'], 'factor' => 1e-3], 'companion_name' => 'ENS data gangguan penyulang', 'companion' => ['num' => ['ens_kwh'], 'factor' => 1e-3]]]]],
        'kwh-p2tl' => ['name' => 'kWh P2TL', 'source' => 'TAGSUS (golongan P1-P4, K2, tanpa golongan; tanpa TS kWh dan DKRP)', 'family' => 'TAGSUS', 'polarity' => 'up', 'ytd' => 'ratio', 'breakdown' => 'Golongan pelanggaran',
            'series' => [['key' => 'kwh', 'name' => 'kWh P2TL', 'unit' => 'kWh', 'num' => 'kwh'], ['key' => 'rp', 'name' => 'Rupiah tagihan susulan', 'unit' => 'Rp', 'num' => 'rp'], ['key' => 'jumlah', 'name' => 'Jumlah pelanggan', 'unit' => 'plg', 'num' => 'n']]],
        'gangguan' => ['name' => 'Gangguan penyulang', 'source' => 'Data gangguan penyulang dari spreadsheet (gangguan feeder/penyulang: PMT dan recloser)', 'family' => null, 'polarity' => 'down', 'ytd' => 'ratio', 'breakdown' => 'Jenis gangguan',
            'series' => [['key' => 'jumlah', 'name' => 'Jumlah gangguan penyulang', 'unit' => 'kali', 'num' => 'n'], ['key' => 'permanen', 'name' => 'Permanen', 'unit' => 'kali', 'num' => 'permanen'], ['key' => 'temporer', 'name' => 'Temporer', 'unit' => 'kali', 'num' => 'temporer'],
                ['key' => 'dihitung', 'name' => 'Gangguan lebih dari ambang menit (masuk SAIDI/SAIFI)', 'unit' => 'kali', 'num' => 'n_hitung']],
            // DIFI tingkat penyulang: jumlah dan pelanggan padam pada penyulang yang mengalami gangguan (padam tidak terencana dan bencana alam) atau pemeliharaan (padam terencana)
            'companion' => ['source' => 'Laporan DIFI tingkat penyulang (Gardu Induk 20 kV dan Penyulang): gangguan = padam tidak terencana dan bencana alam, pemeliharaan = padam terencana', 'forecast' => ['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'], 'reported' => true,
                'series' => [['key' => 'difi_gangguan', 'name' => 'Gangguan penyulang (DIFI)', 'unit' => 'kali', 'num' => 'n'], ['key' => 'difi_pelanggan_gangguan', 'name' => 'Pelanggan padam karena gangguan penyulang (DIFI)', 'unit' => 'plg', 'num' => 'plg'],
                    ['key' => 'difi_pemeliharaan', 'name' => 'Pemeliharaan penyulang (DIFI)', 'unit' => 'kali', 'num' => 'har_n'], ['key' => 'difi_pelanggan_pemeliharaan', 'name' => 'Pelanggan padam karena pemeliharaan penyulang (DIFI)', 'unit' => 'plg', 'num' => 'har_plg']],
                // hanya gangguan yang masuk hitungan (lebih dari ambang menit): DIFI tidak mencatat padam singkat; pemeliharaan tidak ada di spreadsheet sehingga tidak direkonsiliasi
                // pelanggan padam diambil dari DIFI (pelanggan pada penyulang yang padam), tidak diperkirakan dari DIL: perkiraan DIL menganggap seluruh pelanggan penyulang padam pada tiap gangguan
                // (termasuk recloser yang hanya memadamkan sebagian) sehingga selalu jauh lebih besar
                'reconcile' => [['key' => 'gangguan', 'mode' => 'flow', 'unit' => 'kali', 'official_name' => 'Gangguan penyulang lebih dari ambang menit (spreadsheet)', 'official' => ['num' => ['n_hitung']], 'companion_name' => 'Gangguan penyulang (DIFI)', 'companion' => ['num' => ['n']]]]]],
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
            'rpt-rct-gangguan' => $this->apktRptRct($units, $fromDate, $toDate),
            'saidi-saifi', 'ens' => $this->eis('DIFI', $units, $fromDate, $toDate, fn (array $lines, array $summary) => $this->fromDifi($lines, $summary)),
            'grup-309' => $this->eis('309', $units, $fromDate, $toDate, fn (array $lines) => $this->fromGroups309($lines)),
            'anomali-keluhan' => $this->anomalies('KLH', $units, $fromDate, $toDate),
            'anomali-gangguan' => $this->anomalies('GGN', $units, $fromDate, $toDate),
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
        if ($code === 'rpt-rct-gangguan' && $months !== []) {
            $have = [];
            foreach ($this->apktRptRct($units, $months[0].'-01', end($months).'-01') as $u => $byMonth) {
                $have[$u] = array_keys($byMonth);
            }

            return array_filter(array_combine($units, array_map(fn ($u) => array_values(array_diff($months, $have[$u] ?? [])), $units)));
        }
        $family = self::CATALOG[$code]['family'] ?? null;
        if ($family === null || $months === []) {
            return [];
        }
        $families = self::CATALOG[$code]['families'] ?? [$family];
        $have = [];
        foreach ($families as $fam) {
            // metrik dari beberapa laporan (mis. anomali: berulang dan rating negatif): bulan dianggap ada hanya bila semua jenisnya ada
            $perUnit = DB::table('eis_report_files')->where('family', $fam)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)
                ->whereBetween('period', [$months[0].'-01', end($months).'-01'])->get(['organizational_unit_id', 'period'])
                ->groupBy('organizational_unit_id')->map(fn ($rows) => $rows->map(fn ($r) => substr((string) $r->period, 0, 7))->all());
            foreach ($units as $u) {
                $have[$u] = isset($have[$u]) ? array_values(array_intersect($have[$u], $perUnit[$u] ?? [])) : ($perUnit[$u] ?? []);
            }
        }
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

    /**
     * RPT/RCT WO gangguan dari penarikan APKT: total durasi dan jumlah WO per ULP per bulan. Baris `clear_temper` true = Semua Laporan (utama), false = Tanpa Clear Temper (pembanding, akhiran `_nct`);
     * porsi WO clear temper (`n_ct`) hanya ada bila kedua varian tersimpan untuk bulan itu.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    private function apktRptRct(array $units, string $from, string $to): array
    {
        $out = [];
        foreach (DB::table('apkt_rpt_rct_records')->whereIn('organizational_unit_id', $units)->whereBetween('period', [$from, $to])->get() as $r) {
            $cell = &$out[$r->organizational_unit_id][substr((string) $r->period, 0, 7)];
            $cell ??= ['raw' => [], 'bd' => []];
            $suffix = $r->clear_temper ? '' : '_nct';
            $cell['raw']['rpt_total'.$suffix] = (float) $r->rpt_total;
            $cell['raw']['rpt_count'.$suffix] = (float) $r->rpt_count;
            $cell['raw']['rct_total'.$suffix] = (float) $r->rct_total;
            $cell['raw']['rct_count'.$suffix] = (float) $r->rct_count;
            unset($cell);
        }
        foreach ($out as &$byMonth) {
            foreach ($byMonth as &$cell) {
                isset($cell['raw']['rpt_count'], $cell['raw']['rpt_count_nct']) && $cell['raw']['n_ct'] = $cell['raw']['rpt_count'] - $cell['raw']['rpt_count_nct'];
            }
            unset($cell);
        }
        unset($byMonth);

        return $out;
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

        $f = $this->difiFeederLevel($lines);

        return ['raw' => ['plg' => $plg, 'saidi_x_plg' => (float) $summary['saidi_menit'] * $plg, 'saifi_x_plg' => (float) $summary['saifi_kali'] * $plg, 'ens_kwh' => $ens,
            'pny_ggn_n' => $f['ggn_n'], 'pny_ggn_plg' => $f['ggn_plg'], 'pny_ggn_saidi_x_plg' => $f['ggn_menit_x_plg'], 'pny_ggn_kwh' => $f['ggn_kwh'],
            'pny_har_n' => $f['har_n'], 'pny_har_plg' => $f['har_plg'], 'pny_har_saidi_x_plg' => $f['har_menit_x_plg'], 'pny_har_kwh' => $f['har_kwh']], 'bd' => []];
    }

    /**
     * Bagian tingkat penyulang (tegangan menengah) laporan DIFI kelompok Distribusi: baris subtotal fasilitas Gardu Induk (20 kV) dan Penyulang pada tiap sub kelompok, dijumlahkan menjadi
     * gangguan (Padam Tidak Terencana dan Bencana Alam) dan pemeliharaan (Padam Terencana). Sub kelompok diketahui dari baris "TOTAL SUB KELOMPOK ..." yang menutup bagiannya.
     * Padam JTR, gardu distribusi, dan sambungan rumah (di bawah penyulang) tidak ikut. Pelanggan padam DIFI = pelanggan pada penyulang yang padam; SAIDI = jam x pelanggan x 60 / pelanggan unit.
     *
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     * @return array<string, float>
     */
    private function difiFeederLevel(array $lines): array
    {
        $out = array_fill_keys(['ggn_n', 'ggn_plg', 'ggn_menit_x_plg', 'ggn_kwh', 'har_n', 'har_plg', 'har_menit_x_plg', 'har_kwh'], 0.0);
        $pending = [];
        foreach ($lines as $l) {
            if (in_array($l['label'], ['SUB TOTAL FASILITAS Gardu Induk', 'SUB TOTAL FASILITAS Penyulang'], true)) {
                $pending[] = $l['values'];

                continue;
            }
            if (str_starts_with($l['label'], 'TOTAL SUB KELOMPOK ')) {
                $kind = match (substr($l['label'], strlen('TOTAL SUB KELOMPOK '))) {
                    'Padam Tidak Terencana', 'Bencana Alam' => 'ggn',
                    'Padam Terencana' => 'har',
                    default => null,
                };
                foreach ($kind === null ? [] : $pending as $v) {
                    $out["{$kind}_n"] += (float) ($v['jumlah_gangguan'] ?? 0);
                    $out["{$kind}_plg"] += (float) ($v['jml_plg_padam'] ?? 0);
                    $out["{$kind}_menit_x_plg"] += (float) ($v['jam_x_plg'] ?? 0) * 60;
                    $out["{$kind}_kwh"] += (float) ($v['kwh_tak_tersalurkan'] ?? 0);
                }
                $pending = [];

                continue;
            }
            if ($l['label'] === 'TOTAL KELOMPOK Distribusi') {
                break;
            }
        }

        return $out;
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
     * Anomali penanganan pengaduan (keluhan KLH atau gangguan GGN) dari dua laporan: berulang dan rating negatif (docs/88, docs/91). Satu bulan satu ULP hanya dihitung bila keduanya ada.
     * Tata letak: B..E jumlah pengaduan (WO) per kanal CC 123, PLN Mobile, Loket, Lainnya, F total; KLH: G PLN Mobile, H CC 123, I total anomali; GGN: G/H PLN Mobile marking/non marking,
     * I/J CC 123 marking/non marking, K/L total marking/non marking. Berkas sampai September 2025 memuat tabel kedua (hanya PLN Mobile): dibaca baris pertama yang memuat kolom F saja.
     *
     * @param  'KLH'|'GGN'  $kind
     * @param  list<string>  $units
     * @return array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>
     */
    private function anomalies(string $kind, array $units, string $from, string $to): array
    {
        $ber = $this->eis($kind.'BERULANG', $units, $from, $to, fn (array $lines) => $this->anomalyRow($lines, $kind));
        $neg = $this->eis($kind.'NEGATIF', $units, $from, $to, fn (array $lines) => $this->anomalyRow($lines, $kind));
        $out = [];
        foreach ($ber as $u => $byMonth) {
            foreach ($byMonth as $m => $b) {
                $n = $neg[$u][$m] ?? null;
                if ($n === null) {
                    continue;
                }
                $bd2 = [];
                foreach ($b['anom'] as $label => $v) {
                    $bd2['Berulang · '.$label] = $v;
                }
                foreach ($n['anom'] as $label => $v) {
                    $bd2['Rating negatif · '.$label] = $v;
                }
                $out[$u][$m] = ['raw' => ['wo' => $b['wo'], 'ber' => $b['total'], 'neg' => $n['total'], 'neg_wo' => $n['wo'], 'neg_non' => $n['non'] ?? 0.0], 'bd' => $b['channels'], 'bd2' => $bd2];
            }
        }

        return $out;
    }

    /**
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     * @return array{wo: float, total: float, non?: float, channels: array<string, float>, anom: array<string, float>}|null
     */
    private function anomalyRow(array $lines, string $kind): ?array
    {
        foreach ($lines as $l) {
            $v = $l['values'];
            if (! isset($v['c_F'])) {
                continue;
            }
            $f = fn (string $k) => (float) ($v[$k] ?? 0);
            $row = ['wo' => $f('c_F'), 'channels' => ['CC 123' => $f('c_B'), 'PLN Mobile' => $f('c_C'), 'Loket' => $f('c_D'), 'Lainnya' => $f('c_E')]];
            if ($kind === 'KLH') {
                return $row + ['total' => $f('c_I'), 'anom' => ['PLN Mobile' => $f('c_G'), 'CC 123' => $f('c_H')]];
            }

            return $row + ['total' => $f('c_K') + $f('c_L'), 'non' => $f('c_L'), 'anom' => ['PLN Mobile · Marking' => $f('c_G'), 'PLN Mobile · Non Marking' => $f('c_H'), 'CC 123 · Marking' => $f('c_I'), 'CC 123 · Non Marking' => $f('c_J')]];
        }

        return null;
    }

    /**
     * Pendamping menu Gangguan Penyulang dari laporan DIFI tingkat penyulang: jumlah dan pelanggan padam karena gangguan penyulang dan karena pemeliharaan penyulang (bukan TOTAL KELOMPOK Distribusi,
     * yang juga memuat padam JTR dan sambungan rumah).
     *
     * @param  list<array{label: string, values: array<string, mixed>}>  $lines
     * @param  array<string, mixed>  $summary
     */
    private function fromDifiCount(array $lines, array $summary): ?array
    {
        if (! in_array('TOTAL KELOMPOK Distribusi', array_column($lines, 'label'), true)) {
            return null;
        }
        $f = $this->difiFeederLevel($lines);

        return ['raw' => ['n' => $f['ggn_n'], 'plg' => $f['ggn_plg'], 'har_n' => $f['har_n'], 'har_plg' => $f['har_plg']], 'bd' => []];
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
        // gangguan yang masuk hitungan SAIDI/SAIFI (aturan yang sama dengan analisis gangguan: minimal ambang menit, permanen saja bila diatur)
        $set = DB::table('outage_sync_settings')->where('id', 1)->first();
        $counted = DB::table('outage_events')->whereIn('organizational_unit_id', $units)->whereNull('source_removed_at')->whereNotNull('duration_minutes')->where('duration_minutes', '>=', (int) ($set->saidi_min_minutes ?? 5))
            ->when((bool) ($set->saidi_only_permanent ?? false), fn ($q) => $q->where('outage_type', 'PERMANEN'))
            ->whereRaw("(occurred_at at time zone 'Asia/Jakarta') >= ?", [$from])->whereRaw("(occurred_at at time zone 'Asia/Jakarta') < ?", [$end])
            ->selectRaw("organizational_unit_id as u, to_char(occurred_at at time zone 'Asia/Jakarta', 'YYYY-MM') as m, count(*) as n")->groupBy('u', 'm')->get();
        foreach ($counted as $r) {
            $out[$r->u][$r->m]['raw']['n_hitung'] = (float) $r->n;
        }
        foreach ($out as $u => $byMonth) {
            foreach ($byMonth as $m => $cell) {
                $out[$u][$m] = ['raw' => ($cell['raw'] ?? []) + ['n' => 0.0, 'permanen' => 0.0, 'temporer' => 0.0, 'n_hitung' => 0.0], 'bd' => $cell['bd'] ?? []];
            }
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
