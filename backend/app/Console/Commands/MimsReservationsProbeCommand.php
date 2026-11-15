<?php

namespace App\Console\Commands;

use App\Services\Inventory\MimsReservationSyncService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * Checks, on one real warehouse, which columns MIMS returns for the reservation list (key NAMES only, nothing is saved, no value is printed). Uses the token the given user saved on the MIMS pull page.
 */
class MimsReservationsProbeCommand extends Command
{
    protected $signature = 'distriva:mims-reservations-probe {warehouse : kode gudang DISTRIVA, mis. 5118-2810} {--user= : email pengguna yang menyimpan token MIMS} {--days=30 : rentang hari ke belakang}';

    protected $description = 'Memeriksa kolom jawaban daftar reservasi MIMS pada satu gudang (hanya nama kolom, tidak menyimpan apa pun).';

    public function handle(MimsReservationSyncService $svc): int
    {
        $wh = DB::table('warehouses')->where('code', $this->argument('warehouse'))->first();
        if ($wh === null || $wh->plant === null || $wh->stor_loc === null) {
            $this->error('Gudang tidak ditemukan atau belum punya plant dan storage location.');

            return self::FAILURE;
        }
        $user = DB::table('users')->where('email', (string) $this->option('user'))->value('id');
        $enc = $user === null ? null : DB::table('user_mims_tokens')->where('user_id', $user)->value('token_encrypted');
        if ($enc === null) {
            $this->error('Token MIMS tersimpan tidak ditemukan untuk pengguna itu (simpan token di halaman Tarik Stok MIMS dulu).');

            return self::FAILURE;
        }
        $r = $svc->probe($wh, Crypt::decryptString($enc), max(1, min(366, (int) $this->option('days'))));
        $this->line("Status: {$r['status']}".($r['http'] !== null ? " (HTTP {$r['http']})" : '').($r['message'] ? " - {$r['message']}" : ''));
        $this->line("Jumlah baris: {$r['rows']}");
        if ($r['keys'] !== []) {
            $this->line('Kolom pada baris pertama: '.implode(', ', $r['keys']));
            foreach ($r['covered'] as $field => $key) {
                $this->line(sprintf('  %-16s %s', $field, $key === null ? 'TIDAK DITEMUKAN' : "dibaca dari kolom {$key}"));
            }
        }

        return $r['status'] === 'OK' || $r['status'] === 'EMPTY' ? self::SUCCESS : self::FAILURE;
    }
}
