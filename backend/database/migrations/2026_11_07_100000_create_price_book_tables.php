<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5A (docs/62 §18-19): price books = one contract's prices. Per KHS item: material status (PLN = supplied by PLN, never in the RAB;
// PRICED = vendor buys, with a unit price) and the service price (install / remove) per ZONE. The zone of each UP3 is chosen per price book
// (a new contract may change it; owner 2026-11-07). A book is DRAFT -> APPROVED (different user) -> INACTIVE; approved content is immutable.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_books', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 150);
            $table->string('contract_reference', 150)->nullable();
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

        Schema::create('price_book_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('price_book_id')->constrained('price_books')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('material_status', 10);                      // PLN | PRICED
            $table->decimal('material_price', 18, 2)->nullable();
            $table->timestampsTz();
            $table->unique(['price_book_id', 'khs_item_id']);
        });

        Schema::create('price_book_service_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('price_book_item_id')->constrained('price_book_items')->restrictOnDelete();
            $table->unsignedSmallInteger('zone');
            $table->decimal('install_price', 18, 2);
            $table->decimal('remove_price', 18, 2);
            $table->unique(['price_book_item_id', 'zone']);
        });

        Schema::create('price_book_zones', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('price_book_id')->constrained('price_books')->restrictOnDelete();
            $table->foreignUuid('up3_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('zone');
            $table->timestampsTz();
            $table->unique(['price_book_id', 'up3_unit_id']);
        });

        Schema::create('price_book_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('price_book_id')->constrained('price_books')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['price_book_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE price_books ADD CONSTRAINT price_books_status_check CHECK (status IN ('DRAFT','APPROVED','INACTIVE'))");
        DB::statement('ALTER TABLE price_books ADD CONSTRAINT price_books_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement("ALTER TABLE price_books ADD CONSTRAINT price_books_approval_check CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))");
        DB::statement('ALTER TABLE price_books ADD CONSTRAINT price_books_sod_check CHECK (approved_by IS NULL OR approved_by <> created_by)');
        DB::statement("ALTER TABLE price_books ADD CONSTRAINT price_books_no_overlap EXCLUDE USING gist (daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&) WHERE (status = 'APPROVED')");
        DB::statement("ALTER TABLE price_book_items ADD CONSTRAINT price_book_items_status_check CHECK ((material_status = 'PLN' AND material_price IS NULL) OR (material_status = 'PRICED' AND material_price IS NOT NULL AND material_price >= 0))");
        DB::statement('ALTER TABLE price_book_service_prices ADD CONSTRAINT price_book_service_prices_check CHECK (zone BETWEEN 1 AND 9 AND install_price >= 0 AND remove_price >= 0)');
        DB::statement('ALTER TABLE price_book_zones ADD CONSTRAINT price_book_zones_check CHECK (zone BETWEEN 1 AND 9)');
        DB::statement("ALTER TABLE price_book_events ADD CONSTRAINT price_book_events_type_check CHECK (event_type IN ('CREATED','DRAFT_UPDATED','ZONE_SET','APPROVED','AUTO_CLOSED','RETIRED'))");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_price_book()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved price books cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.name, NEW.contract_reference, NEW.valid_from, NEW.source_reference, NEW.created_by)
                    IS DISTINCT FROM (OLD.name, OLD.contract_reference, OLD.valid_from, OLD.source_reference, OLD.created_by) THEN
                    RAISE EXCEPTION 'Approved price book content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid price book status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.valid_until IS DISTINCT FROM OLD.valid_until AND OLD.valid_until IS NOT NULL THEN
                    RAISE EXCEPTION 'valid_until of a closed price book cannot change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_price_books_guard BEFORE UPDATE OR DELETE ON price_books FOR EACH ROW EXECUTE FUNCTION distriva_guard_price_book()');

        // items, service prices and zones of a non-DRAFT book are frozen
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_price_book_child()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_id uuid;
            BEGIN
                IF TG_TABLE_NAME = 'price_book_service_prices' THEN
                    SELECT price_book_id INTO v_id FROM price_book_items WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.price_book_item_id ELSE NEW.price_book_item_id END;
                ELSE
                    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.price_book_id ELSE NEW.price_book_id END;
                END IF;
                SELECT status INTO v_status FROM price_books WHERE id = v_id;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN
                    RAISE EXCEPTION 'Content of a non-draft price book is immutable';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        foreach (['price_book_items', 'price_book_service_prices', 'price_book_zones'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_guard BEFORE INSERT OR UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_guard_price_book_child()");
        }
        DB::unprepared('CREATE TRIGGER trg_price_book_events_append_only BEFORE UPDATE OR DELETE ON price_book_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_price_book_events_no_truncate BEFORE TRUNCATE ON price_book_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_price_book_events_append_only ON price_book_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_price_book_events_no_truncate ON price_book_events');
            foreach (['price_book_items', 'price_book_service_prices', 'price_book_zones'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_guard ON {$t}");
            }
            DB::unprepared('DROP TRIGGER IF EXISTS trg_price_books_guard ON price_books');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_price_book_child()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_price_book()');
        }
        Schema::dropIfExists('price_book_events');
        Schema::dropIfExists('price_book_zones');
        Schema::dropIfExists('price_book_service_prices');
        Schema::dropIfExists('price_book_items');
        Schema::dropIfExists('price_books');
    }
};
