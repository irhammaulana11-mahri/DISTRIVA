<?php

namespace App\Services;

use App\Models\User;
use App\Services\Notifications\Message;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\Recipient;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

use function Illuminate\Support\defer;

/**
 * One-time codes for account activation (status PENDING_ACTIVATION) and recovery (status ACTIVE, incl. locked or
 * forgotten password). Owner decision 2026-11-06 replaces administrator-issued temporary passwords.
 *
 * Security properties: the code is stored only as an HMAC; one live code per user+purpose (DB-enforced); wrong
 * guesses are counted and void the code; codes expire; each request needs a fresh code; request/verify answers
 * never reveal whether an e-mail exists or is eligible; the per-address request limit counts unknown addresses
 * too; delivery happens after the response is sent so timing does not leak either.
 */
class OtpService
{
    public const ACTIVATION = 'ACTIVATION';

    public const RECOVERY = 'RECOVERY';

    public function __construct(
        private readonly NotificationDispatcher $notifier,
        private readonly PasswordPolicy $policy,
    ) {}

    /** @return bool false when the per-address request limit is exhausted (HTTP 429). */
    public function request(string $email, string $purpose): bool
    {
        $email = $this->normalize($email);
        $key = 'otp-request:'.sha1($email);

        if (RateLimiter::tooManyAttempts($key, (int) config('distriva.otp.max_requests_per_hour'))) {
            return false;
        }
        RateLimiter::hit($key, 3600);

        $user = User::query()->where('email', $email)->first();
        $code = null;

        if ($user !== null && $this->eligible($user, $purpose)) {
            $code = DB::transaction(fn () => $this->issue($user->getKey(), $purpose));
        } else {
            $this->dummyWork();
        }

        if ($code !== null && $user !== null) {
            $recipient = new Recipient($user->name, $user->email, $user->phone);
            $message = $this->message($purpose, $code);
            $notifier = $this->notifier;
            $userId = $user->getKey();

            // After the response: sending takes long for real accounts and would otherwise leak their existence.
            defer(function () use ($notifier, $recipient, $message, $userId, $purpose): void {
                $report = $notifier->send($recipient, $message);
                if (! $report->anyDelivered()) {
                    Log::warning('OTP could not be delivered on any channel.', ['user_id' => $userId, 'purpose' => $purpose, 'failed' => array_keys($report->failed), 'skipped' => $report->skipped]);
                }
            });
        }

        return true;
    }

    /**
     * @return 'ok'|'invalid' 'invalid' covers wrong, expired, missing, voided, ineligible and unknown (one answer).
     *
     * @throws ValidationException password policy violations — only raised once the code itself was correct
     */
    public function verify(string $email, string $purpose, string $code, string $password): string
    {
        $email = $this->normalize($email);

        [$status, $violations] = DB::transaction(function () use ($email, $purpose, $code, $password): array {
            $user = User::query()->where('email', $email)->lockForUpdate()->first();
            $challenge = $user !== null && $this->eligible($user, $purpose)
                ? DB::table('otp_challenges')->where('user_id', $user->getKey())->where('purpose', $purpose)
                    ->whereNull('consumed_at')->whereNull('invalidated_at')->where('expires_at', '>', now())->lockForUpdate()->first()
                : null;

            if ($challenge === null) {
                $this->dummyWork();

                return ['invalid', []];
            }

            if (! hash_equals($challenge->code_hash, $this->hash($code, $challenge->id))) {
                $attempts = $challenge->attempts + 1;
                DB::table('otp_challenges')->where('id', $challenge->id)->update([
                    'attempts' => $attempts,
                    'invalidated_at' => $attempts >= (int) config('distriva.otp.max_attempts') ? now() : null,
                ]);

                return ['invalid', []]; // committed: the guess stays counted
            }

            // Correct code. A weak password must not burn it and must not count as a wrong guess.
            $violations = $this->policy->violations($password, $user);
            if ($violations !== []) {
                return ['policy', $violations];
            }

            $activation = $purpose === self::ACTIVATION;
            $user->forceFill([
                'password' => $password, 'account_status' => 'ACTIVE', 'must_change_password' => false,
                'password_expires_at' => null, 'failed_login_attempts' => 0, 'locked_until' => null,
            ])->save();
            $user->tokens()->delete(); // recovery ends every active session (docs/16)
            $this->policy->remember($user, $user->password);
            DB::table('otp_challenges')->where('id', $challenge->id)->update(['consumed_at' => now()]);
            DB::table('authorization_change_histories')->insert([
                'id' => (string) Str::uuid(), 'event_type' => $activation ? 'USER_ACTIVATED' : 'USER_PASSWORD_RECOVERED',
                'user_id' => $user->getKey(), 'actor_user_id' => null, // the user acted on their own account
                'after_values' => json_encode(['account_status' => 'ACTIVE']),
                'reason' => $activation ? 'Aktivasi akun dengan OTP.' : 'Pemulihan akses dengan OTP.', 'changed_at' => now(),
            ]);

            return ['ok', []];
        });

        if ($status === 'policy') {
            throw ValidationException::withMessages(['password' => $violations]);
        }

        return $status;
    }

    private function eligible(User $user, string $purpose): bool
    {
        return match ($purpose) {
            self::ACTIVATION => $user->account_status === 'PENDING_ACTIVATION',
            self::RECOVERY => $user->account_status === 'ACTIVE', // suspended/inactive accounts are an administrator's decision
            default => false,
        };
    }

    /** Creates the one live challenge (voiding any previous one) and returns the plain code — or null during cooldown. */
    private function issue(string $userId, string $purpose): ?string
    {
        $user = User::query()->whereKey($userId)->lockForUpdate()->first();
        $latest = DB::table('otp_challenges')->where('user_id', $userId)->where('purpose', $purpose)->orderByDesc('created_at')->first();

        if ($latest !== null && now()->diffInSeconds($latest->created_at, true) < (int) config('distriva.otp.resend_cooldown_seconds')
            && $latest->consumed_at === null && $latest->invalidated_at === null) {
            return null;
        }

        DB::table('otp_challenges')->where('user_id', $userId)->where('purpose', $purpose)
            ->whereNull('consumed_at')->whereNull('invalidated_at')->update(['invalidated_at' => now()]);

        $length = (int) config('distriva.otp.length');
        $code = str_pad((string) random_int(0, 10 ** $length - 1), $length, '0', STR_PAD_LEFT);
        $id = (string) Str::uuid();

        DB::table('otp_challenges')->insert([
            'id' => $id, 'user_id' => $user->getKey(), 'purpose' => $purpose, 'code_hash' => $this->hash($code, $id),
            'expires_at' => now()->addMinutes((int) config('distriva.otp.ttl_minutes')), 'created_at' => now(),
        ]);

        return $code;
    }

    private function message(string $purpose, string $code): Message
    {
        $what = $purpose === self::ACTIVATION ? 'aktivasi akun' : 'pemulihan akses';
        $ttl = (int) config('distriva.otp.ttl_minutes');

        return new Message(
            'Kode OTP DISTRIVA',
            "Kode OTP DISTRIVA untuk {$what}: {$code}\nBerlaku {$ttl} menit dan hanya sekali pakai. Jangan bagikan kode ini kepada siapa pun, termasuk petugas.",
            sensitive: true,
        );
    }

    private function hash(string $code, string $challengeId): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key').'|'.$challengeId);
    }

    private function normalize(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    /** Comparable CPU cost for unknown/ineligible accounts. */
    private function dummyWork(): void
    {
        hash_equals($this->hash('000000', 'x'), $this->hash('000001', 'y'));
    }
}
