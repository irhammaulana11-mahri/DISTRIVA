<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Read-only mirror of the material issues (pengeluaran) recorded in MIMS: header per material document, lines per reservation, customers per reservation (docs/82 §19.15). DISTRIVA never writes to MIMS. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mims_issue_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('material_document', 30)->unique();
            $table->string('reservation_no', 30)->index();              // `no_pemesanan`: the key that ties header, lines and customers together (and the TUG 7 reference)
            $table->string('sap_document', 30)->nullable();
            $table->string('sap_reservation', 30)->nullable();
            $table->date('issued_on')->index();
            $table->string('work_type_code', 10)->nullable();
            $table->string('work_type_name', 100)->nullable();
            $table->string('id_pel', 30)->nullable();
            $table->string('wbs', 60)->nullable();
            $table->string('text', 255)->nullable();
            $table->string('origin', 30)->nullable();                   // `asal_wo`, e.g. AP2T
            $table->timestampTz('fetched_at');
        });
        Schema::create('mims_issue_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('reservation_no', 30)->index();
            $table->string('material_no', 30)->index();                 // normalized: leading zeros removed (as khs_material_map)
            $table->string('material_name', 255)->nullable();
            $table->decimal('quantity', 18, 3);
            $table->string('unit', 30)->nullable();
        });
        Schema::create('mims_issue_customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('reservation_no', 30)->index();
            $table->string('agenda_no', 40);
            $table->string('id_pel', 30)->nullable();
            $table->unsignedInteger('power_va')->nullable();
            $table->date('paid_on')->nullable();
            $table->foreignUuid('application_id')->nullable()->constrained('applications')->nullOnDelete();   // matched on the agenda number
            $table->unique(['reservation_no', 'agenda_no']);
        });
        Schema::create('mims_issue_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('status', 10);                               // OK | FAILED | SKIPPED
            $table->string('message', 1000)->nullable();
            $table->unsignedInteger('documents_new')->default(0);
            $table->unsignedInteger('lines')->default(0);
            $table->unsignedInteger('matched')->default(0);             // customers tied to a DISTRIVA application
            $table->foreignUuid('triggered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
        });
    }

    public function down(): void
    {
        foreach (['mims_issue_sync_runs', 'mims_issue_customers', 'mims_issue_lines', 'mims_issue_documents'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
