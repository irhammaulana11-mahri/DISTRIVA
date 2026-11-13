<?php

namespace App\Services\Notifications;

final class DeliveryReport
{
    /** @param list<string> $delivered @param array<string, string> $failed channel => exception class @param array<string, string> $skipped channel => reason */
    public function __construct(
        public readonly array $delivered = [],
        public readonly array $failed = [],
        public readonly array $skipped = [],
        /** @var array<string, string> channel => safe diagnostic (only for DisplaySafe exceptions) */
        public readonly array $details = [],
    ) {}

    public function anyDelivered(): bool
    {
        return $this->delivered !== [];
    }
}
