<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Inventory\AllocationService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Allocations of materials + poles (with the KR number) per application (docs/62 §30). Violations -> 409, authorization -> 403/404. */
class AllocationController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly AllocationService $allocations, private readonly WorkflowNotifier $flow) {}

    public function create(Request $request, string $application): JsonResponse
    {
        $actor = $request->user();
        // Either part's role opens an allocation (Konstruksi UP3 or Perencanaan); each then fills only its own part.
        $this->either($request, $this->unitOfApplication($application));
        $d = Validator::make($request->all(), ['notes' => ['nullable', 'string', 'max:2000']])->validate();

        return response()->json(['data' => ['id' => $this->allocations->create($application, $d['notes'] ?? null, $actor)]], 201);
    }

    public function index(Request $request, string $application): JsonResponse
    {
        $this->viewable($request, $this->unitOfApplication($application));
        $rows = DB::table('allocations')->where('application_id', $application)->orderByDesc('version_number')->get();

        return response()->json(['data' => $rows->map(fn ($a) => ['id' => $a->id, 'version_number' => (int) $a->version_number, 'status' => $a->status, 'parent_allocation_id' => $a->parent_allocation_id, 'is_addition' => $a->parent_allocation_id !== null, 'confirmed_at' => $a->confirmed_at, 'cancelled_at' => $a->cancelled_at, 'created_at' => $a->created_at])->all()]);
    }

    public function show(Request $request, string $allocation): JsonResponse
    {
        $a = $this->find($allocation);
        $this->viewable($request, $this->unitOfApplication($a->application_id));
        $materials = DB::table('allocation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->join('warehouses as w', 'w.id', '=', 'l.warehouse_id')->where('l.allocation_id', $allocation)
            ->get(['k.code as khs_code', 'w.id as warehouse_id', 'w.code as warehouse_code', 'l.quantity']);
        $poles = DB::table('allocation_pole_lines as l')->join('pole_contracts as c', 'c.id', '=', 'l.pole_contract_id')->leftJoin('khs_items as k', 'k.id', '=', 'l.khs_item_id')->leftJoin('warehouses as w', 'w.id', '=', 'l.warehouse_id')->where('l.allocation_id', $allocation)->get(['c.id as pole_contract_id', 'c.kr_number', 'l.pole_type', 'l.quantity', 'l.khs_item_id', 'k.code as khs_code', 'l.warehouse_id', 'w.code as warehouse_code']);

        return response()->json(['data' => ['id' => $a->id, 'application_id' => $a->application_id, 'mto_package_id' => $a->mto_package_id, 'version_number' => (int) $a->version_number, 'status' => $a->status, 'parent_allocation_id' => $a->parent_allocation_id, 'is_addition' => $a->parent_allocation_id !== null, 'notes' => $a->notes, 'materials_confirmed_at' => $a->materials_confirmed_at, 'poles_confirmed_at' => $a->poles_confirmed_at, 'pole_debts' => $this->allocations->poleDebts($a->id),
            'confirmed_by' => $a->confirmed_by, 'confirmed_at' => $a->confirmed_at, 'cancelled_by' => $a->cancelled_by, 'cancelled_at' => $a->cancelled_at, 'cancel_reason' => $a->cancel_reason,
            'materials' => $materials->map(fn ($m) => ['khs_code' => $m->khs_code, 'warehouse_id' => $m->warehouse_id, 'warehouse_code' => $m->warehouse_code, 'quantity' => (float) $m->quantity])->all(),
            'poles' => $poles->map(fn ($p) => ['pole_contract_id' => $p->pole_contract_id, 'kr_number' => $p->kr_number, 'pole_type' => $p->pole_type, 'quantity' => (int) $p->quantity, 'khs_item_id' => $p->khs_item_id, 'khs_code' => $p->khs_code, 'warehouse_id' => $p->warehouse_id, 'warehouse_code' => $p->warehouse_code])->all()]]);
    }

    /** PUT /allocations/{id}/materials — all materials except concrete poles (KONSTRUKSI_UP3 / Gudang role). */
    public function putMaterials(Request $request, string $allocation): JsonResponse
    {
        $a = $this->manage($request, $allocation, 'allocations.manage');
        $d = Validator::make($request->all(), ['materials' => ['present', 'array', 'max:500'], 'materials.*.khs_code' => ['required', 'string', 'max:50'], 'materials.*.warehouse_id' => ['required', 'uuid'],
            'materials.*.quantity' => ['required', 'numeric', 'gte:0', 'max:1000000000'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $this->allocations->putMaterials($a->id, $d['materials'], $d['notes'] ?? null);

        return response()->json(['message' => 'Baris material alokasi disimpan.']);
    }

    /** GET /allocations/{id}/material-suggestions — MTO needs (except concrete poles) with stock per ULP/UP3 warehouse and a ready-made allocation (full when stock covers, else 0). */
    public function materialSuggestions(Request $request, string $allocation): JsonResponse
    {
        $a = $this->find($allocation);
        $this->viewable($request, $this->unitOfApplication($a->application_id));

        return response()->json(['data' => $this->allocations->materialSuggestions($a->id)]);
    }

    /** PUT /allocations/{id}/poles — concrete poles TM/TR with the Kontrak Rinci (PERENCANAAN). */
    public function putPoles(Request $request, string $allocation): JsonResponse
    {
        $a = $this->manage($request, $allocation, 'allocations.poles');
        $d = Validator::make($request->all(), ['poles' => ['present', 'array', 'max:50'], 'poles.*.pole_contract_id' => ['required', 'uuid'], 'poles.*.pole_type' => ['required', 'in:TM,TR'], 'poles.*.quantity' => ['required', 'integer', 'min:1', 'max:10000000'], 'poles.*.khs_item_id' => ['nullable', 'uuid'], 'poles.*.warehouse_id' => ['nullable', 'uuid']])->validate();
        $this->allocations->putPoles($a->id, $d['poles']);

        return response()->json(['message' => 'Baris tiang alokasi disimpan.']);
    }

    /** POST /allocations/{id}/confirm {part: materials|poles} — each part by its own role. */
    public function confirm(Request $request, string $allocation): JsonResponse
    {
        $part = $request->validate(['part' => ['required', 'in:materials,poles'], 'accept_debt' => ['sometimes', 'boolean']])['part'];
        $a = $this->manage($request, $allocation, $part === 'materials' ? 'allocations.manage' : 'allocations.poles');
        $this->allocations->confirmPart($a->id, $part, $request->user(), $request->boolean('accept_debt'));
        $this->flow->allocationConfirmed($a->id, $part, $request->user());

        return response()->json(['message' => $part === 'materials' ? 'Bagian material dikonfirmasi.' : 'Bagian tiang dikonfirmasi.']);
    }

    public function cancel(Request $request, string $allocation): JsonResponse
    {
        $a = $this->find($allocation);
        $this->either($request, $this->unitOfApplication($a->application_id));
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->allocations->cancel($a->id, $d['reason'], $request->user());

        return response()->json(['message' => 'Alokasi dibatalkan.']);
    }

    private function manage(Request $request, string $allocation, string $key): object
    {
        $a = $this->find($allocation);
        $this->authorizer->authorizeScope($request->user(), $key);
        $this->authorizer->authorizeOnUnit($request->user(), $key, $this->unitOfApplication($a->application_id));

        return $a;
    }

    /** Create / cancel: the holder of either part's key (materials or poles) on the application's unit. */
    private function either(Request $request, string $unitId): void
    {
        $actor = $request->user();
        $key = $this->authorizer->roleFor($actor, 'allocations.manage') !== null ? 'allocations.manage' : 'allocations.poles';
        $this->authorizer->authorizeScope($actor, $key);
        $this->authorizer->authorizeOnUnit($actor, $key, $unitId);
    }

    private function find(string $id): object
    {
        return DB::table('allocations')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function unitOfApplication(string $id): string
    {
        return (string) (DB::table('applications')->where('id', $id)->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404));
    }

    private function viewable(Request $request, string $unitId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'allocations.view');
        if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }
}
