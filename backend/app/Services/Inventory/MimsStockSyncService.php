<?php

namespace App\Services\Inventory;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Pulls the ERP (MIMS) stock monitoring of ONE warehouse (plant + storage location) and stores it as the day's snapshot (docs/62 §40). Read-only towards the ERP; never changes stock in the ERP.
 * The real response (sample of 7 Nov 2026, `{"data":[{material_NO, material_DESC, satuan, stor_LOC, nama_STOR_LOC, stock_SIAP, stock_RESERVASI, stock_IN_TRANSIT, minimum_STOCK, stock_GUDANG, stock_YANTEK,
 * stock_RETUR, stock_YANBUNG, …}],"msg":1}`) is read from `data`; the columns are found by tolerant names so the other spellings keep working. `stock_SIAP` is the usable stock (the `stock` field is 0 in the sample). If a required column is not found, the run FAILS and the message lists the column names that were received (no values), so the mapping can be fixed.
 * The auth token comes from the configuration (scheduled pull) or, for an on-demand pull, from the signed-in user's own MIMS session (request body): it is used for that call only; it is stored only if the user ticks "save" (encrypted per user in user_mims_tokens, never returned), and is never
 * logged, flashed or written to a message or a run record.
 */
class MimsStockSyncService
{
    private const KEYS = [
        'sku' => ['nomaterial', 'materialno', 'material', 'matnr', 'kodematerial'],
        'name' => ['materialdesc', 'namamaterial', 'materialname', 'description', 'maktx', 'uraian'],
        'unit' => ['satuan', 'unit', 'uom', 'meins'],
        'ready' => ['stocksiap', 'siap', 'stockready'],
        'reserved' => ['stockreservasi', 'reservasi', 'stockreserved'],
        'transit' => ['stockintransit', 'intransit'],
        'minimum' => ['minimumstock', 'stockminimum', 'minimum', 'stokminimum'],
        'warehouse' => ['namastorloc', 'gudang', 'warehouse', 'storlocname'],
    ];

    public function __construct(private readonly StockService $stock) {}

    public function configured(): bool
    {
        return filled(config('distriva.mims.base_url')) && filled(config('distriva.mims.auth_token'));
    }

    public function baseUrlConfigured(): bool
    {
        return filled(config('distriva.mims.base_url'));
    }

    /** @return array{status:string,message:?string,snapshot_id:?string,total:int,mapped:int} */
    public function syncWarehouse(object $wh, User $actor, ?string $asOf = null, bool $dryRun = false, ?string $token = null, ?User $triggeredBy = null): array
    {
        $asOf ??= CarbonImmutable::now((string) config('distriva.business_timezone'))->toDateString();
        $run = (string) Str::uuid();
        $started = now();
        $finish = function (string $status, ?string $message, ?string $snapshot = null, int $total = 0, int $mapped = 0) use ($run, $wh, $started, $dryRun, $triggeredBy): array {
            if (! $dryRun) {
                DB::table('stock_sync_runs')->insert(['id' => $run, 'warehouse_id' => $wh->id, 'status' => $status, 'message' => $message === null ? null : mb_substr($message, 0, 1000), 'snapshot_id' => $snapshot,
                    'materials_total' => $total, 'materials_mapped' => $mapped, 'triggered_by' => $triggeredBy?->getKey(), 'started_at' => $started, 'finished_at' => now()]);
            }

            return ['status' => $status, 'message' => $message, 'snapshot_id' => $snapshot, 'total' => $total, 'mapped' => $mapped];
        };
        if ($wh->plant === null || $wh->stor_loc === null) {
            return $finish('SKIPPED', 'Gudang belum memiliki plant dan storage location ERP.');
        }
        if (DB::table('stock_snapshots')->where('warehouse_id', $wh->id)->where('as_of', $asOf)->exists()) {
            return $finish('SKIPPED', "Cuplikan stok per {$asOf} sudah ada.");
        }
        $url = rtrim((string) config('distriva.mims.base_url'), '/').strtr((string) config('distriva.mims.stock_path'), ['{regional}' => (string) config('distriva.mims.regional'), '{unit_upi}' => (string) config('distriva.mims.unit_upi'), '{plant}' => $wh->plant, '{stor_loc}' => $wh->stor_loc, '{valuation}' => (string) config('distriva.mims.valuation')]);
        try {
            $res = Http::withHeaders(['auth-token' => (string) ($token ?? config('distriva.mims.auth_token')), 'Accept' => 'application/json'])->timeout((int) config('distriva.mims.timeout_seconds'))->get($url);
        } catch (\Throwable) {
            return $finish('FAILED', 'Tidak dapat terhubung ke MIMS.');
        }
        if (! $res->successful()) {
            return $finish('FAILED', 'MIMS menjawab status HTTP '.$res->status().($res->status() === 401 || $res->status() === 403 ? ' (token ditolak atau kedaluwarsa).' : '.'));
        }
        $json = $res->json();
        if ($json === null && str_contains(strtolower((string) $res->header('Content-Type')), 'html')) {
            // the web application answered instead of the API: the base URL or the path prefix is wrong (the API lives under /project-i-agodist-api/)
            return $finish('FAILED', 'MIMS menjawab halaman web (HTML), bukan data API. Periksa DISTRIVA_MIMS_BASE_URL dan DISTRIVA_MIMS_STOCK_PATH (awalan /project-i-agodist-api/).');
        }
        $items = is_array($json) ? ($json['data'] ?? $json['gudang']['data'] ?? (array_is_list($json) ? $json : null)) : null;
        if (is_array($items) && $items === []) {
            // MIMS answered correctly but the storage location holds no stock rows (e.g. a rayon warehouse that keeps nothing in the ERP): not a failure, and no empty snapshot is written.
            return $finish('SKIPPED', 'MIMS menjawab tanpa baris stok untuk gudang ini (data kosong'.(is_array($json) && array_key_exists('msg', $json) && is_scalar($json['msg']) ? ', msg='.$json['msg'] : '').'). Gudang tidak memiliki stok di ERP, atau plant/storage location belum sesuai.');
        }
        if (! is_array($items)) {
            $shape = is_array($json) ? 'kunci: '.implode(', ', array_slice(array_map('strval', array_keys($json)), 0, 15)).(array_key_exists('msg', $json) && is_scalar($json['msg']) ? '; msg='.$json['msg'] : '') : 'bukan JSON';

            return $finish('FAILED', "Jawaban MIMS tidak memuat daftar material ({$shape}).");
        }
        $first = (array) $items[0];
        $names = array_keys($first);
        $col = [];
        foreach (self::KEYS as $field => $candidates) {
            $col[$field] = null;
            foreach ($names as $n) {
                if (in_array(preg_replace('/[^a-z0-9]/', '', mb_strtolower((string) $n)), $candidates, true)) {
                    $col[$field] = $n;
                    break;
                }
            }
        }
        if ($col['sku'] === null || $col['ready'] === null) {
            return $finish('FAILED', 'Kolom nomor material dan/atau stock siap tidak dikenali. Kolom yang diterima: '.implode(', ', array_slice(array_map('strval', $names), 0, 30)).'.');
        }
        $rows = [];
        foreach ($items as $i => $it) {
            $it = (array) $it;
            $rows[] = ['row' => $i + 1, 'sku' => trim((string) ($it[$col['sku']] ?? '')), 'name' => trim((string) ($col['name'] ? ($it[$col['name']] ?? '') : '')), 'unit' => trim((string) ($col['unit'] ? ($it[$col['unit']] ?? '') : '')),
                'ready' => $it[$col['ready']] ?? null, 'reserved' => $col['reserved'] ? ($it[$col['reserved']] ?? 0) : 0, 'transit' => $col['transit'] ? ($it[$col['transit']] ?? 0) : 0, 'minimum' => $col['minimum'] ? ($it[$col['minimum']] ?? 0) : 0,
                'warehouse' => trim((string) ($col['warehouse'] ? ($it[$col['warehouse']] ?? '') : ''))];
        }
        $rows = array_values(array_filter($rows, fn ($r) => $r['sku'] !== ''));
        try {
            $r = $this->stock->ingestErpRows($wh, $rows, $asOf, "MIMS API {$wh->plant}/{$wh->stor_loc}", $dryRun, $actor, 'MIMS_API');
        } catch (\Throwable $e) {
            return $finish('FAILED', $e->getMessage());
        }

        return $finish('OK', null, $r['summary']['snapshot_id'], (int) $r['summary']['total'], (int) $r['summary']['mapped']);
    }
}
