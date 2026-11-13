<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5C (docs/62 §26): tariff books (average sale price Rp/kWh, jam nyala kWh/kVA/month and UJL Rp/VA per tariff x power, optionally per ULP)
// and KKF runs (immutable calculation records with input snapshot + hash). Tariff books: DRAFT -> APPROVED (different user) -> INACTIVE, like the price books.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tariff_books', function (Blueprint $table) {
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

        Schema::create('tariff_book_rows', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tariff_book_id')->constrained('tariff_books')->restrictOnDelete();
            $table->foreignUuid('ulp_unit_id')->nullable()->constrained('organizational_units')->restrictOnDelete();   // null = default for every ULP
            $table->string('tariff_code', 20);                          // normalized: upper case, no spaces/hyphens (R1, R1M, S2, I3, B2 ...)
            $table->unsignedBigInteger('power_va')->nullable();         // null = the tariff has no power steps (C, P3)
            $table->decimal('avg_price', 18, 4);                        // Rp/kWh
            $table->decimal('jam_nyala', 12, 3);                        // kWh per kVA per month
            $table->decimal('ujl', 18, 2)->nullable();                  // Rp/VA (street-lighting levy)
            $table->timestampsTz();
        });

        Schema::create('tariff_book_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tariff_book_id')->constrained('tariff_books')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['tariff_book_id', 'occurred_at']);
        });

        Schema::create('kkf_number_sequences', function (Blueprint $table) {
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_number')->default(0);
            $table->primary(['organizational_unit_id', 'year']);
        });

        Schema::create('kkf_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('rab_run_id')->constrained('rab_runs')->restrictOnDelete();
            $table->foreignUuid('parameter_set_id')->constrained('kkf_parameter_sets')->restrictOnDelete();
            $table->foreignUuid('tariff_book_id')->constrained('tariff_books')->restrictOnDelete();
            $table->foreignUuid('tariff_row_id')->constrained('tariff_book_rows')->restrictOnDelete();
            $table->unsignedInteger('run_number');                      // per application
            $table->string('document_number', 60)->unique();            // owner 7 Nov 2026: sequence/yyyymm/unit code, sequence per ULP per year
            $table->date('valid_on');
            $table->jsonb('inputs');                                    // everything the calculator received (the snapshot)
            $table->jsonb('result');                                    // calculator output
            $table->boolean('feasible');
            $table->boolean('extended_required');                       // not feasible (incl. payback over the limit) -> the drawing approval needs the extended chain
            $table->decimal('npv', 24, 2);
            $table->decimal('irr_percent', 18, 6)->nullable();
            $table->unsignedInteger('payback_months')->nullable();
            $table->string('snapshot_hash', 64);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['application_id', 'run_number']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE tariff_books ADD CONSTRAINT tariff_books_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE tariff_books ADD CONSTRAINT tariff_books_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE tariff_books ADD CONSTRAINT tariff_books_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE tariff_books ADD CONSTRAINT tariff_books_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement("ALTER TABLE tariff_books ADD CONSTRAINT tariff_books_no_overlap EXCLUDE USING gist (daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");
        DB::statement('ALTER TABLE tariff_book_rows ADD CONSTRAINT tariff_book_rows_check CHECK (avg_price > 0 AND jam_nyala > 0 AND (power_va IS NULL OR power_va > 0) AND (ujl IS NULL OR ujl >= 0))');
        DB::statement("CREATE UNIQUE INDEX tariff_book_rows_key ON tariff_book_rows (tariff_book_id, tariff_code, COALESCE(power_va, 0), COALESCE(ulp_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))");
        DB::statement("ALTER TABLE tariff_book_events ADD CONSTRAINT tariff_book_events_type_check CHECK (event_type IN ('CREATED','APPROVED','AUTO_CLOSED','RETIRED'))");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_tariff_book()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved tariff books cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.name, NEW.valid_from, NEW.source_reference, NEW.created_by) IS DISTINCT FROM (OLD.name, OLD.valid_from, OLD.source_reference, OLD.created_by) THEN
                    RAISE EXCEPTION 'Approved tariff book content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')) THEN
                    RAISE EXCEPTION 'Invalid tariff book status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.valid_until IS DISTINCT FROM OLD.valid_until AND OLD.valid_until IS NOT NULL THEN
                    RAISE EXCEPTION 'valid_until of a closed tariff book cannot change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_tariff_books_guard BEFORE UPDATE OR DELETE ON tariff_books FOR EACH ROW EXECUTE FUNCTION distriva_guard_tariff_book()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_tariff_book_rows()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text;
            BEGIN
                SELECT status INTO v_status FROM tariff_books WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tariff_book_id ELSE NEW.tariff_book_id END;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Rows of a non-draft tariff book are immutable'; END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_tariff_book_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON tariff_book_rows FOR EACH ROW EXECUTE FUNCTION distriva_guard_tariff_book_rows()');
        DB::unprepared('CREATE TRIGGER trg_tariff_book_events_append_only BEFORE UPDATE OR DELETE ON tariff_book_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_tariff_book_events_no_truncate BEFORE TRUNCATE ON tariff_book_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_kkf_runs_immutable BEFORE UPDATE OR DELETE ON kkf_runs FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_kkf_runs_no_truncate BEFORE TRUNCATE ON kkf_runs FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_kkf_runs_immutable ON kkf_runs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_kkf_runs_no_truncate ON kkf_runs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_tariff_book_events_append_only ON tariff_book_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_tariff_book_events_no_truncate ON tariff_book_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_tariff_book_rows_guard ON tariff_book_rows');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_tariff_books_guard ON tariff_books');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_tariff_book_rows()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_tariff_book()');
        }
        Schema::dropIfExists('kkf_runs');
        Schema::dropIfExists('kkf_number_sequences');
        Schema::dropIfExists('tariff_book_events');
        Schema::dropIfExists('tariff_book_rows');
        Schema::dropIfExists('tariff_books');
    }
};
