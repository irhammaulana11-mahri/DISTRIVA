<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5C (docs/62 §24-25): KKF parameter sets. Versioned like the price books: DRAFT -> APPROVED (different user) -> INACTIVE; approved values are immutable;
// a new approved set closes the previous one. Rates are stored as fractions (0.0778 = 7.78 %). Owner 2026-11-07: discount rate 7.78 %, BPP 552 Rp/kWh, both editable via the front end.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kkf_parameter_sets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 150);
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->decimal('discount_rate', 9, 6);
            $table->decimal('bpp', 18, 2);                         // Rp/kWh
            $table->decimal('om_rate', 9, 6);
            $table->decimal('load_factor', 9, 6);
            $table->decimal('roe', 9, 6);
            $table->decimal('interest_rate', 9, 6);
            $table->decimal('tax_rate', 9, 6);
            $table->unsignedSmallInteger('horizon_years');
            $table->unsignedSmallInteger('payback_limit_months');
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->index('status');
        });

        Schema::create('kkf_parameter_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('parameter_set_id')->constrained('kkf_parameter_sets')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['parameter_set_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement('ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_values_check CHECK (discount_rate > 0 AND discount_rate < 1 AND bpp > 0 AND om_rate >= 0 AND om_rate < 1 AND load_factor > 0 AND load_factor <= 1 AND roe >= 0 AND roe < 1 AND interest_rate >= 0 AND interest_rate < 1 AND tax_rate >= 0 AND tax_rate < 1 AND horizon_years BETWEEN 1 AND 50 AND payback_limit_months BETWEEN 1 AND 600)');
        DB::statement("ALTER TABLE kkf_parameter_sets ADD CONSTRAINT kkf_parameter_sets_no_overlap EXCLUDE USING gist (daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");
        DB::statement("ALTER TABLE kkf_parameter_events ADD CONSTRAINT kkf_parameter_events_type_check CHECK (event_type IN ('CREATED','DRAFT_UPDATED','APPROVED','AUTO_CLOSED','RETIRED'))");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_kkf_parameter_set()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved KKF parameter sets cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.name, NEW.valid_from, NEW.discount_rate, NEW.bpp, NEW.om_rate, NEW.load_factor, NEW.roe, NEW.interest_rate, NEW.tax_rate, NEW.horizon_years, NEW.payback_limit_months, NEW.created_by)
                    IS DISTINCT FROM (OLD.name, OLD.valid_from, OLD.discount_rate, OLD.bpp, OLD.om_rate, OLD.load_factor, OLD.roe, OLD.interest_rate, OLD.tax_rate, OLD.horizon_years, OLD.payback_limit_months, OLD.created_by) THEN
                    RAISE EXCEPTION 'Approved KKF parameter values are immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid KKF parameter set status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.valid_until IS DISTINCT FROM OLD.valid_until AND OLD.valid_until IS NOT NULL THEN
                    RAISE EXCEPTION 'valid_until of a closed KKF parameter set cannot change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_kkf_parameter_sets_guard BEFORE UPDATE OR DELETE ON kkf_parameter_sets FOR EACH ROW EXECUTE FUNCTION distriva_guard_kkf_parameter_set()');
        DB::unprepared('CREATE TRIGGER trg_kkf_parameter_events_append_only BEFORE UPDATE OR DELETE ON kkf_parameter_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_kkf_parameter_events_no_truncate BEFORE TRUNCATE ON kkf_parameter_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_kkf_parameter_events_append_only ON kkf_parameter_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_kkf_parameter_events_no_truncate ON kkf_parameter_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_kkf_parameter_sets_guard ON kkf_parameter_sets');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_kkf_parameter_set()');
        }
        Schema::dropIfExists('kkf_parameter_events');
        Schema::dropIfExists('kkf_parameter_sets');
    }
};
