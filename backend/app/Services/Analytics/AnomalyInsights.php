<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan anomali penanganan pengaduan untuk menu Anomali Gangguan dan Keluhan (docs/92 §6.8), dari data APKT (berulang dan rating negatif per ULP per bulan). Kejadian anomali sangat jarang
 * (puluhan per bulan dari ribuan WO), sehingga angka per ULP per bulan hanya berisik: analisa dibuat di tingkat tahun berjalan, dengan uji kejadian jarang (Poisson) untuk menandai ULP yang
 * benar-benar lebih banyak dari porsi WO-nya. Tanpa prakiraan: tidak ada pola yang bisa diandalkan dan hubungan dengan RCT tidak terbukti (docs/92 §6.8).
 */
class AnomalyInsights
{
    /** ULP ditandai bila anomalinya melebihi harapan menurut porsi WO sebanyak ini simpangan baku Poisson, dan paling sedikit ini kejadian. */
    public const FLAG_SIGMA = 2.0;

    public const FLAG_MIN_EVENTS = 5;

    private const HISTORY_MONTHS = 12;

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(string $code, array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $gangguan = $code === 'anomali-gangguan';
        $year = substr($to, 0, 4);
        $from = min($year.'-01', date('Y-m', (int) strtotime($to.'-01 -'.(self::HISTORY_MONTHS - 1).' month')));
        $raw = $this->metrics->raw($code, $units, $from, $to);
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        $ytd = [];
        $channels = [];
        $history = [];
        foreach ($raw as $u => $byMonth) {
            foreach ($byMonth as $m => $cell) {
                $r = $cell['raw'];
                if ($m >= $from && $m <= $to) {
                    $h = &$history[$m];
                    $h ??= ['month' => $m, 'wo' => 0.0, 'berulang' => 0.0, 'negatif' => 0.0];
                    $h['wo'] += $r['wo'];
                    $h['berulang'] += $r['ber'];
                    $h['negatif'] += $r['neg'];
                    unset($h);
                }
                if (substr($m, 0, 4) !== $year) {
                    continue;
                }
                $y = &$ytd[$u];
                $y ??= ['wo' => 0.0, 'berulang' => 0.0, 'negatif' => 0.0, 'negatif_nonmarking' => 0.0, 'months' => 0];
                $y['wo'] += $r['wo'];
                $y['berulang'] += $r['ber'];
                $y['negatif'] += $r['neg'];
                $y['negatif_nonmarking'] += $r['neg_non'] ?? 0;
                $y['months']++;
                unset($y);
                foreach ($cell['bd2'] ?? [] as $k => $v) {
                    $channels[$k] = ($channels[$k] ?? 0) + $v;
                }
            }
        }
        ksort($history);

        $totalWo = array_sum(array_column($ytd, 'wo'));
        $ulps = [];
        foreach ($ytd as $u => $y) {
            $ulps[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'months' => $y['months'], 'wo' => (int) $y['wo'], 'wo_share_pct' => $totalWo > 0 ? round($y['wo'] / $totalWo * 100, 1) : null]
                + $this->kind('berulang', $y['berulang'], $y['wo'], array_sum(array_column($ytd, 'berulang')), $totalWo)
                + $this->kind('negatif', $y['negatif'], $y['wo'], array_sum(array_column($ytd, 'negatif')), $totalWo)
                + ($gangguan ? ['negatif_nonmarking' => (int) $y['negatif_nonmarking']] : []);
        }
        usort($ulps, fn ($a, $b) => ($b['berulang'] + $b['negatif']) <=> ($a['berulang'] + $a['negatif']) ?: $b['wo'] <=> $a['wo']);

        $kinds = ['Berulang', 'Rating negatif'];
        $byChannel = [];
        foreach ($channels as $k => $v) {
            [$kind, $channel] = explode(' · ', $k, 2);
            if (in_array($kind, $kinds, true)) {
                $byChannel[] = ['kind' => $kind === 'Berulang' ? 'berulang' : 'negatif', 'channel' => $channel, 'count' => (int) $v];
            }
        }

        return ['kind' => 'anomaly', 'focus' => $code, 'month' => $to, 'partial' => $to === now($tz)->format('Y-m'), 'year' => (int) $year, 'ytd' => ['wo' => (int) $totalWo, 'berulang' => (int) array_sum(array_column($ytd, 'berulang')),
            'negatif' => (int) array_sum(array_column($ytd, 'negatif')), 'rate_per_10k_berulang' => $totalWo > 0 ? round(array_sum(array_column($ytd, 'berulang')) / $totalWo * 10000, 2) : null,
            'rate_per_10k_negatif' => $totalWo > 0 ? round(array_sum(array_column($ytd, 'negatif')) / $totalWo * 10000, 2) : null],
            'ulps' => $ulps, 'channels' => $byChannel, 'history' => array_values(array_map(fn ($h) => ['month' => $h['month'], 'wo' => (int) $h['wo'], 'berulang' => (int) $h['berulang'], 'negatif' => (int) $h['negatif']], $history)),
            'notes' => array_values(array_filter([
                'Kejadian anomali sangat jarang dibanding jumlah WO, sehingga angka satu ULP satu bulan mudah berubah karena kebetulan. Bacalah tahun berjalan; kolom "ditandai" memakai uji kejadian jarang (Poisson): ULP ditandai bila anomalinya melebihi harapan menurut porsi WO-nya sebanyak '.self::FLAG_SIGMA.' simpangan baku dan paling sedikit '.self::FLAG_MIN_EVENTS.' kejadian.',
                $gangguan ? 'Rating negatif tanpa marking (ukuran NKO) diperbandingkan dengan target pada kartu status (`targets`).' : null,
                'Tidak ada prakiraan: pada data kita rating negatif tidak berhubungan dengan lamanya RCT (korelasi dalam-ULP sekitar nol), dan jumlahnya tidak berpola sehingga prakiraan tidak lebih baik dari rata-rata.',
            ]))];
    }

    /**
     * Hitungan, laju per 10.000 WO, dan penanda uji Poisson satu jenis anomali untuk satu ULP.
     *
     * @return array<string, mixed>
     */
    private function kind(string $name, float $count, float $wo, float $total, float $totalWo): array
    {
        $expected = $totalWo > 0 ? $total * $wo / $totalWo : 0.0;
        $flag = $count >= self::FLAG_MIN_EVENTS && $count > $expected + self::FLAG_SIGMA * sqrt($expected);

        return [$name => (int) $count, "{$name}_per_10k" => $wo > 0 ? round($count / $wo * 10000, 2) : null, "{$name}_expected" => round($expected, 1), "{$name}_flagged" => $flag];
    }
}
