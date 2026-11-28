<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 1 phasa langsung pasang tanpa survei (docs/95): temuan lapangan "perlu perluasan" saat penyambungan, dan indeks pencocokan agenda dengan cermin reservasi/pengeluaran MIMS.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sr_extension_findings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('reason', 1000);
            $table->decimal('distance_m', 10, 2)->nullable();
            $table->foreignUuid('reported_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('reported_at');
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();    // salah tandai: dibatalkan, riwayatnya tetap ada
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancel_reason', 1000)->nullable();
        });
        DB::statement('CREATE UNIQUE INDEX sr_extension_findings_one_active ON sr_extension_findings (application_id) WHERE cancelled_at IS NULL');
        Schema::table('mims_reservation_customers', function (Blueprint $table) {
            $table->index('agenda_no', 'mims_reservation_customers_agenda_idx');
            $table->index('application_id', 'mims_reservation_customers_application_idx');
        });
        Schema::table('mims_issue_customers', fn (Blueprint $table) => $table->index('agenda_no', 'mims_issue_customers_agenda_idx'));
    }

    public function down(): void
    {
        Schema::table('mims_issue_customers', fn (Blueprint $table) => $table->dropIndex('mims_issue_customers_agenda_idx'));
        Schema::table('mims_reservation_customers', function (Blueprint $table) {
            $table->dropIndex('mims_reservation_customers_agenda_idx');
            $table->dropIndex('mims_reservation_customers_application_idx');
        });
        Schema::dropIfExists('sr_extension_findings');
    }
};
