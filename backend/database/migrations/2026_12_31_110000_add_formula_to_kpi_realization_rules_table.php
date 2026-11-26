<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Aturan realisasi NKO tahap 2 (docs/93): `source_key` menjadi `formula` (rumus atas besaran NkoSourceCatalog); kunci sumber lama adalah rumus satu besaran, jadi nilainya disalin apa adanya.
 * `inputs` = masukan manual baru yang dipakai rumus: [{code, name, unit_label}].
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->string('formula', 500)->nullable();
            $table->jsonb('inputs')->nullable();
        });
        DB::statement('update kpi_realization_rules set formula = source_key');
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->string('formula', 500)->nullable(false)->change();
            $table->dropColumn('source_key');
        });
    }

    public function down(): void
    {
        // hanya dapat dikembalikan selama rumus masih berupa satu nama besaran (muat di 40 karakter)
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->string('source_key', 40)->nullable();
        });
        DB::statement('update kpi_realization_rules set source_key = formula');
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->string('source_key', 40)->nullable(false)->change();
            $table->dropColumn(['formula', 'inputs']);
        });
    }
};
