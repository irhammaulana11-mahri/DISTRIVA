<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Services\Authorization\ScopedAuthorizationService;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['nip', 'name', 'position', 'email', 'phone', 'password', 'account_status', 'must_change_password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuids, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'locked_until' => 'datetime',
            'password_expires_at' => 'datetime',
            'failed_login_attempts' => 'integer',
            'must_change_password' => 'boolean',
            'password' => 'hashed',
        ];
    }

    protected function email(): Attribute
    {
        return Attribute::make(
            set: static fn (string $value): string => Str::lower(trim($value)),
        );
    }

    public function roleAssignments(): HasMany
    {
        return $this->hasMany(UserRoleAssignment::class);
    }

    public function isSysAdmin(): bool
    {
        if ($this->relationLoaded('roleAssignments')) {
            $hasSysAdmin = $this->roleAssignments
                ->where('is_active', true)
                ->contains(fn ($a) => ($a->role?->name ?? null) === 'SYS_ADMIN' || ($a->role_name ?? null) === 'SYS_ADMIN');
            if ($hasSysAdmin) {
                return true;
            }
        }

        try {
            return app(ScopedAuthorizationService::class)
                ->effectiveAssignments($this)
                ->contains(fn ($a) => $a->role?->name === 'SYS_ADMIN');
        } catch (\Throwable) {
            return false;
        }
    }
}
