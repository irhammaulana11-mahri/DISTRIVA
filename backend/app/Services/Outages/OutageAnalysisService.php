<?php

namespace App\Services\Outages;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Analisis gangguan penyulang dan recloser (docs/87): tren bulanan dan tahunan (permanen, temporer, ENS, SAIFI, SAIDI), penyebab, cuaca, jam, ULP, penyulang, dan gardu pada penyulang.
 *
 * Definisi (keputusan pemilik): pelanggan terdampak satu gangguan = seluruh pelanggan aktif penyulang (DIL, tertaut gardu) di unit yang dilihat; SAIFI = jumlah (pelanggan terdampak) / pelanggan aktif unit,
 * SAIDI = jumlah (pelanggan terdampak x menit padam) / pelanggan aktif unit. Gangguan lebih singkat dari ambang (bawaan 5 menit) tidak ikut, dan bisa dibatasi pada gangguan permanen. Karena sheet tidak
 * mencatat pelanggan padam, angka ini batas atas (gangguan recloser hanya memadamkan sebagian penyulang) dan jumlah pelanggan penyulang memakai potret DIL terakhir untuk semua bulan.
 */
class OutageAnalysisService
{
    private function tz(): string
    {
        return (string) config('distriva.business_timezone', 'Asia/Jakarta');
    }

    /**
     * @param  list<string>  $units  ULP dalam cakupan/filter
     * @param  bool  $withUnassigned  ikut menghitung peristiwa tanpa ULP (hanya akun tanpa batas unit dan tanpa filter unit)
     * @return array<string,mixed>
     */
    public function analysis(array $units, bool $withUnassigned, ?string $from, ?string $to): array
    {
        $tz = $this->tz();
        $set = DB::table('outage_sync_settings')->where('id', 1)->first();
        $min = (int) $set->saidi_min_minutes;
        $onlyPerm = (bool) $set->saidi_only_permanent;
        $events = fn () => $this->scoped(DB::table('outage_events as e')->whereNull('e.source_removed_at'), $units, $withUnassigned, $from, $to);
        $bymonth = $events()->selectRaw("to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, count(*) filter (where e.outage_type = 'TEMPORER') as temp,
            coalesce(sum(e.duration_minutes), 0) as minutes, coalesce(sum(e.ens_kwh), 0) as ens", [$tz])->groupBy('m')->orderBy('m')->get()->keyBy('m');
        $matrix = $this->customerMatrix();
        $base = $this->baseCustomers($units, $withUnassigned);
        $rel = $this->reliabilityByMonth($units, $from, $to, $min, $onlyPerm, $matrix, $base);
        $nowM = now($tz)->format('Y-m');
        $monthly = [];
        foreach ($this->span(array_values(array_unique(array_merge($bymonth->keys()->all(), array_keys($rel))))) as $m) {
            $r = $bymonth[$m] ?? null;
            $monthly[] = ['month' => $m, 'partial' => $m === $nowM, 'events' => (int) ($r->n ?? 0), 'permanent' => (int) ($r->perm ?? 0), 'temporary' => (int) ($r->temp ?? 0), 'minutes' => round((float) ($r->minutes ?? 0), 1),
                'ens_kwh' => round((float) ($r->ens ?? 0), 1), 'saifi' => round($rel[$m]['saifi'] ?? 0, 4), 'saidi' => round($rel[$m]['saidi'] ?? 0, 3)];
        }

        return [
            'filters' => ['from' => $from, 'to' => $to, 'units' => count($units)],
            'as_of' => now($tz)->toDateString(),
            'settings' => ['saidi_min_minutes' => $min, 'saidi_only_permanent' => $onlyPerm],
            'base_customers' => $base,
            'coverage' => $this->coverage($units, $withUnassigned),
            'kpi' => $this->kpi($monthly),
            'monthly' => $monthly,
            'yearly' => $this->yearly($monthly),
            'by_cause' => $this->breakdown($events(), 'e.category', 'Tanpa kategori'),
            'by_weather' => $this->breakdown($events(), 'e.weather', 'Tanpa cuaca', 8),
            'by_device' => $this->breakdown($events(), 'e.device_group', 'Lainnya'),
            'by_hour' => $this->hours($events()),
            'by_unit' => $this->byUnit($units, $withUnassigned, $from, $to, $min, $onlyPerm, $matrix),
            'by_feeder' => $this->byFeeder($units, $withUnassigned, $from, $to, $min, $onlyPerm, $matrix, $base),
            'notes' => [
                'Peristiwa berasal dari sheet gangguan penyulang dan recloser yang disinkronkan; baris yang hilang dari sheet tidak dihitung.',
                'SAIFI dan SAIDI memakai seluruh pelanggan aktif penyulang sebagai pelanggan terdampak (batas atas, terutama untuk recloser) dengan jumlah pelanggan dari potret DIL terakhir; hanya gangguan sepanjang minimal '.$min.' menit'.($onlyPerm ? ' dan hanya permanen' : '').' yang dihitung.',
                'SAIFI/SAIDI sebuah ULP memakai semua gangguan pada penyulang yang melayani pelanggannya; jumlah gangguan dan ENS per ULP menurut RAYON di sheet.',
                'ENS dibaca apa adanya dari sheet (kWh). Bulan berjalan belum lengkap dan tidak dipakai dalam pertumbuhan.',
            ],
        ];
    }

    /**
     * Angka bulanan per ULP dari data gangguan tersinkron untuk menjelaskan angka resmi Laporan DIFI (docs/91): pembilang SAIFI dan SAIDI berbobot pelanggan dasar (potret DIL) ULP itu,
     * ENS dan jumlah gangguan menurut ULP peristiwa (RAYON). Aturan sama dengan analysis(): hanya gangguan sepanjang ambang menit (dan permanen bila diatur) yang masuk SAIFI/SAIDI.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{base: float, saifi_x_base: float, saidi_x_base: float, ens_kwh: float, n: float}>> unit => bulan (YYYY-MM) => angka
     */
    public function monthlyByUnit(array $units, string $fromMonth, string $toMonth): array
    {
        $tz = $this->tz();
        $set = DB::table('outage_sync_settings')->where('id', 1)->first();
        $min = (int) $set->saidi_min_minutes;
        $onlyPerm = (bool) $set->saidi_only_permanent;
        $from = $fromMonth.'-01';
        $to = date('Y-m-d', strtotime($toMonth.'-01 +1 month -1 day'));
        $matrix = $this->customerMatrix();
        $out = [];
        $months = [];
        for ($m = $fromMonth; $m <= $toMonth; $m = date('Y-m', strtotime($m.'-01 +1 month'))) {
            $months[] = $m;
        }
        foreach ($units as $u) {
            $base = $this->baseCustomers([$u], false);
            if ($base <= 0) {
                continue;
            }
            foreach ($months as $m) {
                $out[$u][$m] = ['base' => (float) $base, 'saifi_x_base' => 0.0, 'saidi_x_base' => 0.0, 'ens_kwh' => 0.0, 'n' => 0.0];
            }
        }
        $q = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->whereNotNull('e.duration_minutes')->where('e.duration_minutes', '>=', $min);
        $onlyPerm && $q->where('e.outage_type', 'PERMANEN');
        $this->range($q, $from, $to);
        foreach ($q->selectRaw("e.feeder_id, to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, sum(e.duration_minutes) as minutes", [$tz])->groupBy('e.feeder_id', 'm')->get() as $r) {
            foreach ($units as $u) {
                $c = $this->customersOf($matrix, $r->feeder_id, [$u]);
                if ($c > 0 && isset($out[$u][$r->m])) {
                    $out[$u][$r->m]['saifi_x_base'] += $c * (float) $r->n;
                    $out[$u][$r->m]['saidi_x_base'] += $c * (float) $r->minutes;
                }
            }
        }
        $all = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereIn('e.organizational_unit_id', $units);
        $this->range($all, $from, $to);
        foreach ($all->selectRaw("e.organizational_unit_id as u, to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, coalesce(sum(e.ens_kwh), 0) as ens", [$tz])->groupBy('u', 'm')->get() as $r) {
            $out[$r->u][$r->m] ??= ['base' => 0.0, 'saifi_x_base' => 0.0, 'saidi_x_base' => 0.0, 'ens_kwh' => 0.0, 'n' => 0.0];
            $out[$r->u][$r->m]['n'] = (float) $r->n;
            $out[$r->u][$r->m]['ens_kwh'] = (float) $r->ens;
        }

        return $out;
    }

    /** @param Builder $q */
    private function scoped($q, array $units, bool $withUnassigned, ?string $from, ?string $to)
    {
        $q->where(fn ($w) => $w->whereIn('e.organizational_unit_id', $units)->when($withUnassigned, fn ($x) => $x->orWhereNull('e.organizational_unit_id')));
        $this->range($q, $from, $to);

        return $q;
    }

    private function range($q, ?string $from, ?string $to): void
    {
        $tz = $this->tz();
        $from !== null && $q->whereRaw('(e.occurred_at at time zone ?)::date >= ?', [$tz, $from]);
        $to !== null && $q->whereRaw('(e.occurred_at at time zone ?)::date <= ?', [$tz, $to]);
    }

    /** Pelanggan aktif per penyulang per ULP (potret DIL), disimpan sebentar karena menghitung 1,4 juta baris. @return array<string,array<string,int>> */
    public function customerMatrix(): array
    {
        return Cache::remember('outage:feeder-customers', 600, function () {
            $m = [];
            foreach (DB::table('customer_connections as c')->join('substations as s', 's.id', '=', 'c.substation_id')->where('c.status', 'AKTIF')->whereNotNull('s.feeder_id')->selectRaw('s.feeder_id, c.organizational_unit_id as u, count(*) as n')->groupBy('s.feeder_id', 'c.organizational_unit_id')->get() as $r) {
                $m[$r->feeder_id][$r->u] = (int) $r->n;
            }

            return $m;
        });
    }

    private function baseCustomers(array $units, bool $withUnassigned): int
    {
        $per = Cache::remember('outage:unit-customers', 600, fn () => DB::table('customer_connections')->where('status', 'AKTIF')->selectRaw('organizational_unit_id as u, count(*) as n')->groupBy('organizational_unit_id')->pluck('n', 'u')->all());
        $sum = 0;
        foreach ($units as $u) {
            $sum += (int) ($per[$u] ?? 0);
        }

        return $sum;
    }

    /** @param array<string,array<string,int>> $matrix @return array<string,int> */
    private function customersOf(array $matrix, string $feeder, array $units): int
    {
        return array_sum(array_intersect_key($matrix[$feeder] ?? [], array_flip($units)));
    }

    /**
     * SAIFI/SAIDI per bulan: gangguan pada penyulang yang melayani pelanggan unit (apa pun RAYON-nya), lebih lama dari ambang.
     *
     * @param  array<string,array<string,int>>  $matrix
     * @return array<string,array{saifi:float,saidi:float}>
     */
    private function reliabilityByMonth(array $units, ?string $from, ?string $to, int $min, bool $onlyPerm, array $matrix, int $base): array
    {
        if ($base <= 0) {
            return [];
        }
        $q = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->whereNotNull('e.duration_minutes')->where('e.duration_minutes', '>=', $min);
        $onlyPerm && $q->where('e.outage_type', 'PERMANEN');
        $this->range($q, $from, $to);
        $out = [];
        foreach ($q->selectRaw("e.feeder_id, to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, sum(e.duration_minutes) as minutes", [$this->tz()])->groupBy('e.feeder_id', 'm')->get() as $r) {
            $c = $this->customersOf($matrix, $r->feeder_id, $units);
            if ($c === 0) {
                continue;
            }
            $out[$r->m]['saifi'] = ($out[$r->m]['saifi'] ?? 0) + $c * (int) $r->n / $base;
            $out[$r->m]['saidi'] = ($out[$r->m]['saidi'] ?? 0) + $c * (float) $r->minutes / $base;
        }

        return $out;
    }

    /** @return array<string,mixed> */
    private function coverage(array $units, bool $withUnassigned): array
    {
        $q = fn () => $this->scoped(DB::table('outage_events as e')->whereNull('e.source_removed_at'), $units, $withUnassigned, null, null);
        $r = $q()->selectRaw('count(*) as n, min(e.occurred_at) as first_at, max(e.occurred_at) as last_at, count(*) filter (where e.feeder_id is null) as unmatched, count(*) filter (where e.duration_minutes is null) as no_duration, count(*) filter (where e.outage_type is null) as no_type')->first();

        return ['events' => (int) $r->n, 'first_at' => $r->first_at, 'last_at' => $r->last_at, 'unmatched_feeder_events' => (int) $r->unmatched, 'without_duration' => (int) $r->no_duration, 'without_type' => (int) $r->no_type];
    }

    /** @param list<string> $present @return list<string> */
    private function span(array $present): array
    {
        if ($present === []) {
            return [];
        }
        sort($present);
        $out = [];
        for ($d = new \DateTimeImmutable($present[0].'-01'), $end = new \DateTimeImmutable(end($present).'-01'); $d <= $end; $d = $d->modify('+1 month')) {
            $out[] = $d->format('Y-m');
        }

        return $out;
    }

    /** @param list<array<string,mixed>> $monthly @return array<string,mixed> */
    private function kpi(array $monthly): array
    {
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        if ($full === []) {
            return ['last_full_month' => null, 'l12m' => null, 'prev12m' => null];
        }
        $win = fn (array $set) => ['events' => array_sum(array_column($set, 'events')), 'permanent' => array_sum(array_column($set, 'permanent')), 'temporary' => array_sum(array_column($set, 'temporary')),
            'minutes' => round(array_sum(array_column($set, 'minutes')), 1), 'ens_kwh' => round(array_sum(array_column($set, 'ens_kwh')), 1), 'saifi' => round(array_sum(array_column($set, 'saifi')), 3), 'saidi' => round(array_sum(array_column($set, 'saidi')), 2)];
        $l12 = array_slice($full, -12);
        $p12 = count($full) >= 24 ? array_slice($full, -24, 12) : [];
        $a = $win($l12);
        $b = $p12 === [] ? null : $win($p12);
        $pct = fn ($x, $y) => $y > 0 ? round(($x - $y) / $y * 100, 1) : null;

        return ['last_full_month' => end($full)['month'], 'partial_month' => count($monthly) > count($full) ? end($monthly)['month'] : null, 'l12m' => $a, 'prev12m' => $b,
            'change_pct' => $b === null ? null : ['events' => $pct($a['events'], $b['events']), 'permanent' => $pct($a['permanent'], $b['permanent']), 'temporary' => $pct($a['temporary'], $b['temporary']), 'ens_kwh' => $pct($a['ens_kwh'], $b['ens_kwh']), 'saifi' => $pct($a['saifi'], $b['saifi']), 'saidi' => $pct($a['saidi'], $b['saidi'])],
            'caidi_l12m' => $a['saifi'] > 0 ? round($a['saidi'] / $a['saifi'], 1) : null];
    }

    /** @param list<array<string,mixed>> $monthly @return list<array<string,mixed>> */
    private function yearly(array $monthly): array
    {
        $years = [];
        foreach ($monthly as $m) {
            $y = (int) substr($m['month'], 0, 4);
            $years[$y] ??= ['year' => $y, 'months' => 0, 'partial' => false, 'events' => 0, 'permanent' => 0, 'temporary' => 0, 'minutes' => 0.0, 'ens_kwh' => 0.0, 'saifi' => 0.0, 'saidi' => 0.0];
            $years[$y]['months']++;
            $years[$y]['partial'] = $years[$y]['partial'] || $m['partial'];
            foreach (['events', 'permanent', 'temporary', 'minutes', 'ens_kwh', 'saifi', 'saidi'] as $k) {
                $years[$y][$k] += $m[$k];
            }
        }
        ksort($years);
        $out = [];
        $prev = null;
        foreach ($years as $row) {
            foreach (['minutes', 'ens_kwh'] as $k) {
                $row[$k] = round($row[$k], 1);
            }
            $row['saifi'] = round($row['saifi'], 3);
            $row['saidi'] = round($row['saidi'], 2);
            $ok = $prev !== null && ! $row['partial'] && ! $prev['partial'] && $prev['months'] === 12 && $row['months'] === 12;
            $row['events_yoy_pct'] = $ok && $prev['events'] > 0 ? round(($row['events'] - $prev['events']) / $prev['events'] * 100, 1) : null;
            $row['ens_yoy_pct'] = $ok && $prev['ens_kwh'] > 0 ? round(($row['ens_kwh'] - $prev['ens_kwh']) / $prev['ens_kwh'] * 100, 1) : null;
            $row['saidi_yoy_pct'] = $ok && $prev['saidi'] > 0 ? round(($row['saidi'] - $prev['saidi']) / $prev['saidi'] * 100, 1) : null;
            $out[] = $row;
            $prev = $row;
        }

        return $out;
    }

    /** @return list<array<string,mixed>> */
    private function breakdown($q, string $col, string $blank, int $limit = 12): array
    {
        $rows = $q->selectRaw("coalesce(nullif(trim({$col}), ''), ?) as label, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, coalesce(sum(e.ens_kwh), 0) as ens, coalesce(sum(e.duration_minutes), 0) as minutes", [$blank])->groupBy('label')->orderByDesc('n')->limit($limit)->get();
        $total = max(1, (int) $rows->sum('n'));

        return $rows->map(fn ($r) => ['label' => $r->label, 'events' => (int) $r->n, 'share_pct' => round($r->n / $total * 100, 1), 'permanent' => (int) $r->perm, 'ens_kwh' => round((float) $r->ens, 1), 'minutes' => round((float) $r->minutes, 1)])->all();
    }

    /** @return list<array<string,int>> */
    private function hours($q): array
    {
        $by = $q->selectRaw('extract(hour from e.occurred_at at time zone ?)::int as h, count(*) as n', [$this->tz()])->groupBy('h')->pluck('n', 'h')->all();

        return array_map(fn ($h) => ['hour' => $h, 'events' => (int) ($by[$h] ?? 0)], range(0, 23));
    }

    /** @param array<string,array<string,int>> $matrix @return list<array<string,mixed>> */
    private function byUnit(array $units, bool $withUnassigned, ?string $from, ?string $to, int $min, bool $onlyPerm, array $matrix): array
    {
        $rows = $this->scoped(DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.organizational_unit_id'), $units, false, $from, $to)
            ->selectRaw("e.organizational_unit_id as u, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, count(*) filter (where e.outage_type = 'TEMPORER') as temp, coalesce(sum(e.ens_kwh), 0) as ens, coalesce(sum(e.duration_minutes), 0) as minutes")->groupBy('u')->get()->keyBy('u');
        $names = DB::table('organizational_units as u')->leftJoin('organizational_units as p', 'p.id', '=', 'u.parent_id')->whereIn('u.id', $units)->get(['u.id', 'u.name', 'p.name as up3'])->keyBy('id');
        $out = [];
        foreach ($units as $id) {
            $r = $rows[$id] ?? null;
            $n = $names[$id] ?? null;
            if ($n === null || $r === null) {
                continue;
            }
            $rel = $this->reliabilityByMonth([$id], $from, $to, $min, $onlyPerm, $matrix, $this->baseCustomers([$id], false));
            $out[] = ['unit_id' => $id, 'unit_name' => $n->name, 'up3_name' => $n->up3, 'events' => (int) $r->n, 'permanent' => (int) $r->perm, 'temporary' => (int) $r->temp, 'ens_kwh' => round((float) $r->ens, 1), 'minutes' => round((float) $r->minutes, 1),
                'customers' => $this->baseCustomers([$id], false), 'saifi' => round(array_sum(array_column($rel, 'saifi')), 3), 'saidi' => round(array_sum(array_column($rel, 'saidi')), 2)];
        }
        usort($out, fn ($a, $b) => $b['events'] <=> $a['events']);

        return $out;
    }

    /** @param array<string,array<string,int>> $matrix @return list<array<string,mixed>> */
    /**
     * Semua penyulang dengan gangguan pada rentang itu (tanpa batas 40 seperti `analysis()`), lengkap dengan kontribusi SAIFI dan SAIDI menurut aturan pengaturan sinkron.
     *
     * @param  list<string>  $units
     * @return list<array<string, mixed>>
     */
    public function feederRanking(array $units, ?string $from, ?string $to): array
    {
        $set = DB::table('outage_sync_settings')->where('id', 1)->first();

        return $this->byFeeder($units, false, $from, $to, (int) $set->saidi_min_minutes, (bool) $set->saidi_only_permanent, $this->customerMatrix(), $this->baseCustomers($units, false), 0);
    }

    private function byFeeder(array $units, bool $withUnassigned, ?string $from, ?string $to, int $min, bool $onlyPerm, array $matrix, int $base, int $limit = 40): array
    {
        $tz = $this->tz();
        $last = now($tz)->subMonthNoOverflow()->endOfMonth();
        $l12From = $last->copy()->subMonthsNoOverflow(11)->startOfMonth()->toDateString();
        $p12From = $last->copy()->subMonthsNoOverflow(23)->startOfMonth()->toDateString();
        $p12To = $last->copy()->subMonthsNoOverflow(12)->endOfMonth()->toDateString();
        $rows = $this->scoped(DB::table('outage_events as e')->whereNull('e.source_removed_at'), $units, $withUnassigned, $from, $to)
            ->selectRaw("e.feeder_id, min(e.gi_name) as gi, min(e.feeder_name) as fname, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, count(*) filter (where e.outage_type = 'TEMPORER') as temp,
                coalesce(sum(e.duration_minutes), 0) as minutes, coalesce(sum(e.ens_kwh), 0) as ens,
                count(*) filter (where (e.occurred_at at time zone ?)::date >= ?) as l12, count(*) filter (where (e.occurred_at at time zone ?)::date between ? and ?) as p12,
                count(*) filter (where e.duration_minutes >= ? and (? = false or e.outage_type = 'PERMANEN')) as counted, coalesce(sum(e.duration_minutes) filter (where e.duration_minutes >= ? and (? = false or e.outage_type = 'PERMANEN')), 0) as counted_minutes", [$tz, $l12From, $tz, $p12From, $p12To, $min, $onlyPerm, $min, $onlyPerm])
            ->groupBy('e.feeder_id', DB::raw('case when e.feeder_id is null then e.gi_name || e.feeder_name end'))->get();
        $ids = $rows->pluck('feeder_id')->filter()->all();
        $meta = DB::table('distribution_feeders as f')
            ->leftJoin('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')
            ->whereIn('f.id', $ids)
            ->get(['f.id', 'f.code', 'f.name', 'f.gi_name', 'u.name as unit_name'])
            ->keyBy('id');
        $gardu = DB::table('substations')->whereIn('feeder_id', $ids)->selectRaw('feeder_id, count(*) as n, coalesce(sum(capacity_kva), 0) as kva')->groupBy('feeder_id')->get()->keyBy('feeder_id');
        $out = [];
        foreach ($rows as $r) {
            $cust = $r->feeder_id === null ? 0 : $this->customersOf($matrix, $r->feeder_id, $units);
            $out[] = ['feeder_id' => $r->feeder_id, 'code' => $meta[$r->feeder_id]->code ?? null, 'name' => $meta[$r->feeder_id]->name ?? $r->fname, 'gi_name' => $meta[$r->feeder_id]->gi_name ?? $r->gi, 'unit_name' => $meta[$r->feeder_id]->unit_name ?? null, 'matched' => $r->feeder_id !== null,
                'events' => (int) $r->n, 'permanent' => (int) $r->perm, 'temporary' => (int) $r->temp, 'minutes' => round((float) $r->minutes, 1), 'ens_kwh' => round((float) $r->ens, 1), 'l12m_events' => (int) $r->l12, 'prev12m_events' => (int) $r->p12,
                'trend_pct' => $r->p12 > 0 ? round(($r->l12 - $r->p12) / $r->p12 * 100, 1) : null, 'customers' => $cust, 'gardu' => (int) ($gardu[$r->feeder_id]->n ?? 0), 'gardu_kva' => round((float) ($gardu[$r->feeder_id]->kva ?? 0), 0),
                'saifi_contribution' => $base > 0 ? round($cust * (int) $r->counted / $base, 4) : null, 'saidi_contribution' => $base > 0 ? round($cust * (float) $r->counted_minutes / $base, 3) : null];
        }
        usort($out, fn ($a, $b) => $b['events'] <=> $a['events']);

        return $limit > 0 ? array_slice($out, 0, $limit) : $out;
    }

    /**
     * Penyulang yang dibuka: tren bulanan, penyebab, peristiwa terakhir, dan gardu di bawahnya dengan pembebanan terakhir (kaitan gangguan dengan kondisi gardu).
     *
     * @return array<string,mixed>|null
     */
    public function feederDetail(string $feederId, array $units, bool $withUnassigned): ?array
    {
        $f = DB::table('distribution_feeders as f')->leftJoin('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')->where('f.id', $feederId)->first(['f.id', 'f.code', 'f.name', 'f.gi_name', 'u.name as owner']);
        if ($f === null) {
            return null;
        }
        $tz = $this->tz();
        $ev = fn () => DB::table('outage_events as e')->whereNull('e.source_removed_at')->where('e.feeder_id', $feederId)->where(fn ($w) => $w->whereIn('e.organizational_unit_id', $units)->when($withUnassigned, fn ($x) => $x->orWhereNull('e.organizational_unit_id')));
        $monthly = $ev()->selectRaw("to_char(e.occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n, count(*) filter (where e.outage_type = 'PERMANEN') as perm, count(*) filter (where e.outage_type = 'TEMPORER') as temp, coalesce(sum(e.ens_kwh), 0) as ens, coalesce(sum(e.duration_minutes), 0) as minutes", [$tz])->groupBy('m')->orderBy('m')->get()->keyBy('m');
        $served = $this->customersOf($this->customerMatrix(), $feederId, $units);
        $substations = DB::table('substations as s')->leftJoin('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')
            ->leftJoin(DB::raw('lateral (select r.loading_pct, r.measured_on from substation_readings r where r.substation_id = s.id and r.loading_pct is not null order by r.measured_on desc, r.measured_at desc nulls last limit 1) lr'), DB::raw('true'), '=', DB::raw('true'))
            ->where('s.feeder_id', $feederId)->whereIn('s.organizational_unit_id', $units)->orderByRaw('lr.loading_pct desc nulls last')->limit(60)
            ->get(['s.id', 's.code', 's.name', 's.capacity_kva', 'u.name as unit_name', 'lr.loading_pct', 'lr.measured_on']);
        $loads = $substations->pluck('loading_pct')->filter(fn ($v) => $v !== null)->map(fn ($v) => (float) $v);
        $recent = $ev()->orderByDesc('e.occurred_at')->limit(25)->get(['e.occurred_at', 'e.device_group', 'e.outage_type', 'e.duration_minutes', 'e.ens_kwh', 'e.category', 'e.cause', 'e.weather', 'e.fault_code']);

        return [
            'feeder' => ['id' => $f->id, 'code' => $f->code, 'name' => $f->name, 'gi_name' => $f->gi_name, 'owner' => $f->owner, 'customers' => $served],
            'monthly' => array_map(fn ($m) => ['month' => $m, 'events' => (int) ($monthly[$m]->n ?? 0), 'permanent' => (int) ($monthly[$m]->perm ?? 0), 'temporary' => (int) ($monthly[$m]->temp ?? 0), 'ens_kwh' => round((float) ($monthly[$m]->ens ?? 0), 1), 'minutes' => round((float) ($monthly[$m]->minutes ?? 0), 1)], $this->span($monthly->keys()->all())),
            'by_cause' => $this->breakdown($ev(), 'e.category', 'Tanpa kategori', 8),
            'recent' => $recent->map(fn ($r) => ['occurred_at' => $r->occurred_at, 'device' => $r->device_group, 'type' => $r->outage_type, 'minutes' => $r->duration_minutes === null ? null : (float) $r->duration_minutes, 'ens_kwh' => $r->ens_kwh === null ? null : (float) $r->ens_kwh,
                'category' => $r->category, 'cause' => $r->cause === null ? null : mb_substr($r->cause, 0, 160), 'weather' => $r->weather, 'fault_code' => $r->fault_code])->all(),
            'gardu' => ['count' => $substations->count(), 'measured' => $loads->count(), 'avg_loading_pct' => $loads->isEmpty() ? null : round($loads->avg(), 1), 'at_80' => $loads->filter(fn ($v) => $v >= 80)->count(), 'at_100' => $loads->filter(fn ($v) => $v >= 100)->count(),
                'items' => $substations->take(15)->map(fn ($s) => ['id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'unit_name' => $s->unit_name, 'capacity_kva' => $s->capacity_kva === null ? null : (float) $s->capacity_kva, 'loading_pct' => $s->loading_pct === null ? null : (float) $s->loading_pct, 'measured_on' => $s->measured_on])->all()],
        ];
    }
}
