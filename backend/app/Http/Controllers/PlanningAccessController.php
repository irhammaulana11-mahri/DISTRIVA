<?php

namespace App\Http\Controllers;

use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\WorkOrders\VendorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /planning/access — what the signed-in user may do in stages 5-8 (RAB, KKF, usulan, allocations, RKM, work orders, BASTP): the keys of config groups `rab`, `kkf`, `planning`.
 * The UI uses it to show/hide menus and buttons only (the server enforces). `vendor.portal` is true for an active vendor account whose company is active: vendors act through the
 * persisted relation account -> company -> WO, not through keys, so they hold none of the keys above.
 */
class PlanningAccessController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly CatalogAuthorizer $catalog) {}

    public function access(Request $request): JsonResponse
    {
        $user = $request->user();
        $can = [];
        foreach (['rab', 'kkf', 'planning'] as $group) {
            foreach (array_keys((array) config("distriva_permissions.{$group}")) as $key) {
                $can[$key] = $this->authorizer->roleFor($user, $key) !== null;   // an effective assignment whose role holds the key (UP3-level keys included)
            }
        }
        $can['outages.view'] = $this->authorizer->roleFor($user, 'outages.view') !== null;   // gangguan penyulang: lihat menurut unit, ubah (sinkron) menurut peran
        $can['outages.sync'] = $this->catalog->allows($user, 'outages.sync');
        $can['vendor.portal'] = VendorService::companyOf($user) !== null;

        return response()->json(['can' => $can]);
    }
}
