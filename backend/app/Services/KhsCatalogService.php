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
 * KHS catalogue (docs/23 §2.5, docs/16): the KHS code is the stable key; names/units live in versions.
 * Import and edits only ever create or change DRAFT versions; a draft becomes active only through approval by a
 * different user (also enforced by a database CHECK), and approved versions are immutable (database trigger).
 * Codes are never guessed or matched by similarity. Callers must authorize the actor first.
 */
class KhsCatalogService
{
    private const HEADERS = [
        'code' => ['code', 'kode', 'kode_khs'],
        'name' => ['name', 'nama', 'uraian'],
        'unit' => ['unit', 'satuan'],
        'description' => ['description', 'deskripsi', 'keterangan'],
        'category' => ['category', 'kategori', 'sumber'],
    ];

    /**
     * @return array{summary: array<string, int|bool>, rows: list<array<string, mixed>>}
     */
    public function import(UploadedFile $file, string $validFrom, ?string $sourceReference, bool $dryRun, bool $acceptUnitChanges, User $actor): array
    {
        ['rows' => $rows, 'columns' => $columns] = CsvTable::read($file, self::HEADERS, ['code', 'name', 'unit']);
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === []) {
            throw new AssignmentRuleViolation('Berkas tidak memuat baris data.');
        }
        if (count($rows) > $max) {
            throw new AssignmentRuleViolation("Berkas melebihi batas {$max} baris.");
        }
        // The workbook has names with line breaks and runs of spaces: both become a single space (same rule on every import,
        // so comparisons with earlier versions stay consistent). Codes are never touched.
        $rows = array_map(fn (array $r) => array_merge($r, [
            'name' => $this->tidy($r['name']), 'description' => $this->tidy($r['description']),
        ]), $rows);
        $hasDescription = in_array('description', $columns, true);
        $hasCategory = in_array('category', $columns, true);
        $source = $sourceReference !== null && trim($sourceReference) !== '' ? trim($sourceReference) : mb_substr($file->getClientOriginalName(), 0, 255);

        $run = function () use ($rows, $hasDescription, $hasCategory, $validFrom, $source, $dryRun, $acceptUnitChanges, $actor): array {
            $counts = array_count_values(array_filter(array_column($rows, 'code'), fn ($c) => $c !== ''));
            $items = DB::table('khs_items')->whereIn('code', array_keys($counts))->get()->keyBy('code');
            $latest = $this->latestVersions($items->pluck('id')->all());
            $drafts = DB::table('khs_item_versions')->where('status', 'DRAFT')->whereIn('khs_item_id', $items->pluck('id')->all())->pluck('version_number', 'khs_item_id');

            $tally = ['new_items' => 0, 'new_versions' => 0, 'unchanged' => 0, 'rejected' => 0, 'unit_changes' => 0];
            $out = [];
            $apply = [];

            foreach ($rows as $r) {
                [$action, $messages, $unitChange] = $this->classify($r, $counts, $items, $latest, $drafts, $hasDescription, $hasCategory);
                match ($action) {
                    'NEW_ITEM' => $tally['new_items']++, 'NEW_VERSION' => $tally['new_versions']++,
                    'UNCHANGED' => $tally['unchanged']++, default => $tally['rejected']++,
                };
                $tally['unit_changes'] += $unitChange ? 1 : 0;
                $out[] = ['row' => $r['row'], 'code' => $r['code'], 'name' => $r['name'], 'unit' => $r['unit'], 'action' => $action, 'unit_change' => $unitChange, 'messages' => $messages];
                if (in_array($action, ['NEW_ITEM', 'NEW_VERSION'], true)) {
                    $apply[] = [$r, $items->get($r['code'])?->id, $latest[$items->get($r['code'])?->id ?? ''] ?? null];
                }
            }

            if (! $dryRun) {
                if ($tally['unit_changes'] > 0 && ! $acceptUnitChanges) {
                    throw new AssignmentRuleViolation("Berkas memuat {$tally['unit_changes']} perubahan satuan yang memerlukan persetujuan eksplisit (accept_unit_changes).");
                }
                foreach ($apply as [$r, $itemId, $previous]) {
                    $this->createDraft($r, $itemId, $previous, $hasDescription, $hasCategory, $validFrom, $source, $actor);
                }
            }

            return ['summary' => $tally + ['total' => count($rows), 'dry_run' => $dryRun], 'rows' => $out];
        };

        return $dryRun ? $run() : DB::transaction($run);
    }

    /** @param array<string, mixed> $changes name, description, unit_text, category, valid_from */
    public function updateDraft(string $versionId, array $changes, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $changes, $reason, $actor): void {
            $v = DB::table('khs_item_versions')->where('id', $versionId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($v->status !== 'DRAFT') {
                throw new AssignmentRuleViolation('Hanya versi DRAFT yang dapat diubah; versi yang disetujui bersifat immutable. Buat versi baru.');
            }
            $before = array_intersect_key((array) $v, $changes);
            $changes = array_filter($changes, fn ($val, $k) => $before[$k] !== $val, ARRAY_FILTER_USE_BOTH);
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }
            DB::table('khs_item_versions')->where('id', $versionId)->update($changes + ['updated_at' => now()]);
            $this->event($versionId, 'DRAFT_UPDATED', $actor, $reason, ['before' => array_intersect_key($before, $changes), 'after' => $changes]);
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
                $versions = DB::table('khs_item_versions')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($versions->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian versi tidak ditemukan.');
                }
                foreach ($versions as $v) {
                    if ($v->status !== 'DRAFT') {
                        throw new AssignmentRuleViolation("Versi {$v->id} berstatus {$v->status}; hanya DRAFT yang dapat disetujui.");
                    }
                    if ($v->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat versi tidak dapat menyetujui versinya sendiri.', 403);
                    }
                }

                $closed = 0;
                foreach ($versions as $v) {
                    $from = CarbonImmutable::parse($v->valid_from);
                    $current = DB::table('khs_item_versions')->where('khs_item_id', $v->khs_item_id)->where('status', 'APPROVED')
                        ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();

                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Versi baru harus berlaku setelah versi {$old->version_number} yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('khs_item_versions')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan versi yang lebih baru.', ['closed_by_version' => $v->id, 'valid_until' => $from->subDay()->toDateString()]);
                        $closed++;
                    }

                    DB::table('khs_item_versions')->where('id', $v->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($v->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $versions->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    public function retire(string $versionId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $reason, $actor): void {
            $v = DB::table('khs_item_versions')->where('id', $versionId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($v->status !== 'APPROVED') {
                throw new AssignmentRuleViolation("Versi berstatus {$v->status}; hanya versi APPROVED yang dapat dinonaktifkan.");
            }
            $today = CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();
            $until = $v->valid_until === null || $v->valid_until > $today ? max($today, $v->valid_from) : $v->valid_until;
            DB::table('khs_item_versions')->where('id', $versionId)->update(['status' => 'INACTIVE', 'valid_until' => $until, 'updated_at' => now()]);
            $this->event($versionId, 'RETIRED', $actor, $reason, ['valid_until' => $until]);
        });
    }

    /** @param list<string> $itemIds @return array<string, object> latest version per item id */
    private function latestVersions(array $itemIds): array
    {
        if ($itemIds === []) {
            return [];
        }

        return DB::table('khs_item_versions as v')->whereIn('v.khs_item_id', $itemIds)
            ->whereRaw('v.version_number = (select max(x.version_number) from khs_item_versions x where x.khs_item_id = v.khs_item_id)')
            ->get()->keyBy('khs_item_id')->all();
    }

    /** @return array{0:string,1:list<string>,2:bool} */
    private function classify(array $r, array $counts, $items, array $latest, $drafts, bool $hasDescription, bool $hasCategory): array
    {
        $errors = [];
        if ($r['code'] === '') {
            $errors[] = 'Kode KHS kosong.';
        } elseif (! preg_match('/^[A-Za-z0-9._\-]{1,50}$/', $r['code'])) {
            $errors[] = 'Kode KHS hanya boleh huruf, angka, titik, garis bawah, dan tanda hubung (maks. 50).';
        } elseif (($counts[$r['code']] ?? 0) > 1) {
            $errors[] = 'Kode KHS muncul lebih dari sekali dalam berkas.';
        }
        if ($r['name'] === '' || mb_strlen($r['name']) > 255) {
            $errors[] = $r['name'] === '' ? 'Uraian/nama kosong.' : 'Nama melebihi 255 karakter.';
        }
        if ($r['unit'] === '' || mb_strlen($r['unit']) > 30) {
            $errors[] = $r['unit'] === '' ? 'Satuan kosong.' : 'Satuan melebihi 30 karakter.';
        }
        if ($hasCategory && mb_strlen($r['category']) > 50) {
            $errors[] = 'Kategori melebihi 50 karakter.';
        }
        if ($errors !== []) {
            return ['REJECT', $errors, false];
        }

        $item = $items->get($r['code']);
        if ($item === null) {
            return ['NEW_ITEM', [], false];
        }
        if ($drafts->has($item->id)) {
            return ['REJECT', ["Sudah ada draf versi {$drafts[$item->id]} yang belum disetujui; setujui atau ubah draf itu dahulu."], false];
        }

        $prev = $latest[$item->id];
        $unitChange = $prev->unit_text !== $r['unit'];
        $same = $prev->name === $r['name'] && ! $unitChange
            && (! $hasDescription || ($prev->description ?? '') === $r['description'])
            && (! $hasCategory || ($prev->category ?? '') === $r['category']);

        if ($same) {
            return ['UNCHANGED', [], false];
        }

        return ['NEW_VERSION', $unitChange ? ["Satuan berubah dari '{$prev->unit_text}' menjadi '{$r['unit']}': perlu persetujuan eksplisit."] : [], $unitChange];
    }

    private function createDraft(array $r, ?string $itemId, ?object $previous, bool $hasDescription, bool $hasCategory, string $validFrom, string $source, User $actor): void
    {
        $itemId ??= tap((string) Str::uuid(), fn ($id) => DB::table('khs_items')->insert(['id' => $id, 'code' => $r['code'], 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]));
        $versionId = (string) Str::uuid();

        DB::table('khs_item_versions')->insert([
            'id' => $versionId, 'khs_item_id' => $itemId, 'version_number' => ($previous->version_number ?? 0) + 1,
            'name' => $r['name'], 'unit_text' => $r['unit'],
            // A column that is absent from the file carries the previous value forward instead of blanking it.
            'description' => $hasDescription ? ($r['description'] === '' ? null : $r['description']) : ($previous->description ?? null),
            'category' => $hasCategory ? ($r['category'] === '' ? null : $r['category']) : ($previous->category ?? null),
            'valid_from' => $validFrom, 'status' => 'DRAFT', 'source_reference' => $source, 'created_by' => $actor->getKey(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->event($versionId, 'CREATED', $actor, null, ['source' => $source]);
    }

    private function tidy(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    private function event(string $versionId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('khs_version_events')->insert([
            'id' => (string) Str::uuid(), 'khs_item_version_id' => $versionId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now(),
        ]);
    }

    private function translate(QueryException $e): AssignmentRuleViolation|QueryException
    {
        return match ($e->getCode()) {
            '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan versi aktif lain untuk kode KHS yang sama.', 0, $e),
            '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas versi KHS.', 0, $e),
            default => $e,
        };
    }
}
