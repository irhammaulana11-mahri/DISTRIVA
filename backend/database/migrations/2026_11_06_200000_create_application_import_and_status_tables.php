<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// Stage 1B/1C (docs/62 §6-§7; owner decisions 2026-11-06): import of the EIS/Bot Daftung download through staging,
// external status history, the owner-approved external -> internal status mapping, field-level change log.
// Supersedes the earlier rule "a sync may only update 3 columns" (docs/16 v3.0/v3.1): the owner now allows the synchronisation
// to update customer/IDPEL/name/address/tariff/power/cost data; every change is logged with before/after.
return new class extends Migration
{
    private const MAPPING = [
        ['DISETUJUI', 'Disetujui', 'APPROVED', 'Permohonan disetujui, belum dibayar'],
        ['BAYAR', 'Bayar', 'PAID', 'Pelanggan sudah membayar (kode EIS pada unduhan asli)'],
        ['SUDAH BAYAR', 'Sudah bayar', 'PAID', 'Pelanggan sudah membayar (istilah pemilik)'],
        ['CETAK PK', 'Cetak PK', 'PK_PRINTED', 'PK dicetak'],
        ['PDL AWAL', 'PDL Awal', 'CONNECTION_IN_PROGRESS', 'Proses penyambungan'],
        ['PEREMAJAAN', 'Peremajaan', 'CONNECTION_DONE', 'Selesai penyambungan'],
        ['BATAL', 'Batal', 'CANCELLED', 'Permohonan dibatalkan'],
        ['RESTITUSI', 'Restitusi', 'REFUNDED', 'Sudah dibayar tetapi tidak disambung; biaya dikembalikan'],
    ];

    public function up(): void
    {
        Schema::table('applications', function (Blueprint $table) {
            $table->timestampTz('last_external_status_at')->nullable();   // TGL_UPDATE_PERMOHONAN of the last applied external status
        });

        Schema::create('external_status_mappings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('external_system', 50)->default('EIS_AP2T');
            $table->string('external_status_code', 100);                  // normalised: upper case, single spaces
            $table->string('external_status_name', 150);
            $table->string('internal_status', 50);
            $table->boolean('is_active')->default(true);
            $table->text('description')->nullable();
            $table->timestampsTz();
            $table->unique(['external_system', 'external_status_code']);
        });
        foreach (self::MAPPING as [$code, $name, $internal, $desc]) {
            DB::table('external_status_mappings')->insert(['id' => (string) Str::uuid(), 'external_system' => 'EIS_AP2T', 'external_status_code' => $code, 'external_status_name' => $name,
                'internal_status' => $internal, 'is_active' => true, 'description' => $desc, 'created_at' => now(), 'updated_at' => now()]);
        }

        Schema::create('application_import_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source_system', 50)->default('EIS_AP2T');
            $table->string('file_name', 255);
            $table->string('file_format', 10);
            $table->string('file_sha256', 64);
            $table->string('status', 20)->default('STAGED');
            $table->unsignedInteger('total_rows')->default(0);
            $table->jsonb('counts')->nullable();
            $table->foreignUuid('initiated_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('confirmed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampsTz();
            $table->index(['initiated_by', 'created_at']);
        });

        Schema::create('application_import_staging', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('application_import_batches')->restrictOnDelete();
            $table->unsignedInteger('row_number');
            $table->string('source_reference_id', 150)->nullable();       // NOAGENDA as TEXT
            $table->jsonb('payload');                                      // the original row, untouched
            $table->jsonb('normalized')->nullable();
            $table->string('action', 20);                                  // NEW | MATCHED | UNCHANGED | REJECT
            $table->foreignUuid('organizational_unit_id')->nullable()->constrained('organizational_units')->restrictOnDelete();
            $table->foreignUuid('application_id')->nullable()->constrained('applications')->restrictOnDelete();
            $table->jsonb('errors')->nullable();
            $table->jsonb('warnings')->nullable();
            $table->jsonb('changes')->nullable();                          // preview: field => [old, new]
            $table->string('apply_status', 20)->default('PENDING');        // PENDING | APPLIED | SKIPPED | FAILED
            $table->text('apply_message')->nullable();
            $table->timestampTz('processed_at')->nullable();
            $table->timestampTz('created_at')->nullable();
            $table->unique(['batch_id', 'row_number']);
            $table->index(['batch_id', 'action']);
        });

        Schema::create('application_external_status_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('external_system', 50)->default('EIS_AP2T');
            $table->string('external_status_code', 100);
            $table->string('external_status_name', 150)->nullable();
            $table->unsignedInteger('service_days')->nullable();          // DURASI_HARI_KERJA
            $table->timestampTz('observed_at')->nullable();               // TGL_UPDATE_PERMOHONAN
            $table->timestampTz('received_at');
            $table->foreignUuid('batch_id')->nullable()->constrained('application_import_batches')->restrictOnDelete();
            $table->string('applied_internal_status', 50)->nullable();    // set when this status moved the internal one
            $table->string('note', 255)->nullable();
            $table->jsonb('source_payload')->nullable();
            $table->index(['application_id', 'observed_at']);
        });

        Schema::create('application_change_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('field_name', 100);
            $table->text('old_value')->nullable();
            $table->text('new_value')->nullable();
            $table->string('source', 30);                                  // IMPORT
            $table->foreignUuid('batch_id')->nullable()->constrained('application_import_batches')->restrictOnDelete();
            $table->boolean('needs_review')->default(false);
            $table->foreignUuid('changed_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('changed_at');
            $table->index(['application_id', 'changed_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE applications DROP CONSTRAINT applications_status_check');
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK (current_status IN ('DRAFT','SUBMITTED','APPROVED','PAID','PK_PRINTED','CONNECTION_IN_PROGRESS','CONNECTION_DONE','CANCELLED','REFUNDED'))");
        DB::statement('ALTER TABLE applications DROP CONSTRAINT applications_submitted_check');
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_submitted_check CHECK (current_status IN ('DRAFT','CANCELLED','APPROVED','PAID','PK_PRINTED','CONNECTION_IN_PROGRESS','CONNECTION_DONE','REFUNDED') OR submitted_at IS NOT NULL)");
        DB::statement("ALTER TABLE application_import_batches ADD CONSTRAINT application_import_batches_status_check CHECK (status IN ('STAGED','CONFIRMED','DISCARDED'))");
        DB::statement("ALTER TABLE application_import_staging ADD CONSTRAINT application_import_staging_action_check CHECK (action IN ('NEW','MATCHED','UNCHANGED','REJECT'))");
        DB::statement("ALTER TABLE application_import_staging ADD CONSTRAINT application_import_staging_apply_check CHECK (apply_status IN ('PENDING','APPLIED','SKIPPED','FAILED'))");
        DB::statement("ALTER TABLE external_status_mappings ADD CONSTRAINT external_status_mappings_internal_check CHECK (internal_status IN ('APPROVED','PAID','PK_PRINTED','CONNECTION_IN_PROGRESS','CONNECTION_DONE','CANCELLED','REFUNDED'))");
        DB::unprepared('CREATE TRIGGER trg_application_change_logs_append_only BEFORE UPDATE OR DELETE ON application_change_logs FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_application_change_logs_no_truncate BEFORE TRUNCATE ON application_change_logs FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_application_external_status_append_only BEFORE UPDATE OR DELETE ON application_external_status_histories FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_application_external_status_no_truncate BEFORE TRUNCATE ON application_external_status_histories FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_external_status_append_only ON application_external_status_histories');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_external_status_no_truncate ON application_external_status_histories');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_change_logs_append_only ON application_change_logs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_change_logs_no_truncate ON application_change_logs');
            DB::statement('ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_submitted_check');
            DB::statement('ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check');
            DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK (current_status IN ('DRAFT','SUBMITTED','CANCELLED'))");
            DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_submitted_check CHECK (current_status = 'DRAFT' OR submitted_at IS NOT NULL OR current_status = 'CANCELLED')");
        }
        foreach (['application_change_logs', 'application_external_status_histories', 'application_import_staging', 'application_import_batches', 'external_status_mappings'] as $t) {
            Schema::dropIfExists($t);
        }
        Schema::table('applications', fn (Blueprint $table) => $table->dropColumn('last_external_status_at'));
    }
};
