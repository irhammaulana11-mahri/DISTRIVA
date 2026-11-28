<?php

namespace App\Services\WorkOrders;

use App\Services\Inventory\MaterialSupplier;
use App\Services\Inventory\SrReservationService;
use Illuminate\Support\Facades\DB;

/**
 * The position of the PLN material of an application against the outbox (docs/62 §40, docs/82 §19.15), computed live:
 *   need      = the latest approved MTO (a change of PLN material does not amend the WO),
 *   allocated = the confirmed material allocations (base + top-ups),
 *   shipped   = what was recorded as sent, summed over every WO version of the application,
 *   ready     = min(need, allocated) - shipped, taken from the warehouses that hold the allocation.
 * Vendor-supplied material and poles are not part of it. DISTRIVA never changes stock.
 */
class MaterialOutbox
{
    private const EPS = 1e-6;

    /**
     * @return array{package_id:?string,materials:list<array<string,mixed>>,vendor_count:int,fulfilment:string,ready_to_send:bool,oversent:bool}
     */
    public static function position(string $applicationId): array
    {
        $pkg = DB::table('mto_packages')->where('application_id', $applicationId)->where('status', 'APPROVED')->orderByDesc('created_at')->first();
        $need = collect();
        $vendorCount = 0;
        if ($pkg !== null) {
            $all = DB::table('mto_lines')->where('package_id', $pkg->id)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")
                ->selectRaw('khs_item_id, min(khs_code) as khs_code, min(khs_name) as khs_name, min(unit_text) as unit_text, sum(material) as q')->groupBy('khs_item_id')->get()->keyBy('khs_item_id');
            $supplier = MaterialSupplier::of($pkg->id, $all->keys()->all());
            $vendorCount = $all->filter(fn ($n, $id) => ($supplier[$id] ?? null) === 'VENDOR')->count();
            $need = $all->reject(fn ($n, $id) => ($supplier[$id] ?? null) === 'VENDOR');
        }

        $allocationIds = DB::table('allocations')->where('application_id', $applicationId)->where('status', '<>', 'CANCELLED')->whereNotNull('materials_confirmed_at')->pluck('id');
        $allocated = DB::table('allocation_lines as l')->join('warehouses as w', 'w.id', '=', 'l.warehouse_id')->whereIn('l.allocation_id', $allocationIds)
            ->selectRaw('l.khs_item_id, l.warehouse_id, min(w.name) as wname, min(w.plant) as plant, min(w.stor_loc) as stor_loc, sum(l.quantity) as q')->groupBy('l.khs_item_id', 'l.warehouse_id')->get()->groupBy('khs_item_id');
        $shipped = DB::table('material_request_shipment_lines as sl')->join('material_request_shipments as s', 's.id', '=', 'sl.shipment_id')->join('warehouses as w', 'w.id', '=', 'sl.warehouse_id')
            ->where('s.application_id', $applicationId)
            ->selectRaw('sl.khs_item_id, sl.warehouse_id, min(sl.khs_code) as khs_code, min(sl.khs_name) as khs_name, min(sl.unit_text) as unit_text, min(w.name) as wname, min(w.plant) as plant, min(w.stor_loc) as stor_loc, sum(sl.quantity) as q')
            ->groupBy('sl.khs_item_id', 'sl.warehouse_id')->get()->groupBy('khs_item_id');

        // a PLN item is relevant when the MTO still needs it or something of it was sent; allocation alone (e.g. of an item no longer in the MTO) does not make it part of the outbox
        $ids = $need->keys()->merge($shipped->keys())->unique()->values();
        $skus = $ids->isEmpty() ? collect() : DB::table('khs_material_map')->whereIn('khs_item_id', $ids)->orderBy('material_no')->get()->groupBy('khs_item_id');

        $reserved = SrReservationService::reservedFor($applicationId);     // reserved when the 1-phase connection started (docs/95)
        $rows = [];
        foreach ($ids as $id) {
            $n = $need[$id] ?? null;
            $needQty = $n === null ? 0.0 : max(0.0, (float) $n->q - ($reserved[$id] ?? 0.0));
            $a = ($allocated[$id] ?? collect())->keyBy('warehouse_id');
            $s = ($shipped[$id] ?? collect())->keyBy('warehouse_id');
            $allocatedQty = (float) $a->sum(fn ($x) => (float) $x->q);
            $sentQty = (float) $s->sum(fn ($x) => (float) $x->q);
            $cap = max(0.0, min($needQty, $allocatedQty) - $sentQty);
            $ready = 0.0;
            $warehouses = [];
            foreach ($a->keys()->merge($s->keys())->unique() as $wid) {
                $row = $a[$wid] ?? $s[$wid];
                $aq = (float) ($a[$wid]->q ?? 0);
                $sq = (float) ($s[$wid]->q ?? 0);
                $take = max(0.0, min($aq - $sq, $cap - $ready));
                $ready += $take;
                $warehouses[] = ['warehouse_id' => $wid, 'warehouse' => $row->wname, 'plant' => $row->plant, 'stor_loc' => $row->stor_loc, 'allocated' => $aq, 'shipped' => $sq, 'ready' => $take];
            }
            $first = ($shipped[$id] ?? collect())->first();
            $oversent = max(0.0, $sentQty - $needQty);
            $rows[] = [
                'khs_item_id' => $id, 'khs_code' => (string) ($n->khs_code ?? $first->khs_code), 'name' => $n->khs_name ?? $first->khs_name, 'unit' => $n->unit_text ?? $first->unit_text,
                'skus' => ($skus[$id] ?? collect())->pluck('material_no')->all(),
                'need' => $needQty, 'allocated' => $allocatedQty, 'shipped' => $sentQty, 'ready' => $ready, 'waiting' => max(0.0, $needQty - $allocatedQty), 'oversent' => $oversent,
                'status' => $oversent > self::EPS ? 'OVERSENT' : ($needQty > 0 && $sentQty + self::EPS >= $needQty ? 'SENT' : ($ready > self::EPS ? 'READY' : 'WAITING')),
                'allocation' => $warehouses,
            ];
        }
        usort($rows, fn ($x, $y) => strnatcasecmp($x['khs_code'], $y['khs_code']));

        $anyShipped = collect($rows)->contains(fn ($r) => $r['shipped'] > self::EPS);
        $needed = collect($rows)->filter(fn ($r) => $r['need'] > self::EPS);
        $complete = $anyShipped && $needed->every(fn ($r) => $r['need'] <= $r['shipped'] + self::EPS);

        return [
            'package_id' => $pkg->id ?? null, 'materials' => $rows, 'vendor_count' => $vendorCount,
            'fulfilment' => ! $anyShipped ? 'NONE' : ($complete ? 'COMPLETE' : 'PARTIAL'),
            'ready_to_send' => collect($rows)->contains(fn ($r) => $r['ready'] > self::EPS),
            'oversent' => collect($rows)->contains(fn ($r) => $r['oversent'] > self::EPS),
        ];
    }

    /**
     * What a shipment made now would contain: the allocated, not yet sent quantity per material and warehouse.
     *
     * @param  array{materials:list<array<string,mixed>>}  $position
     * @return list<array<string,mixed>>
     */
    public static function delta(array $position): array
    {
        $lines = [];
        foreach ($position['materials'] as $m) {
            foreach ($m['allocation'] as $w) {
                if ($w['ready'] > self::EPS) {
                    $lines[] = ['khs_item_id' => $m['khs_item_id'], 'khs_code' => $m['khs_code'], 'name' => $m['name'], 'unit' => $m['unit'], 'skus' => $m['skus'], 'need' => $m['need'],
                        'warehouse_id' => $w['warehouse_id'], 'warehouse' => $w['warehouse'], 'plant' => $w['plant'], 'stor_loc' => $w['stor_loc'], 'quantity' => $w['ready']];
                }
            }
        }

        return $lines;
    }

    /** Keeps the stored summary of the active requests of an application current; called wherever need, allocation or shipments change. */
    public static function refresh(string $applicationId): void
    {
        $requests = DB::table('material_requests')->where('application_id', $applicationId)->whereIn('status', ['PENDING', 'EXPORTED', 'SENT'])->get(['id', 'fulfilment', 'ready_to_send', 'oversent']);
        if ($requests->isEmpty()) {
            return;
        }
        $p = self::position($applicationId);
        foreach ($requests as $r) {
            if ($r->fulfilment !== $p['fulfilment'] || (bool) $r->ready_to_send !== $p['ready_to_send'] || (bool) $r->oversent !== $p['oversent']) {
                DB::table('material_requests')->where('id', $r->id)->update(['fulfilment' => $p['fulfilment'], 'ready_to_send' => $p['ready_to_send'], 'oversent' => $p['oversent'], 'updated_at' => now()]);
            }
        }
    }
}
