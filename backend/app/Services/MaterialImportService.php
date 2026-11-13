<?php

namespace App\Services;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\Material;
use App\Models\MaterialCategory;
use App\Models\User;
use App\Support\CsvTable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Controlled import of the ERP material master (docs/23 §3, docs/16 §14):
 *   file -> staging (validated, diffed against the current master) -> preview -> explicit confirmation -> upsert -> change log.
 * Rules: DISTRIVA never invents material codes; empty or duplicated codes are rejected (every row sharing the code);
 * materials missing from a file are NOT deleted or deactivated; a unit change needs explicit approval at confirmation;
 * nothing here reads or writes stock, allocation or any inventory transaction.
 * Callers must authorize the actor first.
 */
class MaterialImportService
{
    private const HEADERS = [
        'code' => ['code', 'kode', 'sku', 'kode_material'],
        'name' => ['name', 'nama', 'nama_material'],
        'unit' => ['unit', 'satuan', 'uom'],
        'spec' => ['spec', 'spesifikasi'],
        'category_code' => ['category_code', 'kategori', 'category'],
    ];

    /** @return array<string, mixed> batch summary */
    public function stage(UploadedFile $file, User $actor): array
    {
        ['rows' => $rows, 'columns' => $columns] = $this->parse($file);
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if (count($rows) === 0) {
            throw new AssignmentRuleViolation('Berkas tidak memuat baris data.');
        }
        if (count($rows) > $max) {
            throw new AssignmentRuleViolation("Berkas melebihi batas {$max} baris.");
        }

        $checksum = hash_file('sha256', $file->getRealPath());

        return DB::transaction(function () use ($rows, $columns, $file, $checksum, $actor): array {
            $batchId = (string) Str::uuid();
            $codes = collect($rows)->pluck('code')->filter(fn ($c) => $c !== '')->all();
            $counts = array_count_values($codes);
            $existing = Material::query()->whereIn('code', array_unique($codes))->get()->keyBy('code');
            $categories = $this->leafCategories();

            DB::table('material_sync_logs')->insert([
                'id' => $batchId, 'source' => mb_substr($file->getClientOriginalName(), 0, 100), 'checksum' => $checksum,
                'status' => 'STAGED', 'staged_by' => $actor->getKey(), 'total_rows' => count($rows), 'staged_at' => now(),
                'summary' => json_encode(['columns' => $columns]),
            ]);

            $tally = ['INSERT' => 0, 'UPDATE' => 0, 'UNCHANGED' => 0, 'REJECT' => 0];
            $unitChanges = 0;
            $stagingRows = [];

            foreach ($rows as $row) {
                [$action, $messages, $materialId, $unitChange] = $this->classify($row, $counts, $existing, $categories, in_array('spec', $columns, true));
                $tally[$action]++;
                $unitChanges += $unitChange ? 1 : 0;
                $stagingRows[] = [
                    'id' => (string) Str::uuid(), 'batch_id' => $batchId, 'row_number' => $row['row'],
                    'external_code' => $row['code'] === '' ? null : mb_substr($row['code'], 0, 100),
                    'name' => $row['name'] === '' ? null : mb_substr($row['name'], 0, 255),
                    'unit' => $row['unit'] === '' ? null : mb_substr($row['unit'], 0, 30),
                    'spec' => $row['spec'], 'category_code' => $row['category_code'] === '' ? null : mb_substr($row['category_code'], 0, 30),
                    'action' => $action, 'unit_change' => $unitChange,
                    'messages' => $messages === [] ? null : json_encode($messages), 'material_id' => $materialId,
                ];
            }
            foreach (array_chunk($stagingRows, 500) as $chunk) {
                DB::table('material_sync_staging')->insert($chunk);
            }

            DB::table('material_sync_logs')->where('id', $batchId)->update([
                'inserted_count' => $tally['INSERT'], 'updated_count' => $tally['UPDATE'], 'unchanged_count' => $tally['UNCHANGED'],
                'rejected_count' => $tally['REJECT'], 'unit_change_count' => $unitChanges,
            ]);

            return $this->summary($batchId);
        });
    }

    /**
     * @return array<string, mixed>
     *
     * @throws AssignmentRuleViolation
     */
    public function confirm(string $batchId, bool $approveUnitChanges, User $actor): array
    {
        return DB::transaction(function () use ($batchId, $approveUnitChanges, $actor): array {
            $batch = DB::table('material_sync_logs')->where('id', $batchId)->lockForUpdate()->first();

            if ($batch === null) {
                throw new AssignmentRuleViolation('Batch impor tidak ditemukan.');
            }
            if ($batch->status !== 'STAGED') {
                throw new AssignmentRuleViolation("Batch sudah {$batch->status}; tidak dapat dikonfirmasi lagi.");
            }
            if ($batch->unit_change_count > 0 && ! $approveUnitChanges) {
                throw new AssignmentRuleViolation("Batch memuat {$batch->unit_change_count} perubahan satuan yang memerlukan persetujuan eksplisit (approve_unit_changes).");
            }

            $columns = (json_decode((string) $batch->summary, true)['columns'] ?? []);
            $hasSpec = in_array('spec', $columns, true);
            $categories = $this->leafCategories();
            $rows = DB::table('material_sync_staging')->where('batch_id', $batchId)->whereIn('action', ['INSERT', 'UPDATE'])->orderBy('row_number')->get();
            $inserted = $updated = 0;

            foreach ($rows as $r) {
                $categoryId = $r->category_code !== null ? $categories->get($r->category_code)?->getKey() : null;

                if ($r->action === 'INSERT') {
                    // Re-check inside the lock: another batch may have created the code since staging.
                    if (Material::query()->where('code', $r->external_code)->exists()) {
                        throw new AssignmentRuleViolation("Kode {$r->external_code} sudah dibuat oleh proses lain sejak staging; lakukan staging ulang.");
                    }
                    $material = new Material;
                    $material->forceFill([
                        'code' => $r->external_code, 'name' => $r->name, 'unit' => $r->unit, 'spec' => $r->spec,
                        'category_id' => $categoryId, 'source_system' => 'ERP_MATERIAL', 'external_updated_at' => now(), 'is_active' => true,
                    ])->save();
                    $this->log($material->getKey(), 'INSERTED', null, $this->snapshot($material), $batchId, $actor, null);
                    $inserted++;

                    continue;
                }

                $material = Material::query()->whereKey($r->material_id)->lockForUpdate()->firstOrFail();
                $before = $this->snapshot($material);
                $material->forceFill(array_filter([
                    'name' => $r->name, 'unit' => $r->unit, 'category_id' => $categoryId, 'external_updated_at' => now(),
                ], fn ($v) => $v !== null) + ($hasSpec ? ['spec' => $r->spec] : []))->save(); // no spec column in the file = spec untouched
                $after = $this->snapshot($material->refresh());
                if ($before !== $after) {
                    $this->log($material->getKey(), 'UPDATED', array_diff_assoc($before, $after), array_diff_assoc($after, $before), $batchId, $actor, null);
                    $updated++;
                }
            }

            DB::table('material_sync_logs')->where('id', $batchId)->update([
                'status' => 'CONFIRMED', 'confirmed_by' => $actor->getKey(), 'finished_at' => now(),
                'inserted_count' => $inserted, 'updated_count' => $updated,
                'summary' => json_encode(['columns' => $columns, 'approved_unit_changes' => $approveUnitChanges]),
            ]);

            return $this->summary($batchId);
        });
    }

    public function cancel(string $batchId, User $actor): array
    {
        return DB::transaction(function () use ($batchId, $actor): array {
            $batch = DB::table('material_sync_logs')->where('id', $batchId)->lockForUpdate()->first();
            if ($batch === null) {
                throw new AssignmentRuleViolation('Batch impor tidak ditemukan.');
            }
            if ($batch->status !== 'STAGED') {
                throw new AssignmentRuleViolation("Batch sudah {$batch->status}; tidak dapat dibatalkan.");
            }
            DB::table('material_sync_logs')->where('id', $batchId)->update(['status' => 'CANCELLED', 'confirmed_by' => $actor->getKey(), 'finished_at' => now()]);

            return $this->summary($batchId);
        });
    }

    /** @return array<string, mixed>|null */
    public function summary(string $batchId): ?array
    {
        $b = DB::table('material_sync_logs')->where('id', $batchId)->first();

        return $b === null ? null : [
            'id' => $b->id, 'source' => $b->source, 'checksum' => $b->checksum, 'status' => $b->status,
            'staged_by' => $b->staged_by, 'confirmed_by' => $b->confirmed_by, 'staged_at' => $b->staged_at, 'finished_at' => $b->finished_at,
            'total_rows' => $b->total_rows, 'inserted' => $b->inserted_count, 'updated' => $b->updated_count, 'unchanged' => $b->unchanged_count,
            'rejected' => $b->rejected_count, 'unit_changes' => $b->unit_change_count,
        ];
    }

    /** Categories a material may point at: leaves only (a parent category with subcategories is not assignable). @return \Illuminate\Support\Collection<string, MaterialCategory> */
    private function leafCategories()
    {
        $parents = MaterialCategory::query()->whereNotNull('parent_id')->pluck('parent_id')->all();

        return MaterialCategory::query()->get()->reject(fn ($c) => in_array($c->getKey(), $parents, true))->keyBy('code');
    }

    /**
     * @param  array{row:int,code:string,name:string,unit:string,spec:?string,category_code:string}  $row
     * @param  array<string,int>  $counts
     * @return array{0:string,1:list<string>,2:?string,3:bool} action, messages, material id, unit changed
     */
    private function classify(array $row, array $counts, $existing, $categories, bool $hasSpec): array
    {
        $errors = [];
        $warnings = [];

        if ($row['code'] === '') {
            $errors[] = 'Kode material kosong.';
        } elseif (mb_strlen($row['code']) > 100) {
            $errors[] = 'Kode material melebihi 100 karakter.';
        } elseif (($counts[$row['code']] ?? 0) > 1) {
            $errors[] = 'Kode material muncul lebih dari sekali dalam berkas.';
        }
        if ($row['name'] === '') {
            $errors[] = 'Nama material kosong.';
        } elseif (mb_strlen($row['name']) > 255) {
            $errors[] = 'Nama material melebihi 255 karakter.';
        }
        if ($row['unit'] === '') {
            $errors[] = 'Satuan kosong.';
        } elseif (mb_strlen($row['unit']) > 30) {
            $errors[] = 'Satuan melebihi 30 karakter.';
        }
        if ($row['category_code'] !== '' && ! $categories->has($row['category_code'])) {
            $warnings[] = "Kategori '{$row['category_code']}' tidak dikenal atau berupa kategori induk (pilih subkategori); kategori tidak dipetakan.";
        }

        if ($errors !== []) {
            return ['REJECT', array_merge($errors, $warnings), null, false];
        }

        /** @var Material|null $current */
        $current = $existing->get($row['code']);
        if ($current === null) {
            if ($row['category_code'] === '') {
                $warnings[] = 'Kategori belum dipetakan.';
            }

            return ['INSERT', $warnings, null, false];
        }

        $unitChange = $current->unit !== $row['unit'];
        $catId = $row['category_code'] !== '' ? $categories->get($row['category_code'])?->getKey() : $current->category_id;
        $same = $current->name === $row['name'] && ! $unitChange && (! $hasSpec || ($current->spec ?? '') === ($row['spec'] ?? '')) && $current->category_id === $catId;

        if ($unitChange) {
            $warnings[] = "Satuan berubah dari '{$current->unit}' menjadi '{$row['unit']}': perlu persetujuan eksplisit.";
        }

        return [$same ? 'UNCHANGED' : 'UPDATE', $warnings, $current->getKey(), $unitChange];
    }

    /** @return array{rows: list<array{row:int,code:string,name:string,unit:string,spec:?string,category_code:string}>, columns: list<string>} */
    private function parse(UploadedFile $file): array
    {
        ['rows' => $rows, 'columns' => $columns] = CsvTable::read($file, self::HEADERS, ['code', 'name', 'unit']);

        foreach ($rows as &$row) {
            $row['spec'] = $row['spec'] === '' ? null : $row['spec'];
        }

        return ['rows' => $rows, 'columns' => $columns];
    }

    /** @return array<string, mixed> */
    private function snapshot(Material $m): array
    {
        return ['code' => $m->code, 'name' => $m->name, 'unit' => $m->unit, 'spec' => $m->spec, 'category_id' => $m->category_id, 'is_active' => (bool) $m->is_active];
    }

    private function log(string $materialId, string $type, ?array $before, array $after, ?string $batchId, User $actor, ?string $reason): void
    {
        DB::table('material_change_logs')->insert([
            'id' => (string) Str::uuid(), 'material_id' => $materialId, 'change_type' => $type,
            'before_values' => $before === null ? null : json_encode($before), 'after_values' => json_encode($after),
            'batch_id' => $batchId, 'actor_user_id' => $actor->getKey(), 'reason' => $reason, 'changed_at' => now(),
        ]);
    }
}
