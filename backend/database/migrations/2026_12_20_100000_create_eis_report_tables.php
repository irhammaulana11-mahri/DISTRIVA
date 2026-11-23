<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Impor laporan bulanan EIS/AP2T (docs/88): satu berkas per jenis laporan, unit (ULP atau UP3), dan bulan. `eis_report_files` mencatat berkas (sidik jari isi, jenis, unit, periode, status);
 * `eis_report_lines` menyimpan baris data yang sudah dirapikan (label, kode, nilai bernama) sebagai lapisan normalisasi. Berkas yang diunggah ulang dengan isi berbeda untuk jenis, unit, dan bulan
 * yang sama menggantikan yang lama (status DIGANTIKAN, riwayat tetap); isi yang sama tidak diproses lagi. Data pribadi pelanggan pada daftar rinci tidak disimpan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eis_report_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('family', 24);                              // 309, 309EIS, DIFI, GGNALL, ...
            $table->string('unit_code', 12);
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');                                    // tanggal 1 bulan laporan
            $table->string('original_name', 200);
            $table->char('sha256', 64);
            $table->unsignedBigInteger('size_bytes');
            $table->string('status', 12)->default('AKTIF');            // AKTIF | DIGANTIKAN
            $table->jsonb('summary')->nullable();                      // nilai tunggal pada kepala laporan (mis. SAIDI/SAIFI DIFI)
            $table->unsignedInteger('line_count')->default(0);
            $table->jsonb('warnings')->nullable();
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('imported_at');
            $table->timestampsTz();
            $table->index(['family', 'period']);
            $table->index('sha256');
        });
        DB::statement("create unique index eis_report_files_active_unique on eis_report_files (family, organizational_unit_id, period) where status = 'AKTIF'");
        DB::statement("alter table eis_report_files add constraint eis_report_files_status_check check (status in ('AKTIF','DIGANTIKAN'))");

        Schema::create('eis_report_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('file_id')->constrained('eis_report_files')->cascadeOnDelete();
            $table->unsignedInteger('line_no');                        // nomor baris pada lembar asli
            $table->string('group_label', 160)->nullable();
            $table->string('label', 200)->nullable();
            $table->string('code', 40)->nullable();
            $table->jsonb('values');
            $table->index(['file_id', 'line_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('eis_report_lines');
        Schema::dropIfExists('eis_report_files');
    }
};
