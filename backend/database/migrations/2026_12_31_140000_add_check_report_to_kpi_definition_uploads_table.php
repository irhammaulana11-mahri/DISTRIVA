<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hasil pemeriksaan workbook saat diunggah (per tab, galat, peringatan), agar penyetuju melihat apa yang diperiksa (docs/93 §10).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kpi_definition_uploads', function (Blueprint $table) {
            $table->jsonb('check_report')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('kpi_definition_uploads', function (Blueprint $table) {
            $table->dropColumn('check_report');
        });
    }
};
