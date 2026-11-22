<?php

namespace App\Services\Outages;

use Illuminate\Support\Facades\DB;

/**
 * Prakiraan gangguan 12 bulan ke depan (docs/86), statistik dan dihitung saat diminta (tanpa pekerjaan latar): per metrik bulanan (gangguan permanen, temporer, ENS, SAIFI, SAIDI)
 * dengan tingkat dasar 12 bulan terakhir, tren teredam, dan indeks musiman dari tahun yang lengkap. Rentang p10-p90 bulanan berasal dari rasio aktual/prakiraan pada uji mundur (origin bergulir, 1-3 bulan); rentang total 12 bulan menggabungkan galat bulanan sebagai saling bebas,
 * dan mutunya dibandingkan dengan pembanding sederhana "bulan yang sama tahun lalu". Selain itu perkiraan jumlah gangguan 12 bulan per penyulang dari laju historis (Poisson).
 * Ini prakiraan pola, bukan jaminan: peristiwa luar biasa (badai, pekerjaan besar) tidak bisa diprakirakan.
 */
class OutageForecastService
{
    private const METRICS = ['permanent' => 'Gangguan permanen', 'temporary' => 'Gangguan temporer', 'ens_kwh' => 'Energi tidak tersalur (kWh)', 'saifi' => 'SAIFI', 'saidi' => 'SAIDI (menit)'];

    private const PHI = 0.9;

    public function __construct(private readonly OutageAnalysisService $analysis) {}

    /** @return array<string,mixed> */
    public function forecast(array $units, bool $withUnassigned): array
    {
        $monthly = $this->analysis->analysis($units, $withUnassigned, null, null)['monthly'];
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        $notes = ['Prakiraan pola dari riwayat bulanan; peristiwa luar biasa tidak bisa diprakirakan. Rentang p10-p90 dari uji mundur 1-3 bulan.', 'SAIFI dan SAIDI memakai definisi dan ambang pada pengaturan sinkronisasi gangguan (batas atas; pelanggan terdampak = seluruh pelanggan penyulang).'];
        if (count($full) < 24) {
            return ['status' => 'INSUFFICIENT', 'message' => 'Riwayat belum cukup: butuh minimal 24 bulan lengkap ('.count($full).' tersedia).', 'history_months' => count($full), 'metrics' => [], 'feeders' => [], 'notes' => $notes];
        }
        $metrics = [];
        foreach (self::METRICS as $key => $label) {
            $metrics[] = ['key' => $key, 'label' => $label] + $this->series(array_column($full, $key), array_column($full, 'month'));
        }

        return ['status' => 'OK', 'history_months' => count($full), 'last_full_month' => end($full)['month'], 'seasonal_years' => $this->fullYears($full), 'metrics' => $metrics, 'feeders' => $this->feeders($units, $withUnassigned), 'notes' => $notes];
    }

    /** @param list<array<string,mixed>> $full @return int jumlah tahun lengkap */
    private function fullYears(array $full): int
    {
        $c = [];
        foreach ($full as $m) {
            $c[substr($m['month'], 0, 4)] = ($c[substr($m['month'], 0, 4)] ?? 0) + 1;
        }

        return count(array_filter($c, fn ($n) => $n === 12));
    }

    /**
     * @param  list<float|int>  $values
     * @param  list<string>  $months
     * @return array<string,mixed>
     */
    private function series(array $values, array $months): array
    {
        $n = count($values);
        $fc = $this->model($values, $months, 12);
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
            $f = $this->model(array_slice($values, 0, $o), array_slice($months, 0, $o), 3);
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
    private function model(array $values, array $months, int $h): array
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
            $damp += self::PHI ** $i;
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

    /** Perkiraan jumlah gangguan per penyulang 12 bulan ke depan dari laju historis (campuran 12 bulan terakhir dan 12 bulan sebelumnya). @return list<array<string,mixed>> */
    private function feeders(array $units, bool $withUnassigned): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $last = now($tz)->subMonthNoOverflow()->endOfMonth();
        $l12 = $last->copy()->subMonthsNoOverflow(11)->startOfMonth()->toDateString();
        $p12 = $last->copy()->subMonthsNoOverflow(23)->startOfMonth()->toDateString();
        $p12To = $last->copy()->subMonthsNoOverflow(12)->endOfMonth()->toDateString();
        $rows = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->where(fn ($w) => $w->whereIn('e.organizational_unit_id', $units)->when($withUnassigned, fn ($x) => $x->orWhereNull('e.organizational_unit_id')))
            ->selectRaw("e.feeder_id, count(*) filter (where (e.occurred_at at time zone ?)::date >= ?) as l12, count(*) filter (where (e.occurred_at at time zone ?)::date between ? and ?) as p12,
                count(*) filter (where (e.occurred_at at time zone ?)::date >= ? and e.outage_type = 'PERMANEN') as perm12", [$tz, $l12, $tz, $p12, $p12To, $tz, $l12])->groupBy('e.feeder_id')->havingRaw('count(*) filter (where (e.occurred_at at time zone ?)::date >= ?) > 0', [$tz, $p12])->get();
        $meta = DB::table('distribution_feeders')->whereIn('id', $rows->pluck('feeder_id'))->get(['id', 'name', 'gi_name'])->keyBy('id');
        $matrix = $this->analysis->customerMatrix();
        $out = [];
        foreach ($rows as $r) {
            $lam = 0.65 * $r->l12 + 0.35 * $r->p12;
            $spread = 1.2816 * sqrt(max($lam, 0.0001));
            $cust = array_sum(array_intersect_key($matrix[$r->feeder_id] ?? [], array_flip($units)));
            $out[] = ['feeder_id' => $r->feeder_id, 'name' => $meta[$r->feeder_id]->name ?? '-', 'gi_name' => $meta[$r->feeder_id]->gi_name ?? null, 'customers' => $cust, 'l12m_events' => (int) $r->l12, 'prev12m_events' => (int) $r->p12,
                'expected_12m' => round($lam, 1), 'p10' => round(max(0, $lam - $spread), 1), 'p90' => round($lam + $spread, 1), 'expected_permanent_12m' => round($r->l12 > 0 ? $lam * $r->perm12 / $r->l12 : 0, 1),
                'risk' => $lam >= 24 ? 'KRITIS' : ($lam >= 12 ? 'TINGGI' : ($lam >= 6 ? 'WASPADA' : 'AMAN'))];
        }
        usort($out, fn ($a, $b) => $b['expected_12m'] <=> $a['expected_12m']);

        return array_slice($out, 0, 40);
    }
}
