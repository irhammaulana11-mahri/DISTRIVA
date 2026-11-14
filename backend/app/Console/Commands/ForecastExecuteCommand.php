<?php

namespace App\Console\Commands;

use App\Services\Forecast\ForecastService;
use Illuminate\Console\Command;

/** Internal: runs a registered forecast in a detached process (training takes minutes). */
class ForecastExecuteCommand extends Command
{
    protected $signature = 'distriva:forecast-execute {id}';

    protected $description = 'Internal: menjalankan forecast yang sudah didaftarkan.';

    protected $hidden = true;

    public function handle(ForecastService $forecast): int
    {
        $forecast->execute((string) $this->argument('id'));

        return self::SUCCESS;
    }
}
