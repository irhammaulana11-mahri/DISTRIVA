<?php

namespace App\Console\Commands;

use App\Services\Notifications\Message;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\Recipient;
use App\Services\Notifications\WhatsApp\WhatsAppSettings;
use Illuminate\Console\Command;

class NotifyTest extends Command
{
    protected $signature = 'distriva:notify-test {--email= : Recipient e-mail} {--phone= : Recipient WhatsApp number} {--name=Uji}';

    protected $description = 'Send a harmless test message on every configured channel and show the per-channel result.';

    public function handle(NotificationDispatcher $dispatcher): int
    {
        app(WhatsAppSettings::class)->applyToConfig();   // the settings saved in the menu Pengaturan replace .env

        $this->line('Kanal terkonfigurasi : '.implode(', ', (array) config('distriva_notifications.channels')));
        $this->line('Mailer               : '.config('mail.default'));
        $this->line('Driver WhatsApp      : '.config('distriva_notifications.whatsapp.driver'));
        if (in_array(config('mail.default'), ['log', 'array'], true)) {
            $this->warn('Mailer "'.config('mail.default').'" tidak mengirim email sungguhan. Atur MAIL_MAILER dan MAIL_* di .env.');
        }

        $report = $dispatcher->send(
            new Recipient((string) $this->option('name'), $this->option('email') ?: null, $this->option('phone') ?: null),
            new Message('Uji kanal notifikasi DISTRIVA', 'Ini pesan uji. Tidak ada tindakan yang diperlukan.'),
        );

        foreach ($report->delivered as $c) {
            $this->info("  [OK]      {$c}");
        }
        foreach ($report->skipped as $c => $why) {
            $this->warn("  [DILEWAT] {$c}: {$why}");
        }
        foreach ($report->failed as $c => $class) {
            $this->error("  [GAGAL]   {$c}: {$class}");
            if (isset($report->details[$c])) {
                $this->line('            rincian: '.$report->details[$c]);
            }
        }

        return $report->anyDelivered() ? self::SUCCESS : self::FAILURE;
    }
}
