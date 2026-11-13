<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Drawings\DrawingService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Technical drawing package (stage 3). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). Grant is checked before validation. */
class DrawingController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly DrawingService $drawings, private readonly WorkflowNotifier $flow) {}

    public function access(Request $request): JsonResponse
    {
        $can = [];
        foreach (array_keys((array) config('distriva_permissions.drawings')) as $key) {
            $can[$key] = $this->authorizer->can($request->user(), $key);
        }

        return response()->json(['can' => $can]);
    }

    /** The package of an application (data:null when none yet). */
    public function forApplication(Request $request, string $application): JsonResponse
    {
        $app = $this->viewableApplication($request, $application);
        $d = DB::table('application_drawings')->where('application_id', $app->id)->first();

        return response()->json(['data' => $d === null ? null : $this->detail($d->id, $request->user())]);
    }

    public function authors(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'drawings.assign');
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, 'drawings.assign', $app->organizational_unit_id);
        $today = now(config('distriva.business_timezone'))->toDateString();
        $users = DB::table('users as u')->join('user_role_assignments as a', 'a.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'a.role_id')
            ->where('r.name', 'TEKNIK')->where('a.organizational_unit_id', $app->organizational_unit_id)->where('a.is_active', true)->where('u.account_status', 'ACTIVE')
            ->whereDate('a.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today))->orderBy('u.name')->distinct()->get(['u.id', 'u.name', 'u.email']);

        return response()->json(['data' => $users->all()]);
    }

    public function store(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        // Role-based (owner 7 Nov 2026): a TEKNIK of the ULP opens the drawing package of any customer of the ULP himself; naming another author stays a MANAGER_ULP action (`drawings.assign`).
        $key = $request->filled('assigned_to') ? 'drawings.assign' : 'drawings.execute';
        $this->authorizer->authorizeScope($actor, $key);
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($actor, $key, $app->organizational_unit_id);
        $data = Validator::make($request->all(), ['assigned_to' => ['nullable', 'uuid']])->validate();
        $id = $this->drawings->create($app->id, $data['assigned_to'] ?? null, $actor);
        $this->flow->assigned($data['assigned_to'] ?? null, 'Gambar '.DB::table('application_drawings')->where('id', $id)->value('drawing_number'), 'Gambar', "/gambar/{$id}", $actor);

        return response()->json(['data' => $this->detail($id, $actor)], 201);
    }

    public function show(Request $request, string $drawing): JsonResponse
    {
        $d = DB::table('application_drawings')->where('id', $drawing)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewableApplication($request, $d->application_id);

        return response()->json(['data' => $this->detail($drawing, $request->user())]);
    }

    public function reassign(Request $request, string $drawing): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOn($actor, 'drawings.assign', $drawing);
        $data = Validator::make($request->all(), ['assigned_to' => ['required', 'uuid']])->validate();
        $this->drawings->reassign($drawing, $data['assigned_to'], $actor);

        return response()->json(['data' => $this->detail($drawing, $actor)]);
    }

    public function revise(Request $request, string $drawing): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOn($actor, 'drawings.execute', $drawing);
        $this->drawings->revise($drawing, $actor);

        return response()->json(['data' => $this->detail($drawing, $actor)], 201);
    }

    public function updateDraft(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOn($actor, 'drawings.execute', $drawing);
        $data = Validator::make($request->all(), ['title' => ['sometimes', 'nullable', 'string', 'max:200'], 'description' => ['sometimes', 'nullable', 'string', 'max:5000'], 'notes' => ['sometimes', 'nullable', 'string', 'max:5000']])->validate();
        $this->drawings->updateDraft($drawing, $version, $data, $actor);

        return response()->json(['data' => $this->detail($drawing, $actor)]);
    }

    public function submit(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOn($actor, 'drawings.execute', $drawing);
        $this->drawings->submit($drawing, $version, $actor);
        $this->flow->drawingSubmitted($drawing, $actor);

        return response()->json(['data' => $this->detail($drawing, $actor)]);
    }

    public function escalate(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOn($actor, 'drawings.escalate', $drawing);
        $v = DB::table('application_drawing_versions')->where('id', $version)->where('drawing_id', $drawing)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if (! $this->mayEscalateAt($actor, $v)) {
            throw new AdministrationDenied('Peran Anda tidak dapat mewajibkan persetujuan diperluas pada tahap ini.', 403);
        }
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->drawings->escalate($drawing, $version, $data['reason'], $actor);

        return response()->json(['data' => $this->detail($drawing, $actor)]);
    }

    public function decide(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'drawings.view');
        $data = Validator::make($request->all(), ['step' => ['required', Rule::in(array_keys((array) config('distriva_permissions.drawing_steps')))], 'decision' => ['required', Rule::in(['APPROVED', 'REJECTED'])], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $key = (string) config("distriva_permissions.drawing_steps.{$data['step']}.key");
        $this->authorizeOn($actor, $key, $drawing);
        $role = $this->authorizer->roleFor($actor, $key) ?? 'UNKNOWN';
        $stageBefore = DB::table('application_drawing_versions')->where('id', $version)->value('stage');
        $result = $this->drawings->decide($drawing, $version, $data['step'], $data['decision'], $data['notes'] ?? null, $role, $actor);
        $this->flow->drawingDecided($drawing, $stageBefore, $data['decision'], $data['notes'] ?? null, $result, $actor);

        return response()->json(['data' => $this->detail($drawing, $actor), 'result' => $result]);
    }

    // ------------------------------------------------------------------------------------------------------

    /** MANAGER_ULP while SUBMITTED, PERENCANAAN / KONSTRUKSI_UP3 during the UP3 review (SYS_ADMIN both). */
    private function mayEscalateAt($actor, object $v): bool
    {
        $moment = $v->status === 'SUBMITTED' ? 'SUBMITTED' : ($v->status === 'UNDER_REVIEW' && $v->stage === 'UP3_REVIEW' ? 'UP3_REVIEW' : null);

        return $moment !== null && array_intersect($this->authorizer->rolesFor($actor, 'drawings.escalate'), (array) config("distriva_permissions.drawing_escalation.{$moment}")) !== [];
    }

    private function viewableApplication(Request $request, string $applicationId): object
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'drawings.view');
        $app = DB::table('applications')->where('id', $applicationId)->first();
        if ($app === null || (! $scope['unrestricted'] && ! in_array($app->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $app;
    }

    /** grant first (403), then hide anything outside the unit scope (404) */
    private function authorizeOn($actor, string $key, string $drawingId): void
    {
        $this->authorizer->authorizeScope($actor, $key);
        $d = DB::table('application_drawings')->where('id', $drawingId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $unit = DB::table('applications')->where('id', $d->application_id)->value('organizational_unit_id');
        $this->authorizer->authorizeOnUnit($actor, $key, $unit);
    }

    /** @return array<string,mixed> */
    private function detail(string $drawingId, $actor): array
    {
        $d = DB::table('application_drawings as d')->join('users as u', 'u.id', '=', 'd.assigned_to')->where('d.id', $drawingId)->first(['d.*', 'u.name as author_name', 'u.email as author_email']);
        $app = DB::table('applications')->where('id', $d->application_id)->first(['id', 'application_number', 'application_type', 'current_status', 'organizational_unit_id']);
        $versions = DB::table('application_drawing_versions')->where('drawing_id', $drawingId)->orderBy('version_number')->get();
        $decisions = DB::table('application_drawing_decisions as x')->join('users as u', 'u.id', '=', 'x.decided_by')->whereIn('x.version_id', $versions->pluck('id'))->orderBy('x.seq')
            ->get(['x.version_id', 'x.step', 'x.decision', 'x.decided_role', 'x.notes', 'x.decided_at', 'u.name as decided_by_name', 'u.email as decided_by_email'])->groupBy('version_id');
        $docs = DB::table('application_documents as d')->join('application_document_versions as v', 'v.id', '=', 'd.current_version_id')->whereIn('d.drawing_version_id', $versions->pluck('id'))->where('d.status', 'ACTIVE')
            ->orderBy('d.created_at')->get(['d.id', 'd.drawing_version_id', 'd.file_role', 'd.title', 'd.document_code', 'v.version_number', 'v.original_name', 'v.mime_type', 'v.extension', 'v.size_bytes', 'v.uploaded_at'])->groupBy('drawing_version_id');

        $steps = (array) config('distriva_permissions.drawing_steps');
        $open = $versions->first(fn ($v) => in_array($v->status, ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'], true));
        $unit = $app->organizational_unit_id;
        $on = function (string $k) use ($actor, $unit): bool {
            if (! $this->authorizer->can($actor, $k)) {
                return false;
            }
            try {
                $this->authorizer->authorizeOnUnit($actor, $k, $unit);

                return true;
            } catch (AdministrationDenied) {
                return false;
            }
        };
        $can = ['assign' => false, 'execute' => false, 'revise' => false, 'escalate' => false, 'decide' => []];
        $can['assign'] = $on('drawings.assign') && $open !== null && $open->status === 'DRAFT';
        $can['revise'] = $open === null && $on('drawings.execute') && in_array($app->current_status, ['APPROVED', 'PAID', 'PK_PRINTED'], true);
        if ($open !== null) {
            $can['execute'] = $open->status === 'DRAFT' && $on('drawings.execute');
            $can['escalate'] = $open->survey_version_id === null && ! $open->extended_approval && $on('drawings.escalate') && $this->mayEscalateAt($actor, $open);
            $mine = DB::table('application_drawing_decisions')->where('version_id', $open->id)->where('decided_by', $actor->getKey())->exists();
            foreach ($open->survey_version_id !== null ? [] : $steps as $step => $cfg) {      // a drawing riding a survey is decided on the survey
                if ($open->stage === $cfg['stage'] && ($open->extended_approval || ! ($cfg['only_extended'] ?? false)) && $open->author_id !== $actor->getKey() && ! $mine && $on($cfg['key'])
                    && ! DB::table('application_drawing_decisions')->where('version_id', $open->id)->where('step', $step)->exists()) {
                    $can['decide'][] = $step;
                }
            }
        }

        return ['id' => $d->id, 'drawing_number' => $d->drawing_number, 'author' => ['id' => $d->assigned_to, 'name' => $d->author_name, 'email' => $d->author_email],
            'application' => ['id' => $app->id, 'application_number' => $app->application_number, 'application_type' => $app->application_type, 'status' => $app->current_status],
            'can' => $can,
            'versions' => $versions->map(fn ($v) => [
                'id' => $v->id, 'version_number' => $v->version_number, 'status' => $v->status, 'stage' => $v->stage, 'author_id' => $v->author_id, 'title' => $v->title, 'description' => $v->description, 'notes' => $v->notes,
                'with_survey' => $v->survey_version_id !== null, 'survey_version_id' => $v->survey_version_id,
                'extended_approval' => (bool) $v->extended_approval, 'extended_reason' => $v->extended_reason,
                'required_steps' => $v->extended_approval ? ['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN', 'UP3_MANAGER'] : ['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN'],
                'submitted_at' => $v->submitted_at, 'approved_at' => $v->approved_at, 'superseded_at' => $v->superseded_at, 'returned_at' => $v->returned_at, 'returned_at_step' => $v->returned_at_step, 'return_reason' => $v->return_reason,
                'decisions' => ($decisions->get($v->id) ?? collect())->map(fn ($x) => (array) $x)->all(),
                'documents' => ($docs->get($v->id) ?? collect())->map(fn ($x) => (array) $x)->all(),
            ])->all(),
        ];
    }
}
