<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// T4.2.2 iteration 2C-2 (docs/60): BOM as a versioned graph of formulas, one BOM per construction GROUP.
// Deviation from docs/23 §2.7 (owner approved 2026-11-06): the workbook BOM is not "coefficient per construction":
// rows depend on several constructions, on other rows, and rounding (TRUNC) acts on the AGGREGATE quantity (K-3).
// A line's sequence is the workbook row number so own-sheet references (I11, I13:I18, B13) keep their meaning.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bom_headers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('group_code', 30);
            $table->unsignedInteger('version_number');
            $table->string('name', 150);
            $table->text('description')->nullable();
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->text('source_reference')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['group_code', 'version_number']);
            $table->index(['status', 'group_code']);
        });

        Schema::create('bom_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bom_header_id')->constrained('bom_headers')->restrictOnDelete();
            $table->unsignedInteger('sequence');                       // workbook row number
            $table->foreignUuid('khs_item_id')->nullable()->constrained('khs_items')->restrictOnDelete(); // null for helper/subtotal rows
            $table->text('description')->nullable();
            $table->jsonb('formulas');                                 // {"H":AST,"I":AST,"J":AST,"K":AST} (material, install, remove, return)
            $table->jsonb('source_formulas')->nullable();              // the workbook text, for review
            $table->text('source_reference')->nullable();
            $table->timestampsTz();
            $table->unique(['bom_header_id', 'sequence']);
            $table->index('khs_item_id');
        });

        Schema::create('bom_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bom_header_id')->constrained('bom_headers')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['bom_header_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement('ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_version_check CHECK (version_number > 0)');
        DB::statement("ALTER TABLE bom_events ADD CONSTRAINT bom_events_type_check CHECK (event_type IN ('CREATED','DRAFT_UPDATED','APPROVED','AUTO_CLOSED','RETIRED'))");
        DB::statement("ALTER TABLE bom_lines ADD CONSTRAINT bom_lines_formulas_check CHECK (jsonb_typeof(formulas) = 'object')");
        DB::statement("ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_no_overlap EXCLUDE USING gist (group_code WITH =, daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_bom_header()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved BOM versions cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.group_code, NEW.version_number, NEW.name, NEW.description, NEW.valid_from, NEW.source_reference, NEW.created_by
                ) IS DISTINCT FROM (
                    OLD.group_code, OLD.version_number, OLD.name, OLD.description, OLD.valid_from, OLD.source_reference, OLD.created_by
                ) THEN
                    RAISE EXCEPTION 'Approved BOM version content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid BOM version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
                    RAISE EXCEPTION 'Approval data is immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_bom_headers_guard BEFORE UPDATE OR DELETE ON bom_headers FOR EACH ROW EXECUTE FUNCTION distriva_guard_bom_header()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_bom_line()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_id uuid;
            BEGIN
                v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.bom_header_id ELSE NEW.bom_header_id END;
                SELECT status INTO v_status FROM bom_headers WHERE id = v_id;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN
                    RAISE EXCEPTION 'Lines of a non-draft BOM version are immutable';
                END IF;
                IF TG_OP = 'UPDATE' AND NEW.bom_header_id <> OLD.bom_header_id THEN
                    RAISE EXCEPTION 'A BOM line cannot move to another version';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_bom_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON bom_lines FOR EACH ROW EXECUTE FUNCTION distriva_guard_bom_line()');

        DB::unprepared('CREATE TRIGGER trg_bom_events_append_only BEFORE UPDATE OR DELETE ON bom_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_bom_events_no_truncate BEFORE TRUNCATE ON bom_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_bom_events_append_only ON bom_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_bom_events_no_truncate ON bom_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_bom_lines_guard ON bom_lines');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_bom_headers_guard ON bom_headers');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_bom_line()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_bom_header()');
        }
        foreach (['bom_events', 'bom_lines', 'bom_headers'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
