<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Rab\RabService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** RAB runs (docs/62 §21). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class RabController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly RabService $rab) {}

    /** POST /mto/{package}/rab-runs — runs (and stores) the RAB of an APPROVED MTO package; dry_run = calculate only. */
    public function run(Request $request, string $package): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'rab.run');
        $this->authorizer->authorizeOnUnit($actor, 'rab.run', $this->unitOfPackage($package));
        $data = Validator::make($request->all(), ['dry_run' => ['sometimes', 'boolean'], 'date' => ['nullable', 'date_format:Y-m-d']])->validate();
        if ($request->boolean('dry_run')) {
            return response()->json(['data' => $this->rab->calculate($package, $data['date'] ?? null), 'stored' => false]);
        }

        return response()->json(['data' => $this->rab->run($package, $actor, $data['date'] ?? null), 'stored' => true], 201);
    }

    /** GET /mto/{package}/rab-runs */
    public function index(Request $request, string $package): JsonResponse
    {
        $this->viewable($request, $this->unitOfPackage($package));
        $runs = DB::table('rab_runs as r')->join('users as u', 'u.id', '=', 'r.created_by')->join('price_books as b', 'b.id', '=', 'r.price_book_id')->where('r.mto_package_id', $package)->orderByDesc('r.run_number')
            ->get(['r.id', 'r.run_number', 'r.valid_on', 'r.zone', 'r.grand_total', 'r.snapshot_hash', 'r.created_at', 'u.name as created_by_name', 'b.name as price_book_name']);

        return response()->json(['data' => $runs->map(fn ($r) => ['id' => $r->id, 'run_number' => $r->run_number, 'valid_on' => $r->valid_on, 'zone' => (int) $r->zone, 'grand_total' => (float) $r->grand_total,
            'snapshot_hash' => $r->snapshot_hash, 'created_at' => $r->created_at, 'created_by_name' => $r->created_by_name, 'price_book_name' => $r->price_book_name])->all()]);
    }

    /** GET /rab-runs/{run} */
    public function show(Request $request, string $run): JsonResponse
    {
        $r = DB::table('rab_runs')->where('id', $run)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, (string) DB::table('applications')->where('id', $r->application_id)->value('organizational_unit_id'));
        $lines = DB::table('rab_run_lines')->where('rab_run_id', $run)->orderBy('group_code')->orderBy('sequence')->orderBy('khs_code')->get();

        return response()->json(['data' => ['id' => $r->id, 'application_id' => $r->application_id, 'mto_package_id' => $r->mto_package_id, 'run_number' => $r->run_number, 'price_book_id' => $r->price_book_id,
            'up3_unit_id' => $r->up3_unit_id, 'zone' => (int) $r->zone, 'valid_on' => $r->valid_on, 'parameters' => json_decode((string) $r->parameters, true), 'groups' => json_decode((string) $r->groups, true),
            'grand_total' => (float) $r->grand_total, 'snapshot_hash' => $r->snapshot_hash, 'created_at' => $r->created_at,
            'lines' => $lines->map(fn ($l) => ['group' => $l->group_code, 'sequence' => $l->sequence, 'category' => $l->category, 'khs_code' => $l->khs_code, 'khs_name' => $l->khs_name, 'description' => $l->description, 'unit_text' => $l->unit_text,
                'qty_material' => (float) $l->qty_material, 'qty_install' => (float) $l->qty_install, 'qty_remove' => (float) $l->qty_remove, 'material_status' => $l->material_status,
                'material_price' => $l->material_price === null ? null : (float) $l->material_price, 'install_price' => $l->install_price === null ? null : (float) $l->install_price,
                'remove_price' => $l->remove_price === null ? null : (float) $l->remove_price, 'insured_value' => $l->insured_value === null ? null : (float) $l->insured_value,
                'material_cost' => (float) $l->material_cost, 'install_cost' => (float) $l->install_cost, 'remove_cost' => (float) $l->remove_cost, 'insurance_cost' => (float) $l->insurance_cost])->all()]]);
    }

    private function unitOfPackage(string $packageId): string
    {
        $p = DB::table('mto_packages')->where('id', $packageId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return (string) DB::table('applications')->where('id', $p->application_id)->value('organizational_unit_id');
    }

    private function viewable(Request $request, string $unitId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'rab.view');
        if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }
}
