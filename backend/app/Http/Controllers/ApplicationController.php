<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Applications\ApplicationService;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\ScopedUnitOptions;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Proposals\ProposalService;
use App\Services\Surveys\SurveyService;
use App\Services\WorkOrders\VendorService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** PB/PD applications, stage 1A. Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class ApplicationController extends Controller
{
    /** The application whose survey speaks for `a` (docs/82 §11): the proposal's representative for members of a live or "no extension" proposal, else itself. Twin of ProposalService::surveyOwnerId(). */
    private const SURVEY_OWNER_SQL = "coalesce((select p2.representative_application_id from proposal_applications pa2 join proposals p2 on p2.id = pa2.proposal_id where pa2.application_id = a.id and ((pa2.released_at is null and p2.status = 'OPEN') or p2.status = 'COMPLETED_NO_EXTENSION') order by pa2.added_at desc limit 1), a.id)";

    private const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly ApplicationService $service, private readonly WorkflowNotifier $flow) {}

    /** What the UI may offer, plus the ULP units the actor may create applications in. Convenience only. */
    public function access(Request $request): JsonResponse
    {
        $actor = $request->user();
        $can = [];
        foreach (array_merge(array_keys((array) config('distriva_permissions.applications')), array_keys((array) config('distriva_permissions.substations')), array_keys((array) config('distriva_permissions.feeders')), array_keys((array) config('distriva_permissions.customers'))) as $key) {
            $can[$key] = $this->authorizer->can($actor, $key);
        }
        if (VendorService::companyOf($actor) !== null) {
            $can['wo.view'] = true;
        }
        $scope = $this->authorizer->scopeFor($actor, 'applications.create');
        $q = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->orderBy('code');
        if (! $scope['unrestricted']) {
            $q->whereIn('id', $scope['units']);
        }

        return response()->json(['can' => $can, 'create_units' => $q->limit(500)->get(['id', 'code', 'name'])->all()]);
    }

    /** GET /applications/units — the UP3 and ULP choices of the PB/PD filters, by the actor's role and scope. */
    public function units(Request $request, ScopedUnitOptions $options): JsonResponse
    {
        return response()->json($options->for($request->user(), 'applications.view'));
    }

    /**
     * GET /applications/attention — customers that need attention: not yet through to Peremajaan, longest service days first.
     * UP3 and global: the 100 oldest. ULP: those waiting more than 4 days, at most 50. `three_phase` (default on) keeps 3-phase power only; `extension=1` keeps only those in a network-extension proposal.
     */
    public function attention(Request $request, ScopedUnitOptions $options): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.view');
        $request->validate(['three_phase' => ['nullable', 'boolean'], 'extension' => ['nullable', 'boolean']]);
        $isUlp = $options->for($request->user(), 'applications.view')['scope'] === 'ULP';
        [$limit, $minDays] = $isUlp ? [50, 5] : [100, 0];
        $days = 'coalesce(a.service_days, greatest(0, current_date - coalesce(a.source_created_at, a.created_at)::date))';
        $proposal = "(select p.proposal_number from proposal_applications pa join proposals p on p.id = pa.proposal_id where pa.application_id = a.id and pa.released_at is null and p.status = 'OPEN' limit 1)";

        $q = $this->scoped($scope)->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->whereNotIn('a.current_status', ['CONNECTION_DONE', 'COMPLETED', 'CANCELLED', 'REFUNDED'])
            ->whereRaw("{$days} >= ?", [$minDays]);
        if ($request->boolean('three_phase', true)) {
            $q->whereRaw("(a.new_power_value * CASE WHEN upper(a.new_power_unit) = 'KVA' THEN 1000 ELSE 1 END) >= 6600");
        }
        if ($request->boolean('extension')) {
            $q->whereRaw("{$proposal} is not null");
        }
        $rows = $q->selectRaw("a.id, a.application_number, a.application_type, a.current_status, a.new_tariff_code, a.new_power_value, a.new_power_unit, a.service_address, c.name as customer_name, u.code as unit_code, u.name as unit_name, {$days} as attention_days, {$proposal} as proposal_number")
            ->orderByRaw("{$days} desc")->orderBy('a.application_number')->limit($limit)->get();

        return response()->json(['data' => $rows->map(fn ($r) => ['id' => $r->id, 'application_number' => $r->application_number, 'application_type' => $r->application_type, 'status' => $r->current_status,
            'new_tariff_code' => $r->new_tariff_code, 'new_power_value' => $r->new_power_value === null ? null : (float) $r->new_power_value, 'new_power_unit' => $r->new_power_unit, 'service_address' => $r->service_address,
            'days' => (int) $r->attention_days, 'proposal_number' => $r->proposal_number, 'customer' => ['name' => $r->customer_name], 'unit' => ['code' => $r->unit_code, 'name' => $r->unit_name]])->all(),
            'meta' => ['level' => $isUlp ? 'ULP' : 'UP3', 'limit' => $limit, 'min_days' => $minDays]]);
    }

    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.view');
        $request->validate(['status' => ['nullable', Rule::in(self::STATUSES)], 'type' => ['nullable', Rule::in(['PB', 'PD'])], 'unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid'], 'month' => ['nullable', 'date_format:Y-m'],
            'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer'], 'listing' => ['nullable', Rule::in(['all', 'pbpd'])],
            'lifecycle' => ['nullable', Rule::in(['active', 'history'])]]);

        $q = $this->scoped($scope)->orderByDesc('a.created_at');
        $q->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id');
        foreach ([['status', 'a.current_status'], ['type', 'a.application_type'], ['unit_id', 'a.organizational_unit_id']] as [$param, $col]) {
            if ($request->filled($param)) {
                $q->where($col, $request->query($param));
            }
        }
        if ($request->filled('up3_id')) {
            $q->where('u.parent_id', $request->query('up3_id'));
        }
        // month: the month shown in the table's date column (EIS update date, else the import date).
        if ($request->filled('month')) {
            $start = CarbonImmutable::createFromFormat('Y-m-d', $request->query('month').'-01')->startOfMonth();
            $q->whereRaw('coalesce(a.last_external_status_at, a.created_at) >= ? and coalesce(a.last_external_status_at, a.created_at) < ?', [$start, $start->addMonth()]);
        }
        // listing=pbpd: every application. The page shows the active ones by default and narrows by status, power and unit with its own filters (owner 2026-11-16: every EIS status is stored and the table only filters;
        // before, an EIS application outside mohon/disetujui/bayar/cetak PK was hidden here whatever the filters said).
        if ($request->query('listing') === 'pbpd') {
            $q->whereNotNull('a.id');
        }
        // min_va: a DISPLAY filter on the new power (VA), e.g. 6600 = 3-phase only. It never changes what the EIS import stores (that is eis_min_power_va).
        if ($request->filled('min_va')) {
            $q->whereRaw("(a.new_power_value * CASE WHEN upper(a.new_power_unit) = 'KVA' THEN 1000 ELSE 1 END) >= ?", [max(0, min((int) $request->query('min_va'), 100000000))]);
        }
        // lifecycle: active = still running, history = done, cancelled or refunded (imported as history; the page shows the active ones by default).
        if ($request->filled('lifecycle')) {
            $closed = ['CONNECTION_DONE', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
            $request->query('lifecycle') === 'active' ? $q->whereNotIn('a.current_status', $closed) : $q->whereIn('a.current_status', $closed);
        }
        if ($request->boolean('ready_to_install')) {          // survey accepted as "no extension" and the application not moved on yet (docs/82)
            $q->whereIn('a.current_status', ['APPROVED', 'PAID', 'PK_PRINTED'])
                ->whereRaw('(select s.status from application_surveys s where s.application_id = '.self::SURVEY_OWNER_SQL." and s.status <> 'CANCELLED' order by s.sequence_number desc limit 1) = 'ACCEPTED'")
                ->whereRaw('(select sv.requires_network_extension from application_surveys s join application_survey_versions sv on sv.survey_id = s.id where s.application_id = '.self::SURVEY_OWNER_SQL." and s.status <> 'CANCELLED' order by s.sequence_number desc, sv.version_number desc limit 1) is false");
        }
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $q->where(fn ($w) => $w->where('a.application_number', 'ilike', $term)->orWhere('c.name', 'ilike', $term)
                ->orWhereExists(fn ($s) => $s->from('customer_external_references as r')->whereColumn('r.customer_id', 'c.id')->where('r.reference_value', 'ilike', $term))
                ->orWhereExists(fn ($s) => $s->from('application_external_references as e')->whereColumn('e.application_id', 'a.id')->where('e.reference_number', 'ilike', $term)));
        }
        $page = $q->select('a.id', 'a.application_number', 'a.application_type', 'a.transaction_type', 'a.current_status', 'a.service_address', 'a.delta_power_kva', 'a.old_tariff_code', 'a.new_tariff_code', 'a.new_power_value', 'a.new_power_unit', 'a.created_at', 'a.last_external_status_at', 'a.submitted_at',
            'c.id as customer_id', 'c.name as customer_name', 'u.id as unit_id', 'u.code as unit_code', 'u.name as unit_name', 'a.source_type', 'a.service_days', 'a.service_days_observed_at')
            ->selectRaw("(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'AGENDA' and e.is_active order by e.created_at desc limit 1) as agenda_number")
            ->selectRaw("(select e.reference_number from application_external_references e where e.application_id = a.id and e.reference_type = 'PAYMENT_REGISTER' and e.is_active order by e.created_at desc limit 1) as register_number")
            ->selectRaw("(select r.reference_value from customer_external_references r where r.customer_id = c.id and r.reference_type = 'IDPEL' order by r.created_at desc limit 1) as idpel")
            ->selectRaw("(select p.proposal_number from proposal_applications pa join proposals p on p.id = pa.proposal_id where pa.application_id = a.id and pa.released_at is null and p.status = 'OPEN' limit 1) as proposal_number")
            ->selectRaw('(select s.survey_number from application_surveys s where s.application_id = '.self::SURVEY_OWNER_SQL." and s.status <> 'CANCELLED' order by s.sequence_number desc limit 1) as survey_number")
            ->selectRaw('(select s.status from application_surveys s where s.application_id = '.self::SURVEY_OWNER_SQL." and s.status <> 'CANCELLED' order by s.sequence_number desc limit 1) as survey_status")
            ->selectRaw("(select case when sv.requires_network_extension is true then 'EXTENSION' when sv.requires_network_extension is false then 'NO_EXTENSION' end from application_surveys s join application_survey_versions sv on sv.survey_id = s.id where s.application_id = ".self::SURVEY_OWNER_SQL." and s.status <> 'CANCELLED' order by s.sequence_number desc, sv.version_number desc limit 1) as survey_outcome")
            ->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        return response()->json([
            'data' => collect($page->items())->map(fn ($r) => ['id' => $r->id, 'application_number' => $r->application_number, 'application_type' => $r->application_type, 'transaction_type' => $r->transaction_type,
                'status' => $r->current_status, 'source_type' => $r->source_type, 'proposal_number' => $r->proposal_number, 'service_address' => $r->service_address, 'delta_power_kva' => $r->delta_power_kva === null ? null : (float) $r->delta_power_kva,
                'old_tariff_code' => $r->old_tariff_code, 'new_tariff_code' => $r->new_tariff_code, 'new_power_value' => $r->new_power_value === null ? null : (float) $r->new_power_value, 'new_power_unit' => $r->new_power_unit,
                'service_days' => $r->service_days, 'service_days_observed_at' => $r->service_days_observed_at, 'survey_number' => $r->survey_number, 'survey_status' => $r->survey_status, 'survey_outcome' => $r->survey_outcome,
                'ready_to_install' => self::readyToInstall($r->current_status, $r->survey_status, $r->survey_outcome), 'agenda_number' => $r->agenda_number, 'register_number' => $r->register_number, 'idpel' => $r->idpel, 'created_at' => $r->created_at, 'submitted_at' => $r->submitted_at, 'eis_updated_at' => $r->last_external_status_at,
                'customer' => ['id' => $r->customer_id, 'name' => $r->customer_name], 'unit' => ['id' => $r->unit_id, 'code' => $r->unit_code, 'name' => $r->unit_name]])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.view');
        $a = $this->scoped($scope)->where('a.id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->detail($a)]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'applications.create');           // grant first, then validate
        $data = Validator::make($request->all(), $this->rules(true) + ['organizational_unit_id' => ['required', 'uuid', 'exists:organizational_units,id'], 'application_type' => ['required', Rule::in(['PB', 'PD'])],
            'customer_id' => ['nullable', 'uuid'], 'customer' => ['required_without:customer_id', 'array']])->validate();
        $this->authorizer->authorizeOnUnit($actor, 'applications.create', $data['organizational_unit_id']);
        $id = $this->service->create($data, $actor);

        return response()->json(['data' => $this->detail($this->find($id))], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'applications.update');
        $app = $this->findOrHide($id);
        $this->authorizer->authorizeOnUnit($actor, 'applications.update', $app->organizational_unit_id);
        $data = Validator::make($request->all(), $this->rules(false))->validate();
        $this->service->update($id, $data, $actor);

        return response()->json(['data' => $this->detail($this->find($id))]);
    }

    public function submit(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'applications.submit');
        $app = $this->findOrHide($id);
        $this->authorizer->authorizeOnUnit($actor, 'applications.submit', $app->organizational_unit_id);
        $this->service->submit($id, $actor);
        $this->flow->applicationsArrived((string) $app->organizational_unit_id, 1, $actor, $app->application_number);

        return response()->json(['data' => $this->detail($this->find($id))]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'applications.cancel');
        $app = $this->findOrHide($id);
        $this->authorizer->authorizeOnUnit($actor, 'applications.cancel', $app->organizational_unit_id);
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->service->cancel($id, $data['reason'], $actor);

        return response()->json(['data' => $this->detail($this->find($id))]);
    }

    public function addReference(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'applications.update');
        $app = $this->findOrHide($id);
        $this->authorizer->authorizeOnUnit($actor, 'applications.update', $app->organizational_unit_id);
        $data = Validator::make($request->all(), ['reference_type' => ['required', Rule::in(['AGENDA', 'PAYMENT_REGISTER'])], 'reference_number' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9\-\/._]+$/']])->validate();
        $this->service->addExternalReference($id, $data['reference_type'], $data['reference_number'], $actor);

        return response()->json(['data' => $this->detail($this->find($id))], 201);
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope */
    private function scoped(array $scope)
    {
        $q = DB::table('applications as a');
        if (! $scope['unrestricted']) {
            $q->whereIn('a.organizational_unit_id', $scope['units']);
        }

        return $q;
    }

    private function find(string $id): ?object
    {
        return DB::table('applications as a')->where('a.id', $id)->first();
    }

    /** 404 for a missing application, before any scope decision leaks existence. */
    private function findOrHide(string $id): object
    {
        return $this->find($id) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** @return array<string,mixed> */
    private function rules(bool $create): array
    {
        $req = $create ? ['required'] : ['sometimes'];

        return [
            'transaction_type' => array_merge($create ? ['required'] : ['sometimes', 'required'], ['string', 'max:50']),
            'service_address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'old_tariff_code' => ['sometimes', 'nullable', 'string', 'max:30'], 'new_tariff_code' => ['sometimes', 'nullable', 'string', 'max:30'],
            'old_power_value' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:1000000000', 'required_with:old_power_unit'], 'old_power_unit' => ['sometimes', 'nullable', Rule::in(['VA', 'kVA']), 'required_with:old_power_value'],
            'new_power_value' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:1000000000', 'required_with:new_power_unit'], 'new_power_unit' => ['sometimes', 'nullable', Rule::in(['VA', 'kVA']), 'required_with:new_power_value'],
            'sar_package' => ['sometimes', 'nullable', 'string', 'max:150'], 'total_cost' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:1000000000000'], 'service_criteria' => ['sometimes', 'nullable', 'string', 'max:50'],
            'requires_drawing' => ['sometimes', 'nullable', 'boolean'], 'requires_feasibility_study' => ['sometimes', 'nullable', 'boolean'], 'requires_network_extension' => ['sometimes', 'nullable', 'boolean'],
            'customer' => ['sometimes', 'array'], 'customer.name' => [$create ? 'required_without:customer_id' : 'sometimes', 'string', 'max:200'], 'customer.phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'customer.email' => ['sometimes', 'nullable', 'email', 'max:150'], 'customer.idpel' => ['sometimes', 'nullable', 'string', 'max:50', 'regex:/^[A-Za-z0-9\-]*$/'],
        ];
    }

    /** Customer ready to be installed (owner 2026-11-14): the survey was accepted as "no extension" and the application has not moved on yet (what follows comes from the EIS import). */
    private static function readyToInstall(string $status, ?string $surveyStatus, ?string $outcome): bool
    {
        return $surveyStatus === 'ACCEPTED' && $outcome === 'NO_EXTENSION' && in_array($status, ['APPROVED', 'PAID', 'PK_PRINTED'], true);
    }

    /** The live proposal the application belongs to, as the drawer needs it: `issued` is false while it is only a collective survey request (no usulan number yet). @return array<string,mixed>|null */
    private function proposalSummary(string $applicationId): ?array
    {
        $p = ProposalService::liveFor($applicationId);
        if ($p === null) {
            return null;
        }
        $row = DB::table('proposals')->where('id', $p->id)->first(['issued_at']);

        return ['id' => $p->id, 'proposal_number' => $p->proposal_number, 'issued' => $p->proposal_number !== null, 'issued_at' => $row?->issued_at, 'representative_application_id' => $p->representative_application_id,
            'is_representative' => $p->representative_application_id === $applicationId,
            'members_count' => DB::table('proposal_applications')->where('proposal_id', $p->id)->whereNull('released_at')->count()];
    }

    /** @return array<string,mixed>|null */
    private function surveySummary(object $a): ?array
    {
        $s = SurveyService::latestOutcome($a->id);

        return $s === null ? null : $s + ['ready_to_install' => self::readyToInstall($a->current_status, $s['status'], $s['outcome'])];
    }

    /** @return array<string,mixed> */
    private function detail(object $a): array
    {
        $c = DB::table('customers')->where('id', $a->customer_id)->first();
        $idpel = DB::table('customer_external_references')->where('customer_id', $a->customer_id)->whereNull('valid_until')->where('reference_type', 'IDPEL')->get(['reference_value', 'is_primary', 'source_system']);
        $refs = DB::table('application_external_references')->where('application_id', $a->id)->orderBy('received_at')->get(['id', 'external_system', 'reference_type', 'reference_number', 'registration_source', 'received_at', 'is_active']);
        $hist = DB::table('application_status_histories as h')->join('users as u', 'u.id', '=', 'h.changed_by')->where('h.application_id', $a->id)->when(Schema::hasColumn('application_status_histories', 'seq'), fn ($q) => $q->orderBy('h.seq'), fn ($q) => $q->orderBy('h.changed_at'))->get(['h.from_status', 'h.to_status', 'h.changed_at', 'h.reason', 'u.email as changed_by_email']);
        $unit = DB::table('organizational_units')->where('id', $a->organizational_unit_id)->first(['id', 'code', 'name', 'parent_id']);

        return [
            'id' => $a->id, 'application_number' => $a->application_number, 'application_type' => $a->application_type, 'transaction_type' => $a->transaction_type, 'status' => $a->current_status,
            'source_type' => $a->source_type, 'service_address' => $a->service_address, 'old_tariff_code' => $a->old_tariff_code, 'new_tariff_code' => $a->new_tariff_code,
            'old_power' => $a->old_power_value === null ? null : ['value' => (float) $a->old_power_value, 'unit' => $a->old_power_unit],
            'new_power' => $a->new_power_value === null ? null : ['value' => (float) $a->new_power_value, 'unit' => $a->new_power_unit],
            'delta_power_kva' => $a->delta_power_kva === null ? null : (float) $a->delta_power_kva, 'sar_package' => $a->sar_package, 'total_cost' => $a->total_cost === null ? null : (float) $a->total_cost,
            'service_criteria' => $a->service_criteria, 'requires_drawing' => $a->requires_drawing, 'requires_feasibility_study' => $a->requires_feasibility_study, 'requires_network_extension' => $a->requires_network_extension,
            'service_days' => $a->service_days, 'service_days_observed_at' => $a->service_days_observed_at, 'survey' => $this->surveySummary($a), 'proposal' => $this->proposalSummary($a->id), 'created_at' => $a->created_at, 'submitted_at' => $a->submitted_at,
            'unit' => ['id' => $unit->id, 'code' => $unit->code, 'name' => $unit->name],
            'customer' => ['id' => $c->id, 'customer_number' => $c->customer_number, 'name' => $c->name, 'phone' => $c->phone, 'email' => $c->email,
                'idpel' => $idpel->map(fn ($r) => ['value' => $r->reference_value, 'is_primary' => (bool) $r->is_primary])->all()],
            'external_references' => $refs->map(fn ($r) => (array) $r)->all(),
            'status_history' => $hist->map(fn ($h) => (array) $h)->all(),
        ];
    }
}
