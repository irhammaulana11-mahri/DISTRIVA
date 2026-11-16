<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Substations\ConnectionService;
use App\Services\Substations\DilSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/** Master pelanggan (docs/81). Grant (403/404) -> validation (422) -> rule (409). SYS_ADMIN writes need MFA. */
class ConnectionController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly ConnectionService $connections, private readonly DilSyncService $dilSync) {}

    /** GET /master-data/customer-connections */
    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'customers.view');
        $f = Validator::make($request->query(), ['q' => ['nullable', 'string', 'max:100'], 'organizational_unit_id' => ['nullable', 'uuid'], 'substation_id' => ['nullable', 'uuid'], 'feeder_id' => ['nullable', 'uuid'],
            'tariff_code' => ['nullable', 'string', 'max:10'], 'status' => ['nullable', 'in:AKTIF,BONGKAR,HAPUS,PROSES'], 'service_type' => ['nullable', 'in:PASKABAYAR,PRABAYAR'], 'linked' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100']])->validate();

        return response()->json($this->connections->search($f, $scope));
    }

    /** GET /master-data/customer-connections/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'customers.view');

        return response()->json(['data' => $this->connections->show($id, $scope)]);
    }

    /** PATCH /master-data/customer-connections/{id}/link — body {substation_id: uuid|null} */
    public function link(Request $request, string $id): JsonResponse
    {
        $scope = $this->write($request, 'customers.manage');
        $in = Validator::make($request->all(), ['substation_id' => ['present', 'nullable', 'uuid']])->validate();

        return response()->json(['data' => $this->connections->link($id, $in['substation_id'], $scope)]);
    }

    /** POST /master-data/customer-connections/batches */
    public function start(Request $request): JsonResponse
    {
        $this->write($request, 'customers.import');
        $in = Validator::make($request->all(), ['file_name' => ['nullable', 'string', 'max:255'], 'snapshot_month' => ['nullable', 'regex:/^\d{6}$/']])->validate();

        return response()->json(['data' => $this->connections->startBatch($in['file_name'] ?? null, $in['snapshot_month'] ?? null, $request->user())], 201);
    }

    /** POST /master-data/customer-connections/batches/{batch}/items — a chunk of at most 2000 rows, idempotent by IDPEL */
    public function items(Request $request, string $batch): JsonResponse
    {
        $scope = $this->write($request, 'customers.import');
        $v = Validator::make($request->all(), ['items' => ['required', 'array', 'min:1', 'max:2000'], 'items.*' => ['array']])->validate();

        return response()->json(['data' => $this->connections->addItems($batch, $v['items'], $scope, $request->user())]);
    }

    /** POST /master-data/customer-connections/batches/{batch}/complete */
    public function complete(Request $request, string $batch): JsonResponse
    {
        $this->write($request, 'customers.import');

        return response()->json(['data' => $this->connections->complete($batch, $request->user())]);
    }

    /** GET /master-data/customer-connections/batches/{batch} */
    public function batch(Request $request, string $batch): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'customers.import');

        return response()->json(['data' => $this->connections->batch($batch, $request->user())]);
    }

    /** GET /master-data/customer-connections/sync — the inbox folder, the files in it, and the latest runs. */
    public function syncInfo(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'customers.import');

        return response()->json(['data' => $this->dilSync->info()]);
    }

    /** POST /master-data/customer-connections/sync/runs — load the files now in the inbox (detached process). */
    public function syncStart(Request $request): JsonResponse
    {
        $this->write($request, 'customers.import');
        $d = Validator::make($request->all(), ['units' => ['sometimes', 'array', 'min:1', 'max:40'], 'units.*' => ['string', 'regex:/^\\d{5}$/']])->validate();
        $id = $this->dilSync->start($request->user(), $d['units'] ?? null);

        return response()->json(['data' => $this->dilSync->show($id), 'message' => 'Sinkron DIL dimulai di latar belakang.'], 202);
    }

    /** GET /master-data/customer-connections/sync/runs/{run} */
    public function syncShow(Request $request, string $run): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'customers.import');

        return response()->json(['data' => $this->dilSync->show($run) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404)]);
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
}
