<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan piutang untuk menu Umur Tunggakan Pascabayar dan Pelunasan PRR/Ex PRR (docs/92 §6.4 dan §6.5).
 *
 * Roll-rate: laporan UMURPIUTANG hanya agregat per jumlah lembar tunggakan, jadi pelanggan yang sama tidak dapat dilacak antar bulan. Perkiraannya: setiap bulan semua pelanggan yang masih menunggak mendapat satu lembar
 * baru, sehingga kelas umur b bulan berikutnya terutama berisi kelas b-1 yang belum membayar ditambah kelas b yang masih tersisa. Laju kelas b = pelanggan kelas b bulan berikutnya / (pelanggan kelas b-1 + kelas b) bulan ini
 * (kelas pertama tidak punya pendahulu yang teramati, jadi dipakai tingkat rata-rata). Prakiraan dan uji mundurnya memakai definisi yang sama dan dasar jumlah pelanggan (`BASIS`).
 */
class ReceivableInsights
{
    /** Dasar roll-rate dan prakiraan: jumlah pelanggan menunggak. Rupiah dikuasai segelintir pelanggan besar (mis. dua pelanggan Rp 1,3 miliar pada kelas 7-12 bulan) dan uji mundurnya jauh lebih buruk dari cara naif (kesalahan 86% lawan 23%). */
    private const BASIS = 'plg';

    private const TRANSITIONS = 6;

    private const HISTORY_MONTHS = 12;

    private const BACKTEST_MONTHS = 12;

    /** Kelas "lebih dari 3 bulan" (indeks mulai 3): tunggakan yang menjadi calon piutang ragu-ragu. */
    private const OVER_THREE_FROM = 3;

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM); dipakai bulan terakhir ≤ `$to` yang punya laporan
     * @return array<string, mixed>
     */
    public function aging(array $units, string $to): array
    {
        $buckets = BusinessMetricService::AGE_BUCKETS;
        $from = date('Y-m', (int) strtotime($to.'-01 -'.(self::HISTORY_MONTHS + self::BACKTEST_MONTHS + self::TRANSITIONS + 13).' month'));
        $data = $this->agingData($units, $from, $to);
        $months = array_keys($data);
        sort($months);
        $asOf = $months === [] ? null : end($months);
        if ($asOf === null) {
            return ['kind' => 'receivable_aging', 'available' => false, 'reason' => 'Belum ada laporan umur tunggakan (UMURPIUTANG) pada cakupan ini.'];
        }
        $vector = fn (string $m, ?array $only = null): array => $this->vector($data, $only ?? $units, $m);
        $now = $vector($asOf);
        $yearAgo = $vector($this->shift($asOf, -12));
        $totalRp = array_sum($now['rp']);

        $snapshot = [];
        foreach ($buckets as $b => $label) {
            $snapshot[] = ['key' => $label, 'rp' => $now['rp'][$b], 'plg' => $now['plg'][$b], 'share_pct' => $totalRp > 0 ? round($now['rp'][$b] / $totalRp * 100, 2) : null,
                'same_month_last_year' => array_sum($yearAgo['rp']) > 0 ? $yearAgo['rp'][$b] : null, 'yoy_pct' => $yearAgo['rp'][$b] > 0 ? round(($now['rp'][$b] / $yearAgo['rp'][$b] - 1) * 100, 1) : null];
        }
        $over = fn (array $v): float => array_sum(array_slice($v['rp'], self::OVER_THREE_FROM));

        $history = [];
        for ($i = self::HISTORY_MONTHS - 1; $i >= 0; $i--) {
            $m = $this->shift($asOf, -$i);
            $t = $this->transition($data, $units, $this->shift($m, -1), $m);
            $v = $vector($m);
            $history[] = ['month' => $m, 'rp_total' => array_sum($v['rp']) ?: null, 'rp_over_3_months' => array_sum($v['rp']) > 0 ? $over($v) : null, 'over_3_pct' => array_sum($v['rp']) > 0 ? round($over($v) / array_sum($v['rp']) * 100, 2) : null,
                'rates' => $t === null ? null : array_map(fn ($r) => $r === null ? null : round($r, 4), $t['rate_'.self::BASIS])];
        }

        $rates = $this->averageRates($data, $units, $asOf);
        $forecast = $this->forecast($now, $rates, $data, $units, $asOf);
        $nowOver = $over($now);

        $perUnit = [];
        if (count($units) > 1) {
            $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');
            foreach ($units as $u) {
                $v = $vector($asOf, [$u]);
                $total = array_sum($v['rp']);
                $total > 0 && $perUnit[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? null, 'rp_total' => $total, 'rp_over_3_months' => $over($v), 'over_3_pct' => round($over($v) / $total * 100, 2),
                    'over_3_yoy_pct' => ($y = $over($vector($this->shift($asOf, -12), [$u]))) > 0 ? round(($over($v) / $y - 1) * 100, 1) : null];
            }
            usort($perUnit, fn ($a, $b) => $b['over_3_pct'] <=> $a['over_3_pct']);
        }

        return ['kind' => 'receivable_aging', 'available' => true, 'as_of_month' => $asOf, 'target_month' => $this->shift($asOf, 1), 'buckets' => $buckets, 'rp_total' => $totalRp, 'plg_total' => array_sum($now['plg']),
            'rp_over_3_months' => $nowOver, 'over_3_pct' => $totalRp > 0 ? round($nowOver / $totalRp * 100, 2) : null, 'snapshot' => $snapshot, 'history' => $history,
            'rates' => ['basis' => self::BASIS, 'transitions_averaged' => $rates['n'], 'rows' => array_map(fn ($b) => ['key' => $buckets[$b], 'from' => $b === 0 ? null : $buckets[$b - 1], 'rate' => $rates['avg'][$b] === null ? null : round($rates['avg'][$b], 4), 'rate_last' => ($history[count($history) - 1]['rates'][$b] ?? null),
                'kind' => $b === 0 ? 'level' : 'roll'], array_keys($buckets))],
            'forecast' => $forecast + ['over_3_change_pct' => ($nowOverBasis = array_sum(array_slice($now[self::BASIS], self::OVER_THREE_FROM))) > 0 && $forecast['available'] ? round(($forecast['over_3_months'] / $nowOverBasis - 1) * 100, 1) : null],
            'units' => $perUnit,
            'notes' => ['Roll-rate diperkirakan dari agregat (pelanggan sama tidak dilacak antar bulan): kelas b = pelanggan kelas b bulan berikutnya dibagi (kelas b-1 + kelas b) bulan ini; kelas pertama memakai tingkat rata-rata. Pelanggan yang tunggakannya lama biasanya sudah diputus sehingga tidak mendapat lembar baru; laju kelas tua lebih tepat dibaca sebagai persistensi.',
                'Roll-rate dan prakiraan memakai jumlah pelanggan menunggak (bukan rupiah, yang dikuasai segelintir pelanggan besar); laju rata-rata '.self::TRANSITIONS.' bulan terakhir; akurasinya (MAPE uji mundur '.self::BACKTEST_MONTHS.' bulan) dibandingkan dengan cara naif (nilai bulan ini).']];
    }

    /**
     * Pelunasan PRR atau Ex PRR menurut umur BLTH (selisih bulan bayar dan bulan tagihan) untuk tahun berjalan sampai bulan `$to`.
     *
     * @param  list<string>  $units
     * @return array<string, mixed>
     */
    public function repayment(string $family, array $units, string $to): array
    {
        $year = substr($to, 0, 4);
        $files = DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)->whereBetween('period', ["{$year}-01-01", $to.'-01'])->get(['id', 'period']);
        $rows = DB::table('eis_report_lines')->whereIn('file_id', $files->pluck('id'))->get(['file_id', 'label', 'values']);
        $periods = $files->pluck('period', 'id');
        $labels = ['0 sampai 3 bulan', '4 sampai 6 bulan', '7 sampai 12 bulan', '13 sampai 24 bulan', 'lebih dari 24 bulan'];
        $rp = array_fill_keys($labels, 0.0);
        $byMonth = [];
        $paidByMonth = [];
        $paidByYear = [];
        foreach ($rows as $r) {
            if (preg_match('/^(\d{4})(\d{2})$/', (string) $r->label, $m) !== 1) {
                continue;
            }
            $paid = substr((string) $periods[$r->file_id], 0, 7);
            $age = ((int) substr($paid, 0, 4) - (int) $m[1]) * 12 + (int) substr($paid, 5, 2) - (int) $m[2];
            $value = (float) (json_decode((string) $r->values, true)['rp_prr'] ?? 0);
            $bucket = $labels[match (true) {
                $age <= 3 => 0,
                $age <= 6 => 1,
                $age <= 12 => 2,
                $age <= 24 => 3,
                default => 4,
            }];
            $rp[$bucket] += $value;
            $byMonth[$paid][$bucket] = ($byMonth[$paid][$bucket] ?? 0.0) + $value;
            $paidByMonth[$paid] = ($paidByMonth[$paid] ?? 0.0) + $value;
            $paidByYear[$m[1]] = ($paidByYear[$m[1]] ?? 0.0) + $value;
        }
        $total = array_sum($rp);
        ksort($byMonth);

        return ['kind' => 'repayment_age', 'available' => $files->isNotEmpty(), 'period' => ['from' => "{$year}-01", 'to' => $to], 'files' => $files->count(), 'rp_total' => $total,
            'rows' => array_map(fn ($k, $v) => ['key' => $k, 'rp' => $v, 'share_pct' => $total > 0 ? round($v / $total * 100, 2) : null], array_keys($rp), $rp),
            'monthly' => array_map(fn ($m, $v) => ['month' => $m] + array_map(fn ($b) => $v[$b] ?? 0.0, array_combine($labels, $labels)), array_keys($byMonth), $byMonth),
            'recovery' => $family === 'PRR' ? $this->recovery($units, $to, $paidByMonth, $paidByYear, $files->groupBy('period')->map->count()->all()) : null,
            'notes' => ['Umur = selisih bulan bayar dan bulan tagihan (BLTH) yang dilunasi, dari laporan pelunasan AP2T menurut tanggal bayar; bulan berjalan hanya sampai tanggal penarikan.',
                $family === 'PRR' ? 'Tingkat pemulihan memakai saldo PRR dari laporan Daftar PRR AP2T (`recovery`).' : 'Saldo Ex PRR belum tersedia di DISTRIVA, sehingga tingkat pemulihan Ex PRR belum dihitung.']];
    }

    /**
     * Tingkat pemulihan PRR dari saldo laporan Daftar PRR (potret saldo per bulan) dan pelunasan bulan itu: pemulihan bulan = pelunasan bulan itu / saldo akhir bulan sebelumnya. Bulan hanya dihitung bila
     * semua ULP pada cakupan punya laporan saldo dan laporan pelunasan; bulan berjalan ditandai `partial` (pelunasan baru sampai tanggal penarikan).
     *
     * @param  list<string>  $units
     * @param  array<string, float>  $paidByMonth  bulan bayar (YYYY-MM) => Rp pelunasan
     * @param  array<string, float>  $paidByYear  tahun tagihan => Rp pelunasan tahun berjalan
     * @param  array<string, int>  $paymentFiles  periode (YYYY-MM-DD) => jumlah berkas pelunasan
     * @return array<string, mixed>
     */
    private function recovery(array $units, string $to, array $paidByMonth, array $paidByYear, array $paymentFiles): array
    {
        $year = (int) substr($to, 0, 4);
        $rows = DB::table('eis_report_files')->where('family', 'DAFTAR_PRR')->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)->whereBetween('period', [($year - 1).'-12-01', $to.'-01'])
            ->get(['id', 'period', 'organizational_unit_id', 'summary']);
        $saldo = [];
        foreach ($rows->groupBy(fn ($f) => substr((string) $f->period, 0, 7)) as $month => $group) {
            if ($group->pluck('organizational_unit_id')->unique()->count() === count($units)) {
                $saldo[$month] = ['rp' => (float) $group->sum(fn ($f) => (json_decode((string) $f->summary, true)['rp_prr'] ?? 0)), 'customers' => (int) $group->sum(fn ($f) => (json_decode((string) $f->summary, true)['pelanggan'] ?? 0)),
                    'ids' => $group->pluck('id')->all()];
            }
        }
        ksort($saldo);
        if ($saldo === []) {
            return ['available' => false, 'reason' => 'Laporan Daftar PRR (saldo) belum ditarik untuk cakupan ini. Tarik lewat sinkron AP2T, jenis "saldo_prr".'];
        }
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $current = now($tz)->format('Y-m');
        $monthly = [];
        foreach ($saldo as $month => $s) {
            $prev = date('Y-m', (int) strtotime($month.'-01 -1 month'));
            $paidComplete = ($paymentFiles[$month.'-01'] ?? 0) === count($units);
            $row = ['month' => $month, 'saldo_rp' => $s['rp'], 'customers' => $s['customers'], 'opening_rp' => $saldo[$prev]['rp'] ?? null, 'repaid_rp' => $paidComplete ? ($paidByMonth[$month] ?? 0.0) : null, 'partial' => $month === $current];
            $row['recovery_pct'] = $row['opening_rp'] !== null && $row['opening_rp'] > 0 && $row['repaid_rp'] !== null ? round($row['repaid_rp'] / $row['opening_rp'] * 100, 2) : null;
            $monthly[] = $row;
        }
        $latest = array_key_last($saldo);
        $byYear = [];
        foreach (DB::table('eis_report_lines')->whereIn('file_id', $saldo[$latest]['ids'])->get(['label', 'values']) as $l) {
            $v = json_decode((string) $l->values, true);
            $byYear[$l->label]['rp'] = ($byYear[$l->label]['rp'] ?? 0.0) + (float) ($v['rp_prr'] ?? 0);
            $byYear[$l->label]['baris'] = ($byYear[$l->label]['baris'] ?? 0) + (int) ($v['baris'] ?? 0);
        }
        ksort($byYear);
        $ytd = null;
        $open = $saldo[($year - 1).'-12']['rp'] ?? null;
        if ($open !== null && $open > 0 && (int) substr($latest, 0, 4) === $year) {
            $paid = 0.0;
            for ($m = 1; $m <= (int) substr($latest, 5, 2); $m++) {
                $paid += $paidByMonth[sprintf('%04d-%02d', $year, $m)] ?? 0.0;
            }
            $ytd = ['opening_rp' => $open, 'repaid_rp' => $paid, 'recovery_pct' => round($paid / $open * 100, 2)];
        }

        return ['available' => true, 'latest_month' => $latest, 'saldo_rp' => $saldo[$latest]['rp'], 'customers' => $saldo[$latest]['customers'], 'monthly' => $monthly, 'ytd' => $ytd,
            'by_billing_year' => array_map(fn ($y, $v) => ['year' => (int) $y, 'saldo_rp' => $v['rp'], 'rows' => $v['baris'], 'share_pct' => $saldo[$latest]['rp'] > 0 ? round($v['rp'] / $saldo[$latest]['rp'] * 100, 2) : null, 'repaid_ytd_rp' => $paidByYear[$y] ?? 0.0], array_keys($byYear), $byYear),
            'notes' => ['Saldo = jumlah kolom RP PRR laporan Daftar PRR AP2T (potret per bulan; bulan berjalan berubah tiap hari). Pemulihan bulan = pelunasan bulan itu dibagi saldo akhir bulan sebelumnya; saldo yang bertambah karena PRR baru tidak dikeluarkan.',
                'Bulan tanpa saldo bulan sebelumnya atau tanpa laporan pelunasan lengkap tidak dihitung (nilai null). `ytd` (pelunasan Januari sampai bulan saldo terakhir dibagi saldo Desember tahun lalu) hanya ada bila saldo Desember itu sudah ditarik.']];
    }

    /**
     * Rupiah dan pelanggan per kelas umur per ULP per bulan.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{rp: list<float>, plg: list<float>}>> bulan => unit => vektor
     */
    private function agingData(array $units, string $from, string $to): array
    {
        $rows = DB::table('eis_report_lines as l')->join('eis_report_files as f', 'f.id', '=', 'l.file_id')->where('f.family', 'UMURPIUTANG')->where('f.status', 'AKTIF')->whereIn('f.organizational_unit_id', $units)
            ->whereBetween('f.period', [$from.'-01', $to.'-01'])->selectRaw("f.organizational_unit_id as u, to_char(f.period, 'YYYY-MM') as m, l.label, sum(coalesce((l.values->>'gabungan')::numeric, 0)) as rp, sum(coalesce((l.values->>'plg')::numeric, 0)) as plg")
            ->groupBy('f.organizational_unit_id', 'm', 'l.label')->get();
        $out = [];
        foreach ($rows as $r) {
            $n = (int) $r->label;
            if ($n < 1) {
                continue;
            }
            $b = match (true) {
                $n <= 3 => $n - 1,
                $n <= 6 => 3,
                $n <= 12 => 4,
                default => 5,
            };
            $out[$r->m][$r->u] ??= ['rp' => array_fill(0, 6, 0.0), 'plg' => array_fill(0, 6, 0.0)];
            $out[$r->m][$r->u]['rp'][$b] += (float) $r->rp;
            $out[$r->m][$r->u]['plg'][$b] += (float) $r->plg;
        }

        return $out;
    }

    /**
     * @param  array<string, array<string, array{rp: list<float>, plg: list<float>}>>  $data
     * @param  list<string>  $units
     * @return array{rp: list<float>, plg: list<float>}
     */
    private function vector(array $data, array $units, string $month): array
    {
        $out = ['rp' => array_fill(0, 6, 0.0), 'plg' => array_fill(0, 6, 0.0)];
        foreach ($units as $u) {
            foreach (['rp', 'plg'] as $k) {
                foreach ($data[$month][$u][$k] ?? [] as $b => $v) {
                    $out[$k][$b] += $v;
                }
            }
        }

        return $out;
    }

    /**
     * Laju dari bulan `$a` ke bulan berikutnya `$b`, hanya atas ULP yang punya laporan kedua bulan; null bila tidak ada ULP setara.
     *
     * @return array{rate_rp: list<?float>, rate_plg: list<?float>}|null
     */
    private function transition(array $data, array $units, string $a, string $b): ?array
    {
        $common = array_values(array_filter($units, fn ($u) => isset($data[$a][$u], $data[$b][$u])));
        if ($common === []) {
            return null;
        }
        $va = $this->vector($data, $common, $a);
        $vb = $this->vector($data, $common, $b);
        $rates = ['rate_rp' => [], 'rate_plg' => []];
        foreach (['rate_rp' => 'rp', 'rate_plg' => 'plg'] as $out => $k) {
            for ($i = 0; $i < 6; $i++) {
                $den = $i === 0 ? 0.0 : $va[$k][$i - 1] + $va[$k][$i];
                $rates[$out][$i] = $i === 0 ? $vb[$k][0] : ($den > 0 ? $vb[$k][$i] / $den : null);                  // kelas pertama: tingkat (rupiah atau pelanggan), bukan laju
            }
        }

        return $rates;
    }

    /**
     * Rata-rata laju dari paling banyak enam transisi terakhir yang berakhir pada bulan `$asOf`.
     *
     * @return array{avg: list<?float>, n: int}
     */
    private function averageRates(array $data, array $units, string $asOf): array
    {
        $sum = array_fill(0, 6, 0.0);
        $cnt = array_fill(0, 6, 0);
        $n = 0;
        for ($i = 0; $i < self::TRANSITIONS; $i++) {
            $end = $this->shift($asOf, -$i);
            $t = $this->transition($data, $units, $this->shift($end, -1), $end);
            if ($t === null) {
                continue;
            }
            $n++;
            foreach ($t['rate_'.self::BASIS] as $b => $r) {
                $r !== null && [$sum[$b], $cnt[$b]] = [$sum[$b] + $r, $cnt[$b] + 1];
            }
        }

        return ['avg' => array_map(fn ($s, $c) => $c > 0 ? $s / $c : null, $sum, $cnt), 'n' => $n];
    }

    /**
     * @param  array{rp: list<float>, plg: list<float>}  $now
     * @param  array{avg: list<?float>, n: int}  $rates
     * @return array<string, mixed>
     */
    private function forecast(array $now, array $rates, array $data, array $units, string $asOf): array
    {
        $predict = function (array $rp, array $avg): ?array {
            $out = [];
            for ($b = 0; $b < 6; $b++) {
                if ($avg[$b] === null) {
                    return null;
                }
                $out[$b] = $b === 0 ? $avg[0] : $avg[$b] * ($rp[$b - 1] + $rp[$b]);
            }

            return $out;
        };
        $pred = $predict($now[self::BASIS], $rates['avg']);
        if ($pred === null) {
            return ['available' => false, 'reason' => 'Riwayat transisi belum cukup untuk menghitung laju.'];
        }

        $apeModel = ['total' => [], 'over' => []];
        $apeNaive = ['total' => [], 'over' => []];
        for ($i = self::BACKTEST_MONTHS - 1; $i >= 0; $i--) {
            $t = $this->shift($asOf, -$i);
            $before = $this->shift($t, -1);
            $common = array_values(array_filter($units, fn ($u) => isset($data[$before][$u], $data[$t][$u])));
            $avg = $this->averageRates($data, $common, $before)['avg'];
            if ($common === [] || ($p = $predict($this->vector($data, $common, $before)[self::BASIS], $avg)) === null) {
                continue;
            }
            $prev = $this->vector($data, $common, $before)[self::BASIS];
            $actual = $this->vector($data, $common, $t)[self::BASIS];
            foreach (['total' => [0, 6], 'over' => [self::OVER_THREE_FROM, 3]] as $k => [$offset, $len]) {
                $a = array_sum(array_slice($actual, $offset, $len));
                if ($a > 0) {
                    $apeModel[$k][] = abs(array_sum(array_slice($p, $offset, $len)) - $a) / $a * 100;
                    $apeNaive[$k][] = abs(array_sum(array_slice($prev, $offset, $len)) - $a) / $a * 100;
                }
            }
        }
        $mape = fn (array $v) => $v === [] ? null : round(array_sum($v) / count($v), 2);

        $backtest = ['months' => count($apeModel['total']), 'total_mape_pct' => $mape($apeModel['total']), 'total_naive_mape_pct' => $mape($apeNaive['total']), 'over_3_mape_pct' => $mape($apeModel['over']), 'over_3_naive_mape_pct' => $mape($apeNaive['over'])];
        $reliable = $backtest['months'] >= 6 && $backtest['over_3_mape_pct'] !== null && $backtest['over_3_mape_pct'] < $backtest['over_3_naive_mape_pct'] && $backtest['total_mape_pct'] < $backtest['total_naive_mape_pct'];

        return ['available' => true, 'basis' => self::BASIS, 'unit' => 'pelanggan', 'month' => $this->shift($asOf, 1), 'by_bucket' => array_map(fn ($b, $label) => ['key' => $label, 'value' => round($pred[$b], 0)], array_keys(BusinessMetricService::AGE_BUCKETS), BusinessMetricService::AGE_BUCKETS),
            'total' => round(array_sum($pred), 0), 'over_3_months' => round(array_sum(array_slice($pred, self::OVER_THREE_FROM)), 0), 'reliable' => $reliable, 'backtest' => $backtest,
            'reliability_note' => $reliable ? 'Uji mundur lebih baik dari cara naif.' : 'Uji mundur kurang dari 6 bulan atau tidak lebih baik dari cara naif: tampilkan hanya sebagai petunjuk atau sembunyikan.'];
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.sprintf('%+d', $by).' month'));
    }
}
