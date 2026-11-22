<?php

namespace App\Console\Commands;

use App\Services\Outages\OutageSyncService;
use Illuminate\Console\Command;

/** Internal: menjalankan satu sinkronisasi gangguan yang sudah didaftarkan, di proses terpisah. */
class OutageSyncExecuteCommand extends Command
{
    protected $signature = 'distriva:outage-sync-execute {id}';

    protected $description = 'Internal: menjalankan sinkronisasi data gangguan yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(OutageSyncService $svc): int
    {
        $svc->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
