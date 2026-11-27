<?php

namespace App\Console\Commands;

use App\Models\OrganizationalUnit;
use App\Models\User;
use App\Services\OrganizationalUnitWriteService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Memuat daftar UP3 dan ULP dari unduhan daftar unit (`lUnitAp` / `lUnitUp`; kodenya sama dengan yang dipakai MIMS). Hanya menambah unit yang kodenya belum ada:
 * unit yang sudah ada tidak diubah (kecuali id APKT yang masih kosong), karena namanya dipakai mencocokkan tab workbook. Dari berkas hanya diambil kode, nama, induk, dan alamat kantor (nama pejabat tidak dibaca).
 */
class UnitsLoadCommand extends Command
{
    protected $signature = 'distriva:units-load {file : berkas daftar unit} {--apply : simpan; tanpa ini hanya uji coba} {--by= : email SYS_ADMIN yang tercatat sebagai pelaku (wajib dengan --apply)}';

    protected $description = 'Menambah UP3 dan ULP dari daftar unit (uji coba kecuali --apply).';

    public function handle(OrganizationalUnitWriteService $units): int
    {
        $raw = @file_get_contents((string) $this->argument('file'));
        if ($raw === false) {
            $this->error('Berkas tidak dapat dibaca.');

            return self::FAILURE;
        }
        $blocks = $this->objects($raw);
        if ($blocks === null) {
            $this->error('Isi berkas bukan daftar unit yang dikenal.');

            return self::FAILURE;
        }
        $rows = ['UP3' => [], 'ULP' => []];
        $apkt = [];      // nama UP3 => id APKT (bagian "KODE UNIT APKT": objek {id, nama}); id ULP di APKT sama dengan kode unit
        foreach ($blocks as $block) {
            if (isset($block['id'], $block['nama']) && str_starts_with(Str::upper((string) $block['nama']), 'UP3 ')) {
                $apkt[Str::lower(Str::squish((string) $block['nama']))] = (int) $block['id'];
            }
            foreach (['lUnitAp' => ['UP3', 'UNITAP'], 'lUnitUp' => ['ULP', 'UNITUP']] as $key => [$type, $codeColumn]) {
                foreach ($block[$key] ?? [] as $u) {
                    if (($u['SATUAN'] ?? '') === $type) {
                        $rows[$type][trim($u[$codeColumn])] = ['name' => $type.' '.Str::title(Str::squish((string) $u['NAMA'])), 'parent' => $type === 'ULP' ? trim($u['UNITAP']) : null, 'address' => Str::squish((string) ($u['ALAMAT'] ?? '')) ?: null];
                    }
                }
            }
        }
        $existing = OrganizationalUnit::query()->get()->keyBy('code');
        $new = [];
        foreach (['UP3', 'ULP'] as $type) {
            foreach ($rows[$type] as $code => $row) {
                $current = $existing[$code] ?? null;
                if ($current === null) {
                    $new[$code] = $row + ['type' => $type];
                } elseif (Str::lower($current->name) !== Str::lower($row['name'])) {
                    $this->warn("{$code} sudah ada sebagai \"{$current->name}\" (di berkas \"{$row['name']}\"); tidak diubah.");
                }
            }
        }
        $parents = array_merge($existing->where('unit_type', 'UP3')->keys()->all(), array_keys($rows['UP3']));
        $orphans = array_filter($new, fn (array $r) => $r['type'] === 'ULP' && ! in_array($r['parent'], $parents));
        if ($orphans !== []) {
            $this->error('ULP tanpa UP3 induk: '.implode(', ', array_keys($orphans)));

            return self::FAILURE;
        }

        // nama kembar membuat pencocokan menurut nama (mis. tab workbook NKO) ambigu: yang baru diberi akhiran nama UP3-nya
        $taken = array_fill_keys($existing->map(fn ($u) => Str::lower($u->name))->all(), true);
        $upName = fn (string $code) => Str::after(($rows['UP3'][$code]['name'] ?? $existing[$code]->name), 'UP3 ');
        foreach ($new as $code => &$row) {
            if (isset($taken[Str::lower($row['name'])])) {
                $renamed = $row['name'].' ('.$upName((string) $row['parent']).')';
                $this->warn("{$code}: nama \"{$row['name']}\" sudah dipakai; disimpan sebagai \"{$renamed}\".");
                $row['name'] = $renamed;
            }
            $taken[Str::lower($row['name'])] = true;
        }
        unset($row);

        // id APKT diisikan ke UP3 yang belum punya, termasuk UP3 yang sudah ada
        $names = $existing->where('unit_type', 'UP3')->map(fn ($u) => $u->name)->all() + array_map(fn (array $r) => $r['name'], array_filter($new, fn (array $r) => $r['type'] === 'UP3'));
        $fill = [];
        foreach ($names as $code => $name) {
            $id = $apkt[Str::lower($name)] ?? null;
            if ($id !== null && ($existing[$code]->apkt_id ?? null) === null) {
                $fill[$code] = $id;
            }
        }
        if ($apkt !== []) {
            $this->info('Id APKT UP3 yang akan diisi: '.count($fill).'.');
        }

        $count = fn (string $type) => count(array_filter($new, fn (array $r) => $r['type'] === $type));
        $this->info(sprintf('Berkas: %d UP3, %d ULP. Akan ditambah: %d UP3, %d ULP.', count($rows['UP3']), count($rows['ULP']), $count('UP3'), $count('ULP')));
        if (! $this->option('apply')) {
            $this->line('Uji coba: tidak ada yang disimpan. Jalankan dengan --apply --by=<email SYS_ADMIN>.');

            return self::SUCCESS;
        }
        $actor = User::query()->where('email', (string) $this->option('by'))->first();
        if ($actor === null || ! $actor->isSysAdmin()) {
            $this->error('--by harus email akun SYS_ADMIN.');

            return self::FAILURE;
        }

        $reason = 'Muat daftar UP3 dan ULP dari '.basename((string) $this->argument('file'));
        DB::transaction(function () use ($new, $units, $reason, $actor, $fill) {
            foreach ($new as $code => $row) {      // UP3 lebih dulu (urutan $new)
                $parent = $row['parent'] === null ? null : OrganizationalUnit::query()->where('code', $row['parent'])->firstOrFail();
                $units->create((string) $code, $row['name'], $row['type'], $parent, $row['address'], $reason, $actor);
            }
            foreach ($fill as $code => $id) {
                DB::table('organizational_units')->where('code', (string) $code)->update(['apkt_id' => $id, 'updated_at' => now()]);
            }
        });
        $this->info(count($new).' unit disimpan.');

        return self::SUCCESS;
    }

    /**
     * Berkas berisi beberapa objek JSON yang ditempel berurutan, jadi dipotong pada kurung penutup tingkat teratas (kurung di dalam teks diabaikan).
     *
     * @return ?list<array<string, mixed>> null bila bukan JSON
     */
    private function objects(string $raw): ?array
    {
        preg_match_all('/"(?:[^"\\\\]++|\\\\.)*+"(*SKIP)(*FAIL)|[{}]/s', $raw, $braces, PREG_OFFSET_CAPTURE);
        $out = [];
        $depth = 0;
        $start = 0;
        foreach ($braces[0] as [$brace, $at]) {
            if ($brace === '{') {
                $depth++ === 0 && $start = $at;
            } elseif (--$depth === 0) {
                $object = json_decode(substr($raw, $start, $at - $start + 1), true);
                if (! is_array($object)) {
                    return null;
                }
                $out[] = $object;
            }
        }

        return $out === [] || $depth !== 0 ? null : $out;
    }
}
