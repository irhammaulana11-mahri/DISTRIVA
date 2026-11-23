<?php

namespace App\Console\Commands;

use App\Services\Nko\NkoCalculationService;
use Illuminate\Console\Command;

/** Rekonsiliasi mesin hitung NKO terhadap angka workbook (docs/90): php artisan distriva:nko-reconcile [--year=2026] [--month=] [--unit=]. */
class NkoReconcileCommand extends Command
{
    protected $signature = 'distriva:nko-reconcile {--year=2026} {--month= : bulan 1-12 (kosong = semua)} {--unit= : kode unit (kosong = semua)} {--tolerance=0.0001}';

    protected $description = 'Hitung ulang NKO dari realisasi workbook dan bandingkan pencapaian, nilai, total, dan NKO akhir dengan angka workbook';

    public function handle(NkoCalculationService $service): int
    {
        $r = $service->reconcile((int) $this->option('year'), $this->option('month') ? (int) $this->option('month') : null, $this->option('unit') ?: null, (float) $this->option('tolerance'));
        foreach ($r['mismatches'] as $m) {
            $this->warn($m);
        }
        $this->info("{$r['compared_units']} unit-bulan dibandingkan, {$r['rows_compared']} baris, {$r['rows_mismatch']} baris selisih, {$r['totals_mismatch']} total/NKO selisih.");

        return $r['rows_mismatch'] + $r['totals_mismatch'] === 0 ? self::SUCCESS : self::FAILURE;
    }
}
