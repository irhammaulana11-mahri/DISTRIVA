<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan menu Pelanggan dan Daya (docs/92 §6.1), melengkapi pendamping permohonan yang sudah ada: rekonsiliasi bulanan PB tersambung terhadap selisih laporan 309 (sisanya = pelanggan berhenti
 * dan koreksi), lama dari bayar sampai sambung, antrean PB (hidup dan kedaluwarsa), proyeksi akhir bulan berjalan dari laju sambung dengan uji mundur, penambahan menurut kecamatan dan gardu (tanggal
 * nyala DIL), gardu yang tumbuh cepat dengan beban tinggi, dan perubahan daya (PD) menurut golongan. Prakiraan "antrean x laju konversi" untuk 3 sampai 6 bulan tidak dibuat: 97% PB tersambung
 * dalam 30 hari sesudah bayar (median 1 hari), antrean hanya menjelaskan beberapa hari, dan modelnya tidak lebih baik daripada laju berjalan pada uji mundur.
 */
class CustomerInsights
{
    private const MONTHS = 12;

    private const LIVE_DAYS = 30;

    private const TOP = 15;

    private const GROUPS = ['R' => 'Rumah tangga', 'B' => 'Bisnis', 'I' => 'Industri', 'S' => 'Sosial', 'P' => 'Pemerintah', 'T' => 'Traksi', 'C' => 'Curah', 'L' => 'Layanan khusus'];

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(string $code, array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $partial = $to === now($tz)->format('Y-m');
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        return ['kind' => 'customer_growth', 'focus' => $code, 'month' => $to, 'partial' => $partial, 'reconciliation' => $this->reconciliation($code, $units, $to, $tz), 'lead_time' => $this->leadTime($units, $to, $tz, $names),
            'queue' => $this->queue($units, $tz, $names), 'month_projection' => $partial ? $this->projection($units, $tz) : null, 'areas' => $this->areas($units, $to), 'gardu' => $this->garduGrowth($units, $to),
            'power_changes' => $this->powerChanges($units, $to, $tz),
            'notes' => ['Rekonsiliasi: PB tersambung (tanggal PEREMAJAAN, `completed_at`) lawan selisih bulanan laporan 309; selisihnya adalah pelanggan berhenti, dibongkar, atau koreksi data, bukan angka resmi.',
                'Antrean dan lama sambung memakai tanggal bayar; PB sangat cepat tersambung (median satu hari), sehingga antrean hanya menjelaskan beberapa hari ke depan dan tidak dipakai untuk prakiraan bulanan. Permohonan dalam usulan penambahan jaringan dipisah: menunggu pekerjaan jaringan, bukan terlambat.',
                'Penambahan menurut kecamatan dan gardu dari tanggal nyala DIL pelanggan aktif; periode `period.to` dibatasi sampai akhir bulan potret DIL terakhir; data bangunan statis tidak menambah daya prediksi sehingga tidak dipakai (docs/92 §8.3).']];
    }

    /** @return list<array<string, mixed>> */
    private function reconciliation(string $code, array $units, string $to, string $tz): array
    {
        $daya = $code === 'daya';
        $from = date('Y-m', (int) strtotime($to.'-01 -'.self::MONTHS.' month'));
        $raw = $this->metrics->raw($code, $units, $from, $to);
        $official = [];
        foreach ($raw as $byMonth) {
            foreach ($byMonth as $m => $cell) {
                $prev = date('Y-m', (int) strtotime($m.'-01 -1 month'));
                if (isset($byMonth[$prev])) {
                    $official[$m] = ($official[$m] ?? 0.0) + ($daya ? ($cell['raw']['daya_va'] - $byMonth[$prev]['raw']['daya_va']) / 1000 : $cell['raw']['pelanggan'] - $byMonth[$prev]['raw']['pelanggan']);
                }
            }
        }
        $start = date('Y-m-01', (int) strtotime($to.'-01 -'.(self::MONTHS - 1).' month'));
        $end = date('Y-m-d', (int) strtotime($to.'-01 +1 month'));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $units)->whereIn('application_type', ['PB', 'PD'])->whereNotNull('completed_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(completed_at at time zone ?) >= ?', [$tz, $start])->whereRaw('(completed_at at time zone ?) < ?', [$tz, $end])
            ->selectRaw("to_char(completed_at at time zone ?, 'YYYY-MM') as m, count(*) filter (where application_type = 'PB') as pb, coalesce(sum(delta_power_kva) filter (where application_type = 'PB'), 0) as pb_kva,
                coalesce(sum(delta_power_kva) filter (where application_type = 'PD'), 0) as pd_kva", [$tz])->groupBy('m')->get()->keyBy('m');
        $out = [];
        for ($t = strtotime($start); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
            $m = date('Y-m', $t);
            $r = $rows[$m] ?? null;
            $companion = $r === null ? 0.0 : ($daya ? (float) $r->pb_kva + (float) $r->pd_kva : (float) $r->pb);
            $off = $official[$m] ?? null;
            $out[] = ['month' => $m, 'official' => $off === null ? null : round($off, $daya ? 1 : 0), 'official_unit' => $daya ? 'kVA' : 'pelanggan', 'connected' => round($companion, $daya ? 1 : 0), 'pb_connected' => $r === null ? 0 : (int) $r->pb,
                'residual' => $off === null ? null : round($companion - $off, $daya ? 1 : 0), 'residual_label' => $daya ? 'Selisih permohonan terhadap 309 (penurunan daya, bongkar, koreksi, atau tambahan di luar permohonan)' : 'Pelanggan berhenti, bongkar, dan koreksi'];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function leadTime(array $units, string $to, string $tz, $names): array
    {
        $start = date('Y-m-01', (int) strtotime($to.'-01 -'.(self::MONTHS - 1).' month'));
        $end = date('Y-m-d', (int) strtotime($to.'-01 +1 month'));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $units)->where('application_type', 'PB')->whereNotNull('completed_at')->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(completed_at at time zone ?) >= ?', [$tz, $start])->whereRaw('(completed_at at time zone ?) < ?', [$tz, $end])->whereRaw('(completed_at at time zone ?)::date >= paid_at', [$tz])
            ->selectRaw('organizational_unit_id as u, count(*) as n, percentile_cont(0.5) within group (order by (completed_at at time zone ?)::date - paid_at) as med, percentile_cont(0.9) within group (order by (completed_at at time zone ?)::date - paid_at) as p90,
                avg(((completed_at at time zone ?)::date - paid_at <= ?)::int) as within30', [$tz, $tz, $tz, self::LIVE_DAYS])->groupBy('organizational_unit_id')->get();
        $all = DB::table('applications')->whereIn('organizational_unit_id', $units)->where('application_type', 'PB')->whereNotNull('completed_at')->whereNotNull('paid_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(completed_at at time zone ?) >= ?', [$tz, $start])->whereRaw('(completed_at at time zone ?) < ?', [$tz, $end])->whereRaw('(completed_at at time zone ?)::date >= paid_at', [$tz])
            ->selectRaw('count(*) as n, percentile_cont(0.5) within group (order by (completed_at at time zone ?)::date - paid_at) as med, percentile_cont(0.9) within group (order by (completed_at at time zone ?)::date - paid_at) as p90,
                avg(((completed_at at time zone ?)::date - paid_at <= ?)::int) as within30', [$tz, $tz, $tz, self::LIVE_DAYS])->first();

        return ['basis' => 'bayar_sampai_sambung', 'months' => self::MONTHS, 'n' => (int) $all->n, 'median_days' => $all->med === null ? null : round((float) $all->med, 1), 'p90_days' => $all->p90 === null ? null : round((float) $all->p90, 1),
            'within_30_days_pct' => $all->within30 === null ? null : round((float) $all->within30 * 100, 1),
            'ulps' => $rows->map(fn ($r) => ['unit_id' => $r->u, 'unit_name' => $names[$r->u] ?? $r->u, 'n' => (int) $r->n, 'median_days' => round((float) $r->med, 1), 'p90_days' => round((float) $r->p90, 1), 'within_30_days_pct' => round((float) $r->within30 * 100, 1)])
                ->sortByDesc('p90_days')->values()->all()];
    }

    /**
     * Antrean PB hari ini (potret): sudah bayar, belum tersambung, bukan batal. Hidup = bayar 30 hari terakhir; kedaluwarsa = lebih lama (hampir pasti tidak akan tersambung); dalam usulan jaringan dipisah.
     *
     * @return array<string, mixed>
     */
    private function queue(array $units, string $tz, $names): array
    {
        $today = now($tz)->toDateString();
        $base = DB::table('applications as a')->whereIn('a.organizational_unit_id', $units)->where('a.application_type', 'PB')->whereNotNull('a.paid_at')->whereNull('a.completed_at')->whereNotIn('a.current_status', ['CANCELLED', 'REFUNDED'])
            ->selectRaw('a.organizational_unit_id as u, a.current_status as s, (?::date - a.paid_at) as age, exists (select 1 from proposal_applications pa where pa.application_id = a.id and pa.released_at is null) as in_proposal', [$today]);
        $rows = DB::query()->fromSub($base, 'q')->selectRaw('u, count(*) filter (where not in_proposal and age <= 7) as live7, count(*) filter (where not in_proposal and age > 7 and age <= ?) as live30, count(*) filter (where not in_proposal and age > ?) as stale,
            count(*) filter (where in_proposal) as proposal', [self::LIVE_DAYS, self::LIVE_DAYS])->groupBy('u')->get();
        $byStatus = DB::query()->fromSub($base, 'q')->where('in_proposal', false)->where('age', '<=', self::LIVE_DAYS)->selectRaw('s, count(*) as n')->groupBy('s')->pluck('n', 's');
        $sum = fn (string $k) => (int) $rows->sum($k);

        return ['as_of' => $today, 'live_days' => self::LIVE_DAYS, 'live_0_7' => $sum('live7'), 'live_8_30' => $sum('live30'), 'stale' => $sum('stale'), 'in_network_proposal' => $sum('proposal'),
            'live_by_status' => $byStatus->map(fn ($n) => (int) $n)->all(), 'ulps' => $rows->map(fn ($r) => ['unit_id' => $r->u, 'unit_name' => $names[$r->u] ?? $r->u, 'live' => (int) $r->live7 + (int) $r->live30, 'stale' => (int) $r->stale, 'in_network_proposal' => (int) $r->proposal])
                ->sortByDesc('stale')->values()->all()];
    }

    /**
     * Proyeksi akhir bulan berjalan dari laju sambung PB sampai hari ini, dengan uji mundur pada tanggal yang sama di bulan-bulan lengkap sebelumnya (dibanding memakai angka bulan lalu).
     *
     * @return array<string, mixed>
     */
    private function projection(array $units, string $tz): array
    {
        $now = now($tz);
        $day = (int) $now->format('j');
        $days = (int) $now->format('t');
        $start = $now->copy()->startOfMonth()->subMonths(24)->toDateString();
        $daily = DB::table('applications')->whereIn('organizational_unit_id', $units)->where('application_type', 'PB')->whereNotNull('completed_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(completed_at at time zone ?)::date >= ?', [$tz, $start])->selectRaw("to_char(completed_at at time zone ?, 'YYYY-MM-DD') as d, count(*) as n", [$tz])->groupBy('d')->pluck('n', 'd');
        $monthTotal = [];
        $upToDay = [];
        foreach ($daily as $d => $n) {
            $m = substr($d, 0, 7);
            $monthTotal[$m] = ($monthTotal[$m] ?? 0) + $n;
            (int) substr($d, 8, 2) <= $day && $upToDay[$m] = ($upToDay[$m] ?? 0) + $n;
        }
        $current = $now->format('Y-m');
        $errors = ['runrate' => [], 'last_month' => []];
        foreach ($monthTotal as $m => $actual) {
            $prev = date('Y-m', (int) strtotime($m.'-01 -1 month'));
            if ($m >= $current || ! isset($monthTotal[$prev]) || $actual <= 0 || ! isset($upToDay[$m]) || $m < date('Y-m', (int) strtotime($current.'-01 -18 month'))) {
                continue;
            }
            $dim = (int) date('t', (int) strtotime($m.'-01'));
            $errors['runrate'][] = abs($upToDay[$m] / $day * $dim - $actual) / $actual;
            $errors['last_month'][] = abs($monthTotal[$prev] - $actual) / $actual;
        }
        $mape = fn (array $e): ?float => $e === [] ? null : round(array_sum($e) / count($e) * 100, 1);
        $soFar = (int) ($upToDay[$current] ?? 0);

        return ['month' => $current, 'day' => $day, 'days_in_month' => $days, 'connected_so_far' => $soFar, 'projected' => $day > 0 ? round($soFar / $day * $days) : null, 'last_month' => $monthTotal[date('Y-m', (int) strtotime($current.'-01 -1 month'))] ?? null,
            'method' => 'laju_berjalan', 'backtest' => ['months' => count($errors['runrate']), 'runrate_mape_pct' => $mape($errors['runrate']), 'last_month_mape_pct' => $mape($errors['last_month'])],
            'note' => 'Proyeksi = sambungan sampai hari ini dibagi hari berjalan dikali hari dalam bulan; tanggal awal bulan kurang andal (lihat uji mundur pada tanggal yang sama).'];
    }

    /** Akhir bulan potret DIL terakhir (tanggal nyala setelah itu belum terekam), atau null bila belum ada potret. */
    private function snapshotEnd(): ?string
    {
        $snapshot = DB::table('customer_connections')->max('snapshot_month');

        return $snapshot === null ? null : date('Y-m-t', (int) strtotime(substr((string) $snapshot, 0, 4).'-'.substr((string) $snapshot, 4, 2).'-01'));
    }

    /** @return array<string, mixed> */
    private function areas(array $units, string $to): array
    {
        $year = (int) substr($to, 0, 4);
        $end = date('Y-m-t', (int) strtotime($to.'-01'));
        $snapshotEnd = $this->snapshotEnd();
        $snapshotEnd !== null && $end > $snapshotEnd && $end = $snapshotEnd;
        $prevEnd = date('Y-m-d', (int) strtotime($end.' -1 year'));
        $rows = DB::table('customer_connections')->whereIn('organizational_unit_id', $units)->where('status', 'AKTIF')->whereNotNull('kecamatan')->selectRaw('kecamatan, count(*) as now, count(*) filter (where energized_on between ? and ?) as added,
            count(*) filter (where energized_on between ? and ?) as prev', [$year.'-01-01', $end, ($year - 1).'-01-01', $prevEnd])->groupBy('kecamatan')->orderByRaw('count(*) filter (where energized_on between ? and ?) desc', [$year.'-01-01', $end])->limit(self::TOP)->get();
        $total = (int) DB::table('customer_connections')->whereIn('organizational_unit_id', $units)->where('status', 'AKTIF')->whereBetween('energized_on', [$year.'-01-01', $end])->count();

        return ['period' => ['from' => $year.'-01-01', 'to' => $end], 'added_total' => $total, 'rows' => $rows->map(fn ($r) => ['kecamatan' => $r->kecamatan, 'customers' => (int) $r->now, 'added' => (int) $r->added, 'added_prev_year' => (int) $r->prev,
            'change_pct' => (int) $r->prev > 0 ? round(((int) $r->added - (int) $r->prev) / (int) $r->prev * 100, 1) : null, 'share_pct' => $total > 0 ? round((int) $r->added / $total * 100, 1) : null])->all()];
    }

    /** @return array<string, mixed> */
    private function garduGrowth(array $units, string $to): array
    {
        $year = (int) substr($to, 0, 4);
        $end = date('Y-m-t', (int) strtotime($to.'-01'));
        $snapshotEnd = $this->snapshotEnd();
        $snapshotEnd !== null && $end > $snapshotEnd && $end = $snapshotEnd;
        $readingFrom = date('Y-m-01', (int) strtotime($to.'-01 -14 month'));
        $placeholders = implode(',', array_fill(0, count($units), '?'));
        $rows = DB::select("with growth as (select substation_id, count(*) as added from customer_connections where status = 'AKTIF' and substation_id is not null and energized_on between ? and ? and organizational_unit_id in ({$placeholders}) group by substation_id order by added desc limit ".self::TOP.'),
            last as (select distinct on (substation_id) substation_id, measured_on, loading_pct, coalesce(capacity_kva, null) as cap from substation_readings where measured_on between ? and ? order by substation_id, measured_on desc)
            select s.id, s.code, s.name, s.feeder_code, s.kecamatan, o.name as unit_name, g.added, coalesce(l.cap, s.capacity_kva) as cap, l.loading_pct, l.measured_on,
            (select count(*) from customer_connections c where c.substation_id = s.id and c.status = \'AKTIF\') as customers from growth g join substations s on s.id = g.substation_id join organizational_units o on o.id = s.organizational_unit_id left join last l on l.substation_id = s.id',
            [$year.'-01-01', $end, ...array_values($units), $readingFrom, $end]);
        $high = TechnicalLossProxy::HIGH_LOAD_PCT;

        return ['period' => ['from' => $year.'-01-01', 'to' => $end], 'high_load_pct' => $high, 'rows' => array_map(fn ($r) => ['substation_id' => $r->id, 'code' => $r->code, 'name' => $r->name, 'feeder_code' => $r->feeder_code, 'kecamatan' => $r->kecamatan, 'unit_name' => $r->unit_name,
            'added' => (int) $r->added, 'customers' => (int) $r->customers, 'capacity_kva' => $r->cap === null ? null : round((float) $r->cap, 1), 'loading_pct' => $r->loading_pct === null ? null : round((float) $r->loading_pct, 1), 'measured_on' => $r->measured_on,
            'capacity_watch' => $r->loading_pct !== null && (float) $r->loading_pct >= $high], $rows)];
    }

    /** @return array<string, mixed> */
    private function powerChanges(array $units, string $to, string $tz): array
    {
        $year = (int) substr($to, 0, 4);
        $end = date('Y-m-d', (int) strtotime($to.'-01 +1 month'));
        $rows = DB::table('applications')->whereIn('organizational_unit_id', $units)->where('application_type', 'PD')->whereNotNull('completed_at')->whereNotIn('current_status', ['CANCELLED', 'REFUNDED'])
            ->whereRaw('(completed_at at time zone ?) >= ?', [$tz, $year.'-01-01'])->whereRaw('(completed_at at time zone ?) < ?', [$tz, $end])->selectRaw("upper(left(coalesce(new_tariff_code, '-'), 1)) as g, count(*) as n,
                count(*) filter (where delta_power_kva > 0) as up, count(*) filter (where delta_power_kva < 0) as down, count(*) filter (where delta_power_kva = 0) as same, coalesce(sum(delta_power_kva), 0) as kva, coalesce(sum(delta_power_kva) filter (where delta_power_kva > 0), 0) as kva_up")->groupBy('g')->get();
        $n = (int) $rows->sum('n');

        return ['period' => ['from' => $year.'-01-01', 'to' => date('Y-m-d', (int) strtotime($end.' -1 day'))], 'total' => $n, 'net_kva' => round((float) $rows->sum('kva'), 1), 'increase_kva' => round((float) $rows->sum('kva_up'), 1),
            'groups' => $rows->sortByDesc('n')->map(fn ($r) => ['group' => $r->g, 'group_name' => self::GROUPS[$r->g] ?? 'Lainnya', 'count' => (int) $r->n, 'share_pct' => $n > 0 ? round((int) $r->n / $n * 100, 1) : null, 'up' => (int) $r->up, 'down' => (int) $r->down,
                'same' => (int) $r->same, 'net_kva' => round((float) $r->kva, 1), 'increase_kva' => round((float) $r->kva_up, 1)])->values()->all()];
    }
}
