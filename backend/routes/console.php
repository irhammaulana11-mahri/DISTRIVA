<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Expired idle-timeout tokens (distriva.token_idle_minutes) are purged daily.
Schedule::command('sanctum:prune-expired --hours=24')->daily();

// Old OTP challenges (used, voided or expired) are not needed for audit: the outcome is in authorization_change_histories.
Schedule::call(fn () => DB::table('otp_challenges')->where('created_at', '<', now()->subDays(7))->delete())->daily();

// Daily backup when due (settings in backup_settings; docs/64). Needs the usual `* * * * * php artisan schedule:run` cron entry.
Schedule::command('distriva:backup-scheduled')->everyMinute()->withoutOverlapping();

// Daily pull of the ERP (MIMS) stock monitoring into stock snapshots (docs/62 §40); runs only when the base URL and token are configured in the environment.
Schedule::command('distriva:mims-sync-stock')->dailyAt((string) config('distriva.mims.sync_time', '02:00'))->when(fn () => filled(config('distriva.mims.base_url')) && filled(config('distriva.mims.auth_token')))->withoutOverlapping();

// Automatic EIS sync when due (settings in eis_sync_settings; docs/82 §19.15). Needs the usual `* * * * * php artisan schedule:run` cron entry.
Schedule::command('distriva:eis-sync-scheduled')->everyMinute()->withoutOverlapping();
// Daily outage sync from the Google Sheet when due (settings in outage_sync_settings; docs/86).
Schedule::command('distriva:outage-sync-scheduled')->everyMinute()->withoutOverlapping();

// Automatic Maximo sync when due (settings in maximo_sync_settings; tools/maximo_sync).
Schedule::command('distriva:maximo-sync-scheduled')->everyMinute()->withoutOverlapping();

// Automatic MIMS stock pull with the token saved by the user who switched it on (docs/82 §19.15).
Schedule::command('distriva:mims-sync-auto')->everyMinute()->withoutOverlapping();

// Task reminders (docs/24 §8): once when a task is about to be due, once when overdue. Needs the usual `* * * * * php artisan schedule:run` cron entry.
Schedule::command('distriva:tasks-remind')->hourly()->withoutOverlapping();

// Monthly forecast of substation load and demand when due (settings in forecast_settings; docs/11). Needs the usual `* * * * * php artisan schedule:run` cron entry.
Schedule::command('distriva:forecast-scheduled')->everyMinute()->withoutOverlapping();

// Heartbeat of the scheduler: `distriva:preflight` reports when the `schedule:run` cron entry stopped (every other scheduled job depends on it).
Schedule::call(fn () => Cache::forever('distriva.scheduler.heartbeat', now()->toIso8601String()))->everyMinute()->name('scheduler-heartbeat');
