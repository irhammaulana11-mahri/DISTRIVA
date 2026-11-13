<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 6A (docs/62 §30): minimal stock (warehouses + imported dated snapshots, keyed by KHS code because the whole planning chain is KHS-based), pole contracts
// ("Kontrak Rinci", KR: counts of TM and TR poles each, managed by PERENCANAAN) and allocations per application: materials from a warehouse plus poles with the KR number.
// Owner 7 Nov 2026: PERENCANAAN imports the KR and plots the concrete poles (TM/TR); the Konstruksi/Gudang side (KONSTRUKSI_UP3, one role) imports stock and plots all other materials.
// So an allocation has two parts, each confirmed by its own role; the allocation is CONFIRMED when both parts are.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warehouses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name', 150);
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('plant', 10)->nullable();                     // ERP plant (e.g. 5118) and storage location (e.g. 2810 = Gd Ry Jombang): the key of the ERP stock API
            $table->string('stor_loc', 10)->nullable();
            $table->string('kind', 2)->nullable();                       // GI = gudang induk (UP3), GO = gudang rayon (ULP)
            $table->string('erp_unit_code', 20)->nullable();             // unit code of the ERP (51453 ...), matched to organizational_units.code
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        // ERP material number (SKU, e.g. 000000000003110025) of a KHS item: the ERP stock file is keyed by SKU, planning by KHS. Several SKUs may map to one KHS item; a SKU maps to one.
        Schema::create('khs_material_map', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('material_no', 30)->unique();                // normalized: leading zeros removed
            $table->string('note', 255)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->index('khs_item_id');
        });

        Schema::create('stock_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->date('as_of');
            $table->string('source_reference', 255)->nullable();
            $table->unsignedInteger('materials_total')->default(0);      // SKU rows of an ERP file
            $table->unsignedInteger('materials_mapped')->default(0);     // of which mapped to a KHS item
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['warehouse_id', 'as_of']);
        });

        Schema::create('stock_snapshot_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('snapshot_id')->constrained('stock_snapshots')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('on_hand', 18, 3);
            $table->decimal('reserved', 18, 3)->default(0);
            $table->decimal('incoming_confirmed', 18, 3)->default(0);
            $table->decimal('safety_stock', 18, 3)->default(0);
            $table->unique(['snapshot_id', 'khs_item_id']);
        });

        Schema::create('stock_snapshot_materials', function (Blueprint $table) {   // the ERP file as received, by SKU (kept for audit and to see what is still unmapped)
            $table->uuid('id')->primary();
            $table->foreignUuid('snapshot_id')->constrained('stock_snapshots')->restrictOnDelete();
            $table->string('material_no', 30);
            $table->string('material_name', 255)->nullable();
            $table->string('unit', 20)->nullable();
            $table->decimal('stock_ready', 18, 3);
            $table->decimal('stock_reserved', 18, 3)->default(0);
            $table->decimal('stock_in_transit', 18, 3)->default(0);
            $table->decimal('stock_minimum', 18, 3)->default(0);
            $table->foreignUuid('khs_item_id')->nullable()->constrained('khs_items')->restrictOnDelete();   // the mapping at import time
            $table->unique(['snapshot_id', 'material_no']);
        });

        Schema::create('stock_sync_runs', function (Blueprint $table) {          // automatic pulls of the ERP stock API (docs/62 §40): one row per warehouse per attempt
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('status', 10);                                       // OK | FAILED | SKIPPED
            $table->text('message')->nullable();
            $table->foreignUuid('snapshot_id')->nullable()->constrained('stock_snapshots')->restrictOnDelete();
            $table->unsignedInteger('materials_total')->default(0);
            $table->unsignedInteger('materials_mapped')->default(0);
            $table->foreignUuid('triggered_by')->nullable()->constrained('users')->restrictOnDelete();   // the user who pulled on demand with his own MIMS token; null = the scheduled pull
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at')->nullable();
            $table->index(['warehouse_id', 'started_at']);
        });

        Schema::create('pole_contracts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('kr_number', 100)->unique();
            $table->string('description', 255)->nullable();
            $table->unsignedInteger('qty_tm');
            $table->unsignedInteger('qty_tr');
            $table->string('status', 10)->default('ACTIVE');
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });

        Schema::create('pole_contract_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_contract_id')->constrained('pole_contracts')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
        });

        Schema::create('allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('mto_package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->unsignedInteger('version_number');                  // per application; changing a confirmed allocation = cancel + new version
            $table->string('status', 12)->default('DRAFT');             // DRAFT | CONFIRMED | CANCELLED
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('materials_confirmed_by')->nullable()->constrained('users')->restrictOnDelete();   // KONSTRUKSI_UP3 part
            $table->timestampTz('materials_confirmed_at')->nullable();
            $table->foreignUuid('poles_confirmed_by')->nullable()->constrained('users')->restrictOnDelete();       // PERENCANAAN part
            $table->timestampTz('poles_confirmed_at')->nullable();
            $table->foreignUuid('confirmed_by')->nullable()->constrained('users')->restrictOnDelete();             // whoever confirmed the second part
            $table->timestampTz('confirmed_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->timestampsTz();
            $table->unique(['application_id', 'version_number']);
        });

        Schema::create('allocation_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('allocation_id')->constrained('allocations')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->unique(['allocation_id', 'khs_item_id', 'warehouse_id']);
        });

        Schema::create('allocation_pole_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('allocation_id')->constrained('allocations')->restrictOnDelete();
            $table->foreignUuid('pole_contract_id')->constrained('pole_contracts')->restrictOnDelete();
            $table->string('pole_type', 2);                              // TM | TR
            $table->unsignedInteger('quantity');
            $table->unique(['allocation_id', 'pole_contract_id', 'pole_type']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE stock_sync_runs ADD CONSTRAINT stock_sync_runs_status_check CHECK (status IN ('OK','FAILED','SKIPPED'))");
        DB::statement("ALTER TABLE warehouses ADD CONSTRAINT warehouses_kind_check CHECK (kind IS NULL OR kind IN ('GI','GO'))");
        DB::statement('CREATE UNIQUE INDEX warehouses_erp_key ON warehouses (plant, stor_loc) WHERE plant IS NOT NULL AND stor_loc IS NOT NULL');
        DB::statement('ALTER TABLE stock_snapshot_lines ADD CONSTRAINT stock_snapshot_lines_check CHECK (on_hand >= 0 AND reserved >= 0 AND incoming_confirmed >= 0 AND safety_stock >= 0)');
        DB::statement("ALTER TABLE pole_contracts ADD CONSTRAINT pole_contracts_status_check CHECK (status IN ('ACTIVE','CLOSED'))");
        DB::statement("ALTER TABLE pole_contract_events ADD CONSTRAINT pole_contract_events_type_check CHECK (event_type IN ('CREATED','UPDATED','CLOSED'))");
        DB::statement("ALTER TABLE allocations ADD CONSTRAINT allocations_status_check CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED'))");
        DB::statement("CREATE UNIQUE INDEX allocations_one_open ON allocations (application_id) WHERE status IN ('DRAFT','CONFIRMED')");
        DB::statement('ALTER TABLE allocation_lines ADD CONSTRAINT allocation_lines_check CHECK (quantity > 0)');
        DB::statement("ALTER TABLE allocation_pole_lines ADD CONSTRAINT allocation_pole_lines_check CHECK (pole_type IN ('TM','TR') AND quantity > 0)");

        // Snapshots, their lines and events are history. A CONFIRMED allocation is frozen except for its cancellation.
        foreach (['stock_snapshots', 'stock_snapshot_lines', 'stock_snapshot_materials', 'pole_contract_events'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_immutable BEFORE UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
            DB::unprepared("CREATE TRIGGER trg_{$t}_no_truncate BEFORE TRUNCATE ON {$t} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
        }
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_allocation()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' OR OLD.materials_confirmed_at IS NOT NULL OR OLD.poles_confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'A confirmed or cancelled allocation cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled allocation is final'; END IF;
                IF OLD.status = 'CONFIRMED' AND NEW.status <> 'CANCELLED' THEN RAISE EXCEPTION 'A confirmed allocation can only be cancelled'; END IF;
                IF OLD.materials_confirmed_at IS NOT NULL AND NEW.materials_confirmed_at IS DISTINCT FROM OLD.materials_confirmed_at THEN RAISE EXCEPTION 'The confirmed materials part cannot change'; END IF;
                IF OLD.poles_confirmed_at IS NOT NULL AND NEW.poles_confirmed_at IS DISTINCT FROM OLD.poles_confirmed_at THEN RAISE EXCEPTION 'The confirmed poles part cannot change'; END IF;
                IF NEW.status = 'CONFIRMED' AND (NEW.materials_confirmed_at IS NULL OR NEW.poles_confirmed_at IS NULL OR NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL) THEN
                    RAISE EXCEPTION 'An allocation is confirmed only when both parts are confirmed';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_allocations_guard BEFORE UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION distriva_guard_allocation()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_allocation_child()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_materials timestamptz; v_poles timestamptz;
            BEGIN
                SELECT status, materials_confirmed_at, poles_confirmed_at INTO v_status, v_materials, v_poles FROM allocations WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.allocation_id ELSE NEW.allocation_id END;
                IF v_status IS DISTINCT FROM 'DRAFT' OR (TG_TABLE_NAME = 'allocation_lines' AND v_materials IS NOT NULL) OR (TG_TABLE_NAME = 'allocation_pole_lines' AND v_poles IS NOT NULL) THEN
                    RAISE EXCEPTION 'Lines of a confirmed part of an allocation are immutable';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        foreach (['allocation_lines', 'allocation_pole_lines'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_guard BEFORE INSERT OR UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_guard_allocation_child()");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['allocation_lines', 'allocation_pole_lines'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_guard ON {$t}");
            }
            DB::unprepared('DROP TRIGGER IF EXISTS trg_allocations_guard ON allocations');
            foreach (['stock_snapshots', 'stock_snapshot_lines', 'stock_snapshot_materials', 'pole_contract_events'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_immutable ON {$t}");
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_no_truncate ON {$t}");
            }
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_allocation_child()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_allocation()');
        }
        foreach (['allocation_pole_lines', 'allocation_lines', 'allocations', 'pole_contract_events', 'pole_contracts', 'stock_sync_runs', 'stock_snapshot_materials', 'stock_snapshot_lines', 'stock_snapshots', 'khs_material_map', 'warehouses'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
