<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Masukan bulanan pengusahaan (docs/91): kWh beli, E-Min, dan PSSD per ULP per bulan (nilai bulan itu, bukan kumulatif).
 * Sumber susut pada analisa pengusahaan dan, bila masukan kumulatif NKO tidak diisi, pada realisasi susut NKO.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_monthly_inputs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->date('period');
            $table->string('code', 40);
            $table->decimal('value', 24, 4);
            $table->string('note', 300)->nullable();
            $table->foreignUuid('entered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['organizational_unit_id', 'period', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_monthly_inputs');
    }
};
