<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Usulan perubahan aturan realisasi NKO dengan persetujuan berjenjang (docs/93 tahap 4): PERENCANAAN mengusulkan, ASMAN_PERENCANAAN menyetujui; aturan baru berlaku hanya setelah disetujui.
 * Aturan mendapat `mode` dan `replaces_code` (kode indikator lama yang digantikan); snapshot menyimpan rumus yang dipakai tiap nilai sistem.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->string('mode', 24)->default('SISTEM_BOLEH_KOREKSI');   // SISTEM | SISTEM_BOLEH_KOREKSI | MANUAL
            $table->string('replaces_code', 80)->nullable();
            $table->string('formula', 500)->nullable()->change();          // kosong untuk MANUAL
        });

        Schema::create('kpi_rule_proposals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('definition_code', 80);
            $table->string('mode', 24);
            $table->string('formula', 500)->nullable();
            $table->jsonb('inputs')->nullable();
            $table->boolean('is_validated')->default(false);
            $table->boolean('flag_when_negative')->default(false);
            $table->date('effective_from');
            $table->string('replaces_code', 80)->nullable();
            $table->string('reason', 500);
            $table->string('status', 12)->default('MENUNGGU');            // MENUNGGU | DISETUJUI | DITOLAK | DIBATALKAN
            $table->foreignUuid('proposed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('proposed_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->timestampsTz();
            $table->index(['status', 'proposed_at']);
        });
        DB::statement("create unique index kpi_rule_proposals_pending_unique on kpi_rule_proposals (definition_code, effective_from) where status = 'MENUNGGU'");

        Schema::table('kpi_snapshot_values', function (Blueprint $table) {
            $table->string('rule_formula', 500)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('kpi_snapshot_values', function (Blueprint $table) {
            $table->dropColumn('rule_formula');
        });
        Schema::dropIfExists('kpi_rule_proposals');
        DB::table('kpi_realization_rules')->whereNull('formula')->delete();
        Schema::table('kpi_realization_rules', function (Blueprint $table) {
            $table->dropColumn(['mode', 'replaces_code']);
            $table->string('formula', 500)->nullable(false)->change();
        });
    }
};
