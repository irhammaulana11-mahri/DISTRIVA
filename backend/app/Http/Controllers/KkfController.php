<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Kkf\KkfService;
use App\Services\Proposals\ProposalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** KKF runs (docs/62 §26). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class KkfController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly KkfService $kkf) {}

    /** POST /applications/{application}/kkf-runs — dry_run = calculate only. */
    public function run(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'kkf.run');
        $this->authorizer->authorizeOnUnit($actor, 'kkf.run', $this->unitOf($application));
        if (($p = ProposalService::liveFor($application)) !== null) {
            throw new AssignmentRuleViolation("Pelanggan ini bagian dari usulan {$p->proposal_number}; KKF dihitung untuk seluruh usulan (POST /proposals/{$p->id}/kkf-runs).");
        }
        $data = Validator::make($request->all(), ['previous_meter_payment' => ['nullable', 'in:PRABAYAR,PASCABAYAR'], 'esthetic_fee' => ['nullable', 'numeric', 'min:0', 'max:1000000000000'], 'load_factor' => ['nullable', 'numeric', 'gt:0', 'max:1'],
            'rab_run_id' => ['nullable', 'uuid'], 'date' => ['nullable', 'date_format:Y-m-d'], 'dry_run' => ['sometimes', 'boolean']])->validate();
        if ($request->boolean('dry_run')) {
            return response()->json(['data' => $this->kkf->calculate($application, $data), 'stored' => false]);
        }

        return response()->json(['data' => $this->kkf->run($application, $data, $actor), 'stored' => true], 201);
    }

    /** POST /proposals/{proposal}/kkf-runs — ONE KKF for all the customers of the proposal (dry_run = calculate only). */
    public function runForProposal(Request $request, string $proposal): JsonResponse
    {
        $actor = $request->user();
        $p = DB::table('proposals')->where('id', $proposal)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeScope($actor, 'kkf.run');
        $this->authorizer->authorizeOnUnit($actor, 'kkf.run', $p->ulp_unit_id);
        if ($p->status !== 'OPEN') {
            throw new AssignmentRuleViolation('Usulan sudah dibatalkan.');
        }
        $data = Validator::make($request->all(), ['esthetic_fee' => ['nullable', 'numeric', 'min:0', 'max:1000000000000'], 'load_factor' => ['nullable', 'numeric', 'gt:0', 'max:1'], 'rab_run_id' => ['nullable', 'uuid'], 'date' => ['nullable', 'date_format:Y-m-d'], 'dry_run' => ['sometimes', 'boolean'],
            'members' => ['nullable', 'array', 'max:200'], 'members.*.application_id' => ['required', 'uuid'], 'members.*.previous_meter_payment' => ['nullable', 'in:PRABAYAR,PASCABAYAR']])->validate();
        if ($request->boolean('dry_run')) {
            return response()->json(['data' => $this->kkf->calculate($p->representative_application_id, $data, $proposal), 'stored' => false]);
        }

        return response()->json(['data' => $this->kkf->run($p->representative_application_id, $data, $actor, $proposal), 'stored' => true], 201);
    }

    /** GET /proposals/{proposal}/kkf-runs */
    public function indexForProposal(Request $request, string $proposal): JsonResponse
    {
        $p = DB::table('proposals')->where('id', $proposal)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, $p->ulp_unit_id);

        return $this->index($request, $p->representative_application_id);
    }

    /** GET /applications/{application}/kkf-preview?date=&previous_meter_payment= — the BP (after UJL for a postpaid meter) and the blockers of a run, before any dry run. */
    public function preview(Request $request, string $application): JsonResponse
    {
        $this->viewable($request, $this->unitOf($application));
        $d = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'previous_meter_payment' => ['nullable', 'in:PRABAYAR,PASCABAYAR']]);

        return response()->json(['data' => $this->kkf->preview($application, $d['date'] ?? null, $d['previous_meter_payment'] ?? null)]);
    }

    /** GET /applications/{application}/kkf-runs */
    public function index(Request $request, string $application): JsonResponse
    {
        $this->viewable($request, $this->unitOf($application));
        $runs = DB::table('kkf_runs as k')->join('users as u', 'u.id', '=', 'k.created_by')->join('rab_runs as r', 'r.id', '=', 'k.rab_run_id')->where('k.application_id', $application)->orderByDesc('k.run_number')
            ->get(['k.id', 'k.document_number', 'k.run_number', 'k.valid_on', 'k.feasible', 'k.extended_required', 'k.npv', 'k.irr_percent', 'k.payback_months', 'k.snapshot_hash', 'k.created_at', 'k.inputs', 'u.name as created_by_name', 'r.run_number as rab_run_number']);

        $basis = fn ($k) => (array) (json_decode((string) $k->inputs, true)['inputs'] ?? []);   // the run's own discount rate and payback limit (targets for IRR / PBP)

        return response()->json(['data' => $runs->map(fn ($k) => ['discount_rate_percent' => isset($basis($k)['discount_rate']) ? round((float) $basis($k)['discount_rate'] * 100, 4) : null, 'payback_limit_months' => $basis($k)['payback_limit_months'] ?? null,
            'id' => $k->id, 'document_number' => $k->document_number, 'run_number' => $k->run_number, 'valid_on' => $k->valid_on, 'feasible' => (bool) $k->feasible, 'extended_required' => (bool) $k->extended_required,
            'npv' => (float) $k->npv, 'irr_percent' => $k->irr_percent === null ? null : (float) $k->irr_percent, 'payback_months' => $k->payback_months, 'rab_run_number' => $k->rab_run_number,
            'snapshot_hash' => $k->snapshot_hash, 'created_at' => $k->created_at, 'created_by_name' => $k->created_by_name])->all()]);
    }

    /** GET /kkf-runs/{run} */
    public function show(Request $request, string $run): JsonResponse
    {
        $k = DB::table('kkf_runs')->where('id', $run)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, $this->unitOf($k->application_id));

        return response()->json(['data' => ['id' => $k->id, 'document_number' => $k->document_number, 'application_id' => $k->application_id, 'run_number' => $k->run_number, 'valid_on' => $k->valid_on, 'feasible' => (bool) $k->feasible, 'extended_required' => (bool) $k->extended_required,
            'snapshot_hash' => $k->snapshot_hash, 'created_at' => $k->created_at, 'created_by' => $k->created_by] + (array) json_decode((string) $k->inputs, true) + ['result' => json_decode((string) $k->result, true)]]);
    }

    private function unitOf(string $applicationId): string
    {
        return (string) (DB::table('applications')->where('id', $applicationId)->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404));
    }

    private function viewable(Request $request, string $unitId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'kkf.view');
        if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }
}
