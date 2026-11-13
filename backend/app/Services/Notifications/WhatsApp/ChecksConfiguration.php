<?php

namespace App\Services\Notifications\WhatsApp;

/** Optional: a driver that can tell whether it is fully configured (otherwise the channel is skipped). */
interface ChecksConfiguration
{
    public function isConfigured(): bool;
}
