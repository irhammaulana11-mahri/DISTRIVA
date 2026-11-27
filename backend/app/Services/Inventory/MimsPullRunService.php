<?php

namespace App\Services\Inventory;

use App\Models\User;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Sync\SyncRuns;
use App\Services\Sync\SyncScope;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * One manual MIMS pull (stock, issues, receipts of the chosen warehouses) as a run in a detached process, so the dialog does not wait for minutes (docs/82 §19.15). The pasted token reaches the process through its
 * environment only (never the command line, the database or a log); with "use saved token" the process reads the starter's saved token itself. The results per warehouse are written as they come.
 */
class MimsPullRunService
{
    public function __construct(private readonly MimsStockSyncService $stock, private readonly MimsIssueSyncService $issues, private readonly MimsReceiptSyncService $receipts, private readonly MimsReservationSyncService $reservations, private readonly WorkflowNotifier $flow, private readonly SyncRuns $runs) {}

    /**
     * Pulls what was asked for ONE warehouse. $o = {stock, issues, receipts, dry_run, date}.
     *
     * @param  array{stock:bool,issues:bool,receipts:bool,reservations?:bool,dry_run:bool,date:?string,from?:?string,to?:?string}  $o
     * @return array<string,mixed>
     */
    public function pullOne(object $wh, User $actor, ?string $token, array $o, ?callable $step = null): array
    {
        $step ??= static fn (string $name) => null;
        $step('STOCK');
        $r = $o['stock'] ? $this->stock->syncWarehouse($wh, $actor, $o['date'], $o['dry_run'], $token, $actor)
            : ['status' => 'SKIPPED', 'message' => 'Stok tidak ditarik (tidak dipilih).', 'snapshot_id' => null, 'total' => 0, 'mapped' => 0];
        $row = ['warehouse_id' => $wh->id, 'warehouse_code' => $wh->code, 'warehouse_name' => $wh->name] + $r;
        if (! $this->rejected($row) && ! $o['dry_run']) {
            if ($o['issues']) {
                $step('ISSUES');
                $row['issues'] = $this->issues->syncWarehouse($wh, $token, $actor, null, $o['from'] ?? null, $o['to'] ?? null);
            }
            if ($o['reservations'] ?? false) {
                $step('RESERVATIONS');
                $row['reservations'] = $this->reservations->syncWarehouse($wh, $token, $actor, null, $o['from'] ?? null, $o['to'] ?? null);
            }
            if ($o['receipts']) {
                $step('RECEIPTS');
                $row['receipts'] = $this->receipts->syncWarehouse($wh, $token, $actor, null, $o['from'] ?? null, $o['to'] ?? null);
            }
        }

        return $row;
    }

    /** True when MIMS refused the token anywhere in the row (an expired token fails every warehouse, so the caller stops). */
    public function rejected(array $row): bool
    {
        return collect([$row, $row['issues'] ?? null, $row['receipts'] ?? null, $row['reservations'] ?? null])->contains(fn ($m) => ($m['status'] ?? '') === 'FAILED' && str_contains((string) ($m['message'] ?? ''), 'token ditolak'));
    }

    /** @param array<string,mixed> $options */
    public function start(User $actor, array $options, string $up3Id, ?string $scopeUnitId = null): string
    {
        $this->expireStale();
        $id = (string) Str::uuid();
        $this->runs->register('mims_pull_runs', ['id' => $id, 'options' => json_encode($options), 'started_by' => $actor->getKey()], $up3Id, 'mims', 'pull', $options['warehouse_ids'] ?? SyncScope::warehouseIds([$up3Id]), $scopeUnitId);

        return $id;
    }

    /** Lets a stuck run stop blocking the next one. */
    public function expireStale(): void
    {
        DB::statement("update mims_pull_runs set options = options - 'token_encrypted' where jsonb_exists(options, 'token_encrypted') and created_at < ?", [now()->subDays(2)]);
        $this->runs->expire('mims_pull_runs', 3 * 3600, 'message');
    }

    /** Hands a registered run to the queue (inline in tests). A pasted token waits encrypted in the run and is wiped when the run ends; it never enters the queue table. */
    public function launch(string $runId, ?string $token): void
    {
        if (config('distriva.mims.run_inline')) {
            $this->execute($runId, $token);

            return;
        }
        if ($token !== null) {
            DB::statement("update mims_pull_runs set options = options || jsonb_build_object('token_encrypted', ?::text) where id = ?", [Crypt::encryptString($token), $runId]);
        }
        $this->runs->dispatch('mims_pull_runs', $runId, 3 * 3600);
    }

    public function execute(string $runId, ?string $token = null): void
    {
        try {
            $this->perform($runId, $token);
        } finally {
            DB::statement("update mims_pull_runs set options = options - 'token_encrypted' where id = ?", [$runId]);
            $this->runs->notifyFinished('mims_pull_runs', $runId);
        }
    }

    private function perform(string $runId, ?string $token): void
    {
        $run = DB::table('mims_pull_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        $o = json_decode($run->options, true);
        $actor = User::query()->find($run->started_by);
        $fail = function (string $message) use ($runId): void {
            DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => 'FAILED', 'message' => $message, 'finished_at' => now(), 'current_warehouse' => null, 'current_step' => null]);
        };
        if ($actor === null) {
            $fail('Pengguna pemulai tidak ditemukan.');

            return;
        }
        $useSaved = (bool) ($o['use_saved_token'] ?? false);
        if ($useSaved) {
            $enc = DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->value('token_encrypted');
            try {
                $token = $enc === null ? null : Crypt::decryptString($enc);
            } catch (\Throwable) {
                $token = null;
            }
        }
        if (($token === null || $token === '') && isset($o['token_encrypted'])) {
            try {
                $token = Crypt::decryptString($o['token_encrypted']);
            } catch (\Throwable) {
                $token = null;
            }
        }
        if ($token === null || $token === '') {
            $fail('Token MIMS tidak tersedia; tempel token sesi dan coba lagi.');

            return;
        }
        $q = DB::table('warehouses')->whereIn('id', SyncScope::warehouseIds([$run->up3_id]))->where('is_active', true)->whereNotNull('plant')->whereNotNull('stor_loc')->orderBy('code');
        if (! empty($o['warehouse_ids'])) {
            $q->whereIn('id', $o['warehouse_ids']);
        }
        $warehouses = $q->get();
        DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'warehouses_total' => $warehouses->count(), 'started_at' => now(), 'done_units' => 0, 'total_units' => $warehouses->count()]);
        $opts = ['stock' => (bool) $o['sync_stock'], 'issues' => (bool) $o['sync_issues'], 'receipts' => (bool) $o['sync_receipts'], 'reservations' => (bool) ($o['sync_reservations'] ?? false), 'dry_run' => (bool) $o['dry_run'], 'date' => $o['date'] ?? null, 'from' => $o['issues_from'] ?? null, 'to' => $o['issues_to'] ?? null];
        $results = [];
        $rejected = false;
        try {
            foreach ($warehouses as $wh) {
                $label = mb_substr(trim("{$wh->code} - {$wh->name}"), 0, 200);
                $row = $this->pullOne($wh, $actor, $token, $opts, fn (string $name) => DB::table('mims_pull_runs')->where('id', $runId)->update(['current_warehouse' => $label, 'current_step' => $name]));
                $results[] = $row;
                DB::table('mims_pull_runs')->where('id', $runId)->update(['results' => json_encode($results), 'done_units' => count($results)]);
                if ($this->rejected($row)) {
                    $rejected = true;
                    break;
                }
            }
        } catch (\Throwable $e) {
            $fail('Penarikan terhenti: '.mb_substr($e->getMessage(), 0, 300));

            return;
        }
        $worked = collect($results)->contains(fn ($r) => in_array($r['status'], ['OK', 'SKIPPED'], true) || collect([$r['issues'] ?? null, $r['receipts'] ?? null, $r['reservations'] ?? null])->contains(fn ($m) => ($m['status'] ?? '') === 'OK'));
        if ($useSaved && ($rejected || $worked)) {
            DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->update(['last_used_at' => now(), 'last_result' => $rejected ? 'REJECTED' : 'OK']);
        }
        if ($rejected) {
            $this->flow->mimsTokenRejected();
        }
        DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => $rejected || ! $worked ? 'FAILED' : 'OK', 'message' => $rejected ? 'Token MIMS ditolak atau kedaluwarsa.' : null, 'finished_at' => now(), 'current_warehouse' => null, 'current_step' => null]);
    }

    /** @return array<string,mixed>|null */
    public function show(string $runId): ?array
    {
        $r = DB::table('mims_pull_runs')->where('id', $runId)->first();

        return $r === null ? null : ['id' => $r->id, 'status' => $r->status, 'message' => $r->message, 'warehouses_total' => (int) $r->warehouses_total, 'results' => json_decode((string) $r->results, true) ?? [],
            'options' => array_diff_key((array) json_decode((string) $r->options, true), ['token_encrypted' => 1]), 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at,
            'warehouses_done' => count(json_decode((string) $r->results, true) ?? []), 'current_warehouse' => $r->current_warehouse, 'current_step' => $r->current_step] + $this->runs->describe($r);
    }

    /** The run of the UP3 in progress, if any (so a page opened later, or by someone else, can show it). @return array<string,mixed>|null */
    public function active(string $up3Id): ?array
    {
        $this->expireStale();
        $id = DB::table('mims_pull_runs')->where('up3_id', $up3Id)->whereIn('status', ['QUEUED', 'RUNNING'])->orderByDesc('created_at')->value('id');

        return $id === null ? null : $this->show($id);
    }
}
