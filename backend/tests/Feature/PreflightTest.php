<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class PreflightTest extends PostgresTestCase
{
    #[Test]
    public function the_preflight_fails_without_the_scheduler_heartbeat_and_passes_that_item_when_it_is_fresh_or_reports_it_stale(): void
    {
        config(['cache.default' => 'array', 'distriva.forecast.python' => '/bin/true', 'distriva.pdf.binary' => '/bin/true', 'distriva.backup.root' => sys_get_temp_dir()]);
        Cache::forget('distriva.scheduler.heartbeat');
        $this->artisan('distriva:preflight')->expectsOutputToContain('belum pernah berjalan')->assertFailed();

        Cache::forever('distriva.scheduler.heartbeat', now()->subMinutes(30)->toIso8601String());
        $this->artisan('distriva:preflight')->expectsOutputToContain('berhenti 30 menit lalu')->assertFailed();

        Cache::forever('distriva.scheduler.heartbeat', now()->toIso8601String());
        $this->artisan('distriva:preflight')->expectsOutputToContain('terakhir 0 menit lalu')->doesntExpectOutputToContain('SECRET');
    }
}
