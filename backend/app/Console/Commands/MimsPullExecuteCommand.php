<?php

namespace App\Console\Commands;

use App\Services\Inventory\MimsPullRunService;
use Illuminate\Console\Command;

/** Internal: runs a registered manual MIMS pull in a detached process (the pasted token arrives in the environment). */
class MimsPullExecuteCommand extends Command
{
    protected $signature = 'distriva:mims-pull-execute {id}';

    protected $description = 'Internal: menjalankan penarikan MIMS manual yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(MimsPullRunService $svc): int
    {
        $token = getenv('DISTRIVA_MIMS_PULL_TOKEN');
        $svc->execute((string) $this->argument('id'), $token === false ? null : $token);

        return self::SUCCESS;
    }
}
