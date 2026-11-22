<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\UnitFilter;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Surveys\SurveyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Survey workflow (stage 2). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). Grant is checked before validation. */
class SurveyController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly SurveyService $surveys, private readonly WorkflowNotifier $flow) {}

    public function access(Request $request): JsonResponse
    {
        $can = [];
        foreach (array_keys((array) config('distriva_permissions.surveys')) as $key) {
            $can[$key] = $this->authorizer->can($request->user(), $key);
        }

        return response()->json(['can' => $can]);
    }

    public function index(Request $request, string $application): JsonResponse
    {
        $app = $this->viewableApplication($request, $application);
        $rows = DB::table('application_surveys as s')->join('users as u', 'u.id', '=', 's.assigned_to')->where('s.application_id', $app->id)->orderBy('s.sequence_number')
            ->get(['s.id', 's.survey_number', 's.sequence_number', 's.status', 's.scheduled_at', 'u.email as surveyor_email', 'u.name as surveyor_name']);
        $open = DB::table('application_survey_versions')->whereIn('survey_id', $rows->pluck('id'))->orderBy('version_number')->get(['survey_id', 'version_number', 'status', 'stage'])->groupBy('survey_id');

        return response()->json(['data' => $rows->map(fn ($s) => ['id' => $s->id, 'survey_number' => $s->survey_number, 'sequence_number' => $s->sequence_number, 'status' => $s->status, 'scheduled_at' => $s->scheduled_at,
            'surveyor' => ['name' => $s->surveyor_name, 'email' => $s->surveyor_email], 'latest_version' => $open->get($s->id)?->last() ? (array) $open->get($s->id)->last() : null])->all()]);
    }

    /**
     * GET /surveys — the "Usulan Survei" list (owner 2026-11-15): every survey request of the actor's units, individual (one customer) or collective (one proposal, several customers), with its result.
     * `outcome`: PENDING until the survey is accepted, then EXTENSION (usulan number issued) or NO_EXTENSION (ready to install).
     */
    public function requests(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'surveys.view');
        $request->validate(['q' => ['nullable', 'string', 'max:100'], 'kind' => ['nullable', Rule::in(['INDIVIDUAL', 'COLLECTIVE'])], 'outcome' => ['nullable', Rule::in(['PENDING', 'EXTENSION', 'NO_EXTENSION'])],
            'status' => ['nullable', Rule::in(['ACTIVE', 'ACCEPTED', 'CANCELLED'])], 'unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid'], 'per_page' => ['nullable', 'integer']]);
        $prop = "(select p.id from proposals p where p.representative_application_id = a.id and p.status in ('OPEN','COMPLETED_NO_EXTENSION') order by p.created_at desc limit 1)";
        $members = "(select count(*) from proposal_applications pa where pa.proposal_id = {$prop} and (pa.released_at is null or (select p3.status from proposals p3 where p3.id = pa.proposal_id) = 'COMPLETED_NO_EXTENSION'))";
        $outcome = "(select case when s.status = 'ACCEPTED' and sv.requires_network_extension is true then 'EXTENSION' when s.status = 'ACCEPTED' and sv.requires_network_extension is false then 'NO_EXTENSION' else 'PENDING' end
            from application_survey_versions sv where sv.survey_id = s.id order by sv.version_number desc limit 1)";
        $q = DB::table('application_surveys as s')->join('applications as a', 'a.id', '=', 's.application_id')->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->join('users as sr', 'sr.id', '=', 's.assigned_to')->orderByDesc('s.created_at');
        if (! $scope['unrestricted']) {
            $q->whereIn('a.organizational_unit_id', $scope['units']);
        }
        UnitFilter::apply($q, $request, 'a.organizational_unit_id');
        if ($request->filled('status')) {
            $q->where('s.status', $request->query('status'));
        }
        if ($request->filled('outcome')) {
            $q->whereRaw("{$outcome} = ?", [$request->query('outcome')]);
        }
        if ($request->filled('kind')) {
            $request->query('kind') === 'COLLECTIVE' ? $q->whereRaw("{$members} > 1") : $q->whereRaw("coalesce({$members}, 0) <= 1");
        }
        if ($request->filled('q')) {
            $term = '%'.str_replace(['%', '_'], ['\\%', '\\_'], trim((string) $request->query('q'))).'%';
            $q->where(fn ($w) => $w->where('s.survey_number', 'ilike', $term)->orWhere('a.application_number', 'ilike', $term)->orWhere('c.name', 'ilike', $term)
                ->orWhereRaw("exists (select 1 from proposal_applications pa join applications ax on ax.id = pa.application_id join customers cx on cx.id = ax.customer_id where pa.proposal_id = {$prop} and (cx.name ilike ? or ax.application_number ilike ?))", [$term, $term]));
        }
        $page = $q->select('s.id', 's.survey_number', 's.status', 's.scheduled_at', 's.created_at', 'a.id as application_id', 'a.application_number', 'a.current_status', 'c.name as customer_name', 'u.code as unit_code', 'u.name as unit_name', 'sr.name as surveyor_name')
            ->selectRaw("{$prop} as proposal_id")
            ->selectRaw("(select p.proposal_number from proposals p where p.id = {$prop}) as proposal_number")
            ->selectRaw("coalesce({$members}, 0) as members_count")
            ->selectRaw("{$outcome} as outcome")
            ->selectRaw('(select sv.status from application_survey_versions sv where sv.survey_id = s.id order by sv.version_number desc limit 1) as version_status')
            ->selectRaw('(select sv.stage from application_survey_versions sv where sv.survey_id = s.id order by sv.version_number desc limit 1) as version_stage')
            ->selectRaw('(select (sv.requires_drawing is true) from application_survey_versions sv where sv.survey_id = s.id order by sv.version_number desc limit 1) as requires_drawing')
            ->paginate(max(1, min((int) $request->query('per_page', 20), 100)));
        $names = [];
        $members = [];
        foreach ($page->items() as $r) {
            if ($r->proposal_id !== null) {                                   // a collective survey: every member application, so the page can show each customer's data without leaving it
                $members[$r->id] = DB::table('proposal_applications as pa')->join('applications as ax', 'ax.id', '=', 'pa.application_id')->join('customers as cx', 'cx.id', '=', 'ax.customer_id')
                    ->where('pa.proposal_id', $r->proposal_id)->whereNull('pa.released_at')->orderBy('pa.added_at')->limit(200)
                    ->get(['ax.id as application_id', 'ax.application_number', 'ax.current_status as status', 'ax.new_tariff_code', 'ax.new_power_value', 'ax.new_power_unit', 'cx.name as customer_name'])->map(fn ($m) => (array) $m)->all();
                $names[$r->id] = array_slice(array_column($members[$r->id], 'customer_name'), 0, 4);
            }
        }

        return response()->json([
            'data' => collect($page->items())->map(fn ($r) => ['id' => $r->id, 'survey_number' => $r->survey_number, 'status' => $r->status, 'outcome' => $r->outcome, 'kind' => (int) $r->members_count > 1 ? 'COLLECTIVE' : 'INDIVIDUAL',
                'members_count' => max(1, (int) $r->members_count), 'customer_names' => $names[$r->id] ?? [$r->customer_name], 'members' => $members[$r->id] ?? [], 'version_status' => $r->version_status, 'version_stage' => $r->version_stage, 'requires_drawing' => (bool) $r->requires_drawing,
                'application' => ['id' => $r->application_id, 'application_number' => $r->application_number, 'status' => $r->current_status, 'customer_name' => $r->customer_name],
                'proposal' => $r->proposal_id === null ? null : ['id' => $r->proposal_id, 'proposal_number' => $r->proposal_number, 'issued' => $r->proposal_number !== null],
                'unit' => ['code' => $r->unit_code, 'name' => $r->unit_name], 'surveyor_name' => $r->surveyor_name, 'scheduled_at' => $r->scheduled_at, 'created_at' => $r->created_at])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    /** TEKNIK users of the application's ULP the manager may assign. */
    public function surveyors(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'surveys.assign');
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, 'surveys.assign', $app->organizational_unit_id);
        $today = now(config('distriva.business_timezone'))->toDateString();
        $users = DB::table('users as u')->join('user_role_assignments as a', 'a.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'a.role_id')
            ->where('r.name', 'TEKNIK')->where('a.organizational_unit_id', $app->organizational_unit_id)->where('a.is_active', true)->where('u.account_status', 'ACTIVE')
            ->whereDate('a.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today))->orderBy('u.name')->distinct()->get(['u.id', 'u.name', 'u.email']);

        return response()->json(['data' => $users->all()]);
    }

    public function store(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        // Role-based (owner 7 Nov 2026): a TEKNIK of the ULP starts the survey of any customer of the ULP himself; naming another surveyor stays a MANAGER_ULP action (`surveys.assign`).
        $key = $request->filled('assigned_to') ? 'surveys.assign' : 'surveys.execute';
        $this->authorizer->authorizeScope($actor, $key);
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, $key, $app->organizational_unit_id);
        $data = Validator::make($request->all(), ['assigned_to' => ['nullable', 'uuid'], 'scheduled_at' => ['nullable', 'date']])->validate();
        $id = $this->surveys->assign($app->id, $data['assigned_to'] ?? null, $data['scheduled_at'] ?? null, $actor);
        $this->flow->assigned($data['assigned_to'] ?? null, 'Survei '.DB::table('application_surveys')->where('id', $id)->value('survey_number'), 'Survei', "/survei/{$id}", $actor);

        return response()->json(['data' => $this->detail($id, $actor)], 201);
    }

    public function show(Request $request, string $survey): JsonResponse
    {
        $this->viewableSurvey($request, $survey);

        return response()->json(['data' => $this->detail($survey, $request->user())]);
    }

    public function reassign(Request $request, string $survey): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnSurvey($actor, 'surveys.assign', $survey);
        $data = Validator::make($request->all(), ['assigned_to' => ['required', 'uuid']])->validate();
        $this->surveys->reassign($survey, $data['assigned_to'], $actor);

        return response()->json(['data' => $this->detail($survey, $actor)]);
    }

    public function cancel(Request $request, string $survey): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnSurvey($actor, 'surveys.assign', $survey);
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->surveys->cancel($survey, $data['reason'], $actor);

        return response()->json(['data' => $this->detail($survey, $actor)]);
    }

    public function updateDraft(Request $request, string $survey, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnSurvey($actor, 'surveys.execute', $survey);
        $data = Validator::make($request->all(), $this->contentRules())->validate();
        $this->surveys->updateDraft($survey, $version, $data, $actor);

        return response()->json(['data' => $this->detail($survey, $actor)]);
    }

    /** @return array<string,mixed> */
    private function contentRules(): array
    {
        return [
            'survey_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'findings' => ['sometimes', 'nullable', 'string', 'max:10000'], 'technical_recommendation' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'requires_drawing' => ['sometimes', 'nullable', 'boolean'], 'requires_network_extension' => ['sometimes', 'nullable', 'boolean'], 'requires_feasibility_study' => ['sometimes', 'nullable', 'boolean'],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'], 'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'network_distance_m' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100000000'], 'sr_length_m' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100000'], 'network_type' => ['sometimes', 'nullable', 'string', 'max:100'],
            'transformer_capacity_kva' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:1000000'], 'network_condition' => ['sometimes', 'nullable', 'string', 'max:5000'], 'notes' => ['sometimes', 'nullable', 'string', 'max:5000'], 'no_extension_reason' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'measurements' => ['sometimes', 'array', 'max:100'], 'measurements.*.name' => ['required', 'string', 'max:100'], 'measurements.*.value' => ['required', 'string', 'max:200'], 'measurements.*.unit' => ['nullable', 'string', 'max:30'],
        ];
    }

    public function submit(Request $request, string $survey, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnSurvey($actor, 'surveys.execute', $survey);
        // The form may send its current content with the submit: it is saved and submitted in one step, so what the surveyor sees is what gets checked.
        $content = Validator::make($request->all(), $this->contentRules())->validate();
        $this->surveys->submit($survey, $version, $actor, $content);
        $this->flow->surveySubmitted($survey, $actor);

        return response()->json(['data' => $this->detail($survey, $actor)]);
    }

    public function decide(Request $request, string $survey, string $version): JsonResponse
    {
        $actor = $request->user();
        $steps = array_keys((array) config('distriva_permissions.survey_steps'));
        $this->authorizer->authorizeScope($actor, 'surveys.view');                 // any survey actor; the step grant follows below
        $data = Validator::make($request->all(), ['step' => ['required', Rule::in($steps)], 'decision' => ['required', Rule::in(['APPROVED', 'REJECTED'])], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $key = (string) config("distriva_permissions.survey_steps.{$data['step']}.key");
        $this->authorizeOnSurvey($actor, $key, $survey);
        $role = $this->authorizer->roleFor($actor, $key) ?? 'UNKNOWN';
        $stageBefore = DB::table('application_survey_versions')->where('id', $version)->value('stage');
        $result = $this->surveys->decide($survey, $version, $data['step'], $data['decision'], $data['notes'] ?? null, $role, $actor);
        $this->flow->surveyDecided($survey, $stageBefore, $data['decision'], $data['notes'] ?? null, $result, $actor);

        return response()->json(['data' => $this->detail($survey, $actor), 'result' => $result]);
    }

    // ------------------------------------------------------------------------------------------------------

    private function viewableApplication(Request $request, string $applicationId): object
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'surveys.view');
        $app = DB::table('applications')->where('id', $applicationId)->first();
        if ($app === null || (! $scope['unrestricted'] && ! in_array($app->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $app;
    }

    private function viewableSurvey(Request $request, string $surveyId): object
    {
        $s = DB::table('application_surveys')->where('id', $surveyId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewableApplication($request, $s->application_id);

        return $s;
    }

    /** grant first (403), then hide anything outside the unit scope (404) */
    private function authorizeOnSurvey($actor, string $key, string $surveyId): void
    {
        $this->authorizer->authorizeScope($actor, $key);
        $s = DB::table('application_surveys')->where('id', $surveyId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $unit = DB::table('applications')->where('id', $s->application_id)->value('organizational_unit_id');
        $this->authorizer->authorizeOnUnit($actor, $key, $unit);
    }

    /** @return array<string,mixed> */
    private function detail(string $surveyId, $actor): array
    {
        $s = DB::table('application_surveys as s')->join('users as u', 'u.id', '=', 's.assigned_to')->where('s.id', $surveyId)->first(['s.*', 'u.name as surveyor_name', 'u.email as surveyor_email']);
        $app = DB::table('applications')->where('id', $s->application_id)->first(['id', 'application_number', 'application_type', 'current_status', 'organizational_unit_id']);
        $versions = DB::table('application_survey_versions')->where('survey_id', $surveyId)->orderBy('version_number')->get();
        $decisions = DB::table('application_survey_decisions as d')->join('users as u', 'u.id', '=', 'd.decided_by')->whereIn('d.version_id', $versions->pluck('id'))->orderBy('d.seq')
            ->get(['d.version_id', 'd.step', 'd.decision', 'd.decided_role', 'd.notes', 'd.decided_at', 'u.name as decided_by_name', 'u.email as decided_by_email'])->groupBy('version_id');
        $docs = DB::table('application_documents as d')->join('application_document_versions as v', 'v.id', '=', 'd.current_version_id')->whereIn('d.survey_version_id', $versions->pluck('id'))->where('d.status', 'ACTIVE')
            ->orderBy('d.created_at')->get(['d.id', 'd.survey_version_id', 'd.title', 'd.document_code', 'v.version_number', 'v.original_name', 'v.mime_type', 'v.size_bytes', 'v.uploaded_at'])->groupBy('survey_version_id');

        $steps = (array) config('distriva_permissions.survey_steps');
        $open = $versions->first(fn ($v) => ! in_array($v->status, ['RETURNED', 'ACCEPTED'], true));
        $can = ['assign' => false, 'execute' => false, 'decide' => []];
        if ($s->status === 'ACTIVE' && $open !== null) {
            $unit = $app->organizational_unit_id;
            $on = fn (string $k): bool => $this->authorizer->can($actor, $k) && (function () use ($actor, $k, $unit): bool {
                try {
                    $this->authorizer->authorizeOnUnit($actor, $k, $unit);

                    return true;
                } catch (AdministrationDenied) {
                    return false;
                }
            })();
            $can['assign'] = $on('surveys.assign');
            $can['execute'] = $open->status === 'DRAFT' && $on('surveys.execute');
            $mine = DB::table('application_survey_decisions')->where('version_id', $open->id)->where('decided_by', $actor->getKey())->exists();
            foreach ($steps as $step => $cfg) {
                if ($open->stage === $cfg['stage'] && $open->surveyor_id !== $actor->getKey() && ! $mine && $on($cfg['key'])
                    && ! DB::table('application_survey_decisions')->where('version_id', $open->id)->where('step', $step)->exists()) {
                    $can['decide'][] = $step;
                }
            }
        }

        return ['id' => $s->id, 'survey_number' => $s->survey_number, 'sequence_number' => $s->sequence_number, 'status' => $s->status, 'scheduled_at' => $s->scheduled_at, 'cancel_reason' => $s->cancel_reason,
            'surveyor' => ['id' => $s->assigned_to, 'name' => $s->surveyor_name, 'email' => $s->surveyor_email],
            'application' => ['id' => $app->id, 'application_number' => $app->application_number, 'application_type' => $app->application_type, 'status' => $app->current_status,
                'proposal_id' => DB::table('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->where('pa.application_id', $app->id)->where('p.status', 'OPEN')->orderByDesc('p.created_at')->value('p.id')],
            'can' => $can,
            'versions' => $versions->map(fn ($v) => [
                'id' => $v->id, 'version_number' => $v->version_number, 'status' => $v->status, 'stage' => $v->stage, 'surveyor_id' => $v->surveyor_id, 'survey_date' => $v->survey_date, 'findings' => $v->findings,
                'technical_recommendation' => $v->technical_recommendation, 'requires_drawing' => $v->requires_drawing, 'requires_network_extension' => $v->requires_network_extension,
                'requires_feasibility_study' => $v->requires_feasibility_study, 'latitude' => $v->latitude === null ? null : (float) $v->latitude, 'longitude' => $v->longitude === null ? null : (float) $v->longitude,
                'network_distance_m' => $v->network_distance_m === null ? null : (float) $v->network_distance_m, 'sr_length_m' => $v->sr_length_m === null ? null : (float) $v->sr_length_m, 'network_type' => $v->network_type,
                'transformer_capacity_kva' => $v->transformer_capacity_kva === null ? null : (float) $v->transformer_capacity_kva, 'network_condition' => $v->network_condition, 'notes' => $v->notes,
                'no_extension_reason' => $v->no_extension_reason, 'outcome' => $v->requires_network_extension === null ? null : ($v->requires_network_extension ? 'EXTENSION' : 'NO_EXTENSION'),
                'short_chain' => true, 'kko_snapshot' => json_decode((string) $v->kko_snapshot, true),
                'measurements' => json_decode((string) $v->measurements, true), 'submitted_at' => $v->submitted_at, 'accepted_at' => $v->accepted_at, 'returned_at' => $v->returned_at,
                'returned_at_step' => $v->returned_at_step, 'return_reason' => $v->return_reason,
                'decisions' => ($decisions->get($v->id) ?? collect())->map(fn ($d) => (array) $d)->all(),
                'documents' => ($docs->get($v->id) ?? collect())->map(fn ($d) => (array) $d)->all(),
            ])->all(),
        ];
    }
}
