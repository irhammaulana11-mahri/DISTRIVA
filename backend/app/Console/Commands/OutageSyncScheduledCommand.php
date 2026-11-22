<?php

namespace App\Console\Commands;

use App\Services\Outages\OutageSyncService;
use Illuminate\Console\Command;

class OutageSyncScheduledCommand extends Command
{
    protected $signature = 'distriva:outage-sync-scheduled';

    protected $description = 'Menjalankan sinkronisasi data gangguan harian bila sudah waktunya (pengaturan di menu Data Gangguan).';

    public function handle(OutageSyncService $svc): int
    {
        $id = $svc->runScheduledIfDue();
        $id !== null && $this->info("Sinkronisasi gangguan dimulai: {$id}");

        return self::SUCCESS;
    }
}
