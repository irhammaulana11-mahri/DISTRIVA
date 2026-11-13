<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5B-2 (docs/62 §23): SR-APP 1 fasa (450-5500 / 7700 VA) is priced from its own contract schedule (workbook sheet "SR 1 PHASE (2022)"):
// per activity (G11..G20) a list of items = coefficient x activity volume x price, a service price, insured items (3/1000) and supporting material.
// The schedule is versioned data (DRAFT -> APPROVED by another user -> INACTIVE), because the workbook sheet changes with each contract.
// Also: RAB run lines may now come from this schedule (no KHS item), so khs_item_id/khs_code become nullable and a description is stored.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sr1_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 150);
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->text('source_reference')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->index('status');
        });

        Schema::create('sr1_schedule_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr1_schedule_id')->constrained('sr1_schedules')->restrictOnDelete();
            $table->unsignedInteger('sequence');                          // workbook row
            $table->unsignedSmallInteger('activity_no')->nullable();      // 1..10 = G11..G20; null for lines on the all-activities total
            $table->string('kind', 10);                                   // ITEM | SERVICE | INSURED | SUPPORT
            $table->string('basis', 10);                                  // ACTIVITY (volume of activity_no) | TOTAL (sum of G11:G16)
            $table->string('description', 255);
            $table->string('unit', 30)->nullable();
            $table->decimal('coefficient', 18, 6);
            $table->decimal('material_price', 18, 2)->nullable();
            $table->decimal('service_price', 18, 2)->nullable();
            $table->unique(['sr1_schedule_id', 'sequence']);
        });

        Schema::create('sr1_schedule_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr1_schedule_id')->constrained('sr1_schedules')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['sr1_schedule_id', 'occurred_at']);
        });

        Schema::table('rab_run_lines', function (Blueprint $table) {
            $table->uuid('khs_item_id')->nullable()->change();
            $table->string('khs_code', 50)->nullable()->change();
            $table->string('description', 255)->nullable();
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE sr1_schedules ADD CONSTRAINT sr1_schedules_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE sr1_schedules ADD CONSTRAINT sr1_schedules_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE sr1_schedules ADD CONSTRAINT sr1_schedules_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE sr1_schedules ADD CONSTRAINT sr1_schedules_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement("ALTER TABLE sr1_schedules ADD CONSTRAINT sr1_schedules_no_overlap EXCLUDE USING gist (daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");
        DB::statement("ALTER TABLE sr1_schedule_lines ADD CONSTRAINT sr1_schedule_lines_check CHECK (kind IN ('ITEM','SERVICE','INSURED','SUPPORT') AND basis IN ('ACTIVITY','TOTAL') AND coefficient >= 0
            AND (basis = 'TOTAL' OR activity_no BETWEEN 1 AND 10) AND (material_price IS NULL OR material_price >= 0) AND (service_price IS NULL OR service_price >= 0)
            AND ((kind = 'SERVICE' AND service_price IS NOT NULL) OR (kind <> 'SERVICE' AND material_price IS NOT NULL)))");
        DB::statement("ALTER TABLE sr1_schedule_events ADD CONSTRAINT sr1_schedule_events_type_check CHECK (event_type IN ('CREATED','APPROVED','AUTO_CLOSED','RETIRED'))");
        DB::statement('ALTER TABLE rab_run_lines DROP CONSTRAINT rab_run_lines_category_check');
        DB::statement("ALTER TABLE rab_run_lines ADD CONSTRAINT rab_run_lines_category_check CHECK (category IN ('ITEM','COMMISSIONING','K3L','INSURANCE','SR1_ITEM','SR1_SERVICE','SR1_INSURED','SR1_SUPPORT'))");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_sr1_schedule()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved SR1 schedules cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.name, NEW.valid_from, NEW.source_reference, NEW.created_by) IS DISTINCT FROM (OLD.name, OLD.valid_from, OLD.source_reference, OLD.created_by) THEN
                    RAISE EXCEPTION 'Approved SR1 schedule content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid SR1 schedule status transition % -> %', OLD.status, NEW.status;
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_sr1_schedules_guard BEFORE UPDATE OR DELETE ON sr1_schedules FOR EACH ROW EXECUTE FUNCTION distriva_guard_sr1_schedule()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_sr1_line()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text;
            BEGIN
                SELECT status INTO v_status FROM sr1_schedules WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.sr1_schedule_id ELSE NEW.sr1_schedule_id END;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Lines of a non-draft SR1 schedule are immutable'; END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_sr1_schedule_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sr1_schedule_lines FOR EACH ROW EXECUTE FUNCTION distriva_guard_sr1_line()');
        DB::unprepared('CREATE TRIGGER trg_sr1_events_append_only BEFORE UPDATE OR DELETE ON sr1_schedule_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_sr1_events_no_truncate BEFORE TRUNCATE ON sr1_schedule_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_sr1_events_append_only ON sr1_schedule_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_sr1_events_no_truncate ON sr1_schedule_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_sr1_schedule_lines_guard ON sr1_schedule_lines');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_sr1_schedules_guard ON sr1_schedules');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_sr1_line()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_sr1_schedule()');
            DB::statement('ALTER TABLE rab_run_lines DROP CONSTRAINT IF EXISTS rab_run_lines_category_check');
            DB::statement("ALTER TABLE rab_run_lines ADD CONSTRAINT rab_run_lines_category_check CHECK (category IN ('ITEM','COMMISSIONING','K3L','INSURANCE'))");
        }
        Schema::table('rab_run_lines', function (Blueprint $table) {
            $table->dropColumn('description');
        });
        Schema::dropIfExists('sr1_schedule_events');
        Schema::dropIfExists('sr1_schedule_lines');
        Schema::dropIfExists('sr1_schedules');
    }
};
