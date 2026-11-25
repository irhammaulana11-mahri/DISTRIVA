<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Histori sumber data sebuah metrik pengusahaan (docs/91): berkas laporan EIS/AP2T yang masuk, kelengkapan ULP x bulan, dan (untuk susut) perubahan masukan bulanan.
 * Sesi sinkronisasi yang terkait ditambahkan pengontrol sesuai izin pemakai.
 */
class BusinessSourceHistory
{
    private const FILE_LIMIT = 100;

    private const COVERAGE_MONTHS = 24;

    /**
     * @param  array<string, string>  $ulps  ULP => nama
     * @param  int|null  $year  tahun yang ditampilkan matriks kelengkapan (Januari sampai Desember); null = 24 bulan berakhir di $latestMonth
     * @return array<string, mixed>
     */
    public function history(string $code, array $ulps, string $latestMonth, ?int $year = null): array
    {
        $def = BusinessMetricService::CATALOG[$code];
        $family = $def['family'] ?? null;
        $families = $def['families'] ?? ($family === null ? [] : [$family]);
        $months = [];
        if ($year !== null) {
            for ($m = 1; $m <= 12; $m++) {
                $months[] = sprintf('%04d-%02d', $year, $m);
            }
        } else {
            for ($i = self::COVERAGE_MONTHS - 1; $i >= 0; $i--) {
                $months[] = date('Y-m', strtotime($latestMonth.'-01 -'.$i.' month'));
            }
        }
        // laporan sebuah bulan baru jatuh tempo bulan berikutnya: bulan berjalan dan bulan depan tidak dihitung sebagai kekurangan
        $expectedUntil = now((string) config('distriva.business_timezone', 'Asia/Jakarta'))->startOfMonth()->subMonthNoOverflow()->format('Y-m');
        $out = ['family' => $family, 'families' => $families, 'latest_month' => $latestMonth, 'year' => $year, 'expected_until' => $expectedUntil, 'available_years' => $this->years($code, $families, array_keys($ulps), $latestMonth, $expectedUntil),
            'months' => $months, 'files' => [], 'coverage' => null, 'inputs' => []];
        if ($family !== null) {
            $out['files'] = DB::table('eis_report_files as f')->leftJoin('users as u', 'u.id', '=', 'f.uploaded_by')->join('organizational_units as o', 'o.id', '=', 'f.organizational_unit_id')
                ->whereIn('f.family', $families)->whereIn('f.organizational_unit_id', array_keys($ulps))->orderByDesc('f.imported_at')->limit(self::FILE_LIMIT)
                ->get(['f.id', 'f.family', 'f.period', 'f.organizational_unit_id', 'o.name as unit_name', 'f.original_name', 'f.status', 'f.line_count', 'f.warnings', 'f.imported_at', 'u.name as uploaded_by'])
                ->map(fn ($r) => ['id' => $r->id, 'family' => $r->family, 'period' => substr((string) $r->period, 0, 7), 'unit_id' => $r->organizational_unit_id, 'unit_name' => $r->unit_name, 'original_name' => $r->original_name, 'status' => $r->status,
                    'line_count' => (int) $r->line_count, 'warnings_count' => count(json_decode((string) ($r->warnings ?? '[]'), true) ?: []), 'imported_at' => $r->imported_at, 'uploaded_by' => $r->uploaded_by])->all();
            $have = [];
            foreach ($families as $fam) {                                                                     // bulan lengkap hanya bila semua jenis laporan metrik ada
                $perUnit = DB::table('eis_report_files')->where('family', $fam)->where('status', 'AKTIF')->whereIn('organizational_unit_id', array_keys($ulps))
                    ->whereBetween('period', [$months[0].'-01', end($months).'-01'])->get(['organizational_unit_id', 'period'])
                    ->groupBy('organizational_unit_id')->map(fn ($rows) => $rows->map(fn ($r) => substr((string) $r->period, 0, 7))->all());
                foreach (array_keys($ulps) as $u) {
                    $have[$u] = isset($have[$u]) ? array_values(array_intersect($have[$u], $perUnit[$u] ?? [])) : ($perUnit[$u] ?? []);
                }
            }
            $out['coverage'] = $this->coverage($ulps, $months, fn (string $u) => $have[$u] ?? [], $expectedUntil);
        } elseif (isset(BusinessTrendBuilder::APKT_TABLES[$code])) {
            $out = $this->apktHistory($code, $out, $ulps, $months, $expectedUntil);
        } elseif ($code === 'susut') {
            $have = DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', array_keys($ulps))->whereBetween('period', [$months[0].'-01', end($months).'-01'])
                ->get(['organizational_unit_id', 'period'])->groupBy('organizational_unit_id')->map(fn ($rows) => $rows->map(fn ($r) => substr((string) $r->period, 0, 7))->all());
            $out['coverage'] = $this->coverage($ulps, $months, fn (string $u) => $have[$u] ?? [], $expectedUntil);
            $out['inputs'] = DB::table('business_monthly_inputs as i')->leftJoin('users as u', 'u.id', '=', 'i.entered_by')->join('organizational_units as o', 'o.id', '=', 'i.organizational_unit_id')
                ->whereIn('i.organizational_unit_id', array_keys($ulps))->orderByDesc('i.updated_at')->limit(self::FILE_LIMIT)->get(['i.period', 'i.code', 'i.value', 'i.note', 'o.name as unit_name', 'u.name as entered_by', 'i.updated_at'])
                ->map(fn ($r) => ['period' => substr((string) $r->period, 0, 7), 'code' => $r->code, 'value' => (float) $r->value, 'note' => $r->note, 'unit_name' => $r->unit_name, 'entered_by' => $r->entered_by, 'updated_at' => $r->updated_at])->all();
        }

        return $out;
    }

    /**
     * RPT/RCT gangguan bersumber penarikan APKT (apkt_rpt_rct_records), bukan berkas laporan: satu baris `files` per ULP dan bulan (`family` APKT_RPT_RCT, `line_count` = jumlah varian clear temper tersimpan),
     * dan kelengkapan dari bulan yang tersimpan.
     *
     * @param  array<string, mixed>  $out
     * @param  array<string, string>  $ulps
     * @param  list<string>  $months
     * @return array<string, mixed>
     */
    private function apktHistory(string $code, array $out, array $ulps, array $months, string $expectedUntil): array
    {
        $table = BusinessTrendBuilder::APKT_TABLES[$code];
        $rows = DB::table($table.' as r')->join('organizational_units as o', 'o.id', '=', 'r.organizational_unit_id')->leftJoin('eis_sync_runs as s', 's.id', '=', 'r.sync_run_id')->leftJoin('users as u', 'u.id', '=', 's.started_by')
            ->whereIn('r.organizational_unit_id', array_keys($ulps))->groupBy('r.organizational_unit_id', 'r.period', 'o.name')->orderByDesc(DB::raw('max(r.updated_at)'))->limit(self::FILE_LIMIT)
            ->get(['r.organizational_unit_id', 'r.period', 'o.name as unit_name', DB::raw('count(*) as variants'), DB::raw('max(r.updated_at) as imported_at'), DB::raw('max(u.name) as uploaded_by')]);
        $out['files'] = $rows->map(fn ($r) => ['id' => $r->organizational_unit_id.'|'.substr((string) $r->period, 0, 7), 'family' => 'APKT_RPT_RCT', 'period' => substr((string) $r->period, 0, 7), 'unit_id' => $r->organizational_unit_id, 'unit_name' => $r->unit_name,
            'original_name' => $code === 'rpt-rct-keluhan' ? 'APKT – Jumlah dan Durasi RPT RCT Keluhan' : 'APKT – Jumlah dan Durasi RPT RCT Gangguan (Semua Laporan dan Tanpa Clear Temper)', 'status' => 'AKTIF', 'line_count' => (int) $r->variants, 'warnings_count' => 0, 'imported_at' => $r->imported_at, 'uploaded_by' => $r->uploaded_by])->all();
        $have = [];
        foreach (DB::table($table)->whereIn('organizational_unit_id', array_keys($ulps))->whereBetween('period', [$months[0].'-01', end($months).'-01'])->distinct()->get(['organizational_unit_id', 'period']) as $r) {
            $have[$r->organizational_unit_id][] = substr((string) $r->period, 0, 7);
        }
        $out['family'] = 'APKT_RPT_RCT';
        $out['families'] = ['APKT_RPT_RCT'];
        $out['coverage'] = $this->coverage($ulps, $months, fn (string $u) => $have[$u] ?? [], $expectedUntil);

        return $out;
    }

    /**
     * Matriks ULP x bulan. `due[]` (sejajar `months`) menandai bulan yang sudah jatuh tempo; hanya bulan itu yang dihitung sebagai kekurangan (`missing`, `missing_count`, `expected_total`, `missing_total`).
     * Sel bulan yang belum jatuh tempo tetap `true` bila laporannya sudah ada, dan `false` tanpa dihitung kurang bila belum.
     *
     * @param  array<string, string>  $ulps
     * @param  list<string>  $months
     * @param  callable(string): list<string>  $present
     * @return array<string, mixed>
     */
    private function coverage(array $ulps, array $months, callable $present, string $expectedUntil): array
    {
        $due = array_map(fn ($m) => $m <= $expectedUntil, $months);
        $dueMonths = array_values(array_filter($months, fn ($m) => $m <= $expectedUntil));
        $units = [];
        $missingTotal = 0;
        foreach ($ulps as $id => $name) {
            $have = $present($id);
            $missing = array_values(array_diff($dueMonths, $have));
            $missingTotal += count($missing);
            $units[] = ['unit_id' => $id, 'unit_name' => $name, 'months' => array_map(fn ($m) => in_array($m, $have, true), $months), 'missing' => $missing, 'missing_count' => count($missing)];
        }

        return ['due' => $due, 'units' => $units, 'expected_total' => count($ulps) * count($dueMonths), 'missing_total' => $missingTotal];
    }

    /**
     * Tahun yang dapat dipilih pada matriks: dari tahun laporan tertua yang ada untuk unit-unit itu sampai tahun bulan terakhir yang sudah jatuh tempo.
     *
     * @param  list<string>  $families
     * @param  list<string>  $units
     * @return list<int> terbaru lebih dulu
     */
    private function years(string $code, array $families, array $units, string $latestMonth, string $expectedUntil): array
    {
        $first = match (true) {
            $families !== [] => DB::table('eis_report_files')->whereIn('family', $families)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)->min('period'),
            $code === 'susut' => DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', $units)->min('period'),
            default => null,
        };
        isset(BusinessTrendBuilder::APKT_TABLES[$code]) && $first = min(array_filter([$first, DB::table(BusinessTrendBuilder::APKT_TABLES[$code])->whereIn('organizational_unit_id', $units)->min('period')]) ?: [null]);
        $to = (int) substr(max($latestMonth, $expectedUntil), 0, 4);
        $from = $first === null ? (int) substr($latestMonth, 0, 4) : min((int) substr((string) $first, 0, 4), $to);

        return range($to, $from);
    }
}
