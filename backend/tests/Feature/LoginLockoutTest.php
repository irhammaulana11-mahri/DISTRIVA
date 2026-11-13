<?php

namespace Tests\Feature;

use App\Services\Authorization\AccountStatusService;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class LoginLockoutTest extends PostgresTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // The per-IP throttle is covered in AuthApiTest; here the per-account lockout is under test.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function attempt(string $email, string $password)
    {
        return $this->postJson('/api/auth/login', ['email' => $email, 'password' => $password]);
    }

    private function failFiveTimes(string $email): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->attempt($email, 'wrong')->assertUnauthorized();
        }
    }

    #[Test]
    public function five_failures_lock_the_account_for_fifteen_minutes_even_for_the_correct_password(): void
    {
        $user = $this->makeUser();
        $this->failFiveTimes($user->email);

        $this->assertEqualsWithDelta(15 * 60, now()->diffInSeconds($user->fresh()->locked_until, true), 5);
        $this->attempt($user->email, 'secret-password')->assertUnauthorized();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    #[Test]
    public function four_failures_do_not_lock_and_a_success_resets_the_counter(): void
    {
        $user = $this->makeUser();
        for ($i = 0; $i < 4; $i++) {
            $this->attempt($user->email, 'wrong')->assertUnauthorized();
        }
        $this->assertSame(4, $user->fresh()->failed_login_attempts);

        $this->attempt($user->email, 'secret-password')->assertOk();
        $fresh = $user->fresh();
        $this->assertSame(0, $fresh->failed_login_attempts);
        $this->assertNull($fresh->locked_until);

        // After the reset, four more failures still do not lock.
        for ($i = 0; $i < 4; $i++) {
            $this->attempt($user->email, 'wrong')->assertUnauthorized();
        }
        $this->assertNull($user->fresh()->locked_until);
    }

    #[Test]
    public function the_lock_expires_after_fifteen_minutes(): void
    {
        $user = $this->makeUser();
        $this->failFiveTimes($user->email);

        $this->travel(14)->minutes();
        $this->attempt($user->email, 'secret-password')->assertUnauthorized();

        $this->travel(2)->minutes();
        $this->attempt($user->email, 'secret-password')->assertOk();
        $this->assertNull($user->fresh()->locked_until);
    }

    #[Test]
    public function attempts_during_the_lock_do_not_extend_it(): void
    {
        $user = $this->makeUser();
        $this->failFiveTimes($user->email);
        $until = $user->fresh()->locked_until;

        $this->travel(5)->minutes();
        $this->attempt($user->email, 'wrong')->assertUnauthorized();
        $this->assertTrue($until->equalTo($user->fresh()->locked_until));
    }

    #[Test]
    public function a_locked_account_is_indistinguishable_from_an_unknown_one(): void
    {
        $user = $this->makeUser();
        $this->failFiveTimes($user->email);

        $locked = $this->attempt($user->email, 'secret-password');
        $unknown = $this->attempt('nobody@example.com', 'secret-password');
        $this->assertSame($unknown->getStatusCode(), $locked->getStatusCode());
        $this->assertSame($unknown->json(), $locked->json());
    }

    #[Test]
    public function lockouts_are_per_account(): void
    {
        $a = $this->makeUser();
        $b = $this->makeUser();
        $this->failFiveTimes($a->email);

        $this->attempt($b->email, 'secret-password')->assertOk();
    }

    #[Test]
    public function an_admin_status_change_clears_the_lock(): void
    {
        $user = $this->makeUser();
        $admin = $this->makeUser();
        $this->failFiveTimes($user->email);

        $svc = $this->app->make(AccountStatusService::class);
        $svc->change($user, 'SUSPENDED', 'tinjau', $admin);
        $svc->change($user->fresh(), 'ACTIVE', 'selesai tinjau', $admin);

        $fresh = $user->fresh();
        $this->assertNull($fresh->locked_until);
        $this->assertSame(0, $fresh->failed_login_attempts);
        $this->attempt($user->email, 'secret-password')->assertOk();
    }

    #[Test]
    public function non_active_accounts_with_the_right_password_are_not_counted_as_failures(): void
    {
        $user = $this->makeUser('SUSPENDED');
        for ($i = 0; $i < 6; $i++) {
            $this->attempt($user->email, 'secret-password')->assertUnauthorized();
        }
        $this->assertSame(0, $user->fresh()->failed_login_attempts);
        $this->assertNull($user->fresh()->locked_until);
    }

    #[Test]
    public function the_database_rejects_a_negative_attempt_counter(): void
    {
        $user = $this->makeUser();
        $this->assertDbRejects(fn () => DB::table('users')->where('id', $user->getKey())->update(['failed_login_attempts' => -1]));
    }
}
