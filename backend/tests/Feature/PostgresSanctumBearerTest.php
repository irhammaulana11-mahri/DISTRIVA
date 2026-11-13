<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class PostgresSanctumBearerTest extends PostgresTestCase
{
    #[Test]
    public function a_persisted_uuid_user_can_authenticate_with_a_bearer_token(): void
    {
        $user = $this->makeUser();
        $token = $user->createToken('e2e')->plainTextToken;

        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $user->getKey());
        $this->assertDatabaseHas('personal_access_tokens', ['tokenable_id' => $user->getKey()]);

        $this->withToken($token)->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.id', $user->getKey())
            ->assertJsonMissingPath('user.password');
    }

    #[Test]
    public function missing_invalid_and_revoked_tokens_are_rejected(): void
    {
        $user = $this->makeUser();
        $token = $user->createToken('e2e')->plainTextToken;

        $this->getJson('/api/me')->assertUnauthorized();
        $this->withToken('invalid|token')->getJson('/api/me')->assertUnauthorized();

        $user->tokens()->delete();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
    }
}
