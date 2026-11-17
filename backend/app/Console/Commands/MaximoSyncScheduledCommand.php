<?php

namespace App\Console\Commands;

use App\Services\Substations\MaximoSyncService;
use Illuminate\Console\Command;

/** Called every minute by the scheduler: starts the automatic Maximo sync when it is due. */
class MaximoSyncScheduledCommand extends Command
{
    protected $signature = 'distriva:maximo-sync-scheduled';

    protected $description = 'Menjalankan sinkronisasi Maximo otomatis bila waktunya tiba.';

    public function handle(MaximoSyncService $svc): int
    {
        $id = $svc->runScheduledIfDue();
        if ($id !== null) {
            $this->info("Sinkronisasi Maximo otomatis dimulai: {$id}");
        }

        return self::SUCCESS;
    }
}
