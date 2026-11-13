<?php

namespace App\Console\Commands;

use App\Services\Inventory\MimsStockSyncService;
use Illuminate\Console\Command;

/** Called every minute by the scheduler: pulls the MIMS stock when the automatic pull is due. */
class MimsSyncAutoCommand extends Command
{
    protected $signature = 'distriva:mims-sync-auto';

    protected $description = 'Menarik stok MIMS otomatis bila waktunya tiba (token tersimpan milik pengguna yang mengaktifkan).';

    public function handle(MimsStockSyncService $sync): int
    {
        $n = $sync->runAutoIfDue();
        if ($n !== null) {
            $this->info("Tarik stok MIMS otomatis: {$n} gudang diproses.");
        }

        return self::SUCCESS;
    }
}
