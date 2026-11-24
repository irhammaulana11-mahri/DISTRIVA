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
            'gangguan' => array_map(fn (array $byMonth) => array_map(fn (array $cell) => $cell['raw'], $byMonth), $this->metrics->raw('difi-gangguan', $units, $fromMonth, $toMonth)),
            default => [],
        };
    }
}
