<?php

namespace App\Services\Analytics;

use App\Services\Nko\NkoDefinitionSets;
use Illuminate\Support\Facades\DB;

/**
 * Wawasan susut (docs/92 §6.10) saat kWh beli belum bersumber otomatis: kWh beli bersih per bulan berasal dari masukan bulanan bila ada, selain itu estimasi turunan dari susut kumulatif NKO dan kWh
 * jual 309 (`LossEstimator`), dan bulan sesudah realisasi susut terakhir diprakirakan dengan susut kumulatif terakhir. Memuat perbandingan ULP terhadap target, bulan yang tidak wajar (tanda
 * data jual atau susut perlu diperiksa), dan uji mundur estimasi. Proksi susut teknis per gardu belum ada: butuh pembacaan gardu yang belum tersedia lengkap.
 */
class LossInsights
{
    private const HISTORY_MONTHS = 12;

    /** Bulan ditandai bila kWh beli turunannya menyimpang lebih dari ini dari median ULP itu pada tahun yang sama. */
    public const ANOMALY_RATIO = 0.25;

    public function __construct(private readonly BusinessMetricService $metrics, private readonly LossEstimator $estimator, private readonly TechnicalLossProxy $technical, private readonly NontechnicalLoss $nontechnical) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $year = (int) substr($to, 0, 4);
        $yearStart = $year.'-01';
        $from = min($yearStart, date('Y-m', (int) strtotime($to.'-01 -'.(self::HISTORY_MONTHS - 1).' month')));
        $sales = $this->metrics->raw('kwh-jual', $units, substr($from, 0, 4).'-01', $to);
        $series = $this->metrics->losses($units, $from.'-01', $to.'-01');
        $predicted = $this->estimator->estimate($units, $sales, $from, $to, true);
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        $cells = [];
        foreach ($units as $u) {
            for ($t = strtotime($from.'-01'); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
                $m = date('Y-m', $t);
                if (isset($series[$u][$m])) {
                    $r = $series[$u][$m]['raw'];
                    $cells[$u][$m] = ['beli_net' => $r['beli_net'], 'jual' => $r['jual'], 'susut_kwh' => $r['susut_kwh'], 'basis' => isset($r['estimated']) ? 'turunan' : 'input'];
                } elseif (isset($predicted[$u][$m]) && $predicted[$u][$m]['basis'] === 'prakiraan') {
                    $e = $predicted[$u][$m];
                    $cells[$u][$m] = ['beli_net' => $e['beli_net'], 'jual' => $e['jual'], 'susut_kwh' => $e['susut_kwh'], 'basis' => 'prakiraan'];
                }
            }
        }

        $history = [];
        for ($t = strtotime($from.'-01'); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
            $m = date('Y-m', $t);
            $sum = ['beli' => 0.0, 'jual' => 0.0, 'susut' => 0.0];
            $bases = [];
            foreach ($units as $u) {
                if (isset($cells[$u][$m])) {
                    $sum['beli'] += $cells[$u][$m]['beli_net'];
                    $sum['jual'] += $cells[$u][$m]['jual'];
                    $sum['susut'] += $cells[$u][$m]['susut_kwh'];
                    $bases[$cells[$u][$m]['basis']] = true;
                }
            }
            if ($sum['beli'] > 0) {
                $history[] = ['month' => $m, 'beli_net_kwh' => round($sum['beli']), 'jual_kwh' => round($sum['jual']), 'susut_kwh' => round($sum['susut']), 'susut_pct' => round($sum['susut'] / $sum['beli'] * 100, 2),
                    'basis' => count($bases) === 1 ? array_key_first($bases) : 'campuran', 'units' => count(array_filter($units, fn ($u) => isset($cells[$u][$m])))];
            }
        }

        $ulpRows = $this->ulps($units, $names, $cells, $yearStart, $to);
        $technical = $this->technical->detail($units, $to, array_column($ulpRows, 'ytd_susut_pct', 'unit_id'));

        return ['kind' => 'loss_estimate', 'month' => $to, 'partial' => $to === now($tz)->format('Y-m'), 'history' => $history, 'ulps' => $ulpRows, 'technical' => $technical, 'nontechnical' => $this->nontechnicalBlock($units, $to, $names, $ulpRows, $technical, $sales), 'anomalies' => $this->anomalies($units, $names, $cells, $yearStart, $to),
            'backtest' => $this->estimator->backtest($units, $sales, $year, $to), 'has_manual_input' => $this->hasManualInput($units, $yearStart.'-01', $to.'-01'),
            'notes' => [
                'kWh beli belum bersumber otomatis. Basis `input` = masukan bulanan; `turunan` = dihitung dari susut kumulatif realisasi NKO (angka acuan workbook) dan kWh jual 309 (beli kumulatif = jual kumulatif / (1 - susut kumulatif)); `prakiraan` = bulan sesudah realisasi susut terakhir, memakai susut kumulatif terakhir sebagai susut bulan itu.',
                'Estimasi bukan data meter: ketelitiannya bergantung pada kesamaan kWh jual 309 dengan kWh jual yang dipakai perhitungan susut resmi. Uji mundur hanya mengukur kestabilan susut, bukan kecocokan dengan kWh beli sebenarnya; isi masukan kWh beli bulanan untuk menggantikannya.',
                'Proksi susut teknis per gardu ada pada `technical`; sisa susut yang tidak dijelaskan beban gardu dan sandingannya dengan P2TL ada pada `nontechnical` (korelasi, bukan sebab-akibat).']];
    }

    /**
     * Masukan untuk sisa susut per ULP: susut kumulatif, beban rata-rata gardu, kWh jual tahun berjalan, dan P2TL (kWh dan kasus) tahun berjalan sampai bulan `$to`.
     *
     * @param  array<string, mixed>  $technical
     * @return array<string, mixed>
     */
    private function nontechnicalBlock(array $units, string $to, $names, array $ulpRows, array $technical, array $sales): array
    {
        if (! ($technical['available'] ?? false)) {
            return ['available' => false, 'reason' => 'Pengukuran gardu belum tersedia.'];
        }
        $year = substr($to, 0, 4);
        $p2tl = $this->metrics->raw('kwh-p2tl', $units, $year.'-01', $to);
        $customers = $this->metrics->raw('pelanggan', $units, $to, $to);
        $loading = array_column($technical['ulps'], 'avg_loading_pct', 'unit_id');
        $rows = [];
        foreach ($ulpRows as $u) {
            $id = $u['unit_id'];
            if (! isset($loading[$id])) {
                continue;
            }
            $jual = 0.0;
            foreach ($sales[$id] ?? [] as $m => $cell) {
                substr($m, 0, 4) === $year && $m <= $to && $jual += $cell['raw']['kwh'] ?? 0;
            }
            $kwh = 0.0;
            $cases = 0.0;
            foreach ($p2tl[$id] ?? [] as $cell) {
                $kwh += $cell['raw']['kwh'] ?? 0;
                $cases += $cell['raw']['n'] ?? 0;
            }
            $rows[$id] = ['name' => $names[$id] ?? $id, 'susut' => $u['ytd_susut_pct'], 'loading' => $loading[$id], 'jual_kwh' => $jual, 'p2tl_kwh' => $kwh, 'p2tl_cases' => $cases, 'customers' => (float) ($customers[$id][$to]['raw']['pelanggan'] ?? 0)];
        }

        return $this->nontechnical->analyze($rows);
    }

    /** @return array<string, mixed> */
    private function ulps(array $units, $names, array $cells, string $yearStart, string $to): array
    {
        $sets = array_filter(array_map(fn (string $level) => NkoDefinitionSets::forMonth((int) substr($to, 0, 4), $level, (int) substr($to, 5, 2))?->id, ['ULP', 'UP3']));
        $targets = DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->where('d.code', LossEstimator::CODE)->whereIn('d.set_id', $sets)->whereIn('t.organizational_unit_id', $units)->where('t.period', $to.'-01')->pluck('t.target_value', 't.organizational_unit_id');
        $rows = [];
        foreach ($units as $u) {
            $ytd = ['beli' => 0.0, 'susut' => 0.0];
            $bases = [];
            for ($t = strtotime($yearStart.'-01'); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
                $c = $cells[$u][date('Y-m', $t)] ?? null;
                if ($c !== null) {
                    $ytd['beli'] += $c['beli_net'];
                    $ytd['susut'] += $c['susut_kwh'];
                    $bases[$c['basis']] = true;
                }
            }
            $cur = $cells[$u][$to] ?? null;
            if ($ytd['beli'] <= 0) {
                continue;
            }
            $target = $targets[$u] ?? null;
            $ytdPct = $ytd['susut'] / $ytd['beli'] * 100;
            $rows[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'month_susut_pct' => $cur === null ? null : round($cur['susut_kwh'] / $cur['beli_net'] * 100, 2), 'month_basis' => $cur['basis'] ?? null, 'month_beli_net_kwh' => $cur === null ? null : round($cur['beli_net']),
                'ytd_susut_pct' => round($ytdPct, 2), 'ytd_susut_kwh' => round($ytd['susut']), 'ytd_basis' => isset($bases['prakiraan']) ? 'termasuk_prakiraan' : (isset($bases['turunan']) ? 'turunan' : 'input'),
                'target_pct' => $target === null ? null : round((float) $target, 3), 'gap_pct_points' => $target === null ? null : round($ytdPct - (float) $target, 2)];
        }
        usort($rows, fn ($a, $b) => $b['ytd_susut_pct'] <=> $a['ytd_susut_pct']);

        return $rows;
    }

    /** @return list<array<string, mixed>> */
    private function anomalies(array $units, $names, array $cells, string $yearStart, string $to): array
    {
        $out = [];
        foreach ($units as $u) {
            $derived = [];
            for ($t = strtotime($yearStart.'-01'); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
                $c = $cells[$u][date('Y-m', $t)] ?? null;
                $c !== null && $c['basis'] === 'turunan' && $derived[date('Y-m', $t)] = $c['beli_net'];
            }
            if (count($derived) < 4) {
                continue;
            }
            $sorted = array_values($derived);
            sort($sorted);
            $median = $sorted[intdiv(count($sorted), 2)];
            foreach ($derived as $m => $beli) {
                if ($median > 0 && abs($beli - $median) / $median > self::ANOMALY_RATIO) {
                    $out[] = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'month' => $m, 'beli_net_kwh' => round($beli), 'median_kwh' => round($median), 'deviation_pct' => round(($beli - $median) / $median * 100, 1)];
                }
            }
        }

        return $out;
    }

    private function hasManualInput(array $units, string $from, string $to): bool
    {
        return DB::table('business_monthly_inputs')->where('code', 'kwh-beli')->whereIn('organizational_unit_id', $units)->whereBetween('period', [$from, $to])->exists();
    }
}
