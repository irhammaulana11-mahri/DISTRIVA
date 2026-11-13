<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// Documents module, core (docs/26 §3.2 trimmed to what stage 2 needs; owner request 2026-11-06: "foto/dokumen sekalian dibuatkan modul").
// Logical document (per application, per category) + immutable file versions + append-only access log. Files live on a PRIVATE disk and
// are only served through an authorised endpoint. Workflow templates, requirements and Auto MTO packages of docs/26 come with later stages.
return new class extends Migration
{
    private const CATEGORIES = [
        ['APPLICATION', 'Permohonan'], ['SURVEY', 'Survey'], ['TECHNICAL_DRAWING', 'Gambar teknik'], ['RAB_KKF', 'RAB / KKF'], ['FEASIBILITY_STUDY', 'Studi kelayakan'],
        ['REGISTRATION', 'Registrasi'], ['PAYMENT', 'Pembayaran'], ['WORK_ORDER', 'Work order'], ['CONSTRUCTION', 'Konstruksi'], ['METER_INSTALLATION', 'Pemasangan meter'],
        ['COMPLETION', 'Penyelesaian'], ['OTHER', 'Lainnya'],
    ];

    public function up(): void
    {
        Schema::create('document_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 40)->unique();
            $table->string('name', 100);
            $table->jsonb('allowed_extensions');
            $table->unsignedInteger('max_size_kb')->default(10240);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });
        foreach (self::CATEGORIES as [$code, $name]) {
            DB::table('document_categories')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'name' => $name, 'allowed_extensions' => json_encode(['jpg', 'jpeg', 'png', 'webp', 'pdf']),
                'max_size_kb' => 10240, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }

        Schema::create('application_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('category_id')->constrained('document_categories')->restrictOnDelete();
            $table->string('document_code', 60)->unique();
            $table->string('title', 200);
            $table->uuid('current_version_id')->nullable();
            $table->string('status', 20)->default('ACTIVE');                 // ACTIVE | REMOVED (hidden; the files are kept)
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->index(['application_id', 'category_id']);
        });

        Schema::create('application_document_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained('application_documents')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->uuid('previous_version_id')->nullable();
            $table->string('original_name', 255);
            $table->string('stored_key', 255)->unique();                      // opaque key on the private disk; never shown to clients
            $table->string('mime_type', 100);
            $table->string('extension', 10);
            $table->unsignedBigInteger('size_bytes');
            $table->string('sha256', 64);
            $table->text('revision_reason')->nullable();
            $table->string('lifecycle_status', 20)->default('UPLOADED');
            $table->foreignUuid('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('uploaded_at');
            $table->unique(['document_id', 'version_number']);
            $table->unique(['document_id', 'id']);
        });

        Schema::create('document_access_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_version_id')->constrained('application_document_versions')->restrictOnDelete();
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 20);
            $table->string('ip_address', 64)->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['document_version_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE application_documents ADD CONSTRAINT application_documents_status_check CHECK (status IN ('ACTIVE','REMOVED'))");
        DB::statement("ALTER TABLE application_document_versions ADD CONSTRAINT application_document_versions_lifecycle_check CHECK (lifecycle_status IN ('UPLOADED','SUPERSEDED','ARCHIVED','QUARANTINED','REJECTED'))");
        DB::statement('ALTER TABLE application_document_versions ADD CONSTRAINT application_document_versions_size_check CHECK (size_bytes > 0 AND version_number > 0)');
        DB::statement("ALTER TABLE application_document_versions ADD CONSTRAINT application_document_versions_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')");
        DB::statement("ALTER TABLE document_access_logs ADD CONSTRAINT document_access_logs_action_check CHECK (action IN ('UPLOAD','VIEW','DOWNLOAD','REMOVE'))");
        // the pointer must belong to the SAME document (composite FK, deferred because document and first version are inserted together)
        DB::statement('ALTER TABLE application_documents ADD CONSTRAINT application_documents_current_version_fk FOREIGN KEY (id, current_version_id) REFERENCES application_document_versions (document_id, id) DEFERRABLE INITIALLY DEFERRED');
        DB::statement('ALTER TABLE application_document_versions ADD CONSTRAINT application_document_versions_previous_fk FOREIGN KEY (document_id, previous_version_id) REFERENCES application_document_versions (document_id, id)');

        // A stored file never changes: only the lifecycle may move (UPLOADED -> SUPERSEDED/ARCHIVED/QUARANTINED/REJECTED); versions are never deleted.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_document_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document versions cannot be deleted'; END IF;
                IF (NEW.document_id, NEW.version_number, NEW.previous_version_id, NEW.original_name, NEW.stored_key, NEW.mime_type, NEW.extension, NEW.size_bytes, NEW.sha256, NEW.uploaded_by, NEW.uploaded_at)
                   IS DISTINCT FROM
                   (OLD.document_id, OLD.version_number, OLD.previous_version_id, OLD.original_name, OLD.stored_key, OLD.mime_type, OLD.extension, OLD.size_bytes, OLD.sha256, OLD.uploaded_by, OLD.uploaded_at) THEN
                    RAISE EXCEPTION 'Document version content is immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_document_versions_guard BEFORE UPDATE OR DELETE ON application_document_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_document_version()');
        DB::unprepared('CREATE TRIGGER trg_document_access_logs_append_only BEFORE UPDATE OR DELETE ON document_access_logs FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_document_access_logs_no_truncate BEFORE TRUNCATE ON document_access_logs FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_document_access_logs_append_only ON document_access_logs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_document_access_logs_no_truncate ON document_access_logs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_document_versions_guard ON application_document_versions');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_document_version()');
            DB::statement('ALTER TABLE application_documents DROP CONSTRAINT IF EXISTS application_documents_current_version_fk');
        }
        foreach (['document_access_logs', 'application_document_versions', 'application_documents', 'document_categories'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
