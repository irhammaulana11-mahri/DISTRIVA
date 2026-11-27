<?php

namespace App\Http\Controllers;

use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Ringkasan Pusat Sinkronisasi (docs/94): run yang antre atau berjalan di semua sumber, hanya untuk UP3 dan izin yang dipegang pengguna. */
class SyncStatusController extends Controller
{
    public function __construct(private readonly SyncRuns $runs, private readonly SyncScope $scope) {}

    /** GET /sync/active */
    public function active(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->runs->active($request->user(), $this->scope)]);
    }
}
