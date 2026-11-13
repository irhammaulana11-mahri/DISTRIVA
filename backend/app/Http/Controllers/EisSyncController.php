<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Applications\EisSyncService;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** EIS sync started from DISTRIVA: settings (EIS account, Range Daya, automatic run), the run button and the history of the runs. */
class EisSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly EisSyncService $sync) {}

    public function show(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $runs = DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->orderByDesc('r.created_at')->limit(10)->get(['r.*', 'u.email as started_by_email']);

        return response()->json(['data' => ['settings' => $this->sync->settings(), 'runs' => $runs->map(fn ($r) => $this->run($r, false))->all()]]);
    }

    public function save(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $d = Validator::make($request->all(), [
            'eis_username' => ['nullable', 'string', 'max:150'], 'eis_password' => ['nullable', 'string', 'max:200'],
            'power_min' => ['required', 'integer', 'min:0', 'max:99999999'], 'power_max' => ['required', 'integer', 'min:0', 'max:99999999'],
            'lookback_days' => ['required', 'integer', 'between:1,730'], 'auto_enabled' => ['required', 'boolean'], 'auto_time' => ['required', 'regex:/^([01][0-9]|2[0-3]):[0-5][0-9]$/'],
        ])->validate();

        return response()->json(['data' => $this->sync->save($d, $request->user()), 'message' => 'Pengaturan sinkronisasi EIS disimpan.']);
    }

    /** POST /eis-sync/runs — starts a manual run (optionally of a given Range Mohon); answers at once, the run goes on in its own process. */
    public function start(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $this->authorizer->authorizeScope($request->user(), 'applications.import');
        $d = Validator::make($request->all(), ['from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'], 'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from']])->validate();
        $id = $this->sync->start('MANUAL', $request->user(), $d['from'] ?? null, $d['to'] ?? null);
        $this->sync->launch($id);

        return response()->json(['data' => $this->run(DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.id', $id)->first(['r.*', 'u.email as started_by_email']), true)], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'eis_sync.manage');
        $r = DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.id', $run)->first(['r.*', 'u.email as started_by_email']) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return response()->json(['data' => $this->run($r, true)]);
    }

    /** @return array<string,mixed> */
    private function run(object $r, bool $withLog): array
    {
        return ['id' => $r->id, 'trigger' => $r->trigger, 'status' => $r->status, 'started_by' => $r->started_by_email, 'range_from' => $r->range_from, 'range_to' => $r->range_to, 'exit_code' => $r->exit_code,
            'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at] + ($withLog ? ['log' => $r->log] : []);
    }
}
