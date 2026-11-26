<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Unggahan workbook definisi NKO yang menunggu persetujuan (docs/93 tahap 5). Berkas disimpan di disk dokumen; definisi baru dimuat hanya saat disetujui.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_definition_uploads', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedSmallInteger('year');
            $table->string('source_name', 200);
            $table->string('file_key', 200)->nullable();                  // kosong bila berkas sudah dihapus (ditolak atau dibatalkan)
            $table->jsonb('base_sets');                                    // id set aktif per tingkat saat pratinjau dibuat
            $table->jsonb('changes');                                      // pratinjau perubahan per tingkat
            $table->string('note', 500);
            $table->string('status', 12)->default('MENUNGGU');            // MENUNGGU | DISETUJUI | DITOLAK | DIBATALKAN
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('uploaded_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->timestampsTz();
            $table->index(['status', 'uploaded_at']);
        });
        DB::statement("create unique index kpi_definition_uploads_pending_unique on kpi_definition_uploads (year) where status = 'MENUNGGU'");
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_definition_uploads');
    }
};
