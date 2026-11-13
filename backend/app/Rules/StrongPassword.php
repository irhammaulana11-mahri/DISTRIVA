<?php

namespace App\Rules;

use App\Models\User;
use App\Services\PasswordPolicy;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/** Doc 16 password policy as a validation rule. All violations are reported, in Indonesian. */
class StrongPassword implements ValidationRule
{
    public function __construct(private readonly ?User $user = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('Password tidak valid.');

            return;
        }

        foreach (app(PasswordPolicy::class)->violations($value, $this->user) as $message) {
            $fail($message);
        }
    }
}
