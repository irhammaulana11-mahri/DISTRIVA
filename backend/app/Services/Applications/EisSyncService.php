<?php

namespace App\Services\Applications;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\EisReports\ApktRptRctSync;
use App\Services\EisReports\ApktSaidiSaifiSync;
use App\Services\MfaService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

/**
 * The EIS sync started from DISTRIVA: the EIS account (password encrypted, never returned), the Range Daya, the look-back window and the
 * automatic daily run are kept in eis_sync_settings; a run starts tools/eis_sync (Python, HTTP method) in a detached process that downloads
 * the EIS export and sends it through the import API with a short-lived token of the user the run belongs to. Every run is kept with its log.
 */
class EisSyncService
{
    private const LOG_LIMIT = 30000;

    /** @return array<string,mixed> */
    public function settings(): array
    {
        $s = DB::table('eis_sync_settings')->where('id', 1)->first();

        return ['eis_username' => $s->eis_username, 'has_password' => $s->eis_password_encrypted !== null, 'power_min' => (int) $s->power_min, 'power_max' => (int) $s->power_max,
            'lookback_days' => (int) $s->lookback_days, 'auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => $s->auto_time, 'updated_at' => $s->updated_at];
    }

    /**
     * @param  array<string,mixed>  $d  eis_username?, eis_password? (empty keeps the saved one), power_min, power_max, lookback_days, auto_enabled, auto_time
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor): array
    {
        $current = DB::table('eis_sync_settings')->where('id', 1)->first();
        $username = trim((string) ($d['eis_username'] ?? $current->eis_username));
        $password = filled($d['eis_password'] ?? null) ? Crypt::encryptString((string) $d['eis_password']) : $current->eis_password_encrypted;
        if ((int) $d['power_min'] > (int) $d['power_max']) {
            throw new AssignmentRuleViolation('Daya minimum tidak boleh lebih besar dari daya maksimum.');
        }
        if (! empty($d['auto_enabled'])) {
            if ($username === '' || $password === null) {
                throw new AssignmentRuleViolation('Isi user dan password EIS sebelum mengaktifkan sinkronisasi otomatis.');
            }
            if (app(MfaService::class)->state($actor)['required']) {
                throw new AssignmentRuleViolation('Sinkronisasi otomatis dijalankan atas nama penyimpannya dan tidak dapat memberi verifikasi MFA; simpan dari akun Niaga Retail UP3.');
            }
        }
        DB::table('eis_sync_settings')->where('id', 1)->update(['eis_username' => $username === '' ? null : $username, 'eis_password_encrypted' => $password, 'power_min' => (int) $d['power_min'], 'power_max' => (int) $d['power_max'],
            'lookback_days' => (int) $d['lookback_days'], 'auto_enabled' => (bool) $d['auto_enabled'], 'auto_time' => $d['auto_time'], 'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->settings();
    }

    /** Registers a run (QUEUED); one run at a time. @throws AssignmentRuleViolation */
    public function start(string $trigger, User $actor, ?string $from = null, ?string $to = null, ?array $units = null, bool $completeOld = false, string $kind = 'PERMOHONAN', ?array $options = null): string
    {
        $s = DB::table('eis_sync_settings')->where('id', 1)->first();
        if ($kind !== 'APKT' && ($s->eis_username === null || $s->eis_password_encrypted === null)) {
            throw new AssignmentRuleViolation('User dan password EIS belum diisi pada pengaturan sinkronisasi.');
        }
        $this->expireStale();
        if (DB::table('eis_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists()) {
            throw new AssignmentRuleViolation('Sinkronisasi EIS atau APKT sedang berjalan; tunggu sampai selesai.');
        }
        $id = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $id, 'trigger' => $trigger, 'status' => 'QUEUED', 'started_by' => $actor->getKey(), 'range_from' => $from, 'range_to' => $to, 'units' => $units === null || $units === [] ? null : json_encode(array_values($units)), 'mfa_verified_at' => $actor->currentAccessToken()?->mfa_verified_at, 'complete_old' => $trigger === 'MANUAL' && $completeOld, 'kind' => $kind, 'options' => $options === null ? null : json_encode($options), 'created_at' => now()]);

        return $id;
    }

    /** A run that never finished (the process died or never started) must not block the next one, or lock the button, forever. Called when a run starts and when the status is read. */
    public function expireStale(): void
    {
        DB::statement("update eis_sync_runs set options = options - 'token_encrypted' where jsonb_exists(options, 'token_encrypted') and status in ('QUEUED','RUNNING') and created_at < ?", [now()->subSeconds((int) config('distriva.eis_sync.timeout_seconds') + 600)]);
        DB::table('eis_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->where('created_at', '<', now()->subSeconds((int) config('distriva.eis_sync.timeout_seconds') + 600))
            ->update(['status' => 'FAILED', 'finished_at' => now(), 'log' => DB::raw("coalesce(log, '') || E'\\nDihentikan: proses tidak selesai.'")]);
    }

    /** Hands a registered run to a detached process (or runs it inline in tests). A process that cannot be started marks the run FAILED instead of leaving it waiting, and the error is passed on. */
    public function launch(string $runId): void
    {
        try {
            if (config('distriva.eis_sync.run_inline')) {
                Artisan::call('distriva:eis-sync-execute', ['id' => $runId]);

                return;
            }
            $cmd = sprintf('nohup %s artisan distriva:eis-sync-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($runId));
            Process::fromShellCommandline($cmd, base_path())->run();
        } catch (\Throwable $e) {
            $this->wipeToken($runId);
            DB::table('eis_sync_runs')->where('id', $runId)->whereIn('status', ['QUEUED', 'RUNNING'])->update(['status' => 'FAILED', 'finished_at' => now(), 'log' => mb_substr('Proses sinkronisasi tidak dapat dimulai: '.$e->getMessage(), 0, 500)]);

            throw $e;
        }
    }

    /** Called every minute by the scheduler: starts the automatic run when it is due (once per business day, even if it failed). */
    public function runScheduledIfDue(): ?string
    {
        $s = DB::table('eis_sync_settings')->where('id', 1)->first();
        if (! $s->auto_enabled || $s->updated_by === null) {
            return null;
        }
        $now = now(config('distriva.business_timezone'));
        if ($now->format('H:i') < $s->auto_time) {
            return null;
        }
        if (DB::table('eis_sync_runs')->where('trigger', 'AUTO')->where('created_at', '>=', $now->copy()->startOfDay()->utc())->exists()) {
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

    /** Runs the registered run to the end (inside the detached process): the log is kept up to date while it goes. */
    public function execute(string $runId): void
    {
        $run = DB::table('eis_sync_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        DB::table('eis_sync_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'started_at' => now()]);
        $log = '';
        $exit = 1;
        $token = null;
        try {
            if (($run->kind ?? 'PERMOHONAN') === 'APKT') {
                $sync = (json_decode((string) $run->options, true)['dataset'] ?? 'saidi-saifi') === 'rpt-rct-gangguan' ? app(ApktRptRctSync::class) : app(ApktSaidiSaifiSync::class);
                [$exit, $log] = $sync->run($run, fn (string $l) => DB::table('eis_sync_runs')->where('id', $runId)->update(['log' => $l]));

                return;
            }
            $s = DB::table('eis_sync_settings')->where('id', 1)->first();
            $user = User::query()->findOrFail($run->started_by);
            $token = $user->createToken('eis-sync', ['*'], now()->addMinutes((int) config('distriva.token_idle_minutes')));
            $token->accessToken->forceFill(['mfa_verified_at' => $run->mfa_verified_at])->save();
            $dir = (string) config('distriva.eis_sync.dir');
            $units = $run->units === null ? [] : (array) json_decode((string) $run->units, true);
            if (($run->kind ?? 'PERMOHONAN') === 'PIUTANG') {
                $o = (array) json_decode((string) $run->options, true);
                $args = [(string) config('distriva.eis_sync.python'), 'main.py', 'piutang', '--dari', (string) $o['from_month'], '--sampai', (string) $o['to_month'], '--laporan', implode(',', (array) $o['reports'])];
                $units !== [] && array_push($args, '--unit', implode(',', $units));
            } else {
                $args = [(string) config('distriva.eis_sync.python'), 'main.py', 'sync', '--metode', 'http', '--konfirmasi', '--per-unit'];      // unit by unit: choose the unit in EIS, download, upload, then the next one
                if ($run->range_from !== null && $run->range_to !== null) {
                    array_push($args, '--dari', (string) $run->range_from, '--sampai', (string) $run->range_to);
                }
                $run->complete_old || $args[] = '--tanpa-lengkapi';                       // the older range for running applications is only pulled when the user asked for it; the scheduled run pulls the configured range and nothing else
                $units !== [] && array_push($args, '--unit', implode(',', $units));          // only these units (ULP codes); without it every unit of the EIS combo runs
            }
            $env = ['EIS_USERNAME' => $s->eis_username, 'EIS_PASSWORD' => Crypt::decryptString($s->eis_password_encrypted), 'EIS_DAYA_MIN' => (string) $s->power_min, 'EIS_DAYA_MAX' => (string) $s->power_max,
                'EIS_LOOKBACK_DAYS' => (string) $s->lookback_days, 'EIS_HEADLESS' => '1', 'DISTRIVA_URL' => (string) config('distriva.eis_sync.api_url'), 'DISTRIVA_TOKEN' => $token->plainTextToken,
                'EIS_DOWNLOAD_DIR' => storage_path('app/private/eis-sync/'.$runId), 'PYTHONUNBUFFERED' => '1'];
            $process = new Process($args, $dir, $env, null, (float) config('distriva.eis_sync.timeout_seconds'));
            $last = 0.0;
            $exit = $process->run(function (string $type, string $buffer) use (&$log, &$last, $runId): void {
                $log = $this->tail($this->foldFinishedUnits($log.$buffer));
                if (microtime(true) - $last > 2) {
                    $last = microtime(true);
                    DB::table('eis_sync_runs')->where('id', $runId)->update(['log' => $log]);
                }
            });
        } catch (\Throwable $e) {
            $log = $this->tail($log."\nGAGAL: ".$e->getMessage());
        } finally {
            $this->wipeToken($runId);
            $token?->accessToken->delete();
            DB::table('eis_sync_runs')->where('id', $runId)->update(['status' => $exit === 0 ? 'OK' : 'FAILED', 'exit_code' => $exit, 'log' => $log, 'finished_at' => now()]);
        }
    }

    /** Token APKT yang ditempel pemakai hanya hidup selama proses berjalan: dihapus dari opsi run begitu selesai, gagal, atau kedaluwarsa. */
    private function wipeToken(string $runId): void
    {
        DB::statement("update eis_sync_runs set options = options - 'token_encrypted' where id = ? and jsonb_exists(options, 'token_encrypted')", [$runId]);
    }

    /**
     * Unit yang sudah selesai/gagal diringkas menjadi header + satu baris hitungan + baris penutup, supaya
     * pemotongan log (LOG_LIMIT) tidak menghapus penanda unit awal dan tabel hasil per unit tetap lengkap.
     */
    private function foldFinishedUnits(string $log): string
    {
        return (string) preg_replace_callback(
            '/(=== Unit \d+\/\d+: (\S+)[^\n]* ===\n)(.*?)(Unit \2 (?:selesai|GAGAL)[^\n]*(?:\n|$))/s',
            function (array $m): string {
                $counts = '/baru (\d+), cocok (\d+), tak berubah (\d+), ditolak (\d+)(?:, di luar cakupan (\d+))?/';
                $sum = [0, 0, 0, 0, 0];
                foreach (['Diterapkan', 'Tersimpan sementara'] as $prefix) {
                    foreach (preg_split('/\R/', $m[3]) ?: [] as $line) {
                        if (preg_match('/^(?:\[[^\]]*\] )?'.$prefix.'/', ltrim($line)) && preg_match($counts, $line, $c)) {
                            for ($i = 0; $i < 5; $i++) {
                                $sum[$i] += (int) ($c[$i + 1] ?? 0);
                            }
                        }
                    }
                    if (array_sum($sum) > 0) {
                        break;
                    }
                }
                $line = sprintf("Diterapkan: ringkasan [CONFIRMED] baru %d, cocok %d, tak berubah %d, ditolak %d, di luar cakupan %d\n", ...$sum);

                return $m[1].$line.$m[4];
            },
            $log,
        );
    }

    private function tail(string $log): string
    {
        return strlen($log) > self::LOG_LIMIT ? '…'.substr($log, -self::LOG_LIMIT) : $log;
    }
}
