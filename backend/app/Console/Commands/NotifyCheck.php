<?php

namespace App\Console\Commands;

use App\Services\Notifications\WhatsApp\WhatsAppSettings;
use Illuminate\Console\Command;

/**
 * Static readiness check of the notification settings. It NEVER connects to a mail server or a gateway and
 * never sends anything; secrets are reported only as "terisi"/"kosong".
 */
class NotifyCheck extends Command
{
    protected $signature = 'distriva:notify-check';

    protected $description = 'Check e-mail and WhatsApp settings for completeness without sending or connecting.';

    public function handle(): int
    {
        app(WhatsAppSettings::class)->applyToConfig();   // the settings saved in the menu Pengaturan replace .env

        $channels = (array) config('distriva_notifications.channels');
        $this->line('Kanal aktif (DISTRIVA_NOTIFY_CHANNELS): '.($channels === [] ? '(kosong)' : implode(', ', $channels)));

        $ready = [];

        foreach (['mail' => ['Email', fn () => $this->mail()], 'whatsapp' => ['WhatsApp', fn () => $this->whatsapp()]] as $key => [$label, $inspect]) {
            $this->newLine();
            if (! in_array($key, $channels, true)) {
                $this->line("{$label}: dinonaktifkan (tidak ada di DISTRIVA_NOTIFY_CHANNELS).");

                continue;
            }

            $problems = $inspect(); // prints the current values, returns the list of problems
            if ($problems === []) {
                $this->info("{$label}: konfigurasi lengkap.");
                $ready[] = $key;

                continue;
            }
            $this->error("{$label}: BELUM SIAP");
            foreach ($problems as $p) {
                $this->line("  - {$p}");
            }
        }

        $this->newLine();
        if ($ready === []) {
            $this->error('Tidak ada kanal yang siap: pembuatan pengguna dan kirim ulang kredensial akan ditolak (HTTP 503).');

            return self::FAILURE;
        }
        $this->info('Kanal siap: '.implode(', ', $ready).'. (Pengecekan statis; belum membuktikan pengiriman berhasil — gunakan distriva:notify-test.)');

        return self::SUCCESS;
    }

    /** @return list<string> */
    private function mail(): array
    {
        $mailer = (string) config('mail.default');
        $p = [];
        $this->line('Email — MAIL_MAILER = '.($mailer === '' ? '(kosong)' : $mailer));

        if (in_array($mailer, ['', 'log', 'array'], true)) {
            return ["MAIL_MAILER={$mailer}: mailer ini tidak mengirim email sungguhan. Isi MAIL_MAILER=smtp (atau mailer lain yang Anda pakai)."];
        }
        if ($mailer !== 'smtp') {
            return ["Mailer '{$mailer}' tidak diperiksa oleh perintah ini; pastikan kredensial penyedianya terisi (lihat docs/56)."];
        }

        $m = (array) config('mail.mailers.smtp');
        $host = trim((string) ($m['host'] ?? ''));
        $port = (int) ($m['port'] ?? 0);
        $scheme = $m['scheme'] ?? null;
        $this->line('        MAIL_HOST = '.($host ?: '(kosong)').' | MAIL_PORT = '.($port ?: '(kosong)').' | MAIL_SCHEME = '.($scheme ?: '(kosong)'));
        $this->line('        MAIL_USERNAME = '.(filled($m['username'] ?? null) ? 'terisi' : 'kosong').' | MAIL_PASSWORD = '.(filled($m['password'] ?? null) ? 'terisi' : 'kosong'));

        if ($host === '' || in_array($host, ['127.0.0.1', 'localhost'], true)) {
            $p[] = 'MAIL_HOST belum diisi dengan server SMTP penyedia (nilai saat ini kosong/lokal).';
        }
        if ($port < 1 || $port > 65535) {
            $p[] = 'MAIL_PORT tidak valid (umumnya 587 atau 465).';
        } elseif ($port === 2525 && in_array($host, ['127.0.0.1', 'localhost'], true)) {
            $p[] = 'MAIL_PORT=2525 adalah nilai contoh bawaan.';
        }
        if ($port === 465 && $scheme !== 'smtps') {
            $p[] = 'Port 465 biasanya memerlukan MAIL_SCHEME=smtps (TLS langsung).';
        }
        if ($port === 587 && $scheme === 'smtps') {
            $p[] = 'Port 587 biasanya memakai STARTTLS: kosongkan MAIL_SCHEME (smtps untuk port 465).';
        }
        if (blank($m['username'] ?? null) || blank($m['password'] ?? null)) {
            $p[] = 'MAIL_USERNAME / MAIL_PASSWORD kosong (sebagian besar penyedia mewajibkan autentikasi).';
        }

        $from = trim((string) config('mail.from.address'));
        $this->line('        MAIL_FROM_ADDRESS = '.($from ?: '(kosong)').' | MAIL_FROM_NAME = '.(config('mail.from.name') ?: '(kosong)'));
        if (! filter_var($from, FILTER_VALIDATE_EMAIL) || str_ends_with($from, '@example.com')) {
            $p[] = 'MAIL_FROM_ADDRESS belum diisi alamat pengirim asli (kosong/tidak valid/@example.com).';
        }
        if (blank(config('mail.from.name'))) {
            $p[] = 'MAIL_FROM_NAME kosong.';
        }

        return $p;
    }

    /** @return list<string> */
    private function whatsapp(): array
    {
        $driver = (string) config('distriva_notifications.whatsapp.driver');
        $this->line('WhatsApp — DISTRIVA_WHATSAPP_DRIVER = '.($driver === '' ? '(kosong)' : $driver));

        if ($driver !== 'http') {
            return $driver === 'log'
                ? ['Driver "log" hanya untuk pengembangan dan tidak mengirim apa pun.']
                : ["Driver \"{$driver}\" tidak mengirim. Isi DISTRIVA_WHATSAPP_DRIVER=http."];
        }

        $c = (array) config('distriva_notifications.whatsapp.http');
        $url = trim((string) ($c['url'] ?? ''));
        $this->line('        URL = '.($url ?: '(kosong)').' | metode = '.($c['method'] ?? 'POST').' | format = '.($c['body_format'] ?? 'form'));
        $this->line('        TOKEN = '.(filled($c['token'] ?? null) ? 'terisi' : 'kosong').' | header = '.($c['auth_header'] ?? 'Authorization').' | success_path = '.(($c['success_path'] ?? '') ?: '(tidak dicek)'));

        $p = [];
        if ($url === '') {
            $p[] = 'DISTRIVA_WHATSAPP_URL kosong.';
        } elseif (! preg_match('#^https?://[^/\s]+#i', $url)) {
            $p[] = 'DISTRIVA_WHATSAPP_URL harus diawali http:// atau https://.';
        } elseif (str_starts_with(strtolower($url), 'http://')) {
            $p[] = 'DISTRIVA_WHATSAPP_URL memakai http://: token terkirim tanpa enkripsi; pakai hanya untuk gateway di server atau jaringan sendiri.';
        }
        if (blank($c['token'] ?? null)) {
            $p[] = 'DISTRIVA_WHATSAPP_TOKEN kosong (isi dengan API key dari penyedia).';
        }
        $tpl = json_decode((string) ($c['body'] ?? ''), true);
        if (! is_array($tpl) || $tpl === []) {
            $p[] = 'DISTRIVA_WHATSAPP_BODY bukan JSON objek yang valid.';
        } else {
            $flat = json_encode($tpl);
            foreach (['{phone}', '{message}'] as $needed) {
                if ($needed === '{phone}' ? ! (str_contains($flat, '{phone}') || str_contains($flat, '{phone_local}')) : ! str_contains($flat, $needed)) {
                    $p[] = "DISTRIVA_WHATSAPP_BODY tidak memuat placeholder {$needed}.";
                }
            }
        }
        if (! in_array($c['body_format'] ?? 'form', ['form', 'json'], true)) {
            $p[] = 'DISTRIVA_WHATSAPP_BODY_FORMAT harus form atau json.';
        }

        return $p;
    }
}
