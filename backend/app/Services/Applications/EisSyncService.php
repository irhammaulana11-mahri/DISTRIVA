<?php

namespace App\Services\Applications;

use App\Exceptions\AssignmentRuleViolation;
use App\Exceptions\SyncAlreadyRunning;
use App\Models\User;
use App\Services\EisReports\Ap2tTagsusSync;
use App\Services\EisReports\ApktRptRctSync;
use App\Services\EisReports\ApktSaidiSaifiSync;
use App\Services\MfaService;
use App\Services\Sync\SyncAccounts;
use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use App\Services\Sync\SyncUnitCodes;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
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

    public function __construct(private readonly SyncRuns $runs, private readonly SyncAccounts $accounts) {}

    /** @return array<string,mixed> */
    public function settings(?string $up3Id = null): array
    {
        $s = SyncScope::settings('eis_sync_settings', $up3Id);

        return ['eis_username' => $s->eis_username, 'has_password' => $s->eis_password_encrypted !== null, 'power_min' => (int) $s->power_min, 'power_max' => (int) $s->power_max,
            'lookback_days' => (int) $s->lookback_days, 'auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => $s->auto_time, 'updated_at' => $s->updated_at];
    }

    /**
     * @param  array<string,mixed>  $d  eis_username?, eis_password? (empty keeps the saved one), power_min, power_max, lookback_days, auto_enabled, auto_time
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor, string $up3Id): array
    {
        $current = SyncScope::settings('eis_sync_settings', $up3Id);
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
        DB::table('eis_sync_settings')->where('id', $current->id)->update(['eis_username' => $username === '' ? null : $username, 'eis_password_encrypted' => $password, 'power_min' => (int) $d['power_min'], 'power_max' => (int) $d['power_max'],
            'lookback_days' => (int) $d['lookback_days'], 'auto_enabled' => (bool) $d['auto_enabled'], 'auto_time' => $d['auto_time'], 'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->settings($up3Id);
    }

    /**
     * Registers the runs of one request (QUEUED). EIS pulls are split by account: every ULP with its own account gets a run, the others share one with the UP3 account; APKT and AP2T (session token) are one run.
     * All or nothing: when any ULP is already being synced, none is registered.
     *
     * @param  ?list<string>  $units  ULP codes; null = every ULP the caller may pull
     * @param  ?list<object>  $ulps  ULPs the caller may pull (id, code); null = every ULP of the UP3
     * @return list<string> run ids
     *
     * @throws AssignmentRuleViolation|SyncAlreadyRunning
     */
    public function start(string $trigger, User $actor, string $up3Id, ?string $from = null, ?string $to = null, ?array $units = null, bool $completeOld = false, string $kind = 'PERMOHONAN', ?array $options = null, ?array $ulps = null, ?string $scopeUnitId = null): array
    {
        $this->expireStale();
        [$source, $dataset] = match ($kind) {
            'APKT' => ['apkt', (string) ($options['dataset'] ?? 'saidi-saifi')],
            'AP2T' => ['ap2t', (string) ($options['dataset'] ?? 'tagsus')],
            default => ['eis', strtolower($kind)],
        };
        $source === 'apkt' && SyncUnitCodes::apkt($up3Id);     // tolak sejak awal bila id APKT UP3 belum diisi
        $all = SyncScope::ulps($up3Id);
        $chosen = array_values(array_filter($ulps ?? $all, fn (object $u) => $units === null || $units === [] || in_array((string) $u->code, $units, true)));
        if ($units !== null && $units !== []) {     // urutan yang dipilih pengguna dipertahankan
            $position = array_flip(array_values(array_unique($units)));
            usort($chosen, fn (object $a, object $b) => $position[(string) $a->code] <=> $position[(string) $b->code]);
        }
        $codeOf = [];
        foreach ($chosen as $u) {
            $codeOf[$u->id] = (string) $u->code;
        }
        $groups = $source === 'eis' ? $this->accounts->groups('eis', $up3Id, array_keys($codeOf)) : [['account_unit_id' => null, 'ulp_ids' => array_keys($codeOf)]];
        // satu run akun UP3 untuk seluruh UP3 tidak membawa daftar unit: alat menjalankan semua unit pada akun itu
        $wholeAccount = $source === 'eis' && ($units === null || $units === []) && count($groups) === 1 && $groups[0]['account_unit_id'] === null && count($codeOf) === count($all);

        return DB::transaction(fn () => array_map(function (array $group) use ($trigger, $actor, $up3Id, $from, $to, $completeOld, $kind, $options, $source, $dataset, $codeOf, $wholeAccount, $scopeUnitId): string {
            $codes = $wholeAccount ? [] : array_map(fn (string $id) => $codeOf[$id], $group['ulp_ids']);
            $id = (string) Str::uuid();
            $this->runs->register('eis_sync_runs', ['id' => $id, 'trigger' => $trigger, 'started_by' => $actor->getKey(), 'range_from' => $from, 'range_to' => $to, 'units' => $codes === [] ? null : json_encode($codes),
                'mfa_verified_at' => $actor->currentAccessToken()?->mfa_verified_at, 'complete_old' => $trigger === 'MANUAL' && $completeOld, 'kind' => $kind, 'options' => $options === null ? null : json_encode($options)],
                $up3Id, $source, $dataset, $group['ulp_ids'], $scopeUnitId, $group['account_unit_id']);

            return $id;
        }, $groups));
    }

    /** A run that never finished (the process died or never started) must not block the next one, or lock the button, forever. Called when a run starts and when the status is read. */
    public function expireStale(): void
    {
        $this->runs->expire('eis_sync_runs', (int) config('distriva.eis_sync.timeout_seconds') + 600, 'log');
        DB::statement("update eis_sync_runs set options = options - 'token_encrypted' where jsonb_exists(options, 'token_encrypted') and status = 'FAILED'");
    }

    /** Hands a registered run to a detached process (or runs it inline in tests). A process that cannot be started marks the run FAILED instead of leaving it waiting, and the error is passed on. */
    public function launch(string $runId): void
    {
        try {
            if (config('distriva.eis_sync.run_inline')) {
                Artisan::call('distriva:eis-sync-execute', ['id' => $runId]);

                return;
            }
            $this->runs->dispatch('eis_sync_runs', $runId, (int) config('distriva.eis_sync.timeout_seconds'));
        } catch (\Throwable $e) {
            $this->wipeToken($runId);
            DB::table('eis_sync_runs')->where('id', $runId)->whereIn('status', ['QUEUED', 'RUNNING'])->update(['status' => 'FAILED', 'finished_at' => now(), 'log' => mb_substr('Proses sinkronisasi tidak dapat dimulai: '.$e->getMessage(), 0, 500)]);

            throw $e;
        }
    }

    /** Called every minute by the scheduler: starts the automatic run of every UP3 whose time has come (once per business day, even if it failed). */
    public function runScheduledIfDue(): ?string
    {
        $now = now(config('distriva.business_timezone'));
        $first = null;
        foreach (DB::table('eis_sync_settings')->where('auto_enabled', true)->whereNotNull('updated_by')->orderBy('id')->get() as $s) {
            $up3Id = $s->up3_id ?? SyncScope::defaultUp3();
            $user = User::query()->find($s->updated_by);
            if ($up3Id === null || $user === null || $now->format('H:i') < $s->auto_time
                || DB::table('eis_sync_runs')->where('up3_id', $up3Id)->where('trigger', 'AUTO')->where('created_at', '>=', $now->copy()->startOfDay()->utc())->exists()) {
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
            if (($run->kind ?? 'PERMOHONAN') === 'AP2T') {
                [$exit, $log] = app(Ap2tTagsusSync::class)->run($run, fn (string $l) => DB::table('eis_sync_runs')->where('id', $runId)->update(['log' => $l]));

                return;
            }
            if (($run->kind ?? 'PERMOHONAN') === 'APKT') {
                $sync = in_array(json_decode((string) $run->options, true)['dataset'] ?? 'saidi-saifi', ['rpt-rct-gangguan', 'rpt-rct-keluhan', 'anomali-gangguan', 'anomali-keluhan'], true) ? app(ApktRptRctSync::class) : app(ApktSaidiSaifiSync::class);
                [$exit, $log] = $sync->run($run, fn (string $l) => DB::table('eis_sync_runs')->where('id', $runId)->update(['log' => $l]));

                return;
            }
            $s = SyncScope::settings('eis_sync_settings', $run->up3_id);
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
            $account = $this->accounts->credentials('eis', $run->up3_id, $run->account_unit_id);
            $env = ['EIS_USERNAME' => $account['username'], 'EIS_PASSWORD' => $account['password'], 'EIS_DAYA_MIN' => (string) $s->power_min, 'EIS_DAYA_MAX' => (string) $s->power_max,
                'EIS_LOOKBACK_DAYS' => (string) $s->lookback_days, 'EIS_HEADLESS' => '1', 'DISTRIVA_URL' => (string) config('distriva.eis_sync.api_url'), 'DISTRIVA_TOKEN' => $token->plainTextToken,
                'EIS_DOWNLOAD_DIR' => storage_path('app/private/eis-sync/'.$runId), 'EIS_COOKIE_FILE' => storage_path('app/private/eis-sync/session/'.($run->account_unit_id ?? $run->up3_id).'.json'), 'PYTHONUNBUFFERED' => '1'];
            // laporan tingkat UP3 (mis. saldo prabayar) memakai kode UP3 pemicu, bukan bawaan alat
            $up3Code = SyncUnitCodes::otherUp3Code($run->up3_id);
            $up3Code !== null && $env['EIS_UP3_CODE'] = $up3Code;
            $process = new Process($args, $dir, $env, null, (float) config('distriva.eis_sync.timeout_seconds'));
            $last = 0.0;
            $exit = $process->run(function (string $type, string $buffer) use (&$log, &$last, $runId): void {
                $log = $this->tail($this->foldFinishedUnits($log.$buffer));
                if (preg_match_all('/=== Unit (\d+)\/(\d+):/', $buffer, $m, PREG_SET_ORDER) > 0) {
                    $unit = end($m);
                    $this->runs->progress('eis_sync_runs', $runId, (int) $unit[1] - 1, (int) $unit[2]);
                }
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
            $exit === 0 && DB::statement('update eis_sync_runs set done_units = total_units where id = ?', [$runId]);
            File::deleteDirectory(storage_path('app/private/eis-sync/'.$runId));     // berkas unduhan sementara milik run ini
            $this->runs->notifyFinished('eis_sync_runs', $runId);
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
