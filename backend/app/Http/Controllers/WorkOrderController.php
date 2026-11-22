<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\UnitFilter;
use App\Services\Inventory\AllocationService;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\WorkOrders\PoleWorkOrderService;
use App\Services\WorkOrders\VendorService;
use App\Services\WorkOrders\WorkOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Work orders (docs/62 §32). Internal actors act through keys on the application's unit; a VENDOR user only through the persisted relation
 * account -> company -> the company assigned to an ISSUED/IN_PROGRESS work order (never from request claims). Violations -> 409, authorization -> 403/404.
 */
class WorkOrderController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly WorkOrderService $orders, private readonly WorkflowNotifier $flow, private readonly AllocationService $allocations, private readonly PoleWorkOrderService $poleOrders) {}

    public function create(Request $request, string $application): JsonResponse
    {
        $this->internal($request, 'wo.create', $this->unitOfApplication($application));

        return response()->json(['data' => ['id' => $this->orders->create($application, $request->user())]], 201);
    }

    public function amend(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.create', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();

        return response()->json(['data' => ['id' => $this->orders->amend($wo, $d['reason'], $request->user())]], 201);
    }

    public function setVendor(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.create', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['vendor_company_id' => ['required', 'uuid'], 'note' => ['nullable', 'string', 'max:1000'], 'target_date' => ['nullable', 'date_format:Y-m-d']])->validate();
        $this->orders->setVendor($wo, $d['vendor_company_id'], $d['note'] ?? null, $request->user(), $d['target_date'] ?? null);

        return response()->json(['message' => 'Vendor dipilih.']);
    }

    public function setTargetDate(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.create', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['target_date' => ['required', 'date_format:Y-m-d'], 'reason' => ['nullable', 'string', 'max:1000']])->validate();
        $this->orders->setTargetDate($wo, $d['target_date'], $d['reason'] ?? null, $request->user());

        return response()->json(['message' => 'Target selesai disimpan.']);
    }

    public function submit(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.create', $this->unitOfApplication($w->application_id));
        $this->orders->submit($wo, $request->user());
        $this->flow->woSubmitted($wo, $request->user());

        return response()->json(['message' => 'WO diajukan.']);
    }

    public function decide(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.issue', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['decision' => ['required', 'in:ISSUE,RETURN'], 'reason' => ['nullable', 'string', 'max:2000']])->validate();
        $this->orders->decide($wo, $d['decision'], $d['reason'] ?? null, $request->user());
        $this->flow->woDecided($wo, $d['decision'], $d['reason'] ?? null, $request->user());

        return response()->json(['message' => $d['decision'] === 'ISSUE' ? 'WO dan vendor disetujui; WO diterbitkan.' : 'WO dikembalikan.']);
    }

    public function submitProgress(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $actor = $request->user();
        $vendorCompany = $this->vendorCompany($actor);
        if ($vendorCompany === null) {
            throw new AdministrationDenied('Progres pekerjaan hanya dilaporkan oleh akun Pelaksana (vendor); Konstruksi memverifikasinya.', 403);
        }
        if ($w->vendor_company_id !== $vendorCompany) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $d = Validator::make($request->all(), ['task_id' => ['required', 'uuid'], 'submission_key' => ['required', 'string', 'max:80'], 'cumulative_percent' => ['required', 'numeric', 'min:0', 'max:100'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $r = $this->orders->submitProgress($wo, $d['task_id'], $d['submission_key'], (float) $d['cumulative_percent'], $d['notes'] ?? null, $actor);
        if (! $r['replayed']) {
            $this->flow->progressSubmitted($wo, $actor);
        }

        return response()->json(['data' => ['id' => $r['id']], 'replayed' => $r['replayed']], $r['replayed'] ? 200 : 201);
    }

    public function decideProgress(Request $request, string $progress): JsonResponse
    {
        $p = DB::table('wo_progress')->where('id', $progress)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $w = $this->find($p->work_order_id);
        $this->internal($request, 'wo.progress_verify', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['decision' => ['required', 'in:VERIFIED,RETURNED'], 'reason' => ['nullable', 'string', 'max:2000']])->validate();
        $this->orders->decideProgress($progress, $d['decision'], $d['reason'] ?? null, $request->user());
        $this->flow->progressDecided($progress, $d['decision'], $d['reason'] ?? null, $request->user());

        return response()->json(['message' => 'Keputusan progres dicatat.']);
    }

    /** Kept only to explain the rule: the BASTP (closed by ASMAN_KONSTRUKSI) completes the WO (owner 7 Nov 2026). */
    public function complete(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.complete', $this->unitOfApplication($w->application_id));

        throw new AssignmentRuleViolation('WO diselesaikan lewat BASTP: vendor atau TEKNIK mengajukan BASTP, MANAGER_ULP menerima, KONSTRUKSI_UP3 menandatangani, dan ASMAN_KONSTRUKSI menutupnya (penutupan itulah yang menyelesaikan WO).');
    }

    public function cancel(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internal($request, 'wo.complete', $this->unitOfApplication($w->application_id));
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->orders->cancel($wo, $d['reason'], $request->user());
        $this->flow->woCancelled($wo, $d['reason'], $request->user());

        return response()->json(['message' => 'WO dibatalkan.']);
    }

    /** GET /work-orders — internal: by scope; vendor: the ISSUED/IN_PROGRESS/COMPLETED orders of its own company. */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();
        $q = DB::table('work_orders as w')->join('applications as a', 'a.id', '=', 'w.application_id')->orderByDesc('w.created_at');
        $company = $this->vendorCompany($actor);
        if ($company !== null) {
            $q->where('w.vendor_company_id', $company)->whereIn('w.status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED']);
        } else {
            $scope = $this->authorizer->authorizeScope($actor, 'wo.view');
            if (! $scope['unrestricted']) {
                $q->whereIn('a.organizational_unit_id', $scope['units']);
            }
        }
        $request->validate(UnitFilter::rules());
        UnitFilter::apply($q, $request, 'a.organizational_unit_id');

        $rows = $q->leftJoin('vendor_companies as v', 'v.id', '=', 'w.vendor_company_id')
            ->get(['w.id', 'w.wo_number', 'w.status', 'w.version_number', 'w.vendor_company_id', 'a.application_number', 'w.created_at', 'w.issued_at', 'w.completed_at', 'w.target_date', 'v.code as vendor_code', 'v.name as vendor_name']);
        $stats = $this->progressStats($rows->pluck('id')->all());

        return response()->json(['data' => $rows->map(fn ($w) => (array) $w + ($stats[$w->id] ?? ['progress_percent' => null, 'pending_progress' => 0]))->all()]);
    }

    /**
     * One row per application (No. Agenda) that has — or may be given — a network WO and/or pole WOs, so both kinds read as one story.
     * Visibility follows each kind's own permission and unit scope; a vendor sees only the issued WOs of its own company.
     */
    public function byAgenda(Request $request): JsonResponse
    {
        $actor = $request->user();
        $request->validate(UnitFilter::rules());
        $company = $this->vendorCompany($actor);
        $netScope = $poleScope = $createNet = $createPole = $mrScope = null;
        if ($company === null) {
            $netScope = $this->scopeOrNull($actor, 'wo.view');
            $poleScope = $this->scopeOrNull($actor, 'pole_wo.view');
            $createNet = $this->scopeOrNull($actor, 'wo.create');
            $createPole = $this->scopeOrNull($actor, 'pole_wo.manage');
            $mrScope = $this->scopeOrNull($actor, 'material_requests.view');
            if ($netScope === null && $poleScope === null) {
                throw new AdministrationDenied('Tidak berwenang.', 403);
            }
        }
        $inScope = fn (?array $scope, string $col) => fn ($q) => $scope === null || $scope['unrestricted'] ? $q : $q->whereIn($col, $scope['units']);
        $visible = ['ISSUED', 'IN_PROGRESS', 'COMPLETED'];

        $network = collect();
        if ($company !== null || $netScope !== null) {
            $q = DB::table('work_orders as w')->join('applications as a', 'a.id', '=', 'w.application_id')->leftJoin('vendor_companies as v', 'v.id', '=', 'w.vendor_company_id')->orderByDesc('w.version_number');
            $company !== null ? $q->where('w.vendor_company_id', $company)->whereIn('w.status', $visible) : $inScope($netScope, 'a.organizational_unit_id')($q);
            // the latest version per application stands for the network WO; earlier versions are in the detail
            $network = $q->get(['w.id', 'w.application_id', 'w.wo_number', 'w.status', 'w.version_number', 'w.issued_at', 'w.completed_at', 'w.target_date', 'v.name as vendor_name', 'v.code as vendor_code'])->unique('application_id')->keyBy('application_id');
        }
        $stats = $this->progressStats($network->pluck('id')->all());

        $poles = collect();
        $poleProgress = collect();
        if ($company !== null || $poleScope !== null) {
            $q = DB::table('pole_wo_lines as pl')->join('pole_work_orders as pw', 'pw.id', '=', 'pl.pole_work_order_id')->join('applications as a', 'a.id', '=', 'pl.application_id')
                ->join('vendor_companies as v', 'v.id', '=', 'pw.vendor_company_id')->where('pw.status', '<>', 'CANCELLED')->orderBy('pw.letter_date', 'desc');
            $company !== null ? $q->where('pw.vendor_company_id', $company)->whereIn('pw.status', $visible) : $inScope($poleScope, 'a.organizational_unit_id')($q);
            $poles = $q->groupBy('pl.application_id', 'pw.id', 'v.id')->get(['pl.application_id', 'pw.id', 'pw.letter_number', 'pw.status', 'pw.revision_number', 'v.name as vendor_name', DB::raw('sum(pl.quantity) as quantity')])->groupBy('application_id');
            // verified progress of a pole WO for this application: the quantity-weighted mean of the verified percentage of its locations
            $lineRows = DB::table('pole_wo_lines as pl')->leftJoin(DB::raw("(select line_id, max(cumulative_percent) as v from pole_wo_progress where status = 'VERIFIED' group by line_id) as p"), 'p.line_id', '=', 'pl.id')
                ->whereIn('pl.pole_work_order_id', $poles->flatten(1)->pluck('id')->unique())->get(['pl.pole_work_order_id', 'pl.application_id', 'pl.quantity', DB::raw('coalesce(p.v, 0) as v')]);
            $poleProgress = $lineRows->groupBy(fn ($l) => $l->application_id.'|'.$l->pole_work_order_id)->map(fn ($g) => $g->sum('quantity') > 0 ? round($g->sum(fn ($l) => $l->quantity * (float) $l->v) / $g->sum('quantity'), 1) : null);
        }

        // applications that may still be given a WO (the create button), limited to what the actor may create
        $netCreatable = collect();
        if ($createNet !== null) {
            $q = DB::table('applications as a')->whereExists(fn ($s) => $s->select(DB::raw(1))->from('mto_packages as m')->whereColumn('m.application_id', 'a.id')->where('m.status', 'APPROVED'))
                ->whereExists(fn ($s) => $s->select(DB::raw(1))->from('rab_runs as r')->whereColumn('r.application_id', 'a.id'))
                ->whereNotExists(fn ($s) => $s->select(DB::raw(1))->from('work_orders as w')->whereColumn('w.application_id', 'a.id')->whereIn('w.status', ['DRAFT', 'SUBMITTED', 'ISSUED', 'IN_PROGRESS', 'COMPLETED']));
            $inScope($createNet, 'a.organizational_unit_id')($q);
            $netCreatable = $q->pluck('a.id')->flip();
        }
        $poleCreatable = collect();
        if ($createPole !== null) {
            $poleCreatable = collect($this->poleOrders->candidates($createPole['unrestricted'] ? null : $createPole['units']))->groupBy('application_id')->map(fn ($c) => (int) $c->sum('quantity'));
        }

        $ids = collect($network->keys())->merge($poles->keys())->merge($netCreatable->keys())->merge($poleCreatable->keys())->unique()->values();
        if (is_string($request->query('application_id'))) {
            $ids = $ids->filter(fn ($id) => $id === $request->query('application_id'));
        }
        $ids = $ids->all();
        // the outbox of the material need (docs/62 §40): its latest request per agenda, and whether any request still needs a follow-up
        $requests = collect();
        if ($mrScope !== null && $ids !== []) {
            $q = DB::table('material_requests as r')->join('applications as a', 'a.id', '=', 'r.application_id')->whereIn('r.application_id', $ids)->orderByDesc('r.created_at');
            $inScope($mrScope, 'a.organizational_unit_id')($q);
            $requests = $q->get(['r.id', 'r.application_id', 'r.status', 'r.needs_followup', 'r.fulfilment', 'r.ready_to_send', 'r.oversent', 'r.external_reference'])->groupBy('application_id');
        }
        $agenda = "(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active order by e.created_at desc limit 1)";
        $apps = DB::table('applications as a')->leftJoin('customers as cu', 'cu.id', '=', 'a.customer_id')->join('organizational_units as o', 'o.id', '=', 'a.organizational_unit_id')
            ->whereIn('a.id', $ids)->orderByDesc('a.created_at');
        UnitFilter::apply($apps, $request, 'a.organizational_unit_id');
        $apps = $apps->get(['a.id', 'a.application_number', 'a.current_status', 'a.application_type', 'cu.name as customer_name', 'o.name as unit_name', DB::raw("{$agenda} as agenda_number")]);

        return response()->json(['data' => $apps->map(function ($a) use ($network, $stats, $poles, $netCreatable, $poleCreatable, $requests) {
            $n = $network[$a->id] ?? null;

            return [
                'application_id' => $a->id, 'application_number' => $a->application_number, 'agenda_number' => $a->agenda_number, 'application_type' => $a->application_type,
                'application_status' => $a->current_status, 'customer_name' => $a->customer_name, 'unit_name' => $a->unit_name,
                'network' => $n === null ? null : (array) $n + ($stats[$n->id] ?? ['progress_percent' => null, 'pending_progress' => 0]),
                'network_creatable' => isset($netCreatable[$a->id]),
                'poles' => ($poles[$a->id] ?? collect())->map(fn ($p) => ['id' => $p->id, 'letter_number' => $p->letter_number, 'status' => $p->status, 'revision_number' => (int) $p->revision_number, 'vendor_name' => $p->vendor_name, 'quantity' => (int) $p->quantity, 'progress_percent' => $poleProgress[$a->id.'|'.$p->id] ?? null])->values()->all(),
                'poles_creatable_quantity' => (int) ($poleCreatable[$a->id] ?? 0),
                'material_request' => isset($requests[$a->id]) ? ['id' => $requests[$a->id][0]->id, 'status' => $requests[$a->id][0]->status, 'external_reference' => $requests[$a->id][0]->external_reference, 'needs_followup' => $requests[$a->id]->contains(fn ($r) => (bool) $r->needs_followup || (bool) $r->oversent), 'fulfilment' => $requests[$a->id][0]->fulfilment, 'ready_to_send' => (bool) $requests[$a->id][0]->ready_to_send, 'oversent' => $requests[$a->id]->contains(fn ($r) => (bool) $r->oversent), 'count' => $requests[$a->id]->count()] : null,
            ];
        })->all()]);
    }

    /** Official task progress = max(baseline, best VERIFIED submission), averaged per WO in one query, plus the submissions awaiting verification. */
    private function progressStats(array $woIds): array
    {
        $avg = DB::table('wo_tasks as t')
            ->leftJoin(DB::raw("(select task_id, max(cumulative_percent) as v from wo_progress where status = 'VERIFIED' group by task_id) as p"), 'p.task_id', '=', 't.id')
            ->whereIn('t.work_order_id', $woIds)->groupBy('t.work_order_id')
            ->selectRaw('t.work_order_id, avg(greatest(t.baseline_percent, coalesce(p.v, 0))) as avg_percent')->pluck('avg_percent', 'work_order_id');
        $pending = DB::table('wo_progress')->whereIn('work_order_id', $woIds)->where('status', 'SUBMITTED')->groupBy('work_order_id')
            ->selectRaw('work_order_id, count(*) as c')->pluck('c', 'work_order_id');
        $out = [];
        foreach ($woIds as $id) {
            $out[$id] = ['progress_percent' => isset($avg[$id]) ? round((float) $avg[$id], 1) : null, 'pending_progress' => (int) ($pending[$id] ?? 0)];
        }

        return $out;
    }

    private function scopeOrNull(User $actor, string $permission): ?array
    {
        try {
            return $this->authorizer->authorizeScope($actor, $permission);
        } catch (AdministrationDenied) {
            return null;
        }
    }

    public function forApplication(Request $request, string $application): JsonResponse
    {
        $this->viewable($request, $this->unitOfApplication($application));

        return response()->json(['data' => DB::table('work_orders')->where('application_id', $application)->orderByDesc('version_number')->get(['id', 'wo_number', 'status', 'version_number', 'created_at'])->map(fn ($w) => (array) $w)->all()]);
    }

    public function show(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $company = $this->vendorCompany($request->user());
        if ($company !== null) {
            if ($w->vendor_company_id !== $company || ! in_array($w->status, ['ISSUED', 'IN_PROGRESS', 'COMPLETED'], true)) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
        } else {
            $this->viewable($request, $this->unitOfApplication($w->application_id));
        }
        $tasks = DB::table('wo_tasks')->where('work_order_id', $wo)->orderBy('sequence')->get();
        $progress = DB::table('wo_progress as p')->join('users as u', 'u.id', '=', 'p.submitted_by')->where('p.work_order_id', $wo)->orderBy('p.submitted_at')->get(['p.*', 'u.name as submitted_by_name']);
        $materials = DB::table('wo_materials as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->where('m.work_order_id', $wo)->orderByRaw('length(k.code), k.code')->get(['k.id as khs_item_id', 'k.code', 'm.quantity']);
        // names and units come from the MTO package lines the WO was built from (a snapshot), the latest KHS version as fallback
        $mtoText = DB::table('mto_lines')->where('package_id', $w->mto_package_id)->whereIn('khs_item_id', $materials->pluck('khs_item_id'))->whereNotNull('khs_name')->get(['khs_item_id', 'khs_name', 'unit_text'])->unique('khs_item_id')->keyBy('khs_item_id');
        $khsText = DB::table('khs_item_versions')->whereIn('khs_item_id', $materials->pluck('khs_item_id'))->orderBy('version_number')->get(['khs_item_id', 'name', 'unit_text'])->keyBy('khs_item_id');
        $events = $company !== null ? collect() : DB::table('wo_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.work_order_id', $wo)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.name as actor_name']);

        return response()->json(['data' => [
            'id' => $w->id, 'wo_number' => $w->wo_number, 'application_id' => $w->application_id, 'application_number' => DB::table('applications')->where('id', $w->application_id)->value('application_number'),
            'version_number' => (int) $w->version_number, 'status' => $w->status, 'vendor_company_id' => $w->vendor_company_id, 'vendor_name' => $w->vendor_company_id ? DB::table('vendor_companies')->where('id', $w->vendor_company_id)->value('name') : null, 'vendor_note' => $company === null ? $w->vendor_note : null,
            'material_warning' => $company === null && in_array($w->status, ['DRAFT', 'SUBMITTED', 'ISSUED', 'IN_PROGRESS'], true) ? $this->allocations->shortfall($w->application_id) : [],
            'amended_from_id' => $w->amended_from_id, 'amendment_reason' => $w->amendment_reason, 'return_reason' => $w->return_reason, 'issued_at' => $w->issued_at, 'completed_at' => $w->completed_at, 'target_date' => $w->target_date, 'cancel_reason' => $w->cancel_reason,
            'tasks' => $tasks->map(fn ($t) => ['id' => $t->id, 'sequence' => (int) $t->sequence, 'group_code' => $t->group_code, 'title' => $t->title, 'unit' => $t->unit_text, 'volume' => (float) $t->volume, 'amount' => $company === null ? (float) $t->amount : null,
                'verified_percent' => $this->orders->verifiedPercent($t)])->all(),
            'materials' => $materials->map(fn ($m) => ['khs_code' => $m->code, 'khs_name' => $mtoText[$m->khs_item_id]->khs_name ?? $khsText[$m->khs_item_id]->name ?? $m->code, 'unit' => $mtoText[$m->khs_item_id]->unit_text ?? $khsText[$m->khs_item_id]->unit_text ?? null, 'quantity' => (float) $m->quantity])->all(),
            'progress' => $progress->map(fn ($p) => ['id' => $p->id, 'task_id' => $p->task_id, 'cumulative_percent' => (float) $p->cumulative_percent, 'status' => $p->status, 'notes' => $p->notes, 'submitted_by_name' => $p->submitted_by_name, 'submitted_at' => $p->submitted_at, 'decided_at' => $p->decided_at, 'return_reason' => $p->return_reason])->all(),
            'events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_name' => $e->actor_name])->all(),
        ]]);
    }

    private function internal(Request $request, string $key, string $unitId): void
    {
        $this->authorizer->authorizeScope($request->user(), $key);
        $this->authorizer->authorizeOnUnit($request->user(), $key, $unitId);
    }

    private function viewable(Request $request, string $unitId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'wo.view');
        if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function vendorCompany(User $user): ?string
    {
        return VendorService::companyOf($user);
    }

    private function find(string $id): object
    {
        return DB::table('work_orders')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function unitOfApplication(string $id): string
    {
        return (string) (DB::table('applications')->where('id', $id)->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404));
    }
}
