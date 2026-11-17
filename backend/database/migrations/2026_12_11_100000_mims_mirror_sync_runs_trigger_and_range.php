<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What started a MIMS pull of issues / receipts / reservations (AUTO = the daily schedule, MANUAL = a user on demand) and the date range it asked MIMS for (range_from..range_to),
 * so the history can show which days still have no pull. Additive and idempotent. Old rows: the trigger is guessed from the time of day (a pull that started within two minutes after the
 * scheduled time is the schedule's), the range is ESTIMATED as the default window ending on the day of the pull (range_estimated = true), because the real range of old pulls was not recorded.
 */
return new class extends Migration
{
    private const TABLES = ['mims_issue_sync_runs', 'mims_receipt_sync_runs', 'mims_reservation_sync_runs'];

    public function up(): void
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $days = (int) config('distriva.mims.issue_days', 90);
        $time = (string) (DB::table('mims_sync_settings')->where('id', 1)->value('auto_time') ?? '');
        foreach (self::TABLES as $table) {
            if (! Schema::hasTable($table) || Schema::hasColumn($table, 'trigger_kind')) {
                continue;
            }
            Schema::table($table, function (Blueprint $t): void {
                $t->string('trigger_kind', 10)->nullable();
                $t->date('range_from')->nullable();
                $t->date('range_to')->nullable();
                $t->boolean('range_estimated')->default(false);
            });
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_trigger_kind_check CHECK (trigger_kind IS NULL OR trigger_kind IN ('AUTO','MANUAL','CLI'))");
            DB::statement("UPDATE {$table} SET range_to = (started_at AT TIME ZONE ?)::date, range_from = (started_at AT TIME ZONE ?)::date - ?::int, range_estimated = true", [$tz, $tz, $days]);
            DB::statement("UPDATE {$table} SET trigger_kind = 'CLI' WHERE triggered_by IS NULL");
            if (preg_match('/^\d{2}:\d{2}$/', $time) === 1) {
                DB::statement("UPDATE {$table} SET trigger_kind = CASE WHEN (started_at AT TIME ZONE ?)::time >= ?::time AND (started_at AT TIME ZONE ?)::time < (?::time + interval '2 minutes') THEN 'AUTO' ELSE 'MANUAL' END WHERE trigger_kind IS NULL", [$tz, $time, $tz, $time]);
            } else {
                DB::statement("UPDATE {$table} SET trigger_kind = 'MANUAL' WHERE trigger_kind IS NULL");
            }
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasColumn($table, 'trigger_kind')) {
                DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_trigger_kind_check");
                Schema::table($table, function (Blueprint $t): void {
                    $t->dropColumn(['trigger_kind', 'range_from', 'range_to', 'range_estimated']);
                });
            }
        }
    }
};
