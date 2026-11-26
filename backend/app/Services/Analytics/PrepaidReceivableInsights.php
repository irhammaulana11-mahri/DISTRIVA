<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan Piutang Prabayar (docs/92 §6.4), dari laporan PIUTANGLPB_EIS (status BARU, BERJALAN, TUNGGAKAN per golongan tarif). Laporan ini tidak memuat umur, sehingga roll-rate seperti pascabayar tidak
 * mungkin; yang dikerjakan: komposisi dan pelunasan bulanan (definisi NKO), tunggakan beku (tunggakan yang tidak bergerak berbulan-bulan), pembagian per ULP dan golongan tarif, bulan yang tidak wajar
 * (piutang baru yang tiba-tiba nol atau melonjak), dan prakiraan tunggakan bulan depan dengan uji mundur.
 */
class PrepaidReceivableInsights
{
    private const HISTORY_MONTHS = 24;

    private const ANOMALY_WINDOW = 12;

    /** Tunggakan dianggap beku bila selisihnya terhadap bulan terakhir tidak lebih dari ini (persen). */
    public const FROZEN_TOLERANCE_PCT = 3.0;

    /** Piutang baru ditandai tidak wajar bila menyimpang paling sedikit sebesar ini (rasio) dari median dua belas bulan sebelum bulan itu, dan selisihnya paling sedikit `ANOMALY_MIN_RP`. */
    public const ANOMALY_RATIO = 0.75;

    public const ANOMALY_MIN_RP = 50_000_000;

    private const TOP = 8;

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to): array
    {
        $from = $this->shift($to, -(self::HISTORY_MONTHS - 1));
        $raw = $this->metrics->raw('piutang-prabayar', $units, $from, $to);
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        $monthly = [];
        foreach ($raw as $byMonth) {
            foreach ($byMonth as $m => $cell) {
                $x = &$monthly[$m];
                $x ??= ['baru' => 0.0, 'berjalan' => 0.0, 'tunggakan' => 0.0, 'lembar' => 0.0, 'units' => 0];
                $x['baru'] += $cell['bd']['Baru'] ?? 0;
                $x['berjalan'] += $cell['bd']['Berjalan'] ?? 0;
                $x['tunggakan'] += $cell['bd']['Tunggakan'] ?? 0;
                $x['lembar'] += $cell['raw']['lembar'] ?? 0;
                $x['units']++;
                unset($x);
            }
        }
        ksort($monthly);
        if (! isset($monthly[$to])) {
            $latest = array_key_last($monthly);
            if ($latest === null) {
                return ['kind' => 'prepaid_receivable', 'available' => false, 'reason' => 'Belum ada laporan piutang prabayar pada cakupan ini.'];
            }
            $to = $latest;
        }

        $rows = [];
        $prev = null;
        foreach ($monthly as $m => $x) {
            if ($m > $to) {
                break;
            }
            $total = $x['baru'] + $x['berjalan'] + $x['tunggakan'];
            $paid = $prev !== null && $prev['units'] === $x['units'] ? max(0.0, $prev['total'] - ($x['berjalan'] + $x['tunggakan'])) : null;
            $rows[] = ['month' => $m, 'baru' => round($x['baru']), 'berjalan' => round($x['berjalan']), 'tunggakan' => round($x['tunggakan']), 'total' => round($total), 'lembar' => (int) $x['lembar'], 'units' => $x['units'],
                'pelunasan' => $paid === null ? null : round($paid), 'effectiveness_pct' => $paid !== null && $prev['total'] > 0 ? round($paid / $prev['total'] * 100, 1) : null];
            $prev = ['total' => $total, 'units' => $x['units']];
        }

        return ['kind' => 'prepaid_receivable', 'available' => true, 'month' => $to, 'monthly' => $rows, 'frozen' => $this->frozen($monthly, $to), 'ulps' => $this->ulps($raw, $to, $names), 'tariffs' => $this->tariffs($units, $to),
            'anomalies' => $this->anomalies($monthly, $raw, $to, $names), 'forecast' => $this->forecast($monthly, $to),
            'notes' => ['Laporan piutang prabayar tidak memuat umur tunggakan, jadi roll-rate dan calon piutang ragu-ragu tidak dapat dihitung seperti pascabayar; yang ditampilkan adalah posisi, pelunasan, dan tunggakan yang tidak bergerak.',
                'Pelunasan memakai definisi NKO: (baru + berjalan + tunggakan bulan lalu) dikurangi (berjalan + tunggakan bulan ini), nilai negatif dihitung nol; hanya bila jumlah ULP kedua bulan sama.',
                'Tunggakan beku: selisih terhadap bulan terakhir tidak lebih dari '.self::FROZEN_TOLERANCE_PCT.'%; kandidat penagihan khusus atau usulan penghapusan, keputusan tetap di pengguna.',
                'Bulan tidak wajar: piutang baru menyimpang paling sedikit '.(int) (self::ANOMALY_RATIO * 100).'% dari median dua belas bulan sebelumnya (selisih minimal Rp '.number_format(self::ANOMALY_MIN_RP, 0, ',', '.').'); angka yang mendadak nol atau melonjak bisa berasal dari perubahan cakupan laporan, bukan kegiatan ULP.']];
    }

    /**
     * Tunggakan beku: jumlah bulan berturut-turut (mundur dari bulan terakhir) tunggakan gabungan berada dalam toleransi terhadap nilai bulan terakhir.
     *
     * @param  array<string, array<string, float|int>>  $monthly
     * @return array<string, mixed>
     */
    private function frozen(array $monthly, string $to): array
    {
        $last = $monthly[$to]['tunggakan'];
        $stable = 0;
        for ($i = 0; $i < self::HISTORY_MONTHS; $i++) {
            $m = $this->shift($to, -$i);
            if (! isset($monthly[$m]) || $last <= 0 || abs($monthly[$m]['tunggakan'] - $last) / $last * 100 > self::FROZEN_TOLERANCE_PCT) {
                break;
            }
            $stable++;
        }
        $total = $monthly[$to]['baru'] + $monthly[$to]['berjalan'] + $last;

        return ['arrears' => round($last), 'share_of_total_pct' => $total > 0 ? round($last / $total * 100, 1) : null, 'stable_months' => $stable, 'tolerance_pct' => self::FROZEN_TOLERANCE_PCT,
            'frozen' => $stable >= 3];
    }

    /** @return list<array<string, mixed>> */
    private function ulps(array $raw, string $to, $names): array
    {
        $prev6 = $this->shift($to, -6);
        $rows = [];
        foreach ($raw as $u => $byMonth) {
            if (! isset($byMonth[$to])) {
                continue;
            }
            $c = $byMonth[$to]['bd'];
            $total = ($c['Baru'] ?? 0) + ($c['Berjalan'] ?? 0) + ($c['Tunggakan'] ?? 0);
            $old = isset($byMonth[$prev6]) ? ($byMonth[$prev6]['bd']['Tunggakan'] ?? 0) : null;
            $rows[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'baru' => round($c['Baru'] ?? 0), 'berjalan' => round($c['Berjalan'] ?? 0), 'tunggakan' => round($c['Tunggakan'] ?? 0), 'total' => round($total), 'customers' => (int) $byMonth[$to]['raw']['lembar'],
                'arrears_change_6m_pct' => $old !== null && $old > 0 ? round((($c['Tunggakan'] ?? 0) - $old) / $old * 100, 1) : null];
        }
        usort($rows, fn ($a, $b) => $b['tunggakan'] <=> $a['tunggakan']);
        $sum = array_sum(array_column($rows, 'tunggakan'));

        return array_map(fn ($r) => $r + ['arrears_share_pct' => $sum > 0 ? round($r['tunggakan'] / $sum * 100, 1) : null], $rows);
    }

    /** @return list<array<string, mixed>> */
    private function tariffs(array $units, string $to): array
    {
        $rows = DB::table('eis_report_lines as l')->join('eis_report_files as f', 'f.id', '=', 'l.file_id')->where('f.family', 'PIUTANGLPB_EIS')->where('f.status', 'AKTIF')->where('f.period', $to.'-01')->whereIn('f.organizational_unit_id', $units)
            ->whereIn('l.label', ['BARU', 'BERJALAN', 'TUNGGAKAN'])->selectRaw("coalesce(l.values->>'tarif_lap', '-') as tarif, sum(case when l.label = 'TUNGGAKAN' then (l.values->>'rptag')::numeric else 0 end) as tunggakan,
                sum(case when l.label = 'BARU' then (l.values->>'rptag')::numeric else 0 end) as baru, sum(case when l.label = 'BERJALAN' then (l.values->>'rptag')::numeric else 0 end) as berjalan")->groupBy('tarif')->get()->sortByDesc('tunggakan')->take(self::TOP);
        $total = (float) $rows->sum('tunggakan');

        return $rows->map(fn ($r) => ['tariff' => $r->tarif, 'tunggakan' => round((float) $r->tunggakan), 'baru' => round((float) $r->baru), 'berjalan' => round((float) $r->berjalan),
            'arrears_share_pct' => $total > 0 ? round((float) $r->tunggakan / $total * 100, 1) : null])->values()->all();
    }

    /**
     * Bulan dalam jendela terakhir yang piutang barunya menyimpang jauh dari median dua belas bulan sebelum bulan itu (patokan bergulir, supaya peralihan rezim tetap terlihat), dengan ULP penyumbang terbesar.
     *
     * @return list<array<string, mixed>>
     */
    private function anomalies(array $monthly, array $raw, string $to, $names): array
    {
        $out = [];
        for ($i = 0; $i < self::ANOMALY_WINDOW; $i++) {
            $m = $this->shift($to, -$i);
            if (! isset($monthly[$m])) {
                continue;
            }
            $before = [];
            for ($k = 1; $k <= 12; $k++) {
                $p = $this->shift($m, -$k);
                isset($monthly[$p]) && $before[] = $monthly[$p]['baru'];
            }
            if (count($before) < 6) {
                continue;
            }
            sort($before);
            $n = count($before);
            $median = $n % 2 === 1 ? $before[intdiv($n, 2)] : ($before[$n / 2 - 1] + $before[$n / 2]) / 2;
            $v = $monthly[$m]['baru'];
            if ($median <= 0 || abs($v - $median) < self::ANOMALY_MIN_RP || abs($v - $median) / $median < self::ANOMALY_RATIO) {
                continue;
            }
            $driver = null;
            $best = -1.0;
            foreach ($raw as $u => $byMonth) {
                $x = $byMonth[$m]['bd']['Baru'] ?? null;
                if ($x !== null && $x > $best) {
                    $best = $x;
                    $driver = $u;
                }
            }
            $out[] = ['month' => $m, 'baru' => round($v), 'median_prev_12m' => round($median), 'direction' => $v > $median ? 'tinggi' : 'rendah', 'top_ulp' => $driver === null ? null : ['unit_id' => $driver, 'unit_name' => $names[$driver] ?? $driver, 'baru' => round($best)]];
        }
        usort($out, fn ($a, $b) => strcmp($b['month'], $a['month']));

        return $out;
    }

    /**
     * Prakiraan tunggakan bulan depan = nilai bulan terakhir (tunggakan hampir tidak bergerak); uji mundur terhadap rata-rata tiga bulan. Piutang baru tidak diprakirakan: terlalu tidak teratur.
     *
     * @return array<string, mixed>
     */
    private function forecast(array $monthly, string $to): array
    {
        $errors = ['naive' => [], 'mean3' => []];
        for ($i = 0; $i < 18; $i++) {
            $m = $this->shift($to, -$i);
            $p1 = $this->shift($m, -1);
            $p2 = $this->shift($m, -2);
            $p3 = $this->shift($m, -3);
            if (! isset($monthly[$m], $monthly[$p1], $monthly[$p2], $monthly[$p3]) || $monthly[$m]['tunggakan'] <= 0) {
                continue;
            }
            $actual = $monthly[$m]['tunggakan'];
            $errors['naive'][] = abs($monthly[$p1]['tunggakan'] - $actual) / $actual;
            $errors['mean3'][] = abs(($monthly[$p1]['tunggakan'] + $monthly[$p2]['tunggakan'] + $monthly[$p3]['tunggakan']) / 3 - $actual) / $actual;
        }
        $mape = fn (array $e): ?float => $e === [] ? null : round(array_sum($e) / count($e) * 100, 1);
        $backtest = ['months' => count($errors['naive']), 'naive_mape_pct' => $mape($errors['naive']), 'mean3_mape_pct' => $mape($errors['mean3'])];

        return ['available' => true, 'target' => 'tunggakan', 'month' => $this->shift($to, 1), 'method' => 'nilai_terakhir', 'arrears' => round($monthly[$to]['tunggakan']), 'backtest' => $backtest,
            'reliable' => $backtest['months'] >= 6 && $backtest['naive_mape_pct'] !== null && $backtest['naive_mape_pct'] <= 10.0];
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.($by >= 0 ? '+' : '').$by.' month'));
    }
}
