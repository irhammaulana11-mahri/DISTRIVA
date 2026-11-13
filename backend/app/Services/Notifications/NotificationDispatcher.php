<?php

namespace App\Services\Notifications;

use App\Exceptions\NotificationFailed;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Sends one message on every configured, available channel. Failures are isolated per channel (D-7). */
class NotificationDispatcher
{
    /** @param iterable<NotificationChannel> $channels */
    public function __construct(private readonly iterable $channels) {}

    public function send(Recipient $recipient, Message $message): DeliveryReport
    {
        $delivered = [];
        $failed = [];
        $skipped = [];
        $details = [];

        foreach ($this->channels as $channel) {
            $name = $channel->name();

            if (($reason = $channel->unavailableReason($recipient)) !== null) {
                $skipped[$name] = $reason;

                continue;
            }

            try {
                $channel->send($recipient, $message);
                $delivered[] = $name;
            } catch (Throwable $e) {
                // Only the channel and exception class are logged: never the body, address or number.
                $failed[$name] = $e::class;
                if ($e instanceof DisplaySafe) {
                    $details[$name] = $e->getMessage();
                }
                Log::warning('Notification channel failed.', array_filter([
                    'channel' => $name, 'exception' => $e::class, 'sensitive' => $message->sensitive,
                    'detail' => $details[$name] ?? null, // only DisplaySafe exceptions
                ], fn ($v) => $v !== null));
            }
        }

        return new DeliveryReport($delivered, $failed, $skipped, $details);
    }

    /** @throws NotificationFailed when no channel delivered */
    public function sendOrFail(Recipient $recipient, Message $message): DeliveryReport
    {
        $report = $this->send($recipient, $message);

        if (! $report->anyDelivered()) {
            throw new NotificationFailed($report);
        }

        return $report;
    }
}
