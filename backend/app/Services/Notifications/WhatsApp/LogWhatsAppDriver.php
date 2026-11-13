<?php

namespace App\Services\Notifications\WhatsApp;

use Illuminate\Support\Facades\Log;

/** Development driver. Records that a message would have been sent; never writes the number or the text. */
class LogWhatsAppDriver implements WhatsAppDriver
{
    public function send(string $phone, string $text): void
    {
        Log::info('WhatsApp (log driver): message accepted.', ['length' => mb_strlen($text)]);
    }
}
