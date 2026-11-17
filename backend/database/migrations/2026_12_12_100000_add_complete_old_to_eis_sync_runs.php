<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Whether a run also pulls the older range for applications still running in DISTRIVA ("lengkapi", at most 180 days before the range). Chosen by the user on a manual run; the scheduled run never does. Additive and idempotent. */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('eis_sync_runs') && ! Schema::hasColumn('eis_sync_runs', 'complete_old')) {
            Schema::table('eis_sync_runs', function (Blueprint $table): void {
                $table->boolean('complete_old')->default(false);
            });
        }
    }

    public function down(): void
    {
        Schema::table('eis_sync_runs', function (Blueprint $table): void {
            $table->dropColumn('complete_old');
        });
    }
};
