<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// T4.2.2 iteration 2B-2 (docs/23 §2.6): construction types, immutable approved versions and their KHS mappings.
// Deviations from docs/23, on purpose:
//  * `code` is a DISTRIVA-assigned stable key (<GROUP>-<NN>) because the source workbook has only labels and the owner
//    confirmed (2026-11-06) that construction types have no official code yet; `external_code` is reserved for the
//    official code when one exists.
//  * a mapping points to the KHS ITEM (stable key), not to a KHS version: otherwise every new KHS version would force
//    re-approving every construction. The unit/name come from the KHS version valid at calculation time.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('construction_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('group_code', 30);
            $table->string('code', 50)->unique();
            $table->string('external_code', 50)->nullable()->unique();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->index('group_code');
        });

        Schema::create('construction_type_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('construction_type_id')->constrained('construction_types')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('name', 150);
            $table->text('description')->nullable();
            $table->string('reference_symbol', 100)->nullable();
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->text('source_reference')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['construction_type_id', 'version_number']);
            $table->index(['status', 'construction_type_id']);
        });

        Schema::create('construction_khs_mappings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('construction_type_version_id')->constrained('construction_type_versions')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('relation', 10)->default('DIRECT'); // DIRECT = depends on this construction only; SHARED = also on others
            $table->text('note')->nullable();
            $table->text('source_reference')->nullable();
            $table->timestampsTz();
            $table->unique(['construction_type_version_id', 'khs_item_id']);
            $table->index('khs_item_id');
        });

        Schema::create('construction_version_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('construction_type_version_id')->constrained('construction_type_versions')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['construction_type_version_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE construction_type_versions ADD CONSTRAINT construction_type_versions_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE construction_type_versions ADD CONSTRAINT construction_type_versions_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE construction_type_versions ADD CONSTRAINT construction_type_versions_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE construction_type_versions ADD CONSTRAINT construction_type_versions_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement("ALTER TABLE construction_khs_mappings ADD CONSTRAINT construction_khs_mappings_relation_check CHECK (relation IN ('DIRECT','SHARED'))");
        DB::statement("ALTER TABLE construction_version_events ADD CONSTRAINT construction_version_events_type_check CHECK (event_type IN ('CREATED','DRAFT_UPDATED','MAPPINGS_CHANGED','APPROVED','AUTO_CLOSED','RETIRED'))");
        DB::statement("ALTER TABLE construction_type_versions ADD CONSTRAINT construction_type_versions_no_overlap EXCLUDE USING gist (construction_type_id WITH =, daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_construction_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved construction versions cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.construction_type_id, NEW.version_number, NEW.name, NEW.description, NEW.reference_symbol, NEW.valid_from, NEW.source_reference, NEW.created_by
                ) IS DISTINCT FROM (
                    OLD.construction_type_id, OLD.version_number, OLD.name, OLD.description, OLD.reference_symbol, OLD.valid_from, OLD.source_reference, OLD.created_by
                ) THEN
                    RAISE EXCEPTION 'Approved construction version content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid construction version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
                    RAISE EXCEPTION 'Approval data is immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_construction_versions_guard BEFORE UPDATE OR DELETE ON construction_type_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_construction_version()');

        // A mapping can only be added, changed or removed while its version is still a DRAFT.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_construction_mapping()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_id uuid;
            BEGIN
                v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.construction_type_version_id ELSE NEW.construction_type_version_id END;
                SELECT status INTO v_status FROM construction_type_versions WHERE id = v_id;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN
                    RAISE EXCEPTION 'Mappings of a non-draft construction version are immutable';
                END IF;
                IF TG_OP = 'UPDATE' AND NEW.construction_type_version_id <> OLD.construction_type_version_id THEN
                    RAISE EXCEPTION 'A mapping cannot move to another version';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_construction_mappings_guard BEFORE INSERT OR UPDATE OR DELETE ON construction_khs_mappings FOR EACH ROW EXECUTE FUNCTION distriva_guard_construction_mapping()');

        DB::unprepared('CREATE TRIGGER trg_construction_events_append_only BEFORE UPDATE OR DELETE ON construction_version_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_construction_events_no_truncate BEFORE TRUNCATE ON construction_version_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_construction_events_append_only ON construction_version_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_construction_events_no_truncate ON construction_version_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_construction_mappings_guard ON construction_khs_mappings');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_construction_versions_guard ON construction_type_versions');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_construction_mapping()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_construction_version()');
        }
        foreach (['construction_version_events', 'construction_khs_mappings', 'construction_type_versions', 'construction_types'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
