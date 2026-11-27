<?php

namespace App\Jobs\Middleware;

use Closure;
use Illuminate\Support\Facades\Cache;

/**
 * Paling banyak N run sekaligus per sistem sumber di seluruh DISTRIVA (docs/94), agar sumber tidak membatasi atau memblokir kita. Kelebihannya kembali ke antrean.
 * Slot dipegang lewat kunci cache, jadi worker harus memakai cache bersama (database atau redis).
 */
class LimitSyncSource
{
    private const RETRY_SECONDS = 30;

    public function __construct(private readonly string $source) {}

    public function handle(object $job, Closure $next): void
    {
        $slots = max(1, (int) (config("distriva.sync.concurrency.{$this->source}") ?? 1));
        for ($i = 1; $i <= $slots; $i++) {
            $lock = Cache::lock("sync-slot:{$this->source}:{$i}", $job->timeout + 300);
            if ($lock->get()) {
                try {
                    $next($job);
                } finally {
                    $lock->release();
                }

                return;
            }
        }
        $job->release(self::RETRY_SECONDS);
    }
}
