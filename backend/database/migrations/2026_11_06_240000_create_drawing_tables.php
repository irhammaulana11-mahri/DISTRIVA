<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 3 — Technical drawing (docs/09, docs/62 §10; owner decisions 2026-11-06). One package per application, many VERSIONS (one MAIN file +
// attachments through the documents module). Status cycle DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED (RETURNED on any rejection, SUPERSEDED when a
// newer version is approved). `stage`: ULP_MANAGER -> UP3_REVIEW (PERENCANAAN + KONSTRUKSI_UP3) -> ASMAN (ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI) -> APPROVED;
// when extended_approval: the ASMAN stage also needs ASMAN_NIAGA and is followed by UP3_MANAGER.
// extended_approval = feasibility "tidak layak" or PBP > 5 years; it can only be raised, never lowered. Author != every decider; one decision per user per version.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('application_drawings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->unique()->constrained('applications')->restrictOnDelete();
            $table->string('drawing_number', 90)->unique();
            $table->foreignUuid('assigned_to')->constrained('users')->restrictOnDelete();       // the author (TEKNIK of the ULP)
            $table->foreignUuid('assigned_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('basis_survey_version_id')->constrained('application_survey_versions')->restrictOnDelete();   // the ACCEPTED survey that requires a drawing
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });

        Schema::create('application_drawing_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('drawing_id')->constrained('application_drawings')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('status', 20)->default('DRAFT');
            $table->string('stage', 20)->nullable();
            $table->foreignUuid('author_id')->constrained('users')->restrictOnDelete();
            $table->string('title', 200)->nullable();
            $table->text('description')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('extended_approval')->default(false);
            $table->text('extended_reason')->nullable();
            $table->foreignUuid('extended_set_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('superseded_at')->nullable();
            $table->timestampTz('returned_at')->nullable();
            $table->string('returned_at_step', 40)->nullable();
            $table->foreignUuid('returned_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('return_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['drawing_id', 'version_number']);
        });

        Schema::create('application_drawing_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('version_id')->constrained('application_drawing_versions')->restrictOnDelete();
            $table->string('step', 40);
            $table->string('decision', 10);
            $table->foreignUuid('decided_by')->constrained('users')->restrictOnDelete();
            $table->string('decided_role', 50);
            $table->text('notes')->nullable();
            $table->timestampTz('decided_at');
            $table->unique(['version_id', 'step']);
            $table->unique(['version_id', 'decided_by']);
        });

        Schema::table('application_documents', function (Blueprint $table) {
            $table->foreignUuid('drawing_version_id')->nullable()->constrained('application_drawing_versions')->restrictOnDelete();
            $table->string('file_role', 12)->nullable();                                    // MAIN | ATTACHMENT (drawing packages)
            $table->index('drawing_version_id');
        });

        // The drawing category: office, CAD and PDF/image formats, up to 50 MB (content is verified by signature, see DocumentService).
        DB::table('document_categories')->where('code', 'TECHNICAL_DRAWING')->update(['allowed_extensions' => json_encode(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'xls', 'xlsx', 'doc', 'docx', 'dwg', 'dxf']), 'max_size_kb' => 51200, 'updated_at' => now()]);

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE application_drawing_decisions ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
        DB::statement("ALTER TABLE application_drawing_versions ADD CONSTRAINT application_drawing_versions_status_check CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','RETURNED','SUPERSEDED'))");
        DB::statement("ALTER TABLE application_drawing_versions ADD CONSTRAINT application_drawing_versions_stage_check CHECK ((status = 'SUBMITTED' AND stage IS NOT DISTINCT FROM 'ULP_MANAGER') OR (status = 'UNDER_REVIEW' AND COALESCE(stage IN ('UP3_REVIEW','ASMAN','UP3_MANAGER'), false)) OR (status IN ('DRAFT','APPROVED','RETURNED','SUPERSEDED') AND stage IS NULL))");
        DB::statement("ALTER TABLE application_drawing_versions ADD CONSTRAINT application_drawing_versions_extended_check CHECK (NOT extended_approval OR (extended_set_by IS NOT NULL AND length(btrim(coalesce(extended_reason, ''))) > 0))");
        DB::statement("ALTER TABLE application_drawing_decisions ADD CONSTRAINT application_drawing_decisions_step_check CHECK (step IN ('ULP_MANAGER','REVIEW_PERENCANAAN','REVIEW_KONSTRUKSI','ASMAN_PERENCANAAN','ASMAN_NIAGA','ASMAN_KONSTRUKSI','UP3_MANAGER'))");
        DB::statement("ALTER TABLE application_drawing_decisions ADD CONSTRAINT application_drawing_decisions_decision_check CHECK (decision IN ('APPROVED','REJECTED'))");
        DB::statement("ALTER TABLE application_drawing_decisions ADD CONSTRAINT application_drawing_decisions_notes_check CHECK (decision = 'APPROVED' OR length(btrim(coalesce(notes, ''))) > 0)");
        DB::statement("ALTER TABLE application_documents ADD CONSTRAINT application_documents_file_role_check CHECK (file_role IS NULL OR file_role IN ('MAIN','ATTACHMENT'))");
        DB::statement("CREATE UNIQUE INDEX application_drawing_versions_one_open ON application_drawing_versions (drawing_id) WHERE status IN ('DRAFT','SUBMITTED','UNDER_REVIEW')");
        DB::statement("CREATE UNIQUE INDEX application_drawing_versions_one_approved ON application_drawing_versions (drawing_id) WHERE status = 'APPROVED'");
        DB::statement("CREATE UNIQUE INDEX application_documents_one_main_per_drawing_version ON application_documents (drawing_version_id) WHERE file_role = 'MAIN' AND status = 'ACTIVE'");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_drawing_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Drawing versions cannot be deleted'; END IF;
                IF (NEW.drawing_id, NEW.version_number) IS DISTINCT FROM (OLD.drawing_id, OLD.version_number) THEN
                    RAISE EXCEPTION 'Drawing version identity is immutable';
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.author_id IS DISTINCT FROM OLD.author_id THEN
                    RAISE EXCEPTION 'The author of a submitted version cannot change';
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.title, NEW.description, NEW.notes) IS DISTINCT FROM (OLD.title, OLD.description, OLD.notes) THEN
                    RAISE EXCEPTION 'Drawing version content is frozen once submitted';
                END IF;
                IF OLD.extended_approval AND NOT NEW.extended_approval THEN
                    RAISE EXCEPTION 'The extended approval requirement can only be raised, never lowered';
                END IF;
                IF NEW.extended_approval AND NOT OLD.extended_approval AND NOT (OLD.status = 'SUBMITTED' OR (OLD.status = 'UNDER_REVIEW' AND OLD.stage = 'UP3_REVIEW')) THEN
                    RAISE EXCEPTION 'The extended approval can only be required while the version is SUBMITTED or in UP3 review';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
                    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNDER_REVIEW','RETURNED'))
                    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED','RETURNED'))
                    OR (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED')
                ) THEN
                    RAISE EXCEPTION 'Invalid drawing version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status = 'UNDER_REVIEW' AND NEW.status = 'UNDER_REVIEW' AND NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
                    (OLD.stage = 'UP3_REVIEW' AND NEW.stage = 'ASMAN') OR (OLD.stage = 'ASMAN' AND NEW.stage = 'UP3_MANAGER')
                ) THEN
                    RAISE EXCEPTION 'Invalid drawing stage transition % -> %', OLD.stage, NEW.stage;
                END IF;
                -- the chain ends only after the Asman stage (normal) or after the UP3 manager (extended); the UP3 manager stage exists only when extended
                IF OLD.status = 'UNDER_REVIEW' AND NEW.status = 'APPROVED' AND NOT (
                    (OLD.stage = 'ASMAN' AND NOT NEW.extended_approval) OR (OLD.stage = 'UP3_MANAGER' AND NEW.extended_approval)
                ) THEN
                    RAISE EXCEPTION 'The approval chain is not complete (stage %, extended %)', OLD.stage, NEW.extended_approval;
                END IF;
                IF NEW.stage = 'UP3_MANAGER' AND NOT NEW.extended_approval THEN
                    RAISE EXCEPTION 'The UP3 manager stage exists only when the extended approval is required';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_drawing_versions_guard BEFORE UPDATE OR DELETE ON application_drawing_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_drawing_version()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_drawing_decision()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_author uuid;
            BEGIN
                SELECT author_id INTO v_author FROM application_drawing_versions WHERE id = NEW.version_id;
                IF NEW.decided_by = v_author THEN RAISE EXCEPTION 'The author cannot decide on their own drawing version'; END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_drawing_decisions_sod BEFORE INSERT ON application_drawing_decisions FOR EACH ROW EXECUTE FUNCTION distriva_guard_drawing_decision()');
        DB::unprepared('CREATE TRIGGER trg_drawing_decisions_append_only BEFORE UPDATE OR DELETE ON application_drawing_decisions FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_drawing_decisions_no_truncate BEFORE TRUNCATE ON application_drawing_decisions FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_drawing_decisions_sod ON application_drawing_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_drawing_decisions_append_only ON application_drawing_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_drawing_decisions_no_truncate ON application_drawing_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_drawing_versions_guard ON application_drawing_versions');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_drawing_decision()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_drawing_version()');
            DB::statement('DROP INDEX IF EXISTS application_documents_one_main_per_drawing_version');
        }
        Schema::table('application_documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('drawing_version_id');
            $table->dropColumn('file_role');
        });
        foreach (['application_drawing_decisions', 'application_drawing_versions', 'application_drawings'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
