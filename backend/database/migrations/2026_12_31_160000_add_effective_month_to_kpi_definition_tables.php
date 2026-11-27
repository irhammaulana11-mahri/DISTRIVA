<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Bulan mulai berlaku versi definisi NKO (docs/93 §14). Bawaan Januari, sama dengan perilaku sebelumnya. */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['kpi_definition_sets', 'kpi_definition_uploads'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->unsignedSmallInteger('effective_month')->default(1);
            });
        }
    }

    public function down(): void
    {
        foreach (['kpi_definition_sets', 'kpi_definition_uploads'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropColumn('effective_month');
            });
        }
    }
};
