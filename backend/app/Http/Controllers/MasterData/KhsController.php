<?php

namespace App\Http\Controllers\MasterData;

use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\KhsCatalogService;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** KHS catalogue endpoints. Rule violations become 409, authorization failures 403/404 (bootstrap/app.php). */
class KhsController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly KhsCatalogService $khs, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['search' => ['nullable', 'string', 'max:100'], 'has_draft' => ['nullable', 'boolean']]);

        $query = DB::table('khs_items as i')->select('i.id', 'i.code', 'i.is_active')->orderByRaw('length(i.code), i.code');
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $query->where(fn ($q) => $q->where('i.code', 'ilike', $term)
                ->orWhereExists(fn ($s) => $s->from('khs_item_versions as sv')->whereColumn('sv.khs_item_id', 'i.id')->where('sv.name', 'ilike', $term)));
        }
        if ($request->boolean('has_draft')) {
            $query->whereExists(fn ($s) => $s->from('khs_item_versions as dv')->whereColumn('dv.khs_item_id', 'i.id')->where('dv.status', 'DRAFT'));
        }
        $page = $query->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        $ids = collect($page->items())->pluck('id')->all();
        $versions = DB::table('khs_item_versions')->whereIn('khs_item_id', $ids)->orderByDesc('version_number')->get()->groupBy('khs_item_id');
        $today = now(config('distriva.business_timezone'))->toDateString();

        return response()->json([
            'data' => collect($page->items())->map(function ($i) use ($versions, $today) {
                $all = $versions->get($i->id, collect());
                $current = $all->first(fn ($v) => $v->status === 'APPROVED' && $v->valid_from <= $today && ($v->valid_until === null || $v->valid_until >= $today));

                return ['id' => $i->id, 'code' => $i->code, 'is_active' => (bool) $i->is_active,
                    'current' => $current ? $this->version($current) : null,
                    'has_draft' => $all->contains(fn ($v) => $v->status === 'DRAFT'),
                    // The pending draft (at most one per item) so a client can approve without opening every item.
                    'draft' => ($d = $all->first(fn ($v) => $v->status === 'DRAFT')) ? ['id' => $d->id, 'version_number' => $d->version_number, 'name' => $d->name, 'unit_text' => $d->unit_text, 'valid_from' => $d->valid_from, 'created_by' => $d->created_by] : null,
                    'versions_count' => $all->count()];
            })->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $item = DB::table('khs_items')->where('id', $id)->first() ?? abort(404, 'Data tidak ditemukan.');
        $versions = DB::table('khs_item_versions')->where('khs_item_id', $id)->orderByDesc('version_number')->get();
        $events = DB::table('khs_version_events')->whereIn('khs_item_version_id', $versions->pluck('id'))->orderBy('occurred_at')->get()->groupBy('khs_item_version_id');

        return response()->json(['data' => ['id' => $item->id, 'code' => $item->code, 'is_active' => (bool) $item->is_active,
            'versions' => $versions->map(fn ($v) => $this->version($v) + ['events' => $events->get($v->id, collect())->map(fn ($e) => [
                'event_type' => $e->event_type, 'actor_user_id' => $e->actor_user_id, 'reason' => $e->reason,
                'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at])->all()])->all()]]);
    }

    public function import(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'khs.manage'); // grant first, then validate
        $data = Validator::make($request->all(), [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'source_reference' => ['nullable', 'string', 'max:255'],
            'dry_run' => ['sometimes', 'boolean'],
            'accept_unit_changes' => ['sometimes', 'boolean'],
        ])->validate();

        $result = $this->khs->import($request->file('file'), $data['valid_from'], $data['source_reference'] ?? null,
            $request->boolean('dry_run'), $request->boolean('accept_unit_changes'), $actor);

        if (! $result['summary']['dry_run']) {
            $this->notifier->approvalRequested('khs.approve', 'khs_item_versions', 'KHS', $actor, 'KHS', '/master-data/khs');
        }

        return response()->json(['data' => $result['summary'], 'rows' => $result['rows']], $result['summary']['dry_run'] ? 200 : 201);
    }

    public function updateDraft(Request $request, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'khs.manage');
        $data = Validator::make($request->all(), [
            'name' => ['sometimes', 'required', 'string', 'max:255'], 'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'unit_text' => ['sometimes', 'required', 'string', 'max:30'], 'category' => ['sometimes', 'nullable', 'string', 'max:50'],
            'valid_from' => ['sometimes', 'required', 'date_format:Y-m-d'], 'reason' => ['required', 'string', 'max:1000'],
        ])->validate();
        $reason = $data['reason'];
        unset($data['reason']);
        $this->khs->updateDraft($version, $data, $reason, $actor);

        return response()->json(['data' => $this->version(DB::table('khs_item_versions')->where('id', $version)->first())]);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'khs.approve');
        $data = Validator::make($request->all(), [
            'version_ids' => ['required', 'array', 'min:1', 'max:1000'], 'version_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000'],
        ])->validate();

        $out = $this->khs->approve($data['version_ids'], $actor, $data['reason']);
        $this->notifier->approved('khs_item_versions', $data['version_ids'], 'KHS', $actor, $data['reason'], 'KHS', '/master-data/khs');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'khs.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->khs->retire($version, $data['reason'], $actor);

        return response()->json(['data' => $this->version(DB::table('khs_item_versions')->where('id', $version)->first())]);
    }

    /** @return array<string, mixed> */
    private function version(object $v): array
    {
        return ['id' => $v->id, 'khs_item_id' => $v->khs_item_id, 'version_number' => $v->version_number, 'name' => $v->name, 'description' => $v->description,
            'unit_text' => $v->unit_text, 'category' => $v->category, 'valid_from' => $v->valid_from, 'valid_until' => $v->valid_until, 'status' => $v->status,
            'source_reference' => $v->source_reference, 'created_by' => $v->created_by, 'approved_by' => $v->approved_by, 'approved_at' => $v->approved_at];
    }
}
