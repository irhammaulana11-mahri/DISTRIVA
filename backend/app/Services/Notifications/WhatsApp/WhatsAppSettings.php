<?php

namespace App\Services\Notifications\WhatsApp;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Notifications\GatewayFailure;
use App\Services\Notifications\PhoneNumber;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * WhatsApp gateway settings of the menu Pengaturan. Until the first save there is no row and the .env values (config/distriva_notifications.php) stay in force; after it the saved row
 * replaces them as a whole (one source, never a mix). The token is encrypted at rest, never returned and never written to the trail; the URL and responses are not logged either.
 */
class WhatsAppSettings
{
    /** The fields that are plain values (token apart). */
    private const FIELDS = ['driver', 'url', 'method', 'auth_header', 'auth_prefix', 'body_format', 'body', 'success_path', 'success_value', 'timeout', 'default_country_code', 'session_id'];

    public function row(): ?object
    {
        try {
            return DB::table('whatsapp_settings')->where('id', 1)->first();
        } catch (Throwable) {
            return null;                                               // table missing (before the migration) or no connection: the .env values stay
        }
    }

    /** Puts the saved row into config() so every consumer (driver, channel, commands) reads one place. Idempotent. */
    public function applyToConfig(): void
    {
        $r = $this->row();
        if ($r === null) {
            return;
        }
        config([
            'distriva_notifications.whatsapp.driver' => $r->driver,
            'distriva_notifications.whatsapp.default_country_code' => $r->default_country_code,
            'distriva_notifications.whatsapp.http' => [
                'url' => $r->url, 'method' => $r->method, 'auth_header' => $r->auth_header, 'auth_prefix' => $r->auth_prefix, 'token' => $this->token($r),
                'body_format' => $r->body_format, 'body' => $r->body, 'session_id' => $r->session_id, 'success_path' => $r->success_path, 'success_value' => $r->success_value, 'timeout' => (int) $r->timeout,
            ],
        ]);
    }

    /** @return array<string,mixed> what the page shows: no secret, only whether a token exists and where the values come from */
    public function show(): array
    {
        $r = $this->row();
        if ($r === null) {
            $c = (array) config('distriva_notifications.whatsapp.http');

            return ['source' => 'ENV', 'driver' => (string) config('distriva_notifications.whatsapp.driver'), 'url' => (string) ($c['url'] ?? ''), 'method' => (string) ($c['method'] ?? 'POST'),
                'auth_header' => (string) ($c['auth_header'] ?? 'Authorization'), 'auth_prefix' => (string) ($c['auth_prefix'] ?? ''), 'has_token' => filled($c['token'] ?? null),
                'body_format' => (string) ($c['body_format'] ?? 'form'), 'body' => (string) ($c['body'] ?? ''), 'session_id' => (string) ($c['session_id'] ?? ''), 'success_path' => (string) ($c['success_path'] ?? ''),
                'success_value' => (string) ($c['success_value'] ?? 'true'), 'timeout' => (int) ($c['timeout'] ?? 10), 'default_country_code' => (string) config('distriva_notifications.whatsapp.default_country_code'),
                'updated_at' => null, 'updated_by_email' => null];
        }
        $by = $r->updated_by === null ? null : DB::table('users')->where('id', $r->updated_by)->value('email');

        return ['source' => 'WEB'] + collect(self::FIELDS)->mapWithKeys(fn ($f) => [$f => $f === 'timeout' ? (int) $r->$f : (string) ($r->$f ?? '')])->all()
            + ['has_token' => $r->token_encrypted !== null, 'updated_at' => $r->updated_at, 'updated_by_email' => $by];
    }

    /**
     * @param  array<string,mixed>  $d  the fields; token? (empty keeps the saved one), clear_token? (removes it)
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor): array
    {
        $current = $this->row();
        $before = $current === null ? [] : collect(self::FIELDS)->mapWithKeys(fn ($f) => [$f => (string) ($current->$f ?? '')])->all();
        $token = $current?->token_encrypted;
        if (! empty($d['clear_token'])) {
            $token = null;
        } elseif (filled($d['token'] ?? null)) {
            $token = Crypt::encryptString(trim((string) $d['token']));
        } elseif ($current === null) {
            $env = config('distriva_notifications.whatsapp.http.token');
            $token = filled($env) ? Crypt::encryptString((string) $env) : null;       // the first save keeps working with the token that .env already holds
        }
        $values = collect(self::FIELDS)->mapWithKeys(fn ($f) => [$f => $f === 'timeout' ? (int) $d[$f] : (string) ($d[$f] ?? '')])->all();
        // The request trims spaces at the end of every input, which would turn the prefix "Bearer " into "Bearer" and the header into "Bearer<token>" (HTTP 401): a word prefix gets its space back.
        if ($values['auth_prefix'] !== '' && ctype_alnum(substr($values['auth_prefix'], -1))) {
            $values['auth_prefix'] .= ' ';
        }
        if ($values['driver'] === 'http') {
            $this->assertUsable($values, $token !== null);
        }
        foreach (['url', 'success_path', 'session_id'] as $f) {
            $values[$f] = $values[$f] === '' ? null : $values[$f];
        }
        $values['body'] = $values['body'] === '' ? null : $values['body'];

        DB::transaction(function () use ($values, $token, $actor, $before, $current): void {
            $row = $values + ['token_encrypted' => $token, 'updated_by' => $actor->getKey(), 'updated_at' => now()];
            $current === null ? DB::table('whatsapp_settings')->insert(['id' => 1] + $row) : DB::table('whatsapp_settings')->where('id', 1)->update($row);
            $changed = array_keys(array_filter($values, fn ($v, $k) => ($before[$k] ?? null) !== (string) ($v ?? ''), ARRAY_FILTER_USE_BOTH));
            $this->event('SETTINGS_CHANGED', $actor, ['changed_fields' => $changed, 'token_changed' => ($current?->token_encrypted) !== $token, 'first_save' => $current === null]);
        });

        return $this->show();
    }

    /** @return array<string,mixed> */
    public function sendTest(string $phone, User $actor): array
    {
        $this->applyToConfig();
        $code = (string) config('distriva_notifications.whatsapp.default_country_code');
        $normal = PhoneNumber::normalize($phone, $code);
        if ($normal === null) {
            throw new AssignmentRuleViolation('Nomor WhatsApp tidak valid.');
        }
        $driver = app(WhatsAppDriver::class);
        if ($driver instanceof NullWhatsAppDriver) {
            throw new AssignmentRuleViolation('Pengirim WhatsApp dimatikan (driver "null"); pilih driver http untuk menguji.');
        }
        if ($driver instanceof ChecksConfiguration && ! $driver->isConfigured()) {
            throw new AssignmentRuleViolation('Pengaturan belum lengkap: alamat, token, dan isi permintaan wajib diisi.');
        }
        try {
            $driver->send($normal, 'Uji sambungan WhatsApp DISTRIVA. Abaikan pesan ini.');
        } catch (GatewayFailure $e) {
            $this->event('TEST_FAILED', $actor, ['reason' => 'gateway']);
            throw new AssignmentRuleViolation('Gateway menolak: '.$e->getMessage());
        } catch (Throwable) {
            $this->event('TEST_FAILED', $actor, ['reason' => 'connection']);
            throw new AssignmentRuleViolation('Tidak dapat menghubungi gateway; periksa alamat, jaringan, dan token.');
        }
        $this->event('TEST_SENT', $actor, []);

        return ['status' => 'OK', 'message' => 'Pesan uji dikirim; periksa WhatsApp penerima.'];
    }

    /** @return list<array<string,mixed>> */
    public function events(int $limit = 20): array
    {
        return DB::table('whatsapp_setting_events as e')->leftJoin('users as u', 'u.id', '=', 'e.actor_user_id')->orderByDesc('e.occurred_at')->limit($limit)
            ->get(['e.event_type', 'e.details', 'e.occurred_at', 'u.email as actor_email'])->map(fn ($e) => ['event_type' => $e->event_type, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all();
    }

    /** @param array<string,mixed> $v */
    private function assertUsable(array $v, bool $hasToken): void
    {
        $url = trim((string) $v['url']);
        if (! preg_match('#^https?://[^/\s]+#i', $url)) {
            throw new AssignmentRuleViolation('Alamat gateway wajib diisi dan harus diawali http:// atau https://.');
        }
        if (! $hasToken) {
            throw new AssignmentRuleViolation('Token API wajib diisi untuk driver http.');
        }
        $tpl = json_decode((string) $v['body'], true);
        if (! is_array($tpl) || $tpl === []) {
            throw new AssignmentRuleViolation('Isi permintaan harus berupa JSON objek, mis. {"target":"{phone}","message":"{message}"}.');
        }
        $flat = json_encode($tpl);
        if (str_contains((string) $flat, '{session_id}') && trim((string) ($v['session_id'] ?? '')) === '') {
            throw new AssignmentRuleViolation('Isi permintaan memakai {session_id}; isi kolom Session ID.');
        }
        foreach (['{phone}', '{message}'] as $needed) {
            if (! str_contains((string) $flat, $needed) && ! ($needed === '{phone}' && str_contains((string) $flat, '{phone_local}'))) {
                throw new AssignmentRuleViolation("Isi permintaan harus memuat {$needed}.");
            }
        }
    }

    private function token(object $r): ?string
    {
        try {
            return $r->token_encrypted === null ? null : Crypt::decryptString($r->token_encrypted);
        } catch (Throwable) {
            return null;                                               // an APP_KEY that changed: treated as no token, never shown
        }
    }

    /** @param array<string,mixed> $details */
    private function event(string $type, User $actor, array $details): void
    {
        DB::table('whatsapp_setting_events')->insert(['id' => (string) Str::uuid(), 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'details' => json_encode((object) $details), 'occurred_at' => now()]);
    }
}
