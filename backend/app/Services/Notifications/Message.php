<?php

namespace App\Services\Notifications;

/** $sensitive = the body carries a secret (e.g. a temporary password): it must never be logged or stored. */
final readonly class Message
{
    public function __construct(
        public string $subject,
        public string $body,
        public bool $sensitive = false,
    ) {}
}
