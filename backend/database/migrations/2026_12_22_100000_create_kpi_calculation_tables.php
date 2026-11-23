<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Perhitungan NKO/KPI (docs/90): `kpi_reference_values` dan `kpi_reference_totals` = angka hasil workbook (realisasi, pencapaian, nilai, total, NKO akhir) untuk rekonsiliasi mesin hitung;
 * `kpi_manual_inputs` = masukan manual realisasi kumulatif bulanan untuk indikator tanpa sumber otomatis; `kpi_snapshots` + `kpi_snapshot_values` = hasil hitung per unit dan bulan
 * yang menunjuk ke set definisi yang dipakai (satu snapshot berlaku per unit dan bulan, riwayat hitung ulang tetap ada).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_reference_values', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('definition_id')->constrained('kpi_definitions')->cascadeOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->double('realisasi')->nullable();                   // double: identik dengan angka Excel (TRUNC peka terhadap pembulatan desimal)
            $table->double('pencapaian')->nullable();
            $table->double('nilai')->nullable();
            $table->unique(['definition_id', 'organizational_unit_id', 'period']);
        });

        Schema::create('kpi_reference_totals', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('set_id')->constrained('kpi_definition_sets')->cascadeOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->double('total')->nullable();
            $table->double('nko')->nullable();
            $table->unique(['set_id', 'organizational_unit_id', 'period']);
        });

        Schema::create('kpi_manual_inputs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('definition_code', 80);
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->decimal('value', 24, 8);
            $table->string('note', 300)->nullable();
            $table->foreignUuid('entered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['definition_code', 'organizational_unit_id', 'period']);
        });

        Schema::create('kpi_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('set_id')->constrained('kpi_definition_sets')->cascadeOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->boolean('is_current')->default(true);
            $table->decimal('total_nilai', 24, 8)->nullable();
            $table->decimal('nko', 24, 8)->nullable();
            $table->unsignedSmallInteger('rank')->nullable();
            $table->unsignedSmallInteger('rank_of')->nullable();
            $table->unsignedSmallInteger('missing_count')->default(0);
            $table->jsonb('missing')->nullable();                      // indikator yang realisasinya belum tersedia
            $table->foreignUuid('calculated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('calculated_at');
            $table->timestampsTz();
            $table->index(['organizational_unit_id', 'period']);
        });
        DB::statement('create unique index kpi_snapshots_current_unique on kpi_snapshots (organizational_unit_id, period) where is_current');

        Schema::create('kpi_snapshot_values', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('snapshot_id')->constrained('kpi_snapshots')->cascadeOnDelete();
            $table->foreignUuid('definition_id')->constrained('kpi_definitions')->cascadeOnDelete();
            $table->decimal('target_value', 24, 8)->nullable();
            $table->string('target_text', 40)->nullable();
            $table->decimal('realisasi', 24, 8)->nullable();
            $table->string('source', 10)->nullable();                  // MANUAL | SISTEM
            $table->decimal('pencapaian', 24, 8)->nullable();
            $table->decimal('nilai', 24, 8)->nullable();
            $table->unique(['snapshot_id', 'definition_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_snapshot_values');
        Schema::dropIfExists('kpi_snapshots');
        Schema::dropIfExists('kpi_manual_inputs');
        Schema::dropIfExists('kpi_reference_totals');
        Schema::dropIfExists('kpi_reference_values');
    }
};
