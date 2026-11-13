<?php

namespace App\Services\Notifications;

final readonly class Recipient
{
    public function __construct(
        public string $name,
        public ?string $email = null,
        public ?string $phone = null,
    ) {}
}
