<?php

namespace App\Console\Commands;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Backup\BackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Emergency restore from the terminal (when the application cannot serve requests). Same safeguards as the API. */
class RestoreCommand extends Command
{
    protected $signature = 'distriva:restore {backup : backup number} {--documents} {--reason=} {--as= : e-mail of an active SYS_ADMIN who answers for it} {--yes : confirm}';

    protected $description = 'DARURAT: memulihkan database dari cadangan yang sudah diverifikasi (mengganti data yang ada).';

    public function handle(BackupService $svc): int
    {
        $run = DB::table('backup_runs')->where('backup_number', $this->argument('backup'))->first();
        $actor = User::query()->where('email', (string) $this->option('as'))->first();
        if ($run === null || $actor === null || blank($this->option('reason'))) {
            $this->error('Wajib: nomor cadangan yang benar, --as=<email SYS_ADMIN>, dan --reason.');

            return self::FAILURE;
        }
        if (! $this->option('yes') && ! $this->confirm("Ini MENGGANTI seluruh data aplikasi dengan isi {$run->backup_number}. Lanjutkan?")) {
            return self::FAILURE;
        }
        try {
            $id = $svc->startRestore($run->id, (bool) $this->option('documents'), (string) $this->option('reason'), $actor);
        } catch (AssignmentRuleViolation $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $svc->executeRestore($id);
        $r = DB::table('restore_runs')->where('id', $id)->first();
        $r->status === 'SUCCEEDED' ? $this->info('Pemulihan selesai.') : $this->error('Pemulihan gagal: '.$r->error);

        return $r->status === 'SUCCEEDED' ? self::SUCCESS : self::FAILURE;
    }
}
