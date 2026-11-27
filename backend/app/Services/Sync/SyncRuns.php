<?php

namespace App\Services\Sync;

use App\Exceptions\SyncAlreadyRunning;
use App\Jobs\RunSyncJob;
use App\Models\User;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Siklus hidup bersama run sinkronisasi (docs/94): pendaftaran dengan kunci per (sumber, dataset, sasaran), antrean, progres, keterangan tambahan pada respons,
 * daftar run aktif, dan notifikasi kepada pemicu. Isi tiap sinkronisasi tetap di layanan masing-masing.
 */
class SyncRuns
{
    public const LIGHT = 'sync-light';

    public const HEAVY = 'sync-heavy';

    /** tabel run => izin untuk melihat run-nya */
    public const TABLES = [
        'eis_sync_runs' => 'eis_sync.manage',
        'outage_sync_runs' => 'outages.sync',
        'maximo_sync_runs' => 'substations.sync',
        'dil_sync_runs' => 'customers.import',
        'mims_pull_runs' => 'stock.import',
    ];

    /** sumber yang memakai otomasi peramban atau berkas besar */
    private const HEAVY_SOURCES = ['eis', 'maximo', 'dil'];

    /** sumber yang sesi akunnya tidak boleh dipakai dua run sekaligus: run berikutnya dengan akun yang sama menunggu di antrean */
    private const SERIAL_SOURCES = ['eis', 'maximo'];

    private const LABELS = ['eis' => 'EIS', 'apkt' => 'APKT', 'ap2t' => 'AP2T', 'gangguan' => 'Data gangguan', 'maximo' => 'Maximo', 'dil' => 'DIL pelanggan', 'mims' => 'MIMS'];

    public function __construct(private readonly InAppNotifier $inbox) {}

    /**
     * Mendaftarkan run berstatus QUEUED beserta kunci datanya. Kuncinya kunci primer `sync_locks`, sehingga dua permintaan serentak tidak dapat sama-sama lolos.
     *
     * @param  array<string, mixed>  $row
     * @param  list<string>  $targets  ULP, gudang, atau UP3 yang ditulis run ini
     *
     * @throws SyncAlreadyRunning
     */
    public function register(string $table, array $row, string $up3Id, string $source, string $dataset, array $targets, ?string $scopeUnitId = null, ?string $accountUnitId = null): void
    {
        $targets = $targets === [] ? [$up3Id] : array_values(array_unique($targets));
        sort($targets);     // urutan tetap agar dua pendaftaran serentak tidak saling mengunci silang
        $this->assertIdle($source, $dataset, $targets);
        try {
            DB::transaction(function () use ($table, $row, $up3Id, $source, $dataset, $targets, $scopeUnitId, $accountUnitId) {
                DB::table($table)->insert($row + ['status' => 'QUEUED', 'up3_id' => $up3Id, 'sync_source' => $source, 'sync_dataset' => $dataset, 'scope_unit_id' => $scopeUnitId ?? $up3Id,
                    'account_unit_id' => $accountUnitId, 'queue' => in_array($source, self::HEAVY_SOURCES, true) ? self::HEAVY : self::LIGHT, 'created_at' => now()]);
                DB::table('sync_locks')->insert(array_map(fn (string $target) => ['source' => $source, 'dataset' => $dataset, 'target_id' => $target, 'run_table' => $table, 'run_id' => $row['id']], $targets));
            });
        } catch (UniqueConstraintViolationException) {
            $this->assertIdle($source, $dataset, $targets);

            throw new SyncAlreadyRunning('', null);
        }
    }

    /**
     * @param  list<string>  $targets
     *
     * @throws SyncAlreadyRunning
     */
    public function assertIdle(string $source, string $dataset, array $targets): void
    {
        $locks = DB::table('sync_locks')->where('source', $source)->where('dataset', $dataset)->whereIn('target_id', $targets)->get(['target_id', 'run_table', 'run_id']);
        if ($locks->isEmpty()) {
            return;
        }
        $first = $locks->first();
        $run = DB::table($first->run_table)->where('id', $first->run_id)->first(['id', 'started_by', 'scope_unit_id']);
        $ids = $locks->where('run_id', $first->run_id)->pluck('target_id')->all();
        $names = DB::table('organizational_units')->whereIn('id', $ids)->pluck('name', 'id')->all() + DB::table('warehouses')->whereIn('id', $ids)->pluck('name', 'id')->all();

        throw new SyncAlreadyRunning($first->run_id, $this->person($run?->started_by), $this->unit($run?->scope_unit_id),
            array_map(fn (string $id) => ['id' => $id, 'name' => $names[$id] ?? null], $ids));
    }

    /** Memasukkan run ke antrean `sync-light` atau `sync-heavy`. */
    public function dispatch(string $table, string $runId, int $timeoutSeconds): void
    {
        $run = DB::table($table)->where('id', $runId)->first(['up3_id', 'account_unit_id', 'sync_source', 'queue']);
        // satu akun sumber hanya dipakai satu run sekaligus: run lain dengan akun yang sama menunggu di antrean
        $group = in_array($run->sync_source, self::SERIAL_SOURCES, true) ? "sync:{$run->sync_source}:".($run->account_unit_id ?? $run->up3_id) : null;
        RunSyncJob::dispatch($table, $runId, $group, $timeoutSeconds, $run->sync_source)->onConnection((string) config('distriva.sync.queue_connection'))->onQueue($run->queue);
    }

    /**
     * Run yang tidak pernah selesai ditandai gagal agar tidak mengunci tombol: berjalan melewati batasnya; antre melewati batas itu padahal job-nya sudah tidak ada
     * di antrean; atau antre lebih dari dua hari (tidak ada worker). Run yang masih menunggu giliran di antrean dibiarkan.
     */
    public function expire(string $table, int $seconds, string $messageColumn, array $extra = []): void
    {
        $limit = now()->subSeconds($seconds);
        $lost = DB::table($table)->where('status', 'QUEUED')->where('created_at', '<', $limit)->pluck('id')
            ->reject(fn (string $id) => DB::table((string) config('queue.connections.sync_jobs.table'))->where('payload', 'like', "%{$id}%")->exists())->all();
        DB::table($table)->where(fn ($q) => $q
            ->where(fn ($r) => $r->where('status', 'RUNNING')->whereRaw('coalesce(started_at, created_at) < ?', [$limit]))
            ->orWhere(fn ($r) => $r->where('status', 'QUEUED')->where(fn ($x) => $x->whereIn('id', $lost)->orWhere('created_at', '<', now()->subDays(2)))))
            ->update(['status' => 'FAILED', 'finished_at' => now(), $messageColumn => $messageColumn === 'log' ? DB::raw("coalesce(log, '') || E'\\nDihentikan: proses tidak selesai.'") : 'Dihentikan: proses tidak selesai.'] + $extra);
    }

    public function progress(string $table, string $runId, ?int $done, ?int $total = null): void
    {
        DB::table($table)->where('id', $runId)->update(array_filter(['done_units' => $done, 'total_units' => $total], fn ($v) => $v !== null));
    }

    /**
     * Keterangan multi-UP3 yang ditambahkan ke respons run. `status` lama dipertahankan; `state` memakai nama baku.
     *
     * @return array<string, mixed>
     */
    public function describe(object $r): array
    {
        $up3 = $r->up3_id === null ? null : DB::table('organizational_units')->where('id', $r->up3_id)->value('name');

        return [
            'up3' => $r->up3_id === null ? null : ['id' => $r->up3_id, 'name' => $up3],
            'triggered_by' => $this->person($r->started_by),
            'state' => match ($r->status) {
                'OK' => 'SUCCEEDED', default => $r->status
            },
            'source' => $r->sync_source, 'dataset' => $r->sync_dataset, 'queue' => $r->queue,
            'scope' => $this->unit($r->scope_unit_id), 'account' => $this->unit($r->account_unit_id ?? $r->up3_id),
            'queue_position' => $r->status === 'QUEUED' && $r->queue !== null ? $this->position($r) : null,
            'progress' => ['done_units' => $r->done_units === null ? null : (int) $r->done_units, 'total_units' => $r->total_units === null ? null : (int) $r->total_units],
        ];
    }

    /**
     * Run yang antre atau berjalan di UP3 yang boleh dilihat pengguna.
     *
     * @return list<array<string, mixed>>
     */
    public function active(User $actor, SyncScope $scope): array
    {
        $out = [];
        foreach (self::TABLES as $table => $permission) {
            $up3s = $scope->up3Ids($actor, $permission);
            if ($up3s === []) {
                continue;
            }
            foreach (DB::table($table)->whereIn('status', ['QUEUED', 'RUNNING'])->whereIn('up3_id', $up3s)->get() as $r) {
                $out[] = ['id' => $r->id, 'status' => $r->status, 'created_at' => $r->created_at, 'started_at' => $r->started_at] + $this->describe($r);
            }
        }
        usort($out, fn (array $a, array $b) => strcmp((string) $a['created_at'], (string) $b['created_at']));

        return $out;
    }

    /** Memberi tahu pemicu bahwa run-nya selesai atau gagal. Aman dipanggil untuk run yang belum selesai (diabaikan). */
    public function notifyFinished(string $table, string $runId): void
    {
        $r = DB::table($table)->where('id', $runId)->first();
        if ($r === null || $r->started_by === null || in_array($r->status, ['QUEUED', 'RUNNING'], true)) {
            return;
        }
        [$level, $verb] = match ($r->status) {
            'OK' => ['success', 'selesai'],
            'PARTIAL' => ['warning', 'selesai sebagian'],
            default => ['error', 'gagal'],
        };
        $label = (self::LABELS[$r->sync_source] ?? 'Sinkronisasi').($r->sync_dataset === null ? '' : " ({$r->sync_dataset})");
        $up3 = DB::table('organizational_units')->where('id', $r->up3_id)->value('name');
        $this->inbox->toUsers([$r->started_by], $level, "Sinkronisasi {$label} {$verb}", $up3, 'SINKRON', '/sinkronisasi');
    }

    /** Antrean dipakai bersama semua sumber, jadi posisi dihitung lintas tabel. */
    private function position(object $r): int
    {
        $ahead = 0;
        foreach (array_keys(self::TABLES) as $table) {
            $ahead += DB::table($table)->where('status', 'QUEUED')->where('queue', $r->queue)->where('created_at', '<', $r->created_at)->count();
        }

        return $ahead + 1;
    }

    /** @return array{id: string, name: ?string, type: ?string}|null */
    private function unit(?string $unitId): ?array
    {
        if ($unitId === null) {
            return null;
        }
        $unit = DB::table('organizational_units')->where('id', $unitId)->first(['name', 'unit_type']);

        return ['id' => $unitId, 'name' => $unit?->name, 'type' => $unit?->unit_type];
    }

    /** @return array{id: string, name: ?string}|null */
    private function person(?string $userId): ?array
    {
        return $userId === null ? null : ['id' => $userId, 'name' => DB::table('users')->where('id', $userId)->value('name')];
    }
}
