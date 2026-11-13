<?php

namespace App\Console\Commands;

use App\Services\Applications\EisSyncService;
use Illuminate\Console\Command;

/** Internal: runs a registered EIS sync in a detached process. */
class EisSyncExecuteCommand extends Command
{
    protected $signature = 'distriva:eis-sync-execute {id}';

    protected $description = 'Internal: menjalankan sinkronisasi EIS yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(EisSyncService $svc): int
    {
        $svc->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
