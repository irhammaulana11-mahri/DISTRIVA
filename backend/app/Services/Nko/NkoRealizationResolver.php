<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Menentukan realisasi kumulatif (Januari sampai bulan berjalan) tiap indikator untuk satu unit: masukan manual bila ada, selain itu dari sumber sistem.
 * Sumber sistem saat ini: penambahan pelanggan dan daya tersambung dari laporan 309 (selisih terhadap Desember tahun lalu); SAIDI, SAIFI, dan ENS dari laporan DIFI yang diunggah (jumlah bulanan Januari sampai bulan berjalan; ENS dari baris "TOTAL KELOMPOK Distribusi", kWh menjadi MWh).
 * Rumus tiap indikator ada di tabel `kpi_realization_rules` (docs/93); kelas ini menghitung besaran katalog dan mengevaluasi rumus itu.
 * Sumber sistem hanya dipakai bila laporan DIFI semua bulan Januari sampai bulan berjalan tersedia; bila tidak, indikator dibiarkan kosong sampai laporan atau masukan manual ada (docs/90).
 */
class NkoRealizationResolver
{
    /** kode indikator pelunasan: dipakai menu pengusahaan untuk menautkan target (BusinessTargetService) */
    public const PELUNASAN_CODE = 'pencapaian-pelunasan-prr-ex-prr-dan-piutang-prabayar';

    /** kode indikator pada baseline adjustment hasil impor (`kpi_baselines`, NkoBaselineImportService) */
    private const BASELINE_CODE = 'penjualan-tenaga-listrik';

    public function __construct(private readonly NkoRealizationRules $rules) {}

    /**
     * @return array<string, array{value: float, source: string, manual: ?float, system: ?float, note: ?string, flag: ?string}> menurut kode indikator
     */
    public function resolve(string $unitId, int $year, int $month): array
    {
        $rules = $this->rules->forPeriod($year, $month);
        $out = [];
        $system = $this->systemValues($unitId, $year, $month);
        foreach ($system as $code => $v) {
            $out[$code] = ['value' => $v, 'source' => 'SISTEM', 'manual' => null, 'system' => $v, 'note' => null, 'flag' => $this->flagFor($rules[$code] ?? null, $v)];
        }
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))->get(['definition_code', 'value', 'note']);
        foreach ($manual as $m) {
            if (($rules[$m->definition_code]->mode ?? null) === 'SISTEM') {      // mode SISTEM: masukan manual lama diabaikan
                continue;
            }
            $out[$m->definition_code] = ['value' => (float) $m->value, 'source' => 'MANUAL', 'manual' => (float) $m->value, 'system' => $out[$m->definition_code]['system'] ?? null, 'note' => $m->note, 'flag' => $this->flagFor($rules[$m->definition_code] ?? null, (float) $m->value)];
        }

        return $out;
    }

    /** nilai minus pada indikator bertanda (mis. penjualan TL di bawah baseline adjustment) hanya ditandai, nilainya tidak diubah */
    private function flagFor(?object $rule, float $value): ?string
    {
        return $rule?->flag_when_negative && $value < 0 ? 'NEGATIF' : null;
    }

    /**
     * Nilai sistem menurut kode indikator: rumus aturan yang berlaku pada periode itu dihitung atas besaran katalog. Indikator yang datanya belum lengkap tidak muncul.
     *
     * @return array<string, float>
     */
    public function systemValues(string $unitId, int $year, int $month): array
    {
        $memo = [];
        $out = [];
        foreach ($this->rules->forPeriod($year, $month) as $code => $rule) {
            $value = $rule->mode === 'MANUAL' ? null : $this->evaluate($rule, $unitId, $year, $month, $memo);
            $value !== null && $out[$code] = $value;
        }

        return $out;
    }

    /**
     * Nilai satu rumus pada satu unit dan bulan; `$memo` boleh dipakai bersama hanya untuk unit dan bulan yang sama.
     *
     * @param  object{formula: string, inputs: array<string, mixed>}  $rule
     * @param  array<string, array<string, float>>  $memo
     */
    public function evaluate(object $rule, string $unitId, int $year, int $month, array &$memo = []): ?float
    {
        $children = $this->childUlps($unitId);

        return NkoFormula::parse($rule->formula)->evaluate(function (string $name) use ($rule, $unitId, $children, $year, $month, &$memo): ?float {
            if (isset($rule->inputs[$name])) {
                return $this->declaredInput($name, $children ?: [$unitId], $year, $month);
            }

            return $this->quantity($name, $unitId, $children, $year, $month, $memo);
        });
    }

    /**
     * Satu besaran katalog; hasil tiap kelompok perhitungan disimpan di `$memo` agar hanya dihitung sekali dan hanya bila dipakai rumus.
     *
     * @param  list<string>  $children
     * @param  array<string, array<string, float>>  $memo
     */
    private function quantity(string $name, string $unitId, array $children, int $year, int $month, array &$memo): ?float
    {
        [$group, $aggregate] = NkoSourceCatalog::QUANTITIES[$name] ?? throw new InvalidArgumentException("Besaran NKO tidak dikenal pada rumus: {$name}");
        if ($children !== [] && $aggregate === 'JUMLAH') {       // satu ULP kosong membuat UP3 kosong, bukan jumlah sebagian (angka UP3 yang tampak lengkap padahal kurang satu ULP lebih menyesatkan)
            $values = array_map(function (string $child) use ($name, $year, $month, &$memo) {
                return $this->quantity($name, $child, [], $year, $month, $memo);
            }, $children);

            return in_array(null, $values, true) ? null : (float) array_sum($values);
        }
        $memo["{$group}|{$unitId}"] ??= $this->group($group, $unitId, $children, $year, $month);

        return $memo["{$group}|{$unitId}"][$name] ?? null;
    }

    /**
     * @param  list<string>  $children
     * @return array<string, float> menurut nama besaran
     */
    private function group(string $group, string $unitId, array $children, int $year, int $month): array
    {
        $units = $children ?: [$unitId];

        return match ($group) {
            'difi' => $this->difiValues($units, $year, $month),
            'outage' => $this->outageValues($unitId, $year, $month),
            'ggn' => $this->ggnValues($units, $year, $month),
            'bp' => $this->connectionFeeValues($units, $year, $month),
            '309' => $this->report309Values($unitId, $year, $month),
            'jual' => array_filter(['kwh_jual' => $this->kwhJual($unitId, $year, $month), 'kwh_jual_tahun_lalu' => $this->kwhJual($unitId, $year - 1, $month)], fn ($v) => $v !== null),
            'ba' => $this->baselineValues($unitId, $year, $month),
            'masukan_susut' => $this->lossInputValues($unitId, $year, $month),
            'susut' => $this->susutValues($units, $year, $month),
            'penjualan' => $this->penjualanValues($unitId, $year, $month),
            'pelunasan' => $this->pelunasanValues($unitId, $year, $month),
        };
    }

    /**
     * Masukan yang dideklarasikan aturan (kumulatif, manual); tingkat UP3 = jumlah semua ULP.
     *
     * @param  list<string>  $unitIds
     */
    private function declaredInput(string $code, array $unitIds, int $year, int $month): ?float
    {
        $values = DB::table('kpi_manual_inputs')->where('definition_code', $code)->whereIn('organizational_unit_id', $unitIds)->where('period', sprintf('%04d-%02d-01', $year, $month))->pluck('value');

        return $values->count() === count($unitIds) ? (float) $values->sum() : null;
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
        $out = [];
        foreach (['akhir' => $now, 'awal' => $base] as $suffix => $position) {
            isset($position['pelanggan']) && $out["pelanggan_309_{$suffix}"] = (float) $position['pelanggan'];
            isset($position['daya_va']) && $out["daya_va_309_{$suffix}"] = (float) $position['daya_va'];
        }
        if ($now === null || $base === null || ! isset($now['pelanggan'], $now['daya_va'], $base['pelanggan'], $base['daya_va'])) {
            return $out;
        }

        return $out + [
            'pelanggan_309' => (float) $now['pelanggan'] - (float) $base['pelanggan'],
            'daya_309' => ((float) $now['daya_va'] - (float) $base['daya_va']) / 1000000,
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
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))
            ->whereIn('definition_code', ['prr-lunas', 'ex-prr-lunas'])->pluck('value', 'definition_code');
        $out = [];
        foreach (['lunas_prr' => ['prr-lunas', 'PRR'], 'lunas_ex_prr' => ['ex-prr-lunas', 'EXPRR']] as $name => [$code, $family]) {   // masukan manual (kumulatif) diutamakan; selain itu pelunasan AP2T Januari sampai bulan berjalan
            $value = isset($manual[$code]) ? (float) $manual[$code] : $this->raguRepayment($unitId, $family, $year, $month);
            $value !== null && $out[$name] = $value;
        }
        $prev = $balances(($year - 1).'-12-01');
        if ($prev === null) {
            return $out;
        }
        $total = 0.0;
        for ($m = 1; $m <= $month; $m++) {
            $cur = $balances(sprintf('%04d-%02d-01', $year, $m));
            if ($cur === null) {
                return $out;
            }
            $total += max(0.0, array_sum($prev) - ($cur['BERJALAN'] + $cur['TUNGGAKAN']));
            $prev = $cur;
        }

        return $out + ['lunas_prabayar' => $total / 1000000, 'pelunasan_prabayar' => $total / 1000000 + (($out['lunas_prr'] ?? 0.0) + ($out['lunas_ex_prr'] ?? 0.0))];
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
     * Penambahan penjualan TL (GWh) = jumlah (kWh jual bulan itu dikurangi baseline adjustment bulan itu) Januari sampai bulan berjalan, rumus workbook TRP: kWh jual dari baris "JUMLAH" laporan 309 dan
     * BA bulanan = target kWh jual bulanan dikurangi target delta bulanan (`kpi_baselines`, diimpor dari workbook TRP). Semua bulan 309 dan semua BA Januari sampai bulan berjalan harus ada, selain itu kosong.
     * Dicocokkan dengan workbook REALISASI Januari sampai September 2026 untuk 10 ULP (selisih paling banyak 1 kWh karena pembulatan).
     *
     * @return array<string, float>
     */
    private function penjualanValues(string $unitId, int $year, int $month): array
    {
        $baselines = DB::table('kpi_baselines')->where('definition_code', self::BASELINE_CODE)->where('organizational_unit_id', $unitId)->where('year', $year)->where('month', '<=', $month)->pluck('value', 'month');
        $files = DB::table('eis_report_files')->where('family', '309')->where('status', 'AKTIF')->where('organizational_unit_id', $unitId)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->get(['id', 'period']);
        if ($baselines->count() !== $month || $files->count() !== $month) {
            return [];
        }
        $sum = 0.0;
        foreach ($files as $f) {
            $line = DB::table('eis_report_lines')->where('file_id', $f->id)->where('label', 'JUMLAH')->orderByDesc('line_no')->value('values');
            if ($line === null) {
                return [];
            }
            $sum += (float) (json_decode($line, true)['kwh_jumlah'] ?? 0) - (float) $baselines[(int) substr((string) $f->period, 5, 2)];
        }

        return ['penjualan_selisih' => $sum / 1000000];
    }

    /**
     * Susut distribusi tanpa E-Min (%, kumulatif) = (kWh beli - E-Min - PSSD - kWh jual) / (kWh beli - E-Min - PSSD) x 100; banyak unit (UP3) = rasio dari jumlah, semua unit harus lengkap.
     * kWh beli, E-Min, dan PSSD (kumulatif Januari sampai bulan berjalan) diisi manual; kWh jual = jumlah baris "JUMLAH" laporan 309 Januari sampai bulan berjalan (semua bulan harus ada).
     * Bila masukan kumulatif NKO tidak diisi, dipakai jumlah masukan bulanan pengusahaan (kWh beli semua bulan harus ada).
     * Rumus berdasarkan penjelasan pemilik; belum divalidasi terhadap angka workbook karena belum ada data kWh beli.
     *
     * @param  list<string>  $unitIds
     * @return array<string, float>
     */
    private function susutValues(array $unitIds, int $year, int $month): array
    {
        $parts = array_map(fn (string $unitId) => $this->lossParts($unitId, $year, $month), $unitIds);
        if (in_array(null, $parts, true)) {
            return [];
        }
        $base = array_sum(array_column($parts, 'base'));

        return $base > 0 ? ['susut_hitung' => ($base - array_sum(array_column($parts, 'jual'))) / $base * 100] : [];
    }

    /**
     * kWh beli bersih (setelah E-Min dan PSSD) dan kWh jual kumulatif satu unit, atau null bila datanya belum lengkap.
     *
     * @return array{base: float, jual: float}|null
     */
    private function lossParts(string $unitId, int $year, int $month): ?array
    {
        $input = $this->lossInputValues($unitId, $year, $month);
        if (($input['kwh_beli'] ?? 0.0) <= 0) {
            return null;
        }
        $jual = $this->kwhJual($unitId, $year, $month);
        $base = $input['kwh_beli'] - $input['e_min'] - $input['pssd'];

        return $jual === null || $base <= 0 ? null : ['base' => $base, 'jual' => $jual];
    }

    /**
     * Masukan susut kumulatif; kosong bila kWh beli belum ada (E-Min dan PSSD yang tidak diisi dianggap 0).
     *
     * @return array<string, float>
     */
    private function lossInputValues(string $unitId, int $year, int $month): array
    {
        $manual = DB::table('kpi_manual_inputs')->where('organizational_unit_id', $unitId)->where('period', sprintf('%04d-%02d-01', $year, $month))
            ->whereIn('definition_code', ['kwh-beli', 'e-min', 'pssd'])->pluck('value', 'definition_code');
        if (! isset($manual['kwh-beli'])) {
            $manual = $this->monthlyLossInputs($unitId, $year, $month);
        }

        return isset($manual['kwh-beli']) ? ['kwh_beli' => (float) $manual['kwh-beli'], 'e_min' => (float) ($manual['e-min'] ?? 0), 'pssd' => (float) ($manual['pssd'] ?? 0)] : [];
    }

    /** kWh jual (baris "JUMLAH" laporan 309) Januari sampai bulan berjalan; null bila ada bulan yang belum masuk */
    private function kwhJual(string $unitId, int $year, int $month): ?float
    {
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

        return $jual;
    }

    /**
     * Baseline adjustment penjualan TL kumulatif; kosong bila ada bulan yang belum diimpor.
     *
     * @return array<string, float>
     */
    private function baselineValues(string $unitId, int $year, int $month): array
    {
        $baselines = DB::table('kpi_baselines')->where('definition_code', self::BASELINE_CODE)->where('organizational_unit_id', $unitId)->where('year', $year)->where('month', '<=', $month)->pluck('value');

        return $baselines->count() === $month ? ['ba_penjualan' => (float) $baselines->sum(fn ($v) => (float) $v)] : [];
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
            ->whereIn('code', ['kwh-beli', 'e-min', 'pssd'])->get(['code', 'value']);
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

        return ['gangguan_penyulang' => (float) $query->whereRaw("(occurred_at at time zone 'Asia/Jakarta') >= ?", ["{$year}-01-01"])->whereRaw("(occurred_at at time zone 'Asia/Jakarta') < ?", [$end])->count()];
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
        if ($response->count() === $expected) {
            $out['response_total_durasi'] = (float) $response->sum('rpt_total');
            $out['response_jumlah_wo'] = (float) $response->sum('rpt_count');
        }
        if ($response->count() === $expected && $response->sum('rpt_count') > 0) {
            $out['response_ggnall'] = (float) $response->sum('rpt_total') / (float) $response->sum('rpt_count');
        }
        $negative = DB::table('apkt_anomali_gangguan_records')->whereIn('organizational_unit_id', $unitIds)->where('jenis', 'NEGATIF')->whereBetween('period', $between)->get(['total_anomali_non_marking']);
        if ($negative->count() === $expected) {
            $out['rating_negatif_ggn'] = (float) $negative->sum('total_anomali_non_marking');
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

        return ['saidi_menit' => array_sum(array_map(fn ($x) => $x['saidi'] / $x['plg'], $byMonth)), 'saifi_kali' => array_sum(array_map(fn ($x) => $x['saifi'] / $x['plg'], $byMonth)), 'ens_mwh' => $ensKwh / 1000];
    }

    /**
     * Pendapatan biaya penyambungan (Rp miliar, kumulatif) dengan dasar kas (keputusan pemilik 26 Nov 2026): jumlah penerimaan dikurangi restitusi (RPBP) Januari sampai bulan berjalan dari rekap laporan BP AP2T
     * (`BP_REKAP`, sinkron `bp`), semua bulan semua ULP pada cakupan harus ada. Rekap BP tidak memuat UJL. Bila belum ditarik, dipakai perkiraan lama: total biaya permohonan PB/PD yang dibayar (sama dengan menu HPL BP),
     * yang memuat UJL dan lebih besar sekitar 8% dari workbook. Belum cocok persis dengan angka workbook (Januari sampai September 2026: UP3 160,7 miliar lawan 167,2, per ULP -1,5% sampai -14,9%),
     * sehingga dapat dikoreksi dengan masukan manual disertai alasan.
     *
     * @param  list<string>  $unitIds
     * @return array<string, float>
     */
    private function connectionFeeValues(array $unitIds, int $year, int $month): array
    {
        $files = DB::table('eis_report_files')->where('family', 'BP_REKAP')->where('status', 'AKTIF')->whereIn('organizational_unit_id', $unitIds)
            ->whereBetween('period', ["{$year}-01-01", sprintf('%04d-%02d-01', $year, $month)])->get(['organizational_unit_id', 'period', 'summary']);
        $out = [];
        if ($files->count() === count($unitIds) * $month && $files->unique(fn ($f) => $f->organizational_unit_id.'|'.$f->period)->count() === $files->count()) {
            $out['bp_kas_rp'] = (float) $files->sum(fn ($f) => (float) (json_decode((string) $f->summary, true)['kas_rp'] ?? 0));
        }
        $end = date('Y-m-d', strtotime(sprintf('%04d-%02d-01 +1 month', $year, $month)));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $unitIds)->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw("(paid_at at time zone 'Asia/Jakarta') >= ?", ["{$year}-01-01"])->whereRaw("(paid_at at time zone 'Asia/Jakarta') < ?", [$end]);
        if ((clone $rows)->exists()) {
            $out['bp_total_biaya_rp'] = (float) $rows->sum('total_cost');
        }
        $rupiah = $out['bp_kas_rp'] ?? $out['bp_total_biaya_rp'] ?? null;

        return $rupiah === null ? $out : $out + ['hpl_bp' => $rupiah / 1_000_000_000];
    }
}
