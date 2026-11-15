<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Inventory\KhsMaterialMapService;
use App\Services\Inventory\MimsPullRunService;
use App\Services\Inventory\MimsStockSyncService;
use App\Services\Inventory\PoleContractService;
use App\Services\Inventory\StockService;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Warehouses, stock snapshots and pole contracts / Kontrak Rinci (docs/62 §30). Violations -> 409, authorization -> 403/404. */
class InventoryController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly StockService $stock, private readonly PoleContractService $poles, private readonly KhsMaterialMapService $map, private readonly MimsStockSyncService $mims, private readonly MimsPullRunService $pulls) {}

    public function warehouses(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $rows = DB::table('warehouses as w')->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')->orderBy('w.code')
            ->get(['w.id', 'w.code', 'w.name', 'w.is_active', 'w.plant', 'w.stor_loc', 'w.kind', 'w.erp_unit_code', 'u.id as unit_id', 'u.code as unit_code', 'u.name as unit_name']);

        return response()->json(['data' => $rows->map(fn ($w) => ['id' => $w->id, 'code' => $w->code, 'name' => $w->name, 'is_active' => (bool) $w->is_active, 'plant' => $w->plant, 'stor_loc' => $w->stor_loc, 'kind' => $w->kind, 'erp_unit_code' => $w->erp_unit_code, 'unit' => ['id' => $w->unit_id, 'code' => $w->unit_code, 'name' => $w->unit_name]])->all()]);
    }

    public function createWarehouse(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'warehouses.manage');
        $d = Validator::make($request->all(), ['code' => ['required', 'string', 'max:30', 'regex:/^[A-Za-z0-9_.-]+$/'], 'name' => ['required', 'string', 'max:150'], 'organizational_unit_id' => ['required', 'uuid']])->validate();

        return response()->json(['data' => ['id' => $this->stock->createWarehouse($d['code'], $d['name'], $d['organizational_unit_id'])]], 201);
    }

    public function snapshots(Request $request, string $warehouse): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        DB::table('warehouses')->where('id', $warehouse)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $rows = DB::table('stock_snapshots as s')->join('users as u', 'u.id', '=', 's.created_by')->where('s.warehouse_id', $warehouse)->orderByDesc('s.as_of')
            ->selectRaw('s.id, s.as_of, s.source_reference, s.materials_total, s.materials_mapped, s.created_at, u.name as created_by_name, (select count(*) from stock_snapshot_lines l where l.snapshot_id = s.id) as lines')->get();

        return response()->json(['data' => $rows->map(fn ($s) => ['id' => $s->id, 'as_of' => $s->as_of, 'source_reference' => $s->source_reference, 'lines' => (int) $s->lines, 'materials_total' => (int) $s->materials_total, 'materials_mapped' => (int) $s->materials_mapped, 'created_at' => $s->created_at, 'created_by_name' => $s->created_by_name])->all()]);
    }

    public function importSnapshot(Request $request, string $warehouse): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import'); // grant first, then validate
        $d = Validator::make($request->all(), [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip', 'extensions:csv,txt,xlsx', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'as_of' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'], 'source_reference' => ['nullable', 'string', 'max:255'], 'dry_run' => ['sometimes', 'boolean'],
        ])->validate();
        $r = $this->stock->import($warehouse, $request->file('file'), $d['as_of'], $d['source_reference'] ?? null, $request->boolean('dry_run'), $actor);

        return response()->json(['data' => $r['summary'], 'rows' => $r['rows']], $r['summary']['dry_run'] ? 200 : 201);
    }

    public function snapshot(Request $request, string $snapshot): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $s = DB::table('stock_snapshots')->where('id', $snapshot)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $lines = DB::table('stock_snapshot_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.snapshot_id', $snapshot)->orderByRaw('length(k.code), k.code')->get(['k.id as khs_id', 'k.code', 'l.on_hand', 'l.reserved', 'l.incoming_confirmed', 'l.safety_stock']);
        $names = $this->khsNames($lines->pluck('khs_id')->all());

        return response()->json(['data' => ['id' => $s->id, 'warehouse_id' => $s->warehouse_id, 'as_of' => $s->as_of, 'lines' => $lines->map(fn ($l) => ['khs_code' => $l->code, 'khs_name' => $names[$l->khs_id]['name'] ?? null, 'unit' => $names[$l->khs_id]['unit'] ?? null, 'on_hand' => (float) $l->on_hand, 'reserved' => (float) $l->reserved, 'incoming' => (float) $l->incoming_confirmed, 'safety_stock' => (float) $l->safety_stock])->all()]]);
    }

    /**
     * The name and unit of the latest version of each KHS item (what people read instead of the code).
     *
     * @param  list<string>  $ids
     * @return array<string,array{name:?string,unit:?string}>
     */
    private function khsNames(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('khs_item_versions as v')->whereIn('v.khs_item_id', $ids)
            ->whereRaw('v.version_number = (select max(x.version_number) from khs_item_versions x where x.khs_item_id = v.khs_item_id)')
            ->get(['v.khs_item_id', 'v.name', 'v.unit_text'])->mapWithKeys(fn ($r) => [$r->khs_item_id => ['name' => $r->name, 'unit' => $r->unit_text]])->all();
    }

    /** GET /master-data/stock-position?warehouse_ids[]=&date= — what the allocation and the RKM read. */
    public function position(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate(['warehouse_ids' => ['required', 'array', 'min:1', 'max:50'], 'warehouse_ids.*' => ['uuid'], 'date' => ['nullable', 'date_format:Y-m-d']]);
        $pos = $this->stock->position($d['warehouse_ids'], $d['date'] ?? now(config('distriva.business_timezone'))->toDateString());
        $codes = DB::table('khs_items')->whereIn('id', array_keys($pos))->pluck('code', 'id');
        $names = $this->khsNames(array_keys($pos));

        return response()->json(['data' => collect($pos)->map(fn ($p, $id) => ['khs_code' => $codes[$id] ?? $id, 'khs_name' => $names[$id]['name'] ?? null, 'unit' => $names[$id]['unit'] ?? null] + $p)->sortBy(fn ($r) => (int) $r['khs_code'])->values()->all()]);
    }

    /**
     * GET /master-data/stock-material-detail?khs_code=&warehouse_ids[]=&period_months=12&period_weeks=16
     * Detailed material information, consolidated & per-warehouse stock, movements (weekly & monthly receipts and issues).
     */
    public function materialStockDetail(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate([
            'khs_code' => ['required', 'string', 'max:50'],
            'warehouse_ids' => ['nullable', 'array', 'max:50'],
            'warehouse_ids.*' => ['uuid'],
            'period_months' => ['nullable', 'integer', 'min:1', 'max:36'],
            'period_weeks' => ['nullable', 'integer', 'min:1', 'max:52'],
        ]);

        $khsCode = trim($d['khs_code']);
        $item = DB::table('khs_items')->where('code', $khsCode)->first();
        if (! $item) {
            $item = DB::table('khs_items')->whereRaw('UPPER(code) = ?', [strtoupper($khsCode)])->first();
        }

        // Active version of KHS item
        $version = null;
        if ($item) {
            $version = DB::table('khs_item_versions')
                ->where('khs_item_id', $item->id)
                ->orderByDesc('version_number')
                ->first();
        }

        // SKU exemption
        $exemption = null;
        if ($item) {
            $exemption = DB::table('khs_sku_exemptions')
                ->where('khs_item_id', $item->id)
                ->whereNull('lifted_at')
                ->first();
        }

        // Mapped ERP SKUs
        $mappedSkus = collect();
        if ($item) {
            $mappedSkus = DB::table('khs_material_map')
                ->where('khs_item_id', $item->id)
                ->orderBy('material_no')
                ->get(['id', 'material_no', 'note', 'created_at']);
        }

        // Active warehouses
        $activeWarehouses = DB::table('warehouses as w')
            ->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')
            ->where('w.is_active', true)
            ->orderBy('w.code')
            ->get(['w.id', 'w.code', 'w.name', 'w.plant', 'w.stor_loc', 'w.kind', 'u.name as unit_name', 'u.code as unit_code']);

        $selectedWarehouseIds = ! empty($d['warehouse_ids'])
            ? $d['warehouse_ids']
            : $activeWarehouses->pluck('id')->all();

        // Calculate consolidated stock position for this item
        $today = now(config('distriva.business_timezone'))->toDateString();
        $calcPosition = $item && ! empty($selectedWarehouseIds)
            ? $this->stock->position($selectedWarehouseIds, $today)
            : [];
        $itemPosition = $calcPosition[$item?->id] ?? [
            'on_hand' => 0.0,
            'reserved' => 0.0,
            'incoming' => 0.0,
            'safety' => 0.0,
            'allocated_after' => 0.0,
            'available' => 0.0,
            'kr_supply' => 0.0,
            'available_with_kr' => 0.0,
        ];

        // Per-warehouse stock breakdown
        $warehouseBreakdown = [];
        foreach ($activeWarehouses as $wh) {
            if (! in_array($wh->id, $selectedWarehouseIds, true)) {
                continue;
            }
            $snap = DB::table('stock_snapshots')
                ->where('warehouse_id', $wh->id)
                ->where('as_of', '<=', $today)
                ->orderByDesc('as_of')
                ->first();

            $snapLine = null;
            $rawMaterial = null;
            if ($snap && $item) {
                $snapLine = DB::table('stock_snapshot_lines')
                    ->where('snapshot_id', $snap->id)
                    ->where('khs_item_id', $item->id)
                    ->first();
                $rawMaterial = DB::table('stock_snapshot_materials')
                    ->where('snapshot_id', $snap->id)
                    ->where('khs_item_id', $item->id)
                    ->first();
            }

            $onHand = (float) ($snapLine->on_hand ?? 0);
            $reserved = (float) ($snapLine->reserved ?? 0);
            $incoming = (float) ($snapLine->incoming_confirmed ?? 0);
            $safety = (float) ($snapLine->safety_stock ?? 0);
            $available = $onHand - $reserved;

            $warehouseBreakdown[] = [
                'warehouse_id' => $wh->id,
                'warehouse_code' => $wh->code,
                'warehouse_name' => $wh->name,
                'unit_code' => $wh->unit_code,
                'unit_name' => $wh->unit_name,
                'plant' => $wh->plant,
                'stor_loc' => $wh->stor_loc,
                'snapshot_date' => $snap?->as_of,
                'on_hand' => $onHand,
                'reserved' => $reserved,
                'incoming' => $incoming,
                'safety' => $safety,
                'available' => $available,
                'erp_material_no' => $rawMaterial?->material_no,
                'erp_material_name' => $rawMaterial?->material_name,
            ];
        }

        // MIMS movements: gather material numbers to match
        $skuList = $mappedSkus->pluck('material_no')->all();
        if (empty($skuList) && $item) {
            $extraSkus = DB::table('stock_snapshot_materials')
                ->where('khs_item_id', $item->id)
                ->pluck('material_no')
                ->unique()
                ->all();
            $skuList = array_unique(array_merge($skuList, $extraSkus));
        }

        $allSearchNos = collect($skuList)
            ->flatMap(fn ($n) => [
                (string) $n,
                ltrim((string) $n, '0'),
                str_pad((string) $n, 18, '0', STR_PAD_LEFT),
            ])
            ->filter()
            ->unique()
            ->values()
            ->all();

        // Prepare monthly buckets (last N months)
        $monthsCount = (int) ($d['period_months'] ?? 12);
        $nowTz = Carbon::now(config('distriva.business_timezone'));
        $monthlyBuckets = [];
        for ($i = $monthsCount - 1; $i >= 0; $i--) {
            $dt = (clone $nowTz)->startOfMonth()->subMonths($i);
            $key = $dt->format('Y-m');
            $monthlyBuckets[$key] = [
                'period_key' => $key,
                'period_label' => $dt->isoFormat('MMM YYYY'),
                'year' => (int) $dt->format('Y'),
                'month' => (int) $dt->format('m'),
                'start_date' => $dt->toDateString(),
                'end_date' => (clone $dt)->endOfMonth()->toDateString(),
                'qty_in' => 0.0,
                'qty_out' => 0.0,
                'net_change' => 0.0,
                'receipt_docs_count' => 0,
                'issue_docs_count' => 0,
            ];
        }

        // Prepare weekly buckets (last N weeks)
        $weeksCount = (int) ($d['period_weeks'] ?? 16);
        $currentWeekStart = (clone $nowTz)->startOfWeek();
        $weeklyBuckets = [];
        for ($i = $weeksCount - 1; $i >= 0; $i--) {
            $wStart = (clone $currentWeekStart)->subWeeks($i);
            $wEnd = (clone $wStart)->endOfWeek();
            $key = $wStart->format('o-\WW');
            $weekNum = (int) $wStart->format('W');
            $weeklyBuckets[$key] = [
                'period_key' => $key,
                'period_label' => "M-{$weekNum} ({$wStart->format('d/m')}–{$wEnd->format('d/m')})",
                'week_number' => $weekNum,
                'start_date' => $wStart->toDateString(),
                'end_date' => $wEnd->toDateString(),
                'qty_in' => 0.0,
                'qty_out' => 0.0,
                'net_change' => 0.0,
                'receipt_docs_count' => 0,
                'issue_docs_count' => 0,
            ];
        }

        $recentReceipts = collect();
        $recentIssues = collect();

        if (! empty($allSearchNos)) {
            // Receipts query
            $receiptQ = DB::table('mims_receipt_lines as l')
                ->join('mims_receipt_documents as d', function ($join) {
                    $join->on('d.delivery_document', '=', 'l.delivery_document')
                        ->on('d.warehouse_id', '=', 'l.warehouse_id');
                })
                ->join('warehouses as w', 'w.id', '=', 'd.warehouse_id')
                ->whereIn('l.material_no', $allSearchNos);

            if (! empty($selectedWarehouseIds)) {
                $receiptQ->whereIn('d.warehouse_id', $selectedWarehouseIds);
            }

            $receiptRecords = $receiptQ->get([
                'l.material_no', 'l.material_name', 'l.quantity_received', 'l.quantity_sent', 'l.unit',
                'd.delivery_document', 'd.receipt_document', 'd.delivered_on', 'd.received_on',
                'd.warehouse_id', 'd.origin_name', 'd.status',
                'w.code as warehouse_code', 'w.name as warehouse_name',
            ]);

            foreach ($receiptRecords as $rec) {
                $dateStr = $rec->received_on ?? $rec->delivered_on;
                if (! $dateStr) {
                    continue;
                }
                $qty = (float) $rec->quantity_received;
                if ($qty <= 0 && (float) $rec->quantity_sent > 0) {
                    $qty = (float) $rec->quantity_sent;
                }
                $mKey = substr($dateStr, 0, 7);
                if (isset($monthlyBuckets[$mKey])) {
                    $monthlyBuckets[$mKey]['qty_in'] += $qty;
                    $monthlyBuckets[$mKey]['receipt_docs_count']++;
                }
                try {
                    $wKey = Carbon::parse($dateStr)->startOfWeek()->format('o-\WW');
                    if (isset($weeklyBuckets[$wKey])) {
                        $weeklyBuckets[$wKey]['qty_in'] += $qty;
                        $weeklyBuckets[$wKey]['receipt_docs_count']++;
                    }
                } catch (\Throwable $e) {}
            }

            $recentReceipts = $receiptRecords->sortByDesc(fn ($r) => $r->received_on ?? $r->delivered_on)->take(15)->values();

            // Issues query
            $issueQ = DB::table('mims_issue_lines as l')
                ->join('mims_issue_documents as d', function ($join) {
                    $join->on('d.reservation_no', '=', 'l.reservation_no')
                        ->on('d.warehouse_id', '=', 'l.warehouse_id');
                })
                ->join('warehouses as w', 'w.id', '=', 'd.warehouse_id')
                ->whereIn('l.material_no', $allSearchNos);

            if (! empty($selectedWarehouseIds)) {
                $issueQ->whereIn('d.warehouse_id', $selectedWarehouseIds);
            }

            $issueRecords = $issueQ->get([
                'l.material_no', 'l.material_name', 'l.quantity', 'l.unit',
                'd.material_document', 'd.reservation_no', 'd.sap_document', 'd.issued_on',
                'd.warehouse_id', 'd.text', 'd.work_type_name', 'd.wbs', 'd.origin',
                'w.code as warehouse_code', 'w.name as warehouse_name',
            ]);

            foreach ($issueRecords as $iss) {
                $dateStr = $iss->issued_on;
                if (! $dateStr) {
                    continue;
                }
                $qty = (float) $iss->quantity;
                $mKey = substr($dateStr, 0, 7);
                if (isset($monthlyBuckets[$mKey])) {
                    $monthlyBuckets[$mKey]['qty_out'] += $qty;
                    $monthlyBuckets[$mKey]['issue_docs_count']++;
                }
                try {
                    $wKey = Carbon::parse($dateStr)->startOfWeek()->format('o-\WW');
                    if (isset($weeklyBuckets[$wKey])) {
                        $weeklyBuckets[$wKey]['qty_out'] += $qty;
                        $weeklyBuckets[$wKey]['issue_docs_count']++;
                    }
                } catch (\Throwable $e) {}
            }

            $recentIssues = $issueRecords->sortByDesc('issued_on')->take(15)->values();
        }

        // Finalize net change for monthly buckets
        $totalMonthlyIn = 0.0;
        $totalMonthlyOut = 0.0;
        foreach ($monthlyBuckets as &$mb) {
            $mb['qty_in'] = round($mb['qty_in'], 3);
            $mb['qty_out'] = round($mb['qty_out'], 3);
            $mb['net_change'] = round($mb['qty_in'] - $mb['qty_out'], 3);
            $totalMonthlyIn += $mb['qty_in'];
            $totalMonthlyOut += $mb['qty_out'];
        }
        unset($mb);

        // Finalize net change for weekly buckets
        $totalWeeklyIn = 0.0;
        $totalWeeklyOut = 0.0;
        foreach ($weeklyBuckets as &$wb) {
            $wb['qty_in'] = round($wb['qty_in'], 3);
            $wb['qty_out'] = round($wb['qty_out'], 3);
            $wb['net_change'] = round($wb['qty_in'] - $wb['qty_out'], 3);
            $totalWeeklyIn += $wb['qty_in'];
            $totalWeeklyOut += $wb['qty_out'];
        }
        unset($wb);

        $summary = [
            'total_in' => round($totalMonthlyIn, 3),
            'total_out' => round($totalMonthlyOut, 3),
            'net_total' => round($totalMonthlyIn - $totalMonthlyOut, 3),
            'avg_monthly_out' => count($monthlyBuckets) > 0 ? round($totalMonthlyOut / count($monthlyBuckets), 3) : 0.0,
            'avg_weekly_out' => count($weeklyBuckets) > 0 ? round($totalWeeklyOut / count($weeklyBuckets), 3) : 0.0,
            'mapped_sku_count' => $mappedSkus->count(),
            'warehouse_count' => count($warehouseBreakdown),
        ];

        return response()->json([
            'data' => [
                'material' => [
                    'id' => $item?->id,
                    'khs_code' => $khsCode,
                    'khs_name' => $version?->name ?? $khsCode,
                    'unit' => $version?->unit_text ?? null,
                    'category' => $version?->category ?? null,
                    'description' => $version?->description ?? null,
                    'version_number' => $version?->version_number ?? 1,
                    'status' => $version?->status ?? ($item ? 'APPROVED' : 'UNKNOWN'),
                    'source_reference' => $version?->source_reference ?? null,
                    'is_exempt' => $exemption !== null,
                    'exemption_reason' => $exemption?->reason,
                    'mapped_skus' => $mappedSkus->map(fn ($m) => [
                        'id' => $m->id,
                        'material_no' => $m->material_no,
                        'note' => $m->note,
                        'created_at' => $m->created_at,
                    ])->all(),
                ],
                'position' => $itemPosition,
                'warehouse_breakdown' => $warehouseBreakdown,
                'movements' => [
                    'monthly' => array_values($monthlyBuckets),
                    'weekly' => array_values($weeklyBuckets),
                    'summary' => $summary,
                ],
                'recent_transactions' => [
                    'receipts' => $recentReceipts->map(fn ($r) => [
                        'delivery_document' => $r->delivery_document,
                        'receipt_document' => $r->receipt_document,
                        'delivered_on' => $r->delivered_on,
                        'received_on' => $r->received_on,
                        'date' => $r->received_on ?? $r->delivered_on,
                        'material_no' => $r->material_no,
                        'material_name' => $r->material_name,
                        'quantity' => (float) ($r->quantity_received > 0 ? $r->quantity_received : $r->quantity_sent),
                        'unit' => $r->unit,
                        'origin_name' => $r->origin_name,
                        'status' => $r->status,
                        'warehouse_code' => $r->warehouse_code,
                        'warehouse_name' => $r->warehouse_name,
                    ])->all(),
                    'issues' => $recentIssues->map(fn ($i) => [
                        'material_document' => $i->material_document,
                        'reservation_no' => $i->reservation_no,
                        'sap_document' => $i->sap_document,
                        'issued_on' => $i->issued_on,
                        'date' => $i->issued_on,
                        'material_no' => $i->material_no,
                        'material_name' => $i->material_name,
                        'quantity' => (float) $i->quantity,
                        'unit' => $i->unit,
                        'text' => $i->text,
                        'work_type_name' => $i->work_type_name,
                        'wbs' => $i->wbs,
                        'origin' => $i->origin,
                        'warehouse_code' => $i->warehouse_code,
                        'warehouse_name' => $i->warehouse_name,
                    ])->all(),
                ],
            ],
        ]);
    }

    /** GET /master-data/khs-material-map?search=&per_page= */
    public function khsMap(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['search' => ['nullable', 'string', 'max:100'], 'pending' => ['sometimes', 'boolean'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:200']]);
        $q = DB::table('khs_material_map as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->orderByRaw('length(k.code), k.code')->orderBy('m.material_no')
            ->selectRaw('m.id, m.material_no, m.note, k.code as khs_code, (select v.name from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as khs_name');
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $q->where(fn ($w) => $w->where('k.code', 'ilike', $term)->orWhere('m.material_no', 'ilike', $term));
        }
        $page = $q->paginate((int) $request->query('per_page', 50));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => (array) $r)->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function importKhsMap(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'khs.manage');
        $d = Validator::make($request->all(), ['file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')], 'dry_run' => ['sometimes', 'boolean']])->validate();
        $r = $this->map->import($request->file('file'), $request->boolean('dry_run'), $request->user());

        return response()->json(['data' => $r['summary'], 'rows' => $r['rows']], $r['summary']['dry_run'] ? 200 : 201);
    }

    /** POST /master-data/khs-material-map/exemptions {khs_code, reason} — this KHS item is deliberately not mapped (e.g. requested only after the customer has paid). */
    public function exemptKhs(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'khs.manage');
        $d = Validator::make($request->all(), ['khs_code' => ['required', 'string', 'max:50'], 'reason' => ['required', 'string', 'max:1000']])->validate();

        return response()->json(['data' => ['id' => $this->map->exempt($d['khs_code'], $d['reason'], $request->user())]], 201);
    }

    /** POST /master-data/khs-material-map/exemptions/{khs_code}/lift {reason} — the item needs a SKU again. */
    public function liftKhsExemption(Request $request, string $khsCode): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'khs.manage');
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->map->lift($khsCode, $d['reason'], $request->user());

        return response()->json(['message' => 'Pengecualian dicabut.']);
    }

    public function deleteKhsMap(Request $request, string $map): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'khs.manage');
        $this->map->delete($map);

        return response()->json(['message' => 'Pemetaan dihapus.']);
    }

    /** GET /master-data/stock-snapshots/{id}/unmapped — the SKUs of an ERP stock file that are not mapped to a KHS item (what is still to be mapped). */
    public function unmapped(Request $request, string $snapshot): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        DB::table('stock_snapshots')->where('id', $snapshot)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $request->validate(['search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:200']]);
        $q = DB::table('stock_snapshot_materials')->where('snapshot_id', $snapshot)->whereNull('khs_item_id')->orderBy('material_name');
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $q->where(fn ($w) => $w->where('material_name', 'ilike', $term)->orWhere('material_no', 'ilike', $term));
        }
        $page = $q->paginate((int) $request->query('per_page', 50));

        return response()->json(['data' => collect($page->items())->map(fn ($m) => ['material_no' => $m->material_no, 'name' => $m->material_name, 'unit' => $m->unit, 'stock_ready' => (float) $m->stock_ready])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    /** POST /master-data/warehouses/import — the ERP list of storage locations (JSON as the ERP returns it, or a bare list); `dry_run` previews. */
    public function importWarehouses(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'warehouses.manage');
        $payload = $request->input('gudang.data', $request->input('data', $request->input('items')));
        $d = Validator::make(['items' => $payload, 'dry_run' => $request->input('dry_run')], ['items' => ['required', 'array', 'min:1', 'max:200'], 'items.*.plant' => ['required', 'string', 'max:10'], 'items.*.stor_loc' => ['required', 'string', 'max:10'],
            'items.*.stor_loc_name' => ['required', 'string', 'max:150'], 'items.*.unit' => ['required', 'string', 'max:20'], 'items.*.jenis' => ['required', 'in:GI,GO'], 'dry_run' => ['nullable', 'boolean']])->validate();
        $r = $this->stock->importWarehouses($d['items'], (bool) ($d['dry_run'] ?? false));

        return response()->json(['data' => $r['summary'], 'rows' => $r['rows']], $r['summary']['dry_run'] ? 200 : 201);
    }

    /** POST /master-data/khs-material-map — one pair (the mapping workbench). */
    public function createKhsMap(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'khs.manage');
        $d = Validator::make($request->all(), ['khs_code' => ['required', 'string', 'max:50'], 'material_no' => ['required', 'string', 'max:30'], 'note' => ['nullable', 'string', 'max:255']])->validate();

        return response()->json(['data' => ['id' => $this->map->create($d['khs_code'], $d['material_no'], $d['note'] ?? null, $request->user())]], 201);
    }

    /** GET /master-data/khs-material-map/workbench?filter=unmapped|mapped|all&used=1&supply=pln&search= — KHS items to map, the ones used in approved BOMs first. */
    public function khsMapWorkbench(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate(['filter' => ['nullable', 'in:all,mapped,unmapped'], 'used' => ['nullable', 'boolean'], 'supply' => ['nullable', 'in:pln'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:200']]);
        $page = $this->map->workbench($d['filter'] ?? 'unmapped', $d['search'] ?? null, $request->boolean('used'), (int) ($d['per_page'] ?? 50), ($d['supply'] ?? null) === 'pln');
        $skus = $this->map->mappedSkus(collect($page->items())->pluck('id')->all());

        return response()->json(['data' => collect($page->items())->map(fn ($k) => ['khs_code' => $k->code, 'name' => $k->name, 'unit' => $k->unit, 'used_in_bom' => (bool) $k->used_in_bom, 'material_status' => $k->material_status, 'sku_exempt' => (bool) $k->sku_exempt, 'exempt_reason' => $k->exempt_reason, 'mapped' => $skus[$k->id] ?? []])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    /** GET /master-data/khs-material-map/suggestions?khs_code=&category_id=(category or subcategory) — ranked candidate SKUs for one KHS item (to be confirmed by a person). */
    public function khsMapSuggestions(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate(['khs_code' => ['required', 'string', 'max:50'], 'limit' => ['nullable', 'integer', 'min:1', 'max:30'], 'category_id' => ['nullable', 'uuid', 'exists:material_categories,id']]);

        return response()->json(['data' => $this->map->suggestions($d['khs_code'], (int) ($d['limit'] ?? 10), $d['category_id'] ?? null),
            'meta' => ['categories' => $this->map->suggestionCategories($d['khs_code'])]]);
    }

    public function khsMapCoverage(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');

        return response()->json(['data' => $this->map->coverage()]);
    }

    /** GET /master-data/stock-sync-runs?warehouse_id= — the automatic pulls of the ERP stock (status, message, snapshot). */
    public function syncRuns(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate(['warehouse_id' => ['nullable', 'uuid'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $q = DB::table('stock_sync_runs as r')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')->orderByDesc('r.started_at')->select('r.*', 'w.code as warehouse_code', 'w.name as warehouse_name');
        if (isset($d['warehouse_id'])) {
            $q->where('r.warehouse_id', $d['warehouse_id']);
        }
        $page = $q->paginate((int) ($d['per_page'] ?? 30));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => ['id' => $r->id, 'warehouse_code' => $r->warehouse_code, 'warehouse_name' => $r->warehouse_name, 'status' => $r->status, 'message' => $r->message, 'snapshot_id' => $r->snapshot_id,
            'materials_total' => (int) $r->materials_total, 'materials_mapped' => (int) $r->materials_mapped, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
            'sync_configured' => filled(config('distriva.mims.base_url')) && filled(config('distriva.mims.auth_token'))]);
    }

    /**
     * GET /master-data/mims-issues — browse the read-only MIMS issue mirror (pengeluaran): one row per issue document with its
     * lines and the customers (agenda numbers) tied to the reservation. Filters: warehouse_id, from/to (issue date), search
     * (document, reservation, material, agenda).
     */
    public function mimsIssues(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $this->mirrorFilters($request);
        $q = DB::table('mims_issue_documents as d')->join('warehouses as w', 'w.id', '=', 'd.warehouse_id')->orderByDesc('d.issued_on')->orderByDesc('d.material_document')
            ->select('d.*', 'w.code as warehouse_code', 'w.name as warehouse_name');
        $this->applyMirrorFilters($q, $d, 'd.issued_on', 'd.material_document', 'd.reservation_no', fn ($s, $like) => $s
            ->orWhereExists(fn ($x) => $x->select(DB::raw(1))->from('mims_issue_lines as l')->whereColumn('l.reservation_no', 'd.reservation_no')->where(fn ($m) => $m->where('l.material_no', 'ilike', $like)->orWhere('l.material_name', 'ilike', $like)))
            ->orWhereExists(fn ($x) => $x->select(DB::raw(1))->from('mims_issue_customers as c')->whereColumn('c.reservation_no', 'd.reservation_no')->where('c.agenda_no', 'ilike', $like)));
        $page = $q->paginate((int) ($d['per_page'] ?? 25));
        $items = collect($page->items());
        $res = $items->pluck('reservation_no')->unique()->all();
        $lines = DB::table('mims_issue_lines')->whereIn('reservation_no', $res)->orderBy('material_no')->get()->groupBy('reservation_no');
        $customers = DB::table('mims_issue_customers')->whereIn('reservation_no', $res)->orderBy('agenda_no')->get()->groupBy('reservation_no');

        return response()->json(['data' => $items->map(fn ($r) => [
            'id' => $r->id, 'warehouse_code' => $r->warehouse_code, 'warehouse_name' => $r->warehouse_name, 'material_document' => $r->material_document, 'reservation_no' => $r->reservation_no,
            'sap_document' => $r->sap_document, 'issued_on' => $r->issued_on, 'work_type_name' => $r->work_type_name, 'wbs' => $r->wbs, 'text' => $r->text, 'origin' => $r->origin,
            'lines' => ($lines[$r->reservation_no] ?? collect())->map(fn ($l) => ['material_no' => $l->material_no, 'material_name' => $l->material_name, 'quantity' => (float) $l->quantity, 'unit' => $l->unit])->values()->all(),
            'customers' => ($customers[$r->reservation_no] ?? collect())->map(fn ($c) => ['agenda_no' => $c->agenda_no, 'id_pel' => $c->id_pel, 'power_va' => $c->power_va, 'paid_on' => $c->paid_on, 'matched' => $c->application_id !== null])->values()->all(),
        ])->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    /** GET /master-data/mims-receipts — browse the read-only MIMS receipt mirror (penerimaan): deliveries with their lines (sent vs received). */
    public function mimsReceipts(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $this->mirrorFilters($request);
        $q = DB::table('mims_receipt_documents as d')->join('warehouses as w', 'w.id', '=', 'd.warehouse_id')->orderByDesc('d.delivered_on')->orderByDesc('d.delivery_document')
            ->select('d.*', 'w.code as warehouse_code', 'w.name as warehouse_name');
        $this->applyMirrorFilters($q, $d, 'd.delivered_on', 'd.delivery_document', 'd.request_document', fn ($s, $like) => $s
            ->orWhere('d.receipt_document', 'ilike', $like)->orWhere('d.sap_document', 'ilike', $like)
            ->orWhereExists(fn ($x) => $x->select(DB::raw(1))->from('mims_receipt_lines as l')->whereColumn('l.delivery_document', 'd.delivery_document')->where(fn ($m) => $m->where('l.material_no', 'ilike', $like)->orWhere('l.material_name', 'ilike', $like))));
        $page = $q->paginate((int) ($d['per_page'] ?? 25));
        $items = collect($page->items());
        $lines = DB::table('mims_receipt_lines')->whereIn('delivery_document', $items->pluck('delivery_document')->all())->orderBy('material_no')->get()->groupBy('delivery_document');

        return response()->json(['data' => $items->map(fn ($r) => [
            'id' => $r->id, 'warehouse_code' => $r->warehouse_code, 'warehouse_name' => $r->warehouse_name, 'delivery_document' => $r->delivery_document, 'receipt_document' => $r->receipt_document,
            'request_document' => $r->request_document, 'origin_name' => $r->origin_name, 'status' => $r->status, 'delivered_on' => $r->delivered_on, 'received_on' => $r->received_on,
            'lines' => ($lines[$r->delivery_document] ?? collect())->map(fn ($l) => ['material_no' => $l->material_no, 'material_name' => $l->material_name, 'quantity_sent' => (float) $l->quantity_sent, 'quantity_received' => (float) $l->quantity_received, 'unit' => $l->unit])->values()->all(),
        ])->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    /**
     * GET /master-data/mims-reservations — browse the read-only MIMS reservation mirror: reserved material, the customers (agenda) tied to it, the DISTRIVA applications they match,
     * and whether an issue was already mirrored for the reservation. `pending=1` keeps only the reservations without an issue yet.
     */
    public function mimsReservations(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $this->mirrorFilters($request);
        $issued = fn ($x) => $x->select(DB::raw(1))->from('mims_issue_documents as i')->whereColumn('i.reservation_no', 'd.reservation_no');
        $q = DB::table('mims_reservations as d')->join('warehouses as w', 'w.id', '=', 'd.warehouse_id')->orderByDesc('d.reserved_on')->orderByDesc('d.reservation_no')
            ->select('d.*', 'w.code as warehouse_code', 'w.name as warehouse_name');
        $this->applyMirrorFilters($q, $d, 'd.reserved_on', 'd.reservation_no', 'd.sap_reservation', fn ($s, $like) => $s
            ->orWhere('d.text', 'ilike', $like)
            ->orWhereExists(fn ($x) => $x->select(DB::raw(1))->from('mims_reservation_customers as c')->whereColumn('c.reservation_no', 'd.reservation_no')->where('c.agenda_no', 'ilike', $like)));
        if ($request->boolean('pending')) {
            $q->whereNotExists($issued);
        }
        $page = $q->paginate((int) ($d['per_page'] ?? 25));
        $items = collect($page->items());
        $res = $items->pluck('reservation_no')->unique()->all();
        $customers = DB::table('mims_reservation_customers as c')->leftJoin('applications as a', 'a.id', '=', 'c.application_id')->whereIn('c.reservation_no', $res)->orderBy('c.agenda_no')
            ->get(['c.reservation_no', 'c.agenda_no', 'c.application_id'])->groupBy('reservation_no');
        $done = DB::table('mims_issue_documents')->whereIn('reservation_no', $res)->pluck('reservation_no')->flip();

        return response()->json(['data' => $items->map(fn ($r) => [
            'id' => $r->id, 'warehouse_code' => $r->warehouse_code, 'warehouse_name' => $r->warehouse_name, 'reservation_no' => $r->reservation_no, 'reserved_on' => $r->reserved_on, 'status' => $r->status,
            'work_type_name' => $r->work_type_name, 'text' => $r->text, 'issued' => isset($done[$r->reservation_no]),
            'customers' => ($customers[$r->reservation_no] ?? collect())->map(fn ($c) => ['agenda_no' => $c->agenda_no, 'application_id' => $c->application_id])->values()->all(),
        ])->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    /** @return array<string,mixed> */
    private function mirrorFilters(Request $request): array
    {
        return $request->validate(['warehouse_id' => ['nullable', 'uuid'], 'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
    }

    private function applyMirrorFilters($q, array $d, string $dateCol, string $docCol, string $refCol, \Closure $extra): void
    {
        if (isset($d['warehouse_id'])) {
            $q->where('d.warehouse_id', $d['warehouse_id']);
        }
        if (isset($d['from'])) {
            $q->where($dateCol, '>=', $d['from']);
        }
        if (isset($d['to'])) {
            $q->where($dateCol, '<=', $d['to']);
        }
        if (filled($d['search'] ?? null)) {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($d['search'])).'%';
            $q->where(fn ($s) => $extra($s->where($docCol, 'ilike', $like)->orWhere($refCol, 'ilike', $like), $like));
        }
    }

    /**
     * POST /master-data/stock-sync — pull the ERP (MIMS) stock NOW with the signed-in user's own MIMS token (the token of his session, copied from the MIMS application). The token is used for these
     * calls only: it is not stored, logged or returned. Without `warehouse_ids` every active warehouse with a plant and storage location is pulled.
     */
    public function mimsPull(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import'); // grant first, then validate
        @set_time_limit(600);   // up to one call per warehouse, each with its own timeout: the default web limit (30 s) would cut the request mid-way
        [$d, $token, $useSaved, $opts, $warehouses] = $this->pullInput($request, $actor);
        $results = [];
        foreach ($warehouses as $wh) {
            $row = $this->pulls->pullOne($wh, $actor, $token, $opts);
            $results[] = $row;
            if ($this->pulls->rejected($row)) {
                break;                                                                                  // an expired token fails every warehouse: stop at the first
            }
        }
        $this->rememberToken($request, $actor, $useSaved, $token, collect($results)->contains(fn ($r) => $this->pulls->rejected($r)),
            collect($results)->contains(fn ($r) => in_array($r['status'], ['OK', 'SKIPPED'], true) || collect([$r['issues'] ?? null, $r['receipts'] ?? null, $r['reservations'] ?? null])->contains(fn ($m) => ($m['status'] ?? '') === 'OK')));

        return response()->json(['data' => $results]);
    }

    /**
     * POST /stock-sync/runs — the same pull as /stock-sync, but as a run in a detached process; answers at once with the run, whose results (per warehouse) are read with GET /stock-sync/runs/{id}.
     * A pasted token goes to the process through its environment; "save_token" keeps it encrypted for the user as before.
     */
    public function mimsRunStart(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import');
        [$d, $token, $useSaved, $opts, $warehouses] = $this->pullInput($request, $actor);
        if (! $useSaved && $request->boolean('save_token')) {
            $this->rememberToken($request, $actor, false, $token, false, true);
        }
        $id = $this->pulls->start($actor, ['sync_stock' => $opts['stock'], 'sync_issues' => $opts['issues'], 'sync_receipts' => $opts['receipts'], 'sync_reservations' => $opts['reservations'], 'dry_run' => $opts['dry_run'], 'date' => $opts['date'], 'issues_from' => $opts['from'], 'issues_to' => $opts['to'], 'warehouse_ids' => $warehouses->pluck('id')->all(), 'use_saved_token' => $useSaved]);
        $this->pulls->launch($id, $useSaved ? null : $token);

        return response()->json(['data' => $this->pulls->show($id)], 202);
    }

    /** GET /stock-sync/runs/active: the pull in progress, or null. */
    public function mimsRunActive(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'stock.import');

        return response()->json(['data' => $this->pulls->active()]);
    }

    /** GET /stock-sync/runs/{run} */
    public function mimsRunShow(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'stock.import');
        $data = $this->pulls->show($run) ?? throw new AdministrationDenied('Penarikan tidak ditemukan.', 404);

        return response()->json(['data' => $data]);
    }

    /**
     * Validates a pull request and returns [validated, token, useSaved, options, warehouses].
     *
     * @return array{0:array<string,mixed>,1:string,2:bool,3:array<string,mixed>,4:Collection<int,object>}
     */
    private function pullInput(Request $request, User $actor): array
    {
        $d = Validator::make($request->all(), ['token' => ['required_without:use_saved_token', 'nullable', 'string', 'min:10', 'max:2000'], 'use_saved_token' => ['sometimes', 'boolean'], 'save_token' => ['sometimes', 'boolean'], 'sync_stock' => ['sometimes', 'boolean'], 'sync_issues' => ['sometimes', 'boolean'], 'sync_receipts' => ['sometimes', 'boolean'], 'sync_reservations' => ['sometimes', 'boolean'], 'warehouse_ids' => ['nullable', 'array', 'max:50'], 'warehouse_ids.*' => ['uuid', 'distinct'], 'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'issues_from' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'issues_to' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today', 'after_or_equal:issues_from'], 'dry_run' => ['sometimes', 'boolean']])->validate();
        if (isset($d['issues_from']) && Carbon::parse($d['issues_from'])->diffInDays(Carbon::parse($d['issues_to'] ?? 'today')) > 366) {
            throw new AssignmentRuleViolation('Rentang tanggal pengeluaran/penerimaan paling lama 366 hari.');
        }
        if (! $this->mims->baseUrlConfigured()) {
            throw new AssignmentRuleViolation('Alamat dasar MIMS (DISTRIVA_MIMS_BASE_URL) belum diisi di server.');
        }
        // what to pull: stock (default), issues and receipts (each only when asked); a dry run only exists for stock
        $opts = ['stock' => $request->boolean('sync_stock', true), 'issues' => $request->boolean('sync_issues'), 'receipts' => $request->boolean('sync_receipts'), 'reservations' => $request->boolean('sync_reservations'), 'dry_run' => $request->boolean('dry_run'), 'date' => $d['date'] ?? null, 'from' => $d['issues_from'] ?? null, 'to' => $d['issues_to'] ?? null];
        if (! $opts['stock'] && ! $opts['issues'] && ! $opts['receipts'] && ! $opts['reservations']) {
            throw new AssignmentRuleViolation('Pilih minimal satu: stok, pengeluaran, penerimaan, atau reservasi.');
        }
        if ($opts['dry_run'] && ! $opts['stock']) {
            throw new AssignmentRuleViolation('Uji coba (dry run) hanya berlaku untuk stok.');
        }
        $useSaved = $request->boolean('use_saved_token');
        $token = $useSaved ? $this->savedToken($actor->getKey()) : (string) $d['token'];
        $q = DB::table('warehouses')->where('is_active', true)->whereNotNull('plant')->whereNotNull('stor_loc')->orderBy('code');
        if (! empty($d['warehouse_ids'])) {
            $q->whereIn('id', $d['warehouse_ids']);
        }
        $warehouses = $q->get();
        if ($warehouses->isEmpty()) {
            throw new AdministrationDenied('Tidak ada gudang ERP yang dapat ditarik (impor daftar gudang dan pastikan plant/storage location terisi).', 404);
        }

        return [$d, $token, $useSaved, $opts, $warehouses];
    }

    /** Keeps the token the user chose to save (encrypted), or records how the saved one fared. */
    private function rememberToken(Request $request, User $actor, bool $useSaved, string $token, bool $rejected, bool $worked): void
    {
        if (! $useSaved && $request->boolean('save_token') && ! $rejected) {
            DB::table('user_mims_tokens')->upsert([['user_id' => $actor->getKey(), 'token_encrypted' => Crypt::encryptString($token), 'saved_at' => now(), 'last_used_at' => now(), 'last_result' => 'OK']], ['user_id'], ['token_encrypted', 'saved_at', 'last_used_at', 'last_result']);
        } elseif ($useSaved && ($rejected || $worked)) {
            DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->update(['last_used_at' => now(), 'last_result' => $rejected ? 'REJECTED' : 'OK']);   // kept either way: the user decides when to replace it
        }
    }

    /** GET /stock-sync/settings — automatic pull settings. */
    public function mimsAutoShow(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'stock.import');

        return response()->json(['data' => $this->mims->autoSettings()]);
    }

    /** PUT /stock-sync/settings {auto_enabled, auto_time} */
    public function mimsAutoSave(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import');
        $d = Validator::make($request->all(), ['auto_enabled' => ['required', 'boolean'], 'auto_time' => ['required', 'date_format:H:i'], 'auto_stock' => ['sometimes', 'boolean'], 'auto_issues' => ['sometimes', 'boolean'], 'auto_receipts' => ['sometimes', 'boolean']])->validate();
        $what = array_filter(['stock' => $d['auto_stock'] ?? null, 'issues' => $d['auto_issues'] ?? null, 'receipts' => $d['auto_receipts'] ?? null], fn ($v) => $v !== null);

        return response()->json(['data' => $this->mims->saveAutoSettings($actor, (bool) $d['auto_enabled'], $d['auto_time'], $what ?: null)]);
    }

    /** GET /stock-sync/token — whether the user keeps a MIMS token (never the token itself). */
    public function mimsTokenStatus(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import');
        $row = DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->first(['saved_at', 'last_used_at', 'last_result']);

        return response()->json(['data' => ['saved' => $row !== null, 'saved_at' => $row->saved_at ?? null, 'last_used_at' => $row->last_used_at ?? null, 'last_result' => $row->last_result ?? null]]);
    }

    /** DELETE /stock-sync/token */
    public function mimsTokenForget(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'stock.import');
        DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->delete();

        return response()->json(['message' => 'Token MIMS tersimpan dihapus.']);
    }

    private function savedToken(string $userId): string
    {
        $row = DB::table('user_mims_tokens')->where('user_id', $userId)->value('token_encrypted');
        if ($row === null) {
            throw new AssignmentRuleViolation('Belum ada token MIMS tersimpan; tempel token sesi dan centang "Simpan token".');
        }
        try {
            return Crypt::decryptString($row);
        } catch (DecryptException) {
            DB::table('user_mims_tokens')->where('user_id', $userId)->delete();

            throw new AssignmentRuleViolation('Token tersimpan tidak dapat dibaca lagi; tempel token sesi yang baru.');
        }
    }

    public function poleContracts(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');

        return response()->json(['data' => DB::table('pole_contracts')->orderBy('kr_number')->get()->map(fn ($c) => $this->contract($c))->all(),
            'options' => ['vendors' => DB::table('vendor_companies')->where('status', 'ACTIVE')->where('work_scope', '<>', 'JARINGAN')->orderBy('name')->get(['id', 'code', 'name'])->map(fn ($v) => (array) $v)->all(),
                'up3' => DB::table('organizational_units')->where('unit_type', 'UP3')->where('is_active', true)->orderBy('name')->get(['id', 'name'])->map(fn ($u) => (array) $u)->all()]]);
    }

    public function poleContract(Request $request, string $contract): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $c = DB::table('pole_contracts')->where('id', $contract)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $events = DB::table('pole_contract_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.pole_contract_id', $contract)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.email as actor_email']);

        return response()->json(['data' => $this->contract($c) + ['events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all()]]);
    }

    public function createPoleContract(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'poles.manage');
        $d = Validator::make($request->all(), ['kr_number' => ['required', 'string', 'max:100'], 'vendor_company_id' => ['nullable', 'uuid'], 'up3_unit_id' => ['nullable', 'uuid'], 'description' => ['nullable', 'string', 'max:255'], 'qty_tm' => ['required_without:lines', 'integer', 'min:0', 'max:10000000'], 'qty_tr' => ['required_without:lines', 'integer', 'min:0', 'max:10000000'], 'lines' => ['sometimes', 'array', 'max:100'], 'lines.*.khs_item_id' => ['required', 'uuid'], 'lines.*.pole_type' => ['required', 'in:TM,TR'], 'lines.*.quantity' => ['required', 'integer', 'min:1', 'max:10000000']])->validate();

        return response()->json(['data' => ['id' => $this->poles->create($d['kr_number'], $d['description'] ?? null, (int) ($d['qty_tm'] ?? 0), (int) ($d['qty_tr'] ?? 0), $actor, $d['lines'] ?? null, $d['vendor_company_id'] ?? null, $d['up3_unit_id'] ?? null)]], 201);
    }

    public function updatePoleContract(Request $request, string $contract): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'poles.manage');
        $d = Validator::make($request->all(), ['vendor_company_id' => ['nullable', 'uuid'], 'up3_unit_id' => ['nullable', 'uuid'], 'description' => ['nullable', 'string', 'max:255'], 'qty_tm' => ['sometimes', 'integer', 'min:0', 'max:10000000'], 'qty_tr' => ['sometimes', 'integer', 'min:0', 'max:10000000'], 'reason' => ['required', 'string', 'max:1000'], 'lines' => ['sometimes', 'array', 'max:100'], 'lines.*.khs_item_id' => ['required', 'uuid'], 'lines.*.pole_type' => ['required', 'in:TM,TR'], 'lines.*.quantity' => ['required', 'integer', 'min:1', 'max:10000000']])->validate();
        $this->poles->update($contract, $d['description'] ?? null, isset($d['qty_tm']) ? (int) $d['qty_tm'] : null, isset($d['qty_tr']) ? (int) $d['qty_tr'] : null, $d['reason'], $actor, $d['lines'] ?? null, array_intersect_key($d, ['vendor_company_id' => 1, 'up3_unit_id' => 1]));

        return response()->json(['message' => 'Kontrak Rinci diperbarui.']);
    }

    public function closePoleContract(Request $request, string $contract): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'poles.manage');
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->poles->close($contract, $d['reason'], $actor);

        return response()->json(['message' => 'Kontrak Rinci ditutup.']);
    }

    /** @return array<string,mixed> */
    private function contract(object $c): array
    {
        $used = $this->poles->allocated($c->id);

        return ['id' => $c->id, 'kr_number' => $c->kr_number, 'description' => $c->description, 'status' => $c->status,
            'vendor_company_id' => $c->vendor_company_id, 'vendor_name' => $c->vendor_company_id === null ? null : DB::table('vendor_companies')->where('id', $c->vendor_company_id)->value('name'),
            'up3_unit_id' => $c->up3_unit_id, 'up3_name' => $c->up3_unit_id === null ? null : DB::table('organizational_units')->where('id', $c->up3_unit_id)->value('name'),
            'in_debt' => ((int) $c->qty_tm - $used['TM'] < 0) || ((int) $c->qty_tr - $used['TR'] < 0),
            'tm' => ['total' => (int) $c->qty_tm, 'allocated' => $used['TM'], 'remaining' => (int) $c->qty_tm - $used['TM']], 'tr' => ['total' => (int) $c->qty_tr, 'allocated' => $used['TR'], 'remaining' => (int) $c->qty_tr - $used['TR']], 'lines' => $this->poles->lineStock($c)];
    }
}
