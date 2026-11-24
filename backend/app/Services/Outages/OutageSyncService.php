<?php

namespace App\Services\Outages;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

/**
 * Sinkronisasi data gangguan dari Google Sheet (docs/87). Satu proses pendek: unduh CSV tiap tab, rapikan, cocokkan penyulang dan ULP, lalu upsert idempoten menurut kunci sumber.
 * Peristiwa yang tidak lagi ada di sheet hanya ditandai (source_removed_at), dan hanya bila hasil bacaan masuk akal (tidak kosong dan tidak jauh lebih kecil dari yang tersimpan).
 */
class OutageSyncService
{
    public function __construct(private readonly OutageSheetClient $client, private readonly OutageSheetParser $parser) {}

    /** @return array<string,mixed> */
    public function settings(): array
    {
        $s = DB::table('outage_sync_settings')->where('id', 1)->first();
        $last = DB::table('outage_sync_runs')->orderByDesc('created_at')->first();

        return ['sheet_id_set' => $s->sheet_id !== null, 'sheet_id_hint' => $s->sheet_id === null ? null : substr($s->sheet_id, 0, 4).'…'.substr($s->sheet_id, -4), 'gids' => array_map('intval', (array) json_decode((string) $s->gids, true)),
            'auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => $s->auto_time, 'saidi_min_minutes' => (int) $s->saidi_min_minutes, 'saidi_only_permanent' => (bool) $s->saidi_only_permanent,
            'updated_at' => $s->updated_at, 'last_run' => $last === null ? null : $this->run($last)];
    }

    /**
     * @param  array<string,mixed>  $d  sheet_url? (alamat atau ID; kosong = tidak diubah), gids? (list of int), auto_enabled, auto_time, saidi_min_minutes, saidi_only_permanent
     * @return array<string,mixed>
     */
    public function save(array $d, User $actor): array
    {
        $cur = DB::table('outage_sync_settings')->where('id', 1)->first();
        $sheetId = $cur->sheet_id;
        $gids = (array) json_decode((string) $cur->gids, true);
        if (filled($d['sheet_url'] ?? null)) {
            $p = OutageSheetClient::parse((string) $d['sheet_url']);
            $sheetId = $p['sheet_id'];
            $p['gid'] !== null && ! array_key_exists('gids', $d) && $gids = [(int) $p['gid']];
        }
        if (array_key_exists('gids', $d)) {
            $gids = array_values(array_unique(array_map('intval', (array) $d['gids'])));
        }
        if (! empty($d['auto_enabled']) && ($sheetId === null || $gids === [])) {
            throw new AssignmentRuleViolation('Isi alamat Google Sheet dan tab (gid) sebelum mengaktifkan sinkronisasi harian.');
        }
        DB::table('outage_sync_settings')->where('id', 1)->update(['sheet_id' => $sheetId, 'gids' => json_encode($gids), 'auto_enabled' => (bool) $d['auto_enabled'], 'auto_time' => $d['auto_time'],
            'saidi_min_minutes' => (int) $d['saidi_min_minutes'], 'saidi_only_permanent' => (bool) $d['saidi_only_permanent'], 'updated_by' => $actor->getKey(), 'updated_at' => now()]);

        return $this->settings();
    }

    /** Registers a run; a run that never finished must not block the next one forever. */
    public function start(string $trigger, ?User $actor): string
    {
        $s = DB::table('outage_sync_settings')->where('id', 1)->first();
        if ($s->sheet_id === null || (array) json_decode((string) $s->gids, true) === []) {
            throw new AssignmentRuleViolation('Alamat Google Sheet dan tab (gid) belum diisi pada pengaturan.');
        }
        $this->expireStale();
        if (DB::table('outage_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists()) {
            throw new AssignmentRuleViolation('Sinkronisasi gangguan sedang berjalan; tunggu sampai selesai.');
        }
        $id = (string) Str::uuid();
        DB::table('outage_sync_runs')->insert(['id' => $id, 'trigger' => $trigger, 'status' => 'QUEUED', 'started_by' => $actor?->getKey(), 'created_at' => now()]);

        return $id;
    }

    /**
     * Run yang tidak pernah selesai (proses mati atau tidak pernah mulai) ditandai gagal, supaya tidak mengunci tombol sinkron selamanya. Dipanggil saat membaca status dan saat memulai run baru.
     */
    public function expireStale(): void
    {
        DB::table('outage_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->where('created_at', '<', now()->subSeconds((int) config('distriva.outage.timeout_seconds') * 4 + 300))
            ->update(['status' => 'FAILED', 'finished_at' => now(), 'message' => 'Dihentikan: proses tidak selesai.']);
    }

    /** Menyerahkan run terdaftar ke proses terpisah. Bila proses tidak dapat dimulai, run ditandai gagal (bukan dibiarkan Menunggu) dan galatnya diteruskan. */
    public function launch(string $runId): void
    {
        try {
            if (config('distriva.outage.run_inline')) {
                Artisan::call('distriva:outage-sync-execute', ['id' => $runId]);

                return;
            }
            Process::fromShellCommandline(sprintf('nohup %s artisan distriva:outage-sync-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($runId)), base_path())->run();
        } catch (\Throwable $e) {
            DB::table('outage_sync_runs')->where('id', $runId)->whereIn('status', ['QUEUED', 'RUNNING'])->update(['status' => 'FAILED', 'finished_at' => now(), 'message' => mb_substr('Proses sinkronisasi tidak dapat dimulai: '.$e->getMessage(), 0, 500)]);

            throw $e;
        }
    }

    /** Dipanggil tiap menit oleh penjadwal: menjalankan sinkronisasi harian bila sudah waktunya (sekali sehari, juga bila gagal). */
    public function runScheduledIfDue(): ?string
    {
        $s = DB::table('outage_sync_settings')->where('id', 1)->first();
        if (! $s->auto_enabled || $s->sheet_id === null) {
            return null;
        }
        $now = now(config('distriva.business_timezone'));
        if ($now->format('H:i') < $s->auto_time || DB::table('outage_sync_runs')->where('trigger', 'AUTO')->where('created_at', '>=', $now->copy()->startOfDay()->utc())->exists()) {
            return null;
        }
        try {
            $id = $this->start('AUTO', null);
        } catch (AssignmentRuleViolation) {
            return null;
        }
        $this->launch($id);

        return $id;
    }

    public function execute(string $runId): void
    {
        $run = DB::table('outage_sync_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        DB::table('outage_sync_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'started_at' => now()]);
        try {
            $counts = $this->sync($runId);
            DB::table('outage_sync_runs')->where('id', $runId)->update(['status' => 'OK', 'finished_at' => now(), 'counts' => json_encode($counts),
                'message' => sprintf('%d baris dibaca: %d baru, %d berubah, %d tetap, %d ditolak, %d ditandai hilang.', $counts['read'], $counts['inserted'], $counts['updated'], $counts['unchanged'], $counts['invalid'], $counts['removed'])]);
        } catch (AssignmentRuleViolation $e) {
            DB::table('outage_sync_runs')->where('id', $runId)->update(['status' => 'FAILED', 'finished_at' => now(), 'message' => $e->getMessage()]);
        } catch (\Throwable) {
            DB::table('outage_sync_runs')->where('id', $runId)->update(['status' => 'FAILED', 'finished_at' => now(), 'message' => 'Sinkronisasi gagal karena kesalahan tak terduga (lihat log server).']);
            report(new \RuntimeException('Sinkronisasi gangguan gagal.'));
        }
    }

    /** @return array<string,mixed> */
    private function sync(string $runId): array
    {
        $s = DB::table('outage_sync_settings')->where('id', 1)->first();
        $tz = (string) config('distriva.business_timezone');
        $gids = array_map('intval', (array) json_decode((string) $s->gids, true));
        $feeders = $this->feederIndex();
        $units = $this->unitIndex();
        $aliases = DB::table('outage_feeder_aliases')->get()->mapWithKeys(fn ($a) => [$a->gi_key.'|'.$a->feeder_key => $a->feeder_id])->all();
        $counts = ['read' => 0, 'inserted' => 0, 'updated' => 0, 'unchanged' => 0, 'invalid' => 0, 'removed' => 0, 'unmatched_feeders' => 0, 'invalid_samples' => []];
        $seenAll = [];
        $unmatched = [];
        foreach ($gids as $gid) {
            $parsed = $this->parser->parse($this->client->fetchCsv((string) $s->sheet_id, $gid), $tz);
            $counts['read'] += $parsed['read'];
            $counts['invalid'] += count($parsed['invalid']);
            foreach (array_slice($parsed['invalid'], 0, 10 - count($counts['invalid_samples'])) as $i) {
                $counts['invalid_samples'][] = "baris {$i['line']}: {$i['reason']}";
            }
            $prepared = [];
            $seenKeys = [];
            foreach ($parsed['rows'] as $row) {
                $base = sha1($row['occurred_at']->format('Y-m-d H:i').'|'.$this->norm($row['gi_name']).'|'.$this->norm($row['feeder_name']).'|'.$row['device_group']);
                $n = $seenKeys[$base] = ($seenKeys[$base] ?? -1) + 1;
                $key = $n === 0 ? $base : $base.'-'.$n;                           // two identical lines (same minute, GI, feeder, device) stay two events
                $fid = $aliases[$this->norm($row['gi_name']).'|'.$this->norm($row['feeder_name'])] ?? $this->matchFeeder($feeders, $row['gi_name'], $row['feeder_name']);
                $fid === null && $unmatched[$this->norm($row['gi_name']).'|'.$this->norm($row['feeder_name'])] = true;
                $uid = $units['rayon'][$this->norm((string) $row['rayon'])] ?? ($fid !== null ? ($feeders['unit'][$fid] ?? null) : null);
                $values = array_merge($row, ['occurred_at' => $row['occurred_at']->utc()->toDateTimeString(), 'restored_at' => $row['restored_at']?->utc()->toDateTimeString(), 'feeder_id' => $fid, 'organizational_unit_id' => $uid, 'sheet_gid' => $gid]);
                $prepared[$key] = ['key' => $key, 'values' => $values, 'hash' => sha1(json_encode($values))];
            }
            foreach (array_chunk($prepared, 400, true) as $chunk) {
                $existing = DB::table('outage_events')->whereIn('source_key', array_keys($chunk))->pluck('row_hash', 'source_key')->all();
                $rows = [];
                foreach ($chunk as $key => $p) {
                    $same = ($existing[$key] ?? null) === $p['hash'];
                    isset($existing[$key]) ? ($same ? $counts['unchanged']++ : $counts['updated']++) : $counts['inserted']++;
                    $rows[] = $p['values'] + ['id' => (string) Str::uuid(), 'source_key' => $key, 'row_hash' => $p['hash'], 'last_run_id' => $runId, 'source_removed_at' => null, 'created_at' => now(), 'updated_at' => now()];
                }
                DB::table('outage_events')->upsert($rows, ['source_key'], array_merge(array_keys($chunk[array_key_first($chunk)]['values']), ['row_hash', 'last_run_id', 'source_removed_at', 'updated_at']));
            }
            $seenAll[$gid] = count($prepared);
        }
        $counts['unmatched_feeders'] = count($unmatched);
        $counts['removed'] = $this->markRemoved($runId, $gids, array_sum($seenAll));

        return $counts;
    }

    /** Menandai peristiwa yang tidak terlihat pada sinkron ini; dilewati bila bacaan tampak rusak (kosong atau jauh lebih sedikit dari yang tersimpan). */
    private function markRemoved(string $runId, array $gids, int $seen): int
    {
        $stored = DB::table('outage_events')->whereIn('sheet_gid', $gids)->whereNull('source_removed_at')->count();
        if ($seen === 0 || $seen < $stored * 0.5) {
            throw new AssignmentRuleViolation("Hasil bacaan sheet ({$seen} peristiwa) jauh lebih sedikit dari yang tersimpan ({$stored}); sinkronisasi dibatalkan agar data tidak ikut hilang. Periksa sheet dan tab (gid).");
        }

        return DB::table('outage_events')->whereIn('sheet_gid', $gids)->whereNull('source_removed_at')->where(fn ($q) => $q->whereNull('last_run_id')->orWhere('last_run_id', '<>', $runId))->update(['source_removed_at' => now(), 'updated_at' => now()]);
    }

    /** @return array{name:array<string,list<string>>,code:array<string,list<string>>,gi:array<string,string>,unit:array<string,string>} */
    private function feederIndex(): array
    {
        $idx = ['name' => [], 'code' => [], 'gi' => [], 'unit' => []];
        foreach (DB::table('distribution_feeders')->get(['id', 'code', 'name', 'gi_code', 'gi_name']) as $f) {
            $idx['name'][$this->norm((string) $f->name)][] = $f->id;
            $idx['code'][$this->norm((string) $f->code)][] = $f->id;
            $idx['gi'][$f->id] = $this->norm((string) $f->gi_name).'|'.$this->norm((string) $f->gi_code);
        }
        foreach (DB::table('substations')->whereNotNull('feeder_id')->selectRaw('feeder_id, organizational_unit_id, count(*) as c')->groupBy('feeder_id', 'organizational_unit_id')->orderBy('c')->get() as $r) {
            $idx['unit'][$r->feeder_id] = $r->organizational_unit_id;                 // ascending by count: the ULP with most gardu is written last
        }

        return $idx;
    }

    /** @param array<string,mixed> $idx */
    private function matchFeeder(array $idx, string $gi, string $name): ?string
    {
        $k = $this->norm($name);
        $cand = $idx['name'][$k] ?? $idx['code'][$k] ?? [];
        if (count($cand) <= 1) {
            return $cand[0] ?? null;
        }
        $g = $this->norm($gi);
        $same = array_values(array_filter($cand, fn ($id) => $g !== '' && str_contains($idx['gi'][$id] ?? '', $g)));

        return count($same) === 1 ? $same[0] : null;
    }

    /** @return array{rayon:array<string,string>} */
    private function unitIndex(): array
    {
        $r = [];
        foreach (DB::table('organizational_units')->where('unit_type', 'ULP')->get(['id', 'name', 'code']) as $u) {
            $r[$this->norm(preg_replace('/^ULP\s+/i', '', (string) $u->name) ?? '')] = $u->id;
        }

        return ['rayon' => $r];
    }

    private function norm(string $s): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $s) ?? '');
    }

    /** @return array<string,mixed> */
    public function run(object $r): array
    {
        return ['id' => $r->id, 'trigger' => $r->trigger, 'status' => $r->status, 'counts' => $r->counts === null ? null : json_decode((string) $r->counts, true), 'message' => $r->message, 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at];
    }

    /** @return list<array<string,mixed>> penyulang di sheet yang belum terpetakan, dengan jumlah peristiwanya */
    public function unmatched(): array
    {
        return DB::table('outage_events')->whereNull('feeder_id')->whereNull('source_removed_at')->selectRaw('gi_name, feeder_name, count(*) as events, min(occurred_at) as first_at, max(occurred_at) as last_at')->groupBy('gi_name', 'feeder_name')->orderByDesc('events')->get()
            ->map(fn ($x) => ['gi_name' => $x->gi_name, 'feeder_name' => $x->feeder_name, 'events' => (int) $x->events, 'first_at' => $x->first_at, 'last_at' => $x->last_at])->all();
    }

    /** Memetakan nama sheet ke penyulang master dan menerapkannya ke peristiwa yang sudah ada. */
    public function alias(string $gi, string $feeder, string $feederId, User $actor): int
    {
        DB::table('distribution_feeders')->where('id', $feederId)->exists() || throw new AssignmentRuleViolation('Penyulang tidak ditemukan.');
        DB::table('outage_feeder_aliases')->updateOrInsert(['gi_key' => $this->norm($gi), 'feeder_key' => $this->norm($feeder)], ['id' => (string) Str::uuid(), 'gi_name' => $gi, 'feeder_name' => $feeder, 'feeder_id' => $feederId, 'created_by' => $actor->getKey(), 'created_at' => now()]);

        return DB::table('outage_events')->where('gi_name', $gi)->where('feeder_name', $feeder)->whereNull('feeder_id')->update(['feeder_id' => $feederId, 'updated_at' => now()]);
    }
}
