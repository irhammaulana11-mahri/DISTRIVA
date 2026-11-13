<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Throwable;

/**
 * Builds the two-level material categories (kategori -> subkategori) from the PLN ERP master workbook "Master-Material-Subkategori ... Rev2" (sheet "TEMPLATE IMPORT ERP")
 * and puts every ERP material on its subcategory (docs/62 §46). Dry run by default: nothing is written without --apply.
 * Codes: category CAT-01 -> CAT_01; subcategory CAT_01_NN (NN = alphabetical position inside the category, so a re-run on the same workbook is stable).
 * A person's decision overrides the workbook: --override=ERPCODE:CAT-05:Subkategori Name (repeatable). Every material whose category changes gets a CATEGORY_MAPPED change log whose reason carries a lot id.
 * Old flat categories that are not in the workbook and hold no material are deactivated (never deleted); --keep-old leaves them alone.
 */
class ImportMaterialCategories extends Command
{
    protected $signature = 'distriva:import-material-categories
        {file : Path of the Excel workbook}
        {--actor= : E-mail of the user recorded in the change log (required with --apply)}
        {--override=* : ERPCODE:CAT-NN:Subkategori Name (a decision that replaces the workbook)}
        {--reason=Impor kategori material (Master Material Subkategori PLN ERP Rev2) : Reason recorded in the change log}
        {--keep-old : Do not deactivate the old flat categories}
        {--apply : Write the result (default is a dry run)}';

    protected $description = 'Import the two-level material categories and assign every ERP material to its subcategory (dry run unless --apply).';

    public function handle(): int
    {
        $file = (string) $this->argument('file');
        if (! is_file($file)) {
            $this->error('Berkas tidak ditemukan.');

            return self::FAILURE;
        }
        try {
            $rows = $this->read($file);
        } catch (Throwable $e) {
            $this->error('Berkas tidak dapat dibaca: '.$e->getMessage());

            return self::FAILURE;
        }
        foreach ((array) $this->option('override') as $o) {
            $parts = explode(':', (string) $o, 3);
            if (count($parts) !== 3 || ! preg_match('/^CAT-\d{2}$/', $parts[1]) || trim($parts[2]) === '') {
                $this->error("Format --override salah: {$o}");

                return self::FAILURE;
            }
            $key = ltrim(trim($parts[0]), '0');
            if (! isset($rows[$key])) {
                $this->error("Override untuk material {$parts[0]} yang tidak ada di berkas.");

                return self::FAILURE;
            }
            $rows[$key]['cat'] = $parts[1];
            $rows[$key]['sub'] = trim($parts[2]);
            $rows[$key]['catname'] = null;       // resolved from another row of that category
        }
        $catNames = [];
        foreach ($rows as $r) {
            if ($r['catname'] !== null) {
                $catNames[$r['cat']] = $r['catname'];
            }
        }
        foreach ($rows as $k => $r) {
            if (! isset($catNames[$r['cat']])) {
                $this->error("Kategori {$r['cat']} tidak punya nama pada berkas.");

                return self::FAILURE;
            }
            $rows[$k]['catname'] = $catNames[$r['cat']];
        }

        // tree: category -> sorted distinct subcategory names -> codes
        $tree = [];
        foreach ($rows as $r) {
            $tree[$r['cat']][$r['sub']] = true;
        }
        ksort($tree);
        $plan = [];
        foreach ($tree as $cat => $subs) {
            $names = array_keys($subs);
            sort($names, SORT_NATURAL | SORT_FLAG_CASE);
            $catCode = str_replace('-', '_', $cat);
            $plan[$cat] = ['code' => $catCode, 'name' => $catNames[$cat], 'subs' => []];
            foreach ($names as $i => $name) {
                if (mb_strlen($name) > 100) {
                    $this->error("Nama subkategori melebihi 100 karakter: {$name}");

                    return self::FAILURE;
                }
                $plan[$cat]['subs'][$name] = sprintf('%s_%02d', $catCode, $i + 1);
            }
        }

        $dbMaterials = DB::table('materials')->get(['id', 'code', 'category_id'])->keyBy(fn ($m) => ltrim($m->code, '0'));
        $missing = array_diff_key($rows, $dbMaterials->all());
        $extra = array_diff_key($dbMaterials->all(), $rows);
        $this->line(sprintf('Berkas: %d material | database: %d | tidak ada di database: %d | di database tapi tidak di berkas: %d', count($rows), $dbMaterials->count(), count($missing), count($extra)));
        $this->line(sprintf('Rencana: %d kategori, %d subkategori.', count($plan), array_sum(array_map(fn ($p) => count($p['subs']), $plan))));
        foreach ($plan as $cat => $p) {
            $n = count(array_filter($rows, fn ($r) => $r['cat'] === $cat));
            $this->line(sprintf('  %-8s %-48s %2d subkategori, %3d material', $p['code'], mb_substr($p['name'], 0, 48), count($p['subs']), $n));
        }
        if ($missing !== []) {
            $this->warn(count($missing).' material pada berkas tidak ada di database dan dilewati.');
        }

        if (! $this->option('apply')) {
            $this->info('Dry run: tidak ada yang disimpan. Tambahkan --apply --actor=EMAIL untuk menerapkan.');

            return self::SUCCESS;
        }
        $actor = User::query()->where('email', (string) $this->option('actor'))->first();
        if ($actor === null) {
            $this->error('--actor harus berupa e-mail pengguna yang ada.');

            return self::FAILURE;
        }

        $batch = (string) Str::uuid();
        $reason = (string) $this->option('reason');
        DB::transaction(function () use ($plan, $rows, $dbMaterials, $actor, $batch, $reason): void {
            $subId = [];
            foreach ($plan as $cat => $p) {
                $parent = $this->upsert($p['code'], $p['name'], null);
                foreach ($p['subs'] as $name => $code) {
                    $subId[$cat][$name] = $this->upsert($code, $name, $parent);
                }
            }
            $changed = 0;
            foreach ($rows as $key => $r) {
                $m = $dbMaterials->get($key);
                if ($m === null) {
                    continue;
                }
                $target = $subId[$r['cat']][$r['sub']];
                if ($m->category_id === $target) {
                    continue;
                }
                DB::table('materials')->where('id', $m->id)->update(['category_id' => $target, 'updated_at' => now()]);
                DB::table('material_change_logs')->insert(['id' => (string) Str::uuid(), 'material_id' => $m->id, 'change_type' => 'CATEGORY_MAPPED',
                    'before_values' => json_encode(['category_id' => $m->category_id]), 'after_values' => json_encode(['category_id' => $target]), 'batch_id' => null,   // batch_id is the FK of a material import batch
                    'actor_user_id' => $actor->getKey(), 'reason' => Str::limit($reason." [lot {$batch}]", 990, ''), 'changed_at' => now()]);
                $changed++;
            }
            $this->info("Kategori dipetakan untuk {$changed} material.");
            if (! $this->option('keep-old')) {
                $keep = DB::table('material_categories')->whereIn('code', array_merge(...array_map(fn ($p) => array_merge([$p['code']], array_values($p['subs'])), array_values($plan))))->pluck('id')->all();
                $old = DB::table('material_categories')->whereNotIn('id', $keep)->where('is_active', true)
                    ->whereNotExists(fn ($q) => $q->from('materials')->whereColumn('materials.category_id', 'material_categories.id'))->get(['id', 'code']);
                DB::table('material_categories')->whereIn('id', $old->pluck('id'))->update(['is_active' => false, 'updated_at' => now()]);
                $this->info('Kategori lama dinonaktifkan: '.($old->pluck('code')->implode(', ') ?: '-'));
            }
        });
        $this->info("Selesai. batch_id={$batch}");

        return self::SUCCESS;
    }

    private function upsert(string $code, string $name, ?string $parentId): string
    {
        $row = DB::table('material_categories')->where('code', $code)->first();
        if ($row === null) {
            $id = (string) Str::uuid();
            DB::table('material_categories')->insert(['id' => $id, 'parent_id' => $parentId, 'code' => $code, 'name' => $name, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

            return $id;
        }
        DB::table('material_categories')->where('id', $row->id)->update(['name' => $name, 'is_active' => true, 'updated_at' => now()]);

        return $row->id;
    }

    /** @return array<string,array{code:string,cat:string,catname:?string,sub:string}> keyed by the ERP code without leading zeros */
    private function read(string $file): array
    {
        $reader = IOFactory::createReader('Xlsx');
        $reader->setReadDataOnly(true);
        $reader->setLoadSheetsOnly(['TEMPLATE IMPORT ERP']);
        $sheet = $reader->load($file)->getSheetByName('TEMPLATE IMPORT ERP') ?? throw new \RuntimeException('Lembar "TEMPLATE IMPORT ERP" tidak ada.');
        $head = null;
        $out = [];
        foreach ($sheet->toArray(null, false, false, false) as $cells) {
            $cells = array_map(fn ($v) => $v === null ? '' : trim((string) $v), $cells);
            if ($head === null) {
                if (in_array('Kode ERP', $cells, true)) {
                    $head = array_flip($cells);
                }

                continue;
            }
            $code = ltrim($cells[$head['Kode ERP']] ?? '', '0');
            if ($code === '' || ! ctype_digit($code)) {
                continue;
            }
            $cat = $cells[$head['Kode Kategori']] ?? '';
            $sub = $cells[$head['Subkategori Final']] ?? '';
            if (! preg_match('/^CAT-\d{2}$/', $cat) || $sub === '') {
                throw new \RuntimeException("Baris material {$code} tidak punya kategori/subkategori yang valid.");
            }
            if (isset($out[$code])) {
                throw new \RuntimeException("Kode ERP {$code} muncul lebih dari sekali.");
            }
            $out[$code] = ['code' => $code, 'cat' => $cat, 'catname' => $cells[$head['Kategori Final']] ?? '', 'sub' => $sub];
        }
        if ($head === null || $out === []) {
            throw new \RuntimeException('Tidak ada baris material yang dapat dibaca.');
        }

        return $out;
    }
}
