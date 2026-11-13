<?php

namespace App\Services;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Support\CsvTable;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Construction types and their KHS mappings (docs/23 §2.6), with the same discipline as the KHS catalogue:
 * imports only create DRAFT versions, a draft is approved by a different user (also a database CHECK), approved
 * versions and their mappings are immutable (database triggers). Codes: DISTRIVA assigns `<GROUP>-<NN>` when the file
 * gives none (owner decision 2026-11-06: no official code exists yet); an explicit `code` column is honoured.
 * A mapping refers to a KHS item that must exist in the catalogue — a missing code is rejected, never replaced by a
 * similar one. Callers must authorize the actor first.
 */
class ConstructionTypeService
{
    private const TYPE_HEADERS = [
        'group' => ['group', 'kelompok'], 'code' => ['code', 'kode'], 'label' => ['label', 'name', 'nama', 'uraian'],
        'description' => ['description', 'deskripsi', 'keterangan'], 'reference_symbol' => ['reference_symbol', 'simbol', 'symbol'],
        'source_reference' => ['source_reference', 'asal', 'sumber'],
    ];

    private const MAP_HEADERS = [
        'group' => ['group', 'kelompok'], 'code' => ['code', 'kode', 'construction_code'], 'label' => ['label', 'name', 'nama'],
        'khs_code' => ['khs_code', 'kode_khs', 'khs'], 'relation' => ['relation', 'hubungan'], 'note' => ['note', 'catatan'],
        'source_reference' => ['source_reference', 'asal', 'sumber'],
    ];

    /** @return array{summary: array<string, int|bool>, rows: list<array<string, mixed>>} */
    public function importTypes(UploadedFile $file, string $validFrom, ?string $defaultSource, bool $dryRun, User $actor): array
    {
        ['rows' => $rows, 'columns' => $cols] = CsvTable::read($file, self::TYPE_HEADERS, ['group', 'label']);
        $this->guardSize($rows);
        $rows = array_map(fn ($r) => array_merge($r, ['label' => $this->tidy($r['label']), 'description' => $this->tidy($r['description'])]), $rows);
        $hasDesc = in_array('description', $cols, true);
        $hasSymbol = in_array('reference_symbol', $cols, true);
        $source = $defaultSource !== null && trim($defaultSource) !== '' ? trim($defaultSource) : mb_substr($file->getClientOriginalName(), 0, 255);

        $run = function () use ($rows, $hasDesc, $hasSymbol, $validFrom, $source, $dryRun, $actor): array {
            $labelCount = array_count_values(array_map(fn ($r) => $r['group'].'|'.mb_strtolower($r['label']), $rows));
            $codeCount = array_count_values(array_filter(array_column($rows, 'code'), fn ($c) => $c !== ''));
            $byCode = DB::table('construction_types')->whereIn('code', array_keys($codeCount))->get()->keyBy('code');
            $latest = $this->latestVersions();
            $draftOf = DB::table('construction_type_versions')->where('status', 'DRAFT')->pluck('version_number', 'construction_type_id');
            $typesById = DB::table('construction_types')->get()->keyBy('id');
            $byLabel = [];
            foreach ($latest as $typeId => $v) {
                $byLabel[$typesById[$typeId]->group_code.'|'.mb_strtolower($v->name)] = $typeId;
            }
            $next = $this->nextSequences();

            $tally = ['new_types' => 0, 'new_versions' => 0, 'unchanged' => 0, 'rejected' => 0, 'total' => count($rows)];
            $out = [];
            $apply = [];

            foreach ($rows as $r) {
                $errors = $this->validateTypeRow($r, $labelCount, $codeCount);
                $typeId = null;
                $code = $r['code'];

                if ($errors === []) {
                    $existing = $code !== '' ? $byCode->get($code) : null;
                    $typeId = $existing?->id ?? ($code === '' ? ($byLabel[$r['group'].'|'.mb_strtolower($r['label'])] ?? null) : null);
                    if ($existing !== null && $existing->group_code !== $r['group']) {
                        $errors[] = "Kode {$code} sudah dipakai kelompok {$existing->group_code}; kelompok tidak dapat diubah.";
                    }
                    if ($code !== '' && $existing === null && isset($byLabel[$r['group'].'|'.mb_strtolower($r['label'])])) {
                        $errors[] = 'Label ini sudah dipakai jenis konstruksi lain '.$typesById[$byLabel[$r['group'].'|'.mb_strtolower($r['label'])]]->code.' pada kelompok yang sama.';
                    }
                }
                if ($errors !== []) {
                    $tally['rejected']++;
                    $out[] = $this->typeRow($r, $code, 'REJECT', $errors);

                    continue;
                }

                if ($typeId === null) {
                    $code = $code !== '' ? $code : $this->assignCode($r['group'], $next);
                    $tally['new_types']++;
                    $out[] = $this->typeRow($r, $code, 'NEW_TYPE', []);
                    $apply[] = ['new', $r, $code, null, null];

                    continue;
                }

                $prev = $latest[$typeId];
                $code = $code !== '' ? $code : $typesById[$typeId]->code;
                if ($draftOf->has($typeId)) {
                    $tally['rejected']++;
                    $out[] = $this->typeRow($r, $code, 'REJECT', ["Sudah ada draf versi {$draftOf[$typeId]} yang belum disetujui."]);

                    continue;
                }
                $same = $prev->name === $r['label'] && (! $hasDesc || ($prev->description ?? '') === $r['description'])
                    && (! $hasSymbol || ($prev->reference_symbol ?? '') === $r['reference_symbol']);
                if ($same) {
                    $tally['unchanged']++;
                    $out[] = $this->typeRow($r, $code, 'UNCHANGED', []);

                    continue;
                }
                $tally['new_versions']++;
                $out[] = $this->typeRow($r, $code, 'NEW_VERSION', []);
                $apply[] = ['version', $r, $code, $typeId, $prev];
            }

            if (! $dryRun) {
                foreach ($apply as [$kind, $r, $code, $typeId, $prev]) {
                    if ($kind === 'new') {
                        $typeId = (string) Str::uuid();
                        DB::table('construction_types')->insert(['id' => $typeId, 'group_code' => $r['group'], 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
                    }
                    $this->createVersion($typeId, $r, $prev, $hasDesc, $hasSymbol, $validFrom, $r['source_reference'] !== '' ? $r['source_reference'] : $source, $actor);
                }
            }

            return ['summary' => $tally + ['dry_run' => $dryRun], 'rows' => $out];
        };

        return $dryRun ? $run() : DB::transaction($run);
    }

    /** @return array{summary: array<string, int|bool>, rows: list<array<string, mixed>>} */
    public function importMappings(UploadedFile $file, bool $dryRun, User $actor): array
    {
        ['rows' => $rows, 'columns' => $cols] = CsvTable::read($file, self::MAP_HEADERS, ['khs_code']);
        $this->guardSize($rows);
        // A column that is absent from the file never clears or changes the stored value.
        $has = fn (string $c) => in_array($c, $cols, true);

        $run = function () use ($rows, $dryRun, $actor, $has): array {
            $khs = DB::table('khs_items')->whereIn('code', array_unique(array_column($rows, 'khs_code')))->pluck('id', 'code');
            $types = DB::table('construction_types')->get();
            $byCode = $types->keyBy('code');
            $byGroupLabel = [];
            $latest = $this->latestVersions();
            foreach ($types as $t) {
                if (isset($latest[$t->id])) {
                    $byGroupLabel[$t->group_code.'|'.mb_strtolower($latest[$t->id]->name)] = $t;
                }
            }

            // resolve every row to a (type, version, khs item) first so duplicates are detected on the resolved pair
            $resolved = [];
            foreach ($rows as $i => $r) {
                $type = $r['code'] !== '' ? $byCode->get($r['code']) : ($byGroupLabel[$r['group'].'|'.mb_strtolower($this->tidy($r['label']))] ?? null);
                $resolved[$i] = [$type, $type ? ($latest[$type->id] ?? null) : null];
            }
            $pairCount = [];
            foreach ($rows as $i => $r) {
                if ($resolved[$i][0] !== null) {
                    $k = $resolved[$i][0]->id.'|'.$r['khs_code'];
                    $pairCount[$k] = ($pairCount[$k] ?? 0) + 1;
                }
            }

            $tally = ['inserted' => 0, 'updated' => 0, 'unchanged' => 0, 'rejected' => 0, 'total' => count($rows)];
            $out = [];
            $apply = [];
            $seq = [];

            foreach ($rows as $i => $r) {
                [$type, $version] = $resolved[$i];
                $errors = [];
                if ($type === null) {
                    $errors[] = 'Jenis konstruksi tidak ditemukan (isi code, atau group dan label yang sama persis).';
                } elseif ($version === null || $version->status !== 'DRAFT') {
                    $errors[] = 'Tidak ada versi DRAFT untuk jenis konstruksi ini'.($version ? " (versi terbaru berstatus {$version->status})" : '').'; impor/buat draf dahulu.';
                }
                if ($r['khs_code'] === '') {
                    $errors[] = 'Kode KHS kosong.';
                } elseif (! $khs->has($r['khs_code'])) {
                    $errors[] = "Kode KHS {$r['khs_code']} tidak ada di katalog (tidak diganti dengan kode yang mirip).";
                }
                $relation = $r['relation'] === '' ? 'DIRECT' : strtoupper($r['relation']);
                if (! in_array($relation, ['DIRECT', 'SHARED'], true)) {
                    $errors[] = "Hubungan '{$r['relation']}' tidak valid (DIRECT atau SHARED).";
                }
                if ($type !== null && ($pairCount[$type->id.'|'.$r['khs_code']] ?? 0) > 1) {
                    $errors[] = 'Pasangan jenis konstruksi + kode KHS muncul lebih dari sekali dalam berkas.';
                }
                $label = ['row' => $r['row'], 'construction' => $type?->code, 'khs_code' => $r['khs_code']];
                if ($errors !== []) {
                    $tally['rejected']++;
                    $out[] = $label + ['action' => 'REJECT', 'messages' => $errors];

                    continue;
                }

                $existing = DB::table('construction_khs_mappings')->where('construction_type_version_id', $version->id)->where('khs_item_id', $khs[$r['khs_code']])->first();
                if ($existing !== null) {
                    $relation = $has('relation') && $r['relation'] !== '' ? $relation : $existing->relation;
                    $note = $has('note') ? ($r['note'] === '' ? null : $r['note']) : $existing->note;
                    $src = $has('source_reference') ? ($r['source_reference'] === '' ? null : $r['source_reference']) : $existing->source_reference;
                } else {
                    $note = $r['note'] === '' ? null : $r['note'];
                    $src = $r['source_reference'] === '' ? null : $r['source_reference'];
                }
                if ($existing === null) {
                    $seq[$version->id] ??= (int) DB::table('construction_khs_mappings')->where('construction_type_version_id', $version->id)->max('sequence');
                    $seq[$version->id]++;
                    $tally['inserted']++;
                    $out[] = $label + ['action' => 'INSERT', 'messages' => []];
                    $apply[] = ['insert', $version->id, $khs[$r['khs_code']], $seq[$version->id], $relation, $note, $src];
                } elseif ($existing->relation !== $relation || $existing->note !== $note || $existing->source_reference !== $src) {
                    $tally['updated']++;
                    $out[] = $label + ['action' => 'UPDATE', 'messages' => []];
                    $apply[] = ['update', $existing->id, $relation, $note, $src, $version->id];
                } else {
                    $tally['unchanged']++;
                    $out[] = $label + ['action' => 'UNCHANGED', 'messages' => []];
                }
            }

            if (! $dryRun) {
                $touched = [];
                foreach ($apply as $a) {
                    if ($a[0] === 'insert') {
                        DB::table('construction_khs_mappings')->insert(['id' => (string) Str::uuid(), 'construction_type_version_id' => $a[1], 'khs_item_id' => $a[2], 'sequence' => $a[3], 'relation' => $a[4], 'note' => $a[5], 'source_reference' => $a[6], 'created_at' => now(), 'updated_at' => now()]);
                        $touched[$a[1]]['inserted'] = ($touched[$a[1]]['inserted'] ?? 0) + 1;
                    } else {
                        DB::table('construction_khs_mappings')->where('id', $a[1])->update(['relation' => $a[2], 'note' => $a[3], 'source_reference' => $a[4], 'updated_at' => now()]);
                        $touched[$a[5]]['updated'] = ($touched[$a[5]]['updated'] ?? 0) + 1;
                    }
                }
                foreach ($touched as $versionId => $counts) {
                    $this->event($versionId, 'MAPPINGS_CHANGED', $actor, null, $counts);
                }
            }

            return ['summary' => $tally + ['dry_run' => $dryRun], 'rows' => $out];
        };

        return $dryRun ? $run() : DB::transaction($run);
    }

    /** @param array<string, mixed> $changes name, description, reference_symbol, valid_from */
    public function updateDraft(string $versionId, array $changes, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $changes, $reason, $actor): void {
            $v = DB::table('construction_type_versions')->where('id', $versionId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($v);
            if (isset($changes['name'])) {
                $changes['name'] = $this->tidy($changes['name']);
            }
            $before = array_intersect_key((array) $v, $changes);
            $changes = array_filter($changes, fn ($val, $k) => $before[$k] !== $val, ARRAY_FILTER_USE_BOTH);
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }
            DB::table('construction_type_versions')->where('id', $versionId)->update($changes + ['updated_at' => now()]);
            $this->event($versionId, 'DRAFT_UPDATED', $actor, $reason, ['before' => array_intersect_key($before, $changes), 'after' => $changes]);
        });
    }

    public function removeMapping(string $versionId, string $khsCode, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $khsCode, $reason, $actor): void {
            $v = DB::table('construction_type_versions')->where('id', $versionId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($v);
            $itemId = DB::table('khs_items')->where('code', $khsCode)->value('id');
            $deleted = $itemId === null ? 0 : DB::table('construction_khs_mappings')->where('construction_type_version_id', $versionId)->where('khs_item_id', $itemId)->delete();
            if ($deleted === 0) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            $this->event($versionId, 'MAPPINGS_CHANGED', $actor, $reason, ['removed' => $khsCode]);
        });
    }

    /**
     * @param  list<string>  $ids
     * @return array{approved: int, auto_closed: int}
     */
    public function approve(array $ids, User $actor, string $reason): array
    {
        try {
            return DB::transaction(function () use ($ids, $actor, $reason): array {
                $versions = DB::table('construction_type_versions')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($versions->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian versi tidak ditemukan.');
                }
                foreach ($versions as $v) {
                    $this->requireDraft($v, 'disetujui');
                    if ($v->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat versi tidak dapat menyetujui versinya sendiri.', 403);
                    }
                    $this->requireReadyForApproval($v);
                }

                $closed = 0;
                foreach ($versions as $v) {
                    $from = CarbonImmutable::parse($v->valid_from);
                    $current = DB::table('construction_type_versions')->where('construction_type_id', $v->construction_type_id)->where('status', 'APPROVED')
                        ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();
                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Versi baru harus berlaku setelah versi {$old->version_number} yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('construction_type_versions')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan versi yang lebih baru.', ['closed_by_version' => $v->id]);
                        $closed++;
                    }
                    DB::table('construction_type_versions')->where('id', $v->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($v->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $versions->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan versi aktif lain untuk jenis konstruksi yang sama.', 0, $e),
                '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas versi.', 0, $e),
                default => $e,
            };
        }
    }

    public function retire(string $versionId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $reason, $actor): void {
            $v = DB::table('construction_type_versions')->where('id', $versionId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($v->status !== 'APPROVED') {
                throw new AssignmentRuleViolation("Versi berstatus {$v->status}; hanya versi APPROVED yang dapat dinonaktifkan.");
            }
            $today = CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();
            $until = $v->valid_until === null || $v->valid_until > $today ? max($today, $v->valid_from) : $v->valid_until;
            DB::table('construction_type_versions')->where('id', $versionId)->update(['status' => 'INACTIVE', 'valid_until' => $until, 'updated_at' => now()]);
            $this->event($versionId, 'RETIRED', $actor, $reason, ['valid_until' => $until]);
        });
    }

    /** A version is approvable only with >= 1 mapping and when every mapped KHS item has an APPROVED KHS version valid on its start date. */
    private function requireReadyForApproval(object $v): void
    {
        $mapped = DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('m.construction_type_version_id', $v->id)->get(['m.khs_item_id', 'i.code']);
        if ($mapped->isEmpty()) {
            throw new AssignmentRuleViolation("Versi {$v->version_number} dari {$v->name} belum memiliki pemetaan KHS; tidak dapat disetujui.");
        }
        $ready = DB::table('khs_item_versions')->whereIn('khs_item_id', $mapped->pluck('khs_item_id'))->where('status', 'APPROVED')
            ->where('valid_from', '<=', $v->valid_from)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $v->valid_from))
            ->pluck('khs_item_id')->all();
        $missing = $mapped->reject(fn ($m) => in_array($m->khs_item_id, $ready, true))->pluck('code');
        if ($missing->isNotEmpty()) {
            throw new AssignmentRuleViolation("{$missing->count()} kode KHS pada pemetaan {$v->name} belum memiliki versi KHS yang disetujui dan berlaku pada {$v->valid_from} (contoh: ".$missing->take(5)->implode(', ').').');
        }
    }

    private function requireDraft(object $v, string $verb = 'diubah'): void
    {
        if ($v->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Versi berstatus {$v->status}; hanya DRAFT yang dapat {$verb} (versi yang disetujui bersifat immutable — buat versi baru).");
        }
    }

    /** @param array<string, mixed> $r */
    private function validateTypeRow(array $r, array $labelCount, array $codeCount): array
    {
        $e = [];
        if (! in_array($r['group'], (array) config('distriva.construction_groups'), true)) {
            $e[] = "Kelompok '{$r['group']}' tidak termasuk cakupan (".implode(', ', (array) config('distriva.construction_groups')).').';
        }
        if ($r['label'] === '' || mb_strlen($r['label']) > 150) {
            $e[] = $r['label'] === '' ? 'Label kosong.' : 'Label melebihi 150 karakter.';
        }
        if ($r['code'] !== '' && ! preg_match('/^[A-Z0-9_.\-]{1,50}$/', $r['code'])) {
            $e[] = 'Kode hanya huruf besar, angka, titik, garis bawah, tanda hubung (maks. 50).';
        }
        if (($labelCount[$r['group'].'|'.mb_strtolower($r['label'])] ?? 0) > 1) {
            $e[] = 'Kelompok + label muncul lebih dari sekali dalam berkas.';
        }
        if ($r['code'] !== '' && ($codeCount[$r['code']] ?? 0) > 1) {
            $e[] = 'Kode muncul lebih dari sekali dalam berkas.';
        }

        return $e;
    }

    /** @return list<string> */
    private function typeRow(array $r, string $code, string $action, array $messages): array
    {
        return ['row' => $r['row'], 'group' => $r['group'], 'label' => $r['label'], 'code' => $code === '' ? null : $code, 'action' => $action, 'messages' => $messages];
    }

    /** @return array<string, int> next free sequence number per group */
    private function nextSequences(): array
    {
        $next = [];
        foreach ((array) config('distriva.construction_groups') as $g) {
            $max = 0;
            foreach (DB::table('construction_types')->where('group_code', $g)->pluck('code') as $c) {
                if (preg_match('/^'.preg_quote($g, '/').'-(\d+)$/', $c, $m)) {
                    $max = max($max, (int) $m[1]);
                }
            }
            $next[$g] = $max + 1;
        }

        return $next;
    }

    private function assignCode(string $group, array &$next): string
    {
        $n = $next[$group]++;

        return $group.'-'.str_pad((string) $n, $n > 99 ? 3 : 2, '0', STR_PAD_LEFT);
    }

    /** @return array<string, object> latest version per construction type id */
    private function latestVersions(): array
    {
        return DB::table('construction_type_versions as v')
            ->whereRaw('v.version_number = (select max(x.version_number) from construction_type_versions x where x.construction_type_id = v.construction_type_id)')
            ->get()->keyBy('construction_type_id')->all();
    }

    private function createVersion(string $typeId, array $r, ?object $prev, bool $hasDesc, bool $hasSymbol, string $validFrom, string $source, User $actor): void
    {
        $id = (string) Str::uuid();
        DB::table('construction_type_versions')->insert([
            'id' => $id, 'construction_type_id' => $typeId, 'version_number' => ($prev->version_number ?? 0) + 1, 'name' => $r['label'],
            'description' => $hasDesc ? ($r['description'] === '' ? null : $r['description']) : ($prev->description ?? null),
            'reference_symbol' => $hasSymbol ? ($r['reference_symbol'] === '' ? null : $r['reference_symbol']) : ($prev->reference_symbol ?? null),
            'valid_from' => $validFrom, 'status' => 'DRAFT', 'source_reference' => $source, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->event($id, 'CREATED', $actor, null, ['source' => $source]);
    }

    /** @param list<array<string, mixed>> $rows */
    private function guardSize(array $rows): void
    {
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === []) {
            throw new AssignmentRuleViolation('Berkas tidak memuat baris data.');
        }
        if (count($rows) > $max) {
            throw new AssignmentRuleViolation("Berkas melebihi batas {$max} baris.");
        }
    }

    private function tidy(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    private function event(string $versionId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('construction_version_events')->insert([
            'id' => (string) Str::uuid(), 'construction_type_version_id' => $versionId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now(),
        ]);
    }
}
