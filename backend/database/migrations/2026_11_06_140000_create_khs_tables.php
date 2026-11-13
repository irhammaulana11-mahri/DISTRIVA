<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// T4.2.2 iteration 2B-1 (docs/23 §2.5): KHS catalogue with immutable approved versions.
// Deviation from docs/23, on purpose: the unit is stored as the workbook's own text (B, S, M, M3, Ls, Loks) in
// `unit_text`; `unit_id` stays NULL until the ERP/KHS unit list is known — no unit is guessed from ambiguous text.
// Prices are NOT part of the KHS version (they belong to the price master, docs/23 §4).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('khs_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 50)->unique();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        Schema::create('khs_item_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('name', 255);
            $table->text('description')->nullable();
            $table->string('unit_text', 30);
            $table->foreignUuid('unit_id')->nullable()->constrained('units_of_measure')->restrictOnDelete();
            $table->string('category', 50)->nullable();
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->text('source_reference')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['khs_item_id', 'version_number']);
            $table->index(['status', 'khs_item_id']);
        });

        Schema::create('khs_version_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('khs_item_version_id')->constrained('khs_item_versions')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['khs_item_version_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE khs_item_versions ADD CONSTRAINT khs_item_versions_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE khs_item_versions ADD CONSTRAINT khs_item_versions_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE khs_item_versions ADD CONSTRAINT khs_item_versions_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        // Separation of duties enforced by the database: nobody approves a version they created.
        DB::statement('ALTER TABLE khs_item_versions ADD CONSTRAINT khs_item_versions_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement("ALTER TABLE khs_version_events ADD CONSTRAINT khs_version_events_type_check CHECK (event_type IN ('CREATED','DRAFT_UPDATED','APPROVED','AUTO_CLOSED','RETIRED'))");
        // At most one approved version of an item at any date.
        DB::statement("ALTER TABLE khs_item_versions ADD CONSTRAINT khs_item_versions_no_overlap EXCLUDE USING gist (khs_item_id WITH =, daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");

        // Approved versions are immutable (docs/16: versi aktif immutable); only the lifecycle may move forward.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_khs_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved KHS versions cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.khs_item_id, NEW.version_number, NEW.name, NEW.description, NEW.unit_text, NEW.unit_id,
                    NEW.category, NEW.valid_from, NEW.source_reference, NEW.created_by
                ) IS DISTINCT FROM (
                    OLD.khs_item_id, OLD.version_number, OLD.name, OLD.description, OLD.unit_text, OLD.unit_id,
                    OLD.category, OLD.valid_from, OLD.source_reference, OLD.created_by
                ) THEN
                    RAISE EXCEPTION 'Approved KHS version content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid KHS version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
                    RAISE EXCEPTION 'Approval data is immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_khs_item_versions_guard BEFORE UPDATE OR DELETE ON khs_item_versions FOR EACH ROW EXECUTE FUNCTION distriva_guard_khs_version()');
        DB::unprepared('CREATE TRIGGER trg_khs_version_events_append_only BEFORE UPDATE OR DELETE ON khs_version_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_khs_version_events_no_truncate BEFORE TRUNCATE ON khs_version_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_khs_version_events_append_only ON khs_version_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_khs_version_events_no_truncate ON khs_version_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_khs_item_versions_guard ON khs_item_versions');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_khs_version()');
        }
        foreach (['khs_version_events', 'khs_item_versions', 'khs_items'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
