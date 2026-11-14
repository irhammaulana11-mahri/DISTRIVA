<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Read-only mirror of the MIMS material reservations (getDataReservasiHeader): reserved, not necessarily issued yet. Customers are tied to applications by agenda number. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mims_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('reservation_no', 30);
            $table->date('reserved_on')->nullable()->index();
            $table->string('status', 60)->nullable();
            $table->string('sap_reservation', 30)->nullable();
            $table->string('work_type_name', 100)->nullable();
            $table->string('text', 255)->nullable();
            $table->timestampTz('fetched_at');
            $table->unique(['warehouse_id', 'reservation_no']);
        });
        Schema::create('mims_reservation_customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('reservation_no', 30)->index();
            $table->string('agenda_no', 40);
            $table->foreignUuid('application_id')->nullable()->constrained('applications')->nullOnDelete();
            $table->unique(['reservation_no', 'agenda_no']);
        });
        Schema::create('mims_reservation_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('status', 10);
            $table->string('message', 1000)->nullable();
            $table->unsignedInteger('documents_new')->default(0);
            $table->unsignedInteger('matched')->default(0);
            $table->foreignUuid('triggered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mims_reservation_sync_runs');
        Schema::dropIfExists('mims_reservation_customers');
        Schema::dropIfExists('mims_reservations');
    }
};
