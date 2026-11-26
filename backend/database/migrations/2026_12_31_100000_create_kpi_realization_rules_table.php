<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Aturan realisasi NKO (docs/93 tahap 1): indikator mana mengambil nilai dari sumber sistem mana, berlaku sejak kapan, dan apakah sudah cocok dengan workbook.
 * Isi awal sama dengan pemetaan yang sebelumnya tertanam di NkoRealizationResolver, sehingga hasil perhitungan tidak berubah.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kpi_realization_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('definition_code', 80);                     // kode indikator (kpi_definitions.code)
            $table->string('source_key', 40);                          // kunci sumber pada NkoSourceCatalog
            $table->boolean('is_validated')->default(false);           // sudah cocok dengan angka workbook
            $table->boolean('flag_when_negative')->default(false);     // nilai minus ditandai "NEGATIF"
            $table->date('effective_from')->default('2000-01-01');     // berlaku mulai periode ini
            $table->timestampsTz();
            $table->unique(['definition_code', 'effective_from']);
        });

        $rules = [
            ['saidi', 'saidi_menit', true, false],
            ['saifi', 'saifi_kali', true, false],
            ['ens', 'ens_mwh', true, false],
            ['penambahan-pelanggan', 'pelanggan_309', true, false],
            ['daya-tersambung', 'daya_309', true, false],
            ['gangguan-tm', 'gangguan_penyulang', false, false],
            ['response-time-atas-gangguan-diluar-clear-tamper', 'response_ggnall', false, false],
            ['feedback-rating-negatif-pada-pln-mobile-gangguan', 'rating_negatif_ggn', false, false],
            ['susut-distribusi-tanpa-e-min', 'susut_hitung', false, false],
            ['penjualan-tenaga-listrik', 'penjualan_selisih', true, true],
            ['pendapatan-biaya-penyambungan', 'hpl_bp', false, false],
            ['pencapaian-pelunasan-prr-ex-prr-dan-piutang-prabayar', 'pelunasan_prabayar', false, false],
        ];
        DB::table('kpi_realization_rules')->insert(array_map(fn (array $r) => [
            'id' => (string) Str::uuid7(), 'definition_code' => $r[0], 'source_key' => $r[1], 'is_validated' => $r[2], 'flag_when_negative' => $r[3],
            'effective_from' => '2000-01-01', 'created_at' => now(), 'updated_at' => now(),
        ], $rules));
    }

    public function down(): void
    {
        Schema::dropIfExists('kpi_realization_rules');
    }
};
