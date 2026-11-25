<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan kWh P2TL (docs/92 §6.9): corong penetapan (kontrol 309) → realisasi (TAGSUS) → belum realisasi (potret TAGSUS), tingkat realisasi menurut ULP dan golongan pelanggaran, serta
 * perkiraan realisasi satu bulan dari penetapannya (rasio kumulatif bulan-bulan sebelumnya) beserta uji mundurnya terhadap cara naif. Penetapan sebelum 2026 memakai definisi lain (jauh lebih kecil
 * dari realisasi); bulan seperti itu dikeluarkan dari rasio lewat batas kewajaran `RATIO_BAND`.
 */
class P2tlInsights
{
    /** Bulan hanya dipakai untuk rasio realisasi/penetapan bila rasionya wajar; di luar rentang ini definisi penetapan dianggap berbeda. */
    public const RATIO_BAND = [0.5, 1.5];

    private const HISTORY_MONTHS = 12;

    private const MIN_TRAIN_MONTHS = 3;

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $year = substr($to, 0, 4);
        $from = min($year.'-01', $this->shift($to, -(self::HISTORY_MONTHS - 1)));
        $real = $this->metrics->raw('kwh-p2tl', $units, $from, $to);
        $set = $this->metrics->raw('kwh-p2tl-penetapan', $units, $from, $to);
        $owed = $this->metrics->raw('kwh-p2tl-belum', $units, $from, $to);
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        $sum = function (array $raw, string $key): array {
            $out = [];
            foreach ($raw as $byMonth) {
                foreach ($byMonth as $m => $cell) {
                    if (isset($cell['raw'][$key])) {
                        $out[$m] = ($out[$m] ?? 0) + $cell['raw'][$key];
                    }
                }
            }
            ksort($out);

            return $out;
        };
        $R = $sum($real, 'kwh');
        $P = $sum($set, 'kwh_pen_p2tl');
        $B = $sum($owed, 'kwh');
        $Rp = $sum($real, 'rp');
        $Pp = $sum($set, 'rp_pen_p2tl');

        $history = [];
        for ($i = self::HISTORY_MONTHS - 1; $i >= 0; $i--) {
            $m = $this->shift($to, -$i);
            if (! isset($R[$m]) && ! isset($P[$m])) {
                continue;
            }
            $ratio = isset($R[$m], $P[$m]) && $P[$m] > 0 ? $R[$m] / $P[$m] : null;
            $history[] = ['month' => $m, 'penetapan_kwh' => isset($P[$m]) ? round($P[$m]) : null, 'realisasi_kwh' => isset($R[$m]) ? round($R[$m]) : null, 'belum_kwh' => isset($B[$m]) ? round($B[$m]) : null,
                'realisasi_rp' => isset($Rp[$m]) ? round($Rp[$m]) : null, 'penetapan_rp' => isset($Pp[$m]) ? round($Pp[$m]) : null, 'ratio' => $ratio === null ? null : round($ratio, 3), 'ratio_consistent' => $ratio !== null && $this->consistent($ratio)];
        }

        return ['kind' => 'p2tl', 'month' => $to, 'partial' => $to === now($tz)->format('Y-m'), 'year' => (int) $year, 'funnel' => $history, 'ulps' => $this->ulps($units, $names, $real, $set, $owed, $year, $to),
            'violations' => $this->violations($real, $year, $to), 'projection' => $this->projection($R, $P, $to),
            'notes' => [
                'Penetapan (kontrol 309) dan realisasi (TAGSUS) adalah dua sumber berbeda: selisihnya tidak seluruhnya tertutup oleh "belum realisasi", sebagian penetapan terealisasi pada bulan lain atau gugur.',
                'Penetapan sebelum 2026 memakai definisi yang berbeda dan tidak dipakai untuk rasio (ditandai ratio_consistent false).',
                'Perkiraan hanya berlaku bila penetapan bulan itu sudah ada (tersedia setelah bulan ditutup); riwayat uji masih pendek.']];
    }

    /** @return array<string, mixed> */
    private function ulps(array $units, $names, array $real, array $set, array $owed, string $year, string $to): array
    {
        $rows = [];
        foreach ($units as $u) {
            $r = ['kwh' => 0.0, 'rp' => 0.0, 'n' => 0.0];
            $pen = 0.0;
            $penRealised = 0.0;
            $months = 0;
            foreach ($real[$u] ?? [] as $m => $cell) {
                if (substr($m, 0, 4) !== $year || $m > $to) {
                    continue;
                }
                $months++;
                foreach (['kwh', 'rp', 'n'] as $k) {
                    $r[$k] += $cell['raw'][$k] ?? 0;
                }
                $p = $set[$u][$m]['raw']['kwh_pen_p2tl'] ?? null;
                if ($p !== null && $p > 0 && $this->consistent(($cell['raw']['kwh'] ?? 0) / $p)) {
                    $pen += $p;
                    $penRealised += $cell['raw']['kwh'] ?? 0;
                }
            }
            if ($months === 0) {
                continue;
            }
            $belum = ($owed[$u][$to]['raw']['kwh'] ?? null);
            $rows[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'months' => $months, 'realisasi_kwh' => round($r['kwh']), 'realisasi_rp' => round($r['rp']), 'cases' => (int) $r['n'],
                'kwh_per_case' => $r['n'] > 0 ? round($r['kwh'] / $r['n']) : null, 'rp_per_kwh' => $r['kwh'] > 0 ? round($r['rp'] / $r['kwh']) : null,
                'penetapan_kwh' => $pen > 0 ? round($pen) : null, 'realisasi_rate_pct' => $pen > 0 ? round($penRealised / $pen * 100, 1) : null, 'belum_kwh' => $belum === null ? null : round($belum)];
        }
        usort($rows, fn ($a, $b) => $b['realisasi_kwh'] <=> $a['realisasi_kwh']);
        $total = array_sum(array_column($rows, 'realisasi_kwh'));
        foreach ($rows as $i => $row) {
            $rows[$i]['share_pct'] = $total > 0 ? round($row['realisasi_kwh'] / $total * 100, 1) : null;
        }

        return ['basis' => 'year_to_date', 'rows' => $rows];
    }

    /** @return list<array<string, mixed>> */
    private function violations(array $real, string $year, string $to): array
    {
        $by = [];
        foreach ($real as $byMonth) {
            foreach ($byMonth as $m => $cell) {
                if (substr($m, 0, 4) === $year && $m <= $to) {
                    foreach ($cell['bd'] ?? [] as $label => $v) {
                        $by[$label] = ($by[$label] ?? 0) + $v;
                    }
                }
            }
        }
        arsort($by);
        $total = array_sum($by);

        return array_values(array_map(fn ($label, $v) => ['key' => $label, 'kwh' => round($v), 'share_pct' => $total > 0 ? round($v / $total * 100, 1) : null], array_keys($by), $by));
    }

    /**
     * Perkiraan realisasi bulan `$to` dari penetapannya dengan rasio kumulatif bulan-bulan wajar sebelumnya, dan uji mundurnya pada bulan sebelumnya yang punya cukup riwayat.
     *
     * @return array<string, mixed>
     */
    private function projection(array $R, array $P, string $to): array
    {
        $ratioTo = function (string $month) use ($R, $P): ?float {
            $prior = array_filter(array_keys($P), fn ($m) => $m < $month && isset($R[$m]) && $P[$m] > 0 && $this->consistent($R[$m] / $P[$m]));
            if (count($prior) < self::MIN_TRAIN_MONTHS) {
                return null;
            }

            return array_sum(array_map(fn ($m) => $R[$m], $prior)) / array_sum(array_map(fn ($m) => $P[$m], $prior));
        };
        $errors = ['model' => [], 'naive' => [], 'mean3' => []];
        $months = array_filter(array_keys($P), fn ($m) => $m < $to && isset($R[$m]) && $R[$m] > 0 && $this->consistent($R[$m] / max($P[$m], 1)));
        foreach ($months as $m) {
            $rate = $ratioTo($m);
            $prev = array_values(array_filter(array_keys($R), fn ($x) => $x < $m));
            if ($rate === null || count($prev) < 3) {
                continue;
            }
            $errors['model'][] = abs($rate * $P[$m] - $R[$m]) / $R[$m];
            $errors['naive'][] = abs($R[$prev[count($prev) - 1]] - $R[$m]) / $R[$m];
            $errors['mean3'][] = abs((($R[$prev[count($prev) - 1]] + $R[$prev[count($prev) - 2]] + $R[$prev[count($prev) - 3]]) / 3) - $R[$m]) / $R[$m];
        }
        $mape = fn (array $e): ?float => $e === [] ? null : round(array_sum($e) / count($e) * 100, 1);
        $rate = $ratioTo($to);
        $available = $rate !== null && isset($P[$to]) && $P[$to] > 0;
        $backtest = ['months' => count($errors['model']), 'model_mape_pct' => $mape($errors['model']), 'naive_mape_pct' => $mape($errors['naive']), 'mean3_mape_pct' => $mape($errors['mean3'])];

        return ['available' => $available, 'method' => 'penetapan_x_rasio_kumulatif', 'month' => $to, 'ratio' => $rate === null ? null : round($rate, 3), 'penetapan_kwh' => isset($P[$to]) ? round($P[$to]) : null,
            'expected_realisasi_kwh' => $available ? round($rate * $P[$to]) : null, 'actual_realisasi_kwh' => isset($R[$to]) ? round($R[$to]) : null,
            'achieved_pct' => $available && isset($R[$to]) ? round($R[$to] / ($rate * $P[$to]) * 100, 1) : null, 'backtest' => $backtest,
            'reliable' => $backtest['months'] >= 6 && $backtest['model_mape_pct'] !== null && $backtest['model_mape_pct'] < min($backtest['naive_mape_pct'] ?? INF, $backtest['mean3_mape_pct'] ?? INF),
            'reliability_note' => $backtest['months'] < 6 ? 'Riwayat uji mundur masih kurang dari enam bulan; bacalah sebagai petunjuk.' : null];
    }

    private function consistent(float $ratio): bool
    {
        return $ratio >= self::RATIO_BAND[0] && $ratio <= self::RATIO_BAND[1];
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.($by >= 0 ? '+' : '').$by.' month'));
    }
}
