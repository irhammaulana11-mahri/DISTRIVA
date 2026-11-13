<?php

namespace Tests\Feature;

use App\Models\User;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class SanctumUuidAuthenticationTest extends TestCase
{
    #[Test]
    public function a_guest_cannot_access_the_authenticated_user_endpoint(): void
    {
        $this->getJson('/api/me')->assertUnauthorized();
    }

    #[Test]
    public function a_user_on_the_sanctum_guard_can_access_the_uuid_user_endpoint(): void
    {
        $user = new User;
        $user->setRawAttributes([
            'id' => '7c0d9eb4-7443-4712-9ec2-45cc4fa0c966',
            'account_status' => 'ACTIVE',
        ], true);
        $user->exists = true;

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.id', $user->getKey());
    }
}
