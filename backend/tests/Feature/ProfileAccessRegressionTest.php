<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class ProfileAccessRegressionTest extends PostgresTestCase
{
    /** @return array<string, array{0: string}> */
    public static function nonActiveStatuses(): array
    {
        return ['suspended' => ['SUSPENDED'], 'inactive' => ['INACTIVE'], 'pending' => ['PENDING_ACTIVATION']];
    }

    #[Test]
    #[DataProvider('nonActiveStatuses')]
    public function a_token_of_a_non_active_account_cannot_reach_any_protected_route(string $status): void
    {
        $user = $this->makeUser();
        $token = $user->createToken('t')->plainTextToken;
        $user->forceFill(['account_status' => $status])->save();

        $this->withToken($token)->getJson('/api/me')->assertForbidden();
        $this->withToken($token)->postJson('/api/auth/logout')->assertForbidden();
        $this->withToken($token)->postJson('/api/me/password', [])->assertForbidden();
        $this->withToken($token)->getJson('/api/user')->assertNotFound();
    }

    #[Test]
    public function the_legacy_user_route_no_longer_exists(): void
    {
        $user = $this->makeUser();
        $this->withToken($user->createToken('t')->plainTextToken)->getJson('/api/user')->assertNotFound();
    }

    #[Test]
    public function the_profile_response_is_an_exact_allowlist(): void
    {
        $user = $this->makeUser();
        $res = $this->withToken($user->createToken('t')->plainTextToken)->getJson('/api/me')->assertOk();

        $this->assertEqualsCanonicalizing(
            ['id', 'nip', 'name', 'email', 'phone', 'account_status', 'must_change_password'],
            array_keys($res->json('user')),
        );
        $this->assertStringNotContainsString('"password":', json_encode($res->json()));
        $this->assertStringNotContainsString('remember_token', json_encode($res->json()));
    }

    #[Test]
    public function the_login_response_never_contains_password_material(): void
    {
        $user = $this->makeUser();
        $json = json_encode($this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'secret-password'])->assertOk()->json());

        $this->assertStringNotContainsString($user->password, $json);
        $this->assertStringNotContainsString('remember_token', $json);
    }
}
