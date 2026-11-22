<?php

namespace Tests\Unit;

use App\Services\Notifications\WhatsApp\HttpWhatsAppDriver;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class NotifyCheckTest extends TestCase
{
    private const STARSENDER = [
        'url' => 'https://api.starsender.online/api/send', 'method' => 'POST', 'auth_header' => 'Authorization', 'auth_prefix' => '',
        'token' => 'DEVICE-KEY-SECRET', 'body_format' => 'json', 'body' => '{"messageType":"text","to":"{phone}","body":"{message}"}',
        'success_path' => 'success', 'success_value' => 'true',
    ];

    private function check(array $config): array
    {
        config($config);
        $code = Artisan::call('distriva:notify-check');

        return [$code, Artisan::output()];
    }

    private function goodMail(): array
    {
        return [
            'mail.default' => 'smtp', 'mail.mailers.smtp.host' => 'smtp.penyedia.test', 'mail.mailers.smtp.port' => 587,
            'mail.mailers.smtp.scheme' => null, 'mail.mailers.smtp.username' => 'user', 'mail.mailers.smtp.password' => 'RAHASIA-SMTP',
            'mail.from.address' => 'no-reply@distriva.co.id', 'mail.from.name' => 'DISTRIVA',
        ];
    }

    #[Test]
    public function a_complete_configuration_passes_and_never_prints_secrets_or_sends_anything(): void
    {
        Http::fake();
        Mail::fake();
        [$code, $out] = $this->check($this->goodMail() + [
            'distriva_notifications.channels' => ['mail', 'whatsapp'], 'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => self::STARSENDER,
        ]);

        $this->assertSame(0, $code);
        $this->assertStringContainsString('Email: konfigurasi lengkap.', $out);
        $this->assertStringContainsString('WhatsApp: konfigurasi lengkap.', $out);
        $this->assertStringNotContainsString('RAHASIA-SMTP', $out);
        $this->assertStringNotContainsString('DEVICE-KEY-SECRET', $out);
        Http::assertNothingSent();
        Mail::assertNothingSent();
    }

    #[Test]
    public function the_default_development_settings_are_reported_as_not_ready(): void
    {
        [$code, $out] = $this->check([
            'distriva_notifications.channels' => ['mail', 'whatsapp'], 'mail.default' => 'log', 'distriva_notifications.whatsapp.driver' => 'null',
        ]);

        $this->assertSame(1, $code);
        $this->assertStringContainsString('tidak mengirim email sungguhan', $out);
        $this->assertStringContainsString('Isi DISTRIVA_WHATSAPP_DRIVER=http', $out);
        $this->assertStringContainsString('Tidak ada kanal yang siap', $out);
    }

    #[Test]
    public function each_missing_mail_setting_is_named(): void
    {
        [, $out] = $this->check([
            'distriva_notifications.channels' => ['mail'], 'mail.default' => 'smtp', 'mail.mailers.smtp.host' => '127.0.0.1', 'mail.mailers.smtp.port' => 465,
            'mail.mailers.smtp.scheme' => null, 'mail.mailers.smtp.username' => null, 'mail.mailers.smtp.password' => null,
            'mail.from.address' => 'hello@example.com', 'mail.from.name' => '',
        ]);

        foreach (['MAIL_HOST belum diisi', 'MAIL_SCHEME=smtps', 'MAIL_USERNAME / MAIL_PASSWORD kosong', 'MAIL_FROM_ADDRESS belum diisi', 'MAIL_FROM_NAME kosong'] as $needle) {
            $this->assertStringContainsString($needle, $out);
        }
    }

    #[Test]
    public function port_587_with_smtps_is_flagged(): void
    {
        [, $out] = $this->check(['mail.mailers.smtp.scheme' => 'smtps', 'distriva_notifications.channels' => ['mail']] + $this->goodMail());
        $this->assertStringContainsString('kosongkan MAIL_SCHEME', $out);
    }

    #[Test]
    public function each_missing_whatsapp_setting_is_named(): void
    {
        [, $out] = $this->check([
            'distriva_notifications.channels' => ['whatsapp'], 'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => 'http://insecure.test/send', 'token' => '', 'body' => '{"to":"{phone}"}', 'body_format' => 'xml'],
        ]);

        foreach (['memakai http://: token terkirim tanpa enkripsi', 'DISTRIVA_WHATSAPP_TOKEN kosong', 'tidak memuat placeholder {message}', 'BODY_FORMAT harus form atau json'] as $needle) {
            $this->assertStringContainsString($needle, $out);
        }
        $this->assertStringNotContainsString('tidak memuat placeholder {phone}', $out);
    }

    #[Test]
    public function a_disabled_channel_is_not_judged_and_a_single_ready_channel_is_enough(): void
    {
        [$code, $out] = $this->check($this->goodMail() + ['distriva_notifications.channels' => ['mail']]);
        $this->assertSame(0, $code);
        $this->assertStringContainsString('WhatsApp: dinonaktifkan', $out);
    }

    // ---- Starsender profile (official docs: docs.starsender.online/docs/message-api/kirim-pesan) ----

    #[Test]
    public function the_starsender_profile_sends_json_with_the_bare_key_in_authorization_and_checks_success(): void
    {
        Http::fake(['api.starsender.online/*' => Http::sequence()
            ->push(['success' => true, 'data' => [], 'message' => 'Success sent message'])
            ->push(['success' => false, 'message' => 'device disconnected'])]);
        $driver = new HttpWhatsAppDriver(self::STARSENDER);

        $driver->send('6281234567890', "Halo \"Budi\"\nbaris dua");

        Http::assertSent(function (Request $r): bool {
            return $r->url() === 'https://api.starsender.online/api/send' && $r->method() === 'POST' && $r->isJson()
                && $r->hasHeader('Authorization', 'DEVICE-KEY-SECRET')
                && $r->data() === ['messageType' => 'text', 'to' => '6281234567890', 'body' => "Halo \"Budi\"\nbaris dua"];
        });

        $this->expectExceptionMessage('WhatsApp gateway reported failure:'); // HTTP 200 with success:false
        $driver->send('6281234567890', 'x');
    }

    #[Test]
    public function a_disabled_channel_prints_no_details(): void
    {
        [, $out] = $this->check($this->goodMail() + ['distriva_notifications.channels' => ['mail']]);
        $this->assertStringNotContainsString('DISTRIVA_WHATSAPP_DRIVER =', $out);
    }
}
