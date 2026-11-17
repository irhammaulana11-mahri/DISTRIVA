<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Substations\MaximoSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Maximo sync started from DISTRIVA: settings (Maximo account, work type, daily run), the run button and the history of the runs. Needs substations.sync. */
class MaximoSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MaximoSyncService $sync) {}

    public function show(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');

        return response()->json(['data' => ['settings' => $this->sync->settings(), 'runs' => $this->query()->limit(10)->get()->map(fn ($r) => $this->run($r, false))->all()]]);
    }

    /** GET /maximo-sync/runs?page= — the whole history, newest first. */
    public function runs(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $d = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'status' => ['nullable', 'in:QUEUED,RUNNING,OK,FAILED'], 'trigger' => ['nullable', 'in:MANUAL,AUTO']]);
        $q = $this->query();
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

        return response()->json(['data' => $this->sync->save($d, $request->user()), 'message' => 'Pengaturan sinkronisasi Maximo disimpan.']);
    }

    /** POST /maximo-sync/runs — starts a manual run (work orders finished since `since`, default the look-back window); answers at once, the run goes on in its own process. */
    public function start(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $d = Validator::make($request->all(), ['since' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'all_work_orders' => ['sometimes', 'boolean']])->validate();
        $id = $this->sync->start('MANUAL', $request->user(), $d['since'] ?? null, (bool) ($d['all_work_orders'] ?? false));
        $this->sync->launch($id);

        return response()->json(['data' => $this->run($this->query()->where('r.id', $id)->first(), true)], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.sync');
        $r = $this->query()->where('r.id', $run)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->run($r, true)]);
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
            + ($withLog ? ['log' => $r->log] : []);
    }
}
