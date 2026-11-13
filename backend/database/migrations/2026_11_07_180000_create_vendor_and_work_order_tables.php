<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 7 (docs/62 §32, docs/40): simple vendor master (company + linked vendor accounts) and the work order (SPK/WO). One live WO version per application; a change or
// cancellation is a NEW version / a final status, never an edit. KONSTRUKSI_UP3 prepares (and selects the vendor), ASMAN_KONSTRUKSI approves = issues WO and vendor together,
// progress is cumulative percent per task (vendor or internal submits, KONSTRUKSI_UP3 verifies as a different user), ASMAN_KONSTRUKSI completes.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_companies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name', 200);
            $table->string('status', 10)->default('ACTIVE');             // ACTIVE | SUSPENDED
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });

        Schema::create('vendor_accounts', function (Blueprint $table) {  // one account belongs to one company
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained('users')->restrictOnDelete();
            $table->foreignUuid('vendor_company_id')->constrained('vendor_companies')->restrictOnDelete();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });

        Schema::create('work_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('wo_number', 120)->unique();
            $table->string('status', 12)->default('DRAFT');              // DRAFT | SUBMITTED | ISSUED | IN_PROGRESS | COMPLETED | CANCELLED | SUPERSEDED
            $table->foreignUuid('mto_package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->foreignUuid('rab_run_id')->constrained('rab_runs')->restrictOnDelete();
            $table->foreignUuid('vendor_company_id')->nullable()->constrained('vendor_companies')->restrictOnDelete();
            $table->text('vendor_note')->nullable();                      // why this vendor
            $table->uuid('amended_from_id')->nullable();                   // self reference, added after the table exists
            $table->text('amendment_reason')->nullable();
            $table->text('return_reason')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->foreignUuid('issued_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('issued_at')->nullable();
            $table->foreignUuid('completed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('completed_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['application_id', 'version_number']);
        });

        Schema::table('work_orders', function (Blueprint $table) {
            $table->foreign('amended_from_id')->references('id')->on('work_orders')->restrictOnDelete();
        });

        Schema::create('wo_tasks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('group_code', 30);
            $table->string('title', 255);
            $table->string('unit_text', 20)->nullable();
            $table->decimal('volume', 18, 3)->default(0);
            $table->decimal('amount', 24, 2)->default(0);                 // RAB group total
            $table->decimal('baseline_percent', 5, 2)->default(0);        // verified progress carried over from the previous WO version
            $table->unique(['work_order_id', 'group_code']);
        });

        Schema::create('wo_materials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->unique(['work_order_id', 'khs_item_id']);
        });

        Schema::create('wo_progress', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUuid('task_id')->constrained('wo_tasks')->restrictOnDelete();
            $table->string('submission_key', 80);                          // idempotency key chosen by the submitter
            $table->decimal('cumulative_percent', 5, 2);
            $table->text('notes')->nullable();
            $table->string('status', 10)->default('SUBMITTED');            // SUBMITTED | VERIFIED | RETURNED
            $table->foreignUuid('submitted_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->text('return_reason')->nullable();
            $table->unique(['work_order_id', 'submission_key']);
            $table->index(['task_id', 'status']);
        });

        Schema::create('wo_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->string('event_type', 24);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['work_order_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE vendor_companies ADD CONSTRAINT vendor_companies_status_check CHECK (status IN ('ACTIVE','SUSPENDED'))");
        DB::statement("ALTER TABLE work_orders ADD CONSTRAINT work_orders_status_check CHECK (status IN ('DRAFT','SUBMITTED','ISSUED','IN_PROGRESS','COMPLETED','CANCELLED','SUPERSEDED'))");
        DB::statement("ALTER TABLE work_orders ADD CONSTRAINT work_orders_issue_check CHECK (status IN ('DRAFT','SUBMITTED','CANCELLED') OR (vendor_company_id IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL))");
        DB::statement("CREATE UNIQUE INDEX work_orders_one_executing ON work_orders (application_id) WHERE status IN ('ISSUED','IN_PROGRESS')");
        DB::statement("CREATE UNIQUE INDEX work_orders_one_preparing ON work_orders (application_id) WHERE status IN ('DRAFT','SUBMITTED')");   // an amendment is prepared while the issued version runs
        DB::statement("CREATE UNIQUE INDEX work_orders_one_completed ON work_orders (application_id) WHERE status = 'COMPLETED'");
        DB::statement('ALTER TABLE wo_tasks ADD CONSTRAINT wo_tasks_check CHECK (volume >= 0 AND baseline_percent BETWEEN 0 AND 100)');
        DB::statement('ALTER TABLE wo_materials ADD CONSTRAINT wo_materials_check CHECK (quantity > 0)');
        DB::statement("ALTER TABLE wo_progress ADD CONSTRAINT wo_progress_check CHECK (cumulative_percent BETWEEN 0 AND 100 AND status IN ('SUBMITTED','VERIFIED','RETURNED'))");
        DB::statement('ALTER TABLE wo_progress ADD CONSTRAINT wo_progress_sod_check CHECK (decided_by IS NULL OR decided_by <> submitted_by)');     // submitter != verifier (D-AUTH-012), no exception
        DB::statement("CREATE UNIQUE INDEX wo_progress_one_pending ON wo_progress (task_id) WHERE status = 'SUBMITTED'");

        DB::unprepared('CREATE TRIGGER trg_wo_events_append_only BEFORE UPDATE OR DELETE ON wo_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_wo_events_no_truncate BEFORE TRUNCATE ON wo_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_work_order()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'A work order that left DRAFT cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status IN ('COMPLETED','CANCELLED','SUPERSEDED') THEN RAISE EXCEPTION 'A % work order is final', OLD.status; END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.application_id, NEW.mto_package_id, NEW.rab_run_id, NEW.version_number) IS DISTINCT FROM (OLD.application_id, OLD.mto_package_id, OLD.rab_run_id, OLD.version_number) THEN
                    RAISE EXCEPTION 'The sources of a submitted work order are immutable';
                END IF;
                IF OLD.status IN ('ISSUED','IN_PROGRESS') AND NEW.vendor_company_id IS DISTINCT FROM OLD.vendor_company_id THEN
                    RAISE EXCEPTION 'The vendor of an issued work order cannot change (amend it instead)';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_work_orders_guard BEFORE UPDATE OR DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION distriva_guard_work_order()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_wo_child()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text;
            BEGIN
                SELECT status INTO v_status FROM work_orders WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.work_order_id ELSE NEW.work_order_id END;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Tasks and materials of a non-draft work order are immutable'; END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        foreach (['wo_tasks', 'wo_materials'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_guard BEFORE INSERT OR UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_guard_wo_child()");
        }
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_wo_progress()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Progress submissions are history and cannot be deleted'; END IF;
                IF OLD.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'A decided progress submission is immutable'; END IF;
                IF (NEW.work_order_id, NEW.task_id, NEW.submission_key, NEW.cumulative_percent, NEW.submitted_by) IS DISTINCT FROM (OLD.work_order_id, OLD.task_id, OLD.submission_key, OLD.cumulative_percent, OLD.submitted_by) THEN
                    RAISE EXCEPTION 'The content of a progress submission cannot change (submit a new one)';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_wo_progress_guard BEFORE UPDATE OR DELETE ON wo_progress FOR EACH ROW EXECUTE FUNCTION distriva_guard_wo_progress()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_wo_progress_guard ON wo_progress');
            foreach (['wo_tasks', 'wo_materials'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_guard ON {$t}");
            }
            DB::unprepared('DROP TRIGGER IF EXISTS trg_work_orders_guard ON work_orders');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_wo_events_append_only ON wo_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_wo_events_no_truncate ON wo_events');
            foreach (['distriva_guard_wo_progress', 'distriva_guard_wo_child', 'distriva_guard_work_order'] as $f) {
                DB::unprepared("DROP FUNCTION IF EXISTS {$f}()");
            }
        }
        foreach (['wo_events', 'wo_progress', 'wo_materials', 'wo_tasks', 'work_orders', 'vendor_accounts', 'vendor_companies'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
