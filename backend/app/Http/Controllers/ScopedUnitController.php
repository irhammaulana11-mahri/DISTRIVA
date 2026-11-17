<?php

namespace App\Http\Controllers;

use App\Services\Authorization\ScopedUnitOptions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** GET /scoped-units?permission=… — the UP3 and ULP choices of a page's unit filters, by the actor's role and scope for that page's permission. */
class ScopedUnitController extends Controller
{
    /** Pages that filter by UP3 / ULP; the permission decides the scope the actor sees. */
    public const PERMISSIONS = ['applications.view', 'reports.view', 'substations.view', 'customers.view', 'feeders.view', 'rkm.view', 'forecast.view'];

    public function __invoke(Request $request, ScopedUnitOptions $options): JsonResponse
    {
        $data = $request->validate(['permission' => ['required', Rule::in(self::PERMISSIONS)]]);

        return response()->json($options->for($request->user(), $data['permission']));
    }
}
