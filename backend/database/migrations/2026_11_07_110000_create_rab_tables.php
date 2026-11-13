<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5B (docs/62 §21): RAB runs. A run prices the frozen lines of an APPROVED MTO package with the price book valid on the run date and the
// service zone of the application's UP3. Runs are immutable history (a recalculation is a new run). The insured value of a material (HS +
// transport, workbook sheet MDU) is part of the price book (owner 2026-11-07).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('price_book_items', function (Blueprint $table) {
            $table->decimal('insured_value', 18, 2)->nullable();
        });

        Schema::create('rab_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('mto_package_id')->constrained('mto_packages')->restrictOnDelete();
            $table->unsignedInteger('run_number');                       // per application
            $table->foreignUuid('price_book_id')->constrained('price_books')->restrictOnDelete();
            $table->foreignUuid('up3_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('zone');
            $table->date('valid_on');
            $table->jsonb('parameters');                                 // {ppn_rate, insurance_rate, rounding}
            $table->jsonb('groups');                                     // per group: material, service, commissioning, k3l, insurance, subtotal, ppn, total
            $table->decimal('grand_total', 24, 2);
            $table->string('snapshot_hash', 64);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['application_id', 'run_number']);
            $table->index('mto_package_id');
        });

        Schema::create('rab_run_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('rab_run_id')->constrained('rab_runs')->restrictOnDelete();
            $table->string('group_code', 30);
            $table->unsignedInteger('sequence');
            $table->string('category', 20);                              // ITEM | COMMISSIONING | K3L | INSURANCE
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('khs_code', 50);
            $table->string('khs_name', 255)->nullable();
            $table->string('unit_text', 30)->nullable();
            $table->decimal('qty_material', 18, 6)->default(0);
            $table->decimal('qty_install', 18, 6)->default(0);
            $table->decimal('qty_remove', 18, 6)->default(0);
            $table->string('material_status', 10)->nullable();           // PLN | PRICED
            $table->decimal('material_price', 18, 2)->nullable();
            $table->decimal('install_price', 18, 2)->nullable();
            $table->decimal('remove_price', 18, 2)->nullable();
            $table->decimal('insured_value', 18, 2)->nullable();
            $table->decimal('material_cost', 24, 6)->default(0);
            $table->decimal('install_cost', 24, 6)->default(0);
            $table->decimal('remove_cost', 24, 6)->default(0);
            $table->decimal('insurance_cost', 24, 6)->default(0);
            $table->index(['rab_run_id', 'group_code', 'sequence']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE rab_run_lines ADD CONSTRAINT rab_run_lines_category_check CHECK (category IN ('ITEM','COMMISSIONING','K3L','INSURANCE'))");
        DB::statement('ALTER TABLE price_book_items ADD CONSTRAINT price_book_items_insured_check CHECK (insured_value IS NULL OR insured_value >= 0)');
        foreach (['rab_runs', 'rab_run_lines'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_immutable BEFORE UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
            DB::unprepared("CREATE TRIGGER trg_{$t}_no_truncate BEFORE TRUNCATE ON {$t} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['rab_runs', 'rab_run_lines'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_immutable ON {$t}");
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_no_truncate ON {$t}");
            }
            DB::statement('ALTER TABLE price_book_items DROP CONSTRAINT IF EXISTS price_book_items_insured_check');
        }
        Schema::dropIfExists('rab_run_lines');
        Schema::dropIfExists('rab_runs');
        Schema::table('price_book_items', function (Blueprint $table) {
            $table->dropColumn('insured_value');
        });
    }
};
