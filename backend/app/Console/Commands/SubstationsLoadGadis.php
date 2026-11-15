<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Substations\GadisLoadService;
use Illuminate\Console\Command;

/** php artisan substations:load-gadis pasangan-gadis.csv [--dry-run] [--actor=email] (CSV dari tools/dil_sync/gadis_pairs.py). */
class SubstationsLoadGadis extends Command
{
    protected $signature = 'substations:load-gadis {file : CSV ulp_code,code,gadis_number} {--actor=admin@distriva.com : akun pencatat} {--dry-run : hitung tanpa menyimpan}';

    protected $description = 'Isi nomor GADIS (GD514…) gardu yang masih kosong dari pasangan DIL; yang sudah terisi tidak ditimpa (idempoten).';

    public function handle(GadisLoadService $service): int
    {
        $actor = User::query()->where('email', $this->option('actor'))->first();
        if ($actor === null) {
            $this->error('Akun pencatat tidak ditemukan: '.$this->option('actor'));

            return self::FAILURE;
        }
        $r = $service->load((string) $this->argument('file'), $actor, (bool) $this->option('dry-run'));
        $this->line(($r['dry_run'] ? '[DRY RUN, tidak disimpan] ' : '').json_encode($r['counts'], JSON_UNESCAPED_UNICODE));
        $r['conflicts'] !== [] && $this->warn('Tidak diubah: '.implode(' | ', array_slice($r['conflicts'], 0, 10)));
        $r['not_found'] !== [] && $this->warn('Gardu DIL belum ada di DISTRIVA ('.count($r['not_found']).'): '.implode(', ', array_slice($r['not_found'], 0, 15)).(count($r['not_found']) > 15 ? ', …' : ''));

        return self::SUCCESS;
    }
}
