<?php

namespace App\Services\Analytics;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Merangkai deret bulanan, pembanding tahun lalu, ringkasan (MoM, YoY, kumulatif tahun berjalan), rincian, perbandingan antar-ULP,
 * kelengkapan laporan, dan catatan analisa otomatis berbasis aturan untuk satu metrik (docs/91).
 */
class BusinessTrendBuilder
{
    /** Metrik yang memakai laporan DIFI: peringatan kelengkapan bulan terakhir ikut dikirim. */
    public const DIFI_METRICS = ['saidi-saifi', 'ens', 'gangguan'];

    /** Metrik yang bersumber penarikan APKT => tabel penyimpanannya. */
    public const APKT_TABLES = ['rpt-rct-gangguan' => 'apkt_rpt_rct_records', 'rpt-rct-keluhan' => 'apkt_rpt_rct_keluhan_records', 'anomali-gangguan' => 'apkt_anomali_gangguan_records'];

    private const MONTHS = [1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    public function __construct(private readonly BusinessMetricService $metrics, private readonly BusinessCompanionService $companions, private readonly DifiCompleteness $difi) {}

    /**
     * Peringatan kelengkapan data bulan terakhir (saat ini: laporan DIFI, docs/91).
     *
     * @param  list<string>  $units
     * @return list<array<string, mixed>>
     */
    public function warnings(string $code, array $units, string $to): array
    {
        return match (true) {
            in_array($code, self::DIFI_METRICS, true) => $this->difi->check($units, $to),
            isset(self::APKT_TABLES[$code]) => $this->partialApktMonth($code, $units, $to),
            default => [],
        };
    }

    /**
     * RPT/RCT dari APKT untuk bulan berjalan adalah data sampai hari penarikan dan terus bertambah: bulan itu belum final dan tidak sebanding dengan bulan penuh.
     * Peringatan muncul bila rentang yang ditampilkan mencapai bulan berjalan dan ada data APKT untuk bulan itu.
     *
     * @param  list<string>  $units
     * @return list<array<string, mixed>>
     */
    private function partialApktMonth(string $code, array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $now = now($tz);
        $current = $now->format('Y-m');
        if ($units === [] || $to < $current) {
            return [];
        }
        $rows = DB::table(self::APKT_TABLES[$code])->whereIn('organizational_unit_id', $units)->where('period', $current.'-01');
        $updatedAt = (clone $rows)->max('updated_at');
        if ($updatedAt === null) {
            return [];
        }

        return [[
            'code' => 'apkt_current_month_partial',
            'severity' => 'warning',
            'month' => $current,
            'message' => sprintf('Data %s %s adalah data bulan berjalan dari APKT (sampai tanggal %d, terakhir ditarik %s) dan masih bertambah. Angka bulan ini belum final dan tidak sebanding dengan bulan penuh; tarik ulang setelah bulan berakhir.',
                match ($code) {
                    'rpt-rct-keluhan' => 'RPT/RCT keluhan',
                    'anomali-gangguan' => 'anomali gangguan',
                    default => 'RPT/RCT',
                }, $current, $now->day, Carbon::parse($updatedAt)->setTimezone($tz)->format('d-m-Y H:i')),
            'days_elapsed' => $now->day,
            'last_pulled_at' => Carbon::parse($updatedAt)->toIso8601String(),
            'units_reporting' => (clone $rows)->distinct()->count('organizational_unit_id'),
        ]];
    }

    /** Bulan terakhir yang punya data untuk metrik ini pada unit-unit tersebut (YYYY-MM), atau bulan lalu bila tidak diketahui. */
    public function latestMonth(string $code, array $units): string
    {
        $family = BusinessMetricService::CATALOG[$code]['family'] ?? null;
        $latest = match (true) {
            $code === 'susut' => DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', $units)->max('period'),
            isset(self::APKT_TABLES[$code]) => DB::table(self::APKT_TABLES[$code])->whereIn('organizational_unit_id', $units)->max('period'),
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
        $fetchFrom = min($this->shift($from, -12), (isset($def['companion']) ? $toYear - 2 : $toYear - 1).'-01');   // rekonsiliasi membandingkan kumulatif dengan tahun lalu: butuh data dua tahun sebelumnya
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
        if (isset($def['breakdown2']) && empty($def['no_matrix'])) {
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

        $companion = isset($def['companion']) ? $this->companion($code, $def['companion'], $units, $raw, $months, $to, $fetchFrom, $zeroFill) : null;
        $insights = $this->insights($def, $series[0] ?? null, $summary[0] ?? null, $breakdown, $comparison, $coverage, $months, $to, count($units), end($unitsReporting) ?: 0, $unitNames);
        foreach ($companion['reconciliations'] ?? [] as $rec) {
            ($note = $this->reconciliationInsight($rec)) !== null && $insights[] = $note;
        }

        return ['metric' => ['code' => $code, 'name' => $def['name'], 'source' => $def['source'], 'polarity' => $def['polarity'], 'ytd_mode' => $def['ytd']],
            'from' => $from, 'to' => $to, 'months' => $months, 'units_expected' => count($units), 'units_reporting' => $unitsReporting,
            'comparison_basis' => array_map('count', $basis), 'series' => $series, 'summary' => $summary, 'breakdown' => $breakdown, 'breakdown_secondary' => $breakdownSecondary, 'matrix' => $matrix, 'comparison' => $comparison, 'coverage' => $coverage,
            'companions' => $companion['companions'] ?? null, 'reconciliation' => $companion['reconciliations'][0] ?? null, 'reconciliations' => $companion['reconciliations'] ?? null, 'forecast' => $def['companion']['forecast'] ?? null,
            'insights' => $insights, 'warnings' => $this->warnings($code, $units, $to)];
    }

    /**
     * Data pendamping operasional dan rekonsiliasinya dengan angka resmi laporan EIS (docs/91). Dua mode: `net` (angka resmi berupa posisi/saldo seperti jumlah pelanggan: dibandingkan tambahan bersih
     * antar bulan dengan angka operasional) dan `flow` (angka resmi berupa arus bulanan seperti ENS atau jumlah gangguan: dibandingkan langsung per bulan). Penilaian dilakukan pada kumulatif Januari sampai
     * bulan akhir karena pencatatan kedua sumber dapat bergeser antar bulan. Hanya ULP yang punya angka resmi pada bulan yang dibandingkan (kedua ujung periode untuk `net`, semua bulan Januari sampai
     * bulan akhir untuk kumulatif `flow`) yang diperbandingkan, dan angka pendampingnya diambil dari ULP yang sama.
     *
     * @param  array<string, mixed>  $c  definisi `companion` pada katalog
     * @param  list<string>  $units
     * @param  array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>  $raw  angka resmi per ULP per bulan
     * @param  list<string>  $months
     * @return array{companions: array<string, mixed>, reconciliations: list<array<string, mixed>>}
     */
    private function companion(string $code, array $c, array $units, array $raw, array $months, string $to, string $fetchFrom, bool $zeroFill = false): array
    {
        $data = $this->companions->raw($code, $units, $fetchFrom, $to);
        /** Jumlah angka mentah pendamping bernama atas ULP terpilih pada satu bulan. */
        $sum = function (array $only, string $m) use ($data): array {
            $out = [];
            foreach ($only as $u) {
                foreach ($data[$u][$m] ?? [] as $k => $v) {
                    $out[$k] = ($out[$k] ?? 0) + $v;
                }
            }

            return $out;
        };
        $ratio = function (array $row, array $spec): ?float {
            $num = array_sum(array_map(fn ($k) => (float) ($row[$k] ?? 0), (array) $spec['num'])) * (float) ($spec['factor'] ?? 1);
            if (! isset($spec['den'])) {
                return $num;
            }
            $den = (float) ($row[$spec['den']] ?? 0);

            return $den == 0 ? null : $num / $den;
        };
        $valueOf = fn (array $s, string $m): ?float => $ratio($sum($units, $m), $s);
        $ytdOf = function (array $s, string $end) use ($valueOf): float {
            $total = 0.0;
            foreach ($this->months(substr($end, 0, 4).'-01', $end) as $m) {
                $total += (float) $valueOf($s, $m);
            }

            return $total;
        };
        $prevTo = $this->shift($to, -12);
        $series = array_map(fn (array $s) => ['key' => $s['key'], 'name' => $s['name'], 'unit' => $s['unit'], 'values' => array_map(fn ($m) => $valueOf($s, $m), $months),
            'previous_year' => array_map(fn ($m) => $valueOf($s, $this->shift($m, -12)), $months), 'latest' => $valueOf($s, $to), 'ytd' => $ytdOf($s, $to), 'ytd_previous_year' => $ytdOf($s, $prevTo)], $c['series']);

        $reconciliations = [];
        foreach ($c['reconcile'] as $spec) {
            $off = $spec['official'];
            $com = $spec['companion'] + ['factor' => 1];
            $officialRow = fn (array $only, string $m): array => $this->sumRaw($raw, $only, $m);
            $officialVal = fn (array $only, string $m): ?float => $ratio($officialRow($only, $m), $off);
            $companionVal = fn (array $only, string $m): ?float => $ratio($sum($only, $m), $com);
            // sumber tanpa laporan: bulan tanpa kejadian berarti nol. Pendamping berbasis laporan (`reported`, mis. DIFI): bulan yang laporannya belum ada tidak dibandingkan, bukan dianggap nol
            $reported = (bool) ($c['reported'] ?? false);
            $has = fn (string $u, string $m): bool => ($zeroFill || isset($raw[$u][$m])) && (! $reported || isset($data[$u][$m]));
            $monthly = [];
            foreach ($months as $m) {
                if ($spec['mode'] === 'net') {
                    $set = array_values(array_filter($units, fn ($u) => $has($u, $m) && $has($u, $this->shift($m, -1))));
                    $net = $set === [] ? null : (float) $officialVal($set, $m) - (float) $officialVal($set, $this->shift($m, -1));
                } elseif ($spec['mode'] === 'yoy') {
                    $set = array_values(array_filter($units, fn ($u) => $has($u, $m) && $has($u, $this->shift($m, -12))));
                    $net = $set === [] ? null : (float) $officialVal($set, $m) - (float) $officialVal($set, $this->shift($m, -12));
                } else {
                    $set = array_values(array_filter($units, fn ($u) => $has($u, $m)));
                    $net = $set === [] ? null : $officialVal($set, $m);
                }
                $comp = $set === [] ? ($reported ? null : $companionVal($units, $m)) : $companionVal($set, $m);
                $monthly[] = ['month' => $m, 'official_net' => $net, 'companion' => $comp, 'difference' => $net === null || $comp === null ? null : $comp - $net, 'units_compared' => count($set)];
            }
            /** Kumulatif Januari sampai $end atas ULP kandidat yang memenuhi syarat mode; null bila tidak ada. */
            $ytdFor = function (string $end, array $candidates) use ($spec, $has, $officialVal, $companionVal): ?array {
                $from = substr($end, 0, 4).'-01';
                $ytdMonths = $this->months($from, $end);
                if ($spec['mode'] === 'net') {
                    $base = $this->shift($from, -1);
                    $set = array_values(array_filter($candidates, fn ($u) => $has($u, $base) && $has($u, $end)));
                    $official = $set === [] ? null : (float) $officialVal($set, $end) - (float) $officialVal($set, $base);
                    $baseMonth = $base;
                } elseif ($spec['mode'] === 'yoy') {
                    $set = array_values(array_filter($candidates, fn ($u) => array_reduce($ytdMonths, fn ($ok, $m) => $ok && $has($u, $m) && $has($u, $this->shift($m, -12)), true)));
                    $official = $set === [] ? null : array_sum(array_map(fn ($m) => (float) $officialVal($set, $m) - (float) $officialVal($set, $this->shift($m, -12)), $ytdMonths));
                    $baseMonth = $from;
                } else {
                    $set = array_values(array_filter($candidates, fn ($u) => array_reduce($ytdMonths, fn ($ok, $m) => $ok && $has($u, $m), true)));
                    $official = $set === [] ? null : array_sum(array_map(fn ($m) => (float) $officialVal($set, $m), $ytdMonths));
                    $baseMonth = $from;
                }
                if ($set === [] || $official === null) {
                    return null;
                }
                $comp = array_sum(array_map(fn ($m) => (float) $companionVal($set, $m), $ytdMonths));

                return ['year' => (int) substr($end, 0, 4), 'base_month' => $baseMonth, 'to_month' => $end, 'official_net' => $official, 'companion' => $comp, 'difference' => $comp - $official, 'units' => $set];
            };
            $ytd = $ytdFor($to, $units);
            if ($ytd !== null) {
                // pembanding tahun lalu atas ULP yang sama (setara); ULP yang datanya tahun lalu tidak lengkap tidak ikut, dan jumlahnya terlihat pada units_compared
                $prev = $ytdFor($prevTo, $ytd['units']);
                $ytd['units_compared'] = count($ytd['units']);
                $ytd['units_expected'] = count($units);
                $ytd['previous_year'] = $prev === null ? null : ['base_month' => $prev['base_month'], 'to_month' => $prev['to_month'], 'official_net' => $prev['official_net'], 'companion' => $prev['companion'], 'difference' => $prev['difference'], 'units_compared' => count($prev['units'])];
                $ytd['official_change_pct'] = $prev === null ? null : $this->pct($ytd['official_net'], $prev['official_net']);
                $ytd['companion_change_pct'] = $prev === null ? null : $this->pct($ytd['companion'], $prev['companion']);
                unset($ytd['units']);
            }
            $reconciliations[] = ['key' => $spec['key'], 'mode' => $spec['mode'], 'unit' => $spec['unit'], 'official_name' => $spec['official_name'], 'companion_name' => $spec['companion_name'], 'monthly' => $monthly, 'ytd' => $ytd,
                'note' => $spec['mode'] === 'net'
                    ? 'Pendamping dicatat menurut tanggal kejadian, laporan resmi menurut bulan buku: nilai per bulan bisa bergeser, jadi selisih dinilai kumulatif Januari sampai bulan akhir. Selisih = angka pendamping dikurangi tambahan bersih resmi (antara lain pelanggan berhenti dan koreksi data).'
                    : ($spec['mode'] === 'yoy'
                        ? 'Perkiraan, bukan angka resmi: daya PB tersambung 12 bulan terakhir (termasuk bulan itu) per kelompok tarif dikali penjualan per kVA aktual kelompok itu (Laporan 309). PB yang baru tersambung dihitung penuh sehingga sedikit melebihkan; PB di luar kelompok S, R, B, I, P tidak dihitung. Angka resmi = kenaikan dibanding bulan yang sama tahun lalu (kumulatif: Januari sampai bulan akhir). Selisih = perkiraan dikurangi kenaikan resmi; negatif berarti sebagian besar kenaikan bukan dari pelanggan baru (konsumsi pelanggan lama, tarif, atau musim).'
                        : 'Dua sumber dicatat menurut waktu kejadian yang bisa bergeser antar bulan, jadi selisih dinilai kumulatif (jumlah nilai bulanan Januari sampai bulan akhir). Selisih = angka pendamping dikurangi angka resmi.')];
        }

        return ['companions' => ['source' => $c['source'], 'series' => $series], 'reconciliations' => $reconciliations];
    }

    /**
     * Jumlah angka mentah resmi atas ULP terpilih pada satu bulan.
     *
     * @param  array<string, array<string, array{raw: array<string, float>, bd: array<string, float>}>>  $raw
     * @param  list<string>  $only
     * @return array<string, float>
     */
    private function sumRaw(array $raw, array $only, string $m): array
    {
        $out = [];
        foreach ($only as $u) {
            foreach ($raw[$u][$m]['raw'] ?? [] as $k => $v) {
                $out[$k] = ($out[$k] ?? 0) + $v;
            }
        }

        return $out;
    }

    /**
     * Catatan otomatis dari rekonsiliasi kumulatif; null bila tidak ada yang layak dicatat.
     *
     * @param  array<string, mixed>  $rec
     */
    private function reconciliationInsight(array $rec): ?array
    {
        $y = $rec['ytd'];
        if ($y === null) {
            return ['level' => 'info', 'text' => 'Rekonsiliasi '.strtolower($rec['official_name']).' dengan '.strtolower($rec['companion_name']).' belum dapat dihitung kumulatif: data salah satu sumber belum ada untuk semua bulan pada ULP yang sama (bulan tanpa laporan tidak dibandingkan).'];
        }
        $unit = $rec['unit'];
        $f = fn (float $v) => match (true) {
            $unit === 'MVA' => number_format($v, 2, ',', '.'),
            str_contains($unit, '/plg') => number_format($v, 3, ',', '.'),
            default => number_format($v, 0, ',', '.'),
        };
        $head = sprintf('Kumulatif Januari sampai %s: %s %s %s, %s %s %s (selisih %s)', $this->label($y['to_month']), strtolower($rec['official_name']), $f($y['official_net']), $unit, strtolower($rec['companion_name']), $f($y['companion']), $unit, $f($y['difference']));
        if ($rec['mode'] === 'yoy') {
            $head = sprintf('Kumulatif Januari sampai %s: %s %s %s; perkiraan sumbangan pelanggan baru %s %s', $this->label($y['to_month']), strtolower($rec['official_name']), $f($y['official_net']), $unit, $f($y['companion']), $unit);
            if ($y['official_net'] <= 0) {
                return $y['companion'] > 0 ? ['level' => 'perhatian', 'text' => $head.'. Angka resmi tidak naik walau ada pelanggan baru: konsumsi pelanggan lama turun atau ada kehilangan penjualan.'] : null;
            }
            $share = $y['companion'] / $y['official_net'] * 100;
            if ($share > 100) {
                return ['level' => 'perhatian', 'text' => sprintf('%s (%.0f%% dari kenaikan resmi). Perkiraan melebihi kenaikan resmi: konsumsi pelanggan lama kemungkinan turun, atau pelanggan baru belum memakai sebesar rata-rata kelompoknya.', $head, $share)];
            }

            return ['level' => 'info', 'text' => sprintf('%s: sekitar %.0f%% dari kenaikan resmi dapat dijelaskan pelanggan baru (perkiraan); sisanya dari pelanggan lama, tarif, atau musim.', $head, $share)];
        }
        if ($rec['mode'] === 'flow') {
            if ($y['official_net'] <= 0) {
                return $y['companion'] > 0 ? ['level' => 'perhatian', 'text' => $head.'. Laporan resmi nol tetapi data pendamping mencatat kejadian: periksa laporan atau data sumber.'] : null;
            }
            $r = $y['companion'] / $y['official_net'];
            if ($r < 0.5 || $r > 1.5) {
                return ['level' => 'perhatian', 'text' => sprintf('%s. Data pendamping %.0f%% dari angka resmi: cakupan atau definisi kedua sumber berbeda, atau salah satu sumber belum lengkap.', $head, $r * 100)];
            }

            return ['level' => 'info', 'text' => $head.'.'];
        }
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
