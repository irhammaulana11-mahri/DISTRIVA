<?php

namespace App\Services\Substations;

use App\Services\Kko\KkoService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Analysis of one gardu (owner 2026-11-11): measurement history, balance between phases and between jurusan, base voltage (tegangan pangkal) and end voltage,
 * and a load forecast from the latest measurement plus the customers added every month.
 * - Imbalance % = mean absolute deviation from the mean / the mean (R,S,T; or the totals of the jurusan). Needs all three phases / at least two jurusan.
 * - Base voltage below distriva.substation_base_voltage_min_v (231 V) in any phase is flagged. The end voltage is flagged below the KKO limit (198 V = 220 V - 10 %) or when the drop from the lowest
 *   nominal voltage (distriva.substation_nominal_voltage_v = 220 V) is more than distriva.substation_drop_max_pct (10 %) below the nominal (owner 2026-11-16).
 * - Forecast: the latest reading with a kVA load, + customers connected since the measurement month, + the pipeline (applications of this gardu not yet connected, not cancelled, KKO not TIDAK_LAYAK,
 *   not a dedicated transformer) in the first month, + the average monthly additions of the last 12 months from the second month on. Each addition counts its power change x the KKO load factor.
 */
class SubstationAnalysisService
{
    public function __construct(private readonly SubstationService $substations) {}

    /** Flags that need only the reading itself (the jurusan are not loaded for the list). @param object $r a substation_readings row @return list<string> */
    public static function quickFlags(object $r): array
    {
        $f = fn ($v) => $v === null ? null : (float) $v;
        $bases = array_values(array_filter([$f($r->base_voltage_r_v ?? null), $f($r->base_voltage_s_v ?? null), $f($r->base_voltage_t_v ?? null)], fn ($x) => $x !== null));
        $end = $f($r->end_voltage_v);
        $imb = self::imbalance(['r' => $f($r->current_r_a), 's' => $f($r->current_s_a), 't' => $f($r->current_t_a)], 3);
        $nominal = (float) config('distriva.substation_nominal_voltage_v');
        $drop = $end !== null && $nominal > 0 ? ($nominal - $end) / $nominal * 100 : null;
        $out = [];
        $bases !== [] && min($bases) < (float) config('distriva.substation_base_voltage_min_v') && $out[] = 'BASE_LOW';
        $imb !== null && $imb > (float) config('distriva.substation_imbalance_max_pct') && $out[] = 'PHASE_UNBALANCED';
        $end !== null && $end < KkoService::MIN_VOLTAGE && $out[] = 'END_LOW';
        $drop !== null && $drop > (float) config('distriva.substation_drop_max_pct') && $out[] = 'END_DROP';

        return $out;
    }

    /** @param array<string,float|null> $values @return ?float percent, null when fewer than $min values are measured */
    public static function imbalance(array $values, int $min): ?float
    {
        $v = array_values(array_filter($values, fn ($x) => $x !== null && $x > 0));
        if (count($v) < $min || $v === []) {
            return null;
        }
        $avg = array_sum($v) / count($v);

        return round(array_sum(array_map(fn ($x) => abs($x - $avg), $v)) / count($v) / $avg * 100, 2);
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function analyze(string $id, array $scope, int $horizon = 12, ?float $growthOverride = null): array
    {
        $s = $this->substations->find($id, $scope);
        $rows = DB::table('substation_readings')->where('substation_id', $id)->orderByDesc('measured_on')->orderByRaw('measured_at desc nulls last')->orderByDesc('created_at')->limit(24)->get()->reverse()->values();
        $feeders = $rows->isEmpty() ? collect() : DB::table('substation_reading_feeders')->whereIn('reading_id', $rows->pluck('id'))->orderBy('label')->get()->groupBy('reading_id');
        $history = $rows->map(fn ($r) => $this->readingView($r, $feeders[$r->id] ?? collect()))->all();
        foreach ($history as $i => $h) {                  // transformer management (owner 2026-11-17): the capacity of the gardu differs between readings
            $prev = $i > 0 ? $history[$i - 1]['capacity_kva'] : null;
            $history[$i]['capacity_change'] = $prev !== null && $h['capacity_kva'] !== null && abs($prev - $h['capacity_kva']) > 0.001 ? ['from' => $prev, 'to' => $h['capacity_kva']] : null;
        }

        return ['substation' => ['id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'capacity_kva' => $s->capacity_kva === null ? null : (float) $s->capacity_kva],
            'limits' => ['base_voltage_min_v' => (float) config('distriva.substation_base_voltage_min_v'), 'end_voltage_min_v' => KkoService::MIN_VOLTAGE, 'imbalance_max_pct' => (float) config('distriva.substation_imbalance_max_pct'),
                'feeder_imbalance_max_pct' => (float) config('distriva.substation_feeder_imbalance_max_pct'), 'drop_max_pct' => (float) config('distriva.substation_drop_max_pct')],
            'history' => $history, 'latest' => $history === [] ? null : $history[count($history) - 1], 'forecast' => $this->forecast($s, $rows, $horizon, $growthOverride)];
    }

    /** @param Collection<int,object> $feeders @return array<string,mixed> */
    private function readingView(object $r, $feeders): array
    {
        $f = fn ($v) => $v === null ? null : (float) $v;
        $phases = ['r' => $f($r->current_r_a), 's' => $f($r->current_s_a), 't' => $f($r->current_t_a)];
        $avg = count(array_filter($phases, fn ($x) => $x !== null)) === 3 ? array_sum($phases) / 3 : null;
        $bases = array_values(array_filter([$f($r->base_voltage_r_v), $f($r->base_voltage_s_v), $f($r->base_voltage_t_v)], fn ($x) => $x !== null));
        $baseMin = $bases === [] ? null : min($bases);
        $feederRows = $feeders->map(fn ($x) => ['label' => $x->label, 'current_r_a' => $f($x->current_r_a), 'current_s_a' => $f($x->current_s_a), 'current_t_a' => $f($x->current_t_a), 'current_n_a' => $f($x->current_n_a),
            'end_voltage_v' => $f($x->end_voltage_v), 'total_a' => round(array_sum(array_filter([$f($x->current_r_a), $f($x->current_s_a), $f($x->current_t_a)], fn ($y) => $y !== null)), 2)])->values()->all();
        $totalAll = array_sum(array_column($feederRows, 'total_a'));
        foreach ($feederRows as &$fr) {
            $fr['share_pct'] = $totalAll > 0 ? round($fr['total_a'] / $totalAll * 100, 1) : null;
        }
        unset($fr);
        $ends = array_values(array_filter(array_merge([$f($r->end_voltage_v)], array_column($feederRows, 'end_voltage_v')), fn ($x) => $x !== null));
        $endMin = $ends === [] ? null : min($ends);
        $nominal = (float) config('distriva.substation_nominal_voltage_v');
        $dropV = $endMin !== null ? round($nominal - $endMin, 2) : null;          // against the 220 V nominal, not the base voltage (owner 2026-11-16)
        $dropPct = $dropV !== null && $nominal > 0 ? round($dropV / $nominal * 100, 2) : null;
        $phaseImb = self::imbalance($phases, 3);
        $feederImb = self::imbalance(array_column($feederRows, 'total_a'), 2);
        $n = $f($r->current_n_a);
        $flags = [];
        $baseMin !== null && $baseMin < (float) config('distriva.substation_base_voltage_min_v') && $flags[] = 'BASE_LOW';
        $phaseImb !== null && $phaseImb > (float) config('distriva.substation_imbalance_max_pct') && $flags[] = 'PHASE_UNBALANCED';
        $feederImb !== null && $feederImb > (float) config('distriva.substation_feeder_imbalance_max_pct') && $flags[] = 'FEEDER_UNBALANCED';
        $endMin !== null && $endMin < KkoService::MIN_VOLTAGE && $flags[] = 'END_LOW';
        $dropPct !== null && $dropPct > (float) config('distriva.substation_drop_max_pct') && $flags[] = 'END_DROP';

        return ['measured_on' => CarbonImmutable::parse($r->measured_on)->toDateString(), 'measured_at' => SubstationService::timeOf($r), 'capacity_kva' => $r->capacity_kva === null ? null : (float) $r->capacity_kva, 'source' => $r->source, 'load_kva' => $f($r->load_kva), 'loading_pct' => $f($r->loading_pct), 'load_basis' => $r->load_basis,
            'current_r_a' => $phases['r'], 'current_s_a' => $phases['s'], 'current_t_a' => $phases['t'], 'current_n_a' => $n, 'current_max_a' => $f($r->current_max_a),
            'base_voltage_r_v' => $f($r->base_voltage_r_v), 'base_voltage_s_v' => $f($r->base_voltage_s_v), 'base_voltage_t_v' => $f($r->base_voltage_t_v), 'base_voltage_min_v' => $baseMin,
            'end_voltage_v' => $f($r->end_voltage_v), 'end_voltage_min_v' => $endMin, 'drop_v' => $dropV, 'drop_pct' => $dropPct,
            'phase_imbalance_pct' => $phaseImb, 'neutral_ratio_pct' => $n !== null && $avg !== null && $avg > 0 ? round($n / $avg * 100, 1) : null, 'feeder_imbalance_pct' => $feederImb, 'feeders' => $feederRows, 'flags' => $flags];
    }

    /** @param Collection<int,object> $rows ascending @return array<string,mixed> */
    private function forecast(object $s, $rows, int $horizon, ?float $growthOverride): array
    {
        $capacity = $s->capacity_kva === null ? null : (float) $s->capacity_kva;
        $base = $rows->reverse()->first(fn ($r) => $r->load_kva !== null);
        $notes = [];
        $today = CarbonImmutable::today();
        $adds = $this->additions($s->id, $today);
        if ($capacity === null) {
            $notes[] = 'NO_CAPACITY';
        }
        if ($base === null) {
            $notes[] = 'NO_LOAD_READING';
        } elseif (CarbonImmutable::parse($base->measured_on)->diffInDays($today) > (int) config('distriva.substation_reading_max_age_days')) {
            $notes[] = 'STALE_READING';
        }
        $out = ['available' => false, 'notes' => $notes, 'additions' => $adds, 'months' => [], 'over_normal_on' => null, 'over_100_on' => null, 'trend_kva_per_month' => $this->trend($rows)];
        if ($capacity === null || $base === null) {
            return $out;
        }
        $measuredOn = CarbonImmutable::parse($base->measured_on);
        $since = round(array_sum(array_map(fn ($a) => $a['kva'], array_filter($adds['realized'], fn ($a) => $a['date'] > $measuredOn->toDateString()))), 3);
        $growth = $growthOverride ?? $adds['avg_monthly_kva'];
        $load0 = (float) $base->load_kva + $since;
        $months = [];
        for ($i = 0; $i <= max(1, min($horizon, 36)); $i++) {
            $load = $load0 + ($i >= 1 ? $adds['pipeline_kva'] : 0.0) + ($i >= 2 ? $growth * ($i - 1) : 0.0);
            $pct = round($load / $capacity * 100, 2);
            $months[] = ['month' => $today->addMonthsNoOverflow($i)->format('Y-m'), 'load_kva' => round($load, 2), 'loading_pct' => $pct, 'class' => KkoService::classify($pct)];
        }
        $first = fn (float $limit) => collect($months)->first(fn ($m) => $m['loading_pct'] > $limit)['month'] ?? null;

        return ['available' => true, 'base' => ['measured_on' => $measuredOn->toDateString(), 'load_kva' => (float) $base->load_kva, 'connected_since_kva' => $since], 'growth_kva_per_month' => round($growth, 3), 'growth_overridden' => $growthOverride !== null,
            'months' => $months, 'over_normal_on' => $first(KkoService::NORMAL_MAX), 'over_100_on' => $first(KkoService::OVERLOAD_MAX)] + $out;
    }

    /** Customers added to this gardu through DISTRIVA applications (KKO linked to the gardu). @return array<string,mixed> */
    private function additions(string $substationId, CarbonImmutable $today): array
    {
        $rows = DB::table('application_kko as k')->join('applications as a', 'a.id', '=', 'k.application_id')->where('k.substation_id', $substationId)->where('k.dedicated_transformer', false)->whereNotNull('k.added_power_kva')
            ->where(fn ($w) => $w->whereNull('k.decision')->orWhere('k.decision', '!=', 'TIDAK_LAYAK'))->whereNotIn('a.current_status', ['CANCELLED', 'REFUNDED'])
            ->get(['a.application_number', 'a.current_status', 'a.completed_at', 'a.updated_at', 'k.added_power_kva', 'k.load_factor']);
        $realized = [];
        $pipeline = 0.0;
        $pipelineCount = 0;
        foreach ($rows as $r) {
            $kva = round((float) $r->added_power_kva * (float) ($r->load_factor ?? 0.8), 3);
            if (in_array($r->current_status, ['CONNECTION_DONE', 'COMPLETED'], true)) {
                $realized[] = ['application_number' => $r->application_number, 'date' => CarbonImmutable::parse($r->completed_at ?? $r->updated_at)->toDateString(), 'kva' => $kva];
            } else {
                $pipeline += $kva;
                $pipelineCount++;
            }
        }
        $byMonth = [];
        for ($i = 11; $i >= 0; $i--) {
            $byMonth[$today->subMonthsNoOverflow($i)->format('Y-m')] = ['month' => $today->subMonthsNoOverflow($i)->format('Y-m'), 'count' => 0, 'kva' => 0.0];
        }
        foreach ($realized as $a) {
            $m = substr($a['date'], 0, 7);
            if (isset($byMonth[$m])) {
                $byMonth[$m]['count']++;
                $byMonth[$m]['kva'] = round($byMonth[$m]['kva'] + $a['kva'], 3);
            }
        }

        return ['realized' => $realized, 'monthly' => array_values($byMonth), 'avg_monthly_kva' => round(array_sum(array_column($byMonth, 'kva')) / 12, 3), 'pipeline_kva' => round($pipeline, 3), 'pipeline_count' => $pipelineCount];
    }

    /** Slope (kVA per month) of the measured kVA load over the readings, for information only; null with fewer than 3 readings or less than 3 months. */
    private function trend($rows): ?float
    {
        $pts = $rows->filter(fn ($r) => $r->load_kva !== null)->map(fn ($r) => [CarbonImmutable::parse($r->measured_on)->timestamp / 86400 / 30.4375, (float) $r->load_kva])->values()->all();
        $n = count($pts);
        if ($n < 3 || $pts[$n - 1][0] - $pts[0][0] < 3) {
            return null;
        }
        $mx = array_sum(array_column($pts, 0)) / $n;
        $my = array_sum(array_column($pts, 1)) / $n;
        $den = array_sum(array_map(fn ($p) => ($p[0] - $mx) ** 2, $pts));

        return $den > 0 ? round(array_sum(array_map(fn ($p) => ($p[0] - $mx) * ($p[1] - $my), $pts)) / $den, 3) : null;
    }
}
