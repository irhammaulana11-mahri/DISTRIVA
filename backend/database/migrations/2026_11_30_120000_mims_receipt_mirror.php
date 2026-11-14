<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Read-only mirror of the material receipts (penerimaan) of a warehouse in MIMS: a delivery from another storage location and its receipt (docs/82 §19.15). History only; stock comes from the stock pull. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mims_receipt_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('delivery_document', 30)->unique();           // `material_document` of the delivery (pengiriman); the key of the detail call
            $table->string('receipt_document', 30)->nullable();          // `material_document_penerimaan`, set once received
            $table->string('request_document', 30)->nullable();
            $table->string('origin_stor_loc', 10)->nullable();
            $table->string('origin_name', 100)->nullable();
            $table->string('status', 20);                                // `status_penerimaan`, e.g. DITERIMA
            $table->date('delivered_on')->index();
            $table->date('received_on')->nullable()->index();
            $table->string('sap_document', 30)->nullable();
            $table->timestampTz('fetched_at');
        });
        Schema::create('mims_receipt_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('delivery_document', 30)->index();
            $table->string('material_no', 30)->index();                  // normalized: leading zeros removed
            $table->string('material_name', 255)->nullable();
            $table->decimal('quantity_sent', 18, 3);
            $table->decimal('quantity_received', 18, 3);
            $table->string('unit', 30)->nullable();
        });
        Schema::create('mims_receipt_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('status', 10);
            $table->string('message', 1000)->nullable();
            $table->unsignedInteger('documents_new')->default(0);
            $table->unsignedInteger('lines')->default(0);
            $table->foreignUuid('triggered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
        });
    }

    public function down(): void
    {
        foreach (['mims_receipt_sync_runs', 'mims_receipt_lines', 'mims_receipt_documents'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
