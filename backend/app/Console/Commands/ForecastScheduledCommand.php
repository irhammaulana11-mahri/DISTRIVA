<?php

namespace App\Console\Commands;

use App\Services\Forecast\ForecastService;
use Illuminate\Console\Command;

/** Called every minute by the scheduler: starts the monthly forecast run when it is due. */
class ForecastScheduledCommand extends Command
{
    protected $signature = 'distriva:forecast-scheduled';

    protected $description = 'Menjalankan forecast bulanan otomatis bila waktunya tiba.';

    public function handle(ForecastService $svc): int
    {
        $id = $svc->runScheduledIfDue();
        if ($id !== null) {
            $this->info("Forecast otomatis dimulai: {$id}");
        }

        return self::SUCCESS;
    }
}
