<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The units (ULP codes) a manual EIS sync was started for; null = every unit. Additive and idempotent. */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('eis_sync_runs') && ! Schema::hasColumn('eis_sync_runs', 'units')) {
            Schema::table('eis_sync_runs', function (Blueprint $table): void {
                $table->jsonb('units')->nullable();
            });
        }
    }

    public function down(): void
    {
        Schema::table('eis_sync_runs', function (Blueprint $table): void {
            $table->dropColumn('units');
        });
    }
};
