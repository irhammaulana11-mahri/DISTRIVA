<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Response time (RPT) dan recovery time (RCT) WO gangguan per ULP per bulan dari APKT (monalisaJumlahDurasiRptRctGangguan), dengan dan tanpa clear temper.
 * Total dan jumlah disimpan apa adanya supaya dapat dijumlahkan antar-ULP dan antar-bulan (rata-rata tertimbang jumlah WO).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('apkt_rpt_rct_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->boolean('clear_temper');
            $table->decimal('rpt_total', 20, 4)->default(0);
            $table->unsignedInteger('rpt_count')->default(0);
            $table->decimal('rct_total', 20, 4)->default(0);
            $table->unsignedInteger('rct_count')->default(0);
            $table->foreignUuid('sync_run_id')->nullable()->constrained('eis_sync_runs')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['organizational_unit_id', 'period', 'clear_temper']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('apkt_rpt_rct_records');
    }
};
