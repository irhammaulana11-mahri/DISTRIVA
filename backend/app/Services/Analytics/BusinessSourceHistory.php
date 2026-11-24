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
     * @return array<string, mixed>
     */
    public function history(string $code, array $ulps, string $latestMonth): array
    {
        $def = BusinessMetricService::CATALOG[$code];
        $family = $def['family'] ?? null;
        $families = $def['families'] ?? ($family === null ? [] : [$family]);
        $months = [];
        for ($i = self::COVERAGE_MONTHS - 1; $i >= 0; $i--) {
            $months[] = date('Y-m', strtotime($latestMonth.'-01 -'.$i.' month'));
        }
        $out = ['family' => $family, 'families' => $families, 'latest_month' => $latestMonth, 'months' => $months, 'files' => [], 'coverage' => null, 'inputs' => []];
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
            $out['coverage'] = $this->coverage($ulps, $months, fn (string $u) => $have[$u] ?? []);
        } elseif ($code === 'susut') {
            $have = DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', array_keys($ulps))->whereBetween('period', [$months[0].'-01', end($months).'-01'])
                ->get(['organizational_unit_id', 'period'])->groupBy('organizational_unit_id')->map(fn ($rows) => $rows->map(fn ($r) => substr((string) $r->period, 0, 7))->all());
            $out['coverage'] = $this->coverage($ulps, $months, fn (string $u) => $have[$u] ?? []);
            $out['inputs'] = DB::table('business_monthly_inputs as i')->leftJoin('users as u', 'u.id', '=', 'i.entered_by')->join('organizational_units as o', 'o.id', '=', 'i.organizational_unit_id')
                ->whereIn('i.organizational_unit_id', array_keys($ulps))->orderByDesc('i.updated_at')->limit(self::FILE_LIMIT)->get(['i.period', 'i.code', 'i.value', 'i.note', 'o.name as unit_name', 'u.name as entered_by', 'i.updated_at'])
                ->map(fn ($r) => ['period' => substr((string) $r->period, 0, 7), 'code' => $r->code, 'value' => (float) $r->value, 'note' => $r->note, 'unit_name' => $r->unit_name, 'entered_by' => $r->entered_by, 'updated_at' => $r->updated_at])->all();
        }

        return $out;
    }

    /**
     * @param  array<string, string>  $ulps
     * @param  list<string>  $months
     * @param  callable(string): list<string>  $present
     * @return array<string, mixed>
     */
    private function coverage(array $ulps, array $months, callable $present): array
    {
        $units = [];
        $missingTotal = 0;
        foreach ($ulps as $id => $name) {
            $have = $present($id);
            $missing = array_values(array_diff($months, $have));
            $missingTotal += count($missing);
            $units[] = ['unit_id' => $id, 'unit_name' => $name, 'months' => array_map(fn ($m) => in_array($m, $have, true), $months), 'missing' => $missing, 'missing_count' => count($missing)];
        }

        return ['units' => $units, 'expected_total' => count($ulps) * count($months), 'missing_total' => $missingTotal];
    }
}
