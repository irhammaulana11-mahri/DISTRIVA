<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Kontrak Rinci lines: which pole material (KHS item) and type (TM/TR) each KR supplies, so a KR adds pole stock and plotting draws it down (docs/62 §49). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pole_contract_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_contract_id')->constrained('pole_contracts')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('pole_type', 2);                       // TM | TR
            $table->unsignedInteger('quantity');
            $table->timestampsTz();
            $table->unique(['pole_contract_id', 'khs_item_id']);
        });
        Schema::table('allocation_pole_lines', function (Blueprint $table) {
            $table->foreignUuid('khs_item_id')->nullable()->constrained('khs_items')->restrictOnDelete();      // the KR line drawn down (null on KR without lines)
            $table->foreignUuid('warehouse_id')->nullable()->constrained('warehouses')->restrictOnDelete();    // note only: where the poles are taken from
        });
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE pole_contract_lines ADD CONSTRAINT pole_contract_lines_check CHECK (pole_type IN ('TM','TR') AND quantity > 0)");
        foreach (DB::select("SELECT conname FROM pg_constraint WHERE conrelid = 'allocation_pole_lines'::regclass AND contype = 'u'") as $c) {   // the generated name is cut at 63 characters
            DB::statement('ALTER TABLE allocation_pole_lines DROP CONSTRAINT "'.$c->conname.'"');
        }
        DB::statement("CREATE UNIQUE INDEX allocation_pole_lines_unique ON allocation_pole_lines (allocation_id, pole_contract_id, pole_type, COALESCE(khs_item_id, '00000000-0000-0000-0000-000000000000'::uuid))");
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS allocation_pole_lines_unique');
        }
        Schema::table('allocation_pole_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
            $table->dropConstrainedForeignId('khs_item_id');
        });
        Schema::dropIfExists('pole_contract_lines');
    }
};
