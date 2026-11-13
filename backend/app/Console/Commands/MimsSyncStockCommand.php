<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Inventory\MimsStockSyncService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Daily pull of the ERP (MIMS) stock of every active warehouse that has a plant and storage location (docs/62 §40). */
class MimsSyncStockCommand extends Command
{
    protected $signature = 'distriva:mims-sync-stock {--warehouse= : warehouse code (default: all)} {--date= : as-of date Y-m-d (default: today)} {--dry-run : read and validate, store nothing}';

    protected $description = 'Menarik stok dari MIMS (baca-saja) dan menyimpannya sebagai cuplikan stok per gudang.';

    public function handle(MimsStockSyncService $sync, WorkflowNotifier $flow): int
    {
        if (! $sync->configured()) {
            $this->error('DISTRIVA_MIMS_BASE_URL dan DISTRIVA_MIMS_AUTH_TOKEN belum diisi di lingkungan (token tidak boleh disimpan di repositori).');

            return self::FAILURE;
        }
        $email = (string) config('distriva.mims.sync_user_email');
        $actor = $email === '' ? null : User::query()->where('email', mb_strtolower($email))->first();
        if ($actor === null) {
            $this->error('DISTRIVA_MIMS_SYNC_USER_EMAIL belum diisi atau akunnya tidak ditemukan (akun pencatat cuplikan otomatis).');

            return self::FAILURE;
        }
        $q = DB::table('warehouses')->where('is_active', true)->whereNotNull('plant')->whereNotNull('stor_loc')->orderBy('code');
        if ($this->option('warehouse')) {
            $q->where('code', $this->option('warehouse'));
        }
        $failed = 0;
        foreach ($q->get() as $wh) {
            $r = $sync->syncWarehouse($wh, $actor, $this->option('date') ?: null, (bool) $this->option('dry-run'));
            $failed += $r['status'] === 'FAILED' ? 1 : 0;
            $this->line("{$wh->code} {$wh->name}: {$r['status']}".($r['message'] ? " — {$r['message']}" : " ({$r['mapped']}/{$r['total']} SKU terpetakan)"));
            if ($r['status'] === 'FAILED' && str_contains((string) $r['message'], 'token ditolak')) {
                // an expired token fails every warehouse: stop at the first, and tell the stock importers (a dry run only reports)
                if (! $this->option('dry-run')) {
                    $flow->mimsTokenRejected();
                }
                break;
            }
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
