<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sambungan tanpa perluasan (docs/95): kontrak pelaksana 1 phasa per ULP, rencana reservasi material dari BOM APP (tanpa paket MTO) beserta baris dan riwayatnya.
 * Satu permohonan hanya punya satu rencana yang belum dibatalkan; masa kontrak satu ULP tidak boleh tumpang tindih.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sr_vendor_contracts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->foreignUuid('vendor_company_id')->constrained('vendor_companies')->restrictOnDelete();
            $table->string('contract_number', 100);
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });
        DB::statement('ALTER TABLE sr_vendor_contracts ADD CONSTRAINT sr_vendor_contracts_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement('CREATE EXTENSION IF NOT EXISTS btree_gist');
        DB::statement("ALTER TABLE sr_vendor_contracts ADD CONSTRAINT sr_vendor_contracts_no_overlap EXCLUDE USING gist (organizational_unit_id WITH =, daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&)");

        Schema::create('sr_reservations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('status', 10)->default('DRAFT');                     // DRAFT | SUBMITTED | APPROVED | RECORDED (sudah di MIMS) | CANCELLED
            $table->unsignedSmallInteger('phase');                              // 1 | 3
            $table->unsignedInteger('power_va');
            $table->string('source_level', 3);                                  // ULP | UP3, mengikuti gudang sumber
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->foreignUuid('vendor_company_id')->constrained('vendor_companies')->restrictOnDelete();
            $table->foreignUuid('vendor_contract_id')->nullable()->constrained('sr_vendor_contracts')->restrictOnDelete();
            $table->decimal('sr_length_m', 8, 2);
            $table->string('bom_group', 20);
            $table->foreignUuid('bom_header_id')->constrained('bom_headers')->restrictOnDelete();
            $table->string('notes', 2000)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->string('mims_reservation_no', 30)->nullable();
            $table->string('mims_send_method', 10)->nullable();                 // MANUAL; API disiapkan untuk pengiriman otomatis
            $table->foreignUuid('mims_recorded_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('mims_recorded_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancel_reason', 1000)->nullable();
            $table->timestampsTz();
            $table->unique(['application_id', 'version_number']);
            $table->index(['status', 'warehouse_id']);
        });
        DB::statement("ALTER TABLE sr_reservations ADD CONSTRAINT sr_reservations_status_check CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','RECORDED','CANCELLED'))");
        DB::statement("CREATE UNIQUE INDEX sr_reservations_one_open ON sr_reservations (application_id) WHERE status <> 'CANCELLED'");

        Schema::create('sr_reservation_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr_reservation_id')->constrained('sr_reservations')->cascadeOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('quantity_bom', 14, 3);                             // hasil hitung (kabel SR = panjang SR)
            $table->decimal('quantity', 14, 3);                                 // yang direservasi
            $table->string('correction_reason', 500)->nullable();
            $table->unique(['sr_reservation_id', 'khs_item_id']);
        });
        DB::statement('ALTER TABLE sr_reservation_lines ADD CONSTRAINT sr_reservation_lines_quantity_check CHECK (quantity >= 0 AND quantity_bom >= 0)');

        Schema::create('sr_reservation_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr_reservation_id')->constrained('sr_reservations')->cascadeOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('reason', 1000)->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['sr_reservation_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sr_reservation_events');
        Schema::dropIfExists('sr_reservation_lines');
        Schema::dropIfExists('sr_reservations');
        Schema::dropIfExists('sr_vendor_contracts');
    }
};
