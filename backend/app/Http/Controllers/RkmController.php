<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Rkm\RkmService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** RKM (docs/62 §31). Violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class RkmController extends Controller
{
    private const STEP_KEYS = ['VALIDATE_PERENCANAAN' => 'rkm.validate_perencanaan', 'VALIDATE_KONSTRUKSI' => 'rkm.validate_konstruksi', 'APPROVE_UP3_MANAGER' => 'rkm.approve'];

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly RkmService $rkm, private readonly WorkflowNotifier $flow) {}

    public function createPlan(Request $request): JsonResponse
    {
        $actor = $request->user();
        if ($this->authorizer->roleFor($actor, 'rkm.plan') === null) {
            throw new AdministrationDenied('Tidak berwenang.', 403);                                   // grant first, then validate
        }
        $d = Validator::make($request->all(), ['up3_unit_id' => ['required', 'uuid'], 'period_type' => ['required', 'in:MONTH,QUARTER,SEMESTER,YEAR'], 'period_start' => ['required', 'date_format:Y-m-d']])->validate();
        $this->authorizer->authorizeOnUp3($actor, 'rkm.plan', $d['up3_unit_id']);

        return response()->json(['data' => $this->rkm->createPlan($d['up3_unit_id'], $d['period_type'], $d['period_start'], $actor)], 201);
    }

    public function plans(Request $request): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->authorizer->scopeFor($actor, 'rkm.view');
        if ($this->authorizer->roleFor($actor, 'rkm.view') === null) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
        $plans = DB::table('rkm_plans as p')->join('organizational_units as u', 'u.id', '=', 'p.up3_unit_id')->orderByDesc('p.period_start')->get(['p.*', 'u.name as up3_name']);
        $plans = $plans->filter(fn ($p) => $this->seesPlan($actor, $scope, $p));

        return response()->json(['data' => $plans->map(fn ($p) => ['id' => $p->id, 'plan_number' => $p->plan_number, 'up3_name' => $p->up3_name, 'period_type' => $p->period_type, 'period_start' => $p->period_start, 'period_end' => $p->period_end,
            'versions' => DB::table('rkm_versions')->where('plan_id', $p->id)->orderBy('version_number')->get(['id', 'version_number', 'status', 'round'])->map(fn ($v) => ['id' => $v->id, 'version_number' => (int) $v->version_number, 'status' => $v->status, 'round' => (int) $v->round])->all()])->values()->all()]);
    }

    public function amend(Request $request, string $plan): JsonResponse
    {
        $actor = $request->user();
        $p = $this->plan($plan);
        $this->authorizer->authorizeOnUp3($actor, 'rkm.plan', $p->up3_unit_id);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();

        return response()->json(['data' => ['version_id' => $this->rkm->amend($plan, $d['reason'], $actor)]], 201);
    }

    public function show(Request $request, string $version): JsonResponse
    {
        $v = $this->version($version);
        $p = $this->plan($v->plan_id);
        $actor = $request->user();
        if ($this->authorizer->roleFor($actor, 'rkm.view') === null) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
        $scope = $this->authorizer->scopeFor($actor, 'rkm.view');
        $all = $scope['unrestricted'] || $this->authorizer->holdsOnUp3($actor, 'rkm.view', $p->up3_unit_id);
        $proposals = DB::table('rkm_proposals as r')->join('organizational_units as u', 'u.id', '=', 'r.ulp_unit_id')->where('r.version_id', $version)->orderBy('u.code')->get(['r.*', 'u.code as ulp_code', 'u.name as ulp_name']);
        $proposals = $proposals->filter(fn ($r) => $all || in_array($r->ulp_unit_id, $scope['units'], true))->values();
        if (! $all && $proposals->isEmpty()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $lines = DB::table('rkm_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->whereIn('l.proposal_id', $proposals->pluck('id'))->orderByRaw('length(k.code), k.code')->get(['l.*', 'k.code']);
        $pk = DB::table('rkm_proposal_packages as pp')->join('mto_packages as m', 'm.id', '=', 'pp.mto_package_id')->join('applications as a', 'a.id', '=', 'm.application_id')->whereIn('pp.proposal_id', $proposals->pluck('id'))->get(['pp.proposal_id', 'm.id as package_id', 'a.application_number']);
        $decisions = $all ? DB::table('rkm_decisions as d')->join('users as u', 'u.id', '=', 'd.decided_by')->where('d.version_id', $version)->orderBy('d.decided_at')->get(['d.round', 'd.step', 'd.decision', 'd.decided_role', 'd.notes', 'd.decided_at', 'u.name as decided_by_name']) : collect();
        $adj = $all ? DB::table('rkm_adjustments as a')->join('khs_items as k', 'k.id', '=', 'a.khs_item_id')->join('users as u', 'u.id', '=', 'a.actor_user_id')->where('a.version_id', $version)->orderBy('a.occurred_at')->get(['a.proposal_id', 'k.code', 'a.before_qty', 'a.after_qty', 'a.reason', 'a.occurred_at', 'u.name as actor_name']) : collect();

        return response()->json(['data' => ['id' => $v->id, 'plan' => ['id' => $p->id, 'plan_number' => $p->plan_number, 'period_type' => $p->period_type, 'period_start' => $p->period_start, 'period_end' => $p->period_end],
            'version_number' => (int) $v->version_number, 'status' => $v->status, 'round' => (int) $v->round, 'amendment_reason' => $v->amendment_reason, 'approved_at' => $v->approved_at, 'snapshot_hash' => $v->snapshot_hash,
            'proposals' => $proposals->map(fn ($r) => ['id' => $r->id, 'ulp' => ['id' => $r->ulp_unit_id, 'code' => $r->ulp_code, 'name' => $r->ulp_name], 'status' => $r->status, 'submitted_at' => $r->submitted_at, 'return_reason' => $r->return_reason,
                'packages' => $pk->where('proposal_id', $r->id)->map(fn ($x) => ['package_id' => $x->package_id, 'application_number' => $x->application_number])->values()->all(),
                'lines' => $lines->where('proposal_id', $r->id)->map(fn ($l) => ['khs_code' => $l->code, 'qty_work' => (float) $l->qty_work, 'qty_pipeline' => (float) $l->qty_pipeline, 'qty_forecast' => (float) $l->qty_forecast, 'qty_validated' => $l->qty_validated === null ? null : (float) $l->qty_validated, 'note' => $l->note])->values()->all()])->all(),
            'decisions' => $decisions->map(fn ($d) => (array) $d)->all(), 'adjustments' => $adj->map(fn ($a) => ['proposal_id' => $a->proposal_id, 'khs_code' => $a->code, 'before_qty' => (float) $a->before_qty, 'after_qty' => (float) $a->after_qty, 'reason' => $a->reason, 'occurred_at' => $a->occurred_at, 'actor_name' => $a->actor_name])->all()]]);
    }

    /** GET /rkm/versions/{id}/requirements — UP3 consolidation: UP3-level readers only. */
    public function requirements(Request $request, string $version): JsonResponse
    {
        $v = $this->version($version);
        $p = $this->plan($v->plan_id);
        $actor = $request->user();
        if ($this->authorizer->roleFor($actor, 'rkm.view') === null) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
        if (! $this->authorizer->holdsOnUp3($actor, 'rkm.view', $p->up3_unit_id)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $d = $request->validate(['date' => ['nullable', 'date_format:Y-m-d']]);
        if ($v->status === 'APPROVED' && $v->snapshot !== null && ! isset($d['date'])) {
            return response()->json(['data' => (array) json_decode((string) $v->snapshot, true), 'frozen' => true]);
        }

        return response()->json(['data' => $this->rkm->requirements($version, $d['date'] ?? null), 'frozen' => false]);
    }

    public function setPackages(Request $request, string $proposal): JsonResponse
    {
        $this->prepare($request, $proposal);
        $d = Validator::make($request->all(), ['package_ids' => ['present', 'array', 'max:500'], 'package_ids.*' => ['uuid', 'distinct']])->validate();
        $this->rkm->setPackages($proposal, $d['package_ids']);

        return response()->json(['message' => 'Paket MTO usulan disimpan; kebutuhan pekerjaan dihitung ulang.']);
    }

    public function putLines(Request $request, string $proposal): JsonResponse
    {
        $this->prepare($request, $proposal);
        $d = Validator::make($request->all(), ['lines' => ['present', 'array', 'max:1000'], 'lines.*.khs_code' => ['required', 'string', 'max:50'], 'lines.*.qty_pipeline' => ['nullable', 'numeric', 'min:0', 'max:1000000000'],
            'lines.*.qty_forecast' => ['nullable', 'numeric', 'min:0', 'max:1000000000'], 'lines.*.note' => ['nullable', 'string', 'max:255']])->validate();
        $this->rkm->putLines($proposal, $d['lines'], $request->user());

        return response()->json(['message' => 'Usulan disimpan.']);
    }

    public function submit(Request $request, string $proposal): JsonResponse
    {
        $r = $this->proposal($proposal);
        $this->authorizer->authorizeScope($request->user(), 'rkm.submit');
        $this->authorizer->authorizeOnUnit($request->user(), 'rkm.submit', $r->ulp_unit_id);
        $this->rkm->submit($proposal, $request->user());
        $this->flow->rkmSubmitted($proposal, $request->user());

        return response()->json(['message' => 'Usulan diajukan.']);
    }

    public function startValidation(Request $request, string $version): JsonResponse
    {
        $this->planAction($request, $version);
        $this->rkm->startValidation($version);

        return response()->json(['message' => 'Validasi dimulai.']);
    }

    public function adjust(Request $request, string $version): JsonResponse
    {
        $this->planAction($request, $version);
        $d = Validator::make($request->all(), ['proposal_id' => ['required', 'uuid'], 'khs_code' => ['required', 'string', 'max:50'], 'quantity' => ['required', 'numeric', 'min:0', 'max:1000000000'], 'reason' => ['required', 'string', 'max:1000']])->validate();
        $this->rkm->adjust($version, $d['proposal_id'], $d['khs_code'], (float) $d['quantity'], $d['reason'], $request->user());

        return response()->json(['message' => 'Kuantitas disesuaikan.']);
    }

    public function decide(Request $request, string $version): JsonResponse
    {
        $actor = $request->user();
        $v = $this->version($version);
        $p = $this->plan($v->plan_id);
        $d0 = $request->validate(['step' => ['required', 'in:VALIDATE_PERENCANAAN,VALIDATE_KONSTRUKSI,APPROVE_UP3_MANAGER']]);
        $key = self::STEP_KEYS[$d0['step']];
        $this->authorizer->authorizeOnUp3($actor, $key, $p->up3_unit_id);
        $d = Validator::make($request->all(), ['decision' => ['required', 'in:APPROVED,RETURNED,REJECTED'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $this->rkm->decide($version, $d0['step'], $d['decision'], $d['notes'] ?? null, $actor, (string) $this->authorizer->roleFor($actor, $key));
        $this->flow->rkmDecided($version, $d0['step'], $d['decision'], $d['notes'] ?? null, $actor);

        return response()->json(['message' => 'Keputusan dicatat.']);
    }

    private function prepare(Request $request, string $proposal): void
    {
        $r = $this->proposal($proposal);
        $this->authorizer->authorizeScope($request->user(), 'rkm.prepare');
        $this->authorizer->authorizeOnUnit($request->user(), 'rkm.prepare', $r->ulp_unit_id);
    }

    private function planAction(Request $request, string $version): void
    {
        $p = $this->plan($this->version($version)->plan_id);
        $this->authorizer->authorizeOnUp3($request->user(), 'rkm.plan', $p->up3_unit_id);
    }

    /** @param array{unrestricted:bool,units:list<string>} $scope */
    private function seesPlan(User $actor, array $scope, object $p): bool
    {
        return $scope['unrestricted'] || $this->authorizer->holdsOnUp3($actor, 'rkm.view', $p->up3_unit_id)
            || DB::table('rkm_proposals as r')->join('rkm_versions as v', 'v.id', '=', 'r.version_id')->where('v.plan_id', $p->id)->whereIn('r.ulp_unit_id', $scope['units'])->exists();
    }

    private function plan(string $id): object
    {
        return DB::table('rkm_plans')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function version(string $id): object
    {
        return DB::table('rkm_versions')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function proposal(string $id): object
    {
        return DB::table('rkm_proposals')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
