<?php

namespace App\Console\Commands;

use App\Exceptions\AssignmentRuleViolation;
use App\Services\Backup\BackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Manual backup from the terminal (docs/64). */
class BackupCommand extends Command
{
    protected $signature = 'distriva:backup {--documents : include the documents folder} {--notes= : free note}';

    protected $description = 'Membuat cadangan database (opsional + folder dokumen) sekarang.';

    public function handle(BackupService $svc): int
    {
        try {
            $id = $svc->start('MANUAL', (bool) $this->option('documents'), $this->option('notes'), null);
        } catch (AssignmentRuleViolation $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $svc->execute($id);
        $r = DB::table('backup_runs')->where('id', $id)->first();
        if ($r->status !== 'SUCCEEDED') {
            $this->error('Gagal: '.$r->error);

            return self::FAILURE;
        }
        $this->info("{$r->backup_number}: {$r->db_file} (".number_format((int) $r->db_size).' byte, '.$r->db_entries.' entri)');

        return self::SUCCESS;
    }
}
