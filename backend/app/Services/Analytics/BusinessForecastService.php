<?php

namespace App\Services\Analytics;

use App\Services\Forecast\SeasonalForecaster;

/**
 * Prakiraan 12 bulan ke depan untuk tiap seri sebuah metrik pengusahaan beserta analisa teksnya (docs/91). Memakai model musiman yang sama dengan prakiraan gangguan (SeasonalForecaster)
 * atas riwayat bulan lengkap yang berurutan: pada UP3 hanya bulan ketika semua ULP melapor, dan deret yang dipakai adalah rangkaian terakhir tanpa celah. Butuh minimal 24 bulan.
 */
class BusinessForecastService
{
    private const MONTHS = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    private const HISTORY_MONTHS = 84;

    public function __construct(private readonly BusinessTrendBuilder $builder, private readonly SeasonalForecaster $forecaster) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @return array<string, mixed>
     */
    public function forecast(string $code, array $units): array
    {
        $def = BusinessMetricService::CATALOG[$code];
        $notes = ['Prakiraan pola dari riwayat bulanan (musiman dan tren teredam); peristiwa luar biasa tidak bisa diprakirakan. Rentang p10-p90 dari uji mundur 1-3 bulan.',
            'Hanya bulan yang laporannya lengkap (semua ULP pada UP3) dan berurutan yang dipakai; minimal 24 bulan.'];
        if (! ($def['available'] ?? true)) {
            return ['status' => 'UNAVAILABLE', 'message' => 'Metrik ini belum memiliki sumber data.', 'series' => [], 'insights' => [], 'notes' => $notes];
        }
        $latest = $this->builder->latestMonth($code, $units);
        $from = date('Y-m', strtotime($latest.'-01 -'.(self::HISTORY_MONTHS - 1).' month'));
        $d = $this->builder->build($code, $units, [], $from, $latest);
        $months = $d['months'];
        $expected = $d['units_expected'];
        $complete = array_map(fn ($n) => $n >= $expected, $d['units_reporting']);
        $series = [];
        foreach ($d['series'] as $i => $s) {
            $series[] = $this->one($def, $def['series'][$i], $s, $months, $complete, $latest);
        }
        $ok = array_filter($series, fn ($s) => $s['status'] === 'OK');

        return ['status' => $ok === [] ? 'INSUFFICIENT' : 'OK', 'message' => $ok === [] ? 'Riwayat lengkap belum cukup: butuh minimal 24 bulan berurutan dengan laporan semua ULP.' : null, 'last_month' => $latest,
            'metric' => ['code' => $code, 'name' => $def['name'], 'source' => $d['metric']['source'], 'polarity' => $def['polarity']], 'units_expected' => $expected, 'series' => $series,
            'insights' => $series[0]['insights'] ?? [], 'notes' => $notes];
    }

    /**
     * @param  array<string, mixed>  $def  katalog metrik
     * @param  array<string, mixed>  $spec  definisi seri pada katalog
     * @param  array<string, mixed>  $s  seri hasil build() (values sejajar $months)
     * @param  list<string>  $months
     * @param  list<bool>  $complete  sejajar $months: semua ULP melapor
     * @return array<string, mixed>
     */
    private function one(array $def, array $spec, array $s, array $months, array $complete, string $latest): array
    {
        $head = ['key' => $s['key'], 'name' => $s['name'], 'unit' => $s['unit']];
        $run = [];
        for ($i = count($months) - 1; $i >= 0; $i--) {
            if ($s['values'][$i] === null || ! $complete[$i]) {
                break;
            }
            array_unshift($run, $i);
        }
        if (count($run) < 24) {
            return $head + ['status' => 'INSUFFICIENT', 'message' => sprintf('Riwayat lengkap berurutan %d bulan (butuh minimal 24).', count($run)), 'history_months' => count($run), 'insights' => []];
        }
        $values = array_map(fn ($i) => (float) $s['values'][$i], $run);
        $runMonths = array_map(fn ($i) => $months[$i], $run);
        // peredaman tren dipilih per seri lewat uji mundur: deret posisi yang naik stabil (pelanggan, daya) lebih akurat tanpa peredaman, deret berisik dengan peredaman
        $fc = null;
        $phi = 0.9;
        foreach ([0.9, 1.0] as $candidate) {
            $try = $this->forecaster->series($values, $runMonths, $candidate);
            if ($fc === null || ($try['quality']['wape'] ?? INF) < ($fc['quality']['wape'] ?? INF) - 1e-9) {
                $fc = $try;
                $phi = $candidate;
            }
        }
        $actual = array_combine($runMonths, $values);
        $aggregate = $def['ytd'] === 'last' ? 'last' : (isset($spec['den']) ? 'mean' : 'sum');
        $target = end($fc['forecast']);
        $before = $actual[date('Y-m', strtotime($target['month'].'-01 -12 month'))] ?? null;
        $year = (int) substr($latest, 0, 4);
        $period = $this->period($aggregate, $fc['forecast'], $actual, $year, $latest);
        $insights = $this->insights($def, $s, $fc, $target, $before, $period, $aggregate, $actual);

        return $head + ['status' => 'OK', 'history_months' => count($run), 'aggregate' => $aggregate, 'history' => $fc['history'], 'forecast' => $fc['forecast'], 'trend_damping' => $phi, 'next12m' => $fc['next12m'], 'last12m' => $fc['last12m'], 'change_pct' => $fc['change_pct'], 'quality' => $fc['quality'],
            'target' => ['month' => $target['month'], 'p10' => $target['p10'], 'p50' => $target['p50'], 'p90' => $target['p90'], 'same_month_last_year' => $before, 'change_pct' => $this->pct($target['p50'], $before)],
            'period' => $period, 'insights' => $insights];
    }

    /**
     * Angka satu tahun berjalan menurut jenis seri: posisi akhir tahun (last), total setahun (sum: aktual Januari sampai bulan terakhir ditambah prakiraan sisa tahun), atau rata-rata 12 bulan ke depan (mean).
     *
     * @param  list<array<string, mixed>>  $forecast
     * @param  array<string, float>  $actual
     * @return array<string, mixed>|null
     */
    private function period(string $aggregate, array $forecast, array $actual, int $year, string $latest): ?array
    {
        $byMonth = array_column($forecast, 'p50', 'month');
        if ($aggregate === 'last') {
            $end = $year.'-12';
            $prev = $actual[($year - 1).'-12'] ?? null;

            return isset($byMonth[$end]) ? ['kind' => 'year_end', 'label' => 'Posisi akhir '.$year, 'month' => $end, 'p10' => array_column($forecast, 'p10', 'month')[$end], 'p50' => $byMonth[$end], 'p90' => array_column($forecast, 'p90', 'month')[$end], 'previous' => $prev, 'change_pct' => $this->pct($byMonth[$end], $prev)] : null;
        }
        if ($aggregate === 'mean') {
            $mean = array_sum($byMonth) / max(1, count($byMonth));
            $last12 = array_slice($actual, -12);
            $prev = count($last12) === 12 ? array_sum($last12) / 12 : null;

            return ['kind' => 'mean12', 'label' => 'Rata-rata 12 bulan ke depan', 'p50' => $mean, 'previous' => $prev, 'change_pct' => $this->pct($mean, $prev)];
        }
        $total = 0.0;
        for ($m = 1; $m <= 12; $m++) {
            $key = sprintf('%d-%02d', $year, $m);
            if (isset($actual[$key]) && $key <= $latest) {
                $total += $actual[$key];
            } elseif (isset($byMonth[$key])) {
                $total += $byMonth[$key];
            } else {
                return null;
            }
        }
        $prev = 0.0;
        for ($m = 1; $m <= 12; $m++) {
            $key = sprintf('%d-%02d', $year - 1, $m);
            if (! isset($actual[$key])) {
                $prev = null;
                break;
            }
            $prev += $actual[$key];
        }

        return ['kind' => 'full_year', 'label' => 'Total '.$year.' (aktual sampai '.$this->label($latest).' + prakiraan)', 'p50' => $total, 'previous' => $prev, 'change_pct' => $this->pct($total, $prev)];
    }

    /**
     * @param  array<string, mixed>  $def
     * @param  array<string, mixed>  $s
     * @param  array<string, mixed>  $fc
     * @param  array<string, mixed>  $target
     * @param  array<string, mixed>|null  $period
     * @param  array<string, float>  $actual
     * @return list<array{level: string, text: string}>
     */
    private function insights(array $def, array $s, array $fc, array $target, ?float $before, ?array $period, string $aggregate, array $actual): array
    {
        $good = fn (float $delta) => $def['polarity'] === 'up' ? $delta > 0 : $delta < 0;
        $f = fn (float $v) => $this->format($v, $s['unit']);
        $out = [];
        $change = $this->pct($target['p50'], $before);
        if ($change !== null) {
            $out[] = ['level' => abs($change) < 1 ? 'info' : ($good($change) ? 'baik' : 'perhatian'), 'text' => sprintf('%s diprakirakan %s %.1f%% pada %s: %s %s (rentang %s sampai %s), dibanding %s %s.', $s['name'], $change >= 0 ? 'naik' : 'turun', abs($change), $this->label($target['month']),
                $f($target['p50']), $s['unit'], $f($target['p10']), $f($target['p90']), $this->label(date('Y-m', strtotime($target['month'].'-01 -12 month'))), $f((float) $before))];
        }
        if ($period !== null && $period['change_pct'] !== null) {
            $c = $period['change_pct'];
            $out[] = ['level' => abs($c) < 1 ? 'info' : ($good($c) ? 'baik' : 'perhatian'), 'text' => sprintf('%s diperkirakan %s %s, %s %.1f%% dibanding periode pembanding (%s %s).', $period['label'], $f($period['p50']), $s['unit'], $c >= 0 ? 'naik' : 'turun', abs($c), $f((float) $period['previous']), $s['unit'])];
        }
        $gain = $fc['quality']['gain_vs_naive_pct'];
        if ($gain === null || $gain < 0) {
            $out[] = ['level' => 'perhatian', 'text' => 'Model tidak lebih akurat daripada tebakan sederhana "bulan yang sama tahun lalu"'.($gain === null ? '' : sprintf(' (%.0f%% lebih buruk)', abs($gain))).'; pakai prakiraan ini hanya sebagai gambaran arah.'];
        } else {
            $out[] = ['level' => 'info', 'text' => sprintf('Model %.0f%% lebih akurat daripada tebakan sederhana "bulan yang sama tahun lalu" pada uji mundur (galat WAPE %.1f%%).', $gain, ($fc['quality']['wape'] ?? 0) * 100)];
        }
        if ($aggregate !== 'last') {
            $rows = $fc['forecast'];
            usort($rows, fn ($a, $b) => $def['polarity'] === 'up' ? $a['p50'] <=> $b['p50'] : $b['p50'] <=> $a['p50']);
            $out[] = ['level' => 'info', 'text' => sprintf('Bulan dengan nilai paling tidak menguntungkan yang diprakirakan: %s (%s %s).', $this->label($rows[0]['month']), $f($rows[0]['p50']), $s['unit'])];
        }

        return $out;
    }

    private function format(float $v, string $unit): string
    {
        return match (true) {
            $unit === 'MVA' => number_format($v, 2, ',', '.'),
            str_contains($unit, '/plg') || $unit === 'jam' || $unit === 'bulan' || $unit === '%' || $unit === 'Rp/kWh' => number_format($v, 2, ',', '.'),
            $unit === 'Rp' && abs($v) >= 1e9 => number_format($v / 1e9, 2, ',', '.').' M',
            $unit === 'Rp' && abs($v) >= 1e6 => number_format($v / 1e6, 1, ',', '.').' juta',
            default => number_format($v, 0, ',', '.'),
        };
    }

    private function pct(?float $now, ?float $before): ?float
    {
        return $now === null || $before === null || $before == 0 ? null : ($now - $before) / abs($before) * 100;
    }

    private function label(string $month): string
    {
        return self::MONTHS[(int) substr($month, 5, 2)].' '.substr($month, 0, 4);
    }
}
