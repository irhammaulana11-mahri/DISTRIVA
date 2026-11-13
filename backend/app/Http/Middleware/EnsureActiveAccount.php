<?php

namespace App\Http\Middleware;

use App\Services\MfaService;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class EnsureActiveAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->account_status !== 'ACTIVE') {
            return response()->json(['message' => 'Akun tidak aktif.'], 403);
        }

        $this->slideTokenExpiry($request);

        // SYS_ADMIN must pass MFA on this token before anything except enrolment/verification, profile, logout, password change.
        $mfa = app(MfaService::class);
        if ($mfa->enforced() && ! $request->is('api/auth/mfa', 'api/auth/mfa/*', 'api/auth/logout', 'api/me', 'api/me/password')
            && $mfa->requiredFor($request->user()) && ! $mfa->tokenVerified($request->user())) {
            return response()->json(['message' => 'Verifikasi MFA diperlukan.', 'mfa' => $mfa->state($request->user())], 403);
        }

        return $next($request);
    }

    /** Idle timeout: push expires_at forward, writing at most about once a minute. */
    private function slideTokenExpiry(Request $request): void
    {
        $token = $request->user()->currentAccessToken();
        $ttl = (int) config('distriva.token_idle_minutes');

        if (! $token instanceof PersonalAccessToken || $token->expires_at === null || $ttl <= 0) {
            return;
        }

        $target = now()->addMinutes($ttl);

        if ($token->expires_at->diffInSeconds($target, true) >= 60) {
            $token->forceFill(['expires_at' => $target])->save();
        }
    }
}
