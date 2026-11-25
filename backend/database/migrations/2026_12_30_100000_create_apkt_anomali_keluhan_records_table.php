<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Anomali penanganan pengaduan keluhan per ULP per bulan dari APKT (anomaliLaporanPenangananPengaduanKeluhanUnitBerulang dan ...UnitRatingNegatif).
 * Jumlah WO menurut kanal dan jumlah anomali menurut kanal; persentase dihitung saat dibaca.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('apkt_anomali_keluhan_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->string('jenis', 10);
            foreach (['wo_cc123', 'wo_pln_mobile', 'wo_loket', 'wo_lainnya', 'wo_total', 'anomali_pln_mobile', 'anomali_cc123', 'total_anomali'] as $column) {
                $table->unsignedInteger($column)->default(0);
            }
            $table->foreignUuid('sync_run_id')->nullable()->constrained('eis_sync_runs')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['organizational_unit_id', 'period', 'jenis']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('apkt_anomali_keluhan_records');
    }
};
