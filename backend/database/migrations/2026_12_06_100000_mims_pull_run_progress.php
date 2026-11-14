<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Progress of a MIMS pull run: where it is now (warehouse and step) and when it really started. Additive only. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mims_pull_runs', function (Blueprint $table) {
            $table->string('current_warehouse', 200)->nullable();
            $table->string('current_step', 20)->nullable();            // STOCK | ISSUES | RESERVATIONS | RECEIPTS
            $table->timestampTz('started_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('mims_pull_runs', function (Blueprint $table) {
            $table->dropColumn(['current_warehouse', 'current_step', 'started_at']);
        });
    }
};
