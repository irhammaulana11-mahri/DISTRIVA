<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan HPL biaya penyambungan (docs/92 §6.11), dari permohonan PB/PD (`applications`): porsi PB lawan PD, pemisahan kasus standar dan kasus besar (Rp per bulan didominasi sedikit kasus besar
 * yang tidak dapat diprakirakan), lama dari permohonan dibuat sampai lunas, antrean permohonan disetujui yang belum lunas menurut umur dengan peluang bayar historisnya, dan prakiraan bulan
 * depan (bagian standar rata-rata tiga bulan ditambah median kasus besar) beserta uji mundurnya. Tanggal permohonan dari `source_created_at` (hari); `submitted_at` tidak terisi.
 */
class ConnectionFeeInsights
{
    /** Permohonan dengan biaya sebesar ini atau lebih adalah kasus besar. */
    public const BIG_CASE_RP = 20_000_000;

    /** Permohonan disetujui yang belum lunas lebih dari ini hari tidak dianggap antrean hidup: historis hampir semua yang membayar melakukannya dalam waktu ini. */
    public const LIVE_QUEUE_DAYS = 30;

    private const HISTORY_MONTHS = 12;

    private const TRAIN_MONTHS = 36;

    private const AGES = [0, 1, 3, 7, 14];

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $from = date('Y-m-01', (int) strtotime($to.'-01 -'.(self::TRAIN_MONTHS - 1).' month'));
        $end = date('Y-m-d', (int) strtotime($to.'-01 +1 month'));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $units)->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(paid_at at time zone ?) >= ?', [$tz, $from])->whereRaw('(paid_at at time zone ?) < ?', [$tz, $end])
            ->selectRaw("to_char(paid_at at time zone ?, 'YYYY-MM') as m, count(*) as n, coalesce(sum(total_cost), 0) as rp, count(*) filter (where application_type = 'PB') as n_pb, coalesce(sum(total_cost) filter (where application_type = 'PB'), 0) as rp_pb,
                count(*) filter (where total_cost >= ?) as n_big, coalesce(sum(total_cost) filter (where total_cost >= ?), 0) as rp_big", [$tz, self::BIG_CASE_RP, self::BIG_CASE_RP])->groupBy('m')->orderBy('m')->get()->keyBy('m');

        $monthly = [];
        foreach ($rows as $m => $r) {
            $monthly[$m] = ['month' => $m, 'n' => (int) $r->n, 'rp' => (float) $r->rp, 'n_pb' => (int) $r->n_pb, 'rp_pb' => (float) $r->rp_pb, 'n_big' => (int) $r->n_big, 'rp_big' => (float) $r->rp_big, 'rp_standard' => (float) $r->rp - (float) $r->rp_big];
        }
        $history = [];
        for ($i = self::HISTORY_MONTHS - 1; $i >= 0; $i--) {
            $m = $this->shift($to, -$i);
            if (isset($monthly[$m])) {
                $x = $monthly[$m];
                $history[] = ['month' => $m, 'n' => $x['n'], 'rp' => round($x['rp']), 'rp_standard' => round($x['rp_standard']), 'rp_big' => round($x['rp_big']), 'n_big' => $x['n_big'], 'big_share_pct' => $x['rp'] > 0 ? round($x['rp_big'] / $x['rp'] * 100, 1) : null,
                    'pb_share_pct' => $x['rp'] > 0 ? round($x['rp_pb'] / $x['rp'] * 100, 1) : null, 'avg_rp' => $x['n'] > 0 ? round($x['rp'] / $x['n']) : null];
            }
        }

        return ['kind' => 'connection_fee', 'month' => $to, 'partial' => $to === now($tz)->format('Y-m'), 'big_case_rp' => self::BIG_CASE_RP, 'history' => $history, 'month_detail' => $this->monthDetail($units, $to, $tz),
            'lag' => $this->lag($units, $to, $tz), 'queue' => $this->queue($units, $tz), 'forecast' => $this->forecast($monthly, $to),
            'notes' => [
                'Rp bulanan didominasi sedikit kasus besar (biaya '.number_format(self::BIG_CASE_RP, 0, ',', '.').' atau lebih): angka bulanan melonjak karena satu atau dua permohonan, bukan karena kegiatan ULP berubah. Bacalah bagian standar dan jumlah permohonan untuk kecenderungan.',
                'Antrean dihitung dari status saat ini (potret), tanpa riwayat: peluang bayar menurut umur diturunkan dari permohonan lampau dan hanya perkiraan kasar karena tanggal batal tidak tersimpan.',
                'Prakiraan bulan depan diuji mundur terhadap cara naif; kasus besar tidak diprakirakan, hanya diberi nilai tengah dan rentang.']];
    }

    /** @return array<string, mixed> */
    private function monthDetail(array $units, string $to, string $tz): array
    {
        $start = $to.'-01';
        $end = date('Y-m-d', (int) strtotime($start.' +1 month'));
        $base = fn () => DB::table('applications as a')->leftJoin('organizational_units as o', 'o.id', '=', 'a.organizational_unit_id')->whereIn('a.organizational_unit_id', $units)->whereNotNull('a.paid_at')
            ->whereNotIn('a.current_status', ['CANCELLED', 'REFUNDED'])->whereRaw('(a.paid_at at time zone ?) >= ?', [$tz, $start])->whereRaw('(a.paid_at at time zone ?) < ?', [$tz, $end]);
        $total = (float) $base()->sum('a.total_cost');
        $top = $base()->orderByDesc('a.total_cost')->limit(10)->get(['a.application_number', 'a.application_type', 'a.total_cost', 'o.name as unit_name', 'a.paid_at']);
        $ulps = $base()->groupBy('a.organizational_unit_id', 'o.name')->selectRaw('a.organizational_unit_id as unit_id, o.name as unit_name, count(*) as n, coalesce(sum(a.total_cost), 0) as rp, coalesce(sum(a.total_cost) filter (where a.total_cost >= ?), 0) as rp_big', [self::BIG_CASE_RP])
            ->orderByDesc('rp')->get();
        $topSum = (float) $top->sum('total_cost');

        return ['rp' => round($total), 'top10_share_pct' => $total > 0 ? round($topSum / $total * 100, 1) : null,
            'top' => $top->map(fn ($r) => ['application_number' => $r->application_number, 'type' => $r->application_type, 'rp' => round((float) $r->total_cost), 'unit_name' => $r->unit_name, 'paid_at' => substr((string) $r->paid_at, 0, 10)])->all(),
            'ulps' => $ulps->map(fn ($r) => ['unit_id' => $r->unit_id, 'unit_name' => $r->unit_name, 'n' => (int) $r->n, 'rp' => round((float) $r->rp), 'rp_big' => round((float) $r->rp_big), 'rp_standard' => round((float) $r->rp - (float) $r->rp_big),
                'avg_rp' => $r->n > 0 ? round((float) $r->rp / $r->n) : null, 'share_pct' => $total > 0 ? round((float) $r->rp / $total * 100, 1) : null])->all()];
    }

    /** @return array<string, mixed> */
    private function lag(array $units, string $to, string $tz): array
    {
        $start = date('Y-m-d', (int) strtotime($to.'-01 -'.(self::HISTORY_MONTHS - 1).' month'));
        $end = date('Y-m-d', (int) strtotime($to.'-01 +1 month'));
        $r = DB::table('applications')->whereIn('organizational_unit_id', $units)->whereNotNull('paid_at')->whereNotNull('source_created_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(paid_at at time zone ?) >= ?', [$tz, $start])->whereRaw('(paid_at at time zone ?) < ?', [$tz, $end])->whereRaw('paid_at::date >= (source_created_at at time zone ?)::date', [$tz])
            ->selectRaw('count(*) as n, percentile_cont(0.5) within group (order by paid_at::date - (source_created_at at time zone ?)::date) as med, percentile_cont(0.9) within group (order by paid_at::date - (source_created_at at time zone ?)::date) as p90', [$tz, $tz])->first();

        return ['basis' => 'dibuat_sampai_lunas', 'n' => (int) $r->n, 'median_days' => $r->med === null ? null : round((float) $r->med, 1), 'p90_days' => $r->p90 === null ? null : round((float) $r->p90, 1)];
    }

    /**
     * Antrean permohonan disetujui yang belum lunas menurut umur sejak dibuat, dan peluang bayar menurut umur dari permohonan lampau (yang sudah cukup lama untuk selesai).
     *
     * @return array<string, mixed>
     */
    private function queue(array $units, string $tz): array
    {
        $today = now($tz)->toDateString();
        $aged = DB::table('applications')->whereIn('organizational_unit_id', $units)->where('current_status', 'APPROVED')->whereNull('paid_at')->whereNotNull('source_created_at')
            ->selectRaw('total_cost, (?::date - (source_created_at at time zone ?)::date) as age', [$today, $tz]);
        $open = DB::query()->fromSub($aged, 'q')
            ->selectRaw('count(*) filter (where age <= 7) as n7, coalesce(sum(total_cost) filter (where age <= 7), 0) as rp7, count(*) filter (where age > 7 and age <= ?) as n30, coalesce(sum(total_cost) filter (where age > 7 and age <= ?), 0) as rp30,
                count(*) filter (where age > ?) as nold, coalesce(sum(total_cost) filter (where age > ?), 0) as rpold', [self::LIVE_QUEUE_DAYS, self::LIVE_QUEUE_DAYS, self::LIVE_QUEUE_DAYS, self::LIVE_QUEUE_DAYS])->first();

        $matured = date('Y-m-d', (int) strtotime($today.' -'.(self::LIVE_QUEUE_DAYS + 5).' day'));
        $since = date('Y-m-d', (int) strtotime($matured.' -365 day'));
        $odds = [];
        foreach (self::AGES as $age) {
            $r = DB::table('applications')->whereIn('organizational_unit_id', $units)->whereNotNull('source_created_at')->whereBetween(DB::raw('(source_created_at at time zone \''.$tz.'\')::date'), [$since, $matured])
                ->selectRaw('count(*) filter (where paid_at is not null and (paid_at at time zone ?)::date - (source_created_at at time zone ?)::date > ?) as later, count(*) filter (where paid_at is null) as never', [$tz, $tz, $age])->first();
            $denominator = (int) $r->later + (int) $r->never;
            $odds[] = ['age_days' => $age, 'pay_probability_pct' => $denominator > 0 ? round((int) $r->later / $denominator * 100, 1) : null, 'sample' => $denominator];
        }

        return ['as_of' => $today, 'live_days' => self::LIVE_QUEUE_DAYS, 'buckets' => [['key' => '0-7', 'n' => (int) $open->n7, 'rp' => round((float) $open->rp7)], ['key' => '8-'.self::LIVE_QUEUE_DAYS, 'n' => (int) $open->n30, 'rp' => round((float) $open->rp30)],
            ['key' => '>'.self::LIVE_QUEUE_DAYS, 'n' => (int) $open->nold, 'rp' => round((float) $open->rpold), 'stale' => true]], 'odds_by_age' => $odds];
    }

    /**
     * Prakiraan bulan sesudah `$to`: bagian standar (rata-rata tiga bulan) + kasus besar (median 12 bulan, rentang kuartil). Uji mundur pada bulan-bulan sebelumnya melawan cara naif dan rata-rata tiga bulan total.
     *
     * @param  array<string, array<string, mixed>>  $monthly
     * @return array<string, mixed>
     */
    private function forecast(array $monthly, string $to): array
    {
        $months = array_keys($monthly);
        $predict = function (string $until) use ($monthly): ?array {
            $prev = [];
            for ($i = 0; $i < self::TRAIN_MONTHS; $i++) {
                $m = $this->shift($until, -$i);
                isset($monthly[$m]) && $prev[] = $monthly[$m];
            }
            if (count($prev) < 6) {
                return null;
            }
            $std = array_sum(array_column(array_slice($prev, 0, 3), 'rp_standard')) / 3;
            $big = array_column(array_slice($prev, 0, 12), 'rp_big');
            sort($big);
            $q = fn (float $p) => $big[(int) round($p * (count($big) - 1))];

            return ['standard' => $std, 'big_median' => (float) $q(0.5), 'big_low' => (float) $q(0.25), 'big_high' => (float) $q(0.75), 'mean3' => array_sum(array_column(array_slice($prev, 0, 3), 'rp')) / 3, 'last' => $prev[0]['rp']];
        };
        $errors = ['model' => [], 'naive' => [], 'mean3' => []];
        foreach ($months as $m) {
            $before = $this->shift($m, -1);
            $p = $predict($before);
            if ($p === null || ! isset($monthly[$before]) || $monthly[$m]['rp'] <= 0 || $m > $to) {
                continue;
            }
            $errors['model'][] = abs($p['standard'] + $p['big_median'] - $monthly[$m]['rp']) / $monthly[$m]['rp'];
            $errors['naive'][] = abs($p['last'] - $monthly[$m]['rp']) / $monthly[$m]['rp'];
            $errors['mean3'][] = abs($p['mean3'] - $monthly[$m]['rp']) / $monthly[$m]['rp'];
        }
        $mape = fn (array $e): ?float => $e === [] ? null : round(array_sum($e) / count($e) * 100, 1);
        $backtest = ['months' => count($errors['model']), 'model_mape_pct' => $mape($errors['model']), 'naive_mape_pct' => $mape($errors['naive']), 'mean3_mape_pct' => $mape($errors['mean3'])];
        $partial = $to === now((string) config('distriva.business_timezone', 'Asia/Jakarta'))->format('Y-m');
        $base = $partial ? $this->shift($to, -1) : $to;
        $p = $predict($base);
        if ($p === null) {
            return ['available' => false, 'reason' => 'Riwayat kurang dari enam bulan.', 'backtest' => $backtest];
        }

        return ['available' => true, 'method' => 'standar_rata3_plus_median_besar', 'month' => $this->shift($base, 1), 'based_on' => $base, 'standard' => round($p['standard']), 'big_median' => round($p['big_median']), 'big_low' => round($p['big_low']), 'big_high' => round($p['big_high']),
            'expected' => round($p['standard'] + $p['big_median']), 'low' => round($p['standard'] + $p['big_low']), 'high' => round($p['standard'] + $p['big_high']), 'backtest' => $backtest,
            'reliable' => $backtest['months'] >= 6 && $backtest['model_mape_pct'] !== null && $backtest['model_mape_pct'] < min($backtest['naive_mape_pct'] ?? INF, $backtest['mean3_mape_pct'] ?? INF)];
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.($by >= 0 ? '+' : '').$by.' month'));
    }
}
