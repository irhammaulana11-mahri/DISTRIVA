<?php

namespace App\Console\Commands;

use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoImportException;
use Illuminate\Console\Command;

/** Impor master definisi NKO/KPI dari workbook realisasi (docs/89): php artisan distriva:nko-import-definitions <berkas.xlsx>. */
class NkoDefinitionsImportCommand extends Command
{
    protected $signature = 'distriva:nko-import-definitions {path : workbook realisasi NKO (tab UP3 dan ULP)}';

    protected $description = 'Impor definisi NKO/KPI berversi (indikator, polaritas, bobot, target bulanan, aturan nilai) dari workbook realisasi';

    public function handle(NkoDefinitionImportService $service): int
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
        foreach ($r['sets'] as $s) {
            $this->info("{$s['level']} {$r['year']} v{$s['version']}: {$s['status']}, {$s['definitions']} definisi, {$s['targets']} target, unit: ".($s['units'] === [] ? '-' : implode(', ', $s['units'])));
            foreach ($s['warnings'] as $w) {
                $this->warn('  '.$w);
            }
        }

        return self::SUCCESS;
    }
}
