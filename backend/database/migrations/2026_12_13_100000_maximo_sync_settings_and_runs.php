<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** The Maximo sync started from DISTRIVA (tools/maximo_sync): the Maximo account (password encrypted), the look-back window, the daily run, and one row per run with its log. Additive and idempotent. */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('maximo_sync_settings')) {
            Schema::create('maximo_sync_settings', function (Blueprint $table) {
                $table->smallInteger('id')->primary();
                $table->string('maximo_url', 200)->default('http://10.99.10.41');
                $table->string('maximo_username', 150)->nullable();
                $table->text('maximo_password_encrypted')->nullable();
                $table->string('work_type', 10)->default('INST1');            // INST1 = inspection with measurements
                $table->unsignedSmallInteger('lookback_days')->default(3);   // the window of the daily run: work orders finished in the last N days
                $table->boolean('auto_enabled')->default(false);
                $table->string('auto_time', 5)->default('19:30');
                $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestampTz('updated_at')->nullable();
            });
            DB::unprepared('ALTER TABLE maximo_sync_settings ADD CONSTRAINT maximo_sync_settings_single CHECK (id = 1)');
            DB::unprepared("ALTER TABLE maximo_sync_settings ADD CONSTRAINT maximo_sync_settings_time_check CHECK (auto_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')");
            DB::table('maximo_sync_settings')->insert(['id' => 1]);
        }
        if (! Schema::hasTable('maximo_sync_runs')) {
            Schema::create('maximo_sync_runs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('trigger', 10);                                // MANUAL | AUTO
                $table->string('status', 10)->default('QUEUED');              // QUEUED | RUNNING | OK | FAILED
                $table->foreignUuid('started_by')->nullable()->constrained('users')->nullOnDelete();
                $table->date('since')->nullable();                            // work orders finished on or after this date
                $table->boolean('all_work_orders')->default(false);           // false = only the latest work order of each gardu
                $table->text('log')->nullable();
                $table->jsonb('summary')->nullable();                         // listed / fetched / failed and what the load stored
                $table->smallInteger('exit_code')->nullable();
                $table->timestampTz('created_at');
                $table->timestampTz('started_at')->nullable();
                $table->timestampTz('finished_at')->nullable();
                $table->index('created_at');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maximo_sync_runs');
        Schema::dropIfExists('maximo_sync_settings');
    }
};
