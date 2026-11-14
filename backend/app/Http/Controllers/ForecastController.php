<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Forecast\ForecastService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Substation-load forecast (docs/11). Reading follows `forecast.view` within the unit scope (a ULP sees its substations, a UP3 its ULPs, the administrator all); running needs `forecast.run`, the review
 * `forecast.review` (never the person who started the run). The results are recommendations.
 */
class ForecastController extends Controller
{
    /** Risk class from the forecast load / capacity (docs/11 §7: the planner decides). KRITIS = already over, or the median passes 100 % within a year; TINGGI = within 3 years; WASPADA = within 5 years or the upper range passes it within 3. */
    private const RISK_SQL = "case when r.last_ratio >= 1 or r.h1_p50 >= 1 then 'KRITIS' when r.h3_p50 >= 1 then 'TINGGI' when r.h5_p50 >= 1 or r.h3_p90 >= 1 then 'WASPADA' else 'AMAN' end";

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly CatalogAuthorizer $catalog, private readonly ForecastService $forecast) {}

    public function runs(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'forecast.view');
        $kind = $request->validate(['kind' => ['nullable', 'in:'.implode(',', ForecastService::KINDS)]])['kind'] ?? ForecastService::KIND;
        $rows = DB::table('forecast_runs as f')->join('users as u', 'u.id', '=', 'f.started_by')->where('f.kind', $kind)->orderByDesc('f.started_at')->limit(20)
            ->get(['f.id', 'f.kind', 'f.status', 'f.started_at', 'f.finished_at', 'f.data_cutoff', 'f.review_status', 'f.error', 'f.counts', 'u.name as started_by_name']);

        return response()->json(['data' => $rows->map(fn ($r) => (array) $r + ['counts' => $r->counts === null ? null : json_decode($r->counts, true)])->all(),
            'can' => ['run' => $this->catalog->allows($request->user(), 'forecast.run'), 'review' => $this->catalog->allows($request->user(), 'forecast.review')]]);
    }

    public function show(Request $request, string $run): JsonResponse
    {
        $units = $this->scope($request->user());
        $f = DB::table('forecast_runs as f')->join('users as u', 'u.id', '=', 'f.started_by')->leftJoin('users as rv', 'rv.id', '=', 'f.reviewed_by')->where('f.id', $run)->whereIn('f.kind', ForecastService::KINDS)
            ->first(['f.*', 'u.name as started_by_name', 'rv.name as reviewed_by_name']) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $summary = $f->kind !== ForecastService::KIND ? collect() : DB::table('forecast_gardu_results as r')->join('organizational_units as o', 'o.id', '=', 'r.unit_id')->where('r.run_id', $run)->when($units !== null, fn ($q) => $q->whereIn('r.unit_id', $units))
            ->groupBy('o.id', 'o.code', 'o.name')->orderBy('o.code')
            ->selectRaw('o.id as unit_id, o.code as unit_code, o.name as unit_name, count(*) as total, '
                .'sum(case when '.self::RISK_SQL." = 'KRITIS' then 1 else 0 end) as kritis, sum(case when ".self::RISK_SQL." = 'TINGGI' then 1 else 0 end) as tinggi, "
                .'sum(case when '.self::RISK_SQL." = 'WASPADA' then 1 else 0 end) as waspada, sum(case when r.stale then 1 else 0 end) as stale")->get();
        $json = fn ($v) => $v === null ? null : json_decode($v, true);

        return response()->json(['data' => ['id' => $f->id, 'kind' => $f->kind, 'status' => $f->status, 'started_at' => $f->started_at, 'finished_at' => $f->finished_at, 'started_by_name' => $f->started_by_name, 'data_cutoff' => $f->data_cutoff,
            'model' => $json($f->model), 'data_window' => $json($f->data_window), 'counts' => $json($f->counts), 'metrics' => $json($f->metrics), 'assumptions' => $f->assumptions, 'error' => $f->error,
            'review_status' => $f->review_status, 'reviewed_by_name' => $f->reviewed_by_name, 'reviewed_at' => $f->reviewed_at, 'review_note' => $f->review_note,
            'summary' => $summary->map(fn ($s) => ['unit_id' => $s->unit_id, 'unit_code' => $s->unit_code, 'unit_name' => $s->unit_name, 'total' => (int) $s->total, 'kritis' => (int) $s->kritis, 'tinggi' => (int) $s->tinggi,
                'waspada' => (int) $s->waspada, 'stale' => (int) $s->stale])->all()]]);
    }

    /** GET /forecast/runs/{run}/substations?risk=KRITIS|TINGGI|WASPADA|AMAN&unit_id=&search=&stale=1&page=&per_page= */
    public function substations(Request $request, string $run): JsonResponse
    {
        $units = $this->scope($request->user());
        $d = $request->validate(['risk' => ['nullable', 'in:KRITIS,TINGGI,WASPADA,AMAN'], 'unit_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'stale' => ['nullable', 'boolean'], 'per_page' => ['nullable', 'integer', 'between:1,100']]);
        if (! DB::table('forecast_runs')->where('id', $run)->where('kind', ForecastService::KIND)->exists()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $risk = self::RISK_SQL;
        $q = DB::table('forecast_gardu_results as r')->join('substations as s', 's.id', '=', 'r.substation_id')->join('organizational_units as o', 'o.id', '=', 'r.unit_id')->where('r.run_id', $run)
            ->when($units !== null, fn ($q) => $q->whereIn('r.unit_id', $units))
            ->when($d['unit_id'] ?? null, fn ($q, $u) => $q->where('r.unit_id', $u))
            ->when($d['risk'] ?? null, fn ($q, $k) => $q->whereRaw("({$risk}) = ?", [$k]))
            ->when($request->boolean('stale'), fn ($q) => $q->where('r.stale', true))
            ->when($d['search'] ?? null, fn ($q, $t) => $q->where(fn ($w) => $w->where('s.code', 'ilike', '%'.str_replace(['%', '_'], ['\%', '\_'], $t).'%')->orWhere('s.name', 'ilike', '%'.str_replace(['%', '_'], ['\%', '\_'], $t).'%')->orWhere('s.feeder_code', 'ilike', '%'.str_replace(['%', '_'], ['\%', '\_'], $t).'%')));
        $page = $q->orderByRaw("case ({$risk}) when 'KRITIS' then 0 when 'TINGGI' then 1 when 'WASPADA' then 2 else 3 end")->orderByDesc('r.h3_p50')
            ->paginate((int) ($d['per_page'] ?? 25), ['r.*', 's.code', 's.name', 's.feeder_code', 'o.code as unit_code', 'o.name as unit_name', DB::raw("({$risk}) as risk")]);

        return response()->json(['data' => $page->getCollection()->map(fn ($r) => [
            'substation_id' => $r->substation_id, 'code' => $r->code, 'name' => $r->name, 'feeder_code' => $r->feeder_code, 'unit_code' => $r->unit_code, 'unit_name' => $r->unit_name, 'capacity_kva' => (float) $r->capacity_kva,
            'last_reading_on' => $r->last_reading_on, 'last_ratio' => (float) $r->last_ratio, 'history_readings' => (int) $r->history_readings, 'stale' => (bool) $r->stale, 'risk' => $r->risk,
            'horizons' => collect([1, 3, 5])->mapWithKeys(fn ($y) => [(string) $y => ['p10' => (float) $r->{"h{$y}_p10"}, 'p50' => (float) $r->{"h{$y}_p50"}, 'p90' => (float) $r->{"h{$y}_p90"}]])->all(),
            'exceed_80' => ['state' => $r->exceed80_state, 'date' => $r->exceed80_on], 'exceed_100' => ['state' => $r->exceed100_state, 'date' => $r->exceed100_on]])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    /** GET /forecast/runs/{run}/series?kind=CUSTOMERS_ADDED|VA_ADDED|MATERIAL_ISSUE&unit_id=&search=&page=&per_page= — the monthly forecasts of a DEMAND run, within the reader's units. */
    public function series(Request $request, string $run): JsonResponse
    {
        $units = $this->scope($request->user());
        $d = $request->validate(['kind' => ['nullable', 'in:CUSTOMERS_ADDED,VA_ADDED,MATERIAL_ISSUE'], 'unit_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:100'], 'per_page' => ['nullable', 'integer', 'between:1,100']]);
        if (! DB::table('forecast_runs')->where('id', $run)->where('kind', ForecastService::DEMAND)->exists()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $term = isset($d['search']) ? '%'.str_replace(['%', '_'], ['\%', '\_'], $d['search']).'%' : null;
        $page = DB::table('forecast_series_results as r')->join('organizational_units as o', 'o.id', '=', 'r.unit_id')->where('r.run_id', $run)
            ->when($units !== null, fn ($q) => $q->whereIn('r.unit_id', $units))->when($d['unit_id'] ?? null, fn ($q, $u) => $q->where('r.unit_id', $u))->when($d['kind'] ?? null, fn ($q, $k) => $q->where('r.kind', $k))
            ->when($term, fn ($q) => $q->where(fn ($w) => $w->where('r.item_code', 'ilike', $term)->orWhere('r.item_label', 'ilike', $term)))
            ->orderBy('r.kind')->orderBy('o.code')->orderByDesc('r.t12_p50')->paginate((int) ($d['per_page'] ?? 25), ['r.*', 'o.code as unit_code', 'o.name as unit_name']);

        return response()->json(['data' => $page->getCollection()->map(fn ($r) => ['series_id' => $r->series_id, 'kind' => $r->kind, 'unit_code' => $r->unit_code, 'unit_name' => $r->unit_name, 'item_code' => $r->item_code, 'item_label' => $r->item_label,
            'history_months' => (int) $r->history_months, 'last_12_months' => (float) $r->last_12_months, 'months' => json_decode($r->months, true),
            'totals' => collect([3, 6, 12])->mapWithKeys(fn ($n) => [(string) $n => ['p10' => (float) $r->{"t{$n}_p10"}, 'p50' => (float) $r->{"t{$n}_p50"}, 'p90' => (float) $r->{"t{$n}_p90"}]])->all()])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    public function start(Request $request): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'forecast.run');
        $kind = $request->validate(['kind' => ['nullable', 'in:'.implode(',', ForecastService::KINDS)]])['kind'] ?? ForecastService::KIND;
        $id = $this->forecast->start($request->user(), $kind);

        return response()->json(['data' => ['id' => $id, 'status' => 'RUNNING'], 'message' => 'Forecast dimulai. Pelatihan model memerlukan beberapa menit.'], 202);
    }

    public function review(Request $request, string $run): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'forecast.review');
        $d = Validator::make($request->all(), ['note' => ['nullable', 'string', 'max:1000']])->validate();
        $this->forecast->review($run, $d['note'] ?? '', $request->user());

        return response()->json(['message' => 'Forecast ditandai sudah ditelaah.']);
    }

    /** @return list<string>|null the units the user may read (null = all) */
    private function scope(User $user): ?array
    {
        $scope = $this->authorizer->authorizeScope($user, 'forecast.view');

        return $scope['unrestricted'] ? null : $scope['units'];
    }
}
