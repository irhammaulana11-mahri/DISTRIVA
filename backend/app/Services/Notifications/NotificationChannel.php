<?php

namespace App\Services\Notifications;

interface NotificationChannel
{
    /** Short stable id, e.g. "mail" or "whatsapp". */
    public function name(): string;

    /** Null when the channel can deliver to this recipient; otherwise a short reason (no secrets). */
    public function unavailableReason(Recipient $recipient): ?string;

    /** @throws \Throwable on any delivery failure */
    public function send(Recipient $recipient, Message $message): void;
}
