<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 2 — Survey (docs/24 §7, docs/62 §8; owner decisions 2026-11-06). One application can have several surveys one after another
// (one ACTIVE at a time). A survey is worked in VERSIONS: when any approver rejects, the version is RETURNED and a new DRAFT version
// starts again at the surveyor ("proses kembali ke awal"). Approval chain per version:
// Status cycle (owner): DRAFT -> SUBMITTED -> UNDER_REVIEW -> ACCEPTED (RETURNED on any rejection). `stage` tells where the approval is:
//   SUBMITTED/ULP_MANAGER (MANAGER_ULP) -> UNDER_REVIEW/UP3_REVIEW (PERENCANAAN + KONSTRUKSI_UP3) -> UNDER_REVIEW/ASMAN (ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI) -> UNDER_REVIEW/UP3_MANAGER -> ACCEPTED.
// Surveyor and every decider are different users; one user decides at most once per version (also enforced by the database).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('application_surveys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->unsignedInteger('sequence_number');
            $table->string('survey_number', 80)->unique();
            $table->string('status', 20)->default('ACTIVE');                 // ACTIVE | ACCEPTED | CANCELLED
            $table->foreignUuid('assigned_to')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('assigned_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('scheduled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->unique(['application_id', 'sequence_number']);
        });

        Schema::create('application_survey_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('survey_id')->constrained('application_surveys')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('status', 20)->default('DRAFT');                 // DRAFT -> SUBMITTED -> UNDER_REVIEW -> ACCEPTED (or RETURNED)
            $table->string('stage', 20)->nullable();                        // pending approval stage: ULP_MANAGER | UP3_REVIEW | ASMAN | UP3_MANAGER
            $table->foreignUuid('surveyor_id')->constrained('users')->restrictOnDelete();
            $table->date('survey_date')->nullable();
            $table->text('findings')->nullable();
            $table->text('technical_recommendation')->nullable();
            $table->boolean('requires_drawing')->nullable();
            $table->boolean('requires_network_extension')->nullable();
            $table->boolean('requires_feasibility_study')->nullable();
            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();
            $table->decimal('network_distance_m', 12, 2)->nullable();
            $table->string('network_type', 100)->nullable();
            $table->decimal('transformer_capacity_kva', 12, 3)->nullable();
            $table->text('network_condition')->nullable();
            $table->text('notes')->nullable();
            $table->jsonb('measurements')->default('[]');                  // [{name,value,unit}] — fields of the official form, until it is supplied
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('returned_at')->nullable();
            $table->string('returned_at_step', 40)->nullable();
            $table->foreignUuid('returned_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('return_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['survey_id', 'version_number']);
        });

        Schema::create('application_survey_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('version_id')->constrained('application_survey_versions')->restrictOnDelete();
            $table->string('step', 40);
            $table->string('decision', 10);
            $table->foreignUuid('decided_by')->constrained('users')->restrictOnDelete();
            $table->string('decided_role', 50);                             // role that authorised the decision (snapshot)
            $table->text('notes')->nullable();
            $table->timestampTz('decided_at');
            $table->unique(['version_id', 'step']);
            $table->unique(['version_id', 'decided_by']);
        });

        Schema::table('application_documents', function (Blueprint $table) {
            $table->foreignUuid('survey_version_id')->nullable()->constrained('application_survey_versions')->restrictOnDelete();
            $table->index('survey_version_id');
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE application_survey_decisions ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');   // decisions are listed in the order they were made
        DB::statement("ALTER TABLE application_surveys ADD CONSTRAINT application_surveys_status_check CHECK (status IN ('ACTIVE','ACCEPTED','CANCELLED'))");
        DB::statement("ALTER TABLE application_survey_versions ADD CONSTRAINT application_survey_versions_status_check CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED','RETURNED'))");
        DB::statement("ALTER TABLE application_survey_versions ADD CONSTRAINT application_survey_versions_stage_check CHECK ((status = 'SUBMITTED' AND stage IS NOT DISTINCT FROM 'ULP_MANAGER') OR (status = 'UNDER_REVIEW' AND COALESCE(stage IN ('UP3_REVIEW','ASMAN','UP3_MANAGER'), false)) OR (status IN ('DRAFT','ACCEPTED','RETURNED') AND stage IS NULL))");
        DB::statement("ALTER TABLE application_survey_decisions ADD CONSTRAINT application_survey_decisions_step_check CHECK (step IN ('ULP_MANAGER','REVIEW_PERENCANAAN','REVIEW_KONSTRUKSI','ASMAN_PERENCANAAN','ASMAN_KONSTRUKSI','UP3_MANAGER'))");
        DB::statement("ALTER TABLE application_survey_decisions ADD CONSTRAINT application_survey_decisions_decision_check CHECK (decision IN ('APPROVED','REJECTED'))");
        DB::statement("ALTER TABLE application_survey_decisions ADD CONSTRAINT application_survey_decisions_notes_check CHECK (decision = 'APPROVED' OR length(btrim(coalesce(notes, ''))) > 0)");
        DB::statement('ALTER TABLE application_survey_versions ADD CONSTRAINT application_survey_versions_coordinates_check CHECK ((latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180) AND (network_distance_m IS NULL OR network_distance_m >= 0) AND (transformer_capacity_kva IS NULL OR transformer_capacity_kva >= 0))');
        DB::statement("ALTER TABLE application_survey_versions ADD CONSTRAINT application_survey_versions_measurements_check CHECK (jsonb_typeof(measurements) = 'array')");
        DB::statement("CREATE UNIQUE INDEX application_surveys_one_active ON application_surveys (application_id) WHERE status = 'ACTIVE'");
        DB::statement("CREATE UNIQUE INDEX application_survey_versions_one_open ON application_survey_versions (survey_id) WHERE status NOT IN ('RETURNED','ACCEPTED')");

        // content freezes when the version leaves DRAFT; only the workflow columns may move afterwards; versions are never deleted
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_survey_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Survey versions cannot be deleted'; END IF;
                IF (NEW.survey_id, NEW.version_number) IS DISTINCT FROM (OLD.survey_id, OLD.version_number) THEN
                    RAISE EXCEPTION 'Survey version identity is immutable';
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.surveyor_id IS DISTINCT FROM OLD.surveyor_id THEN
                    RAISE EXCEPTION 'The surveyor of a submitted version cannot change';
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.survey_date, NEW.findings, NEW.technical_recommendation, NEW.requires_drawing, NEW.requires_network_extension, NEW.requires_feasibility_study,
                    NEW.latitude, NEW.longitude, NEW.network_distance_m, NEW.network_type, NEW.transformer_capacity_kva, NEW.network_condition, NEW.notes, NEW.measurements
                ) IS DISTINCT FROM (
                    OLD.survey_date, OLD.findings, OLD.technical_recommendation, OLD.requires_drawing, OLD.requires_network_extension, OLD.requires_feasibility_study,
                    OLD.latitude, OLD.longitude, OLD.network_distance_m, OLD.network_type, OLD.transformer_capacity_kva, OLD.network_condition, OLD.notes, OLD.measurements
                ) THEN
                    RAISE EXCEPTION 'Survey version content is frozen once submitted';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
                    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNDER_REVIEW','RETURNED'))
                    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('ACCEPTED','RETURNED'))
                ) THEN
                    RAISE EXCEPTION 'Invalid survey version status transition % -> %', OLD.status, NEW.status;
                END IF;
                -- inside UNDER_REVIEW the stage only moves forward: UP3_REVIEW -> ASMAN -> UP3_MANAGER
                IF OLD.status = 'UNDER_REVIEW' AND NEW.status = 'UNDER_REVIEW' AND NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
                    (OLD.stage = 'UP3_REVIEW' AND NEW.stage = 'ASMAN') OR (OLD.stage = 'ASMAN' AND NEW.stage = 'UP3_MANAGER')
                ) THEN
                    RAISE EXCEPTION 'Invalid survey stage transition % -> %', OLD.stage, NEW.stage;
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_survey_versions_guard BEFORE UPDATE OR DELETE ON application_survey_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_survey_version()');

        // a decision is append-only and the surveyor may never decide on their own version
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_survey_decision()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_surveyor uuid;
            BEGIN
                SELECT surveyor_id INTO v_surveyor FROM application_survey_versions WHERE id = NEW.version_id;
                IF NEW.decided_by = v_surveyor THEN RAISE EXCEPTION 'The surveyor cannot decide on their own survey version'; END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_survey_decisions_sod BEFORE INSERT ON application_survey_decisions FOR EACH ROW EXECUTE FUNCTION distriva_guard_survey_decision()');
        DB::unprepared('CREATE TRIGGER trg_survey_decisions_append_only BEFORE UPDATE OR DELETE ON application_survey_decisions FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_survey_decisions_no_truncate BEFORE TRUNCATE ON application_survey_decisions FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_survey_decisions_sod ON application_survey_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_survey_decisions_append_only ON application_survey_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_survey_decisions_no_truncate ON application_survey_decisions');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_survey_versions_guard ON application_survey_versions');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_survey_decision()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_survey_version()');
        }
        Schema::table('application_documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('survey_version_id');
        });
        foreach (['application_survey_decisions', 'application_survey_versions', 'application_surveys'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
