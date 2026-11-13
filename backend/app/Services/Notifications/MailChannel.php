<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\Mail;

class MailChannel implements NotificationChannel
{
    public function name(): string
    {
        return 'mail';
    }

    public function unavailableReason(Recipient $recipient): ?string
    {
        // The "log" mailer only writes to a file: counting it as delivered would silently lose credentials.
        if (config('mail.default') === 'log') {
            return 'mailer_not_deliverable';
        }

        return filter_var($recipient->email, FILTER_VALIDATE_EMAIL) ? null : 'no_valid_email';
    }

    public function send(Recipient $recipient, Message $message): void
    {
        Mail::raw($message->body, static function ($mail) use ($recipient, $message): void {
            $mail->to($recipient->email, $recipient->name)->subject($message->subject);
        });
    }
}
