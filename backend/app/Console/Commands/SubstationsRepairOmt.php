<?php

namespace App\Console\Commands;

use App\Services\Substations\OmtLoadService;
use Illuminate\Console\Command;

/** php artisan substations:repair-omt tools/omt_sync/out/omt-pengukuran-bersih-mojokerto.csv [--dry-run]: koreksi sekali jalan pembacaan OMT 2023-2 yang kolomnya bergeser (docs/83 temuan 6). */
class SubstationsRepairOmt extends Command
{
    protected $signature = 'substations:repair-omt {file : CSV bersih dari tools/omt_sync (fix) versi terbaru} {--dry-run : hitung tanpa menyimpan}';

    protected $description = 'Koreksi pembacaan OMT yang termuat dari baris bergeser (tegangan di jurusan F/G); trigger append-only diangkat hanya di dalam satu transaksi.';

    public function handle(OmtLoadService $service): int
    {
        $r = $service->repairShifted((string) $this->argument('file'), (bool) $this->option('dry-run'));
        $this->line(($this->option('dry-run') ? '[DRY RUN, tidak disimpan] ' : '').json_encode($r));

        return self::SUCCESS;
    }
}
