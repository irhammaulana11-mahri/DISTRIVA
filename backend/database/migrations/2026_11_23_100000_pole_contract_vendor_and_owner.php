<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Kontrak Rinci milik satu vendor tiang (WO Tiang mengikutinya) dan, opsional, satu UP3 pemilik: KR milik UP3 lain dapat dipakai sebagai limpahan dan ditandai.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pole_contracts', function (Blueprint $table) {
            $table->foreignUuid('vendor_company_id')->nullable()->constrained('vendor_companies')->restrictOnDelete();
            $table->foreignUuid('up3_unit_id')->nullable()->constrained('organizational_units')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('pole_contracts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('vendor_company_id');
            $table->dropConstrainedForeignId('up3_unit_id');
        });
    }
};
