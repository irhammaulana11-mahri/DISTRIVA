<?php

namespace App\Http\Controllers\MasterData;

use App\Http\Controllers\Controller;
use App\Models\Material;
use App\Models\MaterialCategory;
use App\Services\Authorization\CatalogAuthorizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Material master (docs/23 §2.2). Read: any master_data.view role. DISTRIVA never creates material codes and ERP owns
 * code/name/unit/spec: the only manual changes are the internal category mapping and the active flag.
 */
class MaterialController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate([
            'search' => ['nullable', 'string', 'max:100'], 'category_id' => ['nullable', 'uuid'],
            'unmapped' => ['nullable', 'boolean'], 'is_active' => ['nullable', 'boolean'],
        ]);

        $query = Material::query()->with('category:id,code,name')->orderBy('code');
        if ($request->filled('search')) {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $request->query('search')).'%';
            $query->where(fn ($q) => $q->where('code', 'ilike', $term)->orWhere('name', 'ilike', $term));
        }
        if ($request->filled('category_id')) {
            $cid = (string) $request->query('category_id');
            $query->whereIn('category_id', MaterialCategory::query()->where('id', $cid)->orWhere('parent_id', $cid)->select('id'));   // a parent category includes its subcategories
        }
        if ($request->boolean('unmapped')) {
            $query->whereNull('category_id');
        }
        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $query->where('is_active', $request->boolean('is_active'));
        }

        $page = $query->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        return response()->json([
            'data' => collect($page->items())->map(fn (Material $m) => $this->view($m))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $material = Material::query()->with('category:id,code,name')->find($id) ?? abort(404, 'Data tidak ditemukan.');

        $logs = DB::table('material_change_logs')->where('material_id', $material->getKey())->orderByDesc('changed_at')->limit(50)->get();

        return response()->json(['data' => $this->view($material) + ['change_logs' => $logs->map(fn ($l) => [
            'id' => $l->id, 'change_type' => $l->change_type, 'before' => json_decode((string) $l->before_values, true),
            'after' => json_decode((string) $l->after_values, true), 'batch_id' => $l->batch_id, 'reason' => $l->reason, 'changed_at' => $l->changed_at,
        ])->all()]]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'materials.update');
        $data = Validator::make($request->all(), [
            'category_id' => ['sometimes', 'nullable', 'uuid', 'exists:material_categories,id'],
            'is_active' => ['sometimes', 'required', 'boolean'],
            'reason' => ['required', 'string', 'max:1000'],
        ])->validate();
        $material = Material::query()->find($id) ?? abort(404, 'Data tidak ditemukan.');

        if (! array_key_exists('category_id', $data) && ! array_key_exists('is_active', $data)) {
            return response()->json(['message' => 'Tidak ada perubahan yang dikirimkan.', 'errors' => ['category_id' => ['Kirim category_id dan/atau is_active.']]], 422);
        }
        if (isset($data['category_id']) && ! MaterialCategory::query()->whereKey($data['category_id'])->where('is_active', true)->exists()) {
            return response()->json(['message' => 'Kategori tidak aktif.', 'errors' => ['category_id' => ['Kategori tidak aktif.']]], 422);
        }

        if (isset($data['category_id']) && MaterialCategory::query()->where('parent_id', $data['category_id'])->exists()) {
            return response()->json(['message' => 'Pilih subkategori, bukan kategori induk.', 'errors' => ['category_id' => ['Material harus memakai subkategori.']]], 422);
        }

        DB::transaction(function () use ($material, $data, $actor): void {
            $locked = Material::query()->whereKey($material->getKey())->lockForUpdate()->firstOrFail();

            if (array_key_exists('category_id', $data) && $data['category_id'] !== $locked->category_id) {
                $before = ['category_id' => $locked->category_id];
                $locked->category_id = $data['category_id'];
                $locked->save();
                $this->log($locked->getKey(), 'CATEGORY_MAPPED', $before, ['category_id' => $locked->category_id], $actor->getKey(), $data['reason']);
            }
            if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== (bool) $locked->is_active) {
                $before = ['is_active' => (bool) $locked->is_active];
                $locked->is_active = (bool) $data['is_active'];
                $locked->save();
                $this->log($locked->getKey(), $locked->is_active ? 'ACTIVATED' : 'DEACTIVATED', $before, ['is_active' => (bool) $locked->is_active], $actor->getKey(), $data['reason']);
            }
        });

        return response()->json(['data' => $this->view($material->refresh()->load('category:id,code,name'))]);
    }

    /** @return array<string, mixed> */
    private function view(Material $m): array
    {
        return [
            'id' => $m->getKey(), 'code' => $m->code, 'name' => $m->name, 'unit' => $m->unit, 'spec' => $m->spec,
            'category' => $m->category === null ? null : ['id' => $m->category->getKey(), 'code' => $m->category->code, 'name' => $m->category->name],
            'is_active' => (bool) $m->is_active, 'source_system' => $m->source_system, 'external_updated_at' => $m->external_updated_at?->toISOString(),
        ];
    }

    private function log(string $materialId, string $type, array $before, array $after, string $actorId, string $reason): void
    {
        DB::table('material_change_logs')->insert([
            'id' => (string) Str::uuid(), 'material_id' => $materialId, 'change_type' => $type, 'before_values' => json_encode($before),
            'after_values' => json_encode($after), 'batch_id' => null, 'actor_user_id' => $actorId, 'reason' => trim($reason), 'changed_at' => now(),
        ]);
    }
}
