<?php

namespace App\Services\Notifications;

use App\Services\Notifications\WhatsApp\ChecksConfiguration;
use App\Services\Notifications\WhatsApp\NullWhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppDriver;

class WhatsAppChannel implements NotificationChannel
{
    public function __construct(
        private readonly WhatsAppDriver $driver,
        private readonly string $countryCode = '62',
    ) {}

    public function name(): string
    {
        return 'whatsapp';
    }

    public function unavailableReason(Recipient $recipient): ?string
    {
        if ($this->driver instanceof NullWhatsAppDriver) {
            return 'no_provider_configured';
        }

        if ($this->driver instanceof ChecksConfiguration && ! $this->driver->isConfigured()) {
            return 'provider_not_configured';
        }

        return PhoneNumber::normalize($recipient->phone, $this->countryCode) === null ? 'no_valid_phone' : null;
    }

    public function send(Recipient $recipient, Message $message): void
    {
        $phone = PhoneNumber::normalize($recipient->phone, $this->countryCode);
        $this->driver->send((string) $phone, $message->subject."\n\n".$message->body);
    }
}
