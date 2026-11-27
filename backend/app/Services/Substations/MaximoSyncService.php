<?php

namespace App\Services\Substations;

use App\Exceptions\AssignmentRuleViolation;
use App\Exceptions\SyncAlreadyRunning;
use App\Models\User;
use App\Services\Sync\SyncAccounts;
use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

/**
 * The Maximo sync started from DISTRIVA: the Maximo account (password encrypted, never returned), the work type, the look-back window and the daily run are kept in maximo_sync_settings;
 * a run starts tools/maximo_sync (Python) in a detached process that lists the finished inspection work orders, fetches the report of the latest one per gardu (or all) and appends them to the
 * cumulative CSV; when the tool ends well the CSV is loaded as readings of the existing gardu (MaximoWoLoadService, idempotent). Every run is kept with its log.
 */
class MaximoSyncService
{
    private const LOG_LIMIT = 30000;

    public function __construct(private readonly MaximoWoLoadService $load, private readonly SyncRuns $runs, private readonly SyncAccounts $accounts) {}

    /** @return array<string,mixed> */
    public function settings(?string $up3Id = null): array
    {
        $s = SyncScope::settings('maximo_sync_settings', $up3Id);

        return ['maximo_url' => $s->maximo_url, 'maximo_username' => $s->maximo_username, 'has_password' => $s->maximo_password_encrypted !== null, 'work_type' => $s->work_type,
            'lookback_days' => (int) $s->lookback_days, 'auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => $s->auto_time, 'updated_at' => $s->updated_at];
    }

    /**
     * @param  array<string,mixed>  $d  maximo_url, maximo_username?, maximo_password? (empty keeps the saved one), work_type, lookback_days, auto_enabled, auto_time
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor, string $up3Id): array
    {
        $current = SyncScope::settings('maximo_sync_settings', $up3Id);
        $username = trim((string) ($d['maximo_username'] ?? $current->maximo_username));
        $password = filled($d['maximo_password'] ?? null) ? Crypt::encryptString((string) $d['maximo_password']) : $current->maximo_password_encrypted;
        if (! empty($d['auto_enabled']) && ($username === '' || $password === null)) {
            throw new AssignmentRuleViolation('Isi user dan password Maximo sebelum mengaktifkan sinkronisasi otomatis.');
        }
        DB::table('maximo_sync_settings')->where('id', $current->id)->update(['maximo_url' => rtrim((string) $d['maximo_url'], '/'), 'maximo_username' => $username === '' ? null : $username, 'maximo_password_encrypted' => $password,
            'work_type' => mb_strtoupper(trim((string) $d['work_type'])), 'lookback_days' => (int) $d['lookback_days'], 'auto_enabled' => (bool) $d['auto_enabled'], 'auto_time' => $d['auto_time'],
            'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->settings($up3Id);
    }

    /**
     * Registers the runs of one request (QUEUED), one per Maximo account: every ULP with its own account, plus one with the UP3 account for the others. The tool cannot be narrowed to a ULP, so the UP3
     * account run covers every ULP without its own account. All or nothing. `$since` = work orders finished on or after it (default: the look-back window).
     *
     * @param  ?list<string>  $ulpIds  ULPs to pull; null = all of the UP3
     * @return list<string> run ids
     *
     * @throws AssignmentRuleViolation|SyncAlreadyRunning
     */
    public function start(string $trigger, User $actor, string $up3Id, ?string $since = null, bool $allWorkOrders = false, ?array $ulpIds = null, bool $coversUp3 = true, ?string $scopeUnitId = null): array
    {
        $s = SyncScope::settings('maximo_sync_settings', $up3Id);
        // a run that never finished (the process died) must not block the next one forever
        $this->expireStale();
        $all = array_column(SyncScope::ulps($up3Id), 'id');
        $groups = $this->accounts->groups('maximo', $up3Id, $ulpIds ?? $all);
        $own = DB::table('sync_accounts')->where('source', 'maximo')->whereIn('organizational_unit_id', $all)->pluck('organizational_unit_id')->all();
        foreach ($groups as &$group) {
            if ($group['account_unit_id'] !== null) {
                continue;
            }
            if (! $coversUp3) {
                $names = DB::table('organizational_units')->whereIn('id', $group['ulp_ids'])->pluck('name')->implode(', ');
                throw new AssignmentRuleViolation("{$names} belum punya akun Maximo sendiri; akun UP3 hanya dapat dipakai dari tingkat UP3.");
            }
            $group['ulp_ids'] = array_values(array_diff($all, $own));
        }
        unset($group);
        $since ??= CarbonImmutable::now((string) config('distriva.business_timezone'))->subDays((int) $s->lookback_days)->toDateString();

        return DB::transaction(fn () => array_map(function (array $group) use ($trigger, $actor, $up3Id, $since, $allWorkOrders, $scopeUnitId): string {
            $id = (string) Str::uuid();
            $this->runs->register('maximo_sync_runs', ['id' => $id, 'trigger' => $trigger, 'started_by' => $actor->getKey(), 'since' => $since, 'all_work_orders' => $allWorkOrders], $up3Id, 'maximo', 'inspeksi', $group['ulp_ids'], $scopeUnitId, $group['account_unit_id']);

            return $id;
        }, $groups));
    }

    public function expireStale(): void
    {
        $this->runs->expire('maximo_sync_runs', (int) config('distriva.maximo_sync.timeout_seconds') + 600, 'log');
    }

    /** Hands a registered run to the queue (or runs it inline in tests). */
    public function launch(string $runId): void
    {
        if (config('distriva.maximo_sync.run_inline')) {
            Artisan::call('distriva:maximo-sync-execute', ['id' => $runId]);

            return;
        }
        $this->runs->dispatch('maximo_sync_runs', $runId, (int) config('distriva.maximo_sync.timeout_seconds'));
    }

    /** Called every minute by the scheduler: starts the automatic run of every UP3 whose time has come (once per business day, even if it failed). */
    public function runScheduledIfDue(): ?string
    {
        $now = now(config('distriva.business_timezone'));
        $first = null;
        foreach (DB::table('maximo_sync_settings')->where('auto_enabled', true)->whereNotNull('updated_by')->orderBy('id')->get() as $s) {
            $up3Id = $s->up3_id ?? SyncScope::defaultUp3();
            $user = User::query()->find($s->updated_by);
            if ($up3Id === null || $user === null || $now->format('H:i') < $s->auto_time
                || DB::table('maximo_sync_runs')->where('up3_id', $up3Id)->where('trigger', 'AUTO')->where('created_at', '>=', $now->copy()->startOfDay()->utc())->exists()) {
                continue;
            }
            try {
                $ids = $this->start('AUTO', $user, $up3Id);
            } catch (AssignmentRuleViolation|SyncAlreadyRunning) {
                continue;
            }
            foreach ($ids as $id) {
                $this->launch($id);
                $first ??= $id;
            }
        }

        return $first;
    }

    /** Runs the registered run to the end (inside the detached process): the log is kept up to date while it goes, the CSV is loaded when the tool ended well. */
    public function execute(string $runId): void
    {
        $run = DB::table('maximo_sync_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        DB::table('maximo_sync_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'started_at' => now()]);
        $log = '';
        $exit = 1;
        $summary = null;
        try {
            $s = SyncScope::settings('maximo_sync_settings', $run->up3_id);
            $user = User::query()->findOrFail($run->started_by);
            $dir = (string) config('distriva.maximo_sync.dir');
            $args = [(string) config('distriva.maximo_sync.python'), 'main.py', 'ambil', '--sejak', CarbonImmutable::parse((string) $run->since)->format('d/m/Y'), '--tipe', (string) $s->work_type, '--tambah'];
            $run->all_work_orders && $args[] = '--semua';
            // daftar mentah dan CSV kumulatif milik tiap UP3; UP3 utama tetap memakai folder bawaan alat agar riwayatnya tersambung
            $data = $run->account_unit_id === null && $run->up3_id === SyncScope::defaultUp3() ? null : storage_path('app/private/maximo-sync/'.($run->account_unit_id ?? $run->up3_id));
            if ($data !== null) {
                array_push($args, '--raw', $data.'/raw', '--out', $data.'/out');
            }
            $account = $this->accounts->credentials('maximo', $run->up3_id, $run->account_unit_id);
            $env = ['MAXIMO_URL' => $s->maximo_url, 'MAXIMO_USERNAME' => $account['username'], 'MAXIMO_PASSWORD' => $account['password'], 'PYTHONUNBUFFERED' => '1'];
            $process = new Process($args, $dir, $env, null, (float) config('distriva.maximo_sync.timeout_seconds'));
            $last = 0.0;
            $exit = $process->run(function (string $type, string $buffer) use (&$log, &$last, $runId): void {
                $log = $this->tail($log.$buffer);
                if (microtime(true) - $last > 2) {
                    $last = microtime(true);
                    DB::table('maximo_sync_runs')->where('id', $runId)->update(['log' => $log]);
                }
            });
            $summary = $this->summaryOf($log);
            $csv = ($data ?? $dir).'/out/maximo-wo-pengukuran.csv';
            if ($exit === 0 && is_file($csv)) {
                $r = $this->load->load($csv, $user);
                $summary['load'] = $r['counts'];
                $log = $this->tail($log."\nPemuatan ke pembacaan gardu: ".json_encode($r['counts']).(($r['problems']['unknown_gardu'] ?? []) !== [] ? "\nGardu belum ada di master (sebagian): ".implode(', ', array_slice($r['problems']['unknown_gardu'], 0, 10)) : ''));
            }
        } catch (\Throwable $e) {
            $log = $this->tail($log."\nGAGAL: ".$e->getMessage());
            $exit = 1;
        } finally {
            DB::table('maximo_sync_runs')->where('id', $runId)->update(['status' => $exit === 0 ? 'OK' : 'FAILED', 'exit_code' => $exit, 'log' => $log, 'summary' => $summary === null ? null : json_encode($summary), 'finished_at' => now(),
                'done_units' => $summary['fetched'] ?? null, 'total_units' => $summary['chosen'] ?? null]);
            $this->runs->notifyFinished('maximo_sync_runs', $runId);
        }
    }

    /** "RINGKASAN daftar=7441 dipilih=5783 diambil=5783 gagal=0" printed by the tool. @return array<string,int>|null */
    private function summaryOf(string $log): ?array
    {
        if (preg_match_all('/RINGKASAN daftar=(\d+) dipilih=(\d+) diambil=(\d+) gagal=(\d+)/', $log, $m, PREG_SET_ORDER) < 1) {
            return null;
        }
        $x = end($m);

        return ['listed' => (int) $x[1], 'chosen' => (int) $x[2], 'fetched' => (int) $x[3], 'failed' => (int) $x[4]];
    }

    private function tail(string $log): string
    {
        return mb_strlen($log) > self::LOG_LIMIT ? mb_substr($log, -self::LOG_LIMIT) : $log;
    }
}
