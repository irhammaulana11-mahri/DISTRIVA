<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// T4.2.2 iteration 2A (docs/23 §2.1-2.3 and §3): categories, units, materials (one ERP SKU = one record) and the
// controlled ERP import (staging -> validation -> preview -> confirm -> upsert -> change log). DISTRIVA never
// creates material codes and never touches stock.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('material_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name', 100);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        Schema::create('units_of_measure', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name', 100);
            $table->string('symbol', 20);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        Schema::create('materials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Nullable: the ERP does not provide the internal category; unmapped materials are flagged, never guessed.
            $table->foreignUuid('category_id')->nullable()->constrained('material_categories')->restrictOnDelete();
            $table->string('code', 100)->unique(); // ERP SKU
            $table->string('name', 255);
            $table->string('unit', 30);            // ERP unit as text; normalisation to units_of_measure waits for the ERP unit list
            $table->text('spec')->nullable();
            $table->string('source_system', 50)->default('ERP_MATERIAL');
            $table->timestampTz('external_updated_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->index(['category_id', 'is_active']);
        });

        Schema::create('material_sync_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source', 100);          // file name or system
            $table->string('checksum', 64);         // sha256 of the uploaded file
            $table->string('status', 20);           // STAGED | CONFIRMED | CANCELLED
            $table->foreignUuid('staged_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('confirmed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('total_rows')->default(0);
            $table->unsignedInteger('inserted_count')->default(0);
            $table->unsignedInteger('updated_count')->default(0);
            $table->unsignedInteger('unchanged_count')->default(0);
            $table->unsignedInteger('rejected_count')->default(0);
            $table->unsignedInteger('unit_change_count')->default(0);
            $table->jsonb('summary')->nullable();
            $table->timestampTz('staged_at');
            $table->timestampTz('finished_at')->nullable();
            $table->index(['status', 'staged_at']);
        });

        Schema::create('material_sync_staging', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('batch_id')->constrained('material_sync_logs')->cascadeOnDelete();
            $table->unsignedInteger('row_number');
            $table->string('external_code', 100)->nullable();
            $table->string('name', 255)->nullable();
            $table->string('unit', 30)->nullable();
            $table->text('spec')->nullable();
            $table->string('category_code', 30)->nullable();
            $table->string('action', 12);           // INSERT | UPDATE | UNCHANGED | REJECT
            $table->boolean('unit_change')->default(false);
            $table->jsonb('messages')->nullable();   // validation errors / warnings
            $table->foreignUuid('material_id')->nullable()->constrained('materials')->restrictOnDelete();
            $table->index(['batch_id', 'action']);
            $table->unique(['batch_id', 'row_number']);
        });

        Schema::create('material_change_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('material_id')->constrained('materials')->restrictOnDelete();
            $table->string('change_type', 20);       // INSERTED | UPDATED | CATEGORY_MAPPED | ACTIVATED | DEACTIVATED
            $table->jsonb('before_values')->nullable();
            $table->jsonb('after_values')->nullable();
            $table->foreignUuid('batch_id')->nullable()->constrained('material_sync_logs')->restrictOnDelete();
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->timestampTz('changed_at');
            $table->index(['material_id', 'changed_at']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE material_sync_logs ADD CONSTRAINT material_sync_logs_status_check CHECK (status IN ('STAGED','CONFIRMED','CANCELLED'))");
            DB::statement("ALTER TABLE material_sync_staging ADD CONSTRAINT material_sync_staging_action_check CHECK (action IN ('INSERT','UPDATE','UNCHANGED','REJECT'))");
            DB::statement("ALTER TABLE material_change_logs ADD CONSTRAINT material_change_logs_type_check CHECK (change_type IN ('INSERTED','UPDATED','CATEGORY_MAPPED','ACTIVATED','DEACTIVATED'))");
            DB::statement("ALTER TABLE materials ADD CONSTRAINT materials_code_not_blank_check CHECK (btrim(code) <> '' AND code = btrim(code))");
            // The change history is append-only (same guard as the authorization histories).
            DB::unprepared('CREATE TRIGGER trg_material_change_logs_append_only BEFORE UPDATE OR DELETE ON material_change_logs FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
            DB::unprepared('CREATE TRIGGER trg_material_change_logs_no_truncate BEFORE TRUNCATE ON material_change_logs FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_change_logs_append_only ON material_change_logs');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_change_logs_no_truncate ON material_change_logs');
        }
        foreach (['material_change_logs', 'material_sync_staging', 'material_sync_logs', 'materials', 'units_of_measure', 'material_categories'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
