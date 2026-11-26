<?php

namespace App\Services\Substations;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process as SymfonyProcess;
use Throwable;

/**
 * DIL sync from Master Pelanggan (docs/81, docs/85): the .mdb / .csv files of the DIL are placed in the inbox folder on the server and read there. Only that folder is ever read (the user never
 * chooses a path), symbolic links and other file types are ignored, and the rows go through the same ConnectionService as the command-line tool: only the columns the master needs are taken,
 * names are masked, NIK / NPWP / phone / e-mail / address / coordinates are never read. A file that loaded completely is moved to `diproses/`.
 */
class DilSyncService
{
    /** DIL column => field of the item that ConnectionService accepts (the ONLY columns that are read). */
    private const COLUMNS = [
        'IDPEL' => 'idpel', 'UNITUP' => 'unit_code', 'NAMA' => 'name', 'TARIF' => 'tariff_code', 'DAYA' => 'power_va', 'JENISLAYANAN' => 'service_type', 'KODE_FASA' => 'phase_code',
        'NOMOR_METER_KWH' => 'meter_number', 'NOMOR_METER_PREPAID' => 'meter_prepaid', 'NAMA_KELURAHAN' => 'kelurahan', 'NAMA_KECAMATAN' => 'kecamatan', 'NAMA_KABUPATEN' => 'kabupaten',
        'TGLNYALA_PB' => 'energized_on', 'NOMOR_GARDU' => 'gardu_ref', 'NAMA_GARDU' => 'gardu_name', 'STATUS_DIL' => 'status', 'V_BULAN_REKAP' => 'snapshot_month',
    ];

    private const REQUIRED = ['IDPEL', 'UNITUP', 'NOMOR_GARDU', 'STATUS_DIL'];

    private const CHUNK = 1000;

    private const STALE_HOURS = 8;

    public function __construct(private readonly ConnectionService $connections, private readonly ApplicationAuthorizer $authorizer) {}

    public function inbox(): string
    {
        $dir = (string) config('distriva.dil.inbox');
        if (! is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }

        return $dir;
    }

    /** The inbox as people read it: relative to the project when it lies inside it. */
    public function inboxLabel(): string
    {
        $inbox = $this->inbox();
        $base = rtrim(base_path(), '/').'/';

        return str_starts_with($inbox, $base) ? substr($inbox, strlen($base)) : $inbox;
    }

    /** @return list<array{name:string,size:int,modified:string,kind:string,ulp_code:?string,month:?string}> */
    public function files(): array
    {
        $out = [];
        foreach (@scandir($this->inbox()) ?: [] as $name) {
            $path = $this->inbox().'/'.$name;
            $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            if ($name[0] === '.' || ! in_array($ext, ['mdb', 'csv'], true) || is_link($path) || ! is_file($path)) {
                continue;
            }
            $out[] = ['name' => $name, 'size' => (int) filesize($path), 'modified' => date('c', (int) filemtime($path)), 'kind' => $ext,
                'ulp_code' => preg_match('/(\d{5})\.(mdb|csv)$/i', $name, $m) ? $m[1] : null, 'month' => preg_match('/_(\d{6})_/', $name, $m) ? $m[1] : null];
        }
        usort($out, fn ($a, $b) => strcmp($a['name'], $b['name']));

        return $out;
    }

    public function mdbtoolsAvailable(): bool
    {
        $p = new SymfonyProcess([(string) config('distriva.dil.mdb_export'), '--version']);
        try {
            $p->run();

            return $p->isSuccessful() || str_contains(strtolower($p->getOutput().$p->getErrorOutput()), 'mdb');
        } catch (Throwable) {
            return false;
        }
    }

    /** @return array<string,mixed> */
    public function info(): array
    {
        $this->expireStale();
        $recent = DB::table('dil_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->orderByDesc('r.created_at')->limit(15)->get(['r.*', 'u.name as started_by_name'])->map(fn ($r) => $this->present($r))->all();
        $files = $this->files();

        return ['inbox' => $this->inboxLabel(), 'files' => $files, 'mdbtools' => $this->mdbtoolsAvailable(), 'needs_mdbtools' => (bool) array_filter($files, fn ($f) => $f['kind'] === 'mdb'), 'units' => $this->units($files, $recent), 'unrecognised_files' => array_values(array_filter($files, fn ($f) => $f['ulp_code'] === null)),
            'accepted' => ['.mdb', '.csv'], 'naming' => 'DIL_SALDO_MASK_UP_<YYYYMM>_<kode ULP 5 digit>.mdb', 'active' => collect($recent)->first(fn ($r) => in_array($r['status'], ['QUEUED', 'RUNNING'], true)), 'recent' => array_slice($recent, 0, 5), 'history' => array_map(fn ($r) => $this->summary($r), array_slice($recent, 0, 10)), 'monitor' => $this->monitor($recent)];
    }

    /**
     * One line per run for the monitoring list.
     *
     * @param  array<string,mixed>  $run
     * @return array<string,mixed>
     */
    private function summary(array $run): array
    {
        $ok = array_unique(array_map(fn ($x) => $x['ulp_code'] ?? '', array_filter($run['results'], fn ($x) => $x['status'] === 'OK')));
        $bad = array_unique(array_map(fn ($x) => $x['ulp_code'] ?? '', array_filter($run['results'], fn ($x) => $x['status'] !== 'OK')));
        $secs = $run['started_at'] !== null && $run['finished_at'] !== null ? (int) abs(Carbon::parse($run['finished_at'])->diffInSeconds(Carbon::parse($run['started_at']))) : null;

        return ['id' => $run['id'], 'status' => $run['status'], 'started_at' => $run['started_at'] ?? $run['created_at'], 'finished_at' => $run['finished_at'], 'started_by_name' => $run['started_by_name'], 'rows' => $run['rows_done'],
            'units_total' => $run['units_total'], 'units_ok' => count($ok), 'units_failed' => count($bad), 'seconds' => $secs, 'message' => $run['message'],
            'failed' => array_values(array_map(fn ($x) => ['ulp_code' => $x['ulp_code'] ?? null, 'unit_name' => $x['unit_name'] ?? null, 'file' => $x['file'], 'message' => $x['message'] ?? null], array_filter($run['results'], fn ($x) => $x['status'] !== 'OK')))];
    }

    /**
     * Monitoring numbers over the latest result of every unit: how many loaded, how many failed, how many never ran.
     *
     * @param  list<array<string,mixed>>  $recent
     * @return array<string,int>
     */
    private function monitor(array $recent): array
    {
        $latest = [];
        foreach (array_reverse($recent) as $run) {
            foreach ($run['results'] as $r) {
                isset($r['ulp_code']) && $latest[$r['ulp_code']] = $r['status'];
            }
        }
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->pluck('code')->all();
        $ok = count(array_filter($units, fn ($c) => ($latest[$c] ?? null) === 'OK'));
        $failed = count(array_filter($units, fn ($c) => isset($latest[$c]) && $latest[$c] !== 'OK'));

        return ['units_total' => count($units), 'units_ok' => $ok, 'units_failed' => $failed, 'units_never' => count($units) - $ok - $failed];
    }

    /**
     * One entry per ULP, like the warehouses of the MIMS pull: the file waiting in the inbox, how many customers the unit has, the month of its data, and what the latest run did to it.
     *
     * @param  list<array<string,mixed>>  $files
     * @param  list<array<string,mixed>>  $recent  runs as presented (newest first)
     * @return list<array<string,mixed>>
     */
    public function units(array $files, array $recent): array
    {
        $names = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->orderBy('code')->pluck('name', 'code')->all();
        foreach ($files as $f) {
            $f['ulp_code'] !== null && ! isset($names[$f['ulp_code']]) && $names[$f['ulp_code']] = null;
        }
        foreach ($recent as $run) {
            foreach ($run['results'] as $r) {
                ($r['ulp_code'] ?? null) !== null && ! array_key_exists($r['ulp_code'], $names) && $names[$r['ulp_code']] = null;
            }
        }
        $stats = DB::table('customer_connections as c')->join('organizational_units as u', 'u.id', '=', 'c.organizational_unit_id')->selectRaw('u.code, count(*) as n, max(c.snapshot_month) as month')->groupBy('u.code')->get()->keyBy('code');
        $last = [];
        foreach (array_reverse($recent) as $run) {                                  // oldest first, so the newest result per unit wins
            foreach ($run['results'] as $r) {
                isset($r['ulp_code']) && $last[$r['ulp_code']] = ['status' => $r['status'], 'at' => $run['finished_at'] ?? $run['started_at'], 'rows' => $r['rows'] ?? 0, 'message' => $r['message'] ?? null];
            }
        }
        ksort($names);

        return array_map(fn ($code, $name) => ['code' => (string) $code, 'name' => $name, 'files' => array_values(array_filter($files, fn ($f) => $f['ulp_code'] === (string) $code)),
            'customers' => (int) ($stats[$code]->n ?? 0), 'snapshot_month' => $stats[$code]->month ?? null, 'last_result' => $last[(string) $code] ?? null], array_keys($names), array_values($names));
    }

    /** Registers a run for the files now in the inbox and starts the detached process. */
    public function start(User $actor, ?array $units = null): string
    {
        $this->expireStale();
        $files = $this->files();
        if ($units !== null) {                                                      // a loop over the chosen units only; the other files stay in the inbox
            $files = array_values(array_filter($files, fn ($f) => $f['ulp_code'] !== null && in_array($f['ulp_code'], $units, true)));
        }
        if ($files === []) {
            throw new AssignmentRuleViolation('Belum ada berkas DIL (.mdb atau .csv) di folder '.$this->inboxLabel().'.');
        }
        if (array_filter($files, fn ($f) => $f['kind'] === 'mdb') !== [] && ! $this->mdbtoolsAvailable()) {
            throw new AssignmentRuleViolation('Berkas .mdb perlu mdbtools di server: jalankan "sudo apt install mdbtools", atau taruh berkas dalam bentuk .csv.');
        }
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $actor, $files): void {
            if (DB::table('dil_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->lockForUpdate()->exists()) {
                throw new AssignmentRuleViolation('Masih ada sinkron DIL yang berjalan; tunggu sampai selesai.');
            }
            DB::table('dil_sync_runs')->insert(['id' => $id, 'status' => 'QUEUED', 'files' => json_encode(array_map(fn ($f) => ['name' => $f['name'], 'size' => $f['size'], 'ulp_code' => $f['ulp_code']], $files)), 'started_by' => $actor->getKey(), 'created_at' => now()]);
        });
        if (config('distriva.dil.detach')) {
            $cmd = sprintf('nohup %s artisan distriva:dil-sync-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($id));
            SymfonyProcess::fromShellCommandline($cmd, base_path())->run();
        }

        return $id;
    }

    /** Runs a registered run to its end (called by the detached process). Every failure ends as FAILED with a short message. */
    public function execute(string $runId): void
    {
        $run = DB::table('dil_sync_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        DB::table('dil_sync_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'started_at' => now()]);
        $results = [];
        $rows = 0;
        try {
            $actor = User::query()->findOrFail($run->started_by);
            $scope = $this->authorizer->authorizeScope($actor, 'customers.import');
            $present = collect($this->files())->keyBy('name');
            $names = DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('name', 'code')->all();
            $queue = json_decode((string) $run->files, true);
            usort($queue, fn ($a, $b) => [$a['ulp_code'] ?? 'zzzzz', $a['name']] <=> [$b['ulp_code'] ?? 'zzzzz', $b['name']]);
            foreach ($queue as $f) {
                $file = $present[$f['name']] ?? null;
                $meta = ['ulp_code' => $f['ulp_code'] ?? null, 'unit_name' => $names[$f['ulp_code'] ?? ''] ?? null, 'size' => $f['size'] ?? 0];
                $began = microtime(true);
                DB::table('dil_sync_runs')->where('id', $runId)->update(['current_file' => $f['name']]);
                if ($file === null) {
                    $results[] = ['file' => $f['name'], 'status' => 'FAILED', 'rows' => 0, 'message' => 'Berkas sudah tidak ada di folder.'] + $meta;

                    continue;
                }
                try {
                    $r = $this->loadFile($file, $actor, $scope, $runId, $rows);
                    $results[] = ['file' => $f['name'], 'status' => 'OK', 'rows' => $r['rows'], 'counts' => $r['counts'], 'message' => null, 'seconds' => (int) round(microtime(true) - $began)] + $meta;
                    $this->archive($f['name']);
                } catch (Throwable $e) {
                    $results[] = ['file' => $f['name'], 'status' => 'FAILED', 'rows' => 0, 'message' => Str::limit($e instanceof AssignmentRuleViolation || $e instanceof AdministrationDenied ? $e->getMessage() : 'Gagal membaca berkas: '.class_basename($e), 200, '…'), 'seconds' => (int) round(microtime(true) - $began)] + $meta;
                }
                DB::table('dil_sync_runs')->where('id', $runId)->update(['results' => json_encode($results), 'rows_done' => $rows]);
            }
            $ok = count(array_filter($results, fn ($r) => $r['status'] === 'OK'));
            $status = $ok === count($results) ? 'OK' : ($ok > 0 ? 'PARTIAL' : 'FAILED');
            DB::table('dil_sync_runs')->where('id', $runId)->update(['status' => $status, 'results' => json_encode($results), 'rows_done' => $rows, 'current_file' => null, 'finished_at' => now(),
                'message' => $status === 'OK' ? null : 'Sebagian berkas gagal; lihat rincian per berkas.']);
        } catch (Throwable $e) {
            DB::table('dil_sync_runs')->where('id', $runId)->update(['status' => 'FAILED', 'results' => json_encode($results), 'current_file' => null, 'finished_at' => now(), 'message' => Str::limit($e->getMessage(), 300, '…')]);
        }
    }

    /** @return array<string,mixed>|null */
    public function show(string $id): ?array
    {
        $r = DB::table('dil_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.id', $id)->first(['r.*', 'u.name as started_by_name']);

        return $r === null ? null : $this->present($r);
    }

    /**
     * @param  array{name:string,size:int,kind:string,month:?string}  $file
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array{rows:int,counts:array<string,int>}
     */
    private function loadFile(array $file, User $actor, array $scope, string $runId, int &$rows): array
    {
        $path = $this->inbox().'/'.$file['name'];
        $proc = null;
        $pipes = [];
        if ($file['kind'] === 'mdb') {
            $table = $this->firstTable($path);
            $proc = proc_open([(string) config('distriva.dil.mdb_export'), '-D', '%Y-%m-%d', '-T', '%Y-%m-%d %H:%M:%S', $path, $table], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
            if (! is_resource($proc)) {
                throw new AssignmentRuleViolation('Pembaca .mdb tidak dapat dijalankan.');
            }
            $stream = $pipes[1];
        } else {
            $stream = fopen($path, 'r') ?: throw new AssignmentRuleViolation('Berkas tidak dapat dibuka.');
        }
        $batch = null;
        $total = [];
        $count = 0;
        try {
            $head = fgetcsv($stream, null, ',', '"', '');
            $ix = array_flip(is_array($head) ? array_map(fn ($h) => trim((string) $h, "\xEF\xBB\xBF \t"), $head) : []);
            $missing = array_diff(self::REQUIRED, array_keys($ix));
            if ($missing !== []) {
                throw new AssignmentRuleViolation('Kolom wajib tidak ada: '.implode(', ', $missing).'.');
            }
            $batch = $this->connections->startBatch($file['name'], $file['month'], $actor)['id'];
            $buffer = [];
            $flush = function () use (&$buffer, $batch, $scope, $actor, &$total, $runId, &$rows): void {
                if ($buffer === []) {
                    return;
                }
                foreach ($this->connections->addItems($batch, $buffer, $scope, $actor)['counts'] as $k => $v) {
                    $total[$k] = ($total[$k] ?? 0) + $v;
                }
                $rows += count($buffer);
                $buffer = [];
                DB::table('dil_sync_runs')->where('id', $runId)->update(['rows_done' => $rows]);
            };
            while (($r = fgetcsv($stream, null, ',', '"', '')) !== false) {
                if ($r === [null]) {
                    continue;
                }
                $buffer[] = $this->item($r, $ix);
                $count++;
                count($buffer) >= self::CHUNK && $flush();
            }
            $flush();
            $this->connections->complete($batch, $actor);
        } finally {
            is_resource($stream) && fclose($stream);
            is_resource($proc) && proc_close($proc);
        }

        return ['rows' => $count, 'counts' => $total];
    }

    private function firstTable(string $path): string
    {
        $p = new SymfonyProcess([(string) config('distriva.dil.mdb_tables'), '-1', $path]);
        $p->setTimeout(120)->run();
        $table = trim(strtok($p->getOutput(), "\n") ?: '');
        if (! $p->isSuccessful() || $table === '') {
            throw new AssignmentRuleViolation('Tabel DIL tidak ditemukan di berkas .mdb.');
        }

        return $table;
    }

    /**
     * One DIL row -> the item ConnectionService accepts (only the allowed fields; a name that is not masked yet is masked here).
     *
     * @param  list<string|null>  $r
     * @param  array<string,int>  $ix
     * @return array<string,mixed>
     */
    private function item(array $r, array $ix): array
    {
        $g = fn (string $col): string => isset($ix[$col]) ? trim((string) ($r[$ix[$col]] ?? '')) : '';
        $va = is_numeric($g('DAYA')) ? (float) $g('DAYA') : null;

        return ['idpel' => $g('IDPEL'), 'unit_code' => $g('UNITUP'), 'name' => $this->maskName($g('NAMA')), 'tariff_code' => $g('TARIF') ?: null, 'power_va' => $va !== null && $va > 0 ? $va : null,
            'service_type' => $g('JENISLAYANAN') ?: null, 'phase_code' => $g('KODE_FASA') ?: null, 'meter_number' => $g('NOMOR_METER_KWH') ?: ($g('NOMOR_METER_PREPAID') ?: null),
            'kelurahan' => $g('NAMA_KELURAHAN') ?: null, 'kecamatan' => $g('NAMA_KECAMATAN') ?: null, 'kabupaten' => $g('NAMA_KABUPATEN') ?: null, 'energized_on' => $this->date($g('TGLNYALA_PB')),
            'gardu_ref' => $g('NOMOR_GARDU') ?: null, 'gardu_name' => $g('NAMA_GARDU') ?: null, 'status' => $g('STATUS_DIL') ?: 'AKTIF'];
    }

    private function maskName(string $v): ?string
    {
        if ($v === '' || str_contains($v, '*')) {
            return $v === '' ? null : $v;
        }

        return mb_substr($v, 0, 3).str_repeat('*', max(3, mb_strlen($v) - 3));
    }

    /**
     * Tanggal DIL menjadi YYYY-MM-DD. Format yang dikenali: ISO (`2020-05-01 00:00:00`, keluaran `mdb-export -T`), dd/mm/yyyy (ekspor CSV), dan mm/dd/yy (format bawaan `mdb-export` tanpa `-T`,
     * mis. `02/18/19`; tahun dua digit 00 sampai 29 = 2000an, 30 sampai 99 = 1900an seperti Access). Format lain atau tanggal mustahil menjadi null.
     */
    private function date(string $v): ?string
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $v, $m)) {
            return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? "{$m[1]}-{$m[2]}-{$m[3]}" : null;
        }
        if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/', $v, $m)) {
            return checkdate((int) $m[2], (int) $m[1], (int) $m[3]) ? sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]) : null;
        }
        if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?!\d)/', $v, $m)) {
            $year = (int) $m[3] < 30 ? 2000 + (int) $m[3] : 1900 + (int) $m[3];

            return checkdate((int) $m[1], (int) $m[2], $year) ? sprintf('%04d-%02d-%02d', $year, $m[1], $m[2]) : null;
        }

        return null;
    }

    private function archive(string $name): void
    {
        $dir = $this->inbox().'/diproses';
        is_dir($dir) || @mkdir($dir, 0750, true);
        @rename($this->inbox().'/'.$name, $dir.'/'.date('Ymd-His').'-'.$name);
    }

    private function expireStale(): void
    {
        DB::table('dil_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->where('created_at', '<', now()->subHours(self::STALE_HOURS))
            ->update(['status' => 'FAILED', 'message' => 'Dihentikan: proses tidak selesai.', 'finished_at' => now(), 'current_file' => null]);
    }

    /** @return array<string,mixed> */
    private function present(object $r): array
    {
        $files = json_decode((string) $r->files, true) ?? [];
        $results = json_decode((string) $r->results, true) ?? [];
        $units = array_values(array_unique(array_map(fn ($f) => $f['ulp_code'] ?? '', $files)));
        $doneUnits = array_values(array_unique(array_map(fn ($x) => $x['ulp_code'] ?? '', $results)));
        $bytesTotal = array_sum(array_column($files, 'size'));
        $bytesDone = array_sum(array_column($results, 'size'));
        $elapsed = $r->started_at !== null ? max(0, now()->diffInSeconds(Carbon::parse($r->started_at), true)) : 0;
        $running = in_array($r->status, ['QUEUED', 'RUNNING'], true);

        return ['id' => $r->id, 'status' => $r->status, 'files' => $files, 'results' => $results, 'current_file' => $r->current_file, 'rows_done' => (int) $r->rows_done,
            'bytes_total' => $bytesTotal, 'bytes_done' => $bytesDone, 'units_total' => count($units), 'units_done' => count($doneUnits),
            'eta_seconds' => $running && $bytesDone > 0 && $bytesTotal > $bytesDone ? (int) round($elapsed * ($bytesTotal - $bytesDone) / $bytesDone) : null,
            'message' => $r->message, 'started_by_name' => $r->started_by_name ?? null, 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at];
    }
}
