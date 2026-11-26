<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Riwayat prakiraan cuaca BMKG per ULP (docs/92 §8.2): BMKG hanya memberi tiga hari ke depan, jadi prakiraan disimpan tiap hari agar tingkat peringatan dini dapat diuji terhadap gangguan sesudahnya.
 * Satu baris per ULP per hari pengambilan; pengambilan ulang pada hari yang sama menimpa baris itu.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('weather_forecast_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('adm4', 20);
            $table->date('fetched_on');
            $table->timestampTz('fetched_at');
            $table->string('analysis_date', 40)->nullable();   // waktu analisis BMKG apa adanya
            $table->jsonb('slots');                            // [{at, rain, weather, wind}] tiap tiga jam
            $table->unique(['organizational_unit_id', 'fetched_on']);
            $table->index('fetched_on');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('weather_forecast_snapshots');
    }
};
