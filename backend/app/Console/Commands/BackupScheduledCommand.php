<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Called every minute by the scheduler: runs the daily backup when due. */
class BackupScheduledCommand extends Command
{
    protected $signature = 'distriva:backup-scheduled';

    protected $description = 'Menjalankan pencadangan terjadwal bila waktunya tiba.';

    public function handle(BackupService $svc): int
    {
        $id = $svc->runScheduledIfDue();
        if ($id !== null) {
            $this->info('Pencadangan terjadwal dijalankan: '.DB::table('backup_runs')->where('id', $id)->value('backup_number'));
        }

        return self::SUCCESS;
    }
}
