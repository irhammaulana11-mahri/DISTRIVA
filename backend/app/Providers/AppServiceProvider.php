<?php

namespace App\Providers;

use App\Services\Authorization\DenyUnverifiedVendorScopeAuthorizer;
use App\Services\Authorization\VendorScopeAuthorizer;
use App\Services\Notifications\MailChannel;
use App\Services\Notifications\NotificationDispatcher;
use App\Services\Notifications\WhatsApp\HttpWhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppDriver;
use App\Services\Notifications\WhatsApp\WhatsAppSettings;
use App\Services\Notifications\WhatsAppChannel;
use App\Support\DestructiveDatabaseGuard;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(VendorScopeAuthorizer::class, DenyUnverifiedVendorScopeAuthorizer::class);

        $this->app->bind(WhatsAppDriver::class, function ($app): WhatsAppDriver {
            $app->make(WhatsAppSettings::class)->applyToConfig();
            $name = (string) config('distriva_notifications.whatsapp.driver');
            $class = config("distriva_notifications.whatsapp.drivers.{$name}");

            if (! is_string($class)) {
                throw new \InvalidArgumentException("Unknown WhatsApp driver [{$name}].");
            }

            return $name === 'http'
                ? new HttpWhatsAppDriver((array) config('distriva_notifications.whatsapp.http'))
                : $app->make($class);
        });

        $this->app->bind(NotificationDispatcher::class, function ($app): NotificationDispatcher {
            $available = [
                'mail' => fn () => $app->make(MailChannel::class),
                'whatsapp' => fn () => new WhatsAppChannel(
                    $app->make(WhatsAppDriver::class),
                    (string) config('distriva_notifications.whatsapp.default_country_code'),
                ),
            ];

            $channels = [];
            foreach ((array) config('distriva_notifications.channels') as $name) {
                if (isset($available[$name])) {
                    $channels[] = $available[$name]();
                }
            }

            return new NotificationDispatcher($channels);
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();

        Event::listen(CommandStarting::class, function (CommandStarting $event): void {
            if (! in_array($event->command, DestructiveDatabaseGuard::COMMANDS, true)) {
                return;
            }

            $connection = $event->input->hasParameterOption('--database')
                ? (string) $event->input->getParameterOption('--database')
                : config('database.default');

            DestructiveDatabaseGuard::assertAllowed(
                $event->command,
                config("database.connections.{$connection}.database"),
                config('distriva.disposable_databases', []),
            );
        });
    }

    /**
     * Named limiters, one counter per purpose. (Unnamed `throttle:N,M` middleware shares ONE counter per IP across
     * every route that uses it — login, password change and OTP used to lock each other out.)
     */
    private function configureRateLimiting(): void
    {
        $email = fn (Request $r): string => Str::lower(trim((string) $r->input('email')));

        // Per address+IP (an office behind one IP does not lock everybody out) plus a wide per-IP ceiling.
        // 10 > the 5-failure account lockout, so the lockout (and its message) comes first; this only bounds hammering.
        RateLimiter::for('login', fn (Request $r) => [
            Limit::perMinute(10)->by('login|'.$r->ip().'|'.sha1($email($r))),
            Limit::perMinute(30)->by('login-ip|'.$r->ip()),
        ]);
        RateLimiter::for('otp-request', fn (Request $r) => [
            Limit::perMinute(10)->by('otp-request|'.$r->ip()),
        ]);
        RateLimiter::for('otp-verify', fn (Request $r) => [
            Limit::perMinute(10)->by('otp-verify|'.$r->ip().'|'.sha1($email($r))),
            Limit::perMinute(30)->by('otp-verify-ip|'.$r->ip()),
        ]);
        RateLimiter::for('password-change', fn (Request $r) => Limit::perMinute(5)->by('password-change|'.($r->user()?->getAuthIdentifier() ?? $r->ip())));
        RateLimiter::for('mfa', fn (Request $r) => Limit::perMinute(10)->by('mfa|'.($r->user()?->getAuthIdentifier() ?? $r->ip())));
        // One bucket per user for the whole app. Reads are cheap and one page fires many of them (a proposal page loads the chain, drawing, MTO,
        // KKF, history ...), so they get their own generous bucket; writes and exports stay at 60/min.
        RateLimiter::for('admin', function (Request $r) {
            $who = $r->user()?->getAuthIdentifier() ?? $r->ip();

            return $r->isMethodSafe()
                ? Limit::perMinute(600)->by('admin-read|'.$who)
                : Limit::perMinute(60)->by('admin|'.$who);
        });
    }
}
