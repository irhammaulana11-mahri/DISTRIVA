<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 4A — MTO (material take-off) per drawing version (docs/26 §3.4 trimmed; docs/62 §12; owner decisions 2026-11-06).
// The ULP technical officer (TEKNIK, author of the drawing version) enters the quantity of every construction (Psg/Bkr); the material need is computed
// by the BOM engine from the APPROVED BOM of each construction group; the officer VERIFIES (a frozen snapshot with a hash) and MANAGER_ULP APPROVES
// (verifier != approver). A rejection reopens the package (history kept in mto_events). Extraction candidates (detected_*) belong to stage 4B/4C.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mto_packages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('drawing_version_id')->unique()->constrained('application_drawing_versions')->restrictOnDelete();
            $table->string('package_number', 100)->unique();
            $table->string('status', 20)->default('DRAFT');                 // DRAFT -> VERIFIED -> APPROVED ; a rejection reopens to DRAFT
            $table->date('valid_on')->nullable();                           // the business date used to pick the BOM / KHS / construction versions (set at verification)
            $table->jsonb('params')->default('{}');                         // BOM parameters, e.g. {"COMMISSIONING:SUTM": 0}
            $table->string('snapshot_hash', 64)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('verified_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
        });

        Schema::create('mto_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->foreignUuid('construction_type_id')->constrained('construction_types')->restrictOnDelete();
            $table->string('group_code', 30);
            $table->string('construction_code', 50);                         // snapshot of the code and label at entry
            $table->string('construction_label', 150);
            $table->decimal('psg', 14, 3)->default(0);                        // pasang
            $table->decimal('bkr', 14, 3)->default(0);                        // bongkar
            $table->decimal('detected_psg', 14, 3)->nullable();              // reserved for extraction candidates (4B/4C)
            $table->decimal('detected_bkr', 14, 3)->nullable();
            $table->string('source', 20)->default('MANUAL');
            $table->string('note', 300)->nullable();
            $table->timestampsTz();
            $table->unique(['package_id', 'construction_type_id']);
        });

        Schema::create('mto_lines', function (Blueprint $table) {           // the verified material need (snapshot)
            $table->uuid('id')->primary();
            $table->foreignUuid('package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->string('group_code', 30);
            $table->foreignUuid('bom_header_id')->constrained('bom_headers')->restrictOnDelete();
            $table->unsignedInteger('sequence');                              // workbook row of the BOM line
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('khs_code', 50);
            $table->string('khs_name', 255)->nullable();
            $table->string('unit_text', 30)->nullable();
            $table->decimal('material', 18, 6)->default(0);
            $table->decimal('install', 18, 6)->default(0);
            $table->decimal('remove', 18, 6)->default(0);
            $table->decimal('return', 18, 6)->default(0);
            $table->unique(['package_id', 'group_code', 'sequence']);
            $table->index(['package_id', 'khs_code']);
        });

        Schema::create('mto_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['package_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE mto_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
        DB::statement("ALTER TABLE mto_packages ADD CONSTRAINT mto_packages_status_check CHECK (status IN ('DRAFT','VERIFIED','APPROVED'))");
        DB::statement("ALTER TABLE mto_packages ADD CONSTRAINT mto_packages_flow_check CHECK ((status = 'DRAFT' AND approved_by IS NULL) OR (status IN ('VERIFIED','APPROVED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND snapshot_hash IS NOT NULL AND valid_on IS NOT NULL) )");
        DB::statement("ALTER TABLE mto_packages ADD CONSTRAINT mto_packages_approved_check CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE mto_packages ADD CONSTRAINT mto_packages_sod_check CHECK ((approved_by IS NULL OR (approved_by <> verified_by AND approved_by <> created_by)))');
        DB::statement("ALTER TABLE mto_packages ADD CONSTRAINT mto_packages_params_check CHECK (jsonb_typeof(params) = 'object')");
        DB::statement('ALTER TABLE mto_items ADD CONSTRAINT mto_items_quantity_check CHECK (psg >= 0 AND bkr >= 0 AND (detected_psg IS NULL OR detected_psg >= 0) AND (detected_bkr IS NULL OR detected_bkr >= 0))');
        DB::statement("ALTER TABLE mto_items ADD CONSTRAINT mto_items_source_check CHECK (source IN ('MANUAL','EXTRACTED'))");
        DB::statement("ALTER TABLE mto_events ADD CONSTRAINT mto_events_type_check CHECK (event_type IN ('CREATED','ITEMS_CHANGED','VERIFIED','APPROVED','REJECTED'))");

        // Items and lines can only change while the package is a DRAFT; the package keeps its identity; verification/approval data never rewritten.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_mto_child()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_id uuid;
            BEGIN
                v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.package_id ELSE NEW.package_id END;
                SELECT status INTO v_status FROM mto_packages WHERE id = v_id;
                IF v_status IS DISTINCT FROM 'DRAFT' AND NOT (TG_TABLE_NAME = 'mto_lines' AND TG_OP = 'INSERT' AND v_status = 'DRAFT') THEN
                    RAISE EXCEPTION 'The items and lines of a verified or approved MTO package are immutable';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_mto_items_guard BEFORE INSERT OR UPDATE OR DELETE ON mto_items FOR EACH ROW EXECUTE FUNCTION distriva_guard_mto_child()');
        DB::unprepared('CREATE TRIGGER trg_mto_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON mto_lines FOR EACH ROW EXECUTE FUNCTION distriva_guard_mto_child()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_mto_package()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MTO packages cannot be deleted'; END IF;
                IF (NEW.application_id, NEW.drawing_version_id, NEW.package_number, NEW.created_by) IS DISTINCT FROM (OLD.application_id, OLD.drawing_version_id, OLD.package_number, OLD.created_by) THEN
                    RAISE EXCEPTION 'MTO package identity is immutable';
                END IF;
                IF OLD.status = 'APPROVED' THEN RAISE EXCEPTION 'An approved MTO package is immutable'; END IF;
                IF OLD.status = 'VERIFIED' AND (NEW.params IS DISTINCT FROM OLD.params OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.valid_on IS DISTINCT FROM OLD.valid_on
                    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) AND NEW.status <> 'DRAFT' THEN
                    RAISE EXCEPTION 'A verified MTO package cannot change; reject it to reopen';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'VERIFIED') OR (OLD.status = 'VERIFIED' AND NEW.status IN ('APPROVED','DRAFT'))
                ) THEN
                    RAISE EXCEPTION 'Invalid MTO status transition % -> %', OLD.status, NEW.status;
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_mto_packages_guard BEFORE UPDATE OR DELETE ON mto_packages FOR EACH ROW EXECUTE FUNCTION distriva_guard_mto_package()');
        DB::unprepared('CREATE TRIGGER trg_mto_events_append_only BEFORE UPDATE OR DELETE ON mto_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_mto_events_no_truncate BEFORE TRUNCATE ON mto_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_mto_events_append_only ON mto_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_mto_events_no_truncate ON mto_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_mto_packages_guard ON mto_packages');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_mto_lines_guard ON mto_lines');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_mto_items_guard ON mto_items');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_mto_package()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_mto_child()');
        }
        foreach (['mto_events', 'mto_lines', 'mto_items', 'mto_packages'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
