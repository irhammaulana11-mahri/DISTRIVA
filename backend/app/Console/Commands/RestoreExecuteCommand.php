<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

/** Internal: runs a prepared restore in a detached process. */
class RestoreExecuteCommand extends Command
{
    protected $signature = 'distriva:restore-execute {id}';

    protected $description = 'Internal: menjalankan pemulihan yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(BackupService $svc): int
    {
        $svc->executeRestore((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
