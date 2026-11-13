<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Substations\OmtLoadService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * php artisan feeders:load-gi tools/samples/penyulang-gi.csv [--dry-run] — sets the GI NAME of the feeders from the owner's list (columns GI, PENYULANG), docs/83 §6.
 * A feeder matches by name (spaces and punctuation ignored) or, for the OMT forms like MJA_BANCANG / PCT_GADING (ULP code + feeder), by the part after the underscore. Near misses (typos such as SIKEPU / SIKEPUH) are only
 * suggested, never applied: a wrong merge would send a gardu to the wrong feeder.
 */
class FeedersLoadGi extends Command
{
    protected $signature = 'feeders:load-gi {file : CSV dengan kolom PENYULANG, RAYON, GARDU INDUK} {--actor=admin@distriva.com} {--dry-run} {--rename-typos : ganti ejaan penyulang yang hanya selisih 1-2 huruf dengan nama resmi di daftar (tanpa gabung)} {--create-missing : buat penyulang yang ada di daftar tetapi belum ada}';

    protected $description = 'Isi nama GI pada master penyulang dari daftar pemilik.';

    public function handle(): int
    {
        $actor = User::query()->where('email', $this->option('actor'))->first() ?? null;
        if ($actor === null) {
            $this->error('Akun pencatat tidak ditemukan.');

            return self::FAILURE;
        }
        $fh = fopen((string) $this->argument('file'), 'r') ?: throw new \RuntimeException('Berkas tidak dapat dibuka.');
        $head = array_map(fn ($h) => mb_strtoupper(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $h))), fgetcsv($fh, 0, ',', '"', '') ?: []);
        $giCol = array_search('GARDU INDUK', $head, true) ?: array_search('GI', $head, true);
        $pyCol = array_search('PENYULANG', $head, true);
        $rayCol = array_search('RAYON', $head, true);
        if ($giCol === false || $pyCol === false) {
            $this->error('Kolom PENYULANG dan GARDU INDUK (atau GI) wajib ada.');

            return self::FAILURE;
        }
        $map = [];
        $conflict = [];
        while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            if (! isset($r[$pyCol], $r[$giCol]) || trim($r[$pyCol]) === '') {
                continue;
            }
            $k = OmtLoadService::norm($r[$pyCol]);
            $gi = mb_strtoupper(trim($r[$giCol]));
            if (isset($map[$k]) && $map[$k]['gi'] !== $gi) {          // the same feeder under two GI: never guess
                $conflict[$k] = trim($r[$pyCol]).": {$map[$k]['gi']} / {$gi}";

                continue;
            }
            $map[$k] = ['gi' => $gi, 'name' => trim($r[$pyCol]), 'rayon' => isset($rayCol) && $rayCol !== false ? mb_strtoupper(trim((string) ($r[$rayCol] ?? ''))) : ''];
        }
        fclose($fh);
        foreach (array_keys($conflict) as $k) {
            unset($map[$k]);
        }
        $conflict !== [] && $this->warn("Penyulang dengan dua GI berbeda (dilewati): ".implode('; ', $conflict));
        $applied = $same = 0;
        $renamed = $created = $noneNames = $skipped = [];
        $byNameExisting = [];
        foreach (DB::table('distribution_feeders')->get(['name']) as $x) {
            $x->name !== null && $byNameExisting[OmtLoadService::norm($x->name)] = true;
        }
        $suggest = $none = [];
        $used = [];
        DB::beginTransaction();
        foreach (DB::table('distribution_feeders')->orderBy('code')->get() as $f) {
            $name = (string) ($f->name ?? '');
            $n = OmtLoadService::norm($name);
            $hit = $map[$n] ?? (preg_match('/^[A-Za-z]{2,4}_(.+)$/', $name, $m) ? ($map[OmtLoadService::norm($m[1])] ?? null) : null);
            if ($hit === null) {
                $best = null;
                foreach ($map as $k => $v) {
                    $d = levenshtein($n, $k);
                    if ($d <= 2 && ($best === null || $d < $best[0])) {
                        $best = [$d, $v['name'], $v['gi']];
                    }
                }
                if ($best !== null && $this->option('rename-typos') && ! isset($byNameExisting[OmtLoadService::norm($best[1])])) {      // a typo of an official name that no feeder carries yet: rename (never merge)
                    DB::table('distribution_feeders')->where('id', $f->id)->update(['name' => $best[1], 'gi_name' => $best[2], 'updated_at' => now()]);
                    DB::table('distribution_feeder_changes')->insert(['id' => (string) Str::uuid(), 'feeder_id' => $f->id, 'changed_by' => $actor->getKey(), 'action' => 'UPDATED', 'reason' => 'Ejaan disesuaikan dengan daftar penyulang pemilik (docs/83 §6).',
                        'before' => json_encode(['name' => $name, 'gi_name' => $f->gi_name]), 'after' => json_encode(['name' => $best[1], 'gi_name' => $best[2]]), 'created_at' => now()]);
                    $used[OmtLoadService::norm($best[1])] = true;
                    $renamed[] = "{$f->code}: {$name} → {$best[1]}";

                    continue;
                }
                if ($best === null) {
                    $noneNames[] = $n;
                }
                $best !== null ? $suggest[] = "{$f->code} ({$name}) ≈ {$best[1]} [GI {$best[2]}]" : $none[] = "{$f->code} ({$name})";

                continue;
            }
            $used[OmtLoadService::norm($hit['name'])] = true;
            if ($f->gi_name === $hit['gi']) {
                $same++;

                continue;
            }
            DB::table('distribution_feeders')->where('id', $f->id)->update(['gi_name' => $hit['gi'], 'updated_at' => now()]);
            DB::table('distribution_feeder_changes')->insert(['id' => (string) Str::uuid(), 'feeder_id' => $f->id, 'changed_by' => $actor->getKey(), 'action' => 'UPDATED', 'reason' => 'Nama GI dari daftar penyulang pemilik (docs/83 §6).',
                'before' => json_encode(['gi_name' => $f->gi_name]), 'after' => json_encode(['gi_name' => $hit['gi']]), 'created_at' => now()]);
            $applied++;
        }
        if ($this->option('create-missing')) {          // official feeders nobody carries yet (e.g. dedicated customer feeders): formed with their GI; owner = the UP3 of the existing feeders
            $owner = DB::table('distribution_feeders')->select('owner_unit_id')->groupBy('owner_unit_id')->orderByRaw('count(*) desc')->value('owner_unit_id');
            foreach ($map as $k => $v) {
                if (isset($used[$k]) || isset($byNameExisting[$k])) {
                    continue;
                }
                $look = array_values(array_filter($noneNames, fn ($nn) => str_contains($nn, $k) || str_contains($k, $nn)));
                if ($look !== []) {          // an existing feeder without a counterpart looks like this one (BENTENG PANCASILA ~ BENTENG): the owner decides, nothing is created
                    $skipped[] = "{$v['name']} ~ ".implode('/', $look);

                    continue;
                }
                $made = app(\App\Services\Substations\FeederService::class)->createFromName($v['name'], (string) $owner, (string) $actor->getKey());
                DB::table('distribution_feeders')->where('id', $made['id'])->update(['gi_name' => $v['gi'], 'notes' => 'Dibentuk dari daftar penyulang pemilik'.($v['rayon'] !== '' ? " (rayon {$v['rayon']})" : '').'; kode disingkat otomatis, koreksi bila berbeda dari kode Maximo.']);
                $created[] = $v['name'];
            }
        }
        $this->option('dry-run') ? DB::rollBack() : DB::commit();
        $this->line(($this->option('dry-run') ? '[DRY RUN] ' : '')."diisi {$applied}, sudah sama {$same}, hanya saran {$this->count($suggest)}, tanpa padanan {$this->count($none)}");
        $renamed !== [] && $this->info("Ejaan disesuaikan: ".implode('; ', $renamed));
        $skipped !== [] && $this->warn('Tidak dibentuk karena mirip penyulang yang sudah ada (perlu keputusan): '.implode('; ', $skipped));
        $created !== [] && $this->info('Penyulang dibentuk ('.count($created).'): '.implode(', ', $created));
        $suggest !== [] && $this->warn("Saran (tidak diterapkan):\n  ".implode("\n  ", $suggest));
        $none !== [] && $this->warn("Tanpa padanan di daftar:\n  ".implode("\n  ", $none));
        $unused = $this->option('create-missing') ? [] : array_values(array_filter(array_map(fn ($v) => $v['name'], $map), fn ($nm) => ! isset($used[OmtLoadService::norm($nm)])));
        $unused !== [] && $this->warn("Ada di daftar tetapi belum ada penyulangnya: ".implode(', ', $unused));

        return self::SUCCESS;
    }

    private function count(array $a): int
    {
        return count($a);
    }
}
