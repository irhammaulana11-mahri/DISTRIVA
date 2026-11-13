<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Keterangan per baris WO Tiang (rekap harian pemilik): kondisi tiang (baru, bekas, relokasi) dan catatan asal (mis. "limpahan dari Madiun", "minta dari SBB").
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pole_wo_lines', function (Blueprint $table) {
            $table->string('pole_condition', 10)->default('BARU');          // BARU | BEKAS | RELOKASI
            $table->string('origin_note', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pole_wo_lines', fn (Blueprint $table) => $table->dropColumn(['pole_condition', 'origin_note']));
    }
};
