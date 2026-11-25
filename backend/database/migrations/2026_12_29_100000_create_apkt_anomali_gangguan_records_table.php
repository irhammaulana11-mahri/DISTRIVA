<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Anomali penanganan pengaduan gangguan per ULP per bulan dari APKT (anomaliPenangananPengaduanGangguanUnitBerulang dan ...UnitRatingNegatif).
 * Jumlah WO menurut kanal dan jumlah anomali menurut kanal dan penandaan (marking); persentase dihitung saat dibaca.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('apkt_anomali_gangguan_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->string('jenis', 10);
            foreach (['wo_cc123', 'wo_pln_mobile', 'wo_loket', 'wo_lainnya', 'wo_total', 'anomali_pln_mobile_marking', 'anomali_pln_mobile_non_marking', 'anomali_cc123_marking', 'anomali_cc123_non_marking', 'total_anomali_marking', 'total_anomali_non_marking'] as $column) {
                $table->unsignedInteger($column)->default(0);
            }
            $table->foreignUuid('sync_run_id')->nullable()->constrained('eis_sync_runs')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['organizational_unit_id', 'period', 'jenis']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('apkt_anomali_gangguan_records');
    }
};
