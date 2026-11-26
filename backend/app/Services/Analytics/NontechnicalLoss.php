<?php

namespace App\Services\Analytics;

/**
 * Susut di luar yang dijelaskan beban gardu, per ULP (docs/92 §6.10): susut kumulatif dibandingkan dengan yang diharapkan dari beban rata-rata gardu (garis lurus antar ULP pilihan), sisanya adalah
 * "sisa susut" (susut nonteknis, kesalahan baca, dan faktor lain yang tak terlihat dari gardu), lalu disandingkan dengan penertiban P2TL. Hanya sandingan dan korelasi peringkat antar ULP: P2TL tidak
 * terbukti menurunkan susut; ULP bersusut tinggi cenderung ditertibkan lebih banyak (penertiban menyasar susut tinggi), jadi arah hubungannya bukan sebab-akibat.
 */
class NontechnicalLoss
{
    public const MIN_ULPS = 6;

    /** Sisa susut ditandai di atas atau di bawah harapan bila menyimpang lebih dari ini simpangan baku sisa. */
    public const FLAG_SIGMA = 1.0;

    public function __construct(private readonly TechnicalLossProxy $technical) {}

    /**
     * @param  array<string, array{name: string, susut: float, loading: float, jual_kwh: float, p2tl_kwh: float, p2tl_cases: float, customers: float}>  $rows  kunci: unit_id
     * @return array<string, mixed>
     */
    public function analyze(array $rows): array
    {
        $rows = array_filter($rows, fn ($r) => $r['jual_kwh'] > 0);
        if (count($rows) < self::MIN_ULPS) {
            return ['available' => false, 'reason' => 'Perlu paling sedikit '.self::MIN_ULPS.' ULP dengan susut, pengukuran gardu, dan data P2TL.'];
        }
        $x = array_column($rows, 'loading');
        $y = array_column($rows, 'susut');
        $n = count($rows);
        $mx = array_sum($x) / $n;
        $my = array_sum($y) / $n;
        $sxx = array_sum(array_map(fn ($v) => ($v - $mx) ** 2, $x));
        $slope = $sxx > 0 ? array_sum(array_map(fn ($a, $b) => ($a - $mx) * ($b - $my), $x, $y)) / $sxx : 0.0;
        $residual = [];
        foreach ($rows as $u => $r) {
            $residual[$u] = $r['susut'] - ($my + $slope * ($r['loading'] - $mx));
        }
        $sd = sqrt(array_sum(array_map(fn ($v) => $v ** 2, $residual)) / $n);

        $out = [];
        foreach ($rows as $u => $r) {
            $z = $sd > 0 ? $residual[$u] / $sd : 0.0;
            $out[] = ['unit_id' => $u, 'unit_name' => $r['name'], 'ytd_susut_pct' => round($r['susut'], 2), 'avg_loading_pct' => round($r['loading'], 1), 'expected_from_load_pct' => round($my + $slope * ($r['loading'] - $mx), 2),
                'residual_pct_points' => round($residual[$u], 2), 'residual_flag' => $z > self::FLAG_SIGMA ? 'di_atas_harapan' : ($z < -self::FLAG_SIGMA ? 'di_bawah_harapan' : null),
                'p2tl_pct_of_sales' => round($r['p2tl_kwh'] / $r['jual_kwh'] * 100, 2), 'p2tl_cases_per_1000_customers' => $r['customers'] > 0 ? round($r['p2tl_cases'] / $r['customers'] * 1000, 1) : null,
                'p2tl_kwh_per_case' => $r['p2tl_cases'] > 0 ? round($r['p2tl_kwh'] / $r['p2tl_cases']) : null];
        }
        usort($out, fn ($a, $b) => $b['residual_pct_points'] <=> $a['residual_pct_points']);
        $units = array_keys($rows);
        $p2 = array_map(fn ($u) => $rows[$u]['p2tl_kwh'] / $rows[$u]['jual_kwh'], $units);

        return ['available' => true, 'ulps_count' => $n, 'fit' => ['slope_pct_points_per_loading_pct' => round($slope, 3), 'residual_sd' => round($sd, 2)], 'ulps' => $out,
            'correlation' => ['method' => 'spearman', 'susut_vs_p2tl_pct' => $this->technical->spearman($p2, array_map(fn ($u) => $rows[$u]['susut'], $units)),
                'residual_vs_p2tl_pct' => $this->technical->spearman($p2, array_map(fn ($u) => $residual[$u], $units)), 'note' => 'Korelasi peringkat antar ULP, bukan sebab-akibat; dengan jumlah ULP sekecil ini hanya petunjuk.'],
            'notes' => ['Sisa susut = susut kumulatif dikurangi yang diharapkan dari beban rata-rata gardu (garis lurus antar ULP pilihan); nilai positif berarti susut lebih tinggi daripada yang dapat dijelaskan beban gardu.',
                'P2TL (kWh hasil penertiban per kWh jual) disandingkan dengan susut, bukan dianggap penyebab atau penurunnya: ULP bersusut tinggi cenderung ditertibkan lebih banyak.']];
    }
}
