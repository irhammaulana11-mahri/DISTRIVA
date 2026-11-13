<?php

namespace Tests\Unit;

use App\Exceptions\NotificationFailed;
use App\Services\Notifications\Message;
use App\Services\Notifications\NotificationChannel;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\PhoneNumber;
use App\Services\Notifications\Recipient;
use App\Services\Notifications\WhatsApp\LogWhatsAppDriver;
use App\Services\Notifications\WhatsApp\NullWhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppDriver;
use App\Services\Notifications\WhatsAppChannel;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

class NotificationsTest extends TestCase
{
    private function channel(string $name, ?string $unavailable = null, bool $fails = false): NotificationChannel
    {
        return new class($name, $unavailable, $fails) implements NotificationChannel
        {
            public int $sent = 0;

            public function __construct(private string $n, private ?string $u, private bool $f) {}

            public function name(): string
            {
                return $this->n;
            }

            public function unavailableReason(Recipient $r): ?string
            {
                return $this->u;
            }

            public function send(Recipient $r, Message $m): void
            {
                if ($this->f) {
                    throw new RuntimeException('boom '.$m->body);
                }
                $this->sent++;
            }
        };
    }

    private function to(): Recipient
    {
        return new Recipient('Budi', 'budi@example.com', '081234567890');
    }

    #[Test]
    public function it_delivers_on_every_available_channel(): void
    {
        $mail = $this->channel('mail');
        $wa = $this->channel('whatsapp');
        $report = (new NotificationDispatcher([$mail, $wa]))->send($this->to(), new Message('s', 'b'));

        $this->assertSame(['mail', 'whatsapp'], $report->delivered);
        $this->assertSame([1, 1], [$mail->sent, $wa->sent]);
    }

    #[Test]
    public function one_failing_channel_does_not_block_the_other(): void
    {
        $wa = $this->channel('whatsapp');
        $report = (new NotificationDispatcher([$this->channel('mail', fails: true), $wa]))->send($this->to(), new Message('s', 'b'));

        $this->assertSame(['whatsapp'], $report->delivered);
        $this->assertSame(['mail' => RuntimeException::class], $report->failed);
        $this->assertTrue($report->anyDelivered());
        $this->assertSame(1, $wa->sent);
    }

    #[Test]
    public function unavailable_channels_are_skipped_with_a_reason_and_the_rest_still_deliver(): void
    {
        $report = (new NotificationDispatcher([$this->channel('mail'), $this->channel('whatsapp', 'no_valid_phone')]))->send($this->to(), new Message('s', 'b'));

        $this->assertSame(['mail'], $report->delivered);
        $this->assertSame(['whatsapp' => 'no_valid_phone'], $report->skipped);
    }

    #[Test]
    public function send_or_fail_throws_only_when_nothing_was_delivered(): void
    {
        $ok = new NotificationDispatcher([$this->channel('mail', fails: true), $this->channel('whatsapp')]);
        $this->assertTrue($ok->sendOrFail($this->to(), new Message('s', 'b'))->anyDelivered());

        $none = new NotificationDispatcher([$this->channel('mail', fails: true), $this->channel('whatsapp', 'no_valid_phone')]);
        try {
            $none->sendOrFail($this->to(), new Message('s', 'b'));
            $this->fail('Expected NotificationFailed');
        } catch (NotificationFailed $e) {
            $this->assertSame(['mail' => RuntimeException::class], $e->report->failed);
            $this->assertSame(['whatsapp' => 'no_valid_phone'], $e->report->skipped);
        }
    }

    #[Test]
    public function failures_are_logged_without_the_message_body_or_address(): void
    {
        Log::spy();
        (new NotificationDispatcher([$this->channel('mail', fails: true)]))
            ->send($this->to(), new Message('Subjek', 'RAHASIA-123!', sensitive: true));

        Log::shouldHaveReceived('warning')->once()->withArgs(function (string $msg, array $ctx): bool {
            $dump = $msg.json_encode($ctx);

            return ! str_contains($dump, 'RAHASIA') && ! str_contains($dump, 'budi@example.com') && ! str_contains($dump, '0812')
                && $ctx['channel'] === 'mail' && $ctx['sensitive'] === true;
        });
    }

    /** @return array<string, array{0: ?string, 1: ?string}> */
    public static function phones(): array
    {
        return [
            'local' => ['081234567890', '6281234567890'],
            'with dashes' => ['0812-3456-7890', '6281234567890'],
            'plus 62' => ['+62 812 3456 7890', '6281234567890'],
            '62 without plus' => ['6281234567890', '6281234567890'],
            '0062' => ['0062 812 3456 7890', '6281234567890'],
            'no leading zero' => ['81234567890', '6281234567890'],
            'foreign plus' => ['+60123456789', '60123456789'],
            'too short' => ['0812', null],
            'letters only' => ['abc', null],
            'empty' => ['', null],
            'null' => [null, null],
            'too long' => ['08123456789012345678', null],
        ];
    }

    #[Test]
    #[DataProvider('phones')]
    public function phone_numbers_are_normalized_or_rejected(?string $raw, ?string $expected): void
    {
        $this->assertSame($expected, PhoneNumber::normalize($raw, '62'));
    }

    #[Test]
    public function whatsapp_channel_is_unavailable_without_a_provider_or_a_valid_phone(): void
    {
        $this->assertSame('no_provider_configured', (new WhatsAppChannel(new NullWhatsAppDriver))->unavailableReason($this->to()));
        $log = new WhatsAppChannel(new LogWhatsAppDriver);
        $this->assertNull($log->unavailableReason($this->to()));
        $this->assertSame('no_valid_phone', $log->unavailableReason(new Recipient('x', 'x@example.com', null)));
    }

    #[Test]
    public function whatsapp_channel_sends_the_normalized_number_and_text_to_the_driver(): void
    {
        $driver = new class implements WhatsAppDriver
        {
            public array $got = [];

            public function send(string $phone, string $text): void
            {
                $this->got = [$phone, $text];
            }
        };
        (new WhatsAppChannel($driver))->send($this->to(), new Message('Judul', 'Isi'));

        $this->assertSame(['6281234567890', "Judul\n\nIsi"], $driver->got);
    }

    #[Test]
    public function the_log_driver_never_writes_the_number_or_text(): void
    {
        Log::spy();
        (new LogWhatsAppDriver)->send('6281234567890', 'Password: RAHASIA');
        Log::shouldHaveReceived('info')->once()->withArgs(fn (string $m, array $c) => ! str_contains($m.json_encode($c), 'RAHASIA') && ! str_contains($m.json_encode($c), '6281'));
    }

    #[Test]
    public function the_container_builds_the_configured_dispatcher_and_rejects_an_unknown_driver(): void
    {
        config(['distriva_notifications.channels' => ['mail', 'whatsapp'], 'distriva_notifications.whatsapp.driver' => 'log']);
        $report = $this->app->make(NotificationDispatcher::class)->send(new Recipient('Budi', 'budi@example.com', '081234567890'), new Message('s', 'b'));
        $this->assertContains('whatsapp', $report->delivered);
        $this->assertContains('mail', $report->delivered); // MAIL_MAILER=array under phpunit

        config(['distriva_notifications.whatsapp.driver' => 'nope']);
        $this->expectException(\InvalidArgumentException::class);
        $this->app->make(NotificationDispatcher::class);
    }

    #[Test]
    public function a_channel_can_be_switched_off_by_configuration(): void
    {
        config(['distriva_notifications.channels' => ['mail'], 'distriva_notifications.whatsapp.driver' => 'log']);
        $report = $this->app->make(NotificationDispatcher::class)->send(new Recipient('Budi', 'budi@example.com', '081234567890'), new Message('s', 'b'));
        $this->assertSame(['mail'], $report->delivered);
    }
}
