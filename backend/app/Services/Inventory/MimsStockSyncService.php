<?php

namespace App\Services\Inventory;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Notifications\WorkflowNotifier;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Crypt;
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

    public function __construct(private readonly StockService $stock, private readonly WorkflowNotifier $flow, private readonly MimsIssueSyncService $issues, private readonly MimsReceiptSyncService $receipts) {}

    /**
     * Calls a MIMS endpoint that takes its parameters in the URL: GET first; MIMS answers 405 for some of them, which then are POST (empty body), so that is retried once.
     *
     * @param  \Closure(): PendingRequest  $http
     */
    public static function fetch(\Closure $http, string $url): Response
    {
        $res = $http()->get($url);

        return $res->status() === 405 ? $http()->asJson()->post($url, []) : $res;
    }

    /** Why MIMS could not be reached, without anything secret (the message of a cURL error names the host and the cause, never the headers). */
    public static function connectionMessage(\Throwable $e, ?string $during = null): string
    {
        $m = $e->getMessage();
        $at = $during === null ? '' : " (saat {$during})";
        if (stripos($m, 'certificate') !== false || stripos($m, 'SSL') !== false) {
            return 'Tidak dapat terhubung ke MIMS'.$at.': sertifikat SSL server MIMS kedaluwarsa atau tidak tepercaya. Minta pengelola MIMS memperbaruinya (atau, sementara, atur DISTRIVA_MIMS_VERIFY_SSL=false dengan sadar akan risikonya).';
        }
        if (stripos($m, 'resolve host') !== false) {
            return 'Tidak dapat terhubung ke MIMS'.$at.': nama server tidak dikenali (periksa DISTRIVA_MIMS_BASE_URL dan DNS/jaringan server).';
        }
        if (stripos($m, 'timed out') !== false) {
            return 'Tidak dapat terhubung ke MIMS'.$at.': waktu tunggu habis (jaringan atau MIMS lambat).';
        }

        return 'Tidak dapat terhubung ke MIMS'.$at.': '.mb_substr(preg_replace('/\s+/', ' ', $m), 0, 200);
    }

    public function configured(): bool
    {
        return filled(config('distriva.mims.base_url')) && filled(config('distriva.mims.auth_token'));
    }

    public function baseUrlConfigured(): bool
    {
        return filled(config('distriva.mims.base_url'));
    }

    /** @return array{auto_enabled:bool,auto_time:string,auto_user_id:?string,auto_user_name:?string,last_auto_date:?string} */
    public function autoSettings(): array
    {
        $s = DB::table('mims_sync_settings')->where('id', 1)->first();
        $name = $s->auto_user_id ? DB::table('users')->where('id', $s->auto_user_id)->value('name') : null;

        return ['auto_enabled' => (bool) $s->auto_enabled, 'auto_time' => (string) $s->auto_time, 'auto_user_id' => $s->auto_user_id, 'auto_user_name' => $name, 'last_auto_date' => $s->last_auto_date, 'auto_stock' => (bool) $s->auto_stock, 'auto_issues' => (bool) $s->auto_issues, 'auto_receipts' => (bool) $s->auto_receipts];
    }

    /** Turning it on needs a MIMS token saved by the actor (it is the one used every day). */
    /** @param array{stock?:bool,issues?:bool,receipts?:bool}|null $what what to pull each day (null = keep the current choice; at least one must stay on) */
    public function saveAutoSettings(User $actor, bool $enabled, string $time, ?array $what = null): array
    {
        $current = $this->autoSettings();
        $pick = ['auto_stock' => (bool) ($what['stock'] ?? $current['auto_stock']), 'auto_issues' => (bool) ($what['issues'] ?? $current['auto_issues']), 'auto_receipts' => (bool) ($what['receipts'] ?? $current['auto_receipts'])];
        if (! in_array(true, $pick, true)) {
            throw new AssignmentRuleViolation('Pilih minimal satu data untuk tarik otomatis: stok, pengeluaran, atau penerimaan.');
        }
        if ($enabled && ! DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->exists()) {
            throw new AssignmentRuleViolation('Simpan token MIMS Anda lebih dulu (tarik stok sekali dengan centang "Simpan token"); token itu dipakai untuk tarik otomatis.');
        }
        DB::table('mims_sync_settings')->where('id', 1)->update(['auto_enabled' => $enabled, 'auto_time' => $time, 'auto_user_id' => $enabled ? $actor->getKey() : DB::raw('auto_user_id'), 'updated_at' => now()] + $pick);

        return $this->autoSettings();
    }

    /** Called every minute: pulls every ERP warehouse once per business day, from the set time, with the token saved by the user who switched it on. Returns the number of warehouses processed (null = nothing due). */
    public function runAutoIfDue(): ?int
    {
        $s = DB::table('mims_sync_settings')->where('id', 1)->first();
        if (! $s->auto_enabled || $s->auto_user_id === null || ! $this->baseUrlConfigured()) {
            return null;
        }
        $now = CarbonImmutable::now((string) config('distriva.business_timezone'));
        if ($now->format('H:i') < $s->auto_time || $s->last_auto_date === $now->toDateString()) {
            return null;
        }
        DB::table('mims_sync_settings')->where('id', 1)->update(['last_auto_date' => $now->toDateString()]);   // once a day, even when it fails: the failure is reported, not retried every minute
        $user = User::query()->find($s->auto_user_id);
        $enc = DB::table('user_mims_tokens')->where('user_id', $s->auto_user_id)->value('token_encrypted');
        $token = null;
        try {
            $token = $enc === null ? null : Crypt::decryptString($enc);
        } catch (DecryptException) {
        }
        if ($user === null || $token === null) {
            $this->flow->mimsTokenRejected();

            return 0;
        }
        $count = 0;
        $rejected = false;
        foreach (DB::table('warehouses')->where('is_active', true)->whereNotNull('plant')->whereNotNull('stor_loc')->orderBy('code')->get() as $wh) {
            $count++;
            if ($s->auto_stock) {
                $r = $this->syncWarehouse($wh, $user, null, false, $token, $user, 'AUTO');
                if ($r['status'] === 'FAILED' && str_contains((string) $r['message'], 'token ditolak')) {
                    $rejected = true;
                    break;
                }
            }
            $mirrors = array_values(array_filter([$s->auto_issues ? $this->issues->syncWarehouse($wh, $token, $user) : null, $s->auto_receipts ? $this->receipts->syncWarehouse($wh, $token, $user) : null]));
            foreach ($mirrors as $m) {
                if ($m['status'] === 'FAILED' && str_contains((string) $m['message'], 'token ditolak')) {
                    $rejected = true;
                }
            }
            if ($rejected) {
                break;
            }
        }
        DB::table('user_mims_tokens')->where('user_id', $user->getKey())->update(['last_used_at' => now(), 'last_result' => $rejected ? 'REJECTED' : 'OK']);
        if ($rejected) {
            $this->flow->mimsTokenRejected();
        }

        return $count;
    }

    /** @return array{status:string,message:?string,snapshot_id:?string,total:int,mapped:int} */
    /** @param 'AUTO'|'MANUAL'|'CLI' $trigger what started the pull (shown in the history) */
    public function syncWarehouse(object $wh, User $actor, ?string $asOf = null, bool $dryRun = false, ?string $token = null, ?User $triggeredBy = null, string $trigger = 'MANUAL'): array
    {
        $asOf ??= CarbonImmutable::now((string) config('distriva.business_timezone'))->toDateString();
        $run = (string) Str::uuid();
        $started = now();
        $finish = function (string $status, ?string $message, ?string $snapshot = null, int $total = 0, int $mapped = 0) use ($run, $wh, $started, $dryRun, $triggeredBy, $trigger, $asOf): array {
            if (! $dryRun) {
                DB::table('stock_sync_runs')->insert(['id' => $run, 'warehouse_id' => $wh->id, 'status' => $status, 'message' => $message === null ? null : mb_substr($message, 0, 1000), 'snapshot_id' => $snapshot,
                    'materials_total' => $total, 'materials_mapped' => $mapped, 'triggered_by' => $triggeredBy?->getKey(), 'trigger_kind' => $trigger, 'as_of' => $asOf, 'started_at' => $started, 'finished_at' => now()]);
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
            $res = Http::withHeaders(['auth-token' => (string) ($token ?? config('distriva.mims.auth_token')), 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])->timeout((int) config('distriva.mims.timeout_seconds'))->get($url);
        } catch (\Throwable $e) {
            return $finish('FAILED', self::connectionMessage($e));
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
