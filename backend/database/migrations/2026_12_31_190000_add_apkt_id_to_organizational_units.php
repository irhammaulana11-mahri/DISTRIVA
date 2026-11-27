<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Id unit pada APKT (docs/94 §9). UP3 memakai angka tersendiri; id ULP di APKT sama dengan kode unitnya sehingga tidak perlu diisi. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizational_units', function (Blueprint $table) {
            $table->unsignedInteger('apkt_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('organizational_units', function (Blueprint $table) {
            $table->dropColumn('apkt_id');
        });
    }
};
