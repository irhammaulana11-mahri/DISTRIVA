<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Reservasi kolektif mengikuti alur MIMS (docs/95): satu reservasi memuat banyak agenda; total per material, nomor permohonan, realisasi per agenda (nomor seri, kabel, segel), lalu kirim SAP.
 * Rencana satuan yang sudah ada menjadi reservasi berisi satu agenda: RECORDED -> REQUESTED, SUBMITTED/APPROVED -> DRAFT (belum bernomor permohonan). Tidak dapat dikembalikan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sr_reservation_applications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr_reservation_id')->constrained('sr_reservations')->cascadeOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->unsignedInteger('power_va');
            $table->string('bom_group', 20);
            $table->foreignUuid('bom_header_id')->constrained('bom_headers')->restrictOnDelete();
            $table->jsonb('needs');                                               // khs_item_id => jumlah hitung untuk agenda ini
            $table->decimal('actual_cable_m', 10, 2)->nullable();
            $table->jsonb('seal_numbers')->default('[]');
            $table->timestampTz('released_at')->nullable();                      // dikeluarkan atau reservasinya dibatalkan
            $table->foreignUuid('released_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('release_reason', 1000)->nullable();
            $table->index('sr_reservation_id');
        });
        DB::statement('CREATE UNIQUE INDEX sr_reservation_applications_one_open ON sr_reservation_applications (application_id) WHERE released_at IS NULL');

        Schema::create('sr_reservation_serials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('sr_reservation_application_id')->constrained('sr_reservation_applications')->cascadeOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('serial_number', 60);
            $table->unique(['sr_reservation_application_id', 'khs_item_id', 'serial_number']);
            $table->index(['khs_item_id', 'serial_number']);
        });

        Schema::table('sr_reservations', function (Blueprint $table) {
            $table->foreignUuid('organizational_unit_id')->nullable()->constrained('organizational_units')->restrictOnDelete();
            $table->renameColumn('mims_recorded_by', 'requested_by');
            $table->renameColumn('mims_recorded_at', 'requested_at');
            $table->foreignUuid('sap_sent_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('sap_sent_at')->nullable();
            $table->string('sap_reference', 60)->nullable();
        });
        DB::statement('ALTER TABLE sr_reservations DROP CONSTRAINT sr_reservations_status_check');

        foreach (DB::table('sr_reservations')->orderBy('created_at')->get() as $r) {
            $needs = DB::table('sr_reservation_lines')->where('sr_reservation_id', $r->id)->pluck('quantity', 'khs_item_id')->map(fn ($q) => (float) $q)->all();
            $cancelled = $r->status === 'CANCELLED';
            DB::table('sr_reservation_applications')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $r->id, 'application_id' => $r->application_id, 'power_va' => $r->power_va, 'bom_group' => $r->bom_group,
                'bom_header_id' => $r->bom_header_id, 'needs' => json_encode((object) $needs), 'released_at' => $cancelled ? $r->cancelled_at : null, 'released_by' => $cancelled ? $r->cancelled_by : null, 'release_reason' => $cancelled ? $r->cancel_reason : null]);
            DB::table('sr_reservations')->where('id', $r->id)->update([
                'organizational_unit_id' => DB::table('applications')->where('id', $r->application_id)->value('organizational_unit_id'),
                'status' => match ($r->status) {
                    'RECORDED' => 'REQUESTED', 'CANCELLED' => 'CANCELLED', default => 'DRAFT'
                },
            ]);
        }

        Schema::table('sr_reservations', function (Blueprint $table) {
            $table->dropColumn(['application_id', 'version_number', 'power_va', 'bom_group', 'bom_header_id', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at']);   // indexes on them go with them
        });
        DB::statement('ALTER TABLE sr_reservations ALTER COLUMN organizational_unit_id SET NOT NULL');
        DB::statement("ALTER TABLE sr_reservations ADD CONSTRAINT sr_reservations_status_check CHECK (status IN ('DRAFT','REQUESTED','SAP_SENT','CANCELLED'))");
    }

    public function down(): void
    {
        throw new LogicException('Reservasi kolektif tidak dapat dikembalikan ke rencana satuan; pulihkan dari cadangan.');
    }
};
