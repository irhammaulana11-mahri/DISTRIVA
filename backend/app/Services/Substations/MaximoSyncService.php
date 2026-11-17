<?php

namespace App\Services\Substations;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
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

    public function __construct(private readonly MaximoWoLoadService $load) {}

    /** @return array<string,mixed> */
    public function settings(): array
    {
        $s = DB::table('maximo_sync_settings')->where('id', 1)->first();

        return ['maximo_url' => $s->maximo_url, 'maximo_username' => $s->maximo_username, 'has_password' => $s->maximo_password_encrypted !== null, 'work_type' => $s->work_type,
            'lookback_days' => (int) $s->lookback_days, 'auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => $s->auto_time, 'updated_at' => $s->updated_at];
    }

    /**
     * @param  array<string,mixed>  $d  maximo_url, maximo_username?, maximo_password? (empty keeps the saved one), work_type, lookback_days, auto_enabled, auto_time
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor): array
    {
        $current = DB::table('maximo_sync_settings')->where('id', 1)->first();
        $username = trim((string) ($d['maximo_username'] ?? $current->maximo_username));
        $password = filled($d['maximo_password'] ?? null) ? Crypt::encryptString((string) $d['maximo_password']) : $current->maximo_password_encrypted;
        if (! empty($d['auto_enabled']) && ($username === '' || $password === null)) {
            throw new AssignmentRuleViolation('Isi user dan password Maximo sebelum mengaktifkan sinkronisasi otomatis.');
        }
        DB::table('maximo_sync_settings')->where('id', 1)->update(['maximo_url' => rtrim((string) $d['maximo_url'], '/'), 'maximo_username' => $username === '' ? null : $username, 'maximo_password_encrypted' => $password,
            'work_type' => mb_strtoupper(trim((string) $d['work_type'])), 'lookback_days' => (int) $d['lookback_days'], 'auto_enabled' => (bool) $d['auto_enabled'], 'auto_time' => $d['auto_time'],
            'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->settings();
    }

    /** Registers a run (QUEUED); one run at a time. `$since` = work orders finished on or after it (default: the look-back window). @throws AssignmentRuleViolation */
    public function start(string $trigger, User $actor, ?string $since = null, bool $allWorkOrders = false): string
    {
        $s = DB::table('maximo_sync_settings')->where('id', 1)->first();
        if ($s->maximo_username === null || $s->maximo_password_encrypted === null) {
            throw new AssignmentRuleViolation('User dan password Maximo belum diisi pada pengaturan sinkronisasi.');
        }
        // a run that never finished (the process died) must not block the next one forever
        DB::table('maximo_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->where('created_at', '<', now()->subSeconds((int) config('distriva.maximo_sync.timeout_seconds') + 600))
            ->update(['status' => 'FAILED', 'finished_at' => now(), 'log' => DB::raw("coalesce(log, '') || E'\\nDihentikan: proses tidak selesai.'")]);
        if (DB::table('maximo_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists()) {
            throw new AssignmentRuleViolation('Sinkronisasi Maximo sedang berjalan; tunggu sampai selesai.');
        }
        $since ??= CarbonImmutable::now((string) config('distriva.business_timezone'))->subDays((int) $s->lookback_days)->toDateString();
        $id = (string) Str::uuid();
        DB::table('maximo_sync_runs')->insert(['id' => $id, 'trigger' => $trigger, 'status' => 'QUEUED', 'started_by' => $actor->getKey(), 'since' => $since, 'all_work_orders' => $allWorkOrders, 'created_at' => now()]);

        return $id;
    }

    /** Hands a registered run to a detached process (or runs it inline in tests). */
    public function launch(string $runId): void
    {
        if (config('distriva.maximo_sync.run_inline')) {
            Artisan::call('distriva:maximo-sync-execute', ['id' => $runId]);

            return;
        }
        $cmd = sprintf('nohup %s artisan distriva:maximo-sync-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($runId));
        Process::fromShellCommandline($cmd, base_path())->run();
    }

    /** Called every minute by the scheduler: starts the automatic run when it is due (once per business day, even if it failed). */
    public function runScheduledIfDue(): ?string
    {
        $s = DB::table('maximo_sync_settings')->where('id', 1)->first();
        if (! $s->auto_enabled || $s->updated_by === null) {
            return null;
        }
        $now = now(config('distriva.business_timezone'));
        if ($now->format('H:i') < $s->auto_time || DB::table('maximo_sync_runs')->where('trigger', 'AUTO')->where('created_at', '>=', $now->copy()->startOfDay()->utc())->exists()) {
            return null;
        }
        $user = User::query()->find($s->updated_by);
        if ($user === null) {
            return null;
        }
        try {
            $id = $this->start('AUTO', $user);
        } catch (AssignmentRuleViolation) {
            return null;
        }
        $this->launch($id);

        return $id;
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
            $s = DB::table('maximo_sync_settings')->where('id', 1)->first();
            $user = User::query()->findOrFail($run->started_by);
            $dir = (string) config('distriva.maximo_sync.dir');
            $args = [(string) config('distriva.maximo_sync.python'), 'main.py', 'ambil', '--sejak', CarbonImmutable::parse((string) $run->since)->format('d/m/Y'), '--tipe', (string) $s->work_type, '--tambah'];
            $run->all_work_orders && $args[] = '--semua';
            $env = ['MAXIMO_URL' => $s->maximo_url, 'MAXIMO_USERNAME' => $s->maximo_username, 'MAXIMO_PASSWORD' => Crypt::decryptString($s->maximo_password_encrypted), 'PYTHONUNBUFFERED' => '1'];
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
            $csv = $dir.'/out/maximo-wo-pengukuran.csv';
            if ($exit === 0 && is_file($csv)) {
                $r = $this->load->load($csv, $user);
                $summary['load'] = $r['counts'];
                $log = $this->tail($log."\nPemuatan ke pembacaan gardu: ".json_encode($r['counts']).(($r['problems']['unknown_gardu'] ?? []) !== [] ? "\nGardu belum ada di master (sebagian): ".implode(', ', array_slice($r['problems']['unknown_gardu'], 0, 10)) : ''));
            }
        } catch (\Throwable $e) {
            $log = $this->tail($log."\nGAGAL: ".$e->getMessage());
            $exit = 1;
        } finally {
            DB::table('maximo_sync_runs')->where('id', $runId)->update(['status' => $exit === 0 ? 'OK' : 'FAILED', 'exit_code' => $exit, 'log' => $log, 'summary' => $summary === null ? null : json_encode($summary), 'finished_at' => now()]);
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
