<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// WO Tiang: pekerjaan pengiriman dan pemasangan tiang oleh vendor tiang (terpisah dari vendor jaringan), diminta lewat surat (nomor dari AMS) yang dapat memuat beberapa lokasi.
// Setiap baris menyalin satu baris tiang alokasi (nomor Kontrak Rinci, TM/TR, jumlah). Alur: DRAFT -> ISSUED (Perencanaan) -> IN_PROGRESS (progres vendor, diverifikasi Perencanaan)
// -> COMPLETED (penutupan BASTP tiang oleh Asman Perencanaan).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendor_companies', function (Blueprint $table) {
            $table->string('work_scope', 10)->default('KEDUANYA');          // JARINGAN | TIANG | KEDUANYA: jenis WO yang boleh diberikan ke vendor ini
        });

        Schema::create('pole_work_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('letter_number', 120)->unique();                 // nomor surat dari AMS internal
            $table->date('letter_date');
            $table->foreignUuid('up3_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->foreignUuid('vendor_company_id')->constrained('vendor_companies')->restrictOnDelete();
            $table->string('status', 12)->default('DRAFT');                 // DRAFT | ISSUED | IN_PROGRESS | COMPLETED | CANCELLED
            $table->text('notes')->nullable();
            $table->string('letter_key', 255)->nullable();                  // lampiran scan surat (opsional)
            $table->string('letter_name', 255)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('issued_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('issued_at')->nullable();
            $table->foreignUuid('completed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('completed_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->timestampsTz();
            $table->index(['up3_unit_id', 'status']);
        });

        Schema::create('pole_wo_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_work_order_id')->constrained('pole_work_orders')->restrictOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('allocation_id')->constrained('allocations')->restrictOnDelete();
            $table->foreignUuid('allocation_pole_line_id')->constrained('allocation_pole_lines')->restrictOnDelete();
            $table->foreignUuid('pole_contract_id')->constrained('pole_contracts')->restrictOnDelete();
            $table->string('pole_type', 2);                                 // TM | TR
            $table->foreignUuid('khs_item_id')->nullable()->constrained('khs_items')->restrictOnDelete();
            $table->unsignedInteger('quantity');
            $table->index('allocation_pole_line_id');
        });

        Schema::create('pole_wo_progress', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_work_order_id')->constrained('pole_work_orders')->restrictOnDelete();
            $table->foreignUuid('line_id')->constrained('pole_wo_lines')->restrictOnDelete();
            $table->string('submission_key', 80);                           // idempotency key chosen by the submitter
            $table->decimal('cumulative_percent', 5, 2);
            $table->date('work_date');                                      // tanggal laporan; pada 100 % = tanggal selesai
            $table->text('notes')->nullable();
            $table->string('status', 10)->default('SUBMITTED');             // SUBMITTED | VERIFIED | RETURNED
            $table->foreignUuid('submitted_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('submitted_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->text('return_reason')->nullable();
            $table->unique(['pole_work_order_id', 'submission_key']);
            $table->index(['line_id', 'status']);
        });

        Schema::create('pole_wo_bastp', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_work_order_id')->constrained('pole_work_orders')->restrictOnDelete();
            $table->string('bastp_number', 120)->unique();
            $table->date('bastp_date');
            $table->text('notes')->nullable();
            $table->string('status', 10)->default('SUBMITTED');             // SUBMITTED | CLOSED | RETURNED | CANCELLED
            $table->foreignUuid('prepared_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('prepared_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->text('return_reason')->nullable();
            $table->timestampsTz();
            $table->index(['pole_work_order_id', 'status']);
        });

        Schema::create('pole_wo_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_work_order_id')->constrained('pole_work_orders')->restrictOnDelete();
            $table->string('event_type', 24);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['pole_work_order_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        foreach (['pole_wo_events', 'pole_wo_bastp', 'pole_wo_progress', 'pole_wo_lines', 'pole_work_orders'] as $t) {
            Schema::dropIfExists($t);
        }
        Schema::table('vendor_companies', fn (Blueprint $table) => $table->dropColumn('work_scope'));
    }
};
