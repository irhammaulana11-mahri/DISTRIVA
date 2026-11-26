<?php

namespace App\Services\Nko;

/**
 * Katalog besaran NKO (docs/93): nama yang boleh dipakai di rumus `kpi_realization_rules`. Dihitung oleh NkoRealizationResolver.
 * Semua besaran adalah kumulatif Januari sampai bulan berjalan, kecuali posisi (`_akhir`, `_awal`).
 */
final class NkoSourceCatalog
{
    /**
     * nama => [kelompok perhitungan, penjumlahan UP3, satuan, keterangan].
     * Penjumlahan UP3: `JUMLAH` = jumlah nilai semua ULP (satu ULP kosong membuat UP3 kosong); `LANGSUNG` = dihitung dari data seluruh ULP (rata-rata tertimbang atau rasio).
     */
    public const QUANTITIES = [
        // besaran jadi: rumus indikator yang sudah baku (docs/90)
        'saidi_menit' => ['difi', 'LANGSUNG', 'menit', 'SAIDI dari laporan DIFI'],
        'saifi_kali' => ['difi', 'LANGSUNG', 'kali', 'SAIFI dari laporan DIFI'],
        'ens_mwh' => ['difi', 'LANGSUNG', 'MWh', 'Energi tak tersalurkan dari laporan DIFI'],
        'pelanggan_309' => ['309', 'JUMLAH', 'pelanggan', 'Penambahan pelanggan sejak Desember tahun lalu'],
        'daya_309' => ['309', 'JUMLAH', 'MVA', 'Penambahan daya tersambung sejak Desember tahun lalu'],
        'gangguan_penyulang' => ['outage', 'LANGSUNG', 'kali', 'Kejadian gangguan penyulang'],
        'response_ggnall' => ['ggn', 'LANGSUNG', 'menit', 'Response time gangguan di luar Clear Temper'],
        'rating_negatif_ggn' => ['ggn', 'LANGSUNG', 'laporan', 'Rating negatif PLN Mobile gangguan'],
        'susut_hitung' => ['susut', 'LANGSUNG', '%', 'Susut distribusi tanpa E-Min'],
        'penjualan_selisih' => ['penjualan', 'JUMLAH', 'GWh', 'Penjualan TL dikurangi baseline adjustment'],
        'hpl_bp' => ['bp', 'LANGSUNG', 'Rp miliar', 'Pendapatan biaya penyambungan (dasar kas; perkiraan bila rekap BP belum ada)'],
        'pelunasan_prabayar' => ['pelunasan', 'JUMLAH', 'Rp juta', 'Pelunasan PRR, Ex-PRR, dan piutang prabayar'],

        // besaran dasar: untuk menyusun cara hitung baru
        'pelanggan_309_akhir' => ['309', 'JUMLAH', 'pelanggan', 'Pelanggan 309 akhir bulan berjalan'],
        'pelanggan_309_awal' => ['309', 'JUMLAH', 'pelanggan', 'Pelanggan 309 Desember tahun lalu'],
        'daya_va_309_akhir' => ['309', 'JUMLAH', 'VA', 'Daya 309 akhir bulan berjalan'],
        'daya_va_309_awal' => ['309', 'JUMLAH', 'VA', 'Daya 309 Desember tahun lalu'],
        'kwh_jual' => ['jual', 'JUMLAH', 'kWh', 'kWh jual 309'],
        'kwh_jual_tahun_lalu' => ['jual', 'JUMLAH', 'kWh', 'kWh jual 309 periode yang sama tahun lalu'],
        'ba_penjualan' => ['ba', 'JUMLAH', 'kWh', 'Baseline adjustment penjualan TL'],
        'kwh_beli' => ['masukan_susut', 'JUMLAH', 'kWh', 'kWh beli (masukan)'],
        'e_min' => ['masukan_susut', 'JUMLAH', 'kWh', 'E-Min (masukan)'],
        'pssd' => ['masukan_susut', 'JUMLAH', 'kWh', 'PSSD (masukan)'],
        'lunas_prabayar' => ['pelunasan', 'JUMLAH', 'Rp juta', 'Pelunasan piutang prabayar'],
        'lunas_prr' => ['pelunasan', 'JUMLAH', 'Rp juta', 'Pelunasan PRR (masukan manual atau AP2T)'],
        'lunas_ex_prr' => ['pelunasan', 'JUMLAH', 'Rp juta', 'Pelunasan Ex-PRR (masukan manual atau AP2T)'],
        'response_total_durasi' => ['ggn', 'LANGSUNG', 'menit', 'Jumlah durasi response gangguan di luar Clear Temper'],
        'response_jumlah_wo' => ['ggn', 'LANGSUNG', 'WO', 'Jumlah WO gangguan di luar Clear Temper'],
        'bp_kas_rp' => ['bp', 'LANGSUNG', 'Rp', 'Penerimaan BP dikurangi restitusi (rekap BP AP2T)'],
        'bp_total_biaya_rp' => ['bp', 'LANGSUNG', 'Rp', 'Total biaya permohonan PB/PD yang dibayar'],
    ];

    /** masukan pembantu bawaan: ditampilkan bila rumus memakai salah satu besaran di `used_by` */
    public const AUXILIARY = [
        ['used_by' => ['susut_hitung', 'kwh_beli', 'e_min', 'pssd'], 'unit_label' => 'kWh', 'inputs' => ['kwh-beli' => 'kWh Beli (kumulatif)', 'e-min' => 'E-Min (kWh, kumulatif)', 'pssd' => 'PSSD (kWh, kumulatif)']],
        ['used_by' => ['pelunasan_prabayar', 'lunas_prr', 'lunas_ex_prr'], 'unit_label' => 'Rp juta', 'inputs' => ['prr-lunas' => 'Pelunasan PRR (Rp juta, kumulatif)', 'ex-prr-lunas' => 'Pelunasan Ex-PRR (Rp juta, kumulatif)']],
    ];
}
