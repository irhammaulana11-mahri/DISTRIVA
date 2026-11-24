<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Nilai sistem (otomatis) saat koreksi manual disimpan, sebagai bukti audit; data sumber tidak diubah. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kpi_manual_inputs', function (Blueprint $table) {
            $table->double('system_value')->nullable()->after('value');
        });
    }

    public function down(): void
    {
        Schema::table('kpi_manual_inputs', function (Blueprint $table) {
            $table->dropColumn('system_value');
        });
    }
};
