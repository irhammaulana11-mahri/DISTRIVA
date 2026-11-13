<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Verification from the terminal. */
class BackupVerifyCommand extends Command
{
    protected $signature = 'distriva:backup-verify {backup : backup number or id}';

    protected $description = 'Menguji cadangan dengan memulihkannya ke database sementara (database asli tidak disentuh).';

    public function handle(BackupService $svc): int
    {
        $run = DB::table('backup_runs')->where('backup_number', $this->argument('backup'))->when(Str::isUuid((string) $this->argument('backup')), fn ($q) => $q->orWhere('id', $this->argument('backup')))->first();
        if ($run === null) {
            $this->error('Cadangan tidak ditemukan.');

            return self::FAILURE;
        }
        $r = $svc->verify($run->id, null);
        $this->line(json_encode(['passed' => $r['passed'], 'checks' => $r['checks'], 'differences' => $r['differences'] ?? [], 'error' => $r['error'] ?? null], JSON_UNESCAPED_UNICODE));

        return $r['passed'] ? self::SUCCESS : self::FAILURE;
    }
}
