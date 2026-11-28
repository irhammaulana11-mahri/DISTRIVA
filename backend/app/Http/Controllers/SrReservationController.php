<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Inventory\SrReservationService;
use App\Services\Proposals\ProposalService;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Reservation plans of connections without network extension (docs/95). The preparing and approving keys depend on the source warehouse: `*_ulp` (Niaga of the ULP) or `*_up3`
 * (Konstruksi prepares, Asman Konstruksi approves; the approver is not the submitter unless SYS_ADMIN). Violations -> 409, authorization -> 403/404.
 */
class SrReservationController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly SrReservationService $reservations) {}

    /** GET /sr-reservations/pending — applications ready to install (survey "no extension") that have no running plan yet, oldest first. */
    public function pending(Request $request): JsonResponse
    {
        $filters = $request->validate(['unit_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $owner = ApplicationController::SURVEY_OWNER_SQL;
        $query = $this->scoped($request, DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id'))
            ->whereIn('a.current_status', SrReservationService::WAITING_STATUSES)
            ->whereRaw("(select s.status from application_surveys s where s.application_id = {$owner} and s.status <> 'CANCELLED' order by s.sequence_number desc limit 1) = 'ACCEPTED'")
            ->whereRaw("(select sv.requires_network_extension from application_surveys s join application_survey_versions sv on sv.survey_id = s.id where s.application_id = {$owner} and s.status <> 'CANCELLED' order by s.sequence_number desc, sv.version_number desc limit 1) is false")
            ->whereNotExists(fn ($q) => $q->from('sr_reservations as r')->whereColumn('r.application_id', 'a.id')->where('r.status', '<>', 'CANCELLED'))
            ->when($filters['unit_id'] ?? null, fn ($q, $unit) => $q->where('a.organizational_unit_id', $unit))
            ->when($filters['search'] ?? null, fn ($q, $search) => $q->where(fn ($w) => $w->where('a.application_number', 'ilike', "%{$search}%")->orWhere('c.name', 'ilike', "%{$search}%")))
            ->orderBy('a.created_at')->orderBy('a.id');
        $page = $query->select(['a.id', 'a.application_number', 'a.application_type', 'a.current_status', 'a.new_power_value', 'a.new_power_unit', 'a.organizational_unit_id', 'c.name as customer_name', 'u.code as unit_code', 'u.name as unit_name'])
            ->paginate($filters['per_page'] ?? 25);
        $contracts = [];

        return response()->json([
            'data' => collect($page->items())->map(function ($a) use (&$contracts): array {
                $va = SrReservationService::powerVa($a);
                $phase = $va === null ? null : SrReservationService::phaseOf($va);
                $contract = $phase === 1 ? ($contracts[$a->organizational_unit_id] ??= $this->reservations->contractFor($a->organizational_unit_id)) : null;

                return ['application_id' => $a->id, 'application_number' => $a->application_number, 'application_type' => $a->application_type, 'status' => $a->current_status, 'customer_name' => $a->customer_name,
                    'unit' => ['id' => $a->organizational_unit_id, 'code' => $a->unit_code, 'name' => $a->unit_name], 'power_va' => $va, 'phase' => $phase,
                    'default_vendor' => $contract === null ? null : ['id' => $contract->vendor_company_id, 'name' => $contract->vendor_name]];
            })->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    /** GET /applications/{id}/sr-reservations — what the form needs (phase, executor, warehouses, blockers) and the plans so far. */
    public function forApplication(Request $request, string $application): JsonResponse
    {
        $app = $this->application($application);
        $this->viewable($request, $app->organizational_unit_id);
        $va = SrReservationService::powerVa($app);
        $phase = $va === null ? null : SrReservationService::phaseOf($va);
        $contract = $phase === 1 ? $this->reservations->contractFor($app->organizational_unit_id) : null;
        $blockers = $this->reservations->blockers($app);
        if ($phase === 1 && $contract === null) {
            $blockers[] = 'ULP ini belum punya kontrak pelaksana 1 phasa yang berlaku hari ini.';
        }
        $surveyLength = DB::table('application_surveys as s')->join('application_survey_versions as v', 'v.survey_id', '=', 's.id')->where('s.application_id', ProposalService::surveyOwnerId($application))
            ->where('s.status', 'ACCEPTED')->orderByDesc('s.sequence_number')->orderByDesc('v.version_number')->value('v.sr_length_m');

        return response()->json(['data' => [
            'power_va' => $va, 'phase' => $phase, 'blockers' => $blockers,
            'default_sr_length_m' => (float) config('distriva.sr_reservation.default_sr_length_m'), 'survey_sr_length_m' => $surveyLength === null ? null : (float) $surveyLength,
            'contract' => $contract === null ? null : ['id' => $contract->id, 'contract_number' => $contract->contract_number, 'vendor' => ['id' => $contract->vendor_company_id, 'code' => $contract->vendor_code, 'name' => $contract->vendor_name]],
            'warehouses' => array_map(fn ($w) => ['id' => $w->id, 'code' => $w->code, 'name' => $w->name, 'level' => $w->level], $this->reservations->warehousesFor($app->organizational_unit_id)),
            'reservations' => $this->listQuery()->where('r.application_id', $application)->orderByDesc('r.version_number')->get()->map(fn ($r) => $this->summary($r))->all(),
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate(['status' => ['nullable', 'in:DRAFT,SUBMITTED,APPROVED,RECORDED,CANCELLED'], 'source_level' => ['nullable', 'in:ULP,UP3'], 'unit_id' => ['nullable', 'uuid'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $page = $this->scoped($request, $this->listQuery())
            ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('r.status', $v))
            ->when($filters['source_level'] ?? null, fn ($q, $v) => $q->where('r.source_level', $v))
            ->when($filters['unit_id'] ?? null, fn ($q, $v) => $q->where('a.organizational_unit_id', $v))
            ->orderByDesc('r.created_at')->orderBy('r.id')->paginate($filters['per_page'] ?? 25);

        return response()->json(['data' => collect($page->items())->map(fn ($r) => $this->summary($r))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(Request $request, string $reservation): JsonResponse
    {
        $r = $this->listQuery()->where('r.id', $reservation)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, $r->organizational_unit_id);
        $lines = DB::table('sr_reservation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.sr_reservation_id', $reservation)->orderBy('k.code')->get(['l.*', 'k.code']);
        $names = DB::table('khs_item_versions')->whereIn('khs_item_id', $lines->pluck('khs_item_id'))->where('status', 'APPROVED')->orderBy('valid_from')->get(['khs_item_id', 'name', 'unit_text'])->keyBy('khs_item_id');
        $skus = DB::table('khs_material_map')->whereIn('khs_item_id', $lines->pluck('khs_item_id'))->orderBy('material_no')->get()->groupBy('khs_item_id');
        $events = DB::table('sr_reservation_events as e')->join('users as u', 'u.id', '=', 'e.actor_id')->where('e.sr_reservation_id', $reservation)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.name']);

        return response()->json(['data' => $this->summary($r) + [
            'notes' => $r->notes, 'bom_group' => $r->bom_group, 'cancel_reason' => $r->cancel_reason,
            'mims_found_in_mirror' => $r->mims_reservation_no !== null && DB::table('mims_reservations')->where('reservation_no', $r->mims_reservation_no)->exists(),
            'lines' => $lines->map(fn ($l) => ['khs_code' => $l->code, 'khs_name' => $names[$l->khs_item_id]->name ?? null, 'unit_text' => $names[$l->khs_item_id]->unit_text ?? null,
                'material_numbers' => ($skus[$l->khs_item_id] ?? collect())->pluck('material_no')->all(), 'quantity_bom' => (float) $l->quantity_bom, 'quantity' => (float) $l->quantity, 'correction_reason' => $l->correction_reason])->all(),
            'events' => $events->map(fn ($e) => ['type' => $e->event_type, 'actor' => $e->name, 'reason' => $e->reason, 'details' => $e->details === null ? null : json_decode($e->details, true), 'occurred_at' => $e->occurred_at])->all(),
        ]]);
    }

    public function store(Request $request, string $application): JsonResponse
    {
        $app = $this->application($application);
        $in = $request->validate(['warehouse_id' => ['required', 'uuid'], 'vendor_company_id' => ['nullable', 'uuid'], 'sr_length_m' => ['nullable', 'numeric', 'gt:0', 'max:10000'], 'notes' => ['nullable', 'string', 'max:2000']]);
        $warehouse = collect($this->reservations->warehousesFor($app->organizational_unit_id))->firstWhere('id', $in['warehouse_id']);
        $this->viewable($request, $app->organizational_unit_id);
        if ($warehouse !== null) {
            $this->authorizeLevel($request, 'prepare', $warehouse->level, $app->organizational_unit_id);
        }

        return response()->json(['data' => ['id' => $this->reservations->create($application, $in, $request->user())]], 201);
    }

    public function update(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation, 'prepare');
        $in = $request->validate(['sr_length_m' => ['sometimes', 'numeric', 'gt:0', 'max:10000'], 'vendor_company_id' => ['sometimes', 'uuid'], 'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'corrections' => ['sometimes', 'array', 'max:100'], 'corrections.*.khs_code' => ['required', 'string', 'max:50', 'distinct'], 'corrections.*.quantity' => ['required', 'numeric', 'gte:0', 'max:1000000'], 'corrections.*.reason' => ['nullable', 'string', 'max:500']]);
        $this->reservations->update($reservation, $in, $request->user());

        return response()->json(['message' => 'Rencana reservasi disimpan.']);
    }

    public function submit(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation, 'prepare');
        $this->reservations->submit($reservation, $request->user());

        return response()->json(['message' => 'Rencana reservasi diajukan.']);
    }

    public function decide(Request $request, string $reservation): JsonResponse
    {
        $r = $this->authorizeOn($request, $reservation, 'approve');
        $in = $request->validate(['decision' => ['required', 'in:APPROVE,RETURN'], 'reason' => ['nullable', 'string', 'max:1000']]);
        $actor = $request->user();
        if ($r->source_level === 'UP3' && $r->submitted_by === $actor->getKey() && $this->authorizer->roleFor($actor, 'sr_reservations.approve_up3') !== 'SYS_ADMIN') {
            throw new AdministrationDenied('Pengaju tidak dapat memutus rencananya sendiri.', 403);
        }
        $this->reservations->decide($reservation, $in['decision'], $in['reason'] ?? null, $actor);

        return response()->json(['message' => $in['decision'] === 'APPROVE' ? 'Rencana reservasi disetujui.' : 'Rencana reservasi dikembalikan.']);
    }

    public function recordMims(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeEither($request, $reservation);
        $in = $request->validate(['reservation_no' => ['required', 'string', 'max:30']]);
        $this->reservations->recordMims($reservation, $in['reservation_no'], $request->user());

        return response()->json(['message' => 'Nomor reservasi MIMS dicatat.']);
    }

    public function cancel(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeEither($request, $reservation);
        $in = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->reservations->cancel($reservation, $in['reason'], $request->user());

        return response()->json(['message' => 'Rencana reservasi dibatalkan.']);
    }

    private function authorizeOn(Request $request, string $reservation, string $action): object
    {
        $r = $this->find($reservation);
        $this->authorizeLevel($request, $action, $r->source_level, $r->organizational_unit_id);

        return $r;
    }

    /** Recording the MIMS number and cancelling: whoever prepares or approves at the plan's level. */
    private function authorizeEither(Request $request, string $reservation): void
    {
        $r = $this->find($reservation);
        $action = $this->authorizer->roleFor($request->user(), 'sr_reservations.prepare_'.strtolower($r->source_level)) !== null ? 'prepare' : 'approve';
        $this->authorizeLevel($request, $action, $r->source_level, $r->organizational_unit_id);
    }

    private function authorizeLevel(Request $request, string $action, string $level, string $unitId): void
    {
        $this->authorizer->authorizeOnUnit($request->user(), "sr_reservations.{$action}_".strtolower($level), $unitId);
    }

    private function find(string $id): object
    {
        return DB::table('sr_reservations as r')->join('applications as a', 'a.id', '=', 'r.application_id')->where('r.id', $id)->first(['r.*', 'a.organizational_unit_id'])
            ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function application(string $id): object
    {
        return DB::table('applications')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function viewable(Request $request, string $unitId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'sr_reservations.view');
        if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function scoped(Request $request, Builder $query): Builder
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'sr_reservations.view');

        return $scope['unrestricted'] ? $query : $query->whereIn('a.organizational_unit_id', $scope['units']);
    }

    private function listQuery(): Builder
    {
        return DB::table('sr_reservations as r')->join('applications as a', 'a.id', '=', 'r.application_id')->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')->join('vendor_companies as v', 'v.id', '=', 'r.vendor_company_id')
            ->leftJoin('sr_vendor_contracts as k', 'k.id', '=', 'r.vendor_contract_id')
            ->select(['r.*', 'a.application_number', 'a.organizational_unit_id', 'c.name as customer_name', 'u.code as unit_code', 'u.name as unit_name', 'w.code as warehouse_code', 'w.name as warehouse_name', 'w.plant', 'w.stor_loc',
                'v.code as vendor_code', 'v.name as vendor_name', 'k.contract_number'])
            ->selectRaw("(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active order by e.created_at desc limit 1) as agenda_number");
    }

    /** @return array<string,mixed> */
    private function summary(object $r): array
    {
        return ['id' => $r->id, 'version_number' => (int) $r->version_number, 'status' => $r->status, 'phase' => (int) $r->phase, 'power_va' => (int) $r->power_va, 'source_level' => $r->source_level,
            'application' => ['id' => $r->application_id, 'number' => $r->application_number, 'agenda_number' => $r->agenda_number, 'customer_name' => $r->customer_name],
            'unit' => ['id' => $r->organizational_unit_id, 'code' => $r->unit_code, 'name' => $r->unit_name],
            'warehouse' => ['id' => $r->warehouse_id, 'code' => $r->warehouse_code, 'name' => $r->warehouse_name, 'plant' => $r->plant, 'stor_loc' => $r->stor_loc],
            'vendor' => ['id' => $r->vendor_company_id, 'code' => $r->vendor_code, 'name' => $r->vendor_name, 'contract_number' => $r->contract_number],
            'sr_length_m' => (float) $r->sr_length_m, 'mims_reservation_no' => $r->mims_reservation_no, 'created_at' => $r->created_at, 'submitted_at' => $r->submitted_at, 'approved_at' => $r->approved_at,
            'mims_recorded_at' => $r->mims_recorded_at, 'cancelled_at' => $r->cancelled_at];
    }
}
