<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Data gangguan penyulang dan recloser yang dibaca dari Google Sheet (docs/87): peristiwa, pengaturan sinkronisasi (satu baris), riwayat sinkronisasi, dan alias nama penyulang
 * yang tidak cocok otomatis dengan master penyulang. Peristiwa memakai kunci sumber yang stabil (sidik jari tanggal, jam, GI, penyulang, jenis alat) agar sinkron berulang tidak menggandakan;
 * baris yang hilang dari sheet hanya ditandai `source_removed_at`, tidak dihapus.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outage_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source_key', 80)->unique();
            $table->string('row_hash', 40);
            $table->unsignedBigInteger('sheet_gid')->nullable();
            $table->timestampTz('occurred_at');
            $table->timestampTz('restored_at')->nullable();
            $table->decimal('duration_minutes', 10, 2)->nullable();
            $table->foreignUuid('organizational_unit_id')->nullable()->constrained('organizational_units')->nullOnDelete();
            $table->string('rayon', 60)->nullable();
            $table->string('gi_name', 100);
            $table->string('feeder_name', 100);
            $table->foreignUuid('feeder_id')->nullable()->constrained('distribution_feeders')->nullOnDelete();
            $table->string('device_text', 60)->nullable();
            $table->string('device_group', 10);                       // PMT | RECLOSER | OTHER
            $table->string('outage_type', 10)->nullable();             // TEMPORER | PERMANEN
            $table->decimal('load_before_a', 10, 2)->nullable();
            $table->decimal('current_r', 10, 2)->nullable();
            $table->decimal('current_s', 10, 2)->nullable();
            $table->decimal('current_t', 10, 2)->nullable();
            $table->decimal('current_n', 10, 2)->nullable();
            $table->decimal('ens_kwh', 14, 2)->nullable();
            $table->string('relay', 60)->nullable();
            $table->text('cause')->nullable();
            $table->string('weather', 80)->nullable();
            $table->string('category', 80)->nullable();
            $table->string('fault_code', 160)->nullable();
            $table->string('incident_code', 80)->nullable();
            $table->string('zone', 20)->nullable();
            $table->string('section', 20)->nullable();
            $table->string('construction', 80)->nullable();
            $table->string('coordinates', 80)->nullable();
            $table->foreignUuid('last_run_id')->nullable();
            $table->timestampTz('source_removed_at')->nullable();
            $table->timestampsTz();
            $table->index('occurred_at');
            $table->index(['feeder_id', 'occurred_at']);
            $table->index(['organizational_unit_id', 'occurred_at']);
            $table->index(['outage_type', 'occurred_at']);
        });
        DB::statement("ALTER TABLE outage_events ADD CONSTRAINT outage_events_check CHECK (device_group IN ('PMT','RECLOSER','OTHER') AND (outage_type IS NULL OR outage_type IN ('TEMPORER','PERMANEN')) AND (duration_minutes IS NULL OR duration_minutes >= 0))");

        Schema::create('outage_sync_settings', function (Blueprint $table) {
            $table->smallInteger('id')->primary();
            $table->string('sheet_id', 120)->nullable();
            $table->jsonb('gids')->default('[]');                   // tab (gid) yang dibaca; satu atau beberapa
            $table->boolean('auto_enabled')->default(false);
            $table->string('auto_time', 5)->default('06:30');
            $table->unsignedSmallInteger('saidi_min_minutes')->default(5);   // gangguan lebih singkat dari ini tidak masuk SAIDI/SAIFI (keputusan pemilik: 5 menit)
            $table->boolean('saidi_only_permanent')->default(false);
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::unprepared('ALTER TABLE outage_sync_settings ADD CONSTRAINT outage_sync_settings_single CHECK (id = 1)');
        DB::unprepared("ALTER TABLE outage_sync_settings ADD CONSTRAINT outage_sync_settings_time_check CHECK (auto_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')");
        DB::table('outage_sync_settings')->insert(['id' => 1]);

        Schema::create('outage_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('trigger', 10);                          // MANUAL | AUTO
            $table->string('status', 10)->default('QUEUED');        // QUEUED | RUNNING | OK | FAILED
            $table->foreignUuid('started_by')->nullable()->constrained('users')->nullOnDelete();
            $table->jsonb('counts')->nullable();
            $table->text('message')->nullable();
            $table->timestampTz('created_at');
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->index('created_at');
        });

        Schema::create('outage_feeder_aliases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('gi_key', 100);
            $table->string('feeder_key', 100);
            $table->string('gi_name', 100);
            $table->string('feeder_name', 100);
            $table->foreignUuid('feeder_id')->constrained('distribution_feeders')->cascadeOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['gi_key', 'feeder_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outage_feeder_aliases');
        Schema::dropIfExists('outage_sync_runs');
        Schema::dropIfExists('outage_sync_settings');
        Schema::dropIfExists('outage_events');
    }
};
