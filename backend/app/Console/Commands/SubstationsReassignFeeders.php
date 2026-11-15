<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Substations\FeederReassignService;
use Illuminate\Console\Command;

/** php artisan substations:reassign-feeders usulan.csv --reason="..." [--dry-run] [--actor=email] (CSV: ulp,kode_gardu,kode_penyulang_tujuan). */
class SubstationsReassignFeeders extends Command
{
    protected $signature = 'substations:reassign-feeders {file : CSV dengan kolom ulp, kode_gardu, kode_penyulang_tujuan} {--reason= : alasan yang dicatat di riwayat gardu} {--actor=admin@distriva.com : akun pencatat} {--dry-run : hitung tanpa menyimpan}';

    protected $description = 'Pindahkan gardu ke penyulang yang sudah ada menurut daftar yang telah ditinjau (tercatat di riwayat gardu, idempoten).';

    public function handle(FeederReassignService $service): int
    {
        $actor = User::query()->where('email', $this->option('actor'))->first();
        if ($actor === null || trim((string) $this->option('reason')) === '') {
            $this->error($actor === null ? 'Akun pencatat tidak ditemukan.' : 'Isi --reason untuk riwayat gardu.');

            return self::FAILURE;
        }
        $r = $service->apply((string) $this->argument('file'), $actor, (string) $this->option('reason'), (bool) $this->option('dry-run'));
        $this->line(($r['dry_run'] ? '[DRY RUN, tidak disimpan] ' : '').json_encode($r['counts']));
        $r['problems'] !== [] && $this->warn(implode(' | ', array_slice($r['problems'], 0, 10)));

        return self::SUCCESS;
    }
}
