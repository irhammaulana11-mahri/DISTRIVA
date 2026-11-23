<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Aturan khusus unit (docs/90): sebagian tab ULP pada workbook memakai rumus pencapaian/nilai yang berbeda dari tab acuan; selisihnya disimpan per indikator dan unit
 * agar hasil hitung sama dengan workbook.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_unit_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('definition_id')->constrained('kpi_definitions')->cascadeOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->jsonb('rules');                                    // pencapaian, nilai, months yang menggantikan aturan set
            $table->unique(['definition_id', 'organizational_unit_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_unit_rules');
    }
};
