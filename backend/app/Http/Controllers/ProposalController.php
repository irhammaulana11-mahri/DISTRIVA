<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\UnitFilter;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Proposals\ProposalService;
use App\Services\Surveys\SurveyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Usulan with several customers (docs/62 §37). Violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class ProposalController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly ProposalService $proposals, private readonly WorkflowNotifier $flow) {}

    /** GET /proposals/selectable?q= — the searchable customer table of "create proposal": applications (any power or tariff; mohon, disetujui, bayar, cetak PK) of the actor's ULP not yet in a live proposal. */
    public function selectable(Request $request): JsonResponse
    {
        $forSurvey = $request->boolean('for_survey');           // owner 2026-11-15: applications a survey can start on (no live survey yet); the surveyor (`surveys.execute`) picks them
        $scope = $this->authorizer->authorizeScope($request->user(), $forSurvey ? 'surveys.execute' : 'proposals.manage');
        $d = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'unit_id' => ['nullable', 'uuid'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $units = $scope['unrestricted'] ? DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('id')->all() : $scope['units'];
        if (isset($d['unit_id'])) {
            $units = array_values(array_intersect($units, [$d['unit_id']]));
        }
        $page = $this->proposals->selectable($units, $d['q'] ?? null, (int) ($d['per_page'] ?? 20), $forSurvey);

        return response()->json(['data' => collect($page->items())->map(fn ($a) => (array) $a)->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()], 'min_power_va' => ProposalService::MIN_VA]);
    }

    /**
     * POST /proposals. With `start_survey` (owner 2026-11-15: collective survey request) a TEKNIK of the ULP (`surveys.execute`) creates a proposal WITHOUT a number and starts the survey of its representative in the same transaction;
     * the usulan number is issued when the survey is accepted as "needs extension". Without it this is the earlier direct creation (`proposals.manage`, number issued at once).
     */
    public function create(Request $request): JsonResponse
    {
        $actor = $request->user();
        $survey = $request->boolean('start_survey');
        $key = $survey ? 'surveys.execute' : 'proposals.manage';
        $this->authorizer->authorizeScope($actor, $key);
        $d = Validator::make($request->all(), ['application_ids' => ['required', 'array', 'min:1', 'max:200'], 'application_ids.*' => ['uuid', 'distinct'], 'title' => ['nullable', 'string', 'max:200'], 'start_survey' => ['nullable', 'boolean']])->validate();
        $unit = DB::table('applications')->where('id', $d['application_ids'][0])->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, $key, (string) $unit);
        if (! $survey) {
            return response()->json(['data' => ['id' => $this->proposals->create($d['application_ids'], $d['title'] ?? null, $actor)]], 201);
        }
        [$id, $surveyId] = DB::transaction(function () use ($d, $actor): array {
            $proposalId = $this->proposals->create($d['application_ids'], $d['title'] ?? null, $actor, true);

            return [$proposalId, app(SurveyService::class)->assign($d['application_ids'][0], null, null, $actor)];
        });

        return response()->json(['data' => ['id' => $id, 'survey_id' => $surveyId, 'survey_number' => DB::table('application_surveys')->where('id', $surveyId)->value('survey_number')]], 201);
    }

    /** POST /proposals/issue {application_id} — Teknik ULP makes the usulan from the accepted survey that needs an extension (docs/82 §14). */
    public function issue(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'proposals.manage');
        $d = Validator::make($request->all(), ['application_id' => ['required', 'uuid']])->validate();
        $unit = DB::table('applications')->where('id', $d['application_id'])->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, 'proposals.manage', (string) $unit);

        return response()->json(['data' => $this->proposals->issueFromSurvey($d['application_id'], $actor)], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'proposals.view');
        $q = DB::table('proposals as p')->join('organizational_units as u', 'u.id', '=', 'p.ulp_unit_id')->join('applications as a', 'a.id', '=', 'p.representative_application_id')->orderByDesc('p.created_at');
        if (! $scope['unrestricted']) {
            $q->whereIn('p.ulp_unit_id', $scope['units']);
        }
        $request->validate(UnitFilter::rules());
        UnitFilter::apply($q, $request, 'p.ulp_unit_id');
        if ($request->filled('issued')) {           // issued=1: usulan with a number (the "Usulan Perluasan" list); issued=0: collective survey requests still waiting for their result
            $request->boolean('issued') ? $q->whereNotNull('p.proposal_number') : $q->whereNull('p.proposal_number');
        }

        return response()->json(['data' => $q->get(['p.id', 'p.proposal_number', 'p.title', 'p.status', 'u.name as ulp_name', 'p.representative_application_id', 'a.application_number as representative_number', 'p.created_at'])
            ->map(fn ($p) => (array) $p + ['issued' => $p->proposal_number !== null, 'members_count' => DB::table('proposal_applications')->where('proposal_id', $p->id)->whereNull('released_at')->count()])->all()]);
    }

    public function show(Request $request, string $proposal): JsonResponse
    {
        $p = $this->find($proposal);
        $this->viewable($request, $p);
        $members = DB::table('proposal_applications as pa')->join('applications as a', 'a.id', '=', 'pa.application_id')->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->leftJoin('customer_external_references as r', fn ($j) => $j->on('r.customer_id', '=', 'c.id')->where('r.reference_type', 'IDPEL'))->where('pa.proposal_id', $proposal)->whereNull('pa.released_at')->orderBy('pa.added_at')
            ->get(['a.id', 'a.application_number', 'a.application_type', 'a.current_status', 'a.new_tariff_code', 'a.new_power_value', 'a.new_power_unit', 'a.delta_power_kva', 'a.total_cost', 'a.sar_package', 'c.name as customer_name', 'r.reference_value as idpel']);
        $events = DB::table('proposal_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.proposal_id', $proposal)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.name as actor_name']);

        return response()->json(['data' => ['id' => $p->id, 'proposal_number' => $p->proposal_number, 'title' => $p->title, 'status' => $p->status, 'cancel_reason' => $p->cancel_reason, 'ulp_unit_id' => $p->ulp_unit_id,
            'representative_application_id' => $p->representative_application_id,
            // what the page needs to explain its buttons: why the proposal cannot be cancelled, and whether a stored KKF run goes stale when the members change
            'cancel_blocked_reason' => DB::table('work_orders')->where('application_id', $p->representative_application_id)->whereIn('status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED'])->exists()
                ? 'WO usulan ini sudah diterbitkan; batalkan WO terlebih dahulu.' : null,
            'kkf_runs_count' => DB::table('kkf_runs')->where('proposal_id', $p->id)->count(),
            'members' => $members->map(fn ($m) => ['application_id' => $m->id, 'application_number' => $m->application_number, 'application_type' => $m->application_type, 'status' => $m->current_status, 'customer_name' => $m->customer_name, 'idpel' => $m->idpel,
                'tariff' => $m->new_tariff_code, 'power' => $m->new_power_value === null ? null : (float) $m->new_power_value, 'power_unit' => $m->new_power_unit, 'delta_power_kva' => $m->delta_power_kva === null ? null : (float) $m->delta_power_kva,
                'total_cost' => $m->total_cost === null ? null : (float) $m->total_cost, 'sar_package' => $m->sar_package, 'is_representative' => $m->id === $p->representative_application_id])->all(),
            'events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_name' => $e->actor_name])->all()]]);
    }

    public function addMembers(Request $request, string $proposal): JsonResponse
    {
        $p = $this->manage($request, $proposal);
        $d = Validator::make($request->all(), ['application_ids' => ['required', 'array', 'min:1', 'max:200'], 'application_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000']])->validate();
        $this->proposals->addMembers($p->id, $d['application_ids'], $d['reason'], $request->user());

        return response()->json(['message' => 'Pelanggan ditambahkan ke usulan.']);
    }

    public function removeMember(Request $request, string $proposal, string $application): JsonResponse
    {
        $p = $this->manage($request, $proposal);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->proposals->removeMember($p->id, $application, $d['reason'], $request->user());

        return response()->json(['message' => 'Pelanggan dikeluarkan dari usulan.']);
    }

    public function cancel(Request $request, string $proposal): JsonResponse
    {
        $p = $this->manage($request, $proposal);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $cancelled = $this->proposals->cancel($p->id, $d['reason'], $request->user());
        if ($cancelled !== null) {
            $this->flow->surveyCancelled($cancelled, $d['reason'], $request->user());
        }

        return response()->json(['message' => 'Usulan dibatalkan.']);
    }

    private function manage(Request $request, string $proposal): object
    {
        $p = $this->find($proposal);
        $this->authorizer->authorizeScope($request->user(), 'proposals.manage');
        $this->authorizer->authorizeOnUnit($request->user(), 'proposals.manage', $p->ulp_unit_id);

        return $p;
    }

    private function viewable(Request $request, object $p): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'proposals.view');
        if (! $scope['unrestricted'] && ! in_array($p->ulp_unit_id, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function find(string $id): object
    {
        return DB::table('proposals')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
