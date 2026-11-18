<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Master\MasterExcelImportService;
use App\Services\Master\MasterWorkbookExporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Excel master from the screen (docs/85): upload -> check (extract + compare) -> apply the differences as DRAFT. Grant (403/404) -> validation (422) -> rule (409). */
class MasterExcelImportController extends Controller
{
    private const NEED = ['RAB_KKF' => ['bom.manage', 'prices.manage'], 'TARIF' => ['tariffs.manage'], 'DISTRIVA' => ['bom.manage', 'prices.manage', 'tariffs.manage', 'kkf_params.manage']];

    private const DATASET_PERMISSION = ['BOM' => 'bom.manage', 'PRICE' => 'prices.manage', 'TARIFF' => 'tariffs.manage', 'KKF' => 'kkf_params.manage'];

    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly MasterExcelImportService $imports, private readonly MasterWorkbookExporter $exporter) {}

    /** GET /master-data/excel-imports */
    public function index(Request $request): JsonResponse
    {
        $this->requireAny($request);

        return response()->json(['data' => $this->imports->list(), 'tariff_coverage' => $this->imports->tariffCoverage(), 'limits' => ['max_mb' => (int) config('distriva.master_excel.max_mb'), 'accept' => ['.xlsx']],
            'can' => ['rab' => $this->hasAny($request, self::NEED['RAB_KKF']), 'tariff' => $this->hasAny($request, self::NEED['TARIF']), 'bom' => $this->authorizer->allows($request->user(), 'bom.manage'),
                'price' => $this->authorizer->allows($request->user(), 'prices.manage'), 'tariffs' => $this->authorizer->allows($request->user(), 'tariffs.manage'), 'kkf' => $this->authorizer->allows($request->user(), 'kkf_params.manage')]]);
    }

    /** POST /master-data/excel-imports (multipart: file, kind, ulp_code) — stores the workbook and starts the check */
    public function store(Request $request): JsonResponse
    {
        $kind = (string) $request->input('kind');
        $this->requireAny($request, self::NEED[$kind] ?? []);
        $d = Validator::make($request->all(), [
            'file' => ['required', 'file', 'extensions:xlsx', 'max:'.((int) config('distriva.master_excel.max_mb') * 1024)],
            'kind' => ['required', Rule::in(MasterExcelImportService::KINDS)],
            'ulp_code' => ['nullable', 'string', 'max:10'],
        ])->validate();
        $import = $this->imports->store($request->file('file'), $d['kind'], $d['ulp_code'] ?? null, $request->user());
        $this->imports->start($import['id']);

        return response()->json(['data' => $this->imports->show($import['id'])], 202);
    }

    /** GET /master-data/excel-imports/template — MASTER DISTRIVA.xlsx built from the approved data, for the parent unit to edit (docs/85) */
    public function template(Request $request): BinaryFileResponse
    {
        $this->requireAny($request, self::NEED['DISTRIVA']);
        $path = storage_path('app/master-excel/template-'.Str::uuid().'.xlsx');
        $built = $this->exporter->build($path);
        if ($built['groups'] === []) {
            @unlink($path);
            throw new AssignmentRuleViolation('Belum ada versi BOM yang disetujui beserta peta sel gambarnya: '.implode('; ', $built['skipped']).'.');
        }

        return response()->download($path, 'MASTER-DISTRIVA-'.now()->format('Ymd').'.xlsx', ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /** GET /master-data/excel-imports/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $this->requireAny($request);

        return response()->json(['data' => $this->imports->show($id)]);
    }

    /** POST /master-data/excel-imports/{id}/recheck — read the stored workbook again (after the data changed) */
    public function recheck(Request $request, string $id): JsonResponse
    {
        $this->requireAny($request, self::NEED[$this->imports->show($id)['kind']] ?? []);
        $this->imports->start($id);

        return response()->json(['data' => $this->imports->show($id)], 202);
    }

    /** POST /master-data/excel-imports/{id}/apply {dataset: BOM|PRICE|TARIFF, valid_from, name?, groups?} — DRAFT versions only */
    public function apply(Request $request, string $id): JsonResponse
    {
        $dataset = (string) $request->input('dataset');
        $this->authorizer->authorize($request->user(), self::DATASET_PERMISSION[$dataset] ?? 'master_data.manage_nothing');   // grant first, then validate
        $d = Validator::make($request->all(), [
            'dataset' => ['required', Rule::in(array_keys(self::DATASET_PERMISSION))],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'name' => [Rule::requiredIf(in_array($dataset, ['PRICE', 'TARIFF', 'KKF'], true)), 'nullable', 'string', 'max:150'],
            'groups' => ['sometimes', 'array', 'max:20'], 'groups.*' => ['string', 'max:30'],
        ])->validate();
        $result = $this->imports->apply($id, $d['dataset'], $d, $request->user());

        return response()->json(['data' => $result, 'import' => $this->imports->show($id)], 201);
    }

    /** DELETE /master-data/excel-imports/{id} — removes the stored workbook and the work files */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->requireAny($request);
        $this->imports->discard($id);

        return response()->json(['message' => 'Berkas dihapus.']);
    }

    /** @param list<string>|null $permissions */
    private function requireAny(Request $request, ?array $permissions = null): void
    {
        if (! $this->hasAny($request, $permissions ?? array_values(array_unique(array_merge(...array_values(self::NEED)))))) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
    }

    /** @param list<string> $permissions */
    private function hasAny(Request $request, array $permissions): bool
    {
        foreach ($permissions as $p) {
            if ($this->authorizer->allows($request->user(), $p)) {
                return true;
            }
        }

        return false;
    }
}
