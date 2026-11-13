<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 9 (docs/62 §40; docs/10 "inventory tidak dibangun di DISTRIVA"): the material need of an ISSUED work order is handed to the existing material application, which stays the source of truth
// for stock, allocation, issue and return. No API contract exists yet, so the request is an OUTBOX: frozen payload + idempotency key + status + log, with an export file (JSON/CSV/XLSX) for the
// manual hand-over and a "marked as sent" step that records the external reference. DISTRIVA never changes stock.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('material_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('idempotency_key', 120)->unique();             // the WO number: the same WO is never sent twice
            $table->string('status', 12)->default('PENDING');             // PENDING | EXPORTED | SENT | CANCELLED | SUPERSEDED
            $table->jsonb('payload');                                     // frozen at issue: materials (KHS, SKUs, warehouse), poles (KR), WO and customers
            $table->string('payload_hash', 64);
            $table->boolean('needs_followup')->default(false);            // the WO was cancelled/superseded after the request had been SENT: the material application must be told
            $table->string('external_reference', 150)->nullable();
            $table->timestampTz('exported_at')->nullable();
            $table->foreignUuid('exported_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('sent_at')->nullable();
            $table->foreignUuid('sent_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('cancel_reason')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
        });

        Schema::create('material_request_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('material_request_id')->constrained('material_requests')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->timestampTz('occurred_at');
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE material_requests ADD CONSTRAINT material_requests_status_check CHECK (status IN ('PENDING','EXPORTED','SENT','CANCELLED','SUPERSEDED'))");
        DB::statement("ALTER TABLE material_request_events ADD CONSTRAINT material_request_events_type_check CHECK (event_type IN ('CREATED','EXPORTED','SENT','CANCELLED','SUPERSEDED','FOLLOWUP'))");
        DB::unprepared('CREATE TRIGGER trg_material_request_events_append_only BEFORE UPDATE OR DELETE ON material_request_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_material_request_events_no_truncate BEFORE TRUNCATE ON material_request_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_material_request()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Material requests cannot be deleted'; END IF;
                IF (NEW.payload, NEW.payload_hash, NEW.idempotency_key, NEW.work_order_id) IS DISTINCT FROM (OLD.payload, OLD.payload_hash, OLD.idempotency_key, OLD.work_order_id) THEN
                    RAISE EXCEPTION 'The frozen payload of a material request never changes';
                END IF;
                IF OLD.status IN ('CANCELLED','SUPERSEDED') THEN RAISE EXCEPTION 'A % material request is final', OLD.status; END IF;
                IF OLD.status = 'SENT' AND NEW.status NOT IN ('SENT') THEN RAISE EXCEPTION 'A sent material request cannot go back or be cancelled (follow it up instead)'; END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_material_requests_guard BEFORE UPDATE OR DELETE ON material_requests FOR EACH ROW EXECUTE FUNCTION distriva_guard_material_request()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_requests_guard ON material_requests');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_request_events_append_only ON material_request_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_request_events_no_truncate ON material_request_events');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_material_request()');
        }
        Schema::dropIfExists('material_request_events');
        Schema::dropIfExists('material_requests');
    }
};
