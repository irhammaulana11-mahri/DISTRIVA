<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Estimasi kWh beli bersih (siap salur distribusi, setelah E-Min dan PSSD) per ULP per bulan dari data susut yang sudah ada, selama masukan kWh beli belum diisi (docs/92 §6.10).
 *
 * Realisasi susut kumulatif (%) per ULP tahun berjalan tersimpan pada angka acuan workbook NKO (`kpi_reference_values`). Dengan kWh jual 309: beli kumulatif = jual kumulatif / (1 - susut kumulatif),
 * sehingga beli bulan = selisih beli kumulatif (basis `turunan`). Bulan sesudah realisasi terakhir diprakirakan memakai susut kumulatif terakhir sebagai susut bulan itu: beli = jual / (1 - susut)
 * (basis `prakiraan`). Hanya estimasi: kebenaran beli tetap dari masukan bulanan kWh beli (docs/91 §3a), yang selalu diutamakan oleh pemanggil.
 */
class LossEstimator
{
    public const CODE = 'susut-distribusi-tanpa-e-min';

    /**
     * Susut kumulatif (%) per unit, tahun, dan bulan.
     *
     * @param  list<string>  $units
     * @return array<string, array<int, array<int, float>>>
     */
    public function reference(array $units, int $fromYear, int $toYear): array
    {
        $out = [];
        $rows = DB::table('kpi_reference_values as v')->join('kpi_definitions as d', 'd.id', '=', 'v.definition_id')->where('d.code', self::CODE)->whereIn('v.organizational_unit_id', $units)
            ->whereRaw('extract(year from v.period) between ? and ?', [$fromYear, $toYear])->whereNotNull('v.realisasi')->orderBy('v.period')->get(['v.organizational_unit_id as u', 'v.period', 'v.realisasi']);
        foreach ($rows as $r) {
            $out[$r->u][(int) substr((string) $r->period, 0, 4)][(int) substr((string) $r->period, 5, 2)] = (float) $r->realisasi;
        }

        return $out;
    }

    /**
     * @param  list<string>  $units
     * @param  array<string, array<string, array{raw: array<string, float>}>>  $sales  kWh jual 309 (kunci raw `kwh`), mulai Januari tahun `$from`
     * @return array<string, array<string, array{beli_net: float, jual: float, susut_kwh: float, susut_pct: float, basis: string}>>
     */
    public function estimate(array $units, array $sales, string $from, string $to, bool $predict = false): array
    {
        $out = [];
        $refs = $this->reference($units, (int) substr($from, 0, 4), (int) substr($to, 0, 4));
        foreach ($units as $u) {
            for ($y = (int) substr($from, 0, 4); $y <= (int) substr($to, 0, 4); $y++) {
                $cumJual = 0.0;
                $cumBeli = 0.0;
                $chain = true;
                $last = null;
                for ($k = 1; $k <= 12; $k++) {
                    $m = sprintf('%04d-%02d', $y, $k);
                    if ($m > $to) {
                        break;
                    }
                    $jual = $sales[$u][$m]['raw']['kwh'] ?? null;
                    $s = $refs[$u][$y][$k] ?? null;
                    $jual === null ? $chain = false : ($chain && $cumJual += $jual);
                    if ($s !== null && $s >= 100) {
                        $chain = false;
                        $s = null;
                    }
                    if ($s !== null) {
                        $last = $s;
                        if ($chain && $jual !== null) {
                            $newCum = $cumJual / (1 - $s / 100);
                            $beli = $newCum - $cumBeli;
                            if ($beli > 0) {
                                $cumBeli = $newCum;
                                $m >= $from && $out[$u][$m] = $this->cell($beli, $jual, 'turunan');
                            } else {
                                $chain = false;
                            }
                        }
                    } elseif ($predict && $last !== null && $jual !== null && $m >= $from) {
                        $out[$u][$m] = $this->cell($jual / (1 - $last / 100), $jual, 'prakiraan');
                    }
                }
            }
        }

        return $out;
    }

    /**
     * Uji mundur satu tahun: pada tiap bulan turunan yang didahului bulan turunan lain, kWh beli diprakirakan dari kWh jual bulan itu dan susut kumulatif bulan sebelumnya, lalu dibandingkan dengan
     * beli turunan bulan itu; pembanding: kWh beli bulan lalu (cara naif) dan susut bulanan bulan lalu. "Kebenaran" di sini juga turunan, bukan meter: yang diuji adalah kestabilan susut.
     *
     * @return array<string, mixed>
     */
    public function backtest(array $units, array $sales, int $year, string $to): array
    {
        $refs = $this->reference($units, $year, $year);
        $derived = $this->estimate($units, $sales, $year.'-01', $to);
        $errors = ['model' => [], 'naive_beli' => [], 'naive_susut' => []];
        foreach ($units as $u) {
            for ($k = 2; $k <= 12; $k++) {
                $m = sprintf('%04d-%02d', $year, $k);
                $p = sprintf('%04d-%02d', $year, $k - 1);
                $a = $derived[$u][$m] ?? null;
                $b = $derived[$u][$p] ?? null;
                $sPrev = $refs[$u][$year][$k - 1] ?? null;
                if ($a === null || $b === null || $sPrev === null || $a['beli_net'] <= 0) {
                    continue;
                }
                $errors['model'][] = abs($a['jual'] / (1 - $sPrev / 100) - $a['beli_net']) / $a['beli_net'];
                $errors['naive_beli'][] = abs($b['beli_net'] - $a['beli_net']) / $a['beli_net'];
                $errors['naive_susut'][] = abs($a['jual'] / (1 - $b['susut_pct'] / 100) - $a['beli_net']) / $a['beli_net'];
            }
        }
        $mape = fn (array $e): ?float => $e === [] ? null : round(array_sum($e) / count($e) * 100, 2);

        return ['observations' => count($errors['model']), 'model_mape_pct' => $mape($errors['model']), 'naive_beli_mape_pct' => $mape($errors['naive_beli']), 'naive_susut_mape_pct' => $mape($errors['naive_susut'])];
    }

    /** @return array{beli_net: float, jual: float, susut_kwh: float, susut_pct: float, basis: string} */
    private function cell(float $beli, float $jual, string $basis): array
    {
        return ['beli_net' => $beli, 'jual' => $jual, 'susut_kwh' => $beli - $jual, 'susut_pct' => ($beli - $jual) / $beli * 100, 'basis' => $basis];
    }
}
