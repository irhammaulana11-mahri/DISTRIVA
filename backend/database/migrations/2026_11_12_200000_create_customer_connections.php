<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Master pelanggan (owner 2026-11-12): one row per IDPEL (a supply connection), linked to its ULP, to a gardu (and through it to the feeder), and when known to the applicant `customers` row.
 * Source: the DIL (daftar induk langganan) loaded in batches by IDPEL (upsert), and the KKO of an application. Personal data is NOT kept: the DIL is masked at the source and NIK, NPWP, phone, e-mail and coordinates
 * are never imported; `name` holds what the source gives (masked) unless the applicant is linked. gardu_ref is the DIL's gardu number (= the GADIS number of the gardu master) so a customer can be linked when its gardu arrives later.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_connections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('idpel', 12)->unique();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->foreignUuid('substation_id')->nullable()->constrained('substations')->restrictOnDelete();
            $table->string('gardu_ref', 40)->nullable();
            $table->string('link_source', 12)->nullable();                         // DIL | KKO | MANUAL (a MANUAL link is never replaced by a later load)
            $table->string('name', 200)->nullable();
            $table->string('kelurahan', 100)->nullable();
            $table->string('kecamatan', 100)->nullable();
            $table->string('kabupaten', 100)->nullable();
            $table->string('tariff_code', 10)->nullable();
            $table->decimal('power_va', 14, 2)->nullable();
            $table->string('service_type', 12)->nullable();                        // PASKABAYAR | PRABAYAR
            $table->string('phase_code', 2)->nullable();
            $table->string('meter_number', 30)->nullable();
            $table->date('energized_on')->nullable();
            $table->string('status', 10)->default('AKTIF');                        // AKTIF | BONGKAR | HAPUS | PROSES (an application not yet connected)
            $table->string('source', 12);                                          // DIL | APPLICATION
            $table->string('snapshot_month', 6)->nullable();                       // yyyymm of the DIL
            $table->uuid('last_batch_id')->nullable();
            $table->timestampsTz();
            $table->index(['organizational_unit_id', 'status']);
            $table->index('substation_id');
            $table->index('gardu_ref');
            $table->index('customer_id');
        });
        DB::statement("ALTER TABLE customer_connections ADD CONSTRAINT customer_connections_check CHECK (status IN ('AKTIF','BONGKAR','HAPUS','PROSES') AND (power_va IS NULL OR power_va > 0) AND idpel ~ '^[0-9]{12}$')");

        Schema::create('customer_connection_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source', 12)->default('DIL');
            $table->string('file_name', 255)->nullable();
            $table->string('snapshot_month', 6)->nullable();
            $table->string('status', 10)->default('RUNNING');                      // RUNNING | COMPLETED
            $table->jsonb('counts')->nullable();
            $table->foreignUuid('initiated_by')->constrained('users');
            $table->timestampTz('completed_at')->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_connection_batches');
        Schema::dropIfExists('customer_connections');
    }
};
