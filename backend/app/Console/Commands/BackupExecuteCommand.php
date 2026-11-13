<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

/** Internal: runs a prepared backup in a detached process. */
class BackupExecuteCommand extends Command
{
    protected $signature = 'distriva:backup-execute {id}';

    protected $description = 'Internal: menjalankan pencadangan yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(BackupService $svc): int
    {
        $svc->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
