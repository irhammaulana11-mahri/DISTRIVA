<?php

namespace App\Services\Reports;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Analisis penambahan pelanggan dan daya (bukan prakiraan). Dasarnya permohonan yang sudah SAMBUNG (current_status CONNECTION_DONE), diberi tanggal oleh status EIS "PEREMAJAAN"
 * (tanggal sambungan selesai; cadangannya last_external_status_at), dalam zona waktu bisnis:
 *  - PB (pasang baru): +1 pelanggan dan + daya baru (delta_power_kva, daya lama selalu 0);
 *  - PD (perubahan daya): tanpa pelanggan baru; selisih daya naik, turun, atau sama (hanya ganti tarif).
 * Permohonan yang pernah PEREMAJAAN tetapi kini dibatalkan atau direstitusi tidak dihitung. Master pelanggan DIL (satu potret, tanpa tanggal nyala) hanya dipakai sebagai basis pembanding per ULP.
 */
class CustomerGrowthService
{
    private const GROUPS = ['R' => 'Rumah tangga', 'B' => 'Bisnis', 'I' => 'Industri', 'S' => 'Sosial', 'P' => 'Pemerintah'];

    /**
     * @param  list<string>  $units  ULP yang boleh dilihat (sudah mengikuti cakupan peran dan filter)
     * @return array<string,mixed>
     */
    public function trend(array $units, ?string $from, ?string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $fromM = $from === null ? null : substr($from, 0, 7);
        $toM = $to === null ? null : substr($to, 0, 7);
        $inRange = function ($q) use ($fromM, $toM) {
            $fromM !== null && $q->where('m', '>=', $fromM);
            $toM !== null && $q->where('m', '<=', $toM);

            return $q;
        };
        $realized = $this->realized($units, $tz);

        $rows = $inRange(DB::query()->fromSub($realized, 'r')->whereNotNull('m'))->groupBy('m')->orderBy('m')->selectRaw("m,
            count(*) filter (where t = 'PB') as pb_count, coalesce(sum(d) filter (where t = 'PB'), 0) as pb_kva,
            count(*) filter (where t = 'PD' and d > 0) as pd_up_count, coalesce(sum(d) filter (where t = 'PD' and d > 0), 0) as pd_up_kva,
            count(*) filter (where t = 'PD' and d < 0) as pd_down_count, coalesce(sum(d) filter (where t = 'PD' and d < 0), 0) as pd_down_kva,
            count(*) filter (where t = 'PD' and d = 0) as pd_same_count")->get()->keyBy('m');

        $received = DB::table('applications as a')->whereIn('a.organizational_unit_id', $units)
            ->selectRaw("to_char(coalesce(a.source_created_at, a.created_at) at time zone ?, 'YYYY-MM') as m, count(*) filter (where a.application_type = 'PB') as req_pb, count(*) filter (where a.application_type = 'PD') as req_pd", [$tz])
            ->groupBy('m')->get()->keyBy('m');
        $stopped = DB::table('applications as a')->whereIn('a.organizational_unit_id', $units)->whereIn('a.current_status', ['CANCELLED', 'REFUNDED'])->whereNotNull('a.last_external_status_at')
            ->selectRaw("to_char(a.last_external_status_at at time zone ?, 'YYYY-MM') as m, count(*) filter (where a.current_status = 'CANCELLED') as cancelled, count(*) filter (where a.current_status = 'REFUNDED') as refunded", [$tz])
            ->groupBy('m')->get()->keyBy('m');

        $months = $this->monthSpan($rows->keys()->all());
        $nowM = now($tz)->format('Y-m');
        $monthly = [];
        foreach ($months as $m) {
            $r = $rows[$m] ?? null;
            $monthly[] = [
                'month' => $m, 'partial' => $m === $nowM,
                'pb_count' => (int) ($r->pb_count ?? 0), 'pb_kva' => round((float) ($r->pb_kva ?? 0), 1),
                'pd_up_count' => (int) ($r->pd_up_count ?? 0), 'pd_up_kva' => round((float) ($r->pd_up_kva ?? 0), 1),
                'pd_down_count' => (int) ($r->pd_down_count ?? 0), 'pd_down_kva' => round((float) ($r->pd_down_kva ?? 0), 1),
                'pd_same_count' => (int) ($r->pd_same_count ?? 0),
                'pd_net_kva' => round((float) ($r->pd_up_kva ?? 0) + (float) ($r->pd_down_kva ?? 0), 1),
                'requests_pb' => (int) ($received[$m]->req_pb ?? 0), 'requests_pd' => (int) ($received[$m]->req_pd ?? 0),
                'cancelled' => (int) ($stopped[$m]->cancelled ?? 0), 'refunded' => (int) ($stopped[$m]->refunded ?? 0),
            ];
        }
        $monthly = $this->withGrowth($monthly);

        return [
            'filters' => ['from' => $from, 'to' => $to, 'units' => count($units)],
            'as_of' => now($tz)->toDateString(),
            'kpi' => $this->kpi($monthly, $nowM),
            'monthly' => $monthly,
            'yearly' => $this->yearly($monthly),
            'by_tariff' => $this->byTariff($inRange(DB::query()->fromSub($realized, 'r')->where('t', 'PB')->whereNotNull('m'))),
            'by_unit' => $this->byUnit($inRange(DB::query()->fromSub($realized, 'r')->whereNotNull('m')), $units, $monthly, $nowM),
            'seasonality' => $this->seasonality($monthly),
            'anomalies' => $this->anomalies($monthly),
            'notes' => [
                'Penambahan dihitung dari permohonan yang sudah tersambung (status PEREMAJAAN di EIS), bukan dari tanggal permohonan masuk.',
                'PB menambah pelanggan dan daya; PD tidak menambah pelanggan, hanya selisih daya (naik, turun, atau sama).',
                'Master pelanggan DIL berupa satu potret tanpa tanggal nyala, sehingga basis pelanggan masa lalu tidak tersedia; kolom basis hanya pembanding saat ini.',
                'Bulan berjalan belum lengkap (ditandai) dan tidak dipakai untuk pertumbuhan, musiman, maupun deteksi anomali.',
            ],
        ];
    }

    /**
     * Permohonan yang sudah tersambung beserta bulan sambungnya (zona waktu bisnis): t = PB/PD, u = ULP, tariff, d = selisih daya (kVA), m = YYYY-MM.
     *
     * @param  list<string>  $units
     */
    private function realized(array $units, string $tz): Builder
    {
        return DB::table('applications as a')
            ->leftJoinSub(DB::table('application_external_status_histories')->selectRaw('application_id, min(observed_at) as at')->whereRaw("upper(external_status_code) = 'PEREMAJAAN'")->groupBy('application_id'), 'h', 'h.application_id', '=', 'a.id')
            ->where('a.current_status', 'CONNECTION_DONE')->whereIn('a.organizational_unit_id', $units)
            ->selectRaw("a.application_type as t, a.organizational_unit_id as u, a.new_tariff_code as tariff, a.delta_power_kva::float as d, to_char(coalesce(h.at, a.last_external_status_at) at time zone ?, 'YYYY-MM') as m", [$tz]);
    }

    /**
     * Angka bulanan per ULP untuk menjelaskan angka resmi Laporan 309 (docs/91 bagian pendamping): PB dan daya tersambung, perubahan daya, permohonan masuk.
     * Dasar dan aturannya sama dengan trend().
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{pb: float, pb_kva: float, pd_net_kva: float, req_pb: float, req_pd: float}>> unit => bulan (YYYY-MM) => angka
     */
    public function monthlyByUnit(array $units, string $fromMonth, string $toMonth): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $out = [];
        $cell = function (string $u, string $m) use (&$out): void {
            $out[$u][$m] ??= ['pb' => 0.0, 'pb_kva' => 0.0, 'pd_net_kva' => 0.0, 'req_pb' => 0.0, 'req_pd' => 0.0];
        };
        $rows = DB::query()->fromSub($this->realized($units, $tz), 'r')->whereNotNull('m')->whereBetween('m', [$fromMonth, $toMonth])->groupBy('u', 'm')
            ->selectRaw("u, m, count(*) filter (where t = 'PB') as pb, coalesce(sum(d) filter (where t = 'PB'), 0) as pb_kva, coalesce(sum(d) filter (where t = 'PD'), 0) as pd_net_kva")->get();
        foreach ($rows as $r) {
            $cell($r->u, $r->m);
            $out[$r->u][$r->m] = ['pb' => (float) $r->pb, 'pb_kva' => (float) $r->pb_kva, 'pd_net_kva' => (float) $r->pd_net_kva] + $out[$r->u][$r->m];
        }
        $received = DB::table('applications as a')->whereIn('a.organizational_unit_id', $units)
            ->selectRaw("a.organizational_unit_id as u, to_char(coalesce(a.source_created_at, a.created_at) at time zone ?, 'YYYY-MM') as m, count(*) filter (where a.application_type = 'PB') as req_pb, count(*) filter (where a.application_type = 'PD') as req_pd", [$tz])
            ->groupBy('u', 'm')->get();
        foreach ($received as $r) {
            if ($r->m < $fromMonth || $r->m > $toMonth) {
                continue;
            }
            $cell($r->u, $r->m);
            $out[$r->u][$r->m]['req_pb'] = (float) $r->req_pb;
            $out[$r->u][$r->m]['req_pd'] = (float) $r->req_pd;
        }

        return $out;
    }

    /**
     * Daya (kVA) pasang baru tersambung per ULP per bulan menurut kelompok tarif (huruf pertama kode tarif baru: R, B, I, S, P; lainnya digabung ke "?"); dasar sama dengan trend().
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array<string, float>>> unit => bulan (YYYY-MM) => kelompok => kVA
     */
    public function pbKvaByGroup(array $units, string $fromMonth, string $toMonth): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $out = [];
        $rows = DB::query()->fromSub($this->realized($units, $tz), 'r')->where('t', 'PB')->whereNotNull('m')->whereBetween('m', [$fromMonth, $toMonth])
            ->selectRaw("u, m, coalesce(nullif(upper(left(tariff, 1)), ''), '?') as g, coalesce(sum(d), 0) as kva")->groupBy('u', 'm', 'g')->get();
        foreach ($rows as $r) {
            $out[$r->u][$r->m][$r->g] = (float) $r->kva;
        }

        return $out;
    }

    /** @param list<string> $present @return list<string> bulan berurutan tanpa celah dari yang tertua sampai terbaru */
    private function monthSpan(array $present): array
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

    /** @param list<array<string,mixed>> $monthly @return list<array<string,mixed>> */
    private function withGrowth(array $monthly): array
    {
        $by = array_column($monthly, null, 'month');
        foreach ($monthly as $i => $row) {
            $prev = $monthly[$i - 1] ?? null;
            $yoy = $by[date('Y-m', strtotime($row['month'].'-01 -1 year'))] ?? null;
            $monthly[$i]['mom_pct'] = $prev !== null && $prev['pb_count'] > 0 && ! $row['partial'] ? round(($row['pb_count'] - $prev['pb_count']) / $prev['pb_count'] * 100, 1) : null;
            $monthly[$i]['yoy_pct'] = $yoy !== null && $yoy['pb_count'] > 0 && ! $row['partial'] ? round(($row['pb_count'] - $yoy['pb_count']) / $yoy['pb_count'] * 100, 1) : null;
            $monthly[$i]['avg_kva_per_pb'] = $row['pb_count'] > 0 ? round($row['pb_kva'] / $row['pb_count'], 2) : null;
        }

        return $monthly;
    }

    /** @param list<array<string,mixed>> $monthly @return array<string,mixed> */
    private function kpi(array $monthly, string $nowM): array
    {
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        if ($full === []) {
            return ['last_full_month' => null, 'l12m' => null, 'prev12m' => null, 'l12m_growth_pct' => null, 'ytd' => null, 'ytd_prev' => null, 'ytd_growth_pct' => null, 'pb_total' => 0, 'pb_kva_total' => 0.0, 'avg_kva_per_pb' => null, 'partial_month' => $monthly !== [] ? $nowM : null];
        }
        $sum = fn (array $set, string $k) => array_sum(array_column($set, $k));
        $last = end($full)['month'];
        $l12 = array_slice($full, -12);
        $p12 = count($full) >= 24 ? array_slice($full, -24, 12) : [];
        $year = substr($last, 0, 4);
        $ytd = array_values(array_filter($full, fn ($m) => str_starts_with($m['month'], $year)));
        $months = array_map(fn ($m) => substr($m['month'], 5), $ytd);
        $ytdPrev = array_values(array_filter($full, fn ($m) => str_starts_with($m['month'], (string) ((int) $year - 1)) && in_array(substr($m['month'], 5), $months, true)));
        $pct = fn ($a, $b) => $b > 0 ? round(($a - $b) / $b * 100, 1) : null;
        $pbTotal = $sum($monthly, 'pb_count');

        return [
            'last_full_month' => $last,
            'partial_month' => count($monthly) > count($full) ? $nowM : null,
            'l12m' => ['pb_count' => $sum($l12, 'pb_count'), 'pb_kva' => round($sum($l12, 'pb_kva'), 1), 'pd_net_kva' => round($sum($l12, 'pd_net_kva'), 1)],
            'prev12m' => $p12 === [] ? null : ['pb_count' => $sum($p12, 'pb_count'), 'pb_kva' => round($sum($p12, 'pb_kva'), 1), 'pd_net_kva' => round($sum($p12, 'pd_net_kva'), 1)],
            'l12m_growth_pct' => $p12 === [] ? null : $pct($sum($l12, 'pb_count'), $sum($p12, 'pb_count')),
            'ytd' => ['year' => (int) $year, 'months' => count($ytd), 'pb_count' => $sum($ytd, 'pb_count'), 'pb_kva' => round($sum($ytd, 'pb_kva'), 1)],
            'ytd_prev' => $ytdPrev === [] ? null : ['year' => (int) $year - 1, 'months' => count($ytdPrev), 'pb_count' => $sum($ytdPrev, 'pb_count'), 'pb_kva' => round($sum($ytdPrev, 'pb_kva'), 1)],
            'ytd_growth_pct' => $ytdPrev === [] ? null : $pct($sum($ytd, 'pb_count'), $sum($ytdPrev, 'pb_count')),
            'pb_total' => $pbTotal,
            'pb_kva_total' => round($sum($monthly, 'pb_kva'), 1),
            'avg_kva_per_pb' => $pbTotal > 0 ? round($sum($monthly, 'pb_kva') / $pbTotal, 2) : null,
        ];
    }

    /** @param list<array<string,mixed>> $monthly @return list<array<string,mixed>> */
    private function yearly(array $monthly): array
    {
        $years = [];
        foreach ($monthly as $m) {
            $y = (int) substr($m['month'], 0, 4);
            $years[$y] ??= ['year' => $y, 'months' => 0, 'partial' => false, 'pb_count' => 0, 'pb_kva' => 0.0, 'pd_up_kva' => 0.0, 'pd_down_kva' => 0.0, 'pd_net_kva' => 0.0, 'requests_pb' => 0, 'requests_pd' => 0, 'cancelled' => 0, 'refunded' => 0];
            $years[$y]['months']++;
            $years[$y]['partial'] = $years[$y]['partial'] || $m['partial'];
            foreach (['pb_count', 'pb_kva', 'pd_up_kva', 'pd_down_kva', 'pd_net_kva', 'requests_pb', 'requests_pd', 'cancelled', 'refunded'] as $k) {
                $years[$y][$k] += $m[$k];
            }
        }
        ksort($years);
        $out = [];
        $prev = null;
        foreach ($years as $y => $row) {
            foreach (['pb_kva', 'pd_up_kva', 'pd_down_kva', 'pd_net_kva'] as $k) {
                $row[$k] = round($row[$k], 1);
            }
            $row['avg_kva_per_pb'] = $row['pb_count'] > 0 ? round($row['pb_kva'] / $row['pb_count'], 2) : null;
            $comparable = $prev !== null && ! $row['partial'] && ! $prev['partial'] && $prev['months'] === 12 && $row['months'] === 12;
            $row['yoy_pct'] = $comparable && $prev['pb_count'] > 0 ? round(($row['pb_count'] - $prev['pb_count']) / $prev['pb_count'] * 100, 1) : null;
            $row['yoy_kva_pct'] = $comparable && $prev['pb_kva'] > 0 ? round(($row['pb_kva'] - $prev['pb_kva']) / $prev['pb_kva'] * 100, 1) : null;
            $out[] = $row;
            $prev = $row;
        }

        return $out;
    }

    /** @return list<array<string,mixed>> */
    private function byTariff($q): array
    {
        $rows = $q->selectRaw('tariff, count(*) as c, coalesce(sum(d), 0) as kva')->groupBy('tariff')->get();
        $groups = [];
        $codes = [];
        foreach ($rows as $r) {
            $code = $r->tariff === null || $r->tariff === '' ? '?' : strtoupper((string) $r->tariff);
            $g = self::GROUPS[$code[0]] ?? 'Lainnya';
            $groups[$g] ??= ['group' => $g, 'count' => 0, 'kva' => 0.0];
            $groups[$g]['count'] += (int) $r->c;
            $groups[$g]['kva'] += (float) $r->kva;
            $codes[$code] = ['tariff' => $code, 'group' => $g, 'count' => (int) $r->c, 'kva' => (float) $r->kva];
        }
        $total = array_sum(array_column($groups, 'count'));
        $totalKva = array_sum(array_column($groups, 'kva'));
        $fmt = fn (array $x) => $x + ['share_pct' => $total > 0 ? round($x['count'] / $total * 100, 1) : 0.0, 'kva_share_pct' => $totalKva > 0 ? round($x['kva'] / $totalKva * 100, 1) : 0.0, 'avg_kva' => $x['count'] > 0 ? round($x['kva'] / $x['count'], 2) : null];
        usort($groups, fn ($a, $b) => $b['count'] <=> $a['count']);
        uasort($codes, fn ($a, $b) => $b['count'] <=> $a['count']);

        return [
            'groups' => array_map(fn ($g) => $fmt(['group' => $g['group'], 'count' => $g['count'], 'kva' => round($g['kva'], 1)]), $groups),
            'top_codes' => array_map(fn ($c) => $fmt(['tariff' => $c['tariff'], 'group' => $c['group'], 'count' => $c['count'], 'kva' => round($c['kva'], 1)]), array_slice(array_values($codes), 0, 10)),
        ];
    }

    /**
     * Per ULP: total pada rentang terpilih, rincian per tahun, rata-rata per tahun, dan 12 bulan terakhir (bulan lengkap). Perbandingan dengan basis pelanggan aktif DIL memakai
     * 12 bulan terakhir (laju tahunan), bukan total semua tahun.
     *
     * @param  list<string>  $units
     * @param  list<array<string,mixed>>  $monthly
     * @return list<array<string,mixed>>
     */
    private function byUnit($q, array $units, array $monthly, string $nowM): array
    {
        $rows = $q->selectRaw("u, m, count(*) filter (where t = 'PB') as pb_count, coalesce(sum(d) filter (where t = 'PB'), 0) as pb_kva, coalesce(sum(d) filter (where t = 'PD'), 0) as pd_net_kva")->groupBy('u', 'm')->get()->groupBy('u');
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        $window = array_flip(array_column(array_slice($full, -12), 'month'));
        $names = DB::table('organizational_units as u')->leftJoin('organizational_units as p', 'p.id', '=', 'u.parent_id')->whereIn('u.id', $units)->get(['u.id', 'u.code', 'u.name', 'p.name as up3_name'])->keyBy('id');
        $base = DB::table('customer_connections')->whereIn('organizational_unit_id', $units)->where('status', 'AKTIF')->selectRaw('organizational_unit_id as u, count(*) as c, coalesce(sum(power_va), 0) as va')->groupBy('organizational_unit_id')->get()->keyBy('u');
        $spanMonths = count($monthly);
        $out = [];
        foreach ($units as $id) {
            $n = $names[$id] ?? null;
            $r = $rows[$id] ?? collect();
            $b = $base[$id] ?? null;
            if ($n === null || ($r->isEmpty() && $b === null)) {
                continue;
            }
            $years = [];
            $l12 = ['pb' => 0, 'kva' => 0.0];
            foreach ($r as $x) {
                $y = (int) substr($x->m, 0, 4);
                $years[$y] ??= ['year' => $y, 'pb_count' => 0, 'pb_kva' => 0.0];
                $years[$y]['pb_count'] += (int) $x->pb_count;
                $years[$y]['pb_kva'] += (float) $x->pb_kva;
                if (isset($window[$x->m])) {
                    $l12['pb'] += (int) $x->pb_count;
                    $l12['kva'] += (float) $x->pb_kva;
                }
            }
            ksort($years);
            $pb = (int) $r->sum('pb_count');
            $kva = (float) $r->sum('pb_kva');
            $baseCount = (int) ($b->c ?? 0);
            $out[] = ['unit_id' => $id, 'unit_code' => $n->code, 'unit_name' => $n->name, 'up3_name' => $n->up3_name, 'pb_count' => $pb, 'pb_kva' => round($kva, 1), 'pd_net_kva' => round((float) $r->sum('pd_net_kva'), 1),
                'by_year' => array_values(array_map(fn ($y) => ['year' => $y['year'], 'pb_count' => $y['pb_count'], 'pb_kva' => round($y['pb_kva'], 1)], $years)),
                'avg_pb_per_year' => $spanMonths > 0 ? round($pb / ($spanMonths / 12), 0) : null,
                'l12m_pb' => $l12['pb'], 'l12m_kva' => round($l12['kva'], 1),
                'avg_kva_per_pb' => $pb > 0 ? round($kva / $pb, 2) : null, 'base_customers' => $baseCount, 'base_kva' => round((float) ($b->va ?? 0) / 1000, 1),
                'l12m_vs_base_pct' => $baseCount > 0 ? round($l12['pb'] / $baseCount * 100, 2) : null];
        }
        usort($out, fn ($a, $b) => $b['l12m_pb'] <=> $a['l12m_pb'] ?: $b['pb_count'] <=> $a['pb_count']);

        return $out;
    }

    /** @param list<array<string,mixed>> $monthly @return array<string,mixed> */
    private function seasonality(array $monthly): array
    {
        $years = [];
        foreach ($monthly as $m) {
            ! $m['partial'] && $years[substr($m['month'], 0, 4)][substr($m['month'], 5)] = $m['pb_count'];
        }
        $full = array_filter($years, fn ($y) => count($y) === 12);
        if (count($full) < 2) {
            return ['years' => array_keys($full), 'months' => [], 'note' => 'Pola musiman butuh minimal dua tahun penuh.'];
        }
        $avg = [];
        for ($i = 1; $i <= 12; $i++) {
            $k = sprintf('%02d', $i);
            $avg[$k] = array_sum(array_map(fn ($y) => $y[$k], $full)) / count($full);
        }
        $mean = array_sum($avg) / 12;

        return ['years' => array_keys($full), 'months' => array_map(fn ($k, $v) => ['month' => (int) $k, 'avg_pb_count' => round($v, 1), 'index' => $mean > 0 ? round($v / $mean, 2) : null], array_keys($avg), $avg), 'note' => null];
    }

    /** @param list<array<string,mixed>> $monthly @return list<array<string,mixed>> */
    private function anomalies(array $monthly): array
    {
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        $out = [];
        for ($i = 12; $i < count($full); $i++) {
            $win = array_column(array_slice($full, $i - 12, 12), 'pb_count');
            $mean = array_sum($win) / 12;
            $sd = sqrt(array_sum(array_map(fn ($x) => ($x - $mean) ** 2, $win)) / 12);
            if ($sd <= 0) {
                continue;
            }
            $z = ($full[$i]['pb_count'] - $mean) / $sd;
            if (abs($z) >= 2) {
                $out[] = ['month' => $full[$i]['month'], 'pb_count' => $full[$i]['pb_count'], 'expected' => round($mean, 1), 'z' => round($z, 2), 'direction' => $z > 0 ? 'NAIK' : 'TURUN'];
            }
        }

        return array_reverse($out);
    }
}
