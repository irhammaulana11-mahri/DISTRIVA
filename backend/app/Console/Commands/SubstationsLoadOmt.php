<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Substations\OmtLoadService;
use Illuminate\Console\Command;

/** php artisan substations:load-omt tools/omt_sync/out/omt-pengukuran-bersih-mojokerto.csv [--dry-run] [--actor=email] (docs/83). */
class SubstationsLoadOmt extends Command
{
    protected $signature = 'substations:load-omt {file : CSV bersih dari tools/omt_sync (fix)} {--actor=admin@distriva.com : akun pencatat} {--dry-run : hitung tanpa menyimpan}';

    protected $description = 'Muat pengukuran gardu OMT yang sudah dibersihkan ke master gardu, master penyulang, dan pembacaan (idempoten).';

    public function handle(OmtLoadService $service): int
    {
        $actor = User::query()->where('email', $this->option('actor'))->first();
        if ($actor === null) {
            $this->error('Akun pencatat tidak ditemukan: '.$this->option('actor'));

            return self::FAILURE;
        }
        $r = $service->load((string) $this->argument('file'), $actor, (bool) $this->option('dry-run'));
        $this->line(($r['dry_run'] ? '[DRY RUN, tidak disimpan] ' : '').json_encode($r['counts'], JSON_UNESCAPED_UNICODE));
        foreach ($r['problems'] as $k => $list) {
            $this->warn("{$k}: ".implode(', ', $list));
        }

        return self::SUCCESS;
    }
}
