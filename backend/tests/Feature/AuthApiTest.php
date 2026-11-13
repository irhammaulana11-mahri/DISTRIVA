<?php

namespace Tests\Feature;

use Laravel\Sanctum\PersonalAccessToken;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class AuthApiTest extends PostgresTestCase
{
    private function userWithPassword(string $status = 'ACTIVE')
    {
        return $this->makeUser($status, 'Login.User@Example.com');
    }

    #[Test]
    public function login_returns_a_bearer_token_that_works_for_me_and_logout_revokes_it(): void
    {
        $user = $this->userWithPassword();

        $res = $this->postJson('/api/auth/login', ['email' => 'LOGIN.user@example.com', 'password' => 'secret-password'])
            ->assertOk()
            ->assertJsonPath('user.id', $user->getKey())
            ->assertJsonMissingPath('user.password');
        $token = $res->json('token');
        $this->assertNotNull($user->fresh()->last_login_at);

        $this->withToken($token)->getJson('/api/me')->assertOk()->assertJsonPath('user.email', 'login.user@example.com');

        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
    }

    #[Test]
    public function bad_credentials_unknown_user_and_inactive_accounts_get_the_same_401(): void
    {
        $this->userWithPassword();
        $this->makeUser('SUSPENDED', 'suspended@example.com');
        $this->makeUser('PENDING_ACTIVATION', 'pending@example.com');

        $bodies = [
            $this->postJson('/api/auth/login', ['email' => 'login.user@example.com', 'password' => 'wrong'])->assertUnauthorized()->json(),
            $this->postJson('/api/auth/login', ['email' => 'nobody@example.com', 'password' => 'secret-password'])->assertUnauthorized()->json(),
            $this->postJson('/api/auth/login', ['email' => 'suspended@example.com', 'password' => 'secret-password'])->assertUnauthorized()->json(),
            $this->postJson('/api/auth/login', ['email' => 'pending@example.com', 'password' => 'secret-password'])->assertUnauthorized()->json(),
        ];
        $this->assertCount(1, array_unique(array_map('json_encode', $bodies)));
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    #[Test]
    public function validation_errors_and_guest_access_are_rejected(): void
    {
        $this->postJson('/api/auth/login', [])->assertUnprocessable()->assertJsonValidationErrors(['email', 'password']);
        $this->getJson('/api/me')->assertUnauthorized();
        $this->postJson('/api/auth/logout')->assertUnauthorized();
    }

    #[Test]
    public function an_existing_token_stops_working_when_the_account_is_suspended(): void
    {
        $user = $this->userWithPassword();
        $token = $user->createToken('t')->plainTextToken;
        $user->update(['account_status' => 'SUSPENDED']);

        $this->withToken($token)->getJson('/api/me')->assertForbidden();
    }

    #[Test]
    public function login_is_throttled(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'x@example.com', 'password' => 'bad'])->assertUnauthorized();
        }
        $this->postJson('/api/auth/login', ['email' => 'x@example.com', 'password' => 'bad'])->assertStatus(429);
    }

    #[Test]
    public function login_tokens_expire_after_the_idle_timeout_and_slide_on_use(): void
    {
        $this->userWithPassword();
        $token = $this->postJson('/api/auth/login', ['email' => 'login.user@example.com', 'password' => 'secret-password'])->json('token');

        $row = PersonalAccessToken::query()->firstOrFail();
        $this->assertEqualsWithDelta(30 * 60, now()->diffInSeconds($row->expires_at, true), 5);

        // Used 20 minutes later: still valid, and the expiry slides to 30 minutes from that moment.
        $this->travel(20)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertOk();
        $this->assertEqualsWithDelta(30 * 60, now()->diffInSeconds($row->fresh()->expires_at, true), 5);

        // Idle for 31 minutes: rejected.
        $this->travel(31)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
    }

    #[Test]
    public function login_otp_and_password_routes_do_not_share_one_rate_limit_counter(): void
    {
        // Regression: unnamed throttle middleware used one counter per IP for every route, so an activation
        // (OTP request + verify) followed by a login within a minute was answered with 429.
        $user = $this->userWithPassword();
        for ($i = 0; $i < 4; $i++) {
            $this->postJson('/api/auth/otp/request', ['email' => "u{$i}@example.com", 'purpose' => 'activation'])->assertStatus(202);
            $this->postJson('/api/auth/otp/verify', ['email' => "u{$i}@example.com", 'purpose' => 'activation', 'otp' => '123456', 'password' => 'Kunci-Baru#2026b', 'password_confirmation' => 'Kunci-Baru#2026b'])->assertStatus(422);
        }
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk();
    }

    #[Test]
    public function failed_logins_for_one_address_do_not_lock_another_address_on_the_same_ip(): void
    {
        $other = $this->makeUser('ACTIVE', 'rekan@example.com');
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'korban@example.com', 'password' => 'x'])->assertUnauthorized();
        }
        $this->postJson('/api/auth/login', ['email' => 'korban@example.com', 'password' => 'x'])->assertStatus(429);

        $this->postJson('/api/auth/login', ['email' => $other->email, 'password' => 'secret-password'])->assertOk(); // same IP, other address
    }

    #[Test]
    public function the_otp_verify_limit_is_per_address_and_ip(): void
    {
        $payload = fn (string $e) => ['email' => $e, 'purpose' => 'activation', 'otp' => '123456', 'password' => 'Kunci-Baru#2026b', 'password_confirmation' => 'Kunci-Baru#2026b'];
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/auth/otp/verify', $payload('a@example.com'))->assertStatus(422);
        }
        $this->postJson('/api/auth/otp/verify', $payload('a@example.com'))->assertStatus(429);
        $this->postJson('/api/auth/otp/verify', $payload('b@example.com'))->assertStatus(422); // not blocked
    }
}
