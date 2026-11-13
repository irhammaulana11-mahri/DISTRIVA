<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 6B (docs/62 §31, docs/12): RKM = one plan per UP3 per period, versioned. Each ULP prepares a proposal (TEKNIK) and submits it (MANAGER_ULP); PERENCANAAN starts the
// validation; PERENCANAAN and KONSTRUKSI_UP3 validate the SAME version as different users; UP3_MANAGER decides. A return reopens the proposals (new round); an amendment is a new version.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rkm_plans', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('up3_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('period_type', 10);                           // MONTH | QUARTER | SEMESTER | YEAR
            $table->date('period_start');
            $table->date('period_end');
            $table->string('plan_number', 100)->unique();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->unique(['up3_unit_id', 'period_type', 'period_start']);
        });

        Schema::create('rkm_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('plan_id')->constrained('rkm_plans')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('status', 12)->default('COLLECTING');         // COLLECTING | VALIDATING | APPROVED | REJECTED | SUPERSEDED
            $table->unsignedInteger('round')->default(1);                 // +1 for every return to the ULPs
            $table->text('amendment_reason')->nullable();
            $table->jsonb('snapshot')->nullable();                        // requirements + stock position at approval
            $table->string('snapshot_hash', 64)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('validation_started_at')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['plan_id', 'version_number']);
        });

        Schema::create('rkm_proposals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('version_id')->constrained('rkm_versions')->restrictOnDelete();
            $table->foreignUuid('ulp_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('status', 10)->default('DRAFT');               // DRAFT | SUBMITTED
            $table->foreignUuid('prepared_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->text('return_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['version_id', 'ulp_unit_id']);
        });

        Schema::create('rkm_proposal_packages', function (Blueprint $table) {   // approved MTO packages that make up the "work" demand of a proposal
            $table->uuid('id')->primary();
            $table->foreignUuid('proposal_id')->constrained('rkm_proposals')->restrictOnDelete();
            $table->foreignUuid('mto_package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->unique(['proposal_id', 'mto_package_id']);
        });

        Schema::create('rkm_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('proposal_id')->constrained('rkm_proposals')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('qty_work', 18, 3)->default(0);               // from the linked approved MTO packages
            $table->decimal('qty_pipeline', 18, 3)->default(0);
            $table->decimal('qty_forecast', 18, 3)->default(0);
            $table->decimal('qty_validated', 18, 3)->nullable();           // planner's adjustment of the ULP's total (with a reason in rkm_adjustments)
            $table->string('note', 255)->nullable();
            $table->unique(['proposal_id', 'khs_item_id']);
        });

        Schema::create('rkm_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('version_id')->constrained('rkm_versions')->restrictOnDelete();
            $table->foreignUuid('proposal_id')->constrained('rkm_proposals')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('before_qty', 18, 3);
            $table->decimal('after_qty', 18, 3);
            $table->text('reason');
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->timestampTz('occurred_at');
        });

        Schema::create('rkm_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('version_id')->constrained('rkm_versions')->restrictOnDelete();
            $table->unsignedInteger('round');
            $table->string('step', 24);                                   // VALIDATE_PERENCANAAN | VALIDATE_KONSTRUKSI | APPROVE_UP3_MANAGER
            $table->string('decision', 10);                               // APPROVED | RETURNED | REJECTED
            $table->foreignUuid('decided_by')->constrained('users')->restrictOnDelete();
            $table->string('decided_role', 50);
            $table->text('notes')->nullable();
            $table->timestampTz('decided_at');
            $table->unique(['version_id', 'round', 'step']);
            $table->unique(['version_id', 'round', 'decided_by']);        // one decision per user per round
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE rkm_plans ADD CONSTRAINT rkm_plans_type_check CHECK (period_type IN ('MONTH','QUARTER','SEMESTER','YEAR') AND period_end >= period_start)");
        DB::statement("ALTER TABLE rkm_versions ADD CONSTRAINT rkm_versions_status_check CHECK (status IN ('COLLECTING','VALIDATING','APPROVED','REJECTED','SUPERSEDED'))");
        DB::statement("ALTER TABLE rkm_proposals ADD CONSTRAINT rkm_proposals_status_check CHECK (status IN ('DRAFT','SUBMITTED'))");
        DB::statement('ALTER TABLE rkm_lines ADD CONSTRAINT rkm_lines_check CHECK (qty_work >= 0 AND qty_pipeline >= 0 AND qty_forecast >= 0 AND (qty_validated IS NULL OR qty_validated >= 0))');
        DB::statement("ALTER TABLE rkm_decisions ADD CONSTRAINT rkm_decisions_check CHECK (step IN ('VALIDATE_PERENCANAAN','VALIDATE_KONSTRUKSI','APPROVE_UP3_MANAGER') AND decision IN ('APPROVED','RETURNED','REJECTED'))");
        // One approved/active version per plan at a time; a new approval supersedes the previous one in the service.
        DB::statement("CREATE UNIQUE INDEX rkm_versions_one_approved ON rkm_versions (plan_id) WHERE status = 'APPROVED'");
        DB::statement("CREATE UNIQUE INDEX rkm_versions_one_open ON rkm_versions (plan_id) WHERE status IN ('COLLECTING','VALIDATING')");
        // An MTO package belongs to one live RKM proposal at a time.
        foreach (['rkm_adjustments', 'rkm_decisions'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_immutable BEFORE UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
            DB::unprepared("CREATE TRIGGER trg_{$t}_no_truncate BEFORE TRUNCATE ON {$t} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
        }
        // An APPROVED / SUPERSEDED / REJECTED version is frozen except SUPERSEDED marking and nothing else.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_rkm_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'RKM versions cannot be deleted'; END IF;
                IF OLD.status = 'REJECTED' OR OLD.status = 'SUPERSEDED' THEN RAISE EXCEPTION 'A % RKM version is final', OLD.status; END IF;
                IF OLD.status = 'APPROVED' AND NEW.status <> 'SUPERSEDED' THEN RAISE EXCEPTION 'An approved RKM version can only be superseded'; END IF;
                IF OLD.status = 'APPROVED' AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash) THEN RAISE EXCEPTION 'The approval snapshot is immutable'; END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_rkm_versions_guard BEFORE UPDATE OR DELETE ON rkm_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_rkm_version()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_rkm_versions_guard ON rkm_versions');
            foreach (['rkm_adjustments', 'rkm_decisions'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_immutable ON {$t}");
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_no_truncate ON {$t}");
            }
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_rkm_version()');
        }
        foreach (['rkm_decisions', 'rkm_adjustments', 'rkm_lines', 'rkm_proposal_packages', 'rkm_proposals', 'rkm_versions', 'rkm_plans'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
