<?php

namespace App\Console\Commands;

use App\Services\Substations\MaximoSyncService;
use Illuminate\Console\Command;

/** Internal: runs a registered Maximo sync in a detached process. */
class MaximoSyncExecuteCommand extends Command
{
    protected $signature = 'distriva:maximo-sync-execute {id}';

    protected $description = 'Internal: menjalankan sinkronisasi Maximo yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(MaximoSyncService $svc): int
    {
        $svc->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
