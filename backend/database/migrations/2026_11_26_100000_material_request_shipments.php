<?php

use App\Services\WorkOrders\MaterialOutbox;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// Staged hand-over of the material need (docs/62 §40, docs/82 §19.15): one outbox request per WO number, but each "Tandai Terkirim" records a SHIPMENT of exactly what was allocated and not yet sent.
// The need itself follows the latest approved MTO (the WO is not amended for a change of the PLN material); what has been sent is netted across WO versions through the application.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('material_requests', function (Blueprint $table) {
            $table->string('fulfilment', 8)->default('NONE');             // NONE | PARTIAL | COMPLETE — kept current by MaterialOutbox::refresh at every event that changes need, allocation or shipments
            $table->boolean('ready_to_send')->default(false);             // some allocated PLN material has not been sent yet
            $table->boolean('oversent')->default(false);                  // more was sent than the latest MTO needs: the material application must adjust
        });

        Schema::create('material_request_shipments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('material_request_id')->constrained('material_requests')->restrictOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->unsignedInteger('sequence');
            $table->string('reference', 150);                             // the reference of the material application for THIS shipment
            $table->foreignUuid('sent_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('sent_at');
            $table->unique(['material_request_id', 'sequence']);
            $table->index('application_id');
        });

        Schema::create('material_request_shipment_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shipment_id')->constrained('material_request_shipments')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->string('khs_code', 50);
            $table->string('khs_name', 255)->nullable();
            $table->string('unit_text', 30)->nullable();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->index(['shipment_id']);
            $table->index(['khs_item_id', 'warehouse_id']);
        });

        // Requests already SENT count as shipment 1: what had been allocated when they were issued.
        foreach (DB::table('material_requests')->where('status', 'SENT')->get() as $r) {
            $shipment = (string) Str::uuid();
            DB::table('material_request_shipments')->insert(['id' => $shipment, 'material_request_id' => $r->id, 'application_id' => $r->application_id, 'sequence' => 1,
                'reference' => $r->external_reference ?: 'tanpa referensi', 'sent_by' => $r->sent_by ?? $r->created_by, 'sent_at' => $r->sent_at ?? $r->updated_at]);
            foreach ((array) (json_decode((string) $r->payload, true)['materials'] ?? []) as $m) {
                $khs = DB::table('khs_items')->where('code', $m['khs_code'])->value('id');
                foreach ((array) ($m['allocation'] ?? []) as $a) {
                    $wh = DB::table('warehouses')->where('name', $a['warehouse'])->where('plant', $a['plant'])->where('stor_loc', $a['stor_loc'])->value('id');
                    if ($khs === null || $wh === null || (float) $a['quantity'] <= 0) {
                        continue;
                    }
                    DB::table('material_request_shipment_lines')->insert(['id' => (string) Str::uuid(), 'shipment_id' => $shipment, 'khs_item_id' => $khs, 'khs_code' => $m['khs_code'],
                        'khs_name' => $m['name'] ?? null, 'unit_text' => $m['unit'] ?? null, 'warehouse_id' => $wh, 'quantity' => $a['quantity']]);
                }
            }
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE material_requests ADD CONSTRAINT material_requests_fulfilment_check CHECK (fulfilment IN ('NONE','PARTIAL','COMPLETE'))");
            DB::statement('ALTER TABLE material_request_shipment_lines ADD CONSTRAINT material_request_shipment_lines_check CHECK (quantity > 0)');
            foreach (['material_request_shipments', 'material_request_shipment_lines'] as $t) {
                DB::unprepared("CREATE TRIGGER trg_{$t}_append_only BEFORE UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
                DB::unprepared("CREATE TRIGGER trg_{$t}_no_truncate BEFORE TRUNCATE ON {$t} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
            }
        }

        foreach (DB::table('material_requests')->whereIn('status', ['PENDING', 'EXPORTED', 'SENT'])->distinct()->pluck('application_id') as $applicationId) {
            MaterialOutbox::refresh($applicationId);
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['material_request_shipments', 'material_request_shipment_lines'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_append_only ON {$t}");
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_no_truncate ON {$t}");
            }
            DB::statement('ALTER TABLE material_requests DROP CONSTRAINT IF EXISTS material_requests_fulfilment_check');
        }
        Schema::dropIfExists('material_request_shipment_lines');
        Schema::dropIfExists('material_request_shipments');
        Schema::table('material_requests', fn (Blueprint $table) => $table->dropColumn(['fulfilment', 'ready_to_send', 'oversent']));
    }
};
