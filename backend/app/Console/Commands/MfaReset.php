<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\MfaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Console recovery when a SYS_ADMIN lost the authenticator and the recovery codes. */
class MfaReset extends Command
{
    protected $signature = 'distriva:mfa-reset {--email= : E-mail of the account} {--force : Do not ask for confirmation}';

    protected $description = 'Forget the MFA credential of an account and revoke its tokens (the user enrols again at next login).';

    public function handle(MfaService $mfa): int
    {
        $user = User::query()->where('email', mb_strtolower(trim((string) $this->option('email'))))->first();
        if ($user === null) {
            $this->error('Akun tidak ditemukan.');

            return self::FAILURE;
        }
        $this->warn('Target database: '.DB::connection()->getDatabaseName());
        if (! $this->option('force') && ! $this->confirm("Reset MFA untuk {$user->email}? Semua sesi dicabut.")) {
            $this->line('Dibatalkan.');

            return self::SUCCESS;
        }
        $mfa->reset($user);
        $this->info('MFA direset; semua token dicabut. Pengguna mendaftar ulang saat login berikutnya.');

        return self::SUCCESS;
    }
}
