<?php

namespace App\Services\Notifications\WhatsApp;

/** Placeholder until a provider is chosen: nothing is delivered, and the channel reports itself unavailable. */
class NullWhatsAppDriver implements WhatsAppDriver
{
    public function send(string $phone, string $text): void
    {
        throw new \RuntimeException('No WhatsApp provider configured.');
    }
}
