<?php

namespace Tests\Feature;

use App\Services\Nko\NkoCalculationService;
use App\Services\Nko\NkoDefinitionImportService;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Rekonsiliasi mesin hitung terhadap workbook realisasi asli (docs/90); dilewati bila berkas contoh tidak tersedia. */
class NkoReconcileTest extends PostgresTestCase
{
    #[Test]
    public function hasil_hitung_sama_dengan_angka_workbook_untuk_up3_dan_semua_ulp(): void
    {
        $path = base_path('../tools/samples/REALISASI UP3 MJK&ULP 2026 REV 3 (2 JUN 2026).xlsx');
        if (! is_file($path)) {
            $this->markTestSkipped('Workbook realisasi contoh tidak tersedia.');
        }
        $up3 = $this->makeUnit('UP3');
        $up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        foreach (['Mojoagung', 'Mojokerto', 'Jombang', 'Ngoro', 'Ploso', 'Mojosari', 'Pacet', 'Kertosono', 'Warujayeng', 'Nganjuk'] as $i => $name) {
            $ulp = $this->makeUnit('ULP', $up3);
            $ulp->forceFill(['code' => '5145'.$i, 'name' => "ULP {$name}"])->save();
        }

        $import = app(NkoDefinitionImportService::class)->import($path, basename($path));
        $this->assertSame(['UP3', 'ULP'], array_column($import['sets'], 'level'));
        $this->assertSame(1, DB::table('kpi_unit_rules')->distinct()->count('organizational_unit_id') > 0 ? 1 : 0);

        $r = app(NkoCalculationService::class)->reconcile(2026, null, null, 0.000001);

        $this->assertSame([], $r['mismatches']);
        $this->assertSame(99, $r['compared_units']);   // 11 unit x 9 bulan
        $this->assertGreaterThan(5000, $r['rows_compared']);
        $this->assertSame(0, $r['rows_mismatch'] + $r['totals_mismatch']);
    }
}
