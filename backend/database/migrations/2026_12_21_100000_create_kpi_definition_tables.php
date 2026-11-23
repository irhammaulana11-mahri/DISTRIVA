<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Master definisi NKO/KPI berversi (docs/89), diekstrak dari workbook realisasi: `kpi_definition_sets` = satu set per tahun, tingkat unit (ULP atau UP3), dan versi (sidik jari berkas sumber);
 * `kpi_definitions` = pohon indikator (kelompok, indikator, sub-indikator) dengan polaritas, bobot, aturan pencapaian dan aturan nilai; `kpi_targets` = target kumulatif per indikator, unit, dan bulan.
 * Set yang digantikan berstatus ARSIP dan tetap ada agar snapshot nilai lama dapat ditelusuri ke definisi yang dipakai saat itu.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_definition_sets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedSmallInteger('year');
            $table->string('unit_level', 4);                           // ULP | UP3
            $table->unsignedInteger('version');
            $table->string('status', 8)->default('AKTIF');             // AKTIF | ARSIP
            $table->string('source_name', 200);
            $table->char('source_sha256', 64);
            $table->decimal('total_weight', 8, 3)->nullable();
            $table->jsonb('month_rules')->nullable();                  // rumus total dan nilai akhir per bulan + nilai acuan dari workbook
            $table->jsonb('warnings')->nullable();
            $table->foreignUuid('imported_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('imported_at');
            $table->timestampsTz();
            $table->unique(['year', 'unit_level', 'version']);
            $table->index('source_sha256');
        });
        DB::statement("create unique index kpi_definition_sets_active_unique on kpi_definition_sets (year, unit_level) where status = 'AKTIF'");
        DB::statement("alter table kpi_definition_sets add constraint kpi_definition_sets_level_check check (unit_level in ('ULP','UP3'))");
        DB::statement("alter table kpi_definition_sets add constraint kpi_definition_sets_status_check check (status in ('AKTIF','ARSIP'))");

        Schema::create('kpi_definitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('set_id')->constrained('kpi_definition_sets')->cascadeOnDelete();
            $table->unsignedInteger('row_no');                         // baris pada lembar asli
            $table->unsignedSmallInteger('sort_order');
            $table->unsignedSmallInteger('level');                     // 0 kelompok, 1 indikator, 2 sub-indikator
            $table->uuid('parent_id')->nullable();
            $table->string('code', 80);                                // slug stabil lintas set
            $table->string('number', 8)->nullable();                   // 1..13 untuk kelompok, a..d untuk indikator
            $table->string('name', 300);
            $table->unsignedSmallInteger('polarity')->nullable();      // 1 makin kecil makin baik, 2 rentang, 3 makin besar makin baik
            $table->string('unit_label', 80)->nullable();
            $table->decimal('weight', 8, 3)->nullable();
            $table->string('weight_note', 40)->nullable();             // mis. "Max - 3" (pengurang)
            $table->text('formula_text')->nullable();                  // definisi rumus indikator menurut kontrak manajemen
            $table->string('source_sheet', 80)->nullable();            // lembar sumber realisasi pada workbook acuan (pemetaan data)
            $table->string('scoring_rule', 24)->nullable();            // STANDARD | FLOOR_60 | RANGE_BAND | RATIO_DEFAULT_100 | FIXED | OTHER
            $table->string('nilai_rule', 24)->nullable();              // ITEM | SUM_CHILDREN | AVERAGE_TRUNC
            $table->jsonb('rules')->nullable();                        // rumus mentah (pencapaian, nilai) untuk audit dan validasi
            $table->unique(['set_id', 'code']);
            $table->index(['set_id', 'sort_order']);
        });
        Schema::table('kpi_definitions', function (Blueprint $table) {
            $table->foreign('parent_id')->references('id')->on('kpi_definitions')->cascadeOnDelete();
        });

        Schema::create('kpi_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('definition_id')->constrained('kpi_definitions')->cascadeOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');                                    // tanggal 1 bulan
            $table->decimal('target_value', 20, 6)->nullable();
            $table->string('target_text', 40)->nullable();             // target berbentuk rentang, mis. "95 - 105"
            $table->unique(['definition_id', 'organizational_unit_id', 'period']);
            $table->index(['organizational_unit_id', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_targets');
        Schema::dropIfExists('kpi_definitions');
        Schema::dropIfExists('kpi_definition_sets');
    }
};
