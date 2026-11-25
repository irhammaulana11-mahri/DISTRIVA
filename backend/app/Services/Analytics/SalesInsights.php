<?php

namespace App\Services\Analytics;

/**
 * Pemecahan perubahan tahunan kWh jual dan pendapatan menurut golongan tarif (docs/92 §6.2 dan §6.3), dari laporan 309 per golongan (`grup-309`).
 *
 * Tiap bulan dipecah tepat (jumlah efek = perubahan), lalu tahun berjalan = jumlah efek bulanan Januari sampai bulan akhir:
 *  - kWh = N × Σ s_g k_g (N pelanggan, s_g porsi pelanggan golongan g, k_g kWh per pelanggan): efek pelanggan = (N1 − N0) × k̄0; efek campuran = N1 × Σ (s1 − s0) k0; efek kWh per pelanggan = N1 × Σ s1 (k1 − k0).
 *  - Rp = K × Σ w_g p_g (K kWh, w_g porsi kWh, p_g Rp per kWh): efek volume = (K1 − K0) × p̄0; efek campuran golongan = K1 × Σ (w1 − w0) p0; efek tarif = K1 × Σ w1 (p1 − p0).
 * Hanya ULP yang punya laporan di kedua titik yang dibandingkan.
 */
class SalesInsights
{
    private const GROUPS = ['S' => 'Sosial', 'R' => 'Rumah tangga', 'B' => 'Bisnis', 'I' => 'Industri', 'P' => 'Pemerintah', 'T' => 'Traksi', 'C' => 'Curah', 'L' => 'Layanan khusus'];

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function decomposition(string $code, array $units, string $to): array
    {
        $year = substr($to, 0, 4);
        $prevYear = (string) ((int) $year - 1);
        $raw = $this->metrics->raw('grup-309', $units, $prevYear.'-01', $to);
        $months = [];
        for ($m = 1; $m <= (int) substr($to, 5, 2); $m++) {
            $months[] = sprintf('%s-%02d', $year, $m);
        }

        $month = $this->compare($raw, $units, $to, $this->shift($to, -12));
        $additive = ['kwh' => ['total', 'previous', 'change', 'customers', 'mix', 'intensity', 'residual'], 'rp' => ['total', 'previous', 'change', 'volume', 'mix', 'price', 'residual']];
        $ytd = ['kwh' => array_fill_keys($additive['kwh'], null), 'rp' => array_fill_keys($additive['rp'], null)];
        $ytdMonths = [];
        $monthly = [];
        foreach ($months as $m) {
            $c = $this->compare($raw, $units, $m, $this->shift($m, -12));
            if ($c === null) {
                continue;
            }
            $ytdMonths[] = $m;
            $monthly[] = ['month' => $m, 'units_compared' => $c['units_compared'], 'kwh' => array_intersect_key($c['kwh'], array_flip(['total', 'previous', 'change', 'customers', 'mix', 'intensity'])),
                'rp' => array_intersect_key($c['rp'], array_flip(['total', 'previous', 'change', 'volume', 'mix', 'price'])), 'price_per_kwh' => $c['kwh']['total'] > 0 ? $c['rp']['total'] / $c['kwh']['total'] : null,
                'price_per_kwh_previous' => $c['kwh']['previous'] > 0 ? $c['rp']['previous'] / $c['kwh']['previous'] : null];
            foreach ($additive as $k => $names) {
                foreach ($names as $name) {
                    $v = $c[$k][$name] ?? null;
                    $v !== null && $ytd[$k][$name] = ($ytd[$k][$name] ?? 0.0) + $v;
                }
            }
        }
        foreach (['kwh', 'rp'] as $k) {
            $ytd[$k]['change_pct'] = ($ytd[$k]['previous'] ?? 0) > 0 ? round(($ytd[$k]['total'] / $ytd[$k]['previous'] - 1) * 100, 2) : null;
        }

        if ($month === null && $ytdMonths === []) {
            return ['kind' => 'sales_decomposition', 'available' => false, 'focus' => $code, 'reason' => 'Belum ada laporan 309 per golongan pada bulan itu dan bulan yang sama tahun lalu.'];
        }

        return ['kind' => 'sales_decomposition', 'available' => true, 'focus' => $code, 'month' => $month === null ? null : ['month' => $to, 'previous' => $this->shift($to, -12)] + $month,
            'ytd' => ['from' => $year.'-01', 'to' => $to, 'months_compared' => count($ytdMonths), 'months' => $ytdMonths, 'kwh' => $this->round($ytd['kwh']), 'rp' => $this->round($ytd['rp'])], 'monthly' => $monthly,
            'findings' => $this->findings($month, $monthly, $ytd, $this->priorYearMedianPrice($raw, $units, $prevYear)),
            'notes' => ['Pemecahan memakai laporan 309 per golongan tarif (S, R, B, I, P, T, C, L) dan hanya ULP yang punya laporan pada kedua bulan yang dibandingkan; jumlah efek sama dengan perubahan.',
                'kWh: efek pelanggan = perubahan jumlah pelanggan × kWh per pelanggan rata-rata tahun lalu; efek campuran = pergeseran porsi pelanggan antar golongan; efek kWh per pelanggan = perubahan konsumsi tiap pelanggan dalam golongannya.',
                'Pendapatan: efek volume = perubahan kWh × harga rata-rata tahun lalu; efek campuran = pergeseran porsi kWh antar golongan; efek tarif = perubahan Rp per kWh dalam golongan (tarif dan subsidi).',
                'Tahun berjalan = jumlah pemecahan bulanan Januari sampai bulan akhir (bulan tanpa laporan di salah satu tahun dilewati).']];
    }

    /**
     * Catatan otomatis atas pemecahan: (1) efek dasar rendah: bulan tahun lalu dengan Rp per kWh jauh di bawah biasanya (mis. diskon tarif) yang menyumbang sebagian besar efek tarif tahun berjalan;
     * (2) pergeseran golongan: pelanggan golongan besar naik tajam sementara kWh per pelanggannya turun tajam, sehingga efek campuran dan efek kWh per pelanggan saling meniadakan.
     *
     * @param  array<string, mixed>|null  $month
     * @param  list<array<string, mixed>>  $monthly
     * @param  array<string, array<string, ?float>>  $ytd
     * @return list<array{level: string, kind: string, text: string}>
     */
    private function findings(?array $month, array $monthly, array $ytd, ?float $median): array
    {
        $out = [];
        if ($median !== null && ($ytd['rp']['price'] ?? 0) > 0) {
            $low = array_values(array_filter($monthly, fn ($m) => $m['price_per_kwh_previous'] !== null && $m['price_per_kwh_previous'] < 0.9 * $median && ($m['rp']['price'] ?? 0) > 0));
            $lowEffect = array_sum(array_map(fn ($m) => $m['rp']['price'], $low));
            if (count($low) >= 1 && $lowEffect / $ytd['rp']['price'] >= 0.5) {
                $out[] = ['level' => 'perhatian', 'kind' => 'base_effect', 'text' => sprintf('Efek tarif tahun berjalan %s miliar, %s miliar (%s%%) berasal dari %s yang tahun lalu memiliki Rp per kWh rata-rata hanya %s lawan %s pada bulan biasa: pertumbuhan pendapatan bulan itu sebagian efek dasar rendah (periksa kejadian tarif tahun lalu, mis. diskon tarif), bukan kenaikan penjualan.',
                    $this->billions($ytd['rp']['price']), $this->billions($lowEffect), number_format($lowEffect / $ytd['rp']['price'] * 100, 0, ',', '.'), implode(', ', array_map(fn ($m) => $m['month'], $low)),
                    number_format(array_sum(array_map(fn ($m) => $m['price_per_kwh_previous'], $low)) / count($low), 0, ',', '.'), number_format($median, 0, ',', '.'))];
            }
        }
        $totalKwh = $month['kwh']['total'] ?? 0;
        foreach ($month['groups'] ?? [] as $g) {
            if ($g['plg_previous'] > 0 && $g['plg'] / $g['plg_previous'] >= 1.25 && ($g['kwh_per_plg_previous'] ?? 0) > 0 && ($g['kwh_per_plg'] ?? 0) <= 0.9 * $g['kwh_per_plg_previous'] && $totalKwh > 0 && $g['kwh'] / $totalKwh >= 0.05) {
                $out[] = ['level' => 'perhatian', 'kind' => 'group_shift', 'text' => sprintf('Golongan %s: pelanggan naik %s%% (%s menjadi %s) tetapi kWh per pelanggan turun %s%% (%s menjadi %s kWh): efek campuran dan efek kWh per pelanggan saling meniadakan; kemungkinan pelanggan pindah golongan atau banyak pelanggan kecil baru, bukan perubahan konsumsi.',
                    $g['name'], number_format(($g['plg'] / $g['plg_previous'] - 1) * 100, 0, ',', '.'), number_format($g['plg_previous'], 0, ',', '.'), number_format($g['plg'], 0, ',', '.'),
                    number_format((1 - $g['kwh_per_plg'] / $g['kwh_per_plg_previous']) * 100, 0, ',', '.'), number_format($g['kwh_per_plg_previous'], 0, ',', '.'), number_format($g['kwh_per_plg'], 0, ',', '.'))];
            }
        }

        return $out;
    }

    /**
     * Median Rp per kWh bulanan sepanjang tahun lalu (semua golongan, ULP yang punya laporan bulan itu); null bila kurang dari enam bulan yang tersedia.
     *
     * @param  array<string, array<string, array{raw: array<string, float>}>>  $raw
     * @param  list<string>  $units
     */
    private function priorYearMedianPrice(array $raw, array $units, string $year): ?float
    {
        $prices = [];
        for ($m = 1; $m <= 12; $m++) {
            $month = sprintf('%s-%02d', $year, $m);
            $kwh = 0.0;
            $rp = 0.0;
            foreach ($units as $u) {
                foreach (array_keys(self::GROUPS) as $g) {
                    $kwh += (float) ($raw[$u][$month]['raw']["kwh_{$g}"] ?? 0);
                    $rp += (float) ($raw[$u][$month]['raw']["rp_{$g}"] ?? 0);
                }
            }
            $kwh > 0 && $prices[] = $rp / $kwh;
        }

        return count($prices) >= 6 ? $this->median($prices) : null;
    }

    private function billions(float $v): string
    {
        return number_format($v / 1e9, 1, ',', '.');
    }

    /** @param list<float> $values */
    private function median(array $values): float
    {
        sort($values);
        $n = count($values);

        return $n % 2 === 1 ? (float) $values[intdiv($n, 2)] : ($values[$n / 2 - 1] + $values[$n / 2]) / 2;
    }

    /**
     * @param  array<string, array<string, array{raw: array<string, float>}>>  $raw
     * @param  list<string>  $units
     * @return array<string, mixed>|null
     */
    private function compare(array $raw, array $units, string $now, string $before): ?array
    {
        $common = array_values(array_filter($units, fn ($u) => isset($raw[$u][$now], $raw[$u][$before])));
        if ($common === []) {
            return null;
        }
        $sum = function (string $m) use ($raw, $common): array {
            $out = [];
            foreach (array_keys(self::GROUPS) as $g) {
                $out[$g] = ['plg' => 0.0, 'kwh' => 0.0, 'rp' => 0.0];
                foreach ($common as $u) {
                    $r = $raw[$u][$m]['raw'];
                    $out[$g]['plg'] += (float) ($r["plg_{$g}"] ?? 0);
                    $out[$g]['kwh'] += (float) ($r["kwh_{$g}"] ?? 0);
                    $out[$g]['rp'] += (float) ($r["rp_{$g}"] ?? 0);
                }
            }

            return $out;
        };
        $a = $sum($now);
        $b = $sum($before);
        $n1 = array_sum(array_column($a, 'plg'));
        $n0 = array_sum(array_column($b, 'plg'));
        $k1 = array_sum(array_column($a, 'kwh'));
        $k0 = array_sum(array_column($b, 'kwh'));
        $r1 = array_sum(array_column($a, 'rp'));
        $r0 = array_sum(array_column($b, 'rp'));

        $kwh = ['total' => $k1, 'previous' => $k0, 'change' => $k1 - $k0, 'change_pct' => $k0 > 0 ? round(($k1 / $k0 - 1) * 100, 2) : null, 'customers' => null, 'mix' => null, 'intensity' => null];
        if ($n0 > 0 && $n1 > 0) {                                                                                       // tanpa pelanggan per golongan efek tidak dapat dipecah
            $mean0 = $k0 / $n0;
            $mix = 0.0;
            $intensity = 0.0;
            foreach (array_keys(self::GROUPS) as $g) {
                $k0g = $b[$g]['plg'] > 0 ? $b[$g]['kwh'] / $b[$g]['plg'] : 0.0;
                $k1g = $a[$g]['plg'] > 0 ? $a[$g]['kwh'] / $a[$g]['plg'] : 0.0;
                $s1 = $a[$g]['plg'] / $n1;
                $s0 = $b[$g]['plg'] / $n0;
                $mix += $n1 * ($s1 - $s0) * $k0g;
                $intensity += $a[$g]['plg'] > 0 ? $n1 * $s1 * ($k1g - ($b[$g]['plg'] > 0 ? $k0g : $k1g)) : 0.0;           // golongan baru tanpa pembanding: tidak ada efek konsumsi
            }
            $customers = ($n1 - $n0) * $mean0;
            $kwh['customers'] = $customers;
            $kwh['mix'] = $mix;
            $kwh['intensity'] = $intensity;
            $kwh['residual'] = ($k1 - $k0) - ($customers + $mix + $intensity);                                         // nol bila semua golongan ada di kedua titik
        }

        $rp = ['total' => $r1, 'previous' => $r0, 'change' => $r1 - $r0, 'change_pct' => $r0 > 0 ? round(($r1 / $r0 - 1) * 100, 2) : null, 'volume' => null, 'mix' => null, 'price' => null];
        if ($k0 > 0 && $k1 > 0) {
            $price0 = $r0 / $k0;
            $mix = 0.0;
            $price = 0.0;
            foreach (array_keys(self::GROUPS) as $g) {
                $p0 = $b[$g]['kwh'] > 0 ? $b[$g]['rp'] / $b[$g]['kwh'] : 0.0;
                $p1 = $a[$g]['kwh'] > 0 ? $a[$g]['rp'] / $a[$g]['kwh'] : 0.0;
                $w1 = $a[$g]['kwh'] / $k1;
                $w0 = $b[$g]['kwh'] / $k0;
                $mix += $k1 * ($w1 - $w0) * $p0;
                $price += $a[$g]['kwh'] > 0 ? $k1 * $w1 * ($p1 - ($b[$g]['kwh'] > 0 ? $p0 : $p1)) : 0.0;
            }
            $volume = ($k1 - $k0) * $price0;
            $rp['volume'] = $volume;
            $rp['mix'] = $mix;
            $rp['price'] = $price;
            $rp['residual'] = ($r1 - $r0) - ($volume + $mix + $price);
        }

        $changeKwh = $k1 - $k0;
        $groups = [];
        foreach (self::GROUPS as $g => $label) {
            if ($a[$g]['plg'] + $b[$g]['plg'] + $a[$g]['kwh'] + $b[$g]['kwh'] <= 0) {
                continue;
            }
            $groups[] = ['key' => $g, 'name' => $label, 'plg' => $a[$g]['plg'], 'plg_previous' => $b[$g]['plg'], 'kwh' => $a[$g]['kwh'], 'kwh_previous' => $b[$g]['kwh'], 'kwh_change' => $a[$g]['kwh'] - $b[$g]['kwh'],
                'kwh_share_of_change_pct' => $changeKwh != 0 ? round(($a[$g]['kwh'] - $b[$g]['kwh']) / $changeKwh * 100, 1) : null, 'kwh_per_plg' => $a[$g]['plg'] > 0 ? $a[$g]['kwh'] / $a[$g]['plg'] : null,
                'kwh_per_plg_previous' => $b[$g]['plg'] > 0 ? $b[$g]['kwh'] / $b[$g]['plg'] : null, 'rp' => $a[$g]['rp'], 'rp_previous' => $b[$g]['rp'], 'rp_per_kwh' => $a[$g]['kwh'] > 0 ? $a[$g]['rp'] / $a[$g]['kwh'] : null,
                'rp_per_kwh_previous' => $b[$g]['kwh'] > 0 ? $b[$g]['rp'] / $b[$g]['kwh'] : null, 'rp_change' => $a[$g]['rp'] - $b[$g]['rp']];
        }
        usort($groups, fn ($x, $y) => abs($y['kwh_change']) <=> abs($x['kwh_change']));

        return ['units_compared' => count($common), 'customers' => ['total' => $n1, 'previous' => $n0, 'change' => $n1 - $n0], 'kwh' => $kwh, 'rp' => $rp, 'groups' => $groups];
    }

    /**
     * @param  array<string, ?float>  $v
     * @return array<string, ?float>
     */
    private function round(array $v): array
    {
        return array_map(fn ($x) => $x === null ? null : round((float) $x, 2), $v);
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.sprintf('%+d', $by).' month'));
    }
}
