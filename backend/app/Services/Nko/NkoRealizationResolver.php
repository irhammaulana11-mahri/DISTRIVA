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
        'susut-distribusi-tanpa-e-min' => 'susut_hitung', 'penjualan-tenaga-listrik' => 'penjualan_selisih',
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
    public const UNVALIDATED_CODES = [self::PELUNASAN_CODE, 'penjualan-tenaga-listrik', 'gangguan-tm', 'susut-distribusi-tanpa-e-min', 'response-time-atas-gangguan-diluar-clear-tamper', 'feedback-rating-negatif-pada-pln-mobile-gangguan'];

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
        return $this->difiValues($unitId, $year, $month) + $this->report309Values($unitId, $year, $month) + $this->outageValues($unitId, $year, $month) + $this->ggnValues($unitId, $year, $month) + $this->susutValues($unitId, $year, $month) + $this->penjualanValues($unitId, $year, $month) + $this->pelunasanValues($unitId, $year, $month);
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
     * Pelunasan (Rp juta, kumulatif) = komponen piutang prabayar dari laporan PIUTANGLPB_EIS + PRR + Ex-PRR (dua terakhir masukan manual pembantu, dianggap 0 bila kosong).
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
            ->whereIn('definition_code', array_keys(self::PELUNASAN_INPUTS))->pluck('value')->sum();

        return [self::PELUNASAN_CODE => $total / 1000000 + (float) $manual];
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
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))
            ->whereIn('definition_code', array_keys(self::SUSUT_INPUTS))->pluck('value', 'definition_code');
        if (! isset($manual['kwh-beli'])) {
            $manual = $this->monthlyLossInputs($unitId, $year, $month);
        }
        if (! isset($manual['kwh-beli']) || (float) $manual['kwh-beli'] <= 0) {
            return [];
        }
        $files = DB::table('eis_report_files')->where('family', '309')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->pluck('id');
        if ($files->count() !== $month) {
            return [];
        }
        $jual = 0.0;
        foreach ($files as $id) {
            $line = DB::table('eis_report_lines')->where('file_id', $id)->where('label', 'JUMLAH')->orderByDesc('line_no')->value('values');
            if ($line === null) {
                return [];
            }
            $jual += (float) (json_decode($line, true)['kwh_jumlah'] ?? 0);
        }
        $base = (float) $manual['kwh-beli'] - (float) ($manual['e-min'] ?? 0) - (float) ($manual['pssd'] ?? 0);

        return $base <= 0 ? [] : [self::SUSUT_CODE => ($base - $jual) / $base * 100];
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
     * Dari laporan gangguan (GGNALL, GGNNEGATIF) semua bulan Januari sampai bulan berjalan: response time = rata-rata respons tertimbang jumlah gangguan; rating negatif = jumlah kolom total negatif.
     * Belum cocok dengan workbook (Clear Tamper tidak dipisah pada laporan), sehingga dapat dikoreksi dengan masukan manual disertai alasan.
     *
     * @return array<string, float>
     */
    private function ggnValues(string $unitId, int $year, int $month): array
    {
        $lines = function (string $family) use ($unitId, $year, $month): ?array {
            $files = DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
                ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->pluck('id');
            if ($files->count() !== $month) {
                return null;
            }

            return DB::table('eis_report_lines')->whereIn('file_id', $files)->pluck('values')->map(fn ($v) => json_decode($v, true) ?: [])->all();
        };
        $out = [];
        $all = $lines('GGNALL');
        if ($all !== null) {
            $weight = array_sum(array_map(fn ($v) => (float) ($v['total'] ?? 0), $all));
            if ($weight > 0) {
                $out['response-time-atas-gangguan-diluar-clear-tamper'] = array_sum(array_map(fn ($v) => (float) ($v['response_rata_menit'] ?? 0) * (float) ($v['total'] ?? 0), $all)) / $weight;
            }
        }
        $neg = $lines('GGNNEGATIF');
        if ($neg !== null) {
            $out['feedback-rating-negatif-pada-pln-mobile-gangguan'] = array_sum(array_map(fn ($v) => (float) ($v['c_L'] ?? 0), $neg));
        }

        return $out;
    }

    /**
     * @return array<string, float>
     */
    private function difiValues(string $unitId, int $year, int $month): array
    {
        $files = DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->get(['id', 'summary']);
        if ($files->count() !== $month) {
            return [];
        }
        $saidi = 0.0;
        $saifi = 0.0;
        $ensKwh = 0.0;
        foreach ($files as $f) {
            $summary = json_decode($f->summary ?? '{}', true) ?: [];
            if (! isset($summary['saidi_menit'], $summary['saifi_kali'])) {
                return [];
            }
            $saidi += (float) $summary['saidi_menit'];
            $saifi += (float) $summary['saifi_kali'];
            $line = DB::table('eis_report_lines')->where('file_id', $f->id)->where('label', 'TOTAL KELOMPOK Distribusi')->value('values');
            if ($line === null) {
                return [];
            }
            $ensKwh += (float) (json_decode($line, true)['kwh_tak_tersalurkan'] ?? 0);
        }

        return ['saidi' => $saidi, 'saifi' => $saifi, 'ens' => $ensKwh / 1000];
    }
}
