<?php

namespace App\Http\Controllers;

use App\Services\MfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** MFA enrolment and verification for SYS_ADMIN (reachable with an MFA-unverified token). */
class MfaController extends Controller
{
    public function __construct(private readonly MfaService $mfa) {}

    public function status(Request $request): JsonResponse
    {
        return response()->json(['mfa' => $this->mfa->state($request->user())]);
    }

    public function begin(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $this->mfa->requiredFor($user)) {
            return response()->json(['message' => 'MFA hanya untuk SYS_ADMIN.'], 403);
        }
        try {
            return response()->json(['data' => $this->mfa->begin($user)]);
        } catch (\DomainException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    public function confirm(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:20']]);
        try {
            $codes = $this->mfa->confirm($request->user(), $data['code']);
        } catch (\DomainException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['message' => 'MFA aktif. Simpan kode pemulihan; hanya ditampilkan sekali.', 'recovery_codes' => $codes, 'mfa' => $this->mfa->state($request->user())]);
    }

    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:20']]);
        try {
            $this->mfa->verify($request->user(), $data['code']);
        } catch (\DomainException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['message' => 'Verifikasi MFA berhasil.', 'mfa' => $this->mfa->state($request->user())]);
    }
}
