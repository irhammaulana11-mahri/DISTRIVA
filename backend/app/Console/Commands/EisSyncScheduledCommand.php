<?php

namespace App\Console\Commands;

use App\Services\Applications\EisSyncService;
use Illuminate\Console\Command;

/** Called every minute by the scheduler: starts the automatic EIS sync when it is due. */
class EisSyncScheduledCommand extends Command
{
    protected $signature = 'distriva:eis-sync-scheduled';

    protected $description = 'Menjalankan sinkronisasi EIS otomatis bila waktunya tiba.';

    public function handle(EisSyncService $svc): int
    {
        $id = $svc->runScheduledIfDue();
        if ($id !== null) {
            $this->info("Sinkronisasi EIS otomatis dimulai: {$id}");
        }

        return self::SUCCESS;
    }
}
