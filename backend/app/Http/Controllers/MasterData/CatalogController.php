<?php

namespace App\Http\Controllers\MasterData;

use App\Http\Controllers\Controller;
use App\Models\MaterialCategory;
use App\Models\UnitOfMeasure;
use App\Services\Authorization\CatalogAuthorizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Categories and units of measure (docs/23 §2.1, §2.3). Central reference data; grants are checked before validation. */
class CatalogController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer) {}

    public function access(Request $request): JsonResponse
    {
        return response()->json(['can' => $this->authorizer->capabilities($request->user())]);
    }

    public function categories(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');

        $all = MaterialCategory::query()->orderBy('code')->get();
        $children = $all->whereNotNull('parent_id')->countBy('parent_id');
        $byId = $all->keyBy(fn ($c) => $c->getKey());
        $used = DB::table('materials')->whereNotNull('category_id')->selectRaw('category_id, count(*) n')->groupBy('category_id')->pluck('n', 'category_id');

        return response()->json(['data' => $all->map(fn ($c) => $this->category($c) + [
            'parent_code' => $c->parent_id === null ? null : $byId[$c->parent_id]?->code,
            'level' => $c->parent_id === null ? 1 : 2,
            'children_count' => (int) ($children[$c->getKey()] ?? 0),
            'materials_count' => (int) ($used[$c->getKey()] ?? 0) + (int) $all->where('parent_id', $c->getKey())->sum(fn ($k) => (int) ($used[$k->getKey()] ?? 0)),
        ])->values()->all()]);
    }

    public function createCategory(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'material_categories.manage');
        $data = Validator::make($request->all(), [
            'code' => ['required', 'string', 'max:30', 'regex:/^[A-Z0-9_]+$/', 'unique:material_categories,code'],
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:1000'],
            'parent_id' => ['nullable', 'uuid', 'exists:material_categories,id'],
        ], ['code.regex' => 'Kode kategori hanya huruf besar, angka, dan garis bawah.'])->validate();
        if (! empty($data['parent_id'])) {
            $parent = MaterialCategory::query()->find($data['parent_id']);
            if ($parent->parent_id !== null) {
                return response()->json(['message' => 'Kategori material hanya dua tingkat: induknya harus kategori, bukan subkategori.', 'errors' => ['parent_id' => ['Induk harus kategori tingkat pertama.']]], 422);
            }
            if (DB::table('materials')->where('category_id', $parent->getKey())->exists()) {
                return response()->json(['message' => 'Kategori induk sudah dipakai langsung oleh material; pindahkan materialnya ke subkategori dulu.', 'errors' => ['parent_id' => ['Induk dipakai langsung oleh material.']]], 422);
            }
        }

        return response()->json(['data' => $this->category(MaterialCategory::query()->create($data + ['is_active' => true]))], 201);
    }

    public function updateCategory(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'material_categories.manage');
        $data = Validator::make($request->all(), [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ])->validate();
        $category = MaterialCategory::query()->find($id) ?? abort(404, 'Data tidak ditemukan.');
        $category->update($data);

        return response()->json(['data' => $this->category($category->refresh())]);
    }

    public function units(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');

        return response()->json(['data' => UnitOfMeasure::query()->orderBy('code')->get()->map(fn ($u) => $this->unit($u))->all()]);
    }

    public function createUnit(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'units_of_measure.manage');
        $data = Validator::make($request->all(), [
            'code' => ['required', 'string', 'max:30', 'regex:/^[A-Za-z0-9_.\-\/]+$/', 'unique:units_of_measure,code'],
            'name' => ['required', 'string', 'max:100'],
            'symbol' => ['required', 'string', 'max:20'],
        ])->validate();

        return response()->json(['data' => $this->unit(UnitOfMeasure::query()->create($data + ['is_active' => true]))], 201);
    }

    public function updateUnit(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'units_of_measure.manage');
        $data = Validator::make($request->all(), [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'symbol' => ['sometimes', 'required', 'string', 'max:20'],
            'is_active' => ['sometimes', 'required', 'boolean', Rule::in([true, false])],
        ])->validate();
        $unit = UnitOfMeasure::query()->find($id) ?? abort(404, 'Data tidak ditemukan.');
        $unit->update($data);

        return response()->json(['data' => $this->unit($unit->refresh())]);
    }

    /** @return array<string, mixed> */
    private function category(MaterialCategory $c): array
    {
        return ['id' => $c->getKey(), 'parent_id' => $c->parent_id, 'code' => $c->code, 'name' => $c->name, 'description' => $c->description, 'is_active' => (bool) $c->is_active];
    }

    /** @return array<string, mixed> */
    private function unit(UnitOfMeasure $u): array
    {
        return ['id' => $u->getKey(), 'code' => $u->code, 'name' => $u->name, 'symbol' => $u->symbol, 'is_active' => (bool) $u->is_active];
    }
}
