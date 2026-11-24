<?php

namespace App\Services\Analytics;

use App\Services\Reports\CustomerGrowthService;
use Illuminate\Support\Facades\DB;

/**
 * Merangkai deret bulanan, pembanding tahun lalu, ringkasan (MoM, YoY, kumulatif tahun berjalan), rincian, perbandingan antar-ULP,
 * kelengkapan laporan, dan catatan analisa otomatis berbasis aturan untuk satu metrik (docs/91).
 */
class BusinessTrendBuilder
{
    private const MONTHS = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    public function __construct(private readonly BusinessMetricService $metrics, private readonly CustomerGrowthService $growth) {}

    /** Bulan terakhir yang punya data untuk metrik ini pada unit-unit tersebut (YYYY-MM), atau bulan lalu bila tidak diketahui. */
    public function latestMonth(string $code, array $units): string
    {
        $family = BusinessMetricService::CATALOG[$code]['family'] ?? null;
        $latest = match (true) {
            $code === 'susut' => DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', $units)->max('period'),
            $family !== null => DB::table('eis_report_files')->where('family', $family)->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)->max('period'),
            default => null,
        };

        return $latest !== null ? substr((string) $latest, 0, 7) : date('Y-m', strtotime('first day of last month'));
    }

    /**
     * @param  list<string>  $units  ULP yang digabung (UP3 = semua ULP di bawahnya)
     * @param  array<string, string>  $unitNames  ULP => nama, untuk perbandingan antar-ULP (kosong bila yang dipilih satu ULP)
     * @return array<string, mixed>
     */
    public function build(string $code, array $units, array $unitNames, string $from, string $to): array
    {
        $def = BusinessMetricService::CATALOG[$code];
        $months = $this->months($from, $to);
        $toYear = (int) substr($to, 0, 4);
        $fetchFrom = min($this->shift($from, -12), ($toYear - 1).'-01');
        $raw = $this->metrics->raw($code, $units, $fetchFrom, $to);
        $zeroFill = $def['zero_fill'] ?? $def['family'] === null;
        $combined = fn (string $m, ?array $only = null) => $this->combine($raw, $only ?? $units, $m, $zeroFill);

        $reporting = fn (string $m) => $zeroFill ? $units : array_values(array_filter($units, fn ($u) => isset($raw[$u][$m])));
        /** ULP yang punya data pada semua bulan yang dibandingkan (perbandingan setara: ULP yang belum melapor di salah satu periode tidak ikut). */
        $common = function (array $ms) use ($reporting, $units): array {
            $set = $units;
            foreach ($ms as $m) {
                $set = array_values(array_intersect($set, $reporting($m)));
            }

            return $set;
        };

        $series = [];
        foreach ($def['series'] as $s) {
            $series[] = ['key' => $s['key'], 'name' => $s['name'], 'unit' => $s['unit'],
                'values' => array_map(fn ($m) => $this->value($s, $combined($m)), $months),
                'previous_year' => array_map(fn ($m) => $this->value($s, $combined($this->shift($m, -12))), $months)];
        }
        $unitsReporting = array_map(fn ($m) => count($reporting($m)), $months);

        $prevTo = $this->shift($to, -12);
        $ytdMonths = [...$this->months(substr($to, 0, 4).'-01', $to), ...$this->months(substr($prevTo, 0, 4).'-01', $prevTo)];
        $basis = ['mom' => $common([$to, $this->shift($to, -1)]), 'yoy' => $common([$to, $prevTo]), 'ytd' => $common($ytdMonths)];
        $summary = [];
        foreach ($def['series'] as $s) {
            $on = fn (array $only) => fn (string $m) => $combined($m, $only);
            $latest = $this->value($s, $combined($to));
            $ytd = $this->ytd($s, $def['ytd'], $combined, $to);
            $pct = fn (array $only, string $a, string $b) => $only === [] ? null : $this->pct($this->value($s, $combined($a, $only)), $this->value($s, $combined($b, $only)));
            $summary[] = ['key' => $s['key'], 'latest' => $latest, 'previous_month' => $this->value($s, $combined($this->shift($to, -1))), 'mom_pct' => $pct($basis['mom'], $to, $this->shift($to, -1)),
                'same_month_last_year' => $this->value($s, $combined($prevTo)), 'yoy_pct' => $pct($basis['yoy'], $to, $prevTo),
                'ytd' => $ytd, 'ytd_previous_year' => $this->ytd($s, $def['ytd'], $combined, $prevTo),
                'ytd_pct' => $basis['ytd'] === [] ? null : $this->pct($this->ytd($s, $def['ytd'], $on($basis['ytd']), $to), $this->ytd($s, $def['ytd'], $on($basis['ytd']), $prevTo))];
        }

        $rowsOf = function (string $dim, ?array $order) use ($combined, $to): array {
            $now = $combined($to)[$dim] ?? [];
            $before = $combined($this->shift($to, -12))[$dim] ?? [];
            $total = array_sum($now);
            $order === null ? arsort($now) : uksort($now, fn ($a, $b) => array_search($a, $order, true) <=> array_search($b, $order, true));

            return array_map(fn ($k, $v) => ['key' => $k, 'value' => $v, 'share_pct' => $total != 0 ? $v / $total * 100 : null,
                'same_month_last_year' => $before[$k] ?? null, 'yoy_pct' => $this->pct($v, $before[$k] ?? null)], array_keys($now), $now);
        };
        $breakdown = $def['breakdown'] === null ? null : ['dimension' => $def['breakdown'], 'period' => $to, 'rows' => $rowsOf('bd', $def['breakdown_keys'] ?? null)];
        $breakdownSecondary = isset($def['breakdown2']) ? ['dimension' => $def['breakdown2'], 'period' => $to, 'rows' => $rowsOf('bd2', null)] : null;
        $matrix = null;
        if (isset($def['breakdown2'])) {
            $cells = $combined($to)['bdm'] ?? [];
            $rowKeys = array_column($breakdownSecondary['rows'], 'key');
            sort($rowKeys);
            $colKeys = $def['breakdown_keys'] ?? array_column($breakdown['rows'] ?? [], 'key');
            $matrix = ['rows_dimension' => $def['breakdown2'], 'columns_dimension' => $def['breakdown'], 'period' => $to, 'rows' => $rowKeys, 'columns' => $colKeys,
                'values' => array_map(fn ($r) => array_map(fn ($c) => $cells["{$r}|{$c}"] ?? 0.0, $colKeys), $rowKeys)];
        }

        $primary = $def['series'][0] ?? null;
        $comparison = [];
        if ($primary !== null && count($unitNames) > 1) {
            foreach ($unitNames as $id => $name) {
                $latest = $this->value($primary, $combined($to, [$id]));
                $comparison[] = ['unit_id' => $id, 'unit_name' => $name, 'latest' => $latest, 'yoy_pct' => $this->pct($latest, $this->value($primary, $combined($this->shift($to, -12), [$id]))),
                    'ytd' => $this->ytd($primary, $def['ytd'], fn ($m) => $combined($m, [$id]), $to)];
            }
            usort($comparison, fn ($a, $b) => ($b['latest'] ?? -INF) <=> ($a['latest'] ?? -INF));
        }

        $missing = $this->metrics->missingMonths($code, $units, $months);
        $coverage = ['months_expected' => count($months), 'missing' => array_map(fn ($u, $ms) => ['unit_id' => $u, 'unit_name' => $unitNames[$u] ?? null, 'months' => $ms], array_keys($missing), $missing)];

        $companion = isset($def['companion']) ? $this->companion($def['companion'], $units, $raw, $months, $to, $fetchFrom) : null;
        $insights = $this->insights($def, $series[0] ?? null, $summary[0] ?? null, $breakdown, $comparison, $coverage, $months, $to, count($units), end($unitsReporting) ?: 0, $unitNames);
        $companion !== null && ($note = $this->reconciliationInsight($companion['reconciliation'], $def['companion']['reconcile'])) !== null && $insights[] = $note;

        return ['metric' => ['code' => $code, 'name' => $def['name'], 'source' => $def['source'], 'polarity' => $def['polarity'], 'ytd_mode' => $def['ytd']],
            'from' => $from, 'to' => $to, 'months' => $months, 'units_expected' => count($units), 'units_reporting' => $unitsReporting,
            'comparison_basis' => array_map('count', $basis), 'series' => $series, 'summary' => $summary, 'breakdown' => $breakdown, 'breakdown_secondary' => $breakdownSecondary, 'matrix' => $matrix, 'comparison' => $comparison, 'coverage' => $coverage,
            'companions' => $companion['companions'] ?? null, 'reconciliation' => $companion['reconciliation'] ?? null, 'forecast' => isset($def['companion']) ? ['kind' => $def['companion']['forecast']] : null,
            'insights' => $insights];
    }

    /**
     * Data pendamping dari permohonan dan rekonsiliasinya dengan angka resmi Laporan 309 (docs/91). Permohonan dicatat menurut tanggal sambung sedangkan 309 menurut bulan buku, jadi selisih dinilai
     * kumulatif Januari sampai bulan akhir; per bulan hanya informasi. Hanya ULP yang punya angka 309 di kedua ujung periode yang diperbandingkan, dan angka permohonannya diambil dari ULP yang sama.
     *
     * @param  array<string, mixed>  $c  definisi `companion` pada katalog
     * @param  list<string>  $units
     * @param  array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>  $raw  angka resmi per ULP per bulan
     * @param  list<string>  $months
     * @return array{companions: array<string, mixed>, reconciliation: array<string, mixed>}
     */
    private function companion(array $c, array $units, array $raw, array $months, string $to, string $fetchFrom): array
    {
        $data = $this->growth->monthlyByUnit($units, $fetchFrom, $to);
        $cell = fn (string $u, string $m): array => $data[$u][$m] ?? [];
        $sum = function (array $only, string $m) use ($cell): array {
            $out = [];
            foreach ($only as $u) {
                foreach ($cell($u, $m) as $k => $v) {
                    $out[$k] = ($out[$k] ?? 0) + $v;
                }
            }

            return $out;
        };
        $valueOf = fn (array $s, string $m): float => (float) ($sum($units, $m)[$s['num']] ?? 0) * (float) ($s['factor'] ?? 1);
        $ytdOf = function (array $s, string $end) use ($valueOf): float {
            $total = 0.0;
            foreach ($this->months(substr($end, 0, 4).'-01', $end) as $m) {
                $total += $valueOf($s, $m);
            }

            return $total;
        };
        $prevTo = $this->shift($to, -12);
        $series = array_map(fn (array $s) => ['key' => $s['key'], 'name' => $s['name'], 'unit' => $s['unit'], 'values' => array_map(fn ($m) => $valueOf($s, $m), $months),
            'previous_year' => array_map(fn ($m) => $valueOf($s, $this->shift($m, -12)), $months), 'latest' => $valueOf($s, $to), 'ytd' => $ytdOf($s, $to), 'ytd_previous_year' => $ytdOf($s, $prevTo)], $c['series']);

        $r = $c['reconcile'];
        $official = fn (string $u, string $m): ?float => isset($raw[$u][$m]) ? (float) ($raw[$u][$m]['raw'][$r['official']] ?? 0) * $r['official_factor'] : null;
        $companionOf = function (array $only, string $m) use ($sum, $r): float {
            $row = $sum($only, $m);

            return array_sum(array_map(fn ($k) => (float) ($row[$k] ?? 0), $r['companion'])) * $r['companion_factor'];
        };
        $monthly = [];
        foreach ($months as $m) {
            $both = array_values(array_filter($units, fn ($u) => $official($u, $m) !== null && $official($u, $this->shift($m, -1)) !== null));
            if ($both === []) {
                $monthly[] = ['month' => $m, 'official_net' => null, 'companion' => $companionOf($units, $m), 'difference' => null, 'units_compared' => 0];

                continue;
            }
            $net = array_sum(array_map(fn ($u) => $official($u, $m) - $official($u, $this->shift($m, -1)), $both));
            $comp = $companionOf($both, $m);
            $monthly[] = ['month' => $m, 'official_net' => $net, 'companion' => $comp, 'difference' => $comp - $net, 'units_compared' => count($both)];
        }
        $base = $this->shift(substr($to, 0, 4).'-01', -1);
        $both = array_values(array_filter($units, fn ($u) => $official($u, $base) !== null && $official($u, $to) !== null));
        $ytd = null;
        if ($both !== []) {
            $net = array_sum(array_map(fn ($u) => $official($u, $to) - $official($u, $base), $both));
            $comp = 0.0;
            foreach ($this->months(substr($to, 0, 4).'-01', $to) as $m) {
                $comp += $companionOf($both, $m);
            }
            $ytd = ['year' => (int) substr($to, 0, 4), 'base_month' => $base, 'to_month' => $to, 'official_net' => $net, 'companion' => $comp, 'difference' => $comp - $net, 'units_compared' => count($both), 'units_expected' => count($units)];
        }

        return ['companions' => ['source' => $c['source'], 'series' => $series],
            'reconciliation' => ['unit' => $r['unit'], 'official_name' => $r['official_name'], 'companion_name' => $r['companion_name'], 'monthly' => $monthly, 'ytd' => $ytd,
                'note' => 'Permohonan dicatat menurut tanggal sambung, Laporan 309 menurut bulan buku: nilai per bulan bisa bergeser, jadi selisih dinilai kumulatif Januari sampai bulan akhir. Selisih = angka permohonan dikurangi tambahan bersih 309 (antara lain pelanggan berhenti dan koreksi data).']];
    }

    /** Catatan otomatis dari rekonsiliasi kumulatif; null bila tidak ada yang layak dicatat. @param array<string, mixed> $rec @param array<string, mixed> $r */
    private function reconciliationInsight(array $rec, array $r): ?array
    {
        $y = $rec['ytd'];
        if ($y === null) {
            return ['level' => 'info', 'text' => 'Rekonsiliasi dengan permohonan belum dapat dihitung: Laporan 309 bulan Desember tahun sebelumnya dan bulan akhir belum ada pada ULP yang sama.'];
        }
        $unit = $rec['unit'];
        $f = fn (float $v) => $unit === 'MVA' ? number_format($v, 2, ',', '.') : number_format($v, 0, ',', '.');
        $head = sprintf('Kumulatif Januari sampai %s: tambahan bersih Laporan 309 %s %s, %s %s %s (selisih %s)', $this->label($y['to_month']), $f($y['official_net']), $unit, strtolower($rec['companion_name']), $f($y['companion']), $unit, $f($y['difference']));
        if ($y['companion'] > 0 && $y['official_net'] <= 0) {
            return ['level' => 'perhatian', 'text' => $head.'. Permohonan menambah tetapi Laporan 309 tidak bertambah: periksa pelanggan berhenti atau data laporan.'];
        }
        if ($y['companion'] > 0 && $y['difference'] / $y['companion'] > 0.5) {
            return ['level' => 'perhatian', 'text' => $head.'. Lebih dari separuh tambahan dari permohonan tidak tampak di Laporan 309: periksa pelanggan berhenti, keterlambatan pencatatan, atau data permohonan yang belum menjadi pelanggan.'];
        }
        if ($y['companion'] >= 0 && $y['official_net'] > $y['companion'] * 1.2) {
            return ['level' => 'perhatian', 'text' => $head.'. Tambahan Laporan 309 melebihi permohonan: ada penambahan dari sumber lain (migrasi atau koreksi data) atau permohonan belum lengkap.'];
        }

        return ['level' => 'info', 'text' => $head.'.'];
    }

    /**
     * @param  array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>  $raw
     * @param  list<string>  $units
     * @return array{raw: array<string, float>, bd: array<string, float>}|null null bila tidak satu pun ULP punya data bulan itu
     */
    private function combine(array $raw, array $units, string $month, bool $zeroFill): ?array
    {
        $out = null;
        foreach ($units as $u) {
            $cell = $raw[$u][$month] ?? null;
            if ($cell === null) {
                continue;
            }
            $out ??= ['raw' => [], 'bd' => []];
            foreach ($cell['raw'] as $k => $v) {
                $out['raw'][$k] = ($out['raw'][$k] ?? 0) + $v;
            }
            foreach (['bd', 'bd2', 'bdm'] as $dim) {
                foreach ($cell[$dim] ?? [] as $k => $v) {
                    $out[$dim][$k] = ($out[$dim][$k] ?? 0) + $v;
                }
            }
        }

        return $out ?? ($zeroFill ? ['raw' => [], 'bd' => []] : null);
    }

    /** @param array<string, mixed> $s */
    private function value(array $s, ?array $cell): ?float
    {
        if ($cell === null) {
            return null;
        }
        $num = (float) ($cell['raw'][$s['num']] ?? 0) * (float) ($s['factor'] ?? 1);
        if (! isset($s['den'])) {
            return $num;
        }
        $den = (float) ($cell['raw'][$s['den']] ?? 0);

        return $den == 0 ? null : $num / $den;
    }

    /**
     * Kumulatif Januari sampai $to. last = posisi $to; sum = jumlah nilai bulanan (null bila ada bulan kosong); ratio = jumlah angka mentah lalu dihitung (null bila ada bulan kosong).
     *
     * @param  array<string, mixed>  $s
     * @param  callable(string): ?array  $combined
     */
    private function ytd(array $s, string $mode, callable $combined, string $to): ?float
    {
        if ($mode === 'last') {
            return $this->value($s, $combined($to));
        }
        $total = 0.0;
        $acc = ['raw' => [], 'bd' => []];
        foreach ($this->months(substr($to, 0, 4).'-01', $to) as $m) {
            $cell = $combined($m);
            if ($cell === null) {
                return null;
            }
            if ($mode === 'sum') {
                $v = $this->value($s, $cell);
                if ($v === null) {
                    return null;
                }
                $total += $v;
            }
            foreach ($cell['raw'] as $k => $v) {
                $acc['raw'][$k] = ($acc['raw'][$k] ?? 0) + $v;
            }
        }

        return $mode === 'sum' ? $total : $this->value($s, $acc);
    }

    /**
     * Catatan analisa otomatis (seri utama). level: baik / perhatian / info.
     *
     * @return list<array{level: string, text: string}>
     */
    private function insights(array $def, ?array $series, ?array $summary, ?array $breakdown, array $comparison, array $coverage, array $months, string $to, int $expected = 1, int $reportingLatest = 1, array $unitNames = []): array
    {
        $out = [];
        if ($series !== null && $expected > 1 && $reportingLatest < $expected) {
            $named = array_column(array_filter($comparison, fn ($c) => $c['latest'] !== null), 'unit_name');
            $out[] = ['level' => 'perhatian', 'text' => sprintf('Angka UP3 %s hanya mencakup %d dari %d ULP%s; persentase perubahan dihitung setara (hanya ULP yang punya data di kedua periode).', $this->label($to), $reportingLatest, $expected, $named !== [] && count($named) <= 3 ? ' ('.implode(', ', $named).')' : '')];
        }
        if ($series === null || $summary === null) {
            return [['level' => 'info', 'text' => 'Metrik ini belum memiliki sumber data: '.$def['source'].'.']];
        }
        $good = fn (float $delta) => $def['polarity'] === 'up' ? $delta > 0 : $delta < 0;
        $label = $this->label($to);
        if ($coverage['missing'] !== []) {
            $n = array_sum(array_map(fn ($r) => count($r['months']), $coverage['missing']));
            $out[] = ['level' => 'perhatian', 'text' => "Laporan belum lengkap: {$n} bulan-unit kosong pada rentang ini; bulan kosong tidak dihitung sebagai nol."];
        }
        if ($summary['yoy_pct'] !== null && abs($summary['yoy_pct']) >= 5) {
            $out[] = ['level' => $good($summary['yoy_pct']) ? 'baik' : 'perhatian', 'text' => sprintf('%s %s %s %.1f%% dibanding %s.', $series['name'], $label, $summary['yoy_pct'] > 0 ? 'naik' : 'turun', abs($summary['yoy_pct']), $this->label($this->shift($to, -12)))];
        }
        $values = array_values(array_filter($series['values'], fn ($v) => $v !== null));
        $streak = 0;
        $dir = 0;
        for ($i = count($values) - 1; $i > 0; $i--) {
            $d = $values[$i] <=> $values[$i - 1];
            if ($d === 0 || ($dir !== 0 && $d !== $dir)) {
                break;
            }
            $dir = $d;
            $streak++;
        }
        if ($streak >= 3) {
            $out[] = ['level' => $good((float) $dir) ? 'baik' : 'perhatian', 'text' => sprintf('%s %s %d bulan berturut-turut sampai %s.', $series['name'], $dir > 0 ? 'naik' : 'turun', $streak, $label)];
        }
        if ($summary['ytd_pct'] !== null && $def['ytd'] !== 'last') {
            $out[] = ['level' => $good($summary['ytd_pct']) ? 'baik' : ($summary['ytd_pct'] == 0 ? 'info' : 'perhatian'), 'text' => sprintf('Kumulatif Januari sampai %s %s %.1f%% dibanding periode yang sama tahun lalu.', $label, $summary['ytd_pct'] >= 0 ? 'naik' : 'turun', abs($summary['ytd_pct']))];
        }
        if ($breakdown !== null && $breakdown['rows'] !== []) {
            $top = array_reduce($breakdown['rows'], fn ($a, $r) => $a === null || $r['value'] > $a['value'] ? $r : $a);
            $top['share_pct'] !== null && $out[] = ['level' => 'info', 'text' => sprintf('Porsi terbesar %s: %s (%.1f%%).', strtolower($breakdown['dimension']), $top['key'], $top['share_pct'])];
            $moves = array_filter($breakdown['rows'], fn ($r) => $r['same_month_last_year'] !== null);
            usort($moves, fn ($a, $b) => abs($b['value'] - $b['same_month_last_year']) <=> abs($a['value'] - $a['same_month_last_year']));
            if ($moves !== [] && $moves[0]['value'] != $moves[0]['same_month_last_year']) {
                $m = $moves[0];
                $out[] = ['level' => 'info', 'text' => sprintf('Perubahan terbesar dibanding tahun lalu pada %s (%s%s).', $m['key'], $m['value'] > $m['same_month_last_year'] ? 'naik' : 'turun', $m['yoy_pct'] !== null ? sprintf(' %.1f%%', abs($m['yoy_pct'])) : '')];
            }
        }
        $ranked = array_values(array_filter($comparison, fn ($c) => $c['yoy_pct'] !== null));
        if (count($ranked) > 1) {
            usort($ranked, fn ($a, $b) => $a['yoy_pct'] <=> $b['yoy_pct']);
            [$worst, $best] = $def['polarity'] === 'up' ? [$ranked[0], end($ranked)] : [end($ranked), $ranked[0]];
            $out[] = ['level' => 'info', 'text' => sprintf('Perubahan tahunan terbaik: %s (%+.1f%%); terlemah: %s (%+.1f%%).', $best['unit_name'], $best['yoy_pct'], $worst['unit_name'], $worst['yoy_pct'])];
        }

        return $out;
    }

    private function pct(?float $now, ?float $before): ?float
    {
        return $now === null || $before === null || $before == 0 ? null : ($now - $before) / abs($before) * 100;
    }

    /** @return list<string> */
    private function months(string $from, string $to): array
    {
        $out = [];
        for ($m = $from; $m <= $to; $m = $this->shift($m, 1)) {
            $out[] = $m;
        }

        return $out;
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', strtotime("{$month}-01 {$by} month"));
    }

    private function label(string $month): string
    {
        return self::MONTHS[(int) substr($month, 5, 2)].' '.substr($month, 0, 4);
    }
}
