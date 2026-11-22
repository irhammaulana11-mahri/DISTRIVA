<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\UnitFilter;
use App\Services\Output\XlsxRenderer;
use App\Services\WorkOrders\MaterialOutbox;
use App\Services\WorkOrders\MaterialRequestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\Response;

/** Material need of issued work orders for the material application (docs/62 §40): list, view, export (JSON/CSV/XLSX), mark sent, cancel. Violations -> 409, authorization -> 403/404. */
class MaterialRequestController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MaterialRequestService $requests, private readonly XlsxRenderer $xlsx) {}

    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'material_requests.view');
        $d = $request->validate(['status' => ['nullable', 'in:PENDING,EXPORTED,SENT,CANCELLED,SUPERSEDED'], 'followup' => ['nullable', 'boolean'], 'application_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $q = DB::table('material_requests as r')->join('applications as a', 'a.id', '=', 'r.application_id')->join('work_orders as w', 'w.id', '=', 'r.work_order_id')->orderByDesc('r.created_at');
        if (! $scope['unrestricted']) {
            $q->whereIn('a.organizational_unit_id', $scope['units']);
        }
        $request->validate(UnitFilter::rules());
        UnitFilter::apply($q, $request, 'a.organizational_unit_id');
        isset($d['status']) && $q->where('r.status', $d['status']);
        $request->boolean('followup') && $q->where('r.needs_followup', true);
        isset($d['application_id']) && $q->where('r.application_id', $d['application_id']);
        if (! empty($d['search'])) {
            $term = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $d['search']).'%';
            $q->where(fn ($w2) => $w2->where('w.wo_number', 'ilike', $term)->orWhere('a.application_number', 'ilike', $term)->orWhere('r.external_reference', 'ilike', $term));
        }
        $page = $q->paginate((int) ($d['per_page'] ?? 25), ['r.id', 'r.status', 'r.needs_followup', 'r.fulfilment', 'r.ready_to_send', 'r.oversent', 'r.external_reference', 'r.exported_at', 'r.sent_at', 'r.created_at', 'w.wo_number', 'a.application_number']);

        return response()->json(['data' => collect($page->items())->map(fn ($r) => (array) $r)->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(Request $request, string $request_): JsonResponse
    {
        $r = $this->find($request_);
        $this->viewable($request, $r);
        $events = DB::table('material_request_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.material_request_id', $r->id)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.occurred_at', 'u.name as actor_name']);
        $payload = (array) json_decode((string) $r->payload, true);
        $position = MaterialOutbox::position($r->application_id);
        $shipments = DB::table('material_request_shipments as s')->join('users as u', 'u.id', '=', 's.sent_by')->where('s.material_request_id', $r->id)->orderBy('s.sequence')->get(['s.id', 's.sequence', 's.reference', 's.sent_at', 'u.name as sent_by_name']);
        $shipmentLines = DB::table('material_request_shipment_lines as l')->join('warehouses as w', 'w.id', '=', 'l.warehouse_id')->whereIn('l.shipment_id', $shipments->pluck('id'))->orderBy('l.khs_code')
            ->get(['l.shipment_id', 'l.khs_item_id', 'l.khs_code', 'l.khs_name', 'l.unit_text', 'l.quantity', 'w.name as warehouse', 'w.plant', 'w.stor_loc'])->groupBy('shipment_id');
        $skus = DB::table('khs_material_map')->whereIn('khs_item_id', $shipmentLines->flatten(1)->pluck('khs_item_id')->unique())->orderBy('material_no')->get(['khs_item_id', 'material_no'])->groupBy('khs_item_id');
        $context = DB::table('work_orders as w')->join('applications as a', 'a.id', '=', 'w.application_id')->leftJoin('customers as cu', 'cu.id', '=', 'a.customer_id')->join('organizational_units as o', 'o.id', '=', 'a.organizational_unit_id')
            ->leftJoin('vendor_companies as v', 'v.id', '=', 'w.vendor_company_id')->where('w.id', $r->work_order_id)
            ->first(['w.wo_number', 'a.application_number', 'cu.name as customer_name', 'o.name as unit_name', 'v.name as vendor_name',
                DB::raw("(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active order by e.created_at desc limit 1) as agenda_number")]);

        return response()->json(['data' => ['id' => $r->id, 'work_order_id' => $r->work_order_id, 'idempotency_key' => $r->idempotency_key, 'status' => $r->status, 'needs_followup' => (bool) $r->needs_followup, 'external_reference' => $r->external_reference,
            'exported_at' => $r->exported_at, 'sent_at' => $r->sent_at, 'cancel_reason' => $r->cancel_reason, 'payload_hash' => $r->payload_hash, 'payload' => $payload,
            'position' => $position + ['wo_package_id' => DB::table('work_orders')->where('id', $r->work_order_id)->value('mto_package_id')],
            'shipments' => $shipments->map(fn ($x) => ['sequence' => (int) $x->sequence, 'reference' => $x->reference, 'sent_at' => $x->sent_at, 'sent_by_name' => $x->sent_by_name,
                'lines' => ($shipmentLines[$x->id] ?? collect())->map(fn ($l) => ['khs_code' => $l->khs_code, 'name' => $l->khs_name, 'unit' => $l->unit_text, 'warehouse' => $l->warehouse, 'plant' => $l->plant, 'stor_loc' => $l->stor_loc,
                    'skus' => ($skus[$l->khs_item_id] ?? collect())->pluck('material_no')->all(), 'quantity' => (float) $l->quantity])->values()->all()])->all(),
            'handover_form' => ['company' => (array) config('distriva.document.company'), 'wo_number' => $context->wo_number ?? null, 'application_number' => $context->application_number ?? null, 'agenda_number' => $context->agenda_number ?? null,
                'customer_name' => $context->customer_name ?? null, 'unit_name' => $context->unit_name ?? null, 'vendor_name' => $context->vendor_name ?? null],
            'unmapped_khs' => collect($position['materials'])->filter(fn ($m) => $m['need'] > 0 && empty($m['skus']))->pluck('khs_code')->values()->all(), 'events' => $events->map(fn ($e) => (array) $e)->all()]]);
    }

    /** GET /material-requests/{id}/export?format=json|csv|xlsx — marks a PENDING request EXPORTED. */
    public function export(Request $request, string $request_): JsonResponse|Response
    {
        $r = $this->find($request_);
        $this->managed($request, $r);
        $format = $request->query('format', 'csv');
        if (! in_array($format, ['json', 'csv', 'xlsx'], true)) {
            throw new AdministrationDenied('Format tidak dikenal (json, csv atau xlsx).', 422);
        }
        $rows = $this->requests->export($r->id, $request->user());
        $name = 'KEBUTUHAN-MATERIAL-'.str_replace('/', '-', (string) $r->idempotency_key);
        if ($format === 'json') {
            return response()->json(['data' => ['idempotency_key' => $r->idempotency_key, 'payload' => json_decode((string) $r->payload, true), 'lines' => $rows]]);
        }
        $headers = array_keys($rows[0] ?? ['wo_number' => null]);
        if ($format === 'xlsx') {
            $doc = ['title' => 'KEBUTUHAN MATERIAL WO', 'header' => (array) config('distriva.document.company'), 'meta' => [['No. WO', $r->idempotency_key]], 'sections' => [['columns' => $headers, 'rows' => array_map('array_values', $rows)]], 'place_date' => '', 'signatures' => []];

            return response($this->xlsx->render($doc), 200, ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition' => 'attachment; filename="'.$name.'.xlsx"']);
        }
        $out = fopen('php://temp', 'w+b');
        fputcsv($out, $headers, ',', '"', '');
        foreach ($rows as $row) {
            fputcsv($out, array_map(self::csvSafe(...), array_values($row)), ',', '"', '');
        }
        rewind($out);

        return response((string) stream_get_contents($out), 200, ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="'.$name.'.csv"']);
    }

    public function markSent(Request $request, string $request_): JsonResponse
    {
        $r = $this->find($request_);
        $this->managed($request, $r);
        $d = Validator::make($request->all(), ['reference' => ['required', 'string', 'max:150']])->validate();
        $shipment = $this->requests->markSent($r->id, $d['reference'], $request->user());

        return response()->json(['message' => "Penyerahan ke-{$shipment['sequence']} dicatat ({$shipment['lines']} baris material).", 'data' => $shipment]);
    }

    public function cancel(Request $request, string $request_): JsonResponse
    {
        $r = $this->find($request_);
        $this->managed($request, $r);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->requests->cancel($r->id, $d['reason'], $request->user());

        return response()->json(['message' => 'Permintaan dibatalkan.']);
    }

    private function managed(Request $request, object $r): void
    {
        $this->authorizer->authorizeScope($request->user(), 'material_requests.manage');
        $this->authorizer->authorizeOnUnit($request->user(), 'material_requests.manage', (string) DB::table('applications')->where('id', $r->application_id)->value('organizational_unit_id'));
    }

    private function viewable(Request $request, object $r): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'material_requests.view');
        if (! $scope['unrestricted'] && ! in_array((string) DB::table('applications')->where('id', $r->application_id)->value('organizational_unit_id'), $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function find(string $id): object
    {
        return DB::table('material_requests')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** A text cell that a spreadsheet would run as a formula (starts with = + - @, tab or CR) gets a leading apostrophe; numbers stay numbers. */
    public static function csvSafe(mixed $v): mixed
    {
        return is_string($v) && $v !== '' && ! is_numeric($v) && preg_match('/^[=+\-@\t\r]/', $v) === 1 ? "'".$v : $v;
    }
}
