<?php

namespace App\Services\Kkf;

use InvalidArgumentException;

/**
 * KKF / KAJIAN calculation (docs/08, docs/62 §24): a pure, deterministic projection of one connection (PB/PD) over `horizon` years.
 * Mirrors workbook sheets KAJIAN/KKF. Year 0 = COD year: cost = investment (RAB), cash in = connection fee (+ aesthetics/sharing).
 * Years 1..horizon: energy sold = MW x load factor x jam nyala x 12; cost = purchased energy (BPP) + O&M (rate x investment); revenue = average
 * sale price x energy sold. NPV does NOT discount year 0 (owner decision; Excel's NPV() did, so workbook NPV = result / (1 + r));
 * IRR over years 0..horizon; B/C = PV(revenue) / PV(cost); payback by cumulative net benefit with month interpolation.
 * LAYAK = IRR > discount rate AND NPV > 0 AND payback <= 5 years 0 months. Amounts in rupiah. No state, no I/O.
 */
final class KkfCalculator
{
    /**
     * @param  array<string,mixed>  $in  investment, connection_fee, power_kva (the DELTA for a power change), jam_nyala, avg_price, bpp, discount_rate (fraction);
     *                                   optional: payback_limit_months=60, esthetic_fee=0, load_factor=1, om_rate=0.02, horizon=25, start_year, roe, interest, tax=0.25
     * @return array<string,mixed>
     */
    public function calculate(array $in): array
    {
        foreach (['investment', 'connection_fee', 'power_kva', 'jam_nyala', 'avg_price', 'bpp', 'discount_rate'] as $k) {
            if (! isset($in[$k]) || ! is_numeric($in[$k]) || $in[$k] < 0) {
                throw new InvalidArgumentException("Masukan {$k} wajib berupa angka >= 0.");
            }
        }
        $horizon = (int) ($in['horizon'] ?? 25);
        if ($horizon < 1 || $horizon > 60) {
            throw new InvalidArgumentException('Horizon harus 1–60 tahun.');
        }
        if ((float) $in['investment'] <= 0 || (float) $in['power_kva'] <= 0) {
            throw new InvalidArgumentException('Investasi dan daya hitung harus lebih besar dari nol.');
        }
        $invest = (float) $in['investment'];
        $esthetic = (float) ($in['esthetic_fee'] ?? 0);
        $fee = (float) $in['connection_fee'];
        $mw = (float) $in['power_kva'] / 1000;
        $load = (float) ($in['load_factor'] ?? 1.0);
        $om = (float) ($in['om_rate'] ?? 0.02);
        $r = (float) $in['discount_rate'];

        $energy = $mw * $load * (float) $in['jam_nyala'] * 12;                     // MWh per year
        $years = [];
        $years[] = ['year_index' => 0, 'year' => isset($in['start_year']) ? (int) $in['start_year'] : null, 'energy_sold_mwh' => 0.0, 'cost_investment' => $invest, 'cost_energy' => 0.0, 'cost_om' => 0.0,
            'cost_total' => $invest, 'cash_in_connection' => $fee + $esthetic, 'revenue_sales' => 0.0, 'revenue_total' => $fee + $esthetic];
        for ($t = 1; $t <= $horizon; $t++) {
            $costEnergy = (float) $in['bpp'] * $energy * 1000;                     // Rp/kWh x kWh
            $costOm = $om * $invest;
            $sales = (float) $in['avg_price'] * $energy * 1000;
            $years[] = ['year_index' => $t, 'year' => isset($in['start_year']) ? (int) $in['start_year'] + $t : null, 'energy_sold_mwh' => $energy, 'cost_investment' => 0.0, 'cost_energy' => $costEnergy,
                'cost_om' => $costOm, 'cost_total' => $costEnergy + $costOm, 'cash_in_connection' => 0.0, 'revenue_sales' => $sales, 'revenue_total' => $sales];
        }
        $net = [];
        $cum = 0.0;
        foreach ($years as &$y) {
            $y['net'] = $y['revenue_total'] - $y['cost_total'];
            $cum += $y['net'];
            $y['cumulative'] = $cum;
            $net[] = $y['net'];
        }
        unset($y);

        $pv = fn (array $flows) => array_sum(array_map(fn ($v, $t) => $v / (1 + $r) ** $t, $flows, array_keys($flows)));   // year 0 undiscounted
        $npv = $pv($net);
        $pvRevenue = $pv(array_column($years, 'revenue_total'));
        $pvCost = $pv(array_column($years, 'cost_total'));
        $irr = $net[0] > 0 ? 100.0 : $this->irr($net);                              // workbook: IF(net year 0 > 0, 100, IRR(...))
        $pbp = $this->payback($years);
        $limitMonths = (int) ($in['payback_limit_months'] ?? 60);
        $within = $pbp !== null && ($pbp['years'] * 12 + $pbp['months']) <= $limitMonths;
        $feasible = $irr !== null && $irr > $r * 100 && $npv > 0 && $within;

        $out = ['years' => $years, 'npv' => $npv, 'irr_percent' => $irr, 'bc_ratio' => $pvCost > 0 ? $pvRevenue / $pvCost : null, 'payback' => $pbp, 'discount_rate_percent' => $r * 100,
            'bp_ratio' => ($fee + $esthetic) / $invest, 'feasible' => $feasible,
            'criteria' => ['irr_above_discount' => $irr !== null && $irr > $r * 100, 'npv_positive' => $npv > 0, 'payback_within_5_years' => $within]];
        if (isset($in['roe'], $in['interest'])) {                                    // RWACC (indicator): equity = the connection fee, debt = the rest of the investment
            $tax = (float) ($in['tax'] ?? 0.25);
            $der = $fee > 0 ? ($invest - $fee) / $fee : null;
            if ($der !== null) {
                $equity = $invest / (1 + $der);
                $debt = $der / (1 + $der) * $invest;
                $out['rwacc_percent'] = (($equity / $invest) * (float) $in['roe'] + (1 - $tax) * ($debt / $invest) * (float) $in['interest']) * 100;
            }
        }

        return $out;
    }

    /** @param list<float> $flows @return ?float percent; null when the flows never change sign */
    private function irr(array $flows): ?float
    {
        $f = fn (float $r) => array_sum(array_map(fn ($v, $t) => $v / (1 + $r) ** $t, $flows, array_keys($flows)));
        $lo = -0.9999;
        $hi = 10000.0;
        $flo = $f($lo);
        $fhi = $f($hi);
        if ($flo * $fhi > 0) {
            return null;
        }
        for ($i = 0; $i < 300; $i++) {
            $mid = ($lo + $hi) / 2;
            $fm = $f($mid);
            if (($flo < 0) === ($fm < 0)) {
                $lo = $mid;
                $flo = $fm;
            } else {
                $hi = $mid;
            }
        }

        return (($lo + $hi) / 2) * 100;
    }

    /**
     * Cumulative net benefit crossing zero; months interpolated inside the crossing year (workbook DV/DW). Net benefit of year 0 already positive = "1 year 0 months".
     *
     * @param  list<array<string,mixed>>  $years
     * @return ?array{years:int, months:int, text:string}
     */
    private function payback(array $years): ?array
    {
        if ($years[0]['cumulative'] > 0) {
            return ['years' => 1, 'months' => 0, 'text' => '1 Tahun 0 Bulan'];
        }
        for ($k = 1; $k < count($years); $k++) {
            if ($years[$k]['cumulative'] > 0 && $years[$k - 1]['cumulative'] < 0) {
                $months = (int) round(abs($years[$k - 1]['cumulative']) / ($years[$k]['net'] / 12));
                $y = $k - 1;
                if ($months >= 12) {
                    $y++;
                    $months = 0;
                }

                return ['years' => $y, 'months' => $months, 'text' => "{$y} Tahun {$months} Bulan"];
            }
        }

        return null;
    }
}
