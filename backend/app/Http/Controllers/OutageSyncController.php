<?php

namespace App\Http\Controllers;

use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Outages\OutageSyncService;
use App\Services\Sync\SyncScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Menu "Data Gangguan (Sinkron)": sumber Google Sheet, sinkronisasi harian atau manual, riwayat, dan pemetaan nama penyulang. Membaca butuh outages.view, mengubah butuh outages.sync. */
class OutageSyncController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $scoped, private readonly CatalogAuthorizer $catalog, private readonly OutageSyncService $sync, private readonly SyncScope $scope) {}

    /** GET /outages/sync?up3_id= */
    public function show(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->scoped->authorizeScope($actor, 'outages.view');
        $up3Id = $this->scope->resolve($actor, 'outages.view', $this->requestedUp3($request));
        $canSync = $this->catalog->allows($actor, 'outages.sync') && in_array($up3Id, $this->scope->up3Ids($actor, 'outages.sync'), true);
        $this->sync->expireStale();                                                                           // sesi yang macet tidak boleh mengunci tombol
        $runs = DB::table('outage_sync_runs')->where('up3_id', $up3Id)->orderByDesc('created_at')->limit(15)->get()->map(fn ($r) => $this->sync->run($r))->all();
        $stats = DB::table('outage_events')->where('up3_id', $up3Id)->whereNull('source_removed_at')->selectRaw('count(*) as events, min(occurred_at) as first_at, max(occurred_at) as last_at, count(distinct feeder_id) as feeders, count(*) filter (where feeder_id is null) as unmatched_events')->first();

        return response()->json(['data' => ['settings' => $this->sync->settings($up3Id), 'runs' => $runs, 'stats' => ['events' => (int) $stats->events, 'first_at' => $stats->first_at, 'last_at' => $stats->last_at, 'feeders' => (int) $stats->feeders, 'unmatched_events' => (int) $stats->unmatched_events],
            'unmatched' => $this->sync->unmatched($up3Id), 'feeders' => $canSync ? DB::table('distribution_feeders')->orderBy('name')->get(['id', 'code', 'name', 'gi_name'])->all() : [], 'can' => ['sync' => $canSync, 'settings' => $canSync && $this->scope->coversUp3($actor, 'outages.sync', $up3Id)],
            'up3_id' => $up3Id, 'up3s' => $this->scope->options($actor, 'outages.view')]]);
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
        $up3Id = $this->scope->resolve($actor, 'outages.sync', $this->requestedUp3($request));
        $this->scope->assertManagesUp3($actor, 'outages.sync', $up3Id);

        return response()->json(['data' => $this->sync->save($d, $actor, $up3Id), 'message' => 'Pengaturan sinkronisasi gangguan disimpan.']);
    }

    /** POST /outages/sync/runs {up3_id?}: sinkronisasi manual; menjawab segera, prosesnya berjalan dari antrean. */
    public function start(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->catalog->authorize($actor, 'outages.sync');
        $id = $this->sync->start('MANUAL', $actor, $this->scope->resolve($actor, 'outages.sync', $this->requestedUp3($request)));
        $this->sync->launch($id);

        return response()->json(['data' => ['id' => $id], 'message' => 'Sinkronisasi dimulai.'], 202);
    }

    public function showRun(Request $request, string $run): JsonResponse
    {
        $actor = $request->user();
        $this->scoped->authorizeScope($actor, 'outages.view');
        $this->sync->expireStale();
        $r = DB::table('outage_sync_runs')->where('id', $run)->whereIn('up3_id', $this->scope->up3Ids($actor, 'outages.view'))->first();
        abort_if($r === null, 404);

        return response()->json(['data' => $this->sync->run($r)]);
    }

    public function alias(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->catalog->authorize($actor, 'outages.sync');
        $d = Validator::make($request->all(), ['gi_name' => ['required', 'string', 'max:100'], 'feeder_name' => ['required', 'string', 'max:100'], 'feeder_id' => ['required', 'uuid']])->validate();
        $up3Id = $this->scope->resolve($actor, 'outages.sync', $this->requestedUp3($request));
        $n = $this->sync->alias($d['gi_name'], $d['feeder_name'], $d['feeder_id'], $actor, $up3Id);

        return response()->json(['data' => ['updated_events' => $n, 'unmatched' => $this->sync->unmatched($up3Id)], 'message' => "Nama penyulang dipetakan; {$n} peristiwa diperbarui."]);
    }

    private function requestedUp3(Request $request): ?string
    {
        return Validator::make($request->all(), ['up3_id' => ['nullable', 'uuid']])->validate()['up3_id'] ?? null;
    }
}
