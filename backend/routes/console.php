<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
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

// Automatic MIMS stock pull with the token saved by the user who switched it on (docs/82 §19.15).
Schedule::command('distriva:mims-sync-auto')->everyMinute()->withoutOverlapping();
