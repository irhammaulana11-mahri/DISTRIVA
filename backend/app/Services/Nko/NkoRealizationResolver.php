<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/**
 * Menentukan realisasi kumulatif (Januari sampai bulan berjalan) tiap indikator untuk satu unit: masukan manual bila ada, selain itu dari sumber sistem.
 * Sumber sistem saat ini: penambahan pelanggan dan daya tersambung dari laporan 309 (selisih terhadap Desember tahun lalu); SAIDI, SAIFI, dan ENS dari laporan DIFI yang diunggah (jumlah bulanan Januari sampai bulan berjalan; ENS dari baris "TOTAL KELOMPOK Distribusi", kWh menjadi MWh).
 * Sumber sistem hanya dipakai bila laporan DIFI semua bulan Januari sampai bulan berjalan tersedia; bila tidak, indikator dibiarkan kosong sampai laporan atau masukan manual ada (docs/90).
 */
class NkoRealizationResolver
{
    /** kode indikator => jenis sumber sistem */
    public const SYSTEM_CODES = ['saidi' => 'saidi_menit', 'saifi' => 'saifi_kali', 'ens' => 'ens_mwh', 'penambahan-pelanggan' => 'pelanggan_309', 'daya-tersambung' => 'daya_309',
        'gangguan-tm' => 'gangguan_penyulang', 'response-time-atas-gangguan-diluar-clear-tamper' => 'response_ggnall', 'feedback-rating-negatif-pada-pln-mobile-gangguan' => 'rating_negatif_ggn',
        'susut-distribusi-tanpa-e-min' => 'susut_hitung', 'penjualan-tenaga-listrik' => 'penjualan_selisih', 'pendapatan-biaya-penyambungan' => 'hpl_bp',
        self::PELUNASAN_CODE => 'pelunasan_prabayar'];

    public const PELUNASAN_CODE = 'pencapaian-pelunasan-prr-ex-prr-dan-piutang-prabayar';

    /** @var array<string, string> masukan pembantu pelunasan (Rp juta, kumulatif, manual): PRR dan Ex-PRR belum punya data */
    public const PELUNASAN_INPUTS = ['prr-lunas' => 'Pelunasan PRR (Rp juta, kumulatif)', 'ex-prr-lunas' => 'Pelunasan Ex-PRR (Rp juta, kumulatif)'];

    /** @return array<string, array<string, string>> kode indikator => masukan pembantunya */
    public static function auxiliaryInputs(): array
    {
        return [self::SUSUT_CODE => self::SUSUT_INPUTS, self::PELUNASAN_CODE => self::PELUNASAN_INPUTS];
    }

    /** kode susut dan masukan pembantunya (kWh kumulatif, diisi manual; kWh jual dari total laporan 309) */
    public const SUSUT_CODE = 'susut-distribusi-tanpa-e-min';

    /** @var array<string, string> kode masukan pembantu => nama */
    public const SUSUT_INPUTS = ['kwh-beli' => 'kWh Beli (kumulatif)', 'e-min' => 'E-Min (kWh, kumulatif)', 'pssd' => 'PSSD (kWh, kumulatif)'];

    /** sumber sistem yang dimuat otomatis tetapi belum cocok dengan angka workbook (dapat dikoreksi dengan masukan manual disertai alasan) */
    public const UNVALIDATED_CODES = [self::PELUNASAN_CODE, 'penjualan-tenaga-listrik', 'pendapatan-biaya-penyambungan', 'gangguan-tm', 'susut-distribusi-tanpa-e-min', 'response-time-atas-gangguan-diluar-clear-tamper', 'feedback-rating-negatif-pada-pln-mobile-gangguan'];

    /**
     * @return array<string, array{value: float, source: string, manual: ?float, system: ?float, note: ?string}> menurut kode indikator
     */
    public function resolve(string $unitId, int $year, int $month): array
    {
        $out = [];
        $system = $this->systemValues($unitId, $year, $month);
        foreach ($system as $code => $v) {
            $out[$code] = ['value' => $v, 'source' => 'SISTEM', 'manual' => null, 'system' => $v, 'note' => null];
        }
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))->get(['definition_code', 'value', 'note']);
        foreach ($manual as $m) {
            $out[$m->definition_code] = ['value' => (float) $m->value, 'source' => 'MANUAL', 'manual' => (float) $m->value, 'system' => $out[$m->definition_code]['system'] ?? null, 'note' => $m->note];
        }

        return $out;
    }

    /**
     * @return array<string, float>
     */
    public function systemValues(string $unitId, int $year, int $month): array
    {
        $children = $this->childUlps($unitId);
        if ($children !== []) {
            return $this->aggregateValues($unitId, $children, $year, $month);
        }

        return $this->difiValues([$unitId], $year, $month) + $this->report309Values($unitId, $year, $month) + $this->outageValues($unitId, $year, $month) + $this->ggnValues([$unitId], $year, $month) + $this->susutValues($unitId, $year, $month)
            + $this->penjualanValues($unitId, $year, $month) + $this->pelunasanValues($unitId, $year, $month) + $this->connectionFeeValues([$unitId], $year, $month);
    }

    /**
     * ULP di bawah UP3 (kosong untuk ULP atau unit tanpa anak ULP).
     *
     * @return list<string>
     */
    private function childUlps(string $unitId): array
    {
        return DB::table('organizational_units')->where('parent_id', $unitId)->where('unit_type', 'ULP')->orderBy('id')->pluck('id')->all();
    }

    /**
     * Realisasi sistem tingkat UP3 dari ULP di bawahnya: jumlah (penambahan pelanggan, daya, ENS, penjualan, pelunasan, rating negatif, HPL BP), rata-rata tertimbang pelanggan per bulan (SAIDI, SAIFI),
     * tertimbang jumlah WO (response time), dan rasio jumlah (susut). Hanya dihitung bila SEMUA ULP punya datanya; satu ULP kosong membuat indikator itu kosong, bukan jumlah sebagian
     * (angka UP3 yang tampak lengkap padahal kurang satu ULP lebih menyesatkan daripada kosong). Gangguan TM dihitung langsung dari data gangguan (sudah menjumlahkan ULP).
     *
     * @param  list<string>  $children
     * @return array<string, float>
     */
    private function aggregateValues(string $unitId, array $children, int $year, int $month): array
    {
        $per = [];
        foreach ($children as $child) {
            $per[$child] = $this->systemValues($child, $year, $month);
        }
        $out = $this->difiValues($children, $year, $month) + $this->outageValues($unitId, $year, $month) + $this->ggnValues($children, $year, $month) + $this->connectionFeeValues($children, $year, $month);
        $sums = ['penambahan-pelanggan', 'daya-tersambung', 'penjualan-tenaga-listrik', self::PELUNASAN_CODE];
        foreach ($sums as $code) {
            $values = array_column($per, $code);
            count($values) === count($children) && $out[$code] = array_sum($values);
        }
        $losses = array_map(fn ($c) => $this->lossParts($c, $year, $month), $children);
        if (! in_array(null, $losses, true)) {
            $base = array_sum(array_column($losses, 'base'));
            $base > 0 && $out[self::SUSUT_CODE] = ($base - array_sum(array_column($losses, 'jual'))) / $base * 100;
        }

        return $out;
    }

    /**
     * Penambahan pelanggan (jumlah) dan daya tersambung (MVA) = posisi laporan 309 akhir bulan dikurangi posisi Desember tahun sebelumnya (baris "JUMLAH"); divalidasi terhadap workbook ULP Jombang.
     *
     * @return array<string, float>
     */
    private function report309Values(string $unitId, int $year, int $month): array
    {
        $fetch = function (string $period) use ($unitId): ?array {
            $file = DB::table('eis_report_files')->where('family', '309')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)->where('period', $period)->value('id');
            if ($file === null) {
                return null;
            }
            $line = DB::table('eis_report_lines')->where('file_id', $file)->where('label', 'JUMLAH')->orderByDesc('line_no')->value('values');

            return $line === null ? null : json_decode($line, true);
        };
        $now = $fetch(sprintf('%04d-%02d-01', $year, $month));
        $base = $fetch(($year - 1).'-12-01');
        if ($now === null || $base === null || ! isset($now['pelanggan'], $now['daya_va'], $base['pelanggan'], $base['daya_va'])) {
            return [];
        }

        return [
            'penambahan-pelanggan' => (float) $now['pelanggan'] - (float) $base['pelanggan'],
            'daya-tersambung' => ((float) $now['daya_va'] - (float) $base['daya_va']) / 1000000,
        ];
    }

    /**
     * Pelunasan (Rp juta, kumulatif) = komponen piutang prabayar dari laporan PIUTANGLPB_EIS + PRR + Ex-PRR (dua terakhir dari laporan AP2T Januari sampai bulan berjalan bila semua bulan ada; masukan manual pembantu bulan itu diutamakan; dianggap 0 bila keduanya kosong).
     * Pelunasan prabayar tiap bulan = (BARU + BERJALAN + TUNGGAKAN bulan lalu) - (BERJALAN + TUNGGAKAN bulan ini), nilai negatif dihitung 0, dijumlahkan Januari sampai bulan berjalan
     * (Januari memakai laporan Desember tahun lalu; semua laporan harus ada). Definisi dari pemilik; kumulatif September Jombang 117,36 lawan workbook 117,53 (bulan awal workbook belum terisi).
     *
     * @return array<string, float>
     */
    private function pelunasanValues(string $unitId, int $year, int $month): array
    {
        $balances = function (string $period) use ($unitId): ?array {
            $file = DB::table('eis_report_files')->where('family', 'PIUTANGLPB_EIS')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)->where('period', $period)->value('id');
            if ($file === null) {
                return null;
            }
            $out = ['BARU' => 0.0, 'BERJALAN' => 0.0, 'TUNGGAKAN' => 0.0];
            foreach (DB::table('eis_report_lines')->where('file_id', $file)->whereIn('label', array_keys($out))->get(['label', 'values']) as $l) {
                $out[$l->label] += (float) (json_decode($l->values, true)['rptag'] ?? 0);
            }

            return $out;
        };
        $prev = $balances(($year - 1).'-12-01');
        if ($prev === null) {
            return [];
        }
        $total = 0.0;
        for ($m = 1; $m <= $month; $m++) {
            $cur = $balances(sprintf('%04d-%02d-01', $year, $m));
            if ($cur === null) {
                return [];
            }
            $total += max(0.0, array_sum($prev) - ($cur['BERJALAN'] + $cur['TUNGGAKAN']));
            $prev = $cur;
        }
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))
            ->whereIn('definition_code', array_keys(self::PELUNASAN_INPUTS))->pluck('value', 'definition_code');
        $extra = 0.0;
        foreach (['prr-lunas' => 'PRR', 'ex-prr-lunas' => 'EXPRR'] as $code => $family) {                    // masukan manual (kumulatif) diutamakan; selain itu pelunasan AP2T Januari sampai bulan berjalan
            $extra += isset($manual[$code]) ? (float) $manual[$code] : ($this->raguRepayment($unitId, $family, $year, $month) ?? 0.0);
        }

        return [self::PELUNASAN_CODE => $total / 1000000 + $extra];
    }

    /**
     * Pelunasan piutang ragu-ragu (PRR atau Ex-PRR, Rp juta, kumulatif) = jumlah Rp pelunasan seluruh baris laporan AP2T Januari sampai bulan berjalan; null bila ada bulan yang laporannya belum masuk.
     * Laporan tanpa baris (tidak ada pelunasan) bernilai nol.
     */
    private function raguRepayment(string $unitId, string $family, int $year, int $month): ?float
    {
        $files = DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->pluck('id');
        if ($files->count() !== $month) {
            return null;
        }
        $sum = 0.0;
        foreach (DB::table('eis_report_lines')->whereIn('file_id', $files)->pluck('values') as $values) {
            $sum += (float) (json_decode($values, true)['rp_prr'] ?? 0);
        }

        return $sum / 1000000;
    }

    /**
     * Penambahan penjualan TL (GWh) = kWh jual kumulatif tahun berjalan dikurangi periode yang sama tahun lalu, dari baris "JUMLAH" laporan 309 (semua bulan kedua tahun harus ada).
     * Definisi dari pemilik; angka workbook berbeda karena faktor lain (pembanding tahun lalu workbook bukan dari 309), sehingga dapat dikoreksi dengan masukan manual beralasan.
     *
     * @return array<string, float>
     */
    private function penjualanValues(string $unitId, int $year, int $month): array
    {
        $ytd = function (int $y) use ($unitId, $month): ?float {
            $files = DB::table('eis_report_files')->where('family', '309')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
                ->whereBetween('period', ["{$y}-01-01", sprintf('%04d-%02d-01', $y, $month)])->pluck('id');
            if ($files->count() !== $month) {
                return null;
            }
            $sum = 0.0;
            foreach ($files as $id) {
                $line = DB::table('eis_report_lines')->where('file_id', $id)->where('label', 'JUMLAH')->orderByDesc('line_no')->value('values');
                if ($line === null) {
                    return null;
                }
                $sum += (float) (json_decode($line, true)['kwh_jumlah'] ?? 0);
            }

            return $sum;
        };
        $now = $ytd($year);
        $before = $ytd($year - 1);

        return $now === null || $before === null ? [] : ['penjualan-tenaga-listrik' => ($now - $before) / 1000000];
    }

    /**
     * Susut distribusi tanpa E-Min (%, kumulatif) = (kWh beli - E-Min - PSSD - kWh jual) / (kWh beli - E-Min - PSSD) x 100.
     * kWh beli, E-Min, dan PSSD (kumulatif Januari sampai bulan berjalan) diisi manual; kWh jual = jumlah baris "JUMLAH" laporan 309 Januari sampai bulan berjalan (semua bulan harus ada).
     * Bila masukan kumulatif NKO tidak diisi, dipakai jumlah masukan bulanan pengusahaan (kWh beli semua bulan harus ada).
     * Rumus berdasarkan penjelasan pemilik; belum divalidasi terhadap angka workbook karena belum ada data kWh beli.
     *
     * @return array<string, float>
     */
    private function susutValues(string $unitId, int $year, int $month): array
    {
        $parts = $this->lossParts($unitId, $year, $month);

        return $parts === null ? [] : [self::SUSUT_CODE => ($parts['base'] - $parts['jual']) / $parts['base'] * 100];
    }

    /**
     * kWh beli bersih (setelah E-Min dan PSSD) dan kWh jual kumulatif satu ULP, atau null bila datanya belum lengkap; dipakai tingkat ULP dan penjumlahan tingkat UP3.
     *
     * @return array{base: float, jual: float}|null
     */
    private function lossParts(string $unitId, int $year, int $month): ?array
    {
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))
            ->whereIn('definition_code', array_keys(self::SUSUT_INPUTS))->pluck('value', 'definition_code');
        if (! isset($manual['kwh-beli'])) {
            $manual = $this->monthlyLossInputs($unitId, $year, $month);
        }
        if (! isset($manual['kwh-beli']) || (float) $manual['kwh-beli'] <= 0) {
            return null;
        }
        $files = DB::table('eis_report_files')->where('family', '309')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->pluck('id');
        if ($files->count() !== $month) {
            return null;
        }
        $jual = 0.0;
        foreach ($files as $id) {
            $line = DB::table('eis_report_lines')->where('file_id', $id)->where('label', 'JUMLAH')->orderByDesc('line_no')->value('values');
            if ($line === null) {
                return null;
            }
            $jual += (float) (json_decode($line, true)['kwh_jumlah'] ?? 0);
        }
        $base = (float) $manual['kwh-beli'] - (float) ($manual['e-min'] ?? 0) - (float) ($manual['pssd'] ?? 0);

        return $base <= 0 ? null : ['base' => $base, 'jual' => $jual];
    }

    /**
     * Kumulatif Januari sampai bulan berjalan dari masukan bulanan pengusahaan (business_monthly_inputs, docs/91), dipakai bila masukan kumulatif NKO tidak diisi.
     * kWh beli harus ada untuk semua bulan; E-Min dan PSSD dijumlahkan dari bulan yang ada.
     *
     * @return array<string, float>
     */
    private function monthlyLossInputs(string $unitId, int $year, int $month): array
    {
        $rows = DB::table('business_monthly_inputs')->where('organizational_unit_id', $unitId)->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])
            ->whereIn('code', array_keys(self::SUSUT_INPUTS))->get(['code', 'value']);
        if ($rows->where('code', 'kwh-beli')->count() !== $month) {
            return [];
        }

        return $rows->groupBy('code')->map(fn ($g) => (float) $g->sum('value'))->all();
    }

    /**
     * Gangguan TM = jumlah kejadian penyulang (data gangguan tersinkron, permanen dan temporer) Januari sampai bulan berjalan; UP3 menjumlahkan ULP di bawahnya.
     * Belum cocok dengan angka workbook (selisih beberapa kejadian), sehingga dapat dikoreksi dengan masukan manual disertai alasan.
     *
     * @return array<string, float>
     */
    private function outageValues(string $unitId, int $year, int $month): array
    {
        $units = DB::table('organizational_units')->where('id', $unitId)->orWhere('parent_id', $unitId)->pluck('id')->all();
        $query = DB::table('outage_events')->whereIn('organizational_unit_id', $units)->whereNull('source_removed_at');
        if (! (clone $query)->whereRaw("(occurred_at at time zone 'Asia/Jakarta') >= ?", ["{$year}-01-01"])->exists()) {
            return [];
        }
        $end = date('Y-m-d', strtotime(sprintf('%04d-%02d-01 +1 month', $year, $month)));

        return ['gangguan-tm' => (float) $query->whereRaw("(occurred_at at time zone 'Asia/Jakarta') >= ?", ["{$year}-01-01"])->whereRaw("(occurred_at at time zone 'Asia/Jakarta') < ?", [$end])->count()];
    }

    /**
     * Dari penarikan APKT semua bulan Januari sampai bulan berjalan (semua bulan harus ada): response time gangguan di luar Clear Tamper = rata-rata respons varian "Tanpa Clear Temper"
     * tertimbang jumlah WO (jumlah total durasi dibagi jumlah WO); rating negatif PLN Mobile gangguan = jumlah anomali rating negatif tanpa marking (ukuran NKO). Banyak unit (UP3): response time tertimbang jumlah WO seluruh ULP, rating negatif dijumlahkan; semua bulan semua ULP harus ada.
     * Dapat dikoreksi dengan masukan manual disertai alasan.
     *
     * @return array<string, float>
     */
    private function ggnValues(array $unitIds, int $year, int $month): array
    {
        $between = ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)];
        $expected = $month * count($unitIds);
        $out = [];
        $response = DB::table('apkt_rpt_rct_records')->whereIn('organizational_unit_id', $unitIds)->where('clear_temper', false)->whereBetween('period', $between)->get(['rpt_total', 'rpt_count']);
        if ($response->count() === $expected && $response->sum('rpt_count') > 0) {
            $out['response-time-atas-gangguan-diluar-clear-tamper'] = (float) $response->sum('rpt_total') / (float) $response->sum('rpt_count');
        }
        $negative = DB::table('apkt_anomali_gangguan_records')->whereIn('organizational_unit_id', $unitIds)->where('jenis', 'NEGATIF')->whereBetween('period', $between)->get(['total_anomali_non_marking']);
        if ($negative->count() === $expected) {
            $out['feedback-rating-negatif-pada-pln-mobile-gangguan'] = (float) $negative->sum('total_anomali_non_marking');
        }

        return $out;
    }

    /**
     * SAIDI, SAIFI, dan ENS dari laporan DIFI Januari sampai bulan berjalan (semua laporan semua unit harus ada). Satu unit: jumlah bulanan. Banyak unit (UP3): tiap bulan SAIDI dan SAIFI adalah
     * rata-rata tertimbang pelanggan (jumlah jam x pelanggan dibagi jumlah pelanggan), lalu dijumlahkan; ENS dijumlahkan.
     *
     * @param  list<string>  $unitIds
     * @return array<string, float>
     */
    private function difiValues(array $unitIds, int $year, int $month): array
    {
        $files = DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->whereIn('organizational_unit_id', $unitIds)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->get(['id', 'summary', 'period', 'organizational_unit_id']);
        if ($files->count() !== $month * count($unitIds)) {
            return [];
        }
        $byMonth = [];
        $ensKwh = 0.0;
        foreach ($files as $f) {
            $summary = json_decode($f->summary ?? '{}', true) ?: [];
            $line = DB::table('eis_report_lines')->where('file_id', $f->id)->where('label', 'TOTAL KELOMPOK Distribusi')->value('values');
            if ($line === null) {
                return [];
            }
            $total = json_decode($line, true) ?: [];
            $plg = (float) ($summary['pelanggan'] ?? 0);
            // SAIDI dan SAIFI "sesuai kewenangan" = kelompok Distribusi saja; total keseluruhan laporan ikut menghitung Pembangkit dan Transmisi (Juni 2026 ULP Jombang: 183 menit lawan 1,9 menit, workbook 1,1)
            if ($plg > 0 && isset($total['jam_x_plg'], $total['jml_plg_padam'])) {
                $saidiPlg = (float) $total['jam_x_plg'] * 60;
                $saifiPlg = (float) $total['jml_plg_padam'];
            } elseif (isset($summary['saidi_menit'], $summary['saifi_kali'])) {                          // tata letak lama: ringkasan; bobot satu bila jumlah pelanggan tidak ada (satu unit: nilai ringkasan apa adanya)
                $weight = $plg > 0 ? $plg : 1.0;
                $plg = $weight;
                $saidiPlg = (float) $summary['saidi_menit'] * $weight;
                $saifiPlg = (float) $summary['saifi_kali'] * $weight;
            } else {
                return [];
            }
            $m = substr((string) $f->period, 0, 7);
            $byMonth[$m] ??= ['plg' => 0.0, 'saidi' => 0.0, 'saifi' => 0.0];
            $byMonth[$m]['plg'] += $plg;
            $byMonth[$m]['saidi'] += $saidiPlg;
            $byMonth[$m]['saifi'] += $saifiPlg;
            $ensKwh += (float) ($total['kwh_tak_tersalurkan'] ?? 0);
        }

        return ['saidi' => array_sum(array_map(fn ($x) => $x['saidi'] / $x['plg'], $byMonth)), 'saifi' => array_sum(array_map(fn ($x) => $x['saifi'] / $x['plg'], $byMonth)), 'ens' => $ensKwh / 1000];
    }

    /**
     * Pendapatan biaya penyambungan (Rp miliar, kumulatif) = total biaya permohonan PB/PD yang dibayar Januari sampai bulan berjalan, tanpa yang dibatalkan atau direstitusi (sama dengan menu HPL BP).
     * Belum cocok dengan angka workbook (selisih sekitar -8% sampai +15% per ULP, +7,8% UP3 September 2026), sehingga dapat dikoreksi dengan masukan manual disertai alasan.
     *
     * @param  list<string>  $unitIds
     * @return array<string, float>
     */
    private function connectionFeeValues(array $unitIds, int $year, int $month): array
    {
        $end = date('Y-m-d', strtotime(sprintf('%04d-%02d-01 +1 month', $year, $month)));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $unitIds)->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw("(paid_at at time zone 'Asia/Jakarta') >= ?", ["{$year}-01-01"])->whereRaw("(paid_at at time zone 'Asia/Jakarta') < ?", [$end]);
        if (! (clone $rows)->exists()) {
            return [];
        }

        return ['pendapatan-biaya-penyambungan' => (float) $rows->sum('total_cost') / 1_000_000_000];
    }
}
