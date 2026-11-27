<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Unggahan target NKO (docs/93 §12) memakai antrean persetujuan yang sama dengan unggahan definisi. Indeks unik "satu menunggu per tahun" berlaku untuk keduanya,
 * sehingga pratinjau yang satu tidak basi oleh persetujuan yang lain.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kpi_definition_uploads', function (Blueprint $table) {
            $table->string('kind', 8)->default('DEFINISI');       // DEFINISI | TARGET
        });
    }

    public function down(): void
    {
        Schema::table('kpi_definition_uploads', function (Blueprint $table) {
            $table->dropColumn('kind');
        });
    }
};
