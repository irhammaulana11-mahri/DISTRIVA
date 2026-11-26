<?php

namespace App\Console\Commands;

use App\Services\Nko\NkoBaselineImportService;
use App\Services\Nko\NkoImportException;
use Illuminate\Console\Command;

/** Impor baseline adjustment (BA) Penjualan TL dari workbook TRP (docs/90): php artisan distriva:nko-import-baselines <berkas.xlsx>. */
class NkoBaselinesImportCommand extends Command
{
    protected $signature = 'distriva:nko-import-baselines {path : workbook TRP (tab PENJUALAN TL)}';

    protected $description = 'Impor baseline adjustment (BA) bulanan Penjualan Tenaga Listrik per ULP dari workbook TRP';

    public function handle(NkoBaselineImportService $service): int
    {
        $path = (string) $this->argument('path');
        if (! is_file($path)) {
            $this->error('Berkas tidak ditemukan.');

            return self::FAILURE;
        }
        try {
            $r = $service->import($path, basename($path));
        } catch (NkoImportException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->info("BA Penjualan TL {$r['year']}: {$r['units']} ULP, {$r['rows']} nilai bulanan.");
        foreach ($r['skipped'] as $s) {
            $this->warn("  dilewati: {$s}");
        }

        return self::SUCCESS;
    }
}
