<?php

namespace Tests\Unit;

use App\Services\Notifications\GatewayFailure;
use App\Services\Notifications\Message;
use App\Services\Notifications\NotificationChannel;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\Recipient;
use App\Services\Notifications\WhatsApp\HttpWhatsAppDriver;
use App\Services\Notifications\WhatsAppChannel;
use Dotenv\Dotenv;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

class HttpWhatsAppDriverTest extends TestCase
{
    private const URL = 'https://gateway.example.test/send';

    private function driver(array $over = []): HttpWhatsAppDriver
    {
        return new HttpWhatsAppDriver($over + [
            'url' => self::URL, 'token' => 'SECRET-TOKEN-XYZ', 'body_format' => 'form',
            'body' => '{"target":"{phone}","message":"{message}"}',
        ]);
    }

    #[Test]
    public function it_posts_the_form_body_with_the_auth_header_and_substituted_values(): void
    {
        Http::fake([self::URL => Http::response(['status' => true])]);
        $this->driver()->send('6281234567890', "Halo \"Budi\"\nbaris dua");

        Http::assertSent(function (Request $r): bool {
            return $r->url() === self::URL && $r->method() === 'POST'
                && $r->hasHeader('Authorization', 'SECRET-TOKEN-XYZ')
                && $r['target'] === '6281234567890' && $r['message'] === "Halo \"Budi\"\nbaris dua";
        });
    }

    #[Test]
    public function json_format_with_prefix_custom_header_and_local_number_placeholder(): void
    {
        Http::fake([self::URL => Http::response([])]);
        $this->driver([
            'body_format' => 'json', 'auth_header' => 'X-Api-Key', 'auth_prefix' => 'Key ',
            'body' => '{"phone":"{phone_local}","data":{"text":"{message}"},"fixed":5}',
        ])->send('6281234567890', 'Isi {phone} aman');

        Http::assertSent(fn (Request $r) => $r->isJson() && $r->hasHeader('X-Api-Key', 'Key SECRET-TOKEN-XYZ')
            && $r->data() === ['phone' => '081234567890', 'data' => ['text' => 'Isi {phone} aman'], 'fixed' => 5]);
    }

    #[Test]
    public function a_message_with_json_special_characters_cannot_break_the_payload_structure(): void
    {
        Http::fake([self::URL => Http::response([])]);
        $evil = '"},"admin":"1","x":{"y":"';
        $this->driver(['body_format' => 'json'])->send('6281234567890', $evil);

        Http::assertSent(fn (Request $r) => array_keys($r->data()) === ['target', 'message'] && $r['message'] === $evil);
    }

    #[Test]
    public function http_errors_become_exceptions_that_contain_no_secret_or_body(): void
    {
        Http::fake([self::URL => Http::response('echo PASSWORD-IN-BODY', 500)]);
        try {
            $this->driver()->send('6281234567890', 'PASSWORD-IN-BODY');
            $this->fail('expected exception');
        } catch (RuntimeException $e) {
            $this->assertSame('WhatsApp gateway answered HTTP 500.', $e->getMessage());
            $this->assertStringNotContainsString('SECRET', $e->getMessage().$e->getTraceAsString());
            $this->assertStringNotContainsString('PASSWORD-IN-BODY', $e->getMessage());
        }
    }

    #[Test]
    public function the_success_path_must_match_when_configured(): void
    {
        Http::fake([self::URL => Http::sequence()->push(['status' => false, 'reason' => 'invalid number'])->push(['status' => true])]);
        $d = $this->driver(['success_path' => 'status', 'success_value' => 'true']);

        try {
            $d->send('6281234567890', 'x');
            $this->fail('expected exception');
        } catch (RuntimeException $e) {
            $this->assertStringStartsWith('WhatsApp gateway reported failure:', $e->getMessage());
        }
        $d->send('6281234567890', 'x'); // second answer is status:true -> no exception
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function transport_failures_surface_as_exceptions(): void
    {
        Http::fake(fn () => throw new ConnectionException('connection refused'));
        $this->expectException(ConnectionException::class);
        $this->driver()->send('6281234567890', 'x');
    }

    #[Test]
    public function http_and_https_urls_are_both_accepted_but_other_schemes_are_refused(): void
    {
        Http::fake(['*' => Http::response(['status' => true], 200)]);
        $this->app['env'] = 'production';
        $this->driver(['url' => 'http://gateway.example.test/send'])->send('6281234567890', 'x');
        $this->driver()->send('6281234567890', 'x');
        Http::assertSentCount(2);

        $this->expectExceptionMessage('http:// or https://');
        try {
            $this->driver(['url' => 'ftp://gateway.example.test/send'])->send('6281234567890', 'x');
        } finally {
            Http::assertSentCount(2);
        }
    }

    #[Test]
    public function a_refusal_shows_the_short_reason_of_the_gateway_without_numbers_or_the_message(): void
    {
        Http::fake(['*' => Http::response(['success' => false, 'error' => 'Session abc-1 not found for 6281234567890 "rahasia"'], 404)]);
        try {
            $this->driver()->send('6281234567890', 'isi pesan rahasia');
            $this->fail('A 404 must fail.');
        } catch (GatewayFailure $e) {
            $this->assertStringContainsString('HTTP 404', $e->getMessage());
            $this->assertStringContainsString("Alasan gateway: 'Session abc-1 not found for # ?rahasia?'", $e->getMessage());
            $this->assertStringNotContainsString('6281234567890', $e->getMessage());
            $this->assertStringNotContainsString('isi pesan', $e->getMessage());
        }
    }

    #[Test]
    public function an_incomplete_configuration_is_reported_and_the_channel_is_skipped(): void
    {
        foreach ([['url' => ''], ['token' => ''], ['body' => ''], ['body' => 'not json'], ['body' => '{}']] as $bad) {
            $this->assertFalse($this->driver($bad)->isConfigured(), json_encode($bad));
        }
        $this->assertTrue($this->driver()->isConfigured());

        $channel = new WhatsAppChannel($this->driver(['token' => '']));
        $this->assertSame('provider_not_configured', $channel->unavailableReason(new Recipient('x', 'x@example.com', '081234567890')));
        $this->assertNull((new WhatsAppChannel($this->driver()))->unavailableReason(new Recipient('x', 'x@example.com', '081234567890')));

        Http::fake();
        $this->expectException(RuntimeException::class);
        $this->driver(['token' => ''])->send('6281234567890', 'x');
    }

    #[Test]
    public function the_container_wires_the_http_driver_from_config_and_sends_through_the_channel(): void
    {
        Http::fake([self::URL => Http::response(['status' => true])]);
        Log::spy();
        config([
            'distriva_notifications.channels' => ['whatsapp'],
            'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::URL, 'token' => 'SECRET-TOKEN-XYZ', 'body' => '{"target":"{phone}","message":"{message}"}'],
        ]);

        $report = $this->app->make(NotificationDispatcher::class)
            ->send(new Recipient('Budi', null, '0812-3456-7890'), new Message('Judul', 'Rahasia-9', sensitive: true));

        $this->assertSame(['whatsapp'], $report->delivered);
        Http::assertSent(fn (Request $r) => $r['target'] === '6281234567890' && str_contains($r['message'], 'Rahasia-9'));
        Log::shouldNotHaveReceived('warning');
    }

    #[Test]
    public function a_gateway_outage_is_isolated_and_logged_without_secrets(): void
    {
        Http::fake([self::URL => Http::response('x', 503)]);
        Log::spy();
        config([
            'distriva_notifications.channels' => ['whatsapp'],
            'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::URL, 'token' => 'SECRET-TOKEN-XYZ', 'body' => '{"target":"{phone}","message":"{message}"}'],
        ]);

        $report = $this->app->make(NotificationDispatcher::class)
            ->send(new Recipient('Budi', null, '081234567890'), new Message('J', 'Rahasia-9', sensitive: true));

        $this->assertSame([], $report->delivered);
        $this->assertSame(['whatsapp' => GatewayFailure::class], $report->failed);
        Log::shouldHaveReceived('warning')->once()->withArgs(fn (string $m, array $c) => ! str_contains($m.json_encode($c), 'SECRET') && ! str_contains($m.json_encode($c), 'Rahasia'));
    }

    private function mismatch(mixed $response, int $status = 200): string
    {
        $url = self::URL.'/'.uniqid('', true); // Http::fake stubs stack and the first match wins: use a fresh URL per call
        Http::fake([$url => Http::response($response, $status)]);
        try {
            $this->driver(['url' => $url, 'success_path' => 'success', 'success_value' => 'true'])->send('6281234567890', 'PESAN-RAHASIA');
            $this->fail('expected a failure');
        } catch (GatewayFailure $e) {
            return $e->getMessage();
        }
    }

    #[Test]
    public function a_mismatch_reports_status_the_checked_field_and_only_the_key_names(): void
    {
        $msg = $this->mismatch(['status' => 'queued', 'data' => ['to' => '6281234567890', 'body' => 'PESAN-RAHASIA'], 'message' => 'Hai PESAN-RAHASIA']);

        $this->assertSame("WhatsApp gateway reported failure: HTTP 200, 'success' is missing (expected 'true'); top-level keys: [status, data, message].", $msg);
        $this->assertStringNotContainsString('PESAN-RAHASIA', $msg);
        $this->assertStringNotContainsString('6281234567890', $msg);
        $this->assertStringNotContainsString('queued', $msg); // values of other fields are never shown
    }

    #[Test]
    public function the_checked_field_value_is_shown_but_sanitized_and_truncated(): void
    {
        $msg = $this->mismatch(['success' => 'ok
<script>PESAN-RAHASIA '.str_repeat('x', 100)]);
        $this->assertStringContainsString("'success' is 'ok??script?PESAN-RAHASIA ", $msg);
        $this->assertLessThan(260, strlen($msg));
        $this->assertStringNotContainsString('
', $msg);

        $this->assertStringContainsString("'success' is 'ok'", $this->mismatch(['success' => 'ok']));
        $this->assertStringContainsString("'success' is false", $this->mismatch(['success' => false, 'message' => 'device offline']));
        $this->assertStringContainsString("'success' is array", $this->mismatch(['success' => ['a' => 1]]));
    }

    #[Test]
    public function a_non_json_answer_is_reported_as_such_without_echoing_it(): void
    {
        $msg = $this->mismatch('<html>PESAN-RAHASIA</html>');
        $this->assertSame("WhatsApp gateway reported failure: HTTP 200, response is not JSON (success_path 'success' cannot be checked).", $msg);
    }

    #[Test]
    public function the_dispatcher_keeps_the_safe_detail_for_the_console_and_the_log_but_not_for_other_exceptions(): void
    {
        Log::spy();
        Http::fake([self::URL => Http::response(['success' => false], 200)]);
        config([
            'distriva_notifications.channels' => ['whatsapp'], 'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::URL, 'token' => 'SECRET-TOKEN-XYZ', 'success_path' => 'success', 'body' => '{"target":"{phone}","message":"{message}"}'],
        ]);
        $report = $this->app->make(NotificationDispatcher::class)
            ->send(new Recipient('Budi', null, '081234567890'), new Message('J', 'Rahasia-9', sensitive: true));

        $this->assertStringContainsString("'success' is false", $report->details['whatsapp']);
        Log::shouldHaveReceived('warning')->once()->withArgs(fn (string $m, array $c) => str_contains($c['detail'] ?? '', "'success' is false") && ! str_contains($m.json_encode($c), 'SECRET') && ! str_contains($m.json_encode($c), 'Rahasia'));

        // an arbitrary exception (could contain URLs/secrets) never gets a detail
        $plain = new class implements NotificationChannel
        {
            public function name(): string
            {
                return 'x';
            }

            public function unavailableReason(Recipient $r): ?string
            {
                return null;
            }

            public function send(Recipient $r, Message $m): void
            {
                throw new RuntimeException('https://u:SECRET@host');
            }
        };
        $r2 = (new NotificationDispatcher([$plain]))->send(new Recipient('B'), new Message('s', 'b'));
        $this->assertSame([], $r2->details);
    }

    #[Test]
    public function the_notify_test_command_prints_the_safe_detail(): void
    {
        Http::fake([self::URL => Http::response(['status' => true], 200)]);
        config([
            'distriva_notifications.channels' => ['whatsapp'], 'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::URL, 'token' => 'SECRET-TOKEN-XYZ', 'success_path' => 'success', 'body' => '{"target":"{phone}","message":"{message}"}'],
        ]);

        Artisan::call('distriva:notify-test', ['--phone' => '081234567890']);
        $out = Artisan::output();

        $this->assertStringContainsString('[GAGAL]   whatsapp: App\\Services\\Notifications\\GatewayFailure', $out);
        $this->assertStringContainsString("rincian: WhatsApp gateway reported failure: HTTP 200, 'success' is missing (expected 'true'); top-level keys: [status].", $out);
        $this->assertStringNotContainsString('SECRET', $out);
    }

    /** @return array<string, array{0: mixed, 1: mixed, 2: bool}> */
    public static function successValues(): array
    {
        return [
            'env boolean true vs JSON true (the .env case)' => [true, true, true],
            'string true vs JSON true' => ['true', true, true],
            'string 1 vs JSON true' => ['1', true, true],
            'env boolean true vs string "true"' => [true, 'true', true],
            'env boolean true vs integer 1' => [true, 1, true],
            'env boolean false is not success' => [true, false, false],
            'string false' => ['true', 'false', false],
            'status text' => ['success', 'success', true],
            'status text, other word' => ['success', 'queued', false],
            'status text case-insensitive' => ['SUCCESS', 'success', true],
            'expected true vs missing' => [true, null, false],
            'expected true vs array' => [true, ['a'], false],
        ];
    }

    #[Test]
    #[DataProvider('successValues')]
    public function the_success_flag_is_compared_in_a_canonical_form(mixed $expected, mixed $actual, bool $accepted): void
    {
        Http::fake([self::URL => Http::response(['success' => $actual], 200)]);
        $driver = $this->driver(['success_path' => 'success', 'success_value' => $expected]);

        if (! $accepted) {
            $this->expectException(GatewayFailure::class);
        }
        $driver->send('6281234567890', 'x');
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function a_value_written_as_true_in_dotenv_really_arrives_as_a_boolean_and_still_matches(): void
    {
        // Reproduces the incident: parse the value exactly the way Laravel parses .env, then run it through the config.
        $dir = sys_get_temp_dir().'/distriva-env-'.bin2hex(random_bytes(4));
        mkdir($dir);
        file_put_contents($dir.'/.env', "DISTRIVA_WHATSAPP_SUCCESS_VALUE=true\n");
        $repo = Env::getRepository();
        $loaded = Dotenv::create($repo, $dir)->safeLoad();
        try {
            $this->assertTrue(env('DISTRIVA_WHATSAPP_SUCCESS_VALUE'), 'env() should have turned "true" into a boolean');
            $this->assertSame('1', (string) env('DISTRIVA_WHATSAPP_SUCCESS_VALUE'), 'which is why a plain string cast cannot be used');

            Http::fake([self::URL => Http::response(['success' => true, 'data' => [], 'message' => 'Success sent message'])]);
            $this->driver(['success_path' => 'success', 'success_value' => env('DISTRIVA_WHATSAPP_SUCCESS_VALUE')])->send('6281234567890', 'x');
            $this->addToAssertionCount(1);
        } finally {
            foreach (array_keys($loaded) as $k) {
                $repo->clear($k);
            }
            @unlink($dir.'/.env');
            @rmdir($dir);
        }
    }
}
