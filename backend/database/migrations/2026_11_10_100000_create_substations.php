<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Master gardu for KKO (docs/80, owner 2026-11-10): the survey picks a substation and its operational data (loading, end voltage, current per phase) fills in.
 * substations = master (one row per gardu); substation_transformers = up to 3 transformers; substation_readings = operational readings, append-only (a correction is a new reading);
 * substation_sync_batches / _rows = staged imports and the daily bot (STAGED -> CONFIRMED). application_kko gets the chosen substation (its numbers stay snapshots).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('substations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 40)->unique();                                // KD_GARDU (HD0001): the business key
            $table->string('asset_number', 60)->nullable();
            $table->string('location_code', 60)->nullable();                     // Maximo LOCATION (GD01.…)
            $table->string('gadis_number', 60)->nullable();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('feeder_code', 40)->nullable();
            $table->string('gi_code', 40)->nullable();
            $table->string('jtm_number', 60)->nullable();
            $table->string('type_code', 20)->nullable();                         // GD2T | GD1T | BETON | LAINNYA
            $table->string('ownership', 12)->default('PLN');                     // PLN | PELANGGAN (a customer's transformer is never chosen for the KKO)
            $table->string('usage', 12)->nullable();                             // UMUM | KHUSUS | CAMPURAN
            $table->string('name', 200)->nullable();
            $table->string('area_note', 200)->nullable();
            $table->string('kabupaten', 100)->nullable();
            $table->string('kecamatan', 100)->nullable();
            $table->string('kelurahan', 100)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('capacity_kva', 12, 3)->nullable();
            $table->unsignedSmallInteger('transformer_count')->default(1);
            $table->string('status', 10)->default('AKTIF');                      // AKTIF | NONAKTIF
            $table->boolean('needs_review')->default(false);                     // missing from a full file: marked only, never switched off by itself
            $table->timestampTz('last_seen_at')->nullable();
            $table->uuid('last_batch_id')->nullable();
            $table->timestampsTz();
            $table->index(['organizational_unit_id', 'status']);
            $table->index('feeder_code');
        });
        DB::statement("ALTER TABLE substations ADD CONSTRAINT substations_values_check CHECK (ownership IN ('PLN','PELANGGAN') AND status IN ('AKTIF','NONAKTIF') AND (capacity_kva IS NULL OR capacity_kva > 0) AND (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180))");

        Schema::create('substation_transformers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('substation_id')->constrained('substations')->cascadeOnDelete();
            $table->unsignedSmallInteger('slot');
            $table->string('brand', 100)->nullable();
            $table->string('serial_number', 100)->nullable();
            $table->string('year_made', 10)->nullable();
            $table->decimal('capacity_kva', 12, 3);
            $table->string('phase', 10)->nullable();
            $table->string('vector_group', 20)->nullable();
            $table->string('tap', 20)->nullable();
            $table->string('impedance', 20)->nullable();
            $table->string('unit_status', 30)->nullable();
            $table->unique(['substation_id', 'slot']);
        });
        DB::statement('ALTER TABLE substation_transformers ADD CONSTRAINT substation_transformers_check CHECK (slot BETWEEN 1 AND 3 AND capacity_kva > 0)');

        Schema::create('substation_sync_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source', 10);                                         // FILE | BOT
            $table->string('kind', 10)->default('MASTER');                        // MASTER (master + readings in the file)
            $table->string('status', 12)->default('STAGED');                      // STAGED | CONFIRMED | DISCARDED
            $table->string('file_name', 255)->nullable();
            $table->string('file_sha256', 64)->nullable();
            $table->boolean('full_snapshot')->default(false);                     // a full list: gardu absent from it are marked needs_review
            $table->foreignUuid('default_unit_id')->nullable()->constrained('organizational_units');
            $table->unsignedInteger('total_rows')->default(0);
            $table->jsonb('counts')->nullable();
            $table->foreignUuid('initiated_by')->constrained('users');
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampsTz();
        });
        Schema::create('substation_sync_rows', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('substation_sync_batches')->cascadeOnDelete();
            $table->unsignedInteger('row_number');
            $table->string('code', 40)->nullable();
            $table->string('action', 12);                                         // NEW | CHANGED | UNCHANGED | REJECT
            $table->jsonb('normalized')->nullable();
            $table->jsonb('changes')->nullable();
            $table->jsonb('errors')->nullable();
            $table->index(['batch_id', 'action']);
        });

        Schema::create('substation_readings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('substation_id')->constrained('substations')->restrictOnDelete();
            $table->date('measured_on');
            $table->decimal('load_kva', 12, 3)->nullable();
            $table->decimal('loading_pct', 8, 2)->nullable();
            $table->string('load_basis', 10)->nullable();                         // GIVEN | PERCENT | CURRENT
            $table->decimal('current_r_a', 9, 2)->nullable();
            $table->decimal('current_s_a', 9, 2)->nullable();
            $table->decimal('current_t_a', 9, 2)->nullable();
            $table->decimal('current_n_a', 9, 2)->nullable();
            $table->decimal('current_max_a', 9, 2)->nullable();                   // a single current of the source (e.g. the old BEBAN column) when the phases are not known
            $table->decimal('end_voltage_v', 8, 2)->nullable();
            $table->decimal('kwh_total', 14, 2)->nullable();
            $table->string('source', 10);                                         // SYNC | IMPORT | MANUAL | SURVEY
            $table->uuid('batch_id')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users');
            $table->timestampTz('created_at');
            $table->unique(['substation_id', 'measured_on', 'source']);
            $table->index(['substation_id', 'measured_on']);
        });
        DB::statement("ALTER TABLE substation_readings ADD CONSTRAINT substation_readings_check CHECK ((load_kva IS NULL OR load_kva >= 0) AND (loading_pct IS NULL OR loading_pct >= 0) AND (end_voltage_v IS NULL OR (end_voltage_v > 0 AND end_voltage_v < 1000)) AND source IN ('SYNC','IMPORT','MANUAL','SURVEY'))");
        DB::unprepared('CREATE TRIGGER trg_substation_readings_append_only BEFORE UPDATE OR DELETE ON substation_readings FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_substation_readings_no_truncate BEFORE TRUNCATE ON substation_readings FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');

        Schema::table('application_kko', function (Blueprint $table) {
            $table->foreignUuid('substation_id')->nullable()->constrained('substations')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('application_kko', function (Blueprint $table) {
            $table->dropConstrainedForeignId('substation_id');
        });
        DB::unprepared('DROP TRIGGER IF EXISTS trg_substation_readings_no_truncate ON substation_readings');
        Schema::dropIfExists('substation_readings');
        Schema::dropIfExists('substation_sync_rows');
        Schema::dropIfExists('substation_sync_batches');
        Schema::dropIfExists('substation_transformers');
        Schema::dropIfExists('substations');
    }
};
