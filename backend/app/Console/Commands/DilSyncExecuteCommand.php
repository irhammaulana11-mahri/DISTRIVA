<?php

namespace App\Console\Commands;

use App\Services\Substations\DilSyncService;
use Illuminate\Console\Command;

/** Internal: runs a registered DIL sync in a detached process. */
class DilSyncExecuteCommand extends Command
{
    protected $signature = 'distriva:dil-sync-execute {id}';

    protected $description = 'Internal: menjalankan sinkron DIL yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(DilSyncService $svc): int
    {
        $svc->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
