<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 2026_11_29_100000_eis_sync_settings_and_runs gained `mfa_verified_at` after it had already been applied on some databases, so their eis_sync_runs table lacks it and starting a sync fails.
 * This adds the column only where the table exists and it is missing (additive, idempotent).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('eis_sync_runs') && ! Schema::hasColumn('eis_sync_runs', 'mfa_verified_at')) {      // a fresh database creates the table (with the column) in a later migration
            Schema::table('eis_sync_runs', function (Blueprint $table): void {
                $table->timestampTz('mfa_verified_at')->nullable();      // the MFA state of whoever started it: the run's token carries it (SYS_ADMIN writes need it)
            });
        }
    }

    public function down(): void
    {
        // Left in place: the original migration also defines this column.
    }
};
