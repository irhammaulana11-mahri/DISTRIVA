<?php

namespace App\Http\Controllers\MasterData;

use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\ConstructionTypeService;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Construction types, versions and KHS mappings. Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class ConstructionTypeController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly ConstructionTypeService $types, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate([
            'group' => ['nullable', Rule::in((array) config('distriva.construction_groups'))],
            'search' => ['nullable', 'string', 'max:100'], 'has_draft' => ['nullable', 'boolean'],
        ]);

        $query = DB::table('construction_types as t')->select('t.id', 't.group_code', 't.code', 't.external_code', 't.is_active');
        $groups = (array) config('distriva.construction_groups');
        $query->orderByRaw('array_position(?::text[], t.group_code), t.code', ['{'.implode(',', $groups).'}']);
        if ($request->filled('group')) {
            $query->where('t.group_code', $request->query('group'));
        }
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $query->where(fn ($q) => $q->where('t.code', 'ilike', $term)
                ->orWhereExists(fn ($s) => $s->from('construction_type_versions as sv')->whereColumn('sv.construction_type_id', 't.id')->where('sv.name', 'ilike', $term)));
        }
        if ($request->boolean('has_draft')) {
            $query->whereExists(fn ($s) => $s->from('construction_type_versions as dv')->whereColumn('dv.construction_type_id', 't.id')->where('dv.status', 'DRAFT'));
        }
        $page = $query->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        $ids = collect($page->items())->pluck('id')->all();
        $versions = DB::table('construction_type_versions')->whereIn('construction_type_id', $ids)->orderByDesc('version_number')->get()->groupBy('construction_type_id');
        $counts = DB::table('construction_khs_mappings')->whereIn('construction_type_version_id', $versions->flatten()->pluck('id'))->selectRaw('construction_type_version_id as vid, count(*) as n')->groupBy('construction_type_version_id')->pluck('n', 'vid');
        $today = now(config('distriva.business_timezone'))->toDateString();

        return response()->json([
            'data' => collect($page->items())->map(function ($t) use ($versions, $counts, $today) {
                $all = $versions->get($t->id, collect());
                $current = $all->first(fn ($v) => $v->status === 'APPROVED' && $v->valid_from <= $today && ($v->valid_until === null || $v->valid_until >= $today));
                $draft = $all->first(fn ($v) => $v->status === 'DRAFT');

                return ['id' => $t->id, 'group' => $t->group_code, 'code' => $t->code, 'external_code' => $t->external_code, 'is_active' => (bool) $t->is_active,
                    'name' => ($current ?? $draft ?? $all->first())?->name,
                    'current' => $current ? $this->version($current, $counts) : null,
                    'draft' => $draft ? $this->version($draft, $counts) : null, 'versions_count' => $all->count()];
            })->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $t = DB::table('construction_types')->where('id', $id)->first() ?? abort(404, 'Data tidak ditemukan.');
        $versions = DB::table('construction_type_versions')->where('construction_type_id', $id)->orderByDesc('version_number')->get();
        $counts = DB::table('construction_khs_mappings')->whereIn('construction_type_version_id', $versions->pluck('id'))->selectRaw('construction_type_version_id as vid, count(*) as n')->groupBy('construction_type_version_id')->pluck('n', 'vid');
        $events = DB::table('construction_version_events')->whereIn('construction_type_version_id', $versions->pluck('id'))->orderBy('occurred_at')->get()->groupBy('construction_type_version_id');

        return response()->json(['data' => ['id' => $t->id, 'group' => $t->group_code, 'code' => $t->code, 'external_code' => $t->external_code, 'is_active' => (bool) $t->is_active,
            'versions' => $versions->map(fn ($v) => $this->version($v, $counts) + ['events' => $events->get($v->id, collect())->map(fn ($e) => [
                'event_type' => $e->event_type, 'actor_user_id' => $e->actor_user_id, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at])->all()])->all()]]);
    }

    public function mappings(Request $request, string $version): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $v = DB::table('construction_type_versions')->where('id', $version)->first() ?? abort(404, 'Data tidak ditemukan.');
        $page = DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')
            ->where('m.construction_type_version_id', $v->id)->orderBy('m.sequence')
            ->paginate(max(1, min((int) $request->query('per_page', 100), 500)), ['m.sequence', 'm.relation', 'm.note', 'm.source_reference', 'i.id as khs_item_id', 'i.code as khs_code']);

        // name/unit of the KHS version valid on the construction version's start date (what a calculation would use)
        $khs = DB::table('khs_item_versions')->whereIn('khs_item_id', collect($page->items())->pluck('khs_item_id'))->where('status', 'APPROVED')
            ->where('valid_from', '<=', $v->valid_from)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $v->valid_from))->get()->keyBy('khs_item_id');

        return response()->json([
            'data' => collect($page->items())->map(fn ($m) => ['sequence' => $m->sequence, 'khs_code' => $m->khs_code, 'relation' => $m->relation, 'note' => $m->note,
                'source_reference' => $m->source_reference, 'khs_name' => $khs[$m->khs_item_id]->name ?? null, 'khs_unit' => $khs[$m->khs_item_id]->unit_text ?? null,
                'khs_approved' => isset($khs[$m->khs_item_id])])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.manage'); // grant first, then validate
        $data = Validator::make($request->all(), $this->fileRules() + ['valid_from' => ['required', 'date_format:Y-m-d'], 'source_reference' => ['nullable', 'string', 'max:255']])->validate();
        $result = $this->types->importTypes($request->file('file'), $data['valid_from'], $data['source_reference'] ?? null, $request->boolean('dry_run'), $actor);

        if (! $result['summary']['dry_run']) {
            $this->notifier->approvalRequested('construction_types.approve', 'construction_type_versions', 'standar konstruksi', $actor, 'Konstruksi', '/master-data/constructions');
        }

        return response()->json(['data' => $result['summary'], 'rows' => $result['rows']], $result['summary']['dry_run'] ? 200 : 201);
    }

    public function importMappings(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.manage');
        Validator::make($request->all(), $this->fileRules())->validate();
        $result = $this->types->importMappings($request->file('file'), $request->boolean('dry_run'), $actor);

        return response()->json(['data' => $result['summary'], 'rows' => $result['rows']], $result['summary']['dry_run'] ? 200 : 201);
    }

    public function updateDraft(Request $request, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.manage');
        $data = Validator::make($request->all(), [
            'name' => ['sometimes', 'required', 'string', 'max:150'], 'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'reference_symbol' => ['sometimes', 'nullable', 'string', 'max:100'], 'valid_from' => ['sometimes', 'required', 'date_format:Y-m-d'], 'reason' => ['required', 'string', 'max:1000'],
        ])->validate();
        $reason = $data['reason'];
        unset($data['reason']);
        $this->types->updateDraft($version, $data, $reason, $actor);

        return response()->json(['data' => $this->version(DB::table('construction_type_versions')->where('id', $version)->first(), collect())]);
    }

    public function removeMapping(Request $request, string $version, string $khsCode): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.manage');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->types->removeMapping($version, $khsCode, $data['reason'], $actor);

        return response()->json(['message' => 'Pemetaan dihapus dari draf.']);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.approve');
        $data = Validator::make($request->all(), [
            'version_ids' => ['required', 'array', 'min:1', 'max:500'], 'version_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000'],
        ])->validate();

        $out = $this->types->approve($data['version_ids'], $actor, $data['reason']);
        $this->notifier->approved('construction_type_versions', $data['version_ids'], 'standar konstruksi', $actor, $data['reason'], 'Konstruksi', '/master-data/constructions');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'construction_types.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->types->retire($version, $data['reason'], $actor);

        return response()->json(['data' => $this->version(DB::table('construction_type_versions')->where('id', $version)->first(), collect())]);
    }

    /** @return array<string, mixed> */
    private function fileRules(): array
    {
        return [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'dry_run' => ['sometimes', 'boolean'],
        ];
    }

    /** @return array<string, mixed> */
    private function version(object $v, $counts): array
    {
        return ['id' => $v->id, 'construction_type_id' => $v->construction_type_id, 'version_number' => $v->version_number, 'name' => $v->name, 'description' => $v->description,
            'reference_symbol' => $v->reference_symbol, 'valid_from' => $v->valid_from, 'valid_until' => $v->valid_until, 'status' => $v->status, 'source_reference' => $v->source_reference,
            'created_by' => $v->created_by, 'approved_by' => $v->approved_by, 'approved_at' => $v->approved_at, 'mappings_count' => (int) ($counts[$v->id] ?? 0)];
    }
}
