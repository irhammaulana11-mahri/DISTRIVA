<?php

namespace App\Services;

use App\Models\User;
use App\Services\Authorization\ScopedAuthorizationService;
use App\Support\Totp;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Multi-factor authentication for SYS_ADMIN (docs/16: MFA mandatory for SYS_ADMIN; docs/54 D-3/D-4).
 * TOTP + one-time recovery codes. Enforced when config distriva.system_writes_require_mfa is true:
 * a SYS_ADMIN token can do nothing but MFA enrolment/verification, /me, logout and password change until it is verified.
 */
class MfaService
{
    private const RECOVERY_COUNT = 8;

    public function __construct(private readonly ScopedAuthorizationService $scoped) {}

    public function enforced(): bool
    {
        return (bool) config('distriva.system_writes_require_mfa');
    }

    public function requiredFor(User $user): bool
    {
        return $this->scoped->effectiveAssignments($user)->contains(fn ($a) => $a->role?->name === 'SYS_ADMIN');
    }

    public function enrolled(User $user): bool
    {
        return DB::table('user_mfa_credentials')->where('user_id', $user->getKey())->whereNotNull('confirmed_at')->exists();
    }

    public function tokenVerified(User $user): bool
    {
        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->mfa_verified_at !== null;
    }

    /** True when the actor may perform a SYS_ADMIN write now. */
    public function satisfied(User $user): bool
    {
        return ! $this->enforced() || $this->tokenVerified($user);
    }

    /** @return array{required:bool,enrolled:bool,verified:bool} */
    public function state(User $user): array
    {
        $required = $this->enforced() && $this->requiredFor($user);

        return ['required' => $required, 'enrolled' => $required ? $this->enrolled($user) : false, 'verified' => ! $required || $this->tokenVerified($user)];
    }

    /** Start (or restart, while unconfirmed) enrolment. @return array{secret:string,otpauth_uri:string} */
    public function begin(User $user): array
    {
        if ($this->enrolled($user)) {
            throw new \DomainException('MFA sudah terdaftar. Hubungi administrator sistem untuk mengatur ulang.');
        }
        $secret = Totp::generateSecret();
        DB::table('user_mfa_credentials')->updateOrInsert(
            ['user_id' => $user->getKey()],
            ['id' => DB::table('user_mfa_credentials')->where('user_id', $user->getKey())->value('id') ?? (string) Str::uuid(),
                'secret_encrypted' => Crypt::encryptString($secret), 'confirmed_at' => null, 'last_used_step' => null,
                'recovery_code_hashes' => null, 'failed_attempts' => 0, 'locked_until' => null, 'updated_at' => now(), 'created_at' => now()],
        );

        return ['secret' => $secret, 'otpauth_uri' => Totp::uri($secret, $user->email, (string) config('app.name', 'DISTRIVA'))];
    }

    /** Confirm enrolment with the first valid code. @return list<string> recovery codes, shown once */
    public function confirm(User $user, string $code): array
    {
        $row = DB::table('user_mfa_credentials')->where('user_id', $user->getKey())->whereNull('confirmed_at')->first();
        if ($row === null) {
            throw new \DomainException('Pendaftaran MFA belum dimulai.');
        }
        $step = $this->checkCode($user, $row, $code);
        if ($step === null) {
            throw new \InvalidArgumentException('Kode salah.');
        }
        $plain = collect(range(1, self::RECOVERY_COUNT))->map(fn () => Str::upper(Str::random(5).'-'.Str::random(5)))->all();
        DB::table('user_mfa_credentials')->where('id', $row->id)->update([
            'confirmed_at' => now(), 'last_used_step' => $step, 'failed_attempts' => 0,
            'recovery_code_hashes' => json_encode(array_map(fn ($c) => $this->hashRecovery($c), $plain)), 'updated_at' => now(),
        ]);
        $this->markTokenVerified($user);

        return $plain;
    }

    /** Verify a TOTP code or a recovery code for the current token. */
    public function verify(User $user, string $code): void
    {
        $row = DB::table('user_mfa_credentials')->where('user_id', $user->getKey())->whereNotNull('confirmed_at')->first();
        if ($row === null) {
            throw new \DomainException('MFA belum didaftarkan.');
        }
        if ($row->locked_until !== null && now()->lt($row->locked_until)) {
            throw new \DomainException('Terlalu banyak percobaan salah. Coba lagi nanti.');
        }
        $ok = false;
        $step = $this->checkCode($user, $row, $code, false);
        if ($step !== null) {
            DB::table('user_mfa_credentials')->where('id', $row->id)->update(['last_used_step' => $step]);
            $ok = true;
        } elseif ($this->consumeRecovery($row, $code)) {
            $ok = true;
        }
        if (! $ok) {
            $this->recordFailure($row);
            throw new \InvalidArgumentException('Kode salah.');
        }
        DB::table('user_mfa_credentials')->where('id', $row->id)->update(['failed_attempts' => 0, 'locked_until' => null]);
        $this->markTokenVerified($user);
    }

    /** Console recovery for a lost device: forget the credential and revoke tokens. */
    public function reset(User $user): void
    {
        DB::transaction(function () use ($user): void {
            DB::table('user_mfa_credentials')->where('user_id', $user->getKey())->delete();
            $user->tokens()->delete();
        });
    }

    private function checkCode(User $user, object $row, string $code, bool $recordFailure = true): ?int
    {
        if ($row->locked_until !== null && now()->lt($row->locked_until)) {
            throw new \DomainException('Terlalu banyak percobaan salah. Coba lagi nanti.');
        }
        $step = Totp::verify(Crypt::decryptString($row->secret_encrypted), $code);
        if ($step === null || ($row->last_used_step !== null && $step <= (int) $row->last_used_step)) {
            if ($recordFailure) {
                $this->recordFailure($row);
            }

            return null;
        }

        return $step;
    }

    private function recordFailure(object $row): void
    {
        $attempts = (int) $row->failed_attempts + 1;
        $locked = $attempts >= (int) config('distriva.login_max_attempts');
        DB::table('user_mfa_credentials')->where('id', $row->id)->update([
            'failed_attempts' => $locked ? 0 : $attempts,
            'locked_until' => $locked ? now()->addMinutes((int) config('distriva.login_lockout_minutes')) : null,
        ]);
    }

    private function consumeRecovery(object $row, string $code): bool
    {
        $code = Str::upper(trim($code));
        if (! preg_match('/^[A-Z0-9]{5}-[A-Z0-9]{5}$/', $code)) {
            return false;
        }
        $hashes = json_decode((string) $row->recovery_code_hashes, true) ?: [];
        $hash = $this->hashRecovery($code);
        foreach ($hashes as $i => $h) {
            if (hash_equals($h, $hash)) {
                unset($hashes[$i]);
                DB::table('user_mfa_credentials')->where('id', $row->id)->update(['recovery_code_hashes' => json_encode(array_values($hashes))]);

                return true;
            }
        }

        return false;
    }

    private function hashRecovery(string $code): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key'));
    }

    private function markTokenVerified(User $user): void
    {
        $token = $user->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            $token->forceFill(['mfa_verified_at' => now()])->save();
        }
    }
}
