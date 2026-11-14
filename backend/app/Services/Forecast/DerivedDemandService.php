<?php

namespace App\Services\Forecast;

use App\Services\Bom\BomCalculator;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Derived material need (owner Nov 2026): the forecast above is turned into the material PLN itself supplies, through the approved BOM.
 *  - Gardu: every PLN transformer whose latest load is already above the threshold (80 %) is replaced by the next capacity step above it (BOM GTT_UMUM, one "Trf. x kVA" row per unit).
 *  - Pelanggan baru: the forecast of new customers (median and range) x the SR 1 fasa BOM (power band 450-5500 VA, the common case); quantities are computed on the TOTAL, because the BOM rounds the aggregate.
 *  - Tiang: the poles are listed from the direct MIMS-issue forecast (their own series), they are not derived from customers because no ratio between customers and poles is recorded.
 * Only the materials flagged PLN in the price book valid today are counted (the contractor buys the others). A recommendation, never a procurement decision.
 */
class DerivedDemandService
{
    private const QUANTILES = ['p10', 'p50', 'p90'];

    public function __construct(private readonly BomCalculator $calculator) {}

    /**
     * @param  list<string>|null  $units  unit ids the reader may see (null = all)
     * @return array<string, mixed>
     */
    public function compute(?array $units): array
    {
        $today = now()->toDateString();
        $threshold = (float) config('distriva.derived_demand.gardu_threshold', 0.8);
        $pln = $this->plnCodes($today);

        $gardu = $this->gardu($units, $threshold, $today, $pln);
        $customers = $this->customers($units, $today, $pln);
        $poles = $this->poles($units);

        $materials = [];
        foreach ($gardu['lines'] as $code => $l) {
            $m = &$materials[$code];
            $m ??= ['code' => $code, 'name' => $l['name'], 'unit' => $l['unit'], 'gardu' => 0.0, 'customers' => ['p10' => 0.0, 'p50' => 0.0, 'p90' => 0.0]];
            $m['gardu'] += $l['qty'];
            unset($m);
        }
        foreach ($customers['lines'] as $code => $l) {
            $m = &$materials[$code];
            $m ??= ['code' => $code, 'name' => $l['name'], 'unit' => $l['unit'], 'gardu' => 0.0, 'customers' => ['p10' => 0.0, 'p50' => 0.0, 'p90' => 0.0]];
            $m['customers'] = $l['qty'];
            unset($m);
        }
        ksort($materials, SORT_NATURAL);
        $materials = array_map(fn (array $m): array => $m + ['total' => ['p10' => $m['gardu'] + $m['customers']['p10'], 'p50' => $m['gardu'] + $m['customers']['p50'], 'p90' => $m['gardu'] + $m['customers']['p90']]], array_values($materials));

        return [
            'threshold' => $threshold,
            'gardu' => ['run_id' => $gardu['run_id'], 'trigger_count' => $gardu['trigger_count'], 'without_capacity_step' => $gardu['without_capacity_step'], 'steps' => $gardu['steps'], 'without_bom' => $gardu['without_bom']],
            'customers' => ['run_id' => $customers['run_id'], 'status' => $customers['status'], 'new_customers' => $customers['new_customers'], 'basis' => $customers['basis']],
            'materials' => $materials,
            'poles' => $poles,
            'assumptions' => [
                'Hanya material berstatus PLN pada buku harga yang berlaku hari ini (material yang disediakan PLN).',
                'Gardu: trafo milik PLN yang aktif dengan beban terakhir di atas '.(int) round($threshold * 100).' % kapasitas diganti satu tingkat kapasitas di atasnya ('.implode(', ', config('distriva.derived_demand.kva_steps', [])).' kVA). Pembacaan lebih tua dari 3 tahun tidak dihitung.',
                'Pelanggan baru: prakiraan pelanggan baru (p10/p50/p90) dikali BOM SR 1 fasa rentang daya 450-5500 VA; semua dianggap pelanggan 1 fasa dengan material PLN.',
                'Tiang diambil dari prakiraan pemakaian tiang di MIMS, bukan dari pelanggan, karena belum ada rasio pelanggan terhadap tiang.',
                'Rekomendasi perencanaan, bukan keputusan pengadaan.',
            ],
        ];
    }

    /** @return array<string, true> */
    private function plnCodes(string $today): array
    {
        $codes = DB::table('price_book_items as p')->join('price_books as b', 'b.id', '=', 'p.price_book_id')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')
            ->where('b.status', 'APPROVED')->where('b.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('b.valid_until')->orWhere('b.valid_until', '>=', $today))
            ->where('p.material_status', 'PLN')->pluck('i.code')->all();

        return array_fill_keys(array_map('strval', $codes), true);
    }

    private function latestRun(string $kind): ?object
    {
        return DB::table('forecast_runs')->where('kind', $kind)->where('status', 'SUCCEEDED')->orderByDesc('started_at')->first(['id']);
    }

    /**
     * @param  list<string>|null  $units
     * @param  array<string, true>  $pln
     * @return array<string, mixed>
     */
    private function gardu(?array $units, float $threshold, string $today, array $pln): array
    {
        $out = ['run_id' => null, 'trigger_count' => 0, 'without_capacity_step' => 0, 'steps' => [], 'without_bom' => [], 'lines' => []];
        $run = $this->latestRun(ForecastService::KIND);
        if ($run === null) {
            return $out;
        }
        $out['run_id'] = $run->id;
        $steps = array_map('floatval', (array) config('distriva.derived_demand.kva_steps', []));
        sort($steps);

        $rows = DB::table('forecast_gardu_results as r')->join('substations as s', 's.id', '=', 'r.substation_id')->where('r.run_id', $run->id)
            ->where('s.ownership', 'PLN')->where('s.status', 'AKTIF')->where('r.stale', false)->where('r.last_ratio', '>', $threshold)
            ->when($units !== null, fn ($q) => $q->whereIn('r.unit_id', $units))
            ->selectRaw('r.capacity_kva::float as capacity, count(*) as n')->groupBy('r.capacity_kva')->get();

        $perTarget = [];
        foreach ($rows as $r) {
            $out['trigger_count'] += (int) $r->n;
            $to = collect($steps)->first(fn (float $s): bool => $s > (float) $r->capacity + 0.0001);
            if ($to === null) {
                $out['without_capacity_step'] += (int) $r->n;

                continue;
            }
            $perTarget[(string) $to] = ($perTarget[(string) $to] ?? 0) + (int) $r->n;
            $out['steps'][] = ['from_kva' => (float) $r->capacity, 'to_kva' => $to, 'count' => (int) $r->n];
        }
        usort($out['steps'], fn (array $a, array $b): int => [$a['from_kva'], $a['to_kva']] <=> [$b['from_kva'], $b['to_kva']]);

        $construction = $this->transformerConstructions();
        $inputs = [];
        foreach ($perTarget as $kva => $n) {
            $code = $construction[(string) (float) $kva] ?? null;
            if ($code === null) {
                $out['without_bom'][] = ['kva' => (float) $kva, 'count' => $n];
                $this->trafoOnly((float) $kva, $n, $pln, $out['lines']);

                continue;
            }
            $inputs[$code] = ['psg' => (float) $n, 'bkr' => 0.0];
        }
        if ($inputs !== []) {
            foreach ($this->bomLines('GTT_UMUM', $today, $inputs, [], $pln) as $code => $l) {
                $out['lines'][$code] = ['name' => $l['name'], 'unit' => $l['unit'], 'qty' => $l['qty'] + ($out['lines'][$code]['qty'] ?? 0.0)];
            }
        }

        return $out;
    }

    /** @return array<string, string> capacity ("160.0") => construction code of the "Trf. x kVA" row */
    private function transformerConstructions(): array
    {
        $map = [];
        $rows = DB::table('construction_types as c')->join('construction_type_versions as v', 'v.construction_type_id', '=', 'c.id')
            ->where('c.group_code', 'GTT_UMUM')->where('v.status', 'APPROVED')->get(['c.code', 'v.name']);
        foreach ($rows as $r) {
            if (preg_match('/^Trf\.\s*(\d+(?:[.,]\d+)?)\s*kVA$/i', trim($r->name), $m)) {
                $map[(string) (float) str_replace(',', '.', $m[1])] = $r->code;
            }
        }

        return $map;
    }

    /**
     * Capacity without a construction row in the BOM: only the transformer itself, found by name in the KHS.
     *
     * @param  array<string, true>  $pln
     * @param  array<string, array{name: string, unit: ?string, qty: float}>  $lines
     */
    private function trafoOnly(float $kva, int $n, array $pln, array &$lines): void
    {
        $label = rtrim(rtrim(number_format($kva, 1, '.', ''), '0'), '.');
        $row = DB::table('khs_items as i')->join('khs_item_versions as v', 'v.khs_item_id', '=', 'i.id')->where('v.status', 'APPROVED')
            ->where('v.name', 'ilike', "Trafo Distribusi%{$label} KVA")->orderByDesc('v.valid_from')->first(['i.code', 'v.name', 'v.unit_text']);
        if ($row === null || ! isset($pln[(string) $row->code])) {
            return;
        }
        $l = &$lines[(string) $row->code];
        $l ??= ['name' => $row->name, 'unit' => $row->unit_text, 'qty' => 0.0];
        $l['qty'] += $n;
    }

    /**
     * @param  array<string, array{psg: float, bkr: float}>  $inputs
     * @param  array<string, int|float|string>  $params
     * @param  array<string, true>  $pln
     * @return array<string, array{name: string, unit: ?string, qty: float}>
     */
    private function bomLines(string $group, string $today, array $inputs, array $params, array $pln): array
    {
        $header = DB::table('bom_headers')->where('group_code', $group)->where('status', 'APPROVED')->where('valid_from', '<=', $today)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->first(['id']);
        if ($header === null) {
            return [];
        }
        try {
            $res = $this->calculator->calculate($header->id, $inputs, $params);
        } catch (Throwable) {
            return [];
        }
        $names = [];
        $out = [];
        foreach ($res as $l) {
            $code = $l['khs_code'] === null ? null : (string) $l['khs_code'];
            if ($code === null || $l['aggregate'] || $l['material'] <= 0 || ! isset($pln[$code])) {
                continue;
            }
            $names[$code] ??= DB::table('khs_items as i')->join('khs_item_versions as v', 'v.khs_item_id', '=', 'i.id')->where('i.code', $code)->where('v.status', 'APPROVED')
                ->orderByDesc('v.valid_from')->first(['v.name', 'v.unit_text']);
            $o = &$out[$code];
            $o ??= ['name' => (string) ($names[$code]->name ?? $code), 'unit' => $names[$code]->unit_text ?? null, 'qty' => 0.0];
            $o['qty'] += (float) $l['material'];
            unset($o);
        }

        return $out;
    }

    /**
     * @param  list<string>|null  $units
     * @param  array<string, true>  $pln
     * @return array<string, mixed>
     */
    private function customers(?array $units, string $today, array $pln): array
    {
        $out = ['run_id' => null, 'status' => 'NO_RUN', 'new_customers' => null, 'basis' => 'SR 1 fasa, rentang daya 450-5500 VA, material PLN', 'lines' => []];
        $run = DB::table('forecast_runs')->where('kind', ForecastService::DEMAND)->orderByDesc('started_at')->first(['id', 'status']);
        if ($run === null) {
            return $out;
        }
        $out['run_id'] = $run->id;
        $out['status'] = $run->status;
        if ($run->status !== 'SUCCEEDED') {
            return $out;
        }
        $sum = DB::table('forecast_series_results')->where('run_id', $run->id)->where('kind', 'CUSTOMERS_ADDED')->when($units !== null, fn ($q) => $q->whereIn('unit_id', $units))
            ->selectRaw('coalesce(sum(t12_p10),0) as p10, coalesce(sum(t12_p50),0) as p50, coalesce(sum(t12_p90),0) as p90')->first();
        $out['new_customers'] = ['p10' => (float) $sum->p10, 'p50' => (float) $sum->p50, 'p90' => (float) $sum->p90];
        foreach (self::QUANTILES as $q) {
            $n = (int) round((float) $sum->{$q});
            if ($n <= 0) {
                continue;
            }
            $lines = $this->bomLines('SR1PH', $today, [], ['PBPD:RENTANG_1' => '450-5500 VA', 'PBPD:PSG_1' => $n, 'PBPD:PEMBAYARAN' => 'PLN'], $pln);
            foreach ($lines as $code => $l) {
                $o = &$out['lines'][$code];
                $o ??= ['name' => $l['name'], 'unit' => $l['unit'], 'qty' => ['p10' => 0.0, 'p50' => 0.0, 'p90' => 0.0]];
                $o['qty'][$q] = $l['qty'];
                unset($o);
            }
        }

        return $out;
    }

    /**
     * @param  list<string>|null  $units
     * @return list<array<string, mixed>>
     */
    private function poles(?array $units): array
    {
        $run = $this->latestRun(ForecastService::DEMAND);
        if ($run === null) {
            return [];
        }

        return DB::table('forecast_series_results as r')->join('organizational_units as o', 'o.id', '=', 'r.unit_id')->where('r.run_id', $run->id)->where('r.kind', 'MATERIAL_ISSUE')
            ->where('r.item_label', 'ilike', '%tiang%')->when($units !== null, fn ($q) => $q->whereIn('r.unit_id', $units))->orderBy('o.code')->orderByDesc('r.t12_p50')
            ->get(['o.code as unit_code', 'o.name as unit_name', 'r.item_code', 'r.item_label', 'r.last_12_months', 'r.t12_p10', 'r.t12_p50', 'r.t12_p90'])
            ->map(fn ($r): array => ['unit_code' => $r->unit_code, 'unit_name' => $r->unit_name, 'item_code' => $r->item_code, 'item_label' => $r->item_label, 'last_12_months' => (float) $r->last_12_months,
                'next_12_months' => ['p10' => (float) $r->t12_p10, 'p50' => (float) $r->t12_p50, 'p90' => (float) $r->t12_p90]])->all();
    }
}
