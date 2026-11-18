<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The drawing-sheet layout a BOM version was imported with: which GAMBAR cell is the quantity (PSG / BKR) of which construction label, and the fixed list values (constants) of the sheet.
 * The formulas keep the workbook's own cell references (source_formulas); this map lets the DISTRIVA master workbook be rebuilt with the same cells, so an unchanged re-upload is a no-change.
 * One row per version, written with the version; a separate table so the immutability guard of bom_headers is untouched. Additive and idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('bom_input_maps')) {
            return;
        }
        Schema::create('bom_input_maps', function (Blueprint $table) {
            $table->foreignUuid('bom_header_id')->primary()->constrained('bom_headers')->cascadeOnDelete();
            $table->jsonb('inputs');                       // [{cell, label, kind: PSG|BKR}]
            $table->jsonb('constants')->nullable();        // {cell: text}
            $table->timestampTz('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bom_input_maps');
    }
};
