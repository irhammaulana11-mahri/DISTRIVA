<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Inventory\MimsStockSyncService;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Sync\SyncScope;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Daily pull of the ERP (MIMS) stock of the active warehouses that have a plant and storage location (docs/62 §40), limited to one UP3 unless configured otherwise (docs/94 §9). */
class MimsSyncStockCommand extends Command
{
    protected $signature = 'distriva:mims-sync-stock {--warehouse= : warehouse code (default: every warehouse of the configured UP3)} {--date= : as-of date Y-m-d (default: today)} {--dry-run : read and validate, store nothing}';

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
        } else {
            $scope = Str::upper(trim((string) config('distriva.mims.sync_up3')));
            if ($scope !== 'SEMUA') {
                $up3Id = $scope === '' ? SyncScope::defaultUp3() : DB::table('organizational_units')->where('unit_type', 'UP3')->where('code', $scope)->value('id');
                if ($up3Id === null) {     // salah konfigurasi tidak boleh berubah menjadi menarik semua gudang
                    $this->error("UP3 \"{$scope}\" pada DISTRIVA_MIMS_SYNC_UP3 tidak ditemukan.");

                    return self::FAILURE;
                }
                $q->whereIn('id', SyncScope::warehouseIds([$up3Id]));
            }
        }
        $failed = 0;
        foreach ($q->get() as $wh) {
            $r = $sync->syncWarehouse($wh, $actor, $this->option('date') ?: null, (bool) $this->option('dry-run'), null, null, 'CLI');
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
