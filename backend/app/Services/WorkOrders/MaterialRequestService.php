<?php

namespace App\Services\WorkOrders;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Inventory\MaterialSupplier;
use App\Services\Proposals\ProposalService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Outbox of the material need of an ISSUED work order (docs/62 §40). Created in the same transaction as the issue; the payload is frozen (trigger). The existing material application remains
 * the source of truth for stock: this only records what was handed over (export file / reference) and never changes stock. PENDING -> EXPORTED -> SENT; CANCELLED when the WO is cancelled
 * or superseded before it was SENT (after SENT the request is flagged `needs_followup` instead: the material application must be told).
 */
class MaterialRequestService
{
    public function createForWorkOrder(string $woId, User $actor): string
    {
        $wo = DB::table('work_orders')->where('id', $woId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $payload = $this->payload($wo);
        $id = (string) Str::uuid();
        DB::table('material_requests')->insert(['id' => $id, 'work_order_id' => $woId, 'application_id' => $wo->application_id, 'idempotency_key' => $wo->wo_number, 'status' => 'PENDING', 'payload' => json_encode($payload),
            'payload_hash' => hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR)), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $this->event($id, 'CREATED', $actor, null);
        MaterialOutbox::refresh($wo->application_id);

        return $id;
    }

    /** Called when a WO is cancelled or replaced by a newer version. */
    public static function closeForWorkOrder(string $woId, User $actor, string $status, string $reason): void
    {
        foreach (DB::table('material_requests')->where('work_order_id', $woId)->whereIn('status', ['PENDING', 'EXPORTED', 'SENT'])->get() as $r) {
            if ($r->status === 'SENT') {
                DB::table('material_requests')->where('id', $r->id)->update(['needs_followup' => true, 'updated_at' => now()]);
                DB::table('material_request_events')->insert(['id' => (string) Str::uuid(), 'material_request_id' => $r->id, 'event_type' => 'FOLLOWUP', 'actor_user_id' => $actor->getKey(), 'reason' => $reason, 'occurred_at' => now()]);

                continue;
            }
            DB::table('material_requests')->where('id', $r->id)->update(['status' => $status, 'cancel_reason' => $reason, 'updated_at' => now()]);
            DB::table('material_request_events')->insert(['id' => (string) Str::uuid(), 'material_request_id' => $r->id, 'event_type' => $status === 'SUPERSEDED' ? 'SUPERSEDED' : 'CANCELLED', 'actor_user_id' => $actor->getKey(), 'reason' => $reason, 'occurred_at' => now()]);
        }
    }

    /** The export marks a PENDING request EXPORTED (first time only) and returns the flat lines of the file. @return list<array<string,mixed>> */
    /** What would be handed over now: the allocated, not yet sent PLN material (and the poles until the first shipment). Marks a PENDING request EXPORTED. */
    public function export(string $id, User $actor): array
    {
        return DB::transaction(function () use ($id, $actor): array {
            $r = $this->lock($id);
            if (in_array($r->status, ['CANCELLED', 'SUPERSEDED'], true)) {
                throw new AssignmentRuleViolation("Permintaan berstatus {$r->status}; tidak diekspor.");
            }
            $delta = MaterialOutbox::delta(MaterialOutbox::position($r->application_id));
            $shipments = DB::table('material_request_shipments')->where('material_request_id', $id)->count();
            $payload = (array) json_decode((string) $r->payload, true);
            $poles = $shipments === 0 ? (array) ($payload['poles'] ?? []) : [];
            if ($delta === [] && $poles === []) {
                throw new AssignmentRuleViolation('Belum ada material teralokasi yang siap diekspor.');
            }
            if ($r->status === 'PENDING') {
                DB::table('material_requests')->where('id', $id)->update(['status' => 'EXPORTED', 'exported_at' => now(), 'exported_by' => $actor->getKey(), 'updated_at' => now()]);
                $this->event($id, 'EXPORTED', $actor, null);
            }

            return $this->flatten($delta, $poles, (string) $r->idempotency_key, $shipments + 1);
        });
    }

    /**
     * Records one SHIPMENT: the allocated PLN material that has not been sent yet, under the reference of the material application. May be repeated for the same WO number as more material is
     * allocated; each shipment keeps its own reference, time and content.
     *
     * @return array{sequence:int,lines:int,quantity:float}
     */
    public function markSent(string $id, string $reference, User $actor): array
    {
        return DB::transaction(function () use ($id, $reference, $actor): array {
            $r = $this->lock($id);
            if (! in_array($r->status, ['PENDING', 'EXPORTED', 'SENT'], true)) {
                throw new AssignmentRuleViolation("Permintaan berstatus {$r->status} tidak dapat ditandai diserahkan.");
            }
            $delta = MaterialOutbox::delta(MaterialOutbox::position($r->application_id));
            if ($delta === []) {
                throw new AssignmentRuleViolation('Belum ada material teralokasi yang belum diserahkan.');
            }
            $sequence = ((int) DB::table('material_request_shipments')->where('material_request_id', $id)->max('sequence')) + 1;
            $shipment = (string) Str::uuid();
            DB::table('material_request_shipments')->insert(['id' => $shipment, 'material_request_id' => $id, 'application_id' => $r->application_id, 'sequence' => $sequence, 'reference' => trim($reference), 'sent_by' => $actor->getKey(), 'sent_at' => now()]);
            foreach ($delta as $l) {
                DB::table('material_request_shipment_lines')->insert(['id' => (string) Str::uuid(), 'shipment_id' => $shipment, 'khs_item_id' => $l['khs_item_id'], 'khs_code' => $l['khs_code'], 'khs_name' => $l['name'], 'unit_text' => $l['unit'],
                    'warehouse_id' => $l['warehouse_id'], 'quantity' => $l['quantity']]);
            }
            DB::table('material_requests')->where('id', $id)->update(['status' => 'SENT', 'sent_at' => now(), 'sent_by' => $actor->getKey(), 'external_reference' => trim($reference), 'updated_at' => now()]);
            $this->event($id, 'SENT', $actor, "Penyerahan ke-{$sequence}: ".trim($reference));
            MaterialOutbox::refresh($r->application_id);

            return ['sequence' => $sequence, 'lines' => count($delta), 'quantity' => (float) array_sum(array_column($delta, 'quantity'))];
        });
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $r = $this->lock($id);
            if (! in_array($r->status, ['PENDING', 'EXPORTED'], true)) {
                throw new AssignmentRuleViolation("Permintaan berstatus {$r->status} tidak dapat dibatalkan.");
            }
            DB::table('material_requests')->where('id', $id)->update(['status' => 'CANCELLED', 'cancel_reason' => trim($reason), 'updated_at' => now()]);
            $this->event($id, 'CANCELLED', $actor, $reason);
        });
    }

    /**
     * The rows of an export / shipment file: one per material and warehouse of the delta, plus the poles when given.
     *
     * @param  list<array<string,mixed>>  $delta
     * @param  list<array<string,mixed>>  $poles
     * @return list<array<string,mixed>>
     */
    public function flatten(array $delta, array $poles, string $key, int $shipmentNumber): array
    {
        $rows = [];
        foreach ($delta as $l) {
            $rows[] = ['wo_number' => $key, 'jenis' => 'MATERIAL', 'kode_khs' => $l['khs_code'], 'uraian' => $l['name'], 'satuan' => $l['unit'], 'jumlah_kebutuhan' => $l['need'], 'no_material_erp' => implode(';', (array) $l['skus']),
                'plant' => $l['plant'], 'storage_location' => $l['stor_loc'], 'gudang' => $l['warehouse'], 'jumlah_alokasi' => $l['quantity'], 'nomor_kr' => null, 'jenis_tiang' => null, 'penyedia' => 'PLN', 'penyerahan_ke' => $shipmentNumber];
        }
        foreach ($poles as $po) {
            $rows[] = ['wo_number' => $key, 'jenis' => 'TIANG', 'kode_khs' => null, 'uraian' => 'Tiang beton '.$po['pole_type'], 'satuan' => 'BTG', 'jumlah_kebutuhan' => $po['quantity'], 'no_material_erp' => null, 'plant' => null, 'storage_location' => null, 'gudang' => null,
                'jumlah_alokasi' => $po['quantity'], 'nomor_kr' => $po['kr_number'], 'jenis_tiang' => $po['pole_type'], 'penyedia' => null, 'penyerahan_ke' => $shipmentNumber];
        }

        return $rows;
    }

    /** @return array<string,mixed> */
    private function payload(object $wo): array
    {
        $names = fn ($ids) => DB::table('khs_items as k')->whereIn('k.id', $ids)->selectRaw('k.id, k.code, (select v.name from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as name, (select v.unit_text from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as unit')->get()->keyBy('id');
        $mats = DB::table('wo_materials')->where('work_order_id', $wo->id)->get();
        $khs = $names($mats->pluck('khs_item_id'));
        $supplier = MaterialSupplier::of((string) $wo->mto_package_id, $mats->pluck('khs_item_id')->all());
        $skus = DB::table('khs_material_map')->whereIn('khs_item_id', $mats->pluck('khs_item_id'))->orderBy('material_no')->get()->groupBy('khs_item_id');
        // The base allocation and its top-ups together.
        $allocs = DB::table('allocations')->where('application_id', $wo->application_id)->where('status', '<>', 'CANCELLED')->get();
        $matIds = $allocs->whereNotNull('materials_confirmed_at')->pluck('id')->all();
        $poleIds = $allocs->whereNotNull('poles_confirmed_at')->pluck('id')->all();
        $byKhs = $matIds === [] ? collect() : DB::table('allocation_lines as l')->join('warehouses as w', 'w.id', '=', 'l.warehouse_id')->whereIn('l.allocation_id', $matIds)->get(['l.khs_item_id', 'l.quantity', 'w.code', 'w.name', 'w.plant', 'w.stor_loc'])->groupBy('khs_item_id');
        $poles = $poleIds === [] ? collect() : DB::table('allocation_pole_lines as l')->join('pole_contracts as c', 'c.id', '=', 'l.pole_contract_id')->whereIn('l.allocation_id', $poleIds)->orderBy('c.kr_number')->get(['c.kr_number', 'l.pole_type', 'l.quantity']);
        $app = DB::table('applications')->where('id', $wo->application_id)->first();
        $members = ProposalService::scopeOf($wo->application_id);

        return ['work_order' => ['wo_number' => $wo->wo_number, 'version' => (int) $wo->version_number], 'application_number' => $app->application_number,
            'customers' => DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->whereIn('a.id', $members)->orderBy('a.application_number')->get(['a.application_number', 'c.name'])->map(fn ($c) => (array) $c)->all(),
            'materials' => $mats->map(fn ($m) => ['khs_code' => (string) $khs[$m->khs_item_id]->code, 'name' => $khs[$m->khs_item_id]->name, 'unit' => $khs[$m->khs_item_id]->unit, 'quantity' => (float) $m->quantity, 'supplier' => $supplier[$m->khs_item_id] ?? null,
                'skus' => ($skus[$m->khs_item_id] ?? collect())->pluck('material_no')->all(),
                'allocation' => ($byKhs[$m->khs_item_id] ?? collect())->map(fn ($a) => ['warehouse' => $a->name, 'plant' => $a->plant, 'stor_loc' => $a->stor_loc, 'quantity' => (float) $a->quantity])->values()->all()])->sortBy(fn ($m) => (int) $m['khs_code'])->values()->all(),
            'poles' => $poles->map(fn ($p) => ['kr_number' => $p->kr_number, 'pole_type' => $p->pole_type, 'quantity' => (int) $p->quantity])->all()];
    }

    private function lock(string $id): object
    {
        return DB::table('material_requests')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function event(string $id, string $type, User $actor, ?string $reason): void
    {
        DB::table('material_request_events')->insert(['id' => (string) Str::uuid(), 'material_request_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason), 'occurred_at' => now()]);
    }
}
