<?php

namespace App\Services\Notifications\WhatsApp;

interface WhatsAppDriver
{
    /**
     * @param  string  $phone  digits only, international form (no "+")
     *
     * @throws \Throwable on failure
     */
    public function send(string $phone, string $text): void;
}
