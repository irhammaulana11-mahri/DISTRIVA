<?php

namespace App\Jobs;

use App\Jobs\Middleware\LimitSyncSource;
use App\Services\Applications\EisSyncService;
use App\Services\Inventory\MimsPullRunService;
use App\Services\Outages\OutageSyncService;
use App\Services\Substations\DilSyncService;
use App\Services\Substations\MaximoSyncService;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Menjalankan satu run sinkronisasi dari antrean `sync-light` atau `sync-heavy`. Isinya hanya id run: token dan kata sandi tidak ikut ke tabel antrean.
 * Run yang memakai akun sumber yang sama (EIS, Maximo) saling menunggu, dan jumlah run per sumber dibatasi.
 */
class RunSyncJob implements ShouldQueue
{
    use Queueable;

    public int $maxExceptions = 1;

    public int $timeout;

    public function __construct(public readonly string $table, public readonly string $runId, public readonly ?string $group = null, int $timeoutSeconds = 3600, public readonly string $source = '')
    {
        $this->timeout = $timeoutSeconds + 120;
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addDays(2);
    }

    /** @return list<object> */
    public function middleware(): array
    {
        $serial = $this->group === null ? [] : [(new WithoutOverlapping($this->group))->shared()->releaseAfter(30)->expireAfter($this->timeout + 300)];

        return $this->source === '' ? $serial : [...$serial, new LimitSyncSource($this->source)];
    }

    public function handle(): void
    {
        $service = match ($this->table) {
            'eis_sync_runs' => EisSyncService::class,
            'outage_sync_runs' => OutageSyncService::class,
            'maximo_sync_runs' => MaximoSyncService::class,
            'dil_sync_runs' => DilSyncService::class,
            'mims_pull_runs' => MimsPullRunService::class,
        };
        app($service)->execute($this->runId);
    }

    public function failed(?Throwable $e): void
    {
        DB::table($this->table)->where('id', $this->runId)->whereIn('status', ['QUEUED', 'RUNNING'])->update(['status' => 'FAILED', 'finished_at' => now()]);
    }
}
