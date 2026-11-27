<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Substations\MaximoSyncService;
use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Maximo sync started from DISTRIVA: settings (Maximo account, work type, daily run), the run button and the history of the runs. Needs substations.sync. */
class MaximoSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MaximoSyncService $sync, private readonly SyncScope $scope, private readonly SyncRuns $syncRuns) {}

    public function show(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');

        $up3Id = $this->up3($request);
        $this->sync->expireStale();

        return response()->json(['data' => ['settings' => $this->sync->settings($up3Id), 'runs' => $this->query()->where('r.up3_id', $up3Id)->limit(10)->get()->map(fn ($r) => $this->run($r, false))->all(),
            'up3_id' => $up3Id, 'up3s' => $this->scope->options($request->user(), 'substations.sync'), 'can_manage_settings' => $this->scope->coversUp3($request->user(), 'substations.sync', $up3Id)]]);
    }

    /** GET /maximo-sync/runs?page= — the whole history, newest first. */
    public function runs(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $d = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'status' => ['nullable', 'in:QUEUED,RUNNING,OK,FAILED'], 'trigger' => ['nullable', 'in:MANUAL,AUTO'], 'active' => ['nullable', 'boolean']]);
        $q = $this->query()->where('r.up3_id', $this->up3($request));
        $request->boolean('active') && $q->whereIn('r.status', ['QUEUED', 'RUNNING']);
        isset($d['status']) && $q->where('r.status', $d['status']);
        isset($d['trigger']) && $q->where('r.trigger', $d['trigger']);
        $page = $q->paginate((int) ($d['per_page'] ?? 10));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => $this->run($r, false))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function save(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $d = Validator::make($request->all(), [
            'maximo_url' => ['required', 'string', 'max:200', 'regex:#^https?://[^\s/]+(:\d+)?$#'], 'maximo_username' => ['nullable', 'string', 'max:150'], 'maximo_password' => ['nullable', 'string', 'max:200'],
            'work_type' => ['required', 'string', 'regex:/^[A-Za-z0-9]{3,10}$/'], 'lookback_days' => ['required', 'integer', 'between:1,365'], 'auto_enabled' => ['required', 'boolean'],
            'auto_time' => ['required', 'regex:/^([01][0-9]|2[0-3]):[0-5][0-9]$/'],
        ])->validate();

        $up3Id = $this->up3($request);
        $this->scope->assertManagesUp3($request->user(), 'substations.sync', $up3Id);

        return response()->json(['data' => $this->sync->save($d, $request->user(), $up3Id), 'message' => 'Pengaturan sinkronisasi Maximo disimpan.']);
    }

    /** POST /maximo-sync/runs — starts a manual run (work orders finished since `since`, default the look-back window); answers at once, the run goes on in its own process. */
    public function start(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $d = Validator::make($request->all(), ['since' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'all_work_orders' => ['sometimes', 'boolean'], 'units' => ['sometimes', 'array', 'min:1', 'max:40'], 'units.*' => ['string', 'regex:/^\\d{5}$/']])->validate();
        $actor = $request->user();
        $up3Id = $this->up3($request);
        $covers = $this->scope->coversUp3($actor, 'substations.sync', $up3Id);
        $ulps = $this->scope->ulpsFor($actor, 'substations.sync', $up3Id);
        if (isset($d['units'])) {
            if (array_diff($d['units'], array_map(fn (object $u) => (string) $u->code, $ulps)) !== []) {
                throw new AssignmentRuleViolation('Ada unit yang tidak dikenal atau di luar cakupan Anda.');
            }
            $ulps = array_values(array_filter($ulps, fn (object $u) => in_array((string) $u->code, $d['units'], true)));
        }
        $ids = $this->sync->start('MANUAL', $actor, $up3Id, $d['since'] ?? null, (bool) ($d['all_work_orders'] ?? false), $covers && ! isset($d['units']) ? null : array_column($ulps, 'id'), $covers, $this->scope->level($actor, 'substations.sync', $up3Id));
        foreach ($ids as $id) {
            $this->sync->launch($id);
        }
        $rows = $this->query()->whereIn('r.id', $ids)->get()->keyBy('id');

        return response()->json(['data' => $this->run($rows[$ids[0]], true), 'runs' => array_map(fn (string $id) => $this->run($rows[$id], false), $ids)], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $r = $this->query()->where('r.id', $run)->whereIn('r.up3_id', $this->scope->up3Ids($request->user(), 'substations.sync'))->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->run($r, true)]);
    }

    private function up3(Request $request): string
    {
        $requested = Validator::make($request->all(), ['up3_id' => ['nullable', 'uuid']])->validate()['up3_id'] ?? null;

        return $this->scope->resolve($request->user(), 'substations.sync', $requested);
    }

    private function query()
    {
        return DB::table('maximo_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->orderByDesc('r.created_at')->select('r.*', 'u.email as started_by_email');
    }

    /** @return array<string,mixed> */
    private function run(object $r, bool $withLog): array
    {
        return ['id' => $r->id, 'trigger' => $r->trigger, 'status' => $r->status, 'started_by' => $r->started_by_email, 'since' => $r->since, 'all_work_orders' => (bool) $r->all_work_orders,
            'summary' => $r->summary === null ? null : json_decode((string) $r->summary, true), 'exit_code' => $r->exit_code, 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at]
            + $this->syncRuns->describe($r) + ($withLog ? ['log' => $r->log] : []);
    }
}
