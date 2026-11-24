<?php

namespace App\Services\Forecast;

/**
 * Prakiraan statistik bulanan 12 bulan ke depan untuk satu deret (dipakai prakiraan gangguan dan prakiraan analisa pengusahaan, docs/87 dan docs/91): tingkat dasar 12 bulan terakhir,
 * tren teredam (phi 0,9, paling banyak 30% per 12 bulan), dan indeks musiman dari tahun yang lengkap. Rentang p10-p90 bulanan dari rasio aktual/prakiraan pada uji mundur (origin bergulir,
 * horizon 1-3 bulan) dan mutu model dibandingkan dengan pembanding sederhana "bulan yang sama tahun lalu". Butuh minimal 24 bulan berurutan.
 */
class SeasonalForecaster
{
    private const PHI = 0.9;

    /**
     * @param  list<float|int>  $values
     * @param  list<string>  $months
     * @return array<string,mixed>
     */
    public function series(array $values, array $months, float $phi = self::PHI): array
    {
        $n = count($values);
        $fc = $this->model($values, $months, 12, $phi);
        // uji mundur: origin bergulir pada 12 bulan terakhir, horizon 1..3
        $ratios = [];
        $err = 0.0;
        $errNaive = 0.0;
        $sum = 0.0;
        $points = 0;
        for ($o = $n - 12; $o < $n; $o++) {
            if ($o < 24) {
                continue;
            }
            $f = $this->model(array_slice($values, 0, $o), array_slice($months, 0, $o), 3, $phi);
            foreach ([1, 2, 3] as $h) {
                $t = $o + $h - 1;
                if ($t >= $n) {
                    continue;
                }
                $a = (float) $values[$t];
                $p = $f[$h - 1];
                $naive = (float) $values[$t - 12];
                $err += abs($a - $p);
                $errNaive += abs($a - $naive);
                $sum += $a;
                $points++;
                $p > 0 && $a > 0 && $ratios[] = $a / $p;
            }
        }
        sort($ratios);
        $q = fn (float $p) => $ratios === [] ? 1.0 : $ratios[(int) max(0, min(count($ratios) - 1, floor($p * (count($ratios) - 1))))];
        $lo = $ratios === [] ? 0.8 : min($q(0.1), 0.95);
        $hi = $ratios === [] ? 1.2 : max($q(0.9), 1.05);
        $last = end($months);
        $out = [];
        foreach ($fc as $i => $p) {
            $out[] = ['month' => date('Y-m', strtotime($last.'-01 +'.($i + 1).' month')), 'p10' => round($p * $lo, 2), 'p50' => round($p, 2), 'p90' => round($p * $hi, 2)];
        }
        $next = array_sum(array_column($out, 'p50'));
        $prev = array_sum(array_slice($values, -12));

        return ['history' => array_map(fn ($m, $v) => ['month' => $m, 'value' => round((float) $v, 3)], array_slice($months, -24), array_slice($values, -24)), 'forecast' => $out,
            'next12m' => ['p10' => round(max(0, $next - sqrt(array_sum(array_map(fn ($o) => ($o['p50'] - $o['p10']) ** 2, $out)))), 2), 'p50' => round($next, 2), 'p90' => round($next + sqrt(array_sum(array_map(fn ($o) => ($o['p90'] - $o['p50']) ** 2, $out))), 2)], 'last12m' => round($prev, 2),
            'change_pct' => $prev > 0 ? round(($next - $prev) / $prev * 100, 1) : null,
            'quality' => ['wape' => $sum > 0 ? round($err / $sum, 3) : null, 'naive_wape' => $sum > 0 ? round($errNaive / $sum, 3) : null, 'gain_vs_naive_pct' => $errNaive > 0 ? round((1 - $err / $errNaive) * 100, 1) : null, 'backtest_points' => $points]];
    }

    /**
     * @param  list<float|int>  $values
     * @param  list<string>  $months
     * @return list<float> prakiraan p50 untuk $h bulan ke depan
     */
    private function model(array $values, array $months, int $h, float $phi = self::PHI): array
    {
        $n = count($values);
        $idx = $this->seasonal($values, $months);
        $de = [];
        foreach ($values as $i => $v) {
            $de[] = $idx[(int) substr($months[$i], 5)] > 0 ? $v / $idx[(int) substr($months[$i], 5)] : $v;
        }
        $level = array_sum(array_slice($de, -12)) / 12;
        $prev = $n >= 24 ? array_sum(array_slice($de, -24, 12)) / 12 : $level;
        $trend = ($level - $prev) / 12;
        $cap = 0.3 * $level / 12;
        $trend = max(-$cap, min($cap, $trend));
        $out = [];
        $damp = 0.0;
        $last = end($months);
        for ($i = 1; $i <= $h; $i++) {
            $damp += $phi ** $i;
            $m = (int) date('n', strtotime($last.'-01 +'.$i.' month'));
            $out[] = max(0.0, ($level + $trend * $damp) * ($idx[$m] ?? 1.0));
        }

        return $out;
    }

    /** @return array<int,float> indeks musiman bulan 1..12 (rata-rata = 1) dari tahun yang lengkap; 1,0 bila belum ada */
    private function seasonal(array $values, array $months): array
    {
        $by = [];
        foreach ($values as $i => $v) {
            $by[substr($months[$i], 0, 4)][(int) substr($months[$i], 5)] = (float) $v;
        }
        $idx = array_fill(1, 12, [0.0, 0]);
        foreach ($by as $year) {
            if (count($year) !== 12 || array_sum($year) <= 0) {
                continue;
            }
            $mean = array_sum($year) / 12;
            foreach ($year as $m => $v) {
                $idx[$m] = [$idx[$m][0] + $v / $mean, $idx[$m][1] + 1];
            }
        }
        $out = [];
        foreach ($idx as $m => [$s, $c]) {
            $out[$m] = $c > 0 ? $s / $c : 1.0;
        }
        $avg = array_sum($out) / 12;

        return array_map(fn ($v) => $avg > 0 ? $v / $avg : 1.0, $out);
    }
}
