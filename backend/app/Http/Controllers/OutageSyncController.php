<?php

namespace App\Http\Controllers;

use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Outages\OutageSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Menu "Data Gangguan (Sinkron)": sumber Google Sheet, sinkronisasi harian atau manual, riwayat, dan pemetaan nama penyulang. Membaca butuh outages.view, mengubah butuh outages.sync. */
class OutageSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $scoped, private readonly CatalogAuthorizer $catalog, private readonly OutageSyncService $sync) {}

    public function show(Request $request): JsonResponse
    {
        $this->scoped->authorizeScope($request->user(), 'outages.view');
        $canSync = $this->catalog->allows($request->user(), 'outages.sync');
        $runs = DB::table('outage_sync_runs')->orderByDesc('created_at')->limit(15)->get()->map(fn ($r) => $this->sync->run($r))->all();
        $stats = DB::table('outage_events')->whereNull('source_removed_at')->selectRaw('count(*) as events, min(occurred_at) as first_at, max(occurred_at) as last_at, count(distinct feeder_id) as feeders, count(*) filter (where feeder_id is null) as unmatched_events')->first();

        return response()->json(['data' => ['settings' => $this->sync->settings(), 'runs' => $runs, 'stats' => ['events' => (int) $stats->events, 'first_at' => $stats->first_at, 'last_at' => $stats->last_at, 'feeders' => (int) $stats->feeders, 'unmatched_events' => (int) $stats->unmatched_events],
            'unmatched' => $this->sync->unmatched(), 'feeders' => $canSync ? DB::table('distribution_feeders')->orderBy('name')->get(['id', 'code', 'name', 'gi_name'])->all() : [], 'can' => ['sync' => $canSync]]]);
    }

    public function save(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->catalog->authorize($actor, 'outages.sync');
        $d = Validator::make($request->all(), [
            'sheet_url' => ['nullable', 'string', 'max:500'], 'gids' => ['sometimes', 'array', 'max:10'], 'gids.*' => ['integer', 'min:0'],
            'auto_enabled' => ['required', 'boolean'], 'auto_time' => ['required', 'regex:/^([01][0-9]|2[0-3]):[0-5][0-9]$/'],
            'saidi_min_minutes' => ['required', 'integer', 'between:0,120'], 'saidi_only_permanent' => ['required', 'boolean'],
        ])->validate();

        return response()->json(['data' => $this->sync->save($d, $actor), 'message' => 'Pengaturan sinkronisasi gangguan disimpan.']);
    }

    /** POST /outages/sync/runs: sinkronisasi manual; menjawab segera, prosesnya berjalan sendiri. */
    public function start(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->catalog->authorize($actor, 'outages.sync');
        $id = $this->sync->start('MANUAL', $actor);
        $this->sync->launch($id);

        return response()->json(['data' => ['id' => $id], 'message' => 'Sinkronisasi dimulai.'], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $this->scoped->authorizeScope($request->user(), 'outages.view');
        $r = DB::table('outage_sync_runs')->where('id', $run)->first();
        abort_if($r === null, 404);

        return response()->json(['data' => $this->sync->run($r)]);
    }

    public function alias(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->catalog->authorize($actor, 'outages.sync');
        $d = Validator::make($request->all(), ['gi_name' => ['required', 'string', 'max:100'], 'feeder_name' => ['required', 'string', 'max:100'], 'feeder_id' => ['required', 'uuid']])->validate();
        $n = $this->sync->alias($d['gi_name'], $d['feeder_name'], $d['feeder_id'], $actor);

        return response()->json(['data' => ['updated_events' => $n, 'unmatched' => $this->sync->unmatched()], 'message' => "Nama penyulang dipetakan; {$n} peristiwa diperbarui."]);
    }
}
