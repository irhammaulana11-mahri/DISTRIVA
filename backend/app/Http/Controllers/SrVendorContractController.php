<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Inventory\SrReservationService;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** The contracted 1-phase executor of each ULP (docs/95). One company per ULP at any date; a contract is ended or renumbered, never deleted. */
class SrVendorContractController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly SrReservationService $reservations) {}

    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'sr_reservations.view');
        $rows = DB::table('sr_vendor_contracts as k')->join('organizational_units as u', 'u.id', '=', 'k.organizational_unit_id')->join('vendor_companies as c', 'c.id', '=', 'k.vendor_company_id')
            ->when(! $scope['unrestricted'], fn ($q) => $q->whereIn('k.organizational_unit_id', $scope['units']))->orderBy('u.code')->orderByDesc('k.valid_from')
            ->get(['k.*', 'u.code as unit_code', 'u.name as unit_name', 'c.code as vendor_code', 'c.name as vendor_name', 'c.status as vendor_status']);

        return response()->json(['data' => $rows->map(fn ($k) => ['id' => $k->id, 'contract_number' => $k->contract_number, 'valid_from' => $k->valid_from, 'valid_until' => $k->valid_until,
            'unit' => ['id' => $k->organizational_unit_id, 'code' => $k->unit_code, 'name' => $k->unit_name],
            'vendor' => ['id' => $k->vendor_company_id, 'code' => $k->vendor_code, 'name' => $k->vendor_name, 'status' => $k->vendor_status]])->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        $in = $request->validate(['organizational_unit_id' => ['required', 'uuid'], 'vendor_company_id' => ['required', 'uuid'], 'contract_number' => ['required', 'string', 'max:100'],
            'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_until' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:valid_from']]);
        $this->authorizer->authorizeOnUnit($request->user(), 'sr_vendor_contracts.manage', $in['organizational_unit_id']);
        if (DB::table('organizational_units')->where('id', $in['organizational_unit_id'])->value('unit_type') !== 'ULP') {
            throw new AssignmentRuleViolation('Kontrak pelaksana 1 phasa dibuat per ULP.');
        }
        $this->reservations->assertNetworkVendor($in['vendor_company_id']);
        $id = (string) Str::uuid();
        $this->guardOverlap(fn () => DB::table('sr_vendor_contracts')->insert($in + ['id' => $id, 'created_by' => $request->user()->getKey(), 'created_at' => now(), 'updated_at' => now()]));

        return response()->json(['data' => ['id' => $id]], 201);
    }

    public function update(Request $request, string $contract): JsonResponse
    {
        $row = DB::table('sr_vendor_contracts')->where('id', $contract)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($request->user(), 'sr_vendor_contracts.manage', $row->organizational_unit_id);
        $in = $request->validate(['contract_number' => ['sometimes', 'required', 'string', 'max:100'], 'valid_until' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:'.$row->valid_from]]);
        $this->guardOverlap(fn () => DB::table('sr_vendor_contracts')->where('id', $contract)->update($in + ['updated_at' => now()]));

        return response()->json(['message' => 'Kontrak diperbarui.']);
    }

    /** The database refuses two contracts of one ULP on the same date (exclusion constraint, SQLSTATE 23P01). */
    private function guardOverlap(callable $write): void
    {
        try {
            DB::transaction($write);
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '23P01') {
                throw new AssignmentRuleViolation('Masa kontrak tumpang tindih dengan kontrak lain di ULP ini; akhiri kontrak lama dulu.', 0, $e);
            }
            throw $e;
        }
    }
}
