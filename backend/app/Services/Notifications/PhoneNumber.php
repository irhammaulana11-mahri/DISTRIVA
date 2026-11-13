<?php

namespace App\Services\Notifications;

final class PhoneNumber
{
    /** Normalize to digits-only international form (e.g. 0812-3456-789 -> 628123456789); null if implausible. */
    public static function normalize(?string $raw, string $countryCode = '62'): ?string
    {
        if ($raw === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        if (str_starts_with(trim($raw), '+')) {
            // already international
        } elseif (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        } elseif (str_starts_with($digits, '0')) {
            $digits = $countryCode.substr($digits, 1);
        } elseif (! str_starts_with($digits, $countryCode)) {
            $digits = $countryCode.$digits;
        }

        return preg_match('/^[1-9]\d{8,14}$/', $digits) ? $digits : null;
    }
}
