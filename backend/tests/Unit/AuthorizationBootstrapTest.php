<?php

namespace Tests\Unit;

use App\Models\Role;
use App\Models\User;
use PHPUnit\Framework\Attributes\Test;
use Spatie\Permission\Traits\HasRoles;
use Tests\TestCase;

class AuthorizationBootstrapTest extends TestCase
{
    #[Test]
    public function user_email_is_normalized_to_lowercase(): void
    {
        $user = new User(['email' => '  Example.User@Example.COM  ']);

        $this->assertSame('example.user@example.com', $user->email);
    }

    #[Test]
    public function user_keys_are_uuid_compatible(): void
    {
        $user = new User;

        $this->assertSame('string', $user->getKeyType());
        $this->assertFalse($user->getIncrementing());
    }

    #[Test]
    public function spatie_is_configured_as_catalog_only(): void
    {
        $userTraits = class_uses_recursive(User::class);

        $this->assertArrayNotHasKey(HasRoles::class, $userTraits);
        $this->assertFalse(config('permission.register_permission_check_method'));
        $this->assertFalse(config('permission.teams'));
        $this->assertSame(Role::class, config('permission.models.role'));
        $this->assertSame('web', config('distriva.authorization_guard'));
    }
}
