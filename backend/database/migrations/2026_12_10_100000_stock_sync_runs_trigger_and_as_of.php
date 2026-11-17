<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What started a stock pull (AUTO = the daily schedule, MANUAL = a user pulling on demand, CLI = the artisan command) and the date the pull was for.
 * Additive and idempotent. Old rows are filled as well as the data allows: the date from the snapshot, or from the "per YYYY-MM-DD" of a skipped pull; the trigger from
 * triggered_by (null = CLI) and, for the rest, from the time of day: a pull that started within two minutes after the scheduled time is the schedule's, any other is manual.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('stock_sync_runs') || Schema::hasColumn('stock_sync_runs', 'trigger_kind')) {
            return;
        }
        Schema::table('stock_sync_runs', function (Blueprint $table): void {
            $table->string('trigger_kind', 10)->nullable();
            $table->date('as_of')->nullable();
        });
        DB::statement("ALTER TABLE stock_sync_runs ADD CONSTRAINT stock_sync_runs_trigger_kind_check CHECK (trigger_kind IS NULL OR trigger_kind IN ('AUTO','MANUAL','CLI'))");
        DB::statement('UPDATE stock_sync_runs r SET as_of = s.as_of FROM stock_snapshots s WHERE s.id = r.snapshot_id');
        DB::statement("UPDATE stock_sync_runs SET as_of = substring(message from 'per (\\d{4}-\\d{2}-\\d{2})')::date WHERE as_of IS NULL AND message ~ 'per \\d{4}-\\d{2}-\\d{2}'");
        DB::statement("UPDATE stock_sync_runs SET trigger_kind = 'CLI' WHERE triggered_by IS NULL");
        $time = (string) (DB::table('mims_sync_settings')->where('id', 1)->value('auto_time') ?? '');
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        if (preg_match('/^\d{2}:\d{2}$/', $time) === 1) {
            DB::statement("UPDATE stock_sync_runs SET trigger_kind = CASE WHEN (started_at AT TIME ZONE ?)::time >= ?::time AND (started_at AT TIME ZONE ?)::time < (?::time + interval '2 minutes') THEN 'AUTO' ELSE 'MANUAL' END WHERE trigger_kind IS NULL AND triggered_by IS NOT NULL", [$tz, $time, $tz, $time]);
        } else {
            DB::statement("UPDATE stock_sync_runs SET trigger_kind = 'MANUAL' WHERE trigger_kind IS NULL AND triggered_by IS NOT NULL");
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('stock_sync_runs', 'trigger_kind')) {
            DB::statement('ALTER TABLE stock_sync_runs DROP CONSTRAINT IF EXISTS stock_sync_runs_trigger_kind_check');
            Schema::table('stock_sync_runs', function (Blueprint $table): void {
                $table->dropColumn(['trigger_kind', 'as_of']);
            });
        }
    }
};
