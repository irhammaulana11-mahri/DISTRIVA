<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Substations\SubstationAnalysisService;
use App\Services\Substations\SubstationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/** Master gardu for KKO (docs/80). Grant (403/404) -> validation (422) -> rule (409). Scope: ULP of the actor, UP3 -> its ULPs, SYS_ADMIN everything (writes need MFA). */
class SubstationController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly SubstationService $substations) {}

    /** GET /master-data/substations */
    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'substations.view');
        $f = Validator::make($request->query(), ['q' => ['nullable', 'string', 'max:100'], 'organizational_unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid'], 'feeder_id' => ['nullable', 'uuid'], 'feeder_code' => ['nullable', 'string', 'max:40'],
            'type_code' => ['nullable', 'string', 'max:20'], 'usage' => ['nullable', 'in:UMUM,KHUSUS,CAMPURAN'], 'ownership' => ['nullable', 'in:PLN,PELANGGAN'], 'status' => ['nullable', 'in:AKTIF,NONAKTIF'],
            'needs_review' => ['nullable', 'boolean'], 'pickable' => ['nullable', 'boolean'], 'reading_status' => ['nullable', 'in:FRESH,STALE,NONE'], 'alert' => ['nullable', 'in:BASE_LOW,END_LOW,PHASE_UNBALANCED,END_DROP'], 'kecamatan' => ['nullable', 'string', 'max:100'], 'brand' => ['nullable', 'string', 'max:100'],
            'capacity_min' => ['nullable', 'numeric', 'min:0'], 'capacity_max' => ['nullable', 'numeric', 'min:0'], 'year_from' => ['nullable', 'integer', 'min:1900', 'max:2100'], 'year_to' => ['nullable', 'integer', 'min:1900', 'max:2100'],
            'loading_min' => ['nullable', 'numeric', 'min:0'], 'loading_max' => ['nullable', 'numeric', 'min:0'], 'has_coordinates' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'in:code,name,capacity,year,loading,measured_on'], 'dir' => ['nullable', 'in:asc,desc'], 'near' => ['nullable', 'string', 'max:40'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']])->validate();

        return response()->json($this->substations->search($f, $scope));
    }

    /** GET /master-data/substations/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'substations.view');

        return response()->json(['data' => $this->substations->show($id, $scope)]);
    }

    /** GET /master-data/substations/{id}/analysis — history, phase / jurusan balance, voltages and the load forecast (docs/80 §14). */
    public function analysis(Request $request, string $id): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'substations.view');
        $q = Validator::make($request->query(), ['horizon' => ['nullable', 'integer', 'min:1', 'max:36'], 'growth_kva' => ['nullable', 'numeric', 'min:-10000', 'max:10000']])->validate();

        return response()->json(['data' => app(SubstationAnalysisService::class)->analyze($id, $scope, (int) ($q['horizon'] ?? 12), isset($q['growth_kva']) ? (float) $q['growth_kva'] : null)]);
    }

    /** PATCH /master-data/substations/{id} */
    public function update(Request $request, string $id): JsonResponse
    {
        $scope = $this->write($request, 'substations.manage');
        $in = Validator::make($request->all(), ['name' => ['sometimes', 'nullable', 'string', 'max:200'], 'area_note' => ['sometimes', 'nullable', 'string', 'max:200'], 'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'], 'capacity_kva' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:1000000'], 'ownership' => ['sometimes', 'in:PLN,PELANGGAN'],
            'usage' => ['sometimes', 'nullable', 'in:UMUM,KHUSUS,CAMPURAN'], 'type_code' => ['sometimes', 'nullable', 'string', 'max:20'], 'feeder_code' => ['sometimes', 'nullable', 'string', 'max:40'],
            'status' => ['sometimes', 'in:AKTIF,NONAKTIF'], 'needs_review' => ['sometimes', 'boolean'], 'reason' => ['required', 'string', 'min:3', 'max:1000']])->validate();

        return response()->json(['data' => $this->substations->update($id, $in, $scope, $request->user())]);
    }

    /** POST /master-data/substations/{id}/readings — a reading entered by hand (survey or planning). */
    public function reading(Request $request, string $id): JsonResponse
    {
        $scope = $this->write($request, 'substations.reading');
        $in = $this->readingRules($request->all(), false);
        $r = $this->substations->addReading($id, $in, $request->input('source') === 'SURVEY' ? 'SURVEY' : 'MANUAL', $request->user(), $scope);

        return response()->json(['data' => $r], 201);
    }

    /** POST /master-data/substations/readings/bulk — the daily bot. */
    public function bulk(Request $request): JsonResponse
    {
        $scope = $this->write($request, 'substations.sync');
        $v = Validator::make($request->all(), ['items' => ['required', 'array', 'min:1', 'max:2000'], 'items.*.code' => ['required', 'string', 'max:40'], 'items.*.measured_on' => ['required_without:items.*.measured_at', 'nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'items.*.measured_at' => ['nullable', 'date'], 'items.*.capacity_kva' => ['nullable', 'numeric', 'gt:0', 'max:1000000'],
            'items.*.load_kva' => ['nullable', 'numeric', 'min:0'], 'items.*.loading_pct' => ['nullable', 'numeric', 'min:0', 'max:1000'], 'items.*.current_r_a' => ['nullable', 'numeric', 'min:0'], 'items.*.current_s_a' => ['nullable', 'numeric', 'min:0'],
            'items.*.current_t_a' => ['nullable', 'numeric', 'min:0'], 'items.*.current_n_a' => ['nullable', 'numeric', 'min:0'], 'items.*.current_max_a' => ['nullable', 'numeric', 'min:0'],
            'items.*.end_voltage_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'items.*.base_voltage_r_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'items.*.base_voltage_s_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'items.*.base_voltage_t_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'],
            'items.*.feeders' => ['nullable', 'array', 'max:12'], 'items.*.feeders.*.label' => ['required', 'string', 'max:40'], 'items.*.feeders.*.current_r_a' => ['nullable', 'numeric', 'min:0'], 'items.*.feeders.*.current_s_a' => ['nullable', 'numeric', 'min:0'],
            'items.*.feeders.*.current_t_a' => ['nullable', 'numeric', 'min:0'], 'items.*.feeders.*.current_n_a' => ['nullable', 'numeric', 'min:0'], 'items.*.feeders.*.end_voltage_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'items.*.kwh_total' => ['nullable', 'numeric', 'min:0']])->validate();

        return response()->json(['data' => $this->substations->bulkReadings($v['items'], $scope, $request->user())]);
    }

    /** POST /master-data/substations/imports — stage a master file. */
    public function stage(Request $request): JsonResponse
    {
        $scope = $this->write($request, 'substations.import');
        $in = Validator::make($request->all(), ['file' => ['required', 'file', 'extensions:csv,txt,xlsx,xls', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')], 'unit_id' => ['nullable', 'uuid'], 'full_snapshot' => ['nullable', 'boolean']])->validate();

        return response()->json(['data' => $this->substations->stage($request->file('file'), $scope, $request->user(), $in['unit_id'] ?? null, $request->boolean('full_snapshot'))], 201);
    }

    /** GET /master-data/substations/imports/{batch} */
    public function batch(Request $request, string $batch): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'substations.import');

        return response()->json($this->substations->batchRows($batch, $request->user(), $request->query('action') ?: null, (int) $request->query('per_page', 50)));
    }

    /** POST /master-data/substations/imports/{batch}/confirm */
    public function confirm(Request $request, string $batch): JsonResponse
    {
        $scope = $this->write($request, 'substations.import');

        return response()->json(['data' => $this->substations->confirm($batch, $scope, $request->user())]);
    }

    /** DELETE /master-data/substations/imports/{batch} */
    public function discard(Request $request, string $batch): JsonResponse
    {
        $this->write($request, 'substations.import');
        $this->substations->discard($batch, $request->user());

        return response()->json(['message' => 'Batch dibuang; data gardu tidak berubah.']);
    }

    /** @return array{unrestricted: bool, units: list<string>} */
    private function write(Request $request, string $permission): array
    {
        $scope = $this->authorizer->authorizeScope($request->user(), $permission);
        if ($scope['unrestricted'] && ! app(MfaService::class)->satisfied($request->user())) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }

        return $scope;
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function readingRules(array $data, bool $bulk): array
    {
        return Validator::make($data, ['measured_on' => ['required_without:measured_at', 'nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'measured_at' => ['nullable', 'date'], 'capacity_kva' => ['nullable', 'numeric', 'gt:0', 'max:1000000'], 'load_kva' => ['nullable', 'numeric', 'min:0'], 'loading_pct' => ['nullable', 'numeric', 'min:0', 'max:1000'],
            'current_r_a' => ['nullable', 'numeric', 'min:0'], 'current_s_a' => ['nullable', 'numeric', 'min:0'], 'current_t_a' => ['nullable', 'numeric', 'min:0'], 'current_n_a' => ['nullable', 'numeric', 'min:0'],
            'current_max_a' => ['nullable', 'numeric', 'min:0'], 'end_voltage_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'base_voltage_r_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'base_voltage_s_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'base_voltage_t_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'],
            'feeders' => ['nullable', 'array', 'max:12'], 'feeders.*.label' => ['required', 'string', 'max:40', 'distinct'], 'feeders.*.current_r_a' => ['nullable', 'numeric', 'min:0'], 'feeders.*.current_s_a' => ['nullable', 'numeric', 'min:0'],
            'feeders.*.current_t_a' => ['nullable', 'numeric', 'min:0'], 'feeders.*.current_n_a' => ['nullable', 'numeric', 'min:0'], 'feeders.*.end_voltage_v' => ['nullable', 'numeric', 'min:0', 'lt:1000'], 'kwh_total' => ['nullable', 'numeric', 'min:0'], 'source' => ['nullable', 'in:MANUAL,SURVEY']])->validate();
    }
}
