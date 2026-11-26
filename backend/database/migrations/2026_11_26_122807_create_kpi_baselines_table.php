<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Angka baseline per indikator, unit, dan bulan yang dipakai rumus realisasi NKO (docs/90): untuk Penjualan Tenaga Listrik adalah baseline adjustment (BA) bulanan workbook TRP
 * = target kWh jual bulanan dikurangi target delta kWh bulanan (kWh). Realisasi penambahan = jumlah (kWh jual 309 bulan itu dikurangi BA) Januari sampai bulan berjalan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_baselines', function (Blueprint $table) {
            $table->id();
            $table->string('definition_code', 120);
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month');
            $table->double('value');                   // double: identik dengan angka Excel
            $table->string('source', 200)->nullable();  // nama berkas workbook asal
            $table->timestamps();
            $table->unique(['definition_code', 'organizational_unit_id', 'year', 'month'], 'kpi_baselines_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_baselines');
    }
};
