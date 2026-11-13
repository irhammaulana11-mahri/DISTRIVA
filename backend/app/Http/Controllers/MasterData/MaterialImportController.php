<?php

namespace App\Http\Controllers\MasterData;

use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\MaterialImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** ERP material import: stage -> preview -> confirm | cancel. Rule violations are rendered as 409 (bootstrap/app.php). */
class MaterialImportController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly MaterialImportService $imports) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'materials.import');
        $page = DB::table('material_sync_logs')->orderByDesc('staged_at')->paginate(max(1, min((int) $request->query('per_page', 15), 100)));

        return response()->json([
            'data' => collect($page->items())->map(fn ($b) => $this->imports->summary($b->id))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function stage(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'materials.import'); // grant first, then validate
        Validator::make($request->all(), [
            'file' => ['required', 'file', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel', 'extensions:csv,txt', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
        ])->validate();

        return response()->json(['data' => $this->imports->stage($request->file('file'), $actor)], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'materials.import');
        $request->validate(['action' => ['nullable', Rule::in(['INSERT', 'UPDATE', 'UNCHANGED', 'REJECT'])]]);
        $summary = $this->imports->summary($id) ?? abort(404, 'Data tidak ditemukan.');

        $rows = DB::table('material_sync_staging')->where('batch_id', $id)->when($request->filled('action'), fn ($q) => $q->where('action', $request->query('action')))
            ->orderBy('row_number')->paginate(max(1, min((int) $request->query('per_page', 50), 200)));

        return response()->json([
            'data' => $summary,
            'rows' => collect($rows->items())->map(fn ($r) => [
                'row' => $r->row_number, 'code' => $r->external_code, 'name' => $r->name, 'unit' => $r->unit, 'spec' => $r->spec,
                'category_code' => $r->category_code, 'action' => $r->action, 'unit_change' => (bool) $r->unit_change,
                'messages' => json_decode((string) $r->messages, true) ?? [],
            ])->all(),
            'meta' => ['current_page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total(), 'last_page' => $rows->lastPage()],
        ]);
    }

    public function confirm(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'materials.import');
        $data = Validator::make($request->all(), ['approve_unit_changes' => ['sometimes', 'boolean']])->validate();
        $this->imports->summary($id) ?? abort(404, 'Data tidak ditemukan.');

        return response()->json(['data' => $this->imports->confirm($id, (bool) ($data['approve_unit_changes'] ?? false), $request->user())]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'materials.import');
        $this->imports->summary($id) ?? abort(404, 'Data tidak ditemukan.');

        return response()->json(['data' => $this->imports->cancel($id, $request->user())]);
    }
}
