<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Inventory\SrReservationService;
use App\Services\Proposals\ProposalService;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Collective reservations of connections without network extension (docs/95). There is no approval step; the key depends on the source warehouse: `sr_reservations.prepare_ulp` (Niaga of the
 * ULP) or `sr_reservations.prepare_up3` (Konstruksi). Violations -> 409, authorization -> 403/404.
 */
class SrReservationController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly SrReservationService $reservations) {}

    /**
     * GET /sr-reservations/pending — the work list: paid 1-phase applications (no survey needed) and 3-phase ones surveyed "no extension" that have no running plan, oldest first.
     * `already_reserved` marks those whose agenda already has a reservation (or issue) in the MIMS mirror; they are not to be planned again.
     */
    public function pending(Request $request): JsonResponse
    {
        $filters = $request->validate(['unit_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'phase' => ['nullable', 'in:1,3'], 'reserved' => ['nullable', 'boolean'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $owner = ApplicationController::SURVEY_OWNER_SQL;
        $onePhase = SrReservationService::onePhaseSql();
        $surveyStatus = "(select s.status from application_surveys s where s.application_id = {$owner} and s.status <> 'CANCELLED' order by s.sequence_number desc limit 1)";
        $extends = "(select sv.requires_network_extension from application_surveys s join application_survey_versions sv on sv.survey_id = s.id where s.application_id = {$owner} and s.status <> 'CANCELLED' order by s.sequence_number desc, sv.version_number desc limit 1)";
        $reserved = $this->reservedInMimsSql();

        $query = $this->scoped($request, DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id'))
            ->whereNotNull('a.new_power_value')
            ->where(fn (Builder $w) => $w
                ->where(fn (Builder $one) => $one->whereRaw($onePhase)->whereIn('a.current_status', SrReservationService::ONE_PHASE_STATUSES)
                    ->whereRaw("({$surveyStatus} is null or ({$surveyStatus} = 'ACCEPTED' and {$extends} is false))")
                    ->whereRaw('not '.SrReservationService::hasFindingSql())
                    ->whereNotExists(fn ($q) => $q->from('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->whereColumn('pa.application_id', 'a.id')->whereNull('pa.released_at')->where('p.status', 'OPEN')))
                ->orWhere(fn (Builder $three) => $three->whereRaw("not {$onePhase}")->whereIn('a.current_status', SrReservationService::WAITING_STATUSES)
                    ->whereRaw("{$surveyStatus} = 'ACCEPTED'")->whereRaw("{$extends} is false")))
            ->whereNotExists(fn ($q) => $q->from('sr_reservation_applications as x')->whereColumn('x.application_id', 'a.id')->whereNull('x.released_at'))
            ->whereNotExists(fn ($q) => $q->from('allocations as al')->whereColumn('al.application_id', 'a.id')->where('al.status', '<>', 'CANCELLED'))
            ->when($filters['unit_id'] ?? null, fn ($q, $unit) => $q->where('a.organizational_unit_id', $unit))
            ->when($filters['search'] ?? null, fn ($q, $search) => $q->where(fn ($w) => $w->where('a.application_number', 'ilike', "%{$search}%")->orWhere('c.name', 'ilike', "%{$search}%")))
            ->when(isset($filters['phase']), fn ($q) => $q->whereRaw(($filters['phase'] === '1' ? '' : 'not ').$onePhase))
            ->when(isset($filters['reserved']), fn ($q) => $q->whereRaw(($request->boolean('reserved') ? '' : 'not ').$reserved))
            ->orderBy('a.created_at')->orderBy('a.id');
        $page = $query->select(['a.id', 'a.application_number', 'a.application_type', 'a.current_status', 'a.new_power_value', 'a.new_power_unit', 'a.organizational_unit_id', 'c.name as customer_name', 'u.code as unit_code', 'u.name as unit_name'])
            ->paginate($filters['per_page'] ?? 25);
        $contracts = [];

        return response()->json([
            'data' => collect($page->items())->map(function ($a) use (&$contracts): array {
                $power = (int) SrReservationService::powerVa($a);
                $phase = SrReservationService::phaseOf($power);
                $contract = $phase === 1 ? ($contracts[$a->organizational_unit_id] ??= $this->reservations->contractFor($a->organizational_unit_id)) : null;
                $numbers = $this->reservations->mimsReservationNumbers($a->id);

                return ['application_id' => $a->id, 'application_number' => $a->application_number, 'application_type' => $a->application_type, 'status' => $a->current_status, 'customer_name' => $a->customer_name,
                    'unit' => ['id' => $a->organizational_unit_id, 'code' => $a->unit_code, 'name' => $a->unit_name], 'power_va' => $power, 'phase' => $phase,
                    'default_vendor' => $contract === null ? null : ['id' => $contract->vendor_company_id, 'name' => $contract->vendor_name],
                    'already_reserved' => $numbers !== [], 'mims_reservation_numbers' => $numbers];
            })->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    /** The SQL form of SrReservationService::mimsReservationNumbers() being non-empty, for filtering the work list. */
    private function reservedInMimsSql(): string
    {
        $notOwn = 'not in (select r.mims_reservation_no from sr_reservations r join sr_reservation_applications x on x.sr_reservation_id = r.id where x.application_id = a.id and r.mims_reservation_no is not null)';
        $agenda = "from application_external_references e join %s m on m.agenda_no = e.reference_number where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active and m.reservation_no {$notOwn}";

        return "(exists (select 1 from mims_reservation_customers m where m.application_id = a.id and m.reservation_no {$notOwn})"
            .' or exists (select 1 '.sprintf($agenda, 'mims_reservation_customers').')'
            .' or exists (select 1 '.sprintf($agenda, 'mims_issue_customers').'))';
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
        $finding = DB::table('sr_extension_findings as f')->join('users as x', 'x.id', '=', 'f.reported_by')->where('f.application_id', $application)->whereNull('f.cancelled_at')->first(['f.reason', 'f.distance_m', 'f.reported_at', 'x.name']);
        if ($phase === 1 && $contract === null) {
            $blockers[] = 'ULP ini belum punya kontrak pelaksana 1 phasa yang berlaku hari ini.';
        }
        $surveyLength = DB::table('application_surveys as s')->join('application_survey_versions as v', 'v.survey_id', '=', 's.id')->where('s.application_id', ProposalService::surveyOwnerId($application))
            ->where('s.status', 'ACCEPTED')->orderByDesc('s.sequence_number')->orderByDesc('v.version_number')->value('v.sr_length_m');

        return response()->json(['data' => [
            'power_va' => $va, 'phase' => $phase, 'blockers' => $blockers,
            'default_sr_length_m' => (float) config('distriva.sr_reservation.default_sr_length_m'), 'survey_sr_length_m' => $surveyLength === null ? null : (float) $surveyLength,
            'contract' => $contract === null ? null : ['id' => $contract->id, 'contract_number' => $contract->contract_number, 'vendor' => ['id' => $contract->vendor_company_id, 'code' => $contract->vendor_code, 'name' => $contract->vendor_name]],
            'warehouses' => array_map(fn ($w) => ['id' => $w->id, 'code' => $w->code, 'name' => $w->name, 'level' => $w->level], $this->reservations->warehousesFor($app->organizational_unit_id, $phase)),
            'mims_reservation_numbers' => $this->reservations->mimsReservationNumbers($application),
            'extension_finding' => $finding === null ? null : ['reason' => $finding->reason, 'distance_m' => $finding->distance_m === null ? null : (float) $finding->distance_m, 'reported_by' => $finding->name, 'reported_at' => $finding->reported_at],
            'reservations' => $this->listQuery()->whereExists(fn ($q) => $q->from('sr_reservation_applications as x')->whereColumn('x.sr_reservation_id', 'r.id')->where('x.application_id', $application))
                ->orderByDesc('r.created_at')->get()->map(fn ($r) => $this->summary($r))->all(),
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate(['status' => ['nullable', 'in:DRAFT,REQUESTED,SAP_SENT,CANCELLED'], 'source_level' => ['nullable', 'in:ULP,UP3'], 'unit_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $page = $this->scoped($request, $this->listQuery(), 'r.organizational_unit_id')
            ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('r.status', $v))
            ->when($filters['source_level'] ?? null, fn ($q, $v) => $q->where('r.source_level', $v))
            ->when($filters['unit_id'] ?? null, fn ($q, $v) => $q->where('r.organizational_unit_id', $v))
            ->when($filters['search'] ?? null, fn ($q, $v) => $q->where(fn ($w) => $w->where('r.mims_reservation_no', 'ilike', "%{$v}%")
                ->orWhereExists(fn ($x) => $x->from('sr_reservation_applications as x')->join('applications as a', 'a.id', '=', 'x.application_id')->join('customers as c', 'c.id', '=', 'a.customer_id')->whereColumn('x.sr_reservation_id', 'r.id')
                    ->where(fn ($m) => $m->where('a.application_number', 'ilike', "%{$v}%")->orWhere('c.name', 'ilike', "%{$v}%")))))
            ->orderByDesc('r.created_at')->orderBy('r.id')->paginate($filters['per_page'] ?? 25);

        return response()->json(['data' => collect($page->items())->map(fn ($r) => $this->summary($r))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function show(Request $request, string $reservation): JsonResponse
    {
        $r = $this->listQuery()->where('r.id', $reservation)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, $r->organizational_unit_id);
        $agendas = DB::table('sr_reservation_applications as x')->join('applications as a', 'a.id', '=', 'x.application_id')->join('customers as c', 'c.id', '=', 'a.customer_id')->where('x.sr_reservation_id', $reservation)
            ->when($r->status !== 'CANCELLED', fn ($q) => $q->orderByRaw('x.released_at is not null'))->orderBy('a.application_number')
            ->select(['x.*', 'a.application_number', 'c.name as customer_name'])
            ->selectRaw("(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active order by e.created_at desc limit 1) as agenda_number")
            ->get();
        $lines = DB::table('sr_reservation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.sr_reservation_id', $reservation)->orderBy('k.code')->get(['l.*', 'k.code']);
        $serials = DB::table('sr_reservation_serials as n')->join('khs_items as k', 'k.id', '=', 'n.khs_item_id')->whereIn('n.sr_reservation_application_id', $agendas->pluck('id'))->orderBy('k.code')->orderBy('n.serial_number')
            ->get(['n.sr_reservation_application_id', 'k.code', 'n.serial_number', 'n.material_no'])->groupBy('sr_reservation_application_id');
        $khsIds = $lines->pluck('khs_item_id')->merge($agendas->flatMap(fn ($x) => array_keys(json_decode($x->needs, true))))->unique()->values();
        $codes = DB::table('khs_items')->whereIn('id', $khsIds)->pluck('code', 'id');
        $names = DB::table('khs_item_versions')->whereIn('khs_item_id', $khsIds)->where('status', 'APPROVED')->orderBy('valid_from')->get(['khs_item_id', 'name', 'unit_text'])->keyBy('khs_item_id');
        $options = $this->reservations->materialOptions($khsIds->all());
        $stock = $this->reservations->materialStock($r->warehouse_id, $reservation);
        $chosen = DB::table('sr_reservation_line_materials')->whereIn('sr_reservation_line_id', $lines->pluck('id'))->orderBy('material_no')->get()->groupBy('sr_reservation_line_id');
        $events = DB::table('sr_reservation_events as e')->join('users as u', 'u.id', '=', 'e.actor_id')->where('e.sr_reservation_id', $reservation)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.name']);
        $check = $r->status === 'REQUESTED' ? $this->reservations->sapCheck($reservation) : null;
        $serialCodes = (array) config('distriva.sr_reservation.serial_codes');

        return response()->json(['data' => $this->summary($r) + [
            'notes' => $r->notes, 'cancel_reason' => $r->cancel_reason,
            'mims_found_in_mirror' => $r->mims_reservation_no !== null && DB::table('mims_reservations')->where('reservation_no', $r->mims_reservation_no)->exists(),
            'lines' => $lines->map(fn ($l) => ['khs_code' => $l->code, 'khs_name' => $names[$l->khs_item_id]->name ?? null, 'unit_text' => $names[$l->khs_item_id]->unit_text ?? null,
                'material_numbers' => $options[$l->khs_item_id] ?? [],
                'material_options' => array_map(fn (string $no) => ['material_no' => $no, 'name' => $stock[$no]['name'] ?? null, 'unit_text' => $stock[$no]['unit'] ?? null,
                    'stock_ready' => $stock === [] ? null : ($stock[$no]['ready'] ?? 0.0), 'available' => $stock === [] ? null : ($stock[$no]['available'] ?? 0.0)], $options[$l->khs_item_id] ?? []),
                'materials' => $this->chosenNumbers($chosen[$l->id] ?? collect(), $options[$l->khs_item_id] ?? [], (float) $l->quantity), 'quantity_bom' => (float) $l->quantity_bom, 'quantity' => (float) $l->quantity, 'correction_reason' => $l->correction_reason,
                'realised' => isset($check['matches'][$l->khs_item_id]) ? (float) $check['matches'][$l->khs_item_id] : null])->all(),
            'applications' => $agendas->map(fn ($x) => ['application_id' => $x->application_id, 'application_number' => $x->application_number, 'agenda_number' => $x->agenda_number, 'customer_name' => $x->customer_name, 'power_va' => (int) $x->power_va,
                'needs' => collect(json_decode($x->needs, true))->map(fn ($q, $khs) => ['khs_code' => $codes[$khs], 'quantity' => (float) $q])->values()->all(),
                'cable_m' => $x->actual_cable_m === null ? null : (float) $x->actual_cable_m, 'seals' => json_decode($x->seal_numbers, true),
                'serials' => ($serials[$x->id] ?? collect())->map(fn ($n) => ['khs_code' => $n->code, 'serial_number' => $n->serial_number, 'material_no' => $n->material_no])->values()->all(),
                'released_at' => $x->released_at, 'release_reason' => $x->release_reason])->all(),
            'serial_codes' => $serialCodes, 'cable_codes' => (array) config('distriva.sr_reservation.cable_codes'), 'seal_codes' => (array) config('distriva.sr_reservation.seal_codes'),
            'material_blockers' => $r->status === 'DRAFT' ? $this->reservations->materialProblems($reservation) : [],
            'sap_blockers' => $check['blockers'] ?? [],
            'events' => $events->map(fn ($e) => ['type' => $e->event_type, 'actor' => $e->name, 'reason' => $e->reason, 'details' => $e->details === null ? null : json_decode($e->details, true), 'occurred_at' => $e->occurred_at])->all(),
        ]]);
    }

    /**
     * The ERP numbers of a line: what was chosen, or the only number there is.
     *
     * @param  Collection<int,object>  $chosen
     * @param  list<string>  $options
     * @return list<array{material_no:string,quantity:float}>
     */
    private function chosenNumbers(Collection $chosen, array $options, float $quantity): array
    {
        if ($chosen->isEmpty()) {
            return count($options) === 1 && $quantity > 0 ? [['material_no' => $options[0], 'quantity' => $quantity]] : [];
        }

        return $chosen->map(fn (object $m): array => ['material_no' => $m->material_no, 'quantity' => (float) $m->quantity])->values()->all();
    }

    /** POST /sr-reservations — one reservation for the chosen agendas. */
    public function store(Request $request): JsonResponse
    {
        $in = $request->validate(['application_ids' => ['required', 'array', 'min:1', 'max:100'], 'application_ids.*' => ['required', 'uuid', 'distinct'], 'warehouse_id' => ['nullable', 'uuid'], 'vendor_company_id' => ['nullable', 'uuid'],
            'sr_length_m' => ['nullable', 'numeric', 'gt:0', 'max:10000'], 'notes' => ['nullable', 'string', 'max:2000']]);
        foreach (DB::table('applications')->whereIn('id', $in['application_ids'])->distinct()->pluck('organizational_unit_id') as $unit) {
            $this->viewable($request, $unit);
        }
        $first = $this->application($in['application_ids'][0]);
        $power = SrReservationService::powerVa($first);
        if ($power !== null) {
            $warehouse = $this->reservations->pickWarehouse($first->organizational_unit_id, SrReservationService::phaseOf($power), $in['warehouse_id'] ?? null);
            $this->authorizeLevel($request, $warehouse->level, $first->organizational_unit_id);
            $in['warehouse_id'] = $warehouse->id;
        }

        return response()->json(['data' => ['id' => $this->reservations->create($in, $request->user())]], 201);
    }

    public function update(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['sr_length_m' => ['sometimes', 'numeric', 'gt:0', 'max:10000'], 'vendor_company_id' => ['sometimes', 'uuid'], 'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'add_application_ids' => ['sometimes', 'array', 'max:100'], 'add_application_ids.*' => ['required', 'uuid', 'distinct'],
            'corrections' => ['sometimes', 'array', 'max:100'], 'corrections.*.khs_code' => ['required', 'string', 'max:50', 'distinct'], 'corrections.*.quantity' => ['required', 'numeric', 'gte:0', 'max:1000000'], 'corrections.*.reason' => ['nullable', 'string', 'max:500'],
            'materials' => ['sometimes', 'array', 'max:100'], 'materials.*.khs_code' => ['required', 'string', 'max:50', 'distinct'], 'materials.*.items' => ['present', 'array', 'max:30'],
            'materials.*.items.*.material_no' => ['required', 'string', 'max:30'], 'materials.*.items.*.quantity' => ['required', 'numeric', 'gt:0', 'max:1000000']]);
        $this->reservations->update($reservation, $in, $request->user());

        return response()->json(['message' => 'Reservasi disimpan.']);
    }

    public function removeApplication(Request $request, string $reservation, string $application): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->reservations->removeApplication($reservation, $application, $in['reason'], $request->user());

        return response()->json(['message' => 'Agenda dikeluarkan dari reservasi.']);
    }

    public function recordRequest(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['reservation_no' => ['required', 'string', 'max:30']]);
        $this->reservations->request($reservation, $in['reservation_no'], $request->user());

        return response()->json(['message' => 'Nomor permohonan MIMS dicatat.']);
    }

    public function realize(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['items' => ['required', 'array', 'min:1', 'max:100'], 'items.*.application_id' => ['required', 'uuid', 'distinct'], 'items.*.cable_m' => ['sometimes', 'nullable', 'numeric', 'gte:0', 'max:10000'],
            'items.*.seals' => ['sometimes', 'array', 'max:20'], 'items.*.seals.*' => ['required', 'string', 'max:60'],
            'items.*.serials' => ['sometimes', 'array', 'max:20'], 'items.*.serials.*.khs_code' => ['required', 'string', 'max:50'], 'items.*.serials.*.serial_number' => ['required', 'string', 'max:60'], 'items.*.serials.*.material_no' => ['nullable', 'string', 'max:30']]);
        $this->reservations->realize($reservation, $in['items'], $request->user());

        return response()->json(['message' => 'Realisasi disimpan.']);
    }

    public function match(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $this->reservations->matchRealisation($reservation, $request->user());

        return response()->json(['message' => 'Total disamakan dengan realisasi. Samakan juga di MIMS.']);
    }

    public function sendSap(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['sap_reference' => ['nullable', 'string', 'max:60']]);
        $this->reservations->sendSap($reservation, $in['sap_reference'] ?? null, $request->user());

        return response()->json(['message' => 'Reservasi ditandai terkirim ke SAP.']);
    }

    public function cancel(Request $request, string $reservation): JsonResponse
    {
        $this->authorizeOn($request, $reservation);
        $in = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->reservations->cancel($reservation, $in['reason'], $request->user());

        return response()->json(['message' => 'Reservasi dibatalkan.']);
    }

    /** POST /applications/{id}/sr-extension — TEKNIK: the 1-phase connection found that the network must be extended. */
    public function reportExtension(Request $request, string $application): JsonResponse
    {
        $app = $this->application($application);
        $this->authorizer->authorizeOnUnit($request->user(), 'sr_reservations.report_extension', $app->organizational_unit_id);
        $in = $request->validate(['reason' => ['required', 'string', 'max:1000'], 'distance_m' => ['nullable', 'numeric', 'gt:0', 'max:100000']]);
        $this->reservations->reportExtension($application, $in['reason'], isset($in['distance_m']) ? (float) $in['distance_m'] : null, $request->user());

        return response()->json(['message' => 'Dicatat perlu perluasan: lanjutkan dengan survei, lalu usulan.'], 201);
    }

    /** POST /applications/{id}/sr-extension/cancel — the same key withdraws a finding recorded by mistake. */
    public function withdrawExtension(Request $request, string $application): JsonResponse
    {
        $app = $this->application($application);
        $this->authorizer->authorizeOnUnit($request->user(), 'sr_reservations.report_extension', $app->organizational_unit_id);
        $in = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->reservations->withdrawExtension($application, $in['reason'], $request->user());

        return response()->json(['message' => 'Tanda perlu perluasan dibatalkan.']);
    }

    private function authorizeOn(Request $request, string $reservation): void
    {
        $r = DB::table('sr_reservations')->where('id', $reservation)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizeLevel($request, $r->source_level, $r->organizational_unit_id);
    }

    private function authorizeLevel(Request $request, string $level, string $unitId): void
    {
        $this->authorizer->authorizeOnUnit($request->user(), 'sr_reservations.prepare_'.strtolower($level), $unitId);
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

    private function scoped(Request $request, Builder $query, string $unitColumn = 'a.organizational_unit_id'): Builder
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'sr_reservations.view');

        return $scope['unrestricted'] ? $query : $query->whereIn($unitColumn, $scope['units']);
    }

    private function listQuery(): Builder
    {
        return DB::table('sr_reservations as r')->join('organizational_units as u', 'u.id', '=', 'r.organizational_unit_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')->join('vendor_companies as v', 'v.id', '=', 'r.vendor_company_id')
            ->leftJoin('sr_vendor_contracts as k', 'k.id', '=', 'r.vendor_contract_id')
            ->select(['r.*', 'u.code as unit_code', 'u.name as unit_name', 'w.code as warehouse_code', 'w.name as warehouse_name', 'w.plant', 'w.stor_loc', 'v.code as vendor_code', 'v.name as vendor_name', 'k.contract_number'])
            ->selectRaw('(select count(*) from sr_reservation_applications x where x.sr_reservation_id = r.id and (x.released_at is null or r.status = \'CANCELLED\')) as applications_count');
    }

    /** @return array<string,mixed> */
    private function summary(object $r): array
    {
        return ['id' => $r->id, 'status' => $r->status, 'phase' => (int) $r->phase, 'source_level' => $r->source_level, 'applications_count' => (int) $r->applications_count,
            'unit' => ['id' => $r->organizational_unit_id, 'code' => $r->unit_code, 'name' => $r->unit_name],
            'warehouse' => ['id' => $r->warehouse_id, 'code' => $r->warehouse_code, 'name' => $r->warehouse_name, 'plant' => $r->plant, 'stor_loc' => $r->stor_loc],
            'vendor' => ['id' => $r->vendor_company_id, 'code' => $r->vendor_code, 'name' => $r->vendor_name, 'contract_number' => $r->contract_number],
            'sr_length_m' => (float) $r->sr_length_m, 'mims_reservation_no' => $r->mims_reservation_no, 'sap_reference' => $r->sap_reference, 'created_at' => $r->created_at, 'requested_at' => $r->requested_at,
            'sap_sent_at' => $r->sap_sent_at, 'cancelled_at' => $r->cancelled_at];
    }
}
