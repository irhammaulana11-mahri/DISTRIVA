<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Service duration in working days (EIS DURASI_HARI_KERJA), owner 2026-11-14: kept on the application (it was only in the external status history, never shown) and refreshed by every EIS import of an existing
 * application, because the figure grows while the status stays the same. service_days_observed_at says how fresh it is.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('applications', function (Blueprint $table) {
            $table->unsignedSmallInteger('service_days')->nullable();
            $table->timestampTz('service_days_observed_at')->nullable();
        });
        DB::statement('UPDATE applications a SET service_days = h.service_days, service_days_observed_at = coalesce(h.observed_at, h.received_at)
            FROM (SELECT DISTINCT ON (application_id) application_id, service_days, observed_at, received_at FROM application_external_status_histories WHERE service_days IS NOT NULL
                  ORDER BY application_id, coalesce(observed_at, received_at) DESC, received_at DESC) h WHERE h.application_id = a.id');
    }

    public function down(): void
    {
        Schema::table('applications', function (Blueprint $table) {
            $table->dropColumn(['service_days', 'service_days_observed_at']);
        });
    }
};
