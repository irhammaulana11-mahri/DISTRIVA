<?php

namespace App\Services\Notifications\WhatsApp;

use App\Services\Notifications\GatewayFailure;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Generic driver for HTTP WhatsApp gateways (the project owner chose an unofficial provider on 2026-11-06,
 * so the exact API is supplied by configuration instead of being hard-coded):
 *
 *  - request: POST/GET to `url` with an auth header and a body built from a JSON template whose string
 *    values may contain {phone} (62812…), {phone_local} (0812…) and {message};
 *  - success: HTTP 2xx and, if `success_path` is set, that JSON path equals `success_value`.
 *
 * Secrets (token, URL) and the response body are never put in exception messages or logs: gateways often
 * echo the message text back.
 */
class HttpWhatsAppDriver implements ChecksConfiguration, WhatsAppDriver
{
    /** @param array<string, mixed> $config */
    public function __construct(private readonly array $config) {}

    public function isConfigured(): bool
    {
        return $this->url() !== '' && $this->token() !== '' && $this->template() !== null;
    }

    public function send(string $phone, string $text): void
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('WhatsApp HTTP gateway is not configured.');
        }
        $url = $this->url();
        if (! preg_match('#^https?://[^/\s]+#i', $url)) {                  // http:// is allowed on purpose (a gateway on the own server or network); https:// is advised
            throw new RuntimeException('WhatsApp gateway URL must start with http:// or https://.');
        }

        $local = '0'.substr($phone, strlen((string) config('distriva_notifications.whatsapp.default_country_code')));
        $body = $this->fill($this->template(), ['{phone}' => $phone, '{phone_local}' => $local, '{message}' => $text]);

        $request = Http::timeout((int) ($this->config['timeout'] ?? 10))
            ->withHeaders([(string) ($this->config['auth_header'] ?? 'Authorization') => (string) ($this->config['auth_prefix'] ?? '').$this->token()])
            ->acceptJson();
        $request = ($this->config['body_format'] ?? 'form') === 'json' ? $request->asJson() : $request->asForm();

        $response = strtoupper((string) ($this->config['method'] ?? 'POST')) === 'GET'
            ? $request->get($url, $body)
            : $request->send('POST', $url, [($this->config['body_format'] ?? 'form') === 'json' ? 'json' : 'form_params' => $body]);

        if (! $response->successful()) {
            throw new GatewayFailure('WhatsApp gateway answered HTTP '.$response->status().'.'.$this->reason($response->json()));
        }

        $path = (string) ($this->config['success_path'] ?? '');
        if ($path !== '') {
            $json = $response->json();
            $actual = data_get($json, $path);
            $expected = $this->config['success_value'] ?? 'true';

            // Both sides go through the same canonical form: Laravel's env() turns "true"/"false" in .env into
            // booleans, so a plain (string) cast would turn `true` into "1" and never match JSON `true`.
            if ($actual === null || $this->canonical($actual) !== $this->canonical($expected)) {
                throw new GatewayFailure($this->mismatch($response->status(), $json, $path, $actual, $this->canonical($expected)));
            }
        }
    }

    /** true/'true'/1/'1'/'yes' -> 'true'; false/'false'/0/'0'/'no' -> 'false'; anything else lower-cased as text. */
    private function canonical(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        $text = is_scalar($value) ? strtolower(trim((string) $value)) : '';

        return match ($text) {
            '1', 'true', 'yes' => 'true',
            '0', 'false', 'no' => 'false',
            default => $text,
        };
    }

    /**
     * Diagnostic that is safe to show: the HTTP status, the success field's value reduced to a short
     * [A-Za-z0-9 _.-] token (gateways echo message text elsewhere, never in a status flag), and only the
     * NAMES of the top-level keys — never other values.
     */
    private function mismatch(int $status, mixed $json, string $path, mixed $actual, string $expected): string
    {
        if (! is_array($json)) {
            return "WhatsApp gateway reported failure: HTTP {$status}, response is not JSON (success_path '{$path}' cannot be checked).";
        }

        $found = $actual === null ? 'missing' : (is_bool($actual) ? ($actual ? 'true' : 'false') : (is_scalar($actual)
            ? "'".mb_substr(preg_replace('/[^A-Za-z0-9 _.\-]/', '?', (string) $actual) ?? '', 0, 40)."'" : gettype($actual)));
        $keys = implode(', ', array_slice(array_map(fn ($k) => preg_replace('/[^A-Za-z0-9_.\-]/', '?', (string) $k), array_keys($json)), 0, 15));

        return "WhatsApp gateway reported failure: HTTP {$status}, '{$path}' is {$found} (expected '{$expected}'); top-level keys: [{$keys}].";
    }

    /**
     * The gateway's own reason for a refusal (top-level `error` or `message`), reduced to a short [A-Za-z0-9 _.-] text with long digit runs hidden (phone numbers): enough to tell
     * "session not found" from "invalid token", never the message text or any other value.
     */
    private function reason(mixed $json): string
    {
        if (! is_array($json)) {
            return '';
        }
        foreach (['error', 'message'] as $key) {
            $v = $json[$key] ?? null;
            if (is_array($v)) {
                $v = $v['message'] ?? null;
            }
            if (is_string($v) && trim($v) !== '') {
                $clean = preg_replace('/\d{6,}/', '#', mb_substr(preg_replace('/[^A-Za-z0-9 _.\-]/', '?', $v) ?? '', 0, 80)) ?? '';

                return " Alasan gateway: '".trim($clean)."'.";
            }
        }

        return '';
    }

    private function url(): string
    {
        return trim((string) ($this->config['url'] ?? ''));
    }

    private function token(): string
    {
        return trim((string) ($this->config['token'] ?? ''));
    }

    /** @return array<string, mixed>|null */
    private function template(): ?array
    {
        $decoded = json_decode((string) ($this->config['body'] ?? ''), true);

        return is_array($decoded) && $decoded !== [] ? $decoded : null;
    }

    /**
     * Substitute placeholders in already-decoded string values, so quotes/newlines in the message
     * cannot break the JSON structure.
     *
     * @param  array<string, mixed>  $template
     * @param  array<string, string>  $values
     * @return array<string, mixed>
     */
    private function fill(array $template, array $values): array
    {
        return array_map(fn ($v) => match (true) {
            is_array($v) => $this->fill($v, $values),
            is_string($v) => strtr($v, $values),
            default => $v,
        }, $template);
    }
}
