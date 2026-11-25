<?php

namespace App\Services\Analytics;

use App\Services\Outages\OutageAnalysisService;
use App\Services\Reports\CustomerGrowthService;

/**
 * Data pendamping tiap metrik pengusahaan (docs/91): angka operasional DISTRIVA yang menjelaskan angka resmi laporan EIS. Hasilnya angka mentah per ULP per bulan (YYYY-MM)
 * yang dapat dijumlahkan antar-ULP, sama seperti angka resmi, sehingga UP3 = gabungan ULP di bawahnya.
 */
class BusinessCompanionService
{
    public function __construct(private readonly CustomerGrowthService $growth, private readonly OutageAnalysisService $outages, private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units
     * @return array<string, array<string, array<string, float>>> unit => bulan => angka mentah bernama
     */
    public function raw(string $code, array $units, string $fromMonth, string $toMonth): array
    {
        return match ($code) {
            'pelanggan', 'daya' => $this->growth->monthlyByUnit($units, $fromMonth, $toMonth),
            'saidi-saifi', 'ens' => $this->outages->monthlyByUnit($units, $fromMonth, $toMonth),
            'kwh-jual', 'pendapatan' => $this->newCustomerContribution($units, $fromMonth, $toMonth),
            'gangguan' => array_map(fn (array $byMonth) => array_map(fn (array $cell) => $cell['raw'], $byMonth), $this->metrics->raw('difi-gangguan', $units, $fromMonth, $toMonth)),
            default => [],
        };
    }

    /**
     * Perkiraan kWh dan rupiah dari pelanggan baru: daya PB tersambung dalam 12 bulan terakhir (termasuk bulan itu) per kelompok tarif, dikali kWh atau rupiah per kVA aktual kelompok itu
     * pada bulan tersebut (Laporan 309: penjualan kelompok dibagi daya tersambung kelompok). Tanpa asumsi jam nyala dari luar; PB yang baru tersambung dihitung penuh sehingga sedikit melebihkan,
     * dan PB bertarif di luar kelompok S, R, B, I, P tidak dihitung. Bulan tanpa Laporan 309 tidak punya perkiraan.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, array{est_kwh: float, est_rp: float}>>
     */
    private function newCustomerContribution(array $units, string $fromMonth, string $toMonth): array
    {
        $rates = $this->metrics->raw('grup-309', $units, $fromMonth, $toMonth);
        $pb = $this->growth->pbKvaByGroup($units, date('Y-m', strtotime($fromMonth.'-01 -11 month')), $toMonth);
        $out = [];
        foreach ($rates as $u => $byMonth) {
            foreach ($byMonth as $m => $cell) {
                $kva = [];
                for ($i = 0; $i < 12; $i++) {
                    foreach ($pb[$u][date('Y-m', strtotime($m.'-01 -'.$i.' month'))] ?? [] as $g => $v) {
                        $kva[$g] = ($kva[$g] ?? 0) + $v;
                    }
                }
                $estKwh = 0.0;
                $estRp = 0.0;
                foreach ($kva as $g => $v) {
                    $dayaKva = (float) ($cell['raw']["daya_{$g}"] ?? 0) / 1000;
                    if ($dayaKva > 0) {
                        $estKwh += $v * (float) ($cell['raw']["kwh_{$g}"] ?? 0) / $dayaKva;
                        $estRp += $v * (float) ($cell['raw']["rp_{$g}"] ?? 0) / $dayaKva;
                    }
                }
                $out[$u][$m] = ['est_kwh' => $estKwh, 'est_rp' => $estRp];
            }
        }

        return $out;
    }
}
