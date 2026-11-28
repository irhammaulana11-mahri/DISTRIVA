<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Nomor material SAP yang dipakai tiap baris reservasi (docs/95): satu baris KHS dapat dibagi ke beberapa nomor; nomor seri mencatat nomor materialnya. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sr_reservation_line_materials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr_reservation_line_id')->constrained('sr_reservation_lines')->cascadeOnDelete();
            $table->string('material_no', 30);                                   // seperti khs_material_map: tanpa nol di depan
            $table->decimal('quantity', 14, 3);
            $table->unique(['sr_reservation_line_id', 'material_no']);
            $table->index('material_no');
        });
        DB::statement('ALTER TABLE sr_reservation_line_materials ADD CONSTRAINT sr_reservation_line_materials_quantity_check CHECK (quantity > 0)');
        Schema::table('sr_reservation_serials', fn (Blueprint $table) => $table->string('material_no', 30)->nullable());
    }

    public function down(): void
    {
        Schema::table('sr_reservation_serials', fn (Blueprint $table) => $table->dropColumn('material_no'));
        Schema::dropIfExists('sr_reservation_line_materials');
    }
};
