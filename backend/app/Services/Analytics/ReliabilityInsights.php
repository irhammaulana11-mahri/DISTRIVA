<?php

namespace App\Services\Analytics;

use App\Services\Outages\OutageAnalysisService;
use Illuminate\Support\Facades\DB;

/**
 * Wawasan keandalan untuk menu SAIDI/SAIFI, ENS, dan Gangguan Penyulang (docs/92 §6.6), dari data gangguan penyulang tersinkron (`outage_events`): Pareto penyulang penyumbang SAIDI dan SAIFI,
 * penyulang dengan gangguan berulang, komposisi penyebab dan cuaca, serta skor risiko bulan depan per penyulang beserta uji mundurnya. Tanpa model pembelajaran mesin: aturannya sengaja sederhana
 * dan bisa dijelaskan; cuaca historis hanya menjadi konteks penjelasan (`weather`, docs/92 §8.1), prakiraan BMKG belum dipakai.
 */
class ReliabilityInsights
{
    /** Gangguan berulang: paling sedikit ini kejadian pada 30 hari terakhir (ambang sementara, keputusan terbuka docs/92 §10). */
    public const REPEAT_MIN_EVENTS = 3;

    public const REPEAT_WINDOW_DAYS = 30;

    /** Paruh waktu (bulan) rata-rata bergerak eksponensial untuk laju gangguan penyulang. */
    private const HALF_LIFE_MONTHS = 3;

    private const TRAIN_MONTHS = 36;

    private const BACKTEST_MONTHS = 24;

    private const TOP = 10;

    public function __construct(private readonly OutageAnalysisService $outages, private readonly WeatherContext $weather, private readonly WeatherAlert $alert) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $from = substr($to, 0, 4).'-01-01';
        $end = date('Y-m-t', (int) strtotime($to.'-01'));
        $today = now($tz)->toDateString();
        $partial = $to === now($tz)->format('Y-m');

        return [
            'kind' => 'reliability',
            'period' => ['from' => $from, 'to' => $end, 'partial' => $partial],
            'pareto' => $this->pareto($units, $from, $end),
            'repeat' => $this->repeat($units, min($end, $today)),
            'composition' => ['cause' => $this->composition($units, $from, $end, 'e.category', 'Tanpa kategori'), 'weather' => $this->composition($units, $from, $end, 'e.weather', 'Tanpa cuaca'),
                'device' => $this->composition($units, $from, $end, 'e.device_group', 'Lainnya')],
            'risk' => $this->risk($units, $to, $partial),
            'weather' => $this->weather->monthly($units, $to),
            'early_warning' => $this->alert->earlyWarning($units),
            'notes' => ['Pareto: kontribusi SAIDI dan SAIFI memakai aturan pengaturan sinkron gangguan (ambang menit) dan pelanggan aktif penyulang dari potret DIL; angka per penyulang adalah batas atas, terutama untuk recloser.',
                'Skor risiko hanya memakai pola kejadian penyulang itu sendiri (rata-rata bergerak eksponensial dengan paruh waktu '.self::HALF_LIFE_MONTHS.' bulan dan indeks musim bulan kalender) dan belum memakai cuaca; akurasinya dinilai dari uji mundur '.self::BACKTEST_MONTHS.' bulan terakhir (sekitar dua sampai tiga kali tebakan acak, bukan ramalan pasti).'],
        ];
    }

    /** @return array<string, mixed> */
    private function pareto(array $units, string $from, string $to): array
    {
        $rows = collect($this->outages->feederRanking($units, $from, $to))->filter(fn ($r) => $r['feeder_id'] !== null);
        $totalSaidi = (float) $rows->sum('saidi_contribution');
        $totalSaifi = (float) $rows->sum('saifi_contribution');
        $totalEns = (float) $rows->sum('ens_kwh');
        $cumulative = 0.0;
        $top = $rows->sortByDesc(fn ($r) => $r['saidi_contribution'] ?? -1)->take(self::TOP)->values()->map(function ($r) use ($totalSaidi, $totalSaifi, $totalEns, &$cumulative) {
            $share = $totalSaidi > 0 ? (float) ($r['saidi_contribution'] ?? 0) / $totalSaidi * 100 : null;
            $cumulative += $share ?? 0;

            return ['feeder_id' => $r['feeder_id'], 'code' => $r['code'], 'name' => $r['name'], 'gi_name' => $r['gi_name'], 'unit_name' => $r['unit_name'] ?? null, 'events' => $r['events'], 'permanent' => $r['permanent'], 'temporary' => $r['temporary'], 'minutes' => $r['minutes'],
                'ens_kwh' => $r['ens_kwh'], 'customers' => $r['customers'], 'saidi_contribution' => $r['saidi_contribution'], 'saifi_contribution' => $r['saifi_contribution'],
                'saidi_share_pct' => $share === null ? null : round($share, 2), 'saidi_cumulative_pct' => $share === null ? null : round($cumulative, 2),
                'saifi_share_pct' => $totalSaifi > 0 ? round((float) ($r['saifi_contribution'] ?? 0) / $totalSaifi * 100, 2) : null, 'ens_share_pct' => $totalEns > 0 ? round($r['ens_kwh'] / $totalEns * 100, 2) : null, 'trend_pct' => $r['trend_pct']];
        })->all();

        return ['basis' => 'saidi_contribution', 'feeders_with_events' => $rows->count(), 'total_saidi_contribution' => round($totalSaidi, 3), 'total_saifi_contribution' => round($totalSaifi, 4), 'total_ens_kwh' => round($totalEns, 1),
            'top_share_pct' => $top === [] ? null : end($top)['saidi_cumulative_pct'], 'rows' => $top];
    }

    /** @return array<string, mixed> */
    private function repeat(array $units, string $until): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $since = date('Y-m-d', (int) strtotime($until.' -'.(self::REPEAT_WINDOW_DAYS - 1).' day'));
        $rows = DB::table('outage_events as e')
            ->leftJoin('distribution_feeders as f', 'f.id', '=', 'e.feeder_id')
            ->leftJoin('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')
            ->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->whereIn('e.organizational_unit_id', $units)
            ->whereRaw('(e.occurred_at at time zone ?)::date between ? and ?', [$tz, $since, $until])->groupBy('e.feeder_id', 'f.code', 'f.name', 'f.gi_name', 'u.name')->havingRaw('count(*) >= ?', [self::REPEAT_MIN_EVENTS])->orderByRaw('count(*) desc, sum(e.duration_minutes) desc')->limit(20)
            ->selectRaw("e.feeder_id, f.code, f.name, f.gi_name, u.name as unit_name, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, coalesce(sum(e.duration_minutes), 0) as minutes, max(e.occurred_at at time zone ?) as last_at", [$tz])->get();

        return ['threshold_events' => self::REPEAT_MIN_EVENTS, 'window_days' => self::REPEAT_WINDOW_DAYS, 'window_from' => $since, 'window_to' => $until, 'rows' => $rows->map(fn ($r) => ['feeder_id' => $r->feeder_id, 'code' => $r->code, 'name' => $r->name, 'gi_name' => $r->gi_name, 'unit_name' => $r->unit_name,
            'events' => (int) $r->n, 'permanent' => (int) $r->perm, 'minutes' => round((float) $r->minutes, 1), 'last_at' => substr((string) $r->last_at, 0, 16)])->all()];
    }

    /** @return array<string, mixed> */
    private function composition(array $units, string $from, string $to, string $column, string $fallback): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $rows = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereIn('e.organizational_unit_id', $units)->whereRaw('(e.occurred_at at time zone ?)::date between ? and ?', [$tz, $from, $to])
            ->selectRaw("coalesce(nullif(trim({$column}), ''), ?) as label, count(*) as n, coalesce(sum(e.duration_minutes), 0) as minutes, coalesce(sum(e.ens_kwh), 0) as ens", [$fallback])->groupBy('label')->orderByDesc('n')->get();
        $n = (float) $rows->sum('n');
        $minutes = (float) $rows->sum('minutes');
        $ens = (float) $rows->sum('ens');

        return ['total_events' => (int) $n, 'rows' => $rows->take(8)->map(fn ($r) => ['key' => $r->label, 'events' => (int) $r->n, 'events_share_pct' => $n > 0 ? round($r->n / $n * 100, 1) : null, 'minutes' => round((float) $r->minutes, 1),
            'minutes_share_pct' => $minutes > 0 ? round($r->minutes / $minutes * 100, 1) : null, 'ens_kwh' => round((float) $r->ens, 1), 'ens_share_pct' => $ens > 0 ? round($r->ens / $ens * 100, 1) : null])->values()->all()];
    }

    /**
     * Skor risiko: laju gangguan per penyulang (rata-rata bergerak eksponensial bulanan) dikali indeks musim bulan sasaran. Uji mundur: pada tiap bulan dari 24 bulan terakhir, sepuluh penyulang
     * teratas yang diprakirakan hanya dari data sebelum bulan itu dibandingkan dengan penyulang yang benar-benar mengalami gangguan pada bulan itu.
     *
     * @return array<string, mixed>
     */
    private function risk(array $units, string $to, bool $partial): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $asOf = $partial ? date('Y-m', (int) strtotime($to.'-01 -1 month')) : $to;
        $target = date('Y-m', (int) strtotime($asOf.'-01 +1 month'));
        $startMonth = date('Y-m', (int) strtotime($asOf.'-01 -'.(self::TRAIN_MONTHS + 59).' month'));         // tambahan lima tahun untuk indeks musim
        $events = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->whereIn('e.organizational_unit_id', $units)
            ->whereRaw("to_char(e.occurred_at at time zone ?, 'YYYY-MM') between ? and ?", [$tz, $startMonth, $asOf])
            ->selectRaw("e.feeder_id, to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm", [$tz])->groupBy('e.feeder_id', 'm')->get();
        $byFeeder = [];
        $perMonthAll = [];
        foreach ($events as $r) {
            $byFeeder[$r->feeder_id][$r->m] = ['n' => (int) $r->n, 'perm' => (int) $r->perm];
            $perMonthAll[$r->m] = ($perMonthAll[$r->m] ?? 0) + (int) $r->n;
        }
        if ($byFeeder === []) {
            return ['available' => false, 'reason' => 'Belum ada data gangguan penyulang pada cakupan ini.'];
        }
        $season = $this->seasonIndex($perMonthAll, $asOf);
        $alpha = 1 - 0.5 ** (1 / self::HALF_LIFE_MONTHS);
        $rate = function (array $series, string $until) use ($alpha): float {
            $e = 0.0;
            for ($i = self::TRAIN_MONTHS - 1; $i >= 0; $i--) {
                $m = date('Y-m', (int) strtotime($until.'-01 -'.$i.' month'));
                $e = $alpha * ($series[$m]['n'] ?? 0) + (1 - $alpha) * $e;
            }

            return $e;
        };
        $count12 = function (array $series, string $until): int {
            $n = 0;
            for ($i = 0; $i < 12; $i++) {
                $n += $series[date('Y-m', (int) strtotime($until.'-01 -'.$i.' month'))]['n'] ?? 0;
            }

            return $n;
        };
        $rank = function (string $until, bool $naive) use ($byFeeder, $rate, $count12): array {
            $score = [];
            foreach ($byFeeder as $id => $series) {
                $score[$id] = $naive ? $count12($series, $until) : $rate($series, $until);
            }
            arsort($score);

            return array_slice(array_keys($score), 0, self::TOP);
        };

        $meta = DB::table('distribution_feeders as f')->leftJoin('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')->whereIn('f.id', array_keys($byFeeder))->get(['f.id', 'f.code', 'f.name', 'f.gi_name', 'u.name as owner'])->keyBy('id');
        $targetSeason = $season[(int) substr($target, 5, 2)];
        $rows = [];
        foreach ($rank($asOf, false) as $id) {
            $series = $byFeeder[$id];
            $l12 = $count12($series, $asOf);
            $perm12 = 0;
            for ($i = 0; $i < 12; $i++) {
                $perm12 += $series[date('Y-m', (int) strtotime($asOf.'-01 -'.$i.' month'))]['perm'] ?? 0;
            }
            $expected = $rate($series, $asOf) * $targetSeason;
            $rows[] = ['feeder_id' => $id, 'code' => $meta[$id]->code ?? null, 'name' => $meta[$id]->name ?? null, 'gi_name' => $meta[$id]->gi_name ?? null, 'owner' => $meta[$id]->owner ?? null,
                'expected_events' => round($expected, 2), 'expected_permanent' => round($l12 > 0 ? $expected * $perm12 / $l12 : 0, 2), 'last_12m_events' => $l12, 'last_3m_events' => $count12($series, $asOf) - $this->olderThanThree($series, $asOf), 'last_month_events' => $series[$asOf]['n'] ?? 0];
        }

        $capture = ['model' => [], 'naive' => [], 'random' => []];
        $active = count($byFeeder);
        $months = [];
        for ($i = self::BACKTEST_MONTHS - 1; $i >= 0; $i--) {
            $t = date('Y-m', (int) strtotime($asOf.'-01 -'.$i.' month'));
            $before = date('Y-m', (int) strtotime($t.'-01 -1 month'));
            $total = 0;
            foreach ($byFeeder as $series) {
                $total += $series[$t]['n'] ?? 0;
            }
            if ($total === 0) {
                continue;
            }
            $months[] = $t;
            foreach (['model' => false, 'naive' => true] as $name => $naive) {
                $hit = array_sum(array_map(fn ($id) => $byFeeder[$id][$t]['n'] ?? 0, $rank($before, $naive)));
                $capture[$name][] = $hit / $total * 100;
            }
            $capture['random'][] = min(self::TOP, $active) / $active * 100;
        }
        $avg = fn (array $v) => $v === [] ? null : round(array_sum($v) / count($v), 1);

        return ['available' => true, 'as_of_month' => $asOf, 'target_month' => $target, 'season_index' => round($targetSeason, 2), 'feeders_scored' => $active, 'method' => 'ewma_seasonal', 'rows' => $rows,
            'backtest' => ['top' => self::TOP, 'months' => $months, 'model_capture_pct' => $avg($capture['model']), 'naive_capture_pct' => $avg($capture['naive']), 'random_capture_pct' => $avg($capture['random']),
                'description' => 'Rata-rata persentase gangguan bulan berikutnya yang terjadi pada sepuluh penyulang teratas menurut model, menurut jumlah gangguan 12 bulan terakhir (naif), dan menurut tebakan acak.']];
    }

    /** @param array<string, array{n: int, perm: int}> $series */
    private function olderThanThree(array $series, string $asOf): int
    {
        $n = 0;
        for ($i = 3; $i < 12; $i++) {
            $n += $series[date('Y-m', (int) strtotime($asOf.'-01 -'.$i.' month'))]['n'] ?? 0;
        }

        return $n;
    }

    /**
     * Indeks musim bulan kalender = rata-rata gangguan semua penyulang pada bulan itu dibanding rata-rata bulanan, dari bulan lengkap yang tersedia; dibatasi 0,5 sampai 2.
     *
     * @param  array<string, int>  $perMonth
     * @return array<int, float>
     */
    private function seasonIndex(array $perMonth, string $asOf): array
    {
        $perMonth = array_filter($perMonth, fn ($k) => $k <= $asOf, ARRAY_FILTER_USE_KEY);
        $mean = $perMonth === [] ? 0.0 : array_sum($perMonth) / count($perMonth);
        $out = array_fill(1, 12, 1.0);
        if ($mean <= 0) {
            return $out;
        }
        for ($m = 1; $m <= 12; $m++) {
            $values = array_filter($perMonth, fn ($k) => (int) substr($k, 5, 2) === $m, ARRAY_FILTER_USE_KEY);
            $values !== [] && $out[$m] = max(0.5, min(2.0, array_sum($values) / count($values) / $mean));
        }

        return $out;
    }
}
