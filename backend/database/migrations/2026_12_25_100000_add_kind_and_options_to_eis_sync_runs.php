<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A run is either the application pull (PERMOHONAN, as before) or the monthly receivable reports (PIUTANG: months, reports and units in `options`). Additive and idempotent. */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('eis_sync_runs') && ! Schema::hasColumn('eis_sync_runs', 'kind')) {
            Schema::table('eis_sync_runs', function (Blueprint $table): void {
                $table->string('kind', 12)->default('PERMOHONAN');
                $table->jsonb('options')->nullable();
            });
        }
    }

    public function down(): void
    {
        Schema::table('eis_sync_runs', function (Blueprint $table): void {
            $table->dropColumn(['kind', 'options']);
        });
    }
};
