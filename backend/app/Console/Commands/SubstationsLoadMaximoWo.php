<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Substations\MaximoWoLoadService;
use Illuminate\Console\Command;

/** php artisan substations:load-maximo-wo tools/maximo_sync/out/maximo-wo-pengukuran.csv [--dry-run] [--actor=email] (tools/maximo_sync/README.md). */
class SubstationsLoadMaximoWo extends Command
{
    protected $signature = 'substations:load-maximo-wo {file : CSV dari tools/maximo_sync (parse)} {--actor=admin@distriva.com : akun pencatat} {--dry-run : hitung tanpa menyimpan} {--buat-gardu : bentuk gardu yang belum ada (ditandai perlu ditinjau)} {--ekspor-tak-dikenal= : tulis daftar gardu yang belum ada di data induk ke CSV ini}';

    protected $description = 'Muat pengukuran WO inspeksi gardu Maximo sebagai pembacaan gardu yang sudah ada (idempoten; gardu yang belum ada dilaporkan; dibentuk hanya dengan --buat-gardu).';

    public function handle(MaximoWoLoadService $service): int
    {
        $actor = User::query()->where('email', $this->option('actor'))->first();
        if ($actor === null) {
            $this->error('Akun pencatat tidak ditemukan: '.$this->option('actor'));

            return self::FAILURE;
        }
        $r = $service->load((string) $this->argument('file'), $actor, (bool) $this->option('dry-run'), (bool) $this->option('buat-gardu'), $this->option('ekspor-tak-dikenal') ?: null);
        $this->line(($r['dry_run'] ? '[DRY RUN, tidak disimpan] ' : '').json_encode($r['counts'], JSON_UNESCAPED_UNICODE));
        foreach ($r['problems'] as $k => $list) {
            $this->warn("{$k}: ".implode(', ', $list));
        }

        return self::SUCCESS;
    }
}
