<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Substations\FeederService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Master penyulang (docs/81). Grant (403/404) -> validation (422) -> rule (409). SYS_ADMIN writes need MFA. */
class FeederController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly FeederService $feeders) {}

    /** GET /master-data/feeders */
    public function index(Request $request): JsonResponse
    {
        $scope = $this->feeders->withLevel($this->authorizer->authorizeScope($request->user(), 'feeders.view'), $request->user());
        $f = Validator::make($request->query(), [
            'q' => ['nullable', 'string', 'max:100'],
            'owner_unit_id' => ['nullable', 'uuid'],
            'serves_unit_id' => ['nullable', 'uuid'],
            'up3_id' => ['nullable', 'uuid'],
            'gi_code' => ['nullable', 'string', 'max:40'],
            'status' => ['nullable', 'in:AKTIF,NONAKTIF'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ])->validate();

        return response()->json($this->feeders->search($f, $scope));
    }

    /** GET /master-data/feeders/{id} */
    public function show(Request $request, string $id): JsonResponse
    {
        $scope = $this->feeders->withLevel($this->authorizer->authorizeScope($request->user(), 'feeders.view'), $request->user());

        return response()->json(['data' => $this->feeders->show($id, $scope)]);
    }

    /** POST /master-data/feeders */
    public function store(Request $request): JsonResponse
    {
        $scope = $this->write($request);
        $in = Validator::make($request->all(), ['code' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9_\-]+$/'], 'name' => ['nullable', 'string', 'max:120'], 'gi_code' => ['nullable', 'string', 'max:40'], 'gi_name' => ['nullable', 'string', 'max:60'],
            'gi_transformer_no' => ['nullable', 'string', 'max:10'], 'owner_unit_id' => ['required', 'uuid', Rule::exists('organizational_units', 'id')], 'notes' => ['nullable', 'string', 'max:2000'], 'reason' => ['required', 'string', 'min:3', 'max:1000']])->validate();

        return response()->json(['data' => $this->feeders->create($in, $scope, $request->user())], 201);
    }

    /** PATCH /master-data/feeders/{id} */
    public function update(Request $request, string $id): JsonResponse
    {
        $scope = $this->write($request);
        $in = Validator::make($request->all(), ['name' => ['sometimes', 'nullable', 'string', 'max:120'], 'gi_code' => ['sometimes', 'nullable', 'string', 'max:40'], 'gi_name' => ['sometimes', 'nullable', 'string', 'max:60'], 'gi_transformer_no' => ['sometimes', 'nullable', 'string', 'max:10'],
            'owner_unit_id' => ['sometimes', 'uuid', Rule::exists('organizational_units', 'id')], 'status' => ['sometimes', 'in:AKTIF,NONAKTIF'], 'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'reason' => ['required', 'string', 'min:3', 'max:1000']])->validate();

        return response()->json(['data' => $this->feeders->update($id, $in, $scope, $request->user())]);
    }

    /** @return array{unrestricted: bool, units: list<string>} */
    private function write(Request $request): array
    {
        $scope = $this->feeders->withLevel($this->authorizer->authorizeScope($request->user(), 'feeders.manage'), $request->user());
        if ($scope['unrestricted'] && ! app(MfaService::class)->satisfied($request->user())) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }

        return $scope;
    }
}
