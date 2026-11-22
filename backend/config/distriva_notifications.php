<?php

use App\Services\Notifications\WhatsApp\HttpWhatsAppDriver;
use App\Services\Notifications\WhatsApp\LogWhatsAppDriver;
use App\Services\Notifications\WhatsApp\NullWhatsAppDriver;

/*
 * Notification channels (docs/54 D-7, decided 2026-11-06): e-mail AND WhatsApp, whichever are available.
 * A message is sent on every configured channel that is available for the recipient; one channel failing
 * never blocks the other; the send succeeds if at least one channel delivered.
 *
 * E-mail uses Laravel's mailer (set MAIL_* in .env; any SMTP/API provider works).
 * WhatsApp needs a provider driver. No provider has been chosen yet, so only 'log' (development, never
 * writes the message text) and 'null' exist. Add a driver class implementing WhatsAppDriver and register it
 * under 'whatsapp.drivers' once a provider is selected.
 */
return [
    'channels' => array_values(array_filter(array_map('trim', explode(',', (string) env('DISTRIVA_NOTIFY_CHANNELS', 'mail,whatsapp'))))),

    'whatsapp' => [
        'driver' => env('DISTRIVA_WHATSAPP_DRIVER', 'null'),
        'drivers' => [
            'null' => NullWhatsAppDriver::class,
            'log' => LogWhatsAppDriver::class,
            'http' => HttpWhatsAppDriver::class,
        ],
        // Settings for driver "http" (unofficial gateway chosen by the owner, 2026-11-06). Everything comes from
        // the provider's own documentation; nothing here is assumed. Put the token ONLY in .env.
        'http' => [
            'url' => env('DISTRIVA_WHATSAPP_URL'),                         // https://… send endpoint
            'method' => env('DISTRIVA_WHATSAPP_METHOD', 'POST'),
            'auth_header' => env('DISTRIVA_WHATSAPP_AUTH_HEADER', 'Authorization'),
            'auth_prefix' => env('DISTRIVA_WHATSAPP_AUTH_PREFIX', ''),     // e.g. "Bearer " (note the space)
            'token' => env('DISTRIVA_WHATSAPP_TOKEN'),
            'body_format' => env('DISTRIVA_WHATSAPP_BODY_FORMAT', 'form'), // form | json
            // JSON template; placeholders {phone} (62812…), {phone_local} (0812…), {message}
            'session_id' => env('DISTRIVA_WHATSAPP_SESSION_ID'),           // gateway session, available as {session_id} in the body template
            'body' => env('DISTRIVA_WHATSAPP_BODY'),                       // e.g. {"target":"{phone}","message":"{message}"}
            'success_path' => env('DISTRIVA_WHATSAPP_SUCCESS_PATH'),       // optional JSON path, e.g. "status"
            'success_value' => env('DISTRIVA_WHATSAPP_SUCCESS_VALUE', 'true'),
            'timeout' => (int) env('DISTRIVA_WHATSAPP_TIMEOUT', 10),
        ],
        // Default country code used to turn local numbers (08xx…) into international form (62 8xx…).
        'default_country_code' => env('DISTRIVA_WHATSAPP_COUNTRY_CODE', '62'),
    ],
];
