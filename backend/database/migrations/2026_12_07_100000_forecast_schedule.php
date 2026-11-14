<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Scheduled forecast (owner Nov 2026): one settings row (monthly, on a day and time) and the trigger of each run (MANUAL | AUTO). Additive only. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forecast_settings', function (Blueprint $table) {
            $table->smallInteger('id')->primary();
            $table->boolean('auto_enabled')->default(false);
            $table->unsignedSmallInteger('day_of_month')->default(1);          // 1-28, so every month has it
            $table->string('run_time', 5)->default('03:00');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();   // the runs are started as this user
            $table->timestampTz('updated_at')->nullable();
        });
        DB::table('forecast_settings')->insert(['id' => 1]);
        Schema::table('forecast_runs', function (Blueprint $table) {
            $table->string('trigger', 10)->default('MANUAL');
        });
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE forecast_settings ADD CONSTRAINT forecast_settings_single CHECK (id = 1)');
        DB::statement('ALTER TABLE forecast_settings ADD CONSTRAINT forecast_settings_day_check CHECK (day_of_month BETWEEN 1 AND 28)');
        DB::statement("ALTER TABLE forecast_settings ADD CONSTRAINT forecast_settings_time_check CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')");
        DB::statement("ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_trigger_check CHECK (trigger IN ('MANUAL','AUTO'))");
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE forecast_runs DROP CONSTRAINT IF EXISTS forecast_runs_trigger_check');
        }
        Schema::table('forecast_runs', function (Blueprint $table) {
            $table->dropColumn('trigger');
        });
        Schema::dropIfExists('forecast_settings');
    }
};
