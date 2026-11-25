<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Proksi susut teknis dari pengukuran gardu (docs/92 §6.10): pengukuran gardu PLN terakhir (satu per tahun) memberi persen beban dan arus per fasa. Dari sana dihitung beban lebih, ketidakseimbangan
 * beban, dan **indeks rugi tembaga relatif** = (beban/100)^2 x (1 + 3 x ketidakseimbangan^2) tanpa satuan, bukan kWh: dipakai untuk membandingkan ULP dan mengurutkan gardu, bukan menghitung susut.
 * Tegangan jatuh tidak dihitung karena tegangan ujung tidak tersedia pada pengukuran. Hubungan dengan susut resmi hanya korelasi antar ULP (susut juga memuat susut nonteknis).
 */
class TechnicalLossProxy
{
    public const HIGH_LOAD_PCT = 80.0;

    public const OVERLOAD_PCT = 100.0;

    /** Ketidakseimbangan (rata-rata simpangan arus fasa terhadap rata-rata fasa, %) di atas ini dianggap tinggi; ambang kerja, keputusan terbuka docs/92 §10. */
    public const UNBALANCE_HIGH_PCT = 25.0;

    /** Arus fasa rata-rata minimum (A) agar ketidakseimbangan bermakna. */
    private const MIN_AVG_CURRENT = 5.0;

    /** Beban di atas ini dianggap kemungkinan salah ukur atau salah kapasitas: ditandai `data_diragukan` dan dibatasi sebesar ini dalam perhitungan indeks dan rata-rata. */
    public const LOADING_CAP_PCT = 200.0;

    private const READING_MAX_AGE_MONTHS = 14;

    private const WATCH = 15;

    private const MIN_ULPS_FOR_CORRELATION = 6;

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  array<string, float>  $susutByUnit  susut kumulatif tahun berjalan (%) per ULP, untuk korelasi
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to, array $susutByUnit): array
    {
        $end = date('Y-m-t', (int) strtotime($to.'-01'));
        $from = date('Y-m-01', (int) strtotime($to.'-01 -'.self::READING_MAX_AGE_MONTHS.' month'));
        $placeholders = implode(',', array_fill(0, count($units), '?'));
        $rows = DB::select("with last as (select distinct on (substation_id) * from substation_readings where measured_on between ? and ? order by substation_id, measured_on desc)
            select s.id, s.code, s.name, s.feeder_code, s.kecamatan, s.organizational_unit_id as unit_id, o.name as unit_name, l.measured_on, coalesce(l.capacity_kva, s.capacity_kva) as cap, l.loading_pct, l.load_kva,
            l.current_r_a as r, l.current_s_a as s_, l.current_t_a as t, l.current_n_a as n_ from last l join substations s on s.id = l.substation_id join organizational_units o on o.id = s.organizational_unit_id
            where s.ownership = 'PLN' and s.organizational_unit_id in ({$placeholders})", [$from, $end, ...array_values($units)]);

        $gardu = [];
        foreach ($rows as $x) {
            $cap = (float) $x->cap;
            $loading = $x->loading_pct !== null ? (float) $x->loading_pct : ($cap > 0 && $x->load_kva !== null ? (float) $x->load_kva / $cap * 100 : null);
            if ($loading === null || $cap <= 0) {
                continue;
            }
            $rawLoading = $loading;
            $loading = min($loading, self::LOADING_CAP_PCT);
            $currents = [(float) $x->r, (float) $x->s_, (float) $x->t];
            $avg = array_sum($currents) / 3;
            $unbalance = $avg >= self::MIN_AVG_CURRENT ? (abs($currents[0] - $avg) + abs($currents[1] - $avg) + abs($currents[2] - $avg)) / (3 * $avg) * 100 : null;
            $index = ($loading / 100) ** 2 * (1 + 3 * (($unbalance ?? 0) / 100) ** 2);
            $flags = array_values(array_filter([$loading > self::OVERLOAD_PCT ? 'beban_lebih' : ($loading > self::HIGH_LOAD_PCT ? 'beban_tinggi' : null), $unbalance !== null && $unbalance > self::UNBALANCE_HIGH_PCT ? 'tidak_seimbang' : null,
                $rawLoading > self::LOADING_CAP_PCT ? 'data_diragukan' : null]));
            $gardu[] = ['id' => $x->id, 'code' => $x->code, 'name' => $x->name, 'feeder_code' => $x->feeder_code, 'kecamatan' => $x->kecamatan, 'unit_id' => $x->unit_id, 'unit_name' => $x->unit_name, 'measured_on' => (string) $x->measured_on, 'cap' => $cap,
                'loading' => $loading, 'loading_raw' => $rawLoading, 'unbalance' => $unbalance, 'neutral_ratio' => $avg >= self::MIN_AVG_CURRENT && $x->n_ !== null ? (float) $x->n_ / $avg * 100 : null, 'index' => $index, 'flags' => $flags];
        }
        if ($gardu === []) {
            return ['available' => false, 'reason' => 'Belum ada pengukuran gardu PLN dalam '.self::READING_MAX_AGE_MONTHS.' bulan terakhir pada cakupan ini.'];
        }

        $ulps = $this->ulps($gardu);
        $watch = $gardu;
        usort($watch, fn ($a, $b) => $b['index'] * $b['cap'] <=> $a['index'] * $a['cap']);

        return ['available' => true, 'readings_from' => $from, 'readings_to' => $end, 'proxy' => 'indeks_rugi_tembaga_relatif', 'thresholds' => ['high_load_pct' => self::HIGH_LOAD_PCT, 'overload_pct' => self::OVERLOAD_PCT, 'unbalance_high_pct' => self::UNBALANCE_HIGH_PCT],
            'ulps' => $ulps, 'correlation' => $this->correlation($ulps, $susutByUnit),
            'watchlist' => array_map(fn ($g) => ['substation_id' => $g['id'], 'code' => $g['code'], 'name' => $g['name'], 'feeder_code' => $g['feeder_code'], 'kecamatan' => $g['kecamatan'], 'unit_id' => $g['unit_id'], 'unit_name' => $g['unit_name'], 'measured_on' => $g['measured_on'],
                'capacity_kva' => round($g['cap'], 1), 'loading_pct' => round($g['loading_raw'], 1), 'unbalance_pct' => $g['unbalance'] === null ? null : round($g['unbalance'], 1), 'neutral_current_pct' => $g['neutral_ratio'] === null ? null : round($g['neutral_ratio'], 1),
                'loss_index' => round($g['index'], 3), 'flags' => $g['flags']], array_slice($watch, 0, self::WATCH)),
            'notes' => ['Proksi dari pengukuran gardu PLN terakhir (satu pengukuran per gardu per tahun, bukan beban sepanjang tahun). Indeks rugi tembaga relatif = (beban/100)^2 x (1 + 3 x ketidakseimbangan^2), tanpa satuan: untuk membandingkan, bukan menghitung kWh susut. Beban di atas '.self::LOADING_CAP_PCT.'% ditandai `data_diragukan` (kemungkinan salah ukur atau salah kapasitas) dan dibatasi '.self::LOADING_CAP_PCT.'% dalam perhitungan; periksa data gardu itu lebih dulu.',
                'Ketidakseimbangan = rata-rata simpangan arus fasa R, S, T terhadap rata-ratanya (%), dihitung bila arus fasa rata-rata minimal '.self::MIN_AVG_CURRENT.' A. Tegangan jatuh tidak dihitung karena tegangan ujung tidak tersedia.',
                'Daftar gardu prioritas diurut menurut indeks x kapasitas (kontribusi rugi relatif terbesar). Hubungan dengan susut resmi hanya korelasi antar ULP: susut juga memuat susut nonteknis (pencurian, kesalahan baca) yang tidak terlihat di sini.']];
    }

    /**
     * @param  list<array<string, mixed>>  $gardu
     * @return list<array<string, mixed>>
     */
    private function ulps(array $gardu): array
    {
        $by = [];
        foreach ($gardu as $g) {
            $b = &$by[$g['unit_id']];
            $b ??= ['name' => $g['unit_name'], 'n' => 0, 'cap' => 0.0, 'lp' => 0.0, 'over' => 0, 'high' => 0, 'un_n' => 0, 'un' => 0.0, 'un_cap' => 0.0, 'un_high' => 0, 'idx' => 0.0, 'idx_cap' => 0.0];
            $b['n']++;
            $b['cap'] += $g['cap'];
            $b['lp'] += $g['loading'] * $g['cap'];
            $g['loading'] > self::OVERLOAD_PCT && $b['over']++;
            $g['loading'] > self::HIGH_LOAD_PCT && $b['high']++;
            if ($g['unbalance'] !== null) {
                $b['un_n']++;
                $b['un'] += $g['unbalance'] * $g['cap'];
                $b['un_cap'] += $g['cap'];
                $g['unbalance'] > self::UNBALANCE_HIGH_PCT && $b['un_high']++;
                $b['idx'] += $g['index'] * $g['cap'];
                $b['idx_cap'] += $g['cap'];
            }
            unset($b);
        }
        $out = [];
        foreach ($by as $u => $b) {
            $out[] = ['unit_id' => $u, 'unit_name' => $b['name'], 'substations' => $b['n'], 'capacity_mva' => round($b['cap'] / 1000, 2), 'avg_loading_pct' => round($b['lp'] / $b['cap'], 1), 'overload_pct_of_substations' => round($b['over'] / $b['n'] * 100, 1),
                'high_load_pct_of_substations' => round($b['high'] / $b['n'] * 100, 1), 'avg_unbalance_pct' => $b['un_cap'] > 0 ? round($b['un'] / $b['un_cap'], 1) : null, 'unbalanced_pct_of_measured' => $b['un_n'] > 0 ? round($b['un_high'] / $b['un_n'] * 100, 1) : null,
                'loss_index' => $b['idx_cap'] > 0 ? round($b['idx'] / $b['idx_cap'], 3) : null];
        }
        usort($out, fn ($a, $b) => ($b['loss_index'] ?? 0) <=> ($a['loss_index'] ?? 0));

        return $out;
    }

    /**
     * Korelasi peringkat (Spearman) antar ULP antara indeks rugi dan beban rata-rata dengan susut kumulatif, bila cukup ULP; kecil jumlahnya, jadi hanya petunjuk.
     *
     * @param  list<array<string, mixed>>  $ulps
     * @param  array<string, float>  $susutByUnit
     * @return array<string, mixed>
     */
    private function correlation(array $ulps, array $susutByUnit): array
    {
        $pairs = array_values(array_filter($ulps, fn ($u) => $u['loss_index'] !== null && isset($susutByUnit[$u['unit_id']])));
        if (count($pairs) < self::MIN_ULPS_FOR_CORRELATION) {
            return ['available' => false, 'reason' => 'Perlu paling sedikit '.self::MIN_ULPS_FOR_CORRELATION.' ULP dengan susut dan pengukuran gardu.'];
        }
        $susut = array_map(fn ($u) => (float) $susutByUnit[$u['unit_id']], $pairs);

        return ['available' => true, 'method' => 'spearman', 'ulps' => count($pairs), 'loss_index' => $this->spearman(array_column($pairs, 'loss_index'), $susut), 'avg_loading' => $this->spearman(array_column($pairs, 'avg_loading_pct'), $susut),
            'avg_unbalance' => $this->spearman(array_map(fn ($u) => $u['avg_unbalance_pct'] ?? 0.0, $pairs), $susut), 'note' => 'Korelasi peringkat antar ULP, bukan sebab-akibat; dengan jumlah ULP sekecil ini hanya petunjuk.'];
    }

    /** @param  list<float>  $x */
    private function spearman(array $x, array $y): ?float
    {
        $rank = function (array $v): array {
            $idx = array_keys($v);
            usort($idx, fn ($a, $b) => $v[$a] <=> $v[$b]);
            $r = [];
            $i = 0;
            while ($i < count($idx)) {
                $j = $i;
                while ($j + 1 < count($idx) && $v[$idx[$j + 1]] == $v[$idx[$i]]) {
                    $j++;
                }
                for ($k = $i; $k <= $j; $k++) {
                    $r[$idx[$k]] = ($i + $j) / 2 + 1;
                }
                $i = $j + 1;
            }
            ksort($r);

            return $r;
        };
        $rx = $rank($x);
        $ry = $rank($y);
        $n = count($rx);
        $mx = array_sum($rx) / $n;
        $my = array_sum($ry) / $n;
        $c = $sx = $sy = 0.0;
        foreach ($rx as $i => $v) {
            $c += ($v - $mx) * ($ry[$i] - $my);
            $sx += ($v - $mx) ** 2;
            $sy += ($ry[$i] - $my) ** 2;
        }

        return $sx > 0 && $sy > 0 ? round($c / sqrt($sx * $sy), 2) : null;
    }
}
