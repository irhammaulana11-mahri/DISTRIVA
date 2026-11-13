<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChangePasswordRequest;
use App\Http\Requests\LoginRequest;
use App\Models\User;
use App\Services\MfaService;
use App\Services\PasswordPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    // One message for unknown email, wrong password, inactive and locked accounts (no account enumeration).
    private const FAILED = ['message' => 'Email atau password salah, akun tidak aktif, atau akun terkunci sementara.'];

    public function login(LoginRequest $request, MfaService $mfa): JsonResponse
    {
        $email = Str::lower(trim($request->validated('email')));
        $password = $request->validated('password');

        $user = DB::transaction(function () use ($email, $password): ?User {
            // Row lock serializes concurrent attempts so the counter cannot be raced past the limit.
            $user = User::query()->where('email', $email)->lockForUpdate()->first();

            // Same hashing cost on every path.
            $valid = Hash::check($password, $user?->password ?? Hash::make(Str::random(32)));

            if ($user === null) {
                return null;
            }

            if ($user->locked_until !== null) {
                if ($user->locked_until->isFuture()) {
                    return null; // locked: even a correct password is refused; attempts do not extend the lock
                }
                $user->forceFill(['failed_login_attempts' => 0, 'locked_until' => null]);
            }

            if (! $valid) {
                $attempts = $user->failed_login_attempts + 1;
                $locked = $attempts >= (int) config('distriva.login_max_attempts');

                $user->forceFill([
                    'failed_login_attempts' => $locked ? 0 : $attempts,
                    'locked_until' => $locked ? now()->addMinutes((int) config('distriva.login_lockout_minutes')) : null,
                ])->save();

                if ($locked) {
                    Log::notice('Account locked after repeated failed logins.', ['user_id' => $user->getKey()]);
                }

                return null;
            }

            if ($user->isDirty()) {
                $user->save();
            }

            // An unused initial password stops working after temp_password_hours (docs/54 G-5).
            if ($user->must_change_password && $user->password_expires_at?->isPast()) {
                return null;
            }

            return $user->account_status === 'ACTIVE' ? $user : null;
        });

        if ($user === null) {
            return response()->json(self::FAILED, 401);
        }

        $user->forceFill(['last_login_at' => now(), 'failed_login_attempts' => 0, 'locked_until' => null])->save();
        $newToken = $user->createToken(
            $request->validated('device_name') ?? 'api',
            ['*'],
            now()->addMinutes(config('distriva.token_idle_minutes')),
        );
        $token = $newToken->plainTextToken;
        $required = $mfa->enforced() && $mfa->requiredFor($user);

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'must_change_password' => (bool) $user->must_change_password,
            'mfa' => ['required' => $required, 'enrolled' => $required && $mfa->enrolled($user), 'verified' => ! $required],
            'user' => $this->profile($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['message' => 'Logout berhasil.']);
    }

    public function changePassword(ChangePasswordRequest $request, PasswordPolicy $policy): JsonResponse
    {
        $user = $request->user();

        if (! Hash::check($request->validated('current_password'), $user->password)) {
            return response()->json(['message' => 'Password saat ini salah.'], 422);
        }

        DB::transaction(function () use ($user, $request, $policy): void {
            $user->forceFill(['password' => $request->validated('password'), 'must_change_password' => false, 'password_expires_at' => null])->save();
            $policy->remember($user, $user->password); // cast 'hashed' has already hashed it
        });
        // Revoke every other session/token; keep the one used for this request.
        $current = $user->currentAccessToken();
        $user->tokens()->when($current?->getKey(), fn ($q, $id) => $q->where('id', '!=', $id))->delete();

        return response()->json(['message' => 'Password berhasil diubah.']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->profile($request->user())]);
    }

    /** @return array<string, mixed> */
    private function profile(User $user): array
    {
        return $user->only(['id', 'nip', 'name', 'email', 'phone', 'account_status', 'must_change_password']);
    }
}
