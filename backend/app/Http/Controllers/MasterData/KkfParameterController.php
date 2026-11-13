<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Kkf\KkfParameterService;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** KKF parameter sets (docs/62 §25). Rate fields are fractions (0.0778 = 7.78 %). Violations -> 409, authorization -> 403/404. */
class KkfParameterController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly KkfParameterService $sets, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['status' => ['nullable', Rule::in(['DRAFT', 'APPROVED', 'INACTIVE'])]]);
        $q = DB::table('kkf_parameter_sets')->orderByDesc('valid_from')->orderByDesc('created_at');
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }

        return response()->json(['data' => $q->get()->map(fn ($s) => $this->row($s))->all(), 'defaults' => KkfParameterService::DEFAULTS]);
    }

    public function active(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $d = $request->validate(['date' => ['nullable', 'date_format:Y-m-d']]);
        $s = $this->sets->resolve($d['date'] ?? now()->toDateString()) ?? throw new AdministrationDenied('Belum ada set parameter KKF yang berlaku pada tanggal tersebut.', 404);

        return response()->json(['data' => $this->row($s)]);
    }

    public function show(Request $request, string $set): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $s = DB::table('kkf_parameter_sets')->where('id', $set)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $events = DB::table('kkf_parameter_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.parameter_set_id', $set)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.email as actor_email']);

        return response()->json(['data' => $this->row($s) + ['events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'kkf_params.manage'); // grant first, then validate
        $data = Validator::make($request->all(), ['name' => ['required', 'string', 'max:150'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'notes' => ['nullable', 'string', 'max:2000'], 'reason' => ['nullable', 'string', 'max:1000']] + $this->valueRules(false))->validate();

        return response()->json(['data' => ['id' => $this->sets->create($data, $actor)]], 201);
    }

    public function update(Request $request, string $set): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'kkf_params.manage');
        $data = Validator::make($request->all(), ['name' => ['sometimes', 'string', 'max:150'], 'valid_from' => ['sometimes', 'date_format:Y-m-d'], 'notes' => ['sometimes', 'nullable', 'string', 'max:2000'], 'reason' => ['nullable', 'string', 'max:1000']] + $this->valueRules(true))->validate();
        $this->sets->updateDraft($set, $data, $actor);

        return response()->json(['message' => 'Draf set parameter diperbarui.']);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'kkf_params.approve');
        $data = Validator::make($request->all(), ['set_ids' => ['required', 'array', 'min:1', 'max:10'], 'set_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000']])->validate();

        $out = $this->sets->approve($data['set_ids'], $actor, $data['reason']);
        $this->notifier->approved('kkf_parameter_sets', $data['set_ids'], 'parameter KKF', $actor, $data['reason'], 'KKF', '/master-data/kkf-parameters');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $set): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'kkf_params.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->sets->retire($set, $data['reason'], $actor);

        return response()->json(['message' => 'Set parameter dinonaktifkan.']);
    }

    /** @return array<string,mixed> */
    private function valueRules(bool $partial): array
    {
        $p = $partial ? 'sometimes' : 'nullable';
        $rate = fn (float $min, float $max) => [$p, 'numeric', "min:{$min}", "max:{$max}"];

        return [
            'discount_rate' => [$p, 'numeric', 'gt:0', 'lt:1'], 'bpp' => [$p, 'numeric', 'gt:0', 'max:100000'], 'om_rate' => $rate(0, 0.99), 'load_factor' => [$p, 'numeric', 'gt:0', 'max:1'],
            'roe' => $rate(0, 0.99), 'interest_rate' => $rate(0, 0.99), 'tax_rate' => $rate(0, 0.99),
            'horizon_years' => [$p, 'integer', 'between:1,50'], 'payback_limit_months' => [$p, 'integer', 'between:1,600'],
        ];
    }

    /** @return array<string,mixed> */
    private function row(object $s): array
    {
        $out = ['id' => $s->id, 'name' => $s->name, 'valid_from' => $s->valid_from, 'valid_until' => $s->valid_until, 'status' => $s->status, 'notes' => $s->notes,
            'created_by' => $s->created_by, 'approved_by' => $s->approved_by, 'approved_at' => $s->approved_at];
        foreach (['discount_rate', 'bpp', 'om_rate', 'load_factor', 'roe', 'interest_rate', 'tax_rate'] as $f) {
            $out[$f] = (float) $s->{$f};
        }

        return $out + ['horizon_years' => (int) $s->horizon_years, 'payback_limit_months' => (int) $s->payback_limit_months];
    }
}
