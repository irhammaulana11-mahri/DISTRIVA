<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Activation and recovery with one-time codes (owner decision 2026-11-06). */
class OtpFlowTest extends PostgresTestCase
{
    private const WA_URL = 'https://gateway.example.test/send';

    private const GOOD = 'Kunci-Baru#2026b';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class); // per-IP throttle is covered separately; per-email limit is not a middleware
        config([
            'distriva_notifications.channels' => ['mail', 'whatsapp'],
            'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::WA_URL, 'token' => 'GW-TOKEN', 'body' => '{"target":"{phone}","message":"{message}"}'],
        ]);
        Http::fake([self::WA_URL => Http::response(['status' => true])]);
    }

    private function person(string $status = 'PENDING_ACTIVATION', string $email = 'siti@example.com'): User
    {
        $u = $this->makeUser($status, $email);
        $u->forceFill(['name' => 'Siti Aminah', 'phone' => '0812-3456-7890'])->save();

        return $u;
    }

    private function request(string $email, string $purpose = 'activation')
    {
        return $this->postJson('/api/auth/otp/request', ['email' => $email, 'purpose' => $purpose]);
    }

    private function verify(string $email, string $otp, string $password = self::GOOD, string $purpose = 'activation')
    {
        return $this->postJson('/api/auth/otp/verify', ['email' => $email, 'purpose' => $purpose, 'otp' => $otp, 'password' => $password, 'password_confirmation' => $password]);
    }

    /** The code that was e-mailed, and the same code as received on WhatsApp. */
    private function sentCode(int $mailIndex = 0): string
    {
        $messages = Mail::mailer('array')->getSymfonyTransport()->messages();
        $this->assertGreaterThan($mailIndex, count($messages), 'no e-mail was sent');
        $this->assertSame(1, preg_match('/: (\d{6})\n/', $messages[$mailIndex]->getOriginalMessage()->getTextBody(), $m));

        return $m[1];
    }

    private function flushMail(): void
    {
        Mail::mailer('array')->getSymfonyTransport()->flush();
    }

    private function wrongCode(string $real): string
    {
        return $real === '000000' ? '000001' : '000000';
    }

    #[Test]
    public function activation_with_a_code_sent_by_email_and_whatsapp_activates_the_account_and_lets_the_user_log_in(): void
    {
        $user = $this->person();
        $this->request('Siti@Example.com')->assertStatus(202);

        $code = $this->sentCode();
        Http::assertSent(fn ($r) => $r['target'] === '6281234567890' && str_contains($r['message'], $code)); // same code on both channels

        $this->verify('siti@example.com', $code)->assertOk()->assertJsonPath('message', 'Akun berhasil diaktifkan. Silakan masuk.');

        $fresh = $user->fresh();
        $this->assertSame('ACTIVE', $fresh->account_status);
        $this->assertFalse($fresh->must_change_password);
        $this->assertTrue(Hash::check(self::GOOD, $fresh->password));
        $this->assertDatabaseHas('authorization_change_histories', ['event_type' => 'USER_ACTIVATED', 'user_id' => $user->getKey()]);
        $this->assertSame(1, DB::table('password_histories')->where('user_id', $user->getKey())->count());
        $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => self::GOOD])->assertOk();
    }

    #[Test]
    public function a_code_works_once_only(): void
    {
        $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();
        $this->verify('siti@example.com', $code)->assertOk();

        $this->verify('siti@example.com', $code, 'Lain-Lagi#20267', 'activation')->assertStatus(422);
        $this->verify('siti@example.com', $code, 'Lain-Lagi#20267', 'recovery')->assertStatus(422);
    }

    #[Test]
    public function recovery_unlocks_a_locked_account_ends_all_sessions_and_sets_the_new_password(): void
    {
        $user = $this->person('ACTIVE');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => 'salah'])->assertUnauthorized();
        }
        $this->assertNotNull($user->fresh()->locked_until);
        $user->createToken('old-session');

        $this->request('siti@example.com', 'recovery')->assertStatus(202);
        $this->verify('siti@example.com', $this->sentCode(), self::GOOD, 'recovery')->assertOk()->assertJsonPath('message', 'Password berhasil diubah. Silakan masuk.');

        $fresh = $user->fresh();
        $this->assertNull($fresh->locked_until);
        $this->assertSame(0, $fresh->failed_login_attempts);
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->getKey())->count());
        $this->assertDatabaseHas('authorization_change_histories', ['event_type' => 'USER_PASSWORD_RECOVERED', 'user_id' => $user->getKey()]);
        $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => self::GOOD])->assertOk(); // no 15-minute wait
        $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => 'secret-password'])->assertUnauthorized(); // old password is dead
    }

    // ---- no enumeration ---------------------------------------------------------------

    /** @return array<string, array{0: string, 1: string}> */
    public static function ineligible(): array
    {
        return [
            'unknown address' => ['unknown', 'activation'],
            'active user asks for activation' => ['ACTIVE', 'activation'],
            'pending user asks for recovery' => ['PENDING_ACTIVATION', 'recovery'],
            'suspended user' => ['SUSPENDED', 'recovery'],
            'inactive user' => ['INACTIVE', 'recovery'],
        ];
    }

    #[Test]
    #[DataProvider('ineligible')]
    public function ineligible_requests_look_exactly_like_eligible_ones_and_send_nothing(string $kind, string $purpose): void
    {
        $eligible = $this->person();
        $good = $this->request('siti@example.com', 'activation');
        $this->flushMail();
        Http::fake([self::WA_URL => Http::response(['status' => true])]);

        $email = $kind === 'unknown' ? 'nobody@example.com' : 'other@example.com';
        if ($kind !== 'unknown') {
            $this->person($kind, $email);
        }
        $bad = $this->request($email, $purpose);

        $this->assertSame($good->getStatusCode(), $bad->getStatusCode());
        $this->assertSame($good->json(), $bad->json());
        $this->assertCount(0, Mail::mailer('array')->getSymfonyTransport()->messages());
        Http::assertNothingSent();
        $this->assertSame(0, DB::table('otp_challenges')->where('user_id', '!=', $eligible->getKey())->count());
    }

    #[Test]
    #[DataProvider('ineligible')]
    public function verifying_for_an_ineligible_account_gives_the_same_answer_as_a_wrong_code(string $kind, string $purpose): void
    {
        $this->person();
        $this->request('siti@example.com');
        $wrong = $this->verify('siti@example.com', $this->wrongCode($this->sentCode()));

        $email = $kind === 'unknown' ? 'nobody@example.com' : 'other@example.com';
        if ($kind !== 'unknown') {
            $this->person($kind, $email);
        }
        $other = $this->verify($email, '123456', self::GOOD, $purpose);

        $this->assertSame($wrong->getStatusCode(), $other->getStatusCode());
        $this->assertSame($wrong->json(), $other->json());
    }

    #[Test]
    public function the_request_limit_counts_unknown_addresses_too_so_it_cannot_be_used_to_probe(): void
    {
        config(['distriva.otp.max_requests_per_hour' => 3]);
        $this->person();
        foreach (['nobody@example.com', 'siti@example.com'] as $email) {
            RateLimiter::clear('otp-request:'.sha1($email));
            for ($i = 0; $i < 3; $i++) {
                $this->request($email)->assertStatus(202);
            }
            $this->request($email)->assertStatus(429)->assertJsonPath('message', 'Terlalu banyak permintaan kode. Coba lagi nanti.');
        }
    }

    // ---- guessing, expiry, cooldown ---------------------------------------------------

    #[Test]
    public function five_wrong_codes_void_the_code_even_for_the_correct_one_afterwards(): void
    {
        $user = $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();

        for ($i = 0; $i < 5; $i++) {
            $this->verify('siti@example.com', $this->wrongCode($code))->assertStatus(422);
        }

        $this->assertNotNull(DB::table('otp_challenges')->where('user_id', $user->getKey())->value('invalidated_at'));
        $this->verify('siti@example.com', $code)->assertStatus(422); // too late: the code is void
        $this->assertSame('PENDING_ACTIVATION', $user->fresh()->account_status);
    }

    #[Test]
    public function four_wrong_codes_do_not_void_it(): void
    {
        $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();
        for ($i = 0; $i < 4; $i++) {
            $this->verify('siti@example.com', $this->wrongCode($code))->assertStatus(422);
        }
        $this->verify('siti@example.com', $code)->assertOk();
    }

    #[Test]
    public function the_code_expires_after_the_configured_time(): void
    {
        $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();

        $this->travel(11)->minutes();
        $this->verify('siti@example.com', $code)->assertStatus(422);
    }

    #[Test]
    public function the_code_is_still_valid_just_before_expiry(): void
    {
        $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();

        $this->travel(9)->minutes();
        $this->verify('siti@example.com', $code)->assertOk();
    }

    #[Test]
    public function a_new_request_within_the_cooldown_sends_nothing_and_after_it_voids_the_previous_code(): void
    {
        $user = $this->person();
        $this->request('siti@example.com')->assertStatus(202);
        $first = $this->sentCode();

        $this->request('siti@example.com')->assertStatus(202); // within 60 s: same answer, no second message
        $this->assertCount(1, Mail::mailer('array')->getSymfonyTransport()->messages());

        $this->travel(61)->seconds();
        $this->request('siti@example.com')->assertStatus(202);
        $second = $this->sentCode(1);

        $this->assertSame(1, DB::table('otp_challenges')->where('user_id', $user->getKey())->whereNull('invalidated_at')->whereNull('consumed_at')->count());
        if ($first !== $second) {
            $this->verify('siti@example.com', $first)->assertStatus(422); // the older code no longer works
        }
        $this->verify('siti@example.com', $second)->assertOk();
    }

    #[Test]
    public function a_code_for_one_purpose_cannot_be_used_for_the_other(): void
    {
        $this->person('ACTIVE');
        $this->request('siti@example.com', 'recovery');
        $this->verify('siti@example.com', $this->sentCode(), self::GOOD, 'activation')->assertStatus(422);
    }

    #[Test]
    public function an_account_suspended_after_the_code_was_issued_cannot_use_it(): void
    {
        $user = $this->person('ACTIVE');
        $this->request('siti@example.com', 'recovery');
        $code = $this->sentCode();

        $user->forceFill(['account_status' => 'SUSPENDED'])->save();
        $this->verify('siti@example.com', $code, self::GOOD, 'recovery')->assertStatus(422);
    }

    // ---- password rules ----------------------------------------------------------------

    #[Test]
    public function a_weak_password_after_the_correct_code_reports_every_problem_and_keeps_the_code_usable(): void
    {
        $user = $this->person();
        $this->request('siti@example.com');
        $code = $this->sentCode();

        $res = $this->verify('siti@example.com', $code, 'abc')->assertUnprocessable();
        $this->assertGreaterThanOrEqual(4, count($res->json('errors.password')));
        $this->verify('siti@example.com', $code, 'Siti-Aminah#2026')->assertUnprocessable(); // contains the name

        $this->assertSame(0, DB::table('otp_challenges')->where('user_id', $user->getKey())->value('attempts')); // not counted as guesses
        $this->assertSame('PENDING_ACTIVATION', $user->fresh()->account_status);

        $this->verify('siti@example.com', $code)->assertOk(); // the same code still works
    }

    #[Test]
    public function a_weak_password_with_a_wrong_code_reveals_nothing_about_the_password_rules(): void
    {
        $this->person();
        $this->request('siti@example.com');
        $wrong = $this->wrongCode($this->sentCode());

        $this->verify('siti@example.com', $wrong, 'abc')->assertStatus(422)->assertJsonMissingPath('errors');
    }

    #[Test]
    public function recovery_refuses_one_of_the_last_five_passwords(): void
    {
        $user = $this->person('ACTIVE');
        $this->request('siti@example.com', 'recovery');
        $this->verify('siti@example.com', $this->sentCode(), 'Kunci-Satu#2026a', 'recovery')->assertOk();

        $this->travel(61)->seconds();
        $this->flushMail();
        $this->request('siti@example.com', 'recovery');
        $res = $this->verify('siti@example.com', $this->sentCode(), 'Kunci-Satu#2026a', 'recovery')->assertUnprocessable();
        $this->assertStringContainsString('5 password terakhir', implode(' ', $res->json('errors.password')));
        $this->assertTrue(Hash::check('Kunci-Satu#2026a', $user->fresh()->password));
    }

    // ---- storage, logging, input -------------------------------------------------------

    #[Test]
    public function the_code_is_stored_only_as_a_keyed_hash_and_never_appears_in_responses_or_logs(): void
    {
        Log::spy();
        $user = $this->person();
        $res = $this->request('siti@example.com');
        $code = $this->sentCode();

        $row = DB::table('otp_challenges')->where('user_id', $user->getKey())->first();
        $this->assertNotSame($code, $row->code_hash);
        $this->assertSame(64, strlen($row->code_hash));
        $this->assertSame(hash_hmac('sha256', $code, config('app.key').'|'.$row->id), $row->code_hash);
        $this->assertStringNotContainsString($code, json_encode($res->json()));
        $this->assertStringNotContainsString($code, json_encode(DB::table('authorization_change_histories')->get()));
        Log::shouldNotHaveReceived('warning');
    }

    #[Test]
    public function only_one_live_code_per_user_and_purpose_can_exist_at_the_database_level(): void
    {
        $user = $this->person();
        $row = fn () => DB::table('otp_challenges')->insert([
            'id' => (string) Str::uuid(), 'user_id' => $user->getKey(), 'purpose' => 'ACTIVATION',
            'code_hash' => str_repeat('a', 64), 'expires_at' => now()->addMinutes(5), 'created_at' => now(),
        ]);
        $row();
        $this->assertDbRejects($row);
        $this->assertDbRejects(fn () => DB::table('otp_challenges')->insert([
            'id' => (string) Str::uuid(), 'user_id' => $user->getKey(), 'purpose' => 'OTHER',
            'code_hash' => str_repeat('a', 64), 'expires_at' => now(), 'created_at' => now(),
        ]));
    }

    #[Test]
    public function input_is_validated(): void
    {
        $this->postJson('/api/auth/otp/request', [])->assertUnprocessable()->assertJsonValidationErrors(['email', 'purpose']);
        $this->postJson('/api/auth/otp/request', ['email' => 'x@example.com', 'purpose' => 'admin'])->assertUnprocessable();
        $this->verify('x@example.com', '12345')->assertUnprocessable()->assertJsonValidationErrors('otp');
        $this->verify('x@example.com', 'abcdef')->assertUnprocessable();
        $this->postJson('/api/auth/otp/verify', ['email' => 'x@example.com', 'purpose' => 'activation', 'otp' => '123456', 'password' => self::GOOD, 'password_confirmation' => 'beda'])->assertUnprocessable();
    }

    #[Test]
    public function the_endpoints_are_public_and_throttled_per_ip(): void
    {
        $this->withMiddleware(ThrottleRequests::class);
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/otp/request', ['email' => "u{$i}@example.com", 'purpose' => 'activation'])->assertStatus(202);
        }
        $this->postJson('/api/auth/otp/request', ['email' => 'late@example.com', 'purpose' => 'activation'])->assertStatus(429);
    }

    #[Test]
    public function with_no_deliverable_channel_the_request_still_answers_the_same_and_logs_a_warning_without_the_code(): void
    {
        Log::spy();
        config(['distriva_notifications.whatsapp.driver' => 'null', 'mail.default' => 'log']);
        $this->person();

        $this->request('siti@example.com')->assertStatus(202);

        Log::shouldHaveReceived('warning')->withArgs(fn (string $m, array $c) => str_contains($m, 'OTP could not be delivered') && ! preg_match('/\d{6}/', preg_replace('/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/', '', json_encode($c))))->once();
    }

    #[Test]
    public function a_successful_recovery_also_clears_the_login_throttle_so_the_user_can_sign_in_at_once(): void
    {
        $this->withMiddleware(ThrottleRequests::class);
        $this->person('ACTIVE');
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => 'salah'])->assertUnauthorized();
        }
        $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => 'salah'])->assertStatus(429);

        $this->request('siti@example.com', 'recovery')->assertStatus(202);
        $this->verify('siti@example.com', $this->sentCode(), self::GOOD, 'recovery')->assertOk();

        $this->postJson('/api/auth/login', ['email' => 'siti@example.com', 'password' => self::GOOD])->assertOk(); // not 429
    }
}
