<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// KHS items that are deliberately NOT mapped to an ERP SKU (docs/62 §45): e.g. a switchgear package that is requested only after the customer has paid, so it is never stock.
// They leave the "needs a SKU" worklist and its coverage figures. History is kept: lifting an exemption stamps lifted_* instead of deleting the row.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('khs_sku_exemptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->text('reason');
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('lifted_at')->nullable();
            $table->foreignUuid('lifted_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('lift_reason')->nullable();
            $table->index('khs_item_id');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('CREATE UNIQUE INDEX khs_sku_exemptions_one_active ON khs_sku_exemptions (khs_item_id) WHERE lifted_at IS NULL');
            DB::statement("ALTER TABLE khs_sku_exemptions ADD CONSTRAINT khs_sku_exemptions_lift_check CHECK ((lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL) OR (lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND btrim(lift_reason) <> ''))");
            DB::statement("ALTER TABLE khs_sku_exemptions ADD CONSTRAINT khs_sku_exemptions_reason_check CHECK (btrim(reason) <> '')");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('khs_sku_exemptions');
    }
};
