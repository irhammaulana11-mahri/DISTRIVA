<?php

namespace App\Services\Backup;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\Process\Process;

/**
 * Backup, verification and restore of the database (+ optionally the documents folder) — docs/64. Writes only; controllers authorize first.
 *
 * Safety rules (owner standing rules): a restore needs a backup that was VERIFIED (restored into a throw-away database and checked), takes a
 * PRE_RESTORE safety backup first, runs in ONE transaction (all or nothing), and never touches the backup_* history tables (excluded from dumps).
 * Secrets: the database password only travels in the child process environment; error text is cut and scrubbed before it is stored.
 */
class BackupService
{
    /** history tables: never part of a dump, so a restore cannot rewind or lose them */
    private const HISTORY_TABLES = ['backup_runs', 'restore_runs', 'backup_settings', 'backup_events'];

    private const COUNTED = ['users', 'applications', 'application_documents', 'application_surveys', 'application_drawings', 'mto_packages', 'bom_headers', 'khs_items', 'construction_types', 'organizational_units', 'permissions', 'migrations'];

    // ---- paths / configuration ---------------------------------------------------------------------------

    public function root(): string
    {
        $root = rtrim((string) config('distriva.backup.root'), '/');
        if ($root === '' || ! str_starts_with($root, '/')) {
            throw new AssignmentRuleViolation('DISTRIVA_BACKUP_ROOT harus berupa path absolut.');
        }
        foreach ([public_path(), base_path('public'), storage_path('app/public')] as $public) {
            if (str_starts_with($root.'/', rtrim($public, '/').'/')) {
                throw new AssignmentRuleViolation('DISTRIVA_BACKUP_ROOT berada di folder publik; cadangan harus privat.');
            }
        }
        $docs = $this->docsRoot();
        if ($docs !== '' && str_starts_with($root.'/', $docs.'/')) {
            throw new AssignmentRuleViolation('Folder cadangan tidak boleh berada di dalam folder dokumen.');
        }
        if (! is_dir($root) && ! @mkdir($root, 0700, true) && ! is_dir($root)) {
            throw new AssignmentRuleViolation('Folder cadangan tidak dapat dibuat.');
        }
        if (! is_writable($root)) {
            throw new AssignmentRuleViolation('Folder cadangan tidak dapat ditulis.');
        }

        return $root;
    }

    /** The documents folder as the storage disk itself reports it (also right for a faked disk). */
    public function docsRoot(): string
    {
        return rtrim(Storage::disk((string) config('distriva.documents_disk', 'documents'))->path(''), '/');
    }

    /** @return array<string,mixed> */
    public function health(): array
    {
        try {
            $root = $this->root();
            $free = @disk_free_space($root);

            return ['ok' => true, 'root_writable' => true, 'free_bytes' => $free === false ? null : (int) $free, 'message' => null];
        } catch (AssignmentRuleViolation $e) {
            return ['ok' => false, 'root_writable' => false, 'free_bytes' => null, 'message' => $e->getMessage()];
        }
    }

    private function conn(): array
    {
        return (array) config('database.connections.'.config('database.default'));
    }

    private function sourceDatabase(): string
    {
        return (string) $this->conn()['database'];
    }

    private function targetDatabase(): string
    {
        $override = config('distriva.backup.target_database');

        return $override && app()->environment('testing') ? (string) $override : $this->sourceDatabase();
    }

    // ---- creating a backup -------------------------------------------------------------------------------

    /** Registers a RUNNING backup and returns its id; the work itself is done by execute(). */
    public function start(string $trigger, bool $includeDocuments, ?string $notes, ?User $actor, bool $duringRestore = false): string
    {
        $this->root();
        $this->failStale();
        if (! $duringRestore && DB::table('restore_runs')->where('status', 'RUNNING')->exists()) {
            throw new AssignmentRuleViolation('Pemulihan sedang berjalan.');
        }
        $id = (string) Str::uuid();
        $now = now();
        try {
            DB::table('backup_runs')->insert(['id' => $id, 'backup_number' => 'BKP-'.$now->format('Ymd-His').'-'.substr($id, 0, 4), 'trigger' => $trigger, 'status' => 'RUNNING', 'include_documents' => $includeDocuments,
                'notes' => $notes === null ? null : mb_substr(trim($notes), 0, 500), 'requested_by' => $actor?->getKey(), 'started_at' => $now]);
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'backup_runs_one_running')) {
                throw new AssignmentRuleViolation('Ada pencadangan yang sedang berjalan; tunggu sampai selesai.');
            }
            throw $e;
        }
        $this->event('BACKUP_STARTED', $actor, ['trigger' => $trigger, 'include_documents' => $includeDocuments], $id);

        return $id;
    }

    public function execute(string $id): void
    {
        $run = DB::table('backup_runs')->where('id', $id)->first();
        if ($run === null || $run->status !== 'RUNNING') {
            return;
        }
        $actor = $run->requested_by ? User::query()->find($run->requested_by) : null;
        $dbPath = null;
        $docsPath = null;
        try {
            $dir = $this->root().'/'.now()->format('Y-m');
            @mkdir($dir, 0700, true);
            $base = $dir.'/'.$run->backup_number;
            $counts = $this->counts(DB::connection());
            $schema = (string) DB::table('migrations')->orderByDesc('id')->value('migration');

            $dbPath = $base.'.dump';
            $args = [config('distriva.backup.pg_dump'), '-Fc', '--no-owner', '--no-privileges', '-f', $dbPath, '-d', $this->sourceDatabase()];
            foreach (self::HISTORY_TABLES as $t) {
                $args[] = '--exclude-table='.$t;
            }
            $this->process($args);
            @chmod($dbPath, 0600);
            $entries = $this->entries($dbPath);

            $docs = ['docs_file' => null, 'docs_size' => null, 'docs_sha256' => null];
            if ($run->include_documents) {
                $docsRoot = $this->docsRoot();
                if ($docsRoot !== '' && is_dir($docsRoot)) {
                    $docsPath = $base.'-documents.tar.gz';
                    $this->process([config('distriva.backup.tar'), '-czf', $docsPath, '-C', $docsRoot, '.']);
                    @chmod($docsPath, 0600);
                    $docs = ['docs_file' => $this->relative($docsPath), 'docs_size' => filesize($docsPath), 'docs_sha256' => hash_file('sha256', $docsPath)];
                }
            }

            DB::table('backup_runs')->where('id', $id)->update($docs + ['db_file' => $this->relative($dbPath), 'db_size' => filesize($dbPath), 'db_sha256' => hash_file('sha256', $dbPath), 'db_entries' => $entries,
                'schema_version' => $schema, 'table_counts' => json_encode($counts), 'status' => 'SUCCEEDED', 'finished_at' => now()]);
            $this->event('BACKUP_SUCCEEDED', $actor, ['db_size' => filesize($dbPath), 'entries' => $entries, 'documents' => $docs['docs_file'] !== null], $id);
            $this->prune();
        } catch (\Throwable $e) {
            foreach ([$dbPath, $docsPath] as $f) {
                if ($f !== null && is_file($f)) {
                    @unlink($f);
                }
            }
            $msg = $this->scrub($e->getMessage());
            DB::table('backup_runs')->where('id', $id)->update(['status' => 'FAILED', 'error' => $msg, 'finished_at' => now()]);
            $this->event('BACKUP_FAILED', $actor, ['error' => $msg], $id);
        }
    }

    // ---- verification ------------------------------------------------------------------------------------

    /** Restores the dump into a throw-away database and compares it with what the backup recorded. Marks the backup verified when it passes. */
    public function verify(string $id, ?User $actor): array
    {
        $run = $this->succeeded($id);
        $path = $this->absolute($run->db_file);
        $temp = 'distriva_verify_'.Str::lower(Str::random(10));
        $result = ['passed' => false, 'checks' => []];
        try {
            $sha = hash_file('sha256', $path);
            $result['checks']['sha256_matches'] = $sha === $run->db_sha256;
            $this->psql('postgres', 'CREATE DATABASE '.$temp);
            $this->process([config('distriva.backup.pg_restore'), '--no-owner', '--no-privileges', '--exit-on-error', '-d', $temp, $path]);
            $restored = $this->psqlJson($temp);
            $expected = (array) json_decode((string) $run->table_counts, true);
            $result['checks']['restore_completed'] = true;
            $result['checks']['schema_version_present'] = ($restored['__schema'] ?? null) === $run->schema_version;
            $result['restored_counts'] = array_diff_key($restored, ['__schema' => 1]);
            $result['recorded_counts'] = $expected;
            // writes made while the dump was running may move a counter; only the migrations table must match exactly
            $result['checks']['migrations_count_matches'] = ($restored['migrations'] ?? null) === ($expected['migrations'] ?? -1);
            $result['differences'] = array_keys(array_filter($expected, fn ($n, $t) => ($restored[$t] ?? null) !== $n, ARRAY_FILTER_USE_BOTH));
            $result['passed'] = ! in_array(false, $result['checks'], true);
        } catch (\Throwable $e) {
            $result['error'] = $this->scrub($e->getMessage());
        } finally {
            try {
                $this->psql('postgres', 'DROP DATABASE IF EXISTS '.$temp);
            } catch (\Throwable) {
                $result['cleanup_warning'] = "Database sementara {$temp} perlu dihapus manual.";
            }
        }
        DB::table('backup_runs')->where('id', $id)->update(['verified_at' => $result['passed'] ? now() : null, 'verify_result' => json_encode($result)]);
        $this->event($result['passed'] ? 'VERIFIED' : 'VERIFY_FAILED', $actor, ['passed' => $result['passed'], 'differences' => $result['differences'] ?? null, 'error' => $result['error'] ?? null], $id);

        return $result;
    }

    // ---- restore -----------------------------------------------------------------------------------------

    /** Registers a RUNNING restore after every precondition; execution is done by executeRestore(). @return string restore run id */
    public function startRestore(string $backupId, bool $restoreDocuments, string $reason, User $actor): string
    {
        $run = $this->succeeded($backupId);
        $this->root();
        $this->failStale();
        if ($run->verified_at === null) {
            throw new AssignmentRuleViolation('Cadangan ini belum diverifikasi. Jalankan verifikasi (uji pemulihan ke database sementara) terlebih dahulu.');
        }
        $current = (string) DB::table('migrations')->orderByDesc('id')->value('migration');
        if ($run->schema_version !== $current) {
            throw new AssignmentRuleViolation("Cadangan dibuat pada versi skema {$run->schema_version}, sedangkan aplikasi sekarang {$current}; pemulihan harus dilakukan manual oleh administrator.");
        }
        if ($restoreDocuments && $run->docs_file === null) {
            throw new AssignmentRuleViolation('Cadangan ini tidak memuat folder dokumen.');
        }
        if (DB::table('backup_runs')->where('status', 'RUNNING')->exists()) {
            throw new AssignmentRuleViolation('Ada pencadangan yang sedang berjalan; tunggu sampai selesai.');
        }
        $id = (string) Str::uuid();
        try {
            DB::table('restore_runs')->insert(['id' => $id, 'backup_run_id' => $run->id, 'backup_number' => $run->backup_number, 'status' => 'RUNNING', 'restore_documents' => $restoreDocuments,
                'reason' => mb_substr(trim($reason), 0, 1000), 'requested_by' => $actor->getKey(), 'started_at' => now()]);
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'restore_runs_one_running')) {
                throw new AssignmentRuleViolation('Pemulihan lain sedang berjalan.');
            }
            throw $e;
        }
        $this->event('RESTORE_STARTED', $actor, ['backup' => $run->backup_number, 'restore_documents' => $restoreDocuments, 'reason' => $reason], $run->id, $id);

        return $id;
    }

    public function executeRestore(string $restoreId): void
    {
        $r = DB::table('restore_runs')->where('id', $restoreId)->first();
        if ($r === null || $r->status !== 'RUNNING') {
            return;
        }
        $actor = User::query()->find($r->requested_by);
        try {
            $run = $this->succeeded($r->backup_run_id);
            $path = $this->absolute($run->db_file);
            if (hash_file('sha256', $path) !== $run->db_sha256) {
                throw new AssignmentRuleViolation('Berkas cadangan berubah sejak dibuat (sha256 tidak cocok); pemulihan dibatalkan.');
            }

            // 1. the safety net: the state we are about to replace
            $safety = $this->start('PRE_RESTORE', (bool) $r->restore_documents, "Pengaman sebelum memulihkan {$run->backup_number}", $actor, true);
            $this->execute($safety);
            if (DB::table('backup_runs')->where('id', $safety)->value('status') !== 'SUCCEEDED') {
                throw new AssignmentRuleViolation('Cadangan pengaman sebelum pemulihan gagal; pemulihan dibatalkan dan data tidak diubah.');
            }
            DB::table('restore_runs')->where('id', $restoreId)->update(['safety_backup_id' => $safety]);

            // 2. all-or-nothing replacement of the data
            $this->process([config('distriva.backup.pg_restore'), '--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', '-d', $this->targetDatabase(), $path]);

            // 3. documents: only files that are missing are added; nothing present is overwritten or deleted
            if ($r->restore_documents) {
                $docsRoot = $this->docsRoot();
                @mkdir($docsRoot, 0750, true);
                $this->process([config('distriva.backup.tar'), '-xzf', $this->absolute($run->docs_file), '--skip-old-files', '-C', $docsRoot]);
            }
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            DB::table('restore_runs')->where('id', $restoreId)->update(['status' => 'SUCCEEDED', 'finished_at' => now()]);
            $this->event('RESTORE_SUCCEEDED', $actor, ['backup' => $run->backup_number, 'safety_backup' => $safety], $run->id, $restoreId);
        } catch (\Throwable $e) {
            $msg = $this->scrub($e->getMessage());
            DB::table('restore_runs')->where('id', $restoreId)->update(['status' => 'FAILED', 'error' => $msg, 'finished_at' => now()]);
            $this->event('RESTORE_FAILED', $actor, ['error' => $msg], $r->backup_run_id, $restoreId);
        }
    }

    // ---- housekeeping ------------------------------------------------------------------------------------

    public function remove(string $id, string $reason, User $actor): void
    {
        $run = DB::table('backup_runs')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($run->status === 'RUNNING') {
            throw new AssignmentRuleViolation('Cadangan yang sedang berjalan tidak dapat dihapus.');
        }
        if ($run->status === 'DELETED') {
            throw new AssignmentRuleViolation('Cadangan sudah dihapus.');
        }
        if (DB::table('restore_runs')->where('status', 'RUNNING')->where(fn ($q) => $q->where('backup_run_id', $id)->orWhere('safety_backup_id', $id))->exists()) {
            throw new AssignmentRuleViolation('Cadangan sedang dipakai oleh pemulihan.');
        }
        $this->deleteFiles($run);
        DB::table('backup_runs')->where('id', $id)->update(['status' => 'DELETED', 'deleted_at' => now()]);
        $this->event('DELETED', $actor, ['reason' => $reason, 'backup' => $run->backup_number], $id);
    }

    /** Keeps the newest N manual/scheduled backups and the newest few safety backups; older files are removed (the record stays). */
    public function prune(): int
    {
        $keep = (int) (DB::table('backup_settings')->value('retention_count') ?? 14);
        $pruned = 0;
        foreach ([['trigger' => ['MANUAL', 'SCHEDULED'], 'keep' => $keep], ['trigger' => ['PRE_RESTORE'], 'keep' => (int) config('distriva.backup.kept_pre_restore', 5)]] as $set) {
            $old = DB::table('backup_runs')->where('status', 'SUCCEEDED')->whereIn('trigger', $set['trigger'])->orderByDesc('started_at')->get()->slice($set['keep']);
            foreach ($old as $run) {
                $this->deleteFiles($run);
                DB::table('backup_runs')->where('id', $run->id)->update(['status' => 'DELETED', 'deleted_at' => now()]);
                $this->event('RETENTION_PRUNED', null, ['backup' => $run->backup_number], $run->id);
                $pruned++;
            }
        }

        return $pruned;
    }

    /** Is the scheduled backup due now? (called every minute by the scheduler) */
    public function runScheduledIfDue(): ?string
    {
        $s = DB::table('backup_settings')->first();
        if ($s === null || ! $s->enabled) {
            return null;
        }
        $now = now(config('distriva.business_timezone'));
        if ($now->format('H:i') < $s->run_at) {
            return null;
        }
        $todayStart = $now->copy()->startOfDay()->utc();
        if (DB::table('backup_runs')->where('trigger', 'SCHEDULED')->where('started_at', '>=', $todayStart)->exists()) {
            return null;                                                     // one scheduled attempt per business day (a failure is visible, never retried in a loop)
        }
        try {
            $id = $this->start('SCHEDULED', (bool) $s->include_documents, 'Terjadwal', null);
        } catch (AssignmentRuleViolation) {
            return null;
        }
        $this->execute($id);

        return $id;
    }

    /** Hands a prepared run to a detached process (or runs it inline in tests). */
    public function launch(string $command, string $argument): void
    {
        if (config('distriva.backup.run_inline')) {
            Artisan::call($command, ['id' => $argument]);

            return;
        }
        $cmd = sprintf('nohup %s artisan %s %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($command), escapeshellarg($argument));
        Process::fromShellCommandline($cmd, base_path())->run();
    }

    public function absolute(string $relative): string
    {
        $path = $this->root().'/'.ltrim($relative, '/');
        if (str_contains($relative, '..') || ! is_file($path)) {
            throw new AdministrationDenied('Berkas cadangan tidak ditemukan.', 404);
        }

        return $path;
    }

    // ---- internals ---------------------------------------------------------------------------------------

    private function succeeded(string $id): object
    {
        $run = DB::table('backup_runs')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($run->status !== 'SUCCEEDED') {
            throw new AssignmentRuleViolation("Cadangan berstatus {$run->status}; hanya cadangan yang berhasil dapat dipakai.");
        }

        return $run;
    }

    private function failStale(): void
    {
        $limit = now()->subMinutes((int) config('distriva.backup.stale_after_minutes', 180));
        DB::table('backup_runs')->where('status', 'RUNNING')->where('started_at', '<', $limit)->update(['status' => 'FAILED', 'error' => 'Proses tidak selesai (dianggap gagal).', 'finished_at' => now()]);
        DB::table('restore_runs')->where('status', 'RUNNING')->where('started_at', '<', $limit)->update(['status' => 'FAILED', 'error' => 'Proses tidak selesai (dianggap gagal).', 'finished_at' => now()]);
    }

    private function deleteFiles(object $run): void
    {
        foreach ([$run->db_file, $run->docs_file] as $rel) {
            if ($rel !== null && ! str_contains($rel, '..')) {
                @unlink($this->root().'/'.ltrim($rel, '/'));
            }
        }
    }

    private function relative(string $path): string
    {
        return ltrim(substr($path, strlen($this->root())), '/');
    }

    /** @return array<string,int> */
    private function counts($connection): array
    {
        $out = [];
        foreach (self::COUNTED as $t) {
            if (Schema::hasTable($t)) {
                $out[$t] = (int) $connection->table($t)->count();
            }
        }

        return $out;
    }

    private function entries(string $dump): int
    {
        $out = $this->process([config('distriva.backup.pg_restore'), '-l', $dump]);

        return count(array_filter(explode("\n", $out), fn ($l) => $l !== '' && $l[0] !== ';'));
    }

    private function psql(string $database, string $sql): string
    {
        return $this->process([config('distriva.backup.psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', $database, '-c', $sql]);
    }

    /** @return array<string,mixed> row counts of the key tables of a (restored) database plus the last migration name */
    private function psqlJson(string $database): array
    {
        $parts = [];
        foreach (self::COUNTED as $t) {
            $parts[] = "'{$t}', (SELECT count(*) FROM {$t})";
        }
        $parts[] = "'__schema', (SELECT migration FROM migrations ORDER BY id DESC LIMIT 1)";
        $json = trim($this->psql($database, 'SELECT json_build_object('.implode(', ', $parts).')'));

        return (array) json_decode($json, true);
    }

    /** @param list<string> $args */
    private function process(array $args): string
    {
        $c = $this->conn();
        $env = ['PGHOST' => (string) ($c['host'] ?? '127.0.0.1'), 'PGPORT' => (string) ($c['port'] ?? '5432'), 'PGUSER' => (string) ($c['username'] ?? ''), 'PGPASSWORD' => (string) ($c['password'] ?? '')];
        $p = new Process($args, null, $env, null, (float) config('distriva.backup.timeout_seconds', 3600));
        $p->run();
        if (! $p->isSuccessful()) {
            throw new \RuntimeException(basename((string) $args[0]).' gagal (kode '.$p->getExitCode().'): '.trim($p->getErrorOutput()));
        }

        return $p->getOutput();
    }

    private function scrub(string $message): string
    {
        $secret = (string) ($this->conn()['password'] ?? '');
        if ($secret !== '') {
            $message = str_replace($secret, '***', $message);
        }

        return mb_substr($message, 0, 1500);
    }

    /** @param array<string,mixed> $details */
    public function event(string $type, ?User $actor, array $details, ?string $backupId = null, ?string $restoreId = null): void
    {
        DB::table('backup_events')->insert(['id' => (string) Str::uuid(), 'backup_run_id' => $backupId, 'restore_run_id' => $restoreId, 'event_type' => $type, 'actor_user_id' => $actor?->getKey(),
            'details' => json_encode((object) $details), 'occurred_at' => now()]);
    }
}
