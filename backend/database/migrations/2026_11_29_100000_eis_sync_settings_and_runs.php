<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** The EIS sync run from DISTRIVA itself: the EIS account (password encrypted), the power range, the automatic schedule and the history of the runs (docs/82 §19.15). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eis_sync_settings', function (Blueprint $table) {
            $table->smallInteger('id')->primary();
            $table->string('eis_username', 150)->nullable();
            $table->text('eis_password_encrypted')->nullable();
            $table->unsignedBigInteger('power_min')->default(0);
            $table->unsignedBigInteger('power_max')->default(99999999);
            $table->unsignedSmallInteger('lookback_days')->default(180);
            $table->boolean('auto_enabled')->default(false);
            $table->string('auto_time', 5)->default('18:13');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::unprepared('ALTER TABLE eis_sync_settings ADD CONSTRAINT eis_sync_settings_single CHECK (id = 1)');
        DB::unprepared("ALTER TABLE eis_sync_settings ADD CONSTRAINT eis_sync_settings_time_check CHECK (auto_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')");
        DB::unprepared('ALTER TABLE eis_sync_settings ADD CONSTRAINT eis_sync_settings_power_check CHECK (power_min <= power_max)');
        DB::table('eis_sync_settings')->insert(['id' => 1]);

        Schema::create('eis_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('trigger', 10);                 // MANUAL | AUTO
            $table->string('status', 10)->default('QUEUED');   // QUEUED | RUNNING | OK | FAILED
            $table->foreignUuid('started_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('range_from')->nullable();
            $table->date('range_to')->nullable();
            $table->text('log')->nullable();
            $table->smallInteger('exit_code')->nullable();
            $table->timestampTz('mfa_verified_at')->nullable();   // the MFA state of whoever started it: the run's token carries it (SYS_ADMIN writes need it)
            $table->timestampTz('created_at');
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('eis_sync_runs');
        Schema::dropIfExists('eis_sync_settings');
    }
};
