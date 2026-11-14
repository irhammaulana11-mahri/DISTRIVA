<?php

namespace App\Services\Inventory;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

/**
 * One manual MIMS pull (stock, issues, receipts of the chosen warehouses) as a run in a detached process, so the dialog does not wait for minutes (docs/82 §19.15). The pasted token reaches the process through its
 * environment only (never the command line, the database or a log); with "use saved token" the process reads the starter's saved token itself. The results per warehouse are written as they come.
 */
class MimsPullRunService
{
    public function __construct(private readonly MimsStockSyncService $stock, private readonly MimsIssueSyncService $issues, private readonly MimsReceiptSyncService $receipts, private readonly WorkflowNotifier $flow) {}

    /**
     * Pulls what was asked for ONE warehouse. $o = {stock, issues, receipts, dry_run, date}.
     *
     * @param  array{stock:bool,issues:bool,receipts:bool,dry_run:bool,date:?string}  $o
     * @return array<string,mixed>
     */
    public function pullOne(object $wh, User $actor, ?string $token, array $o): array
    {
        $r = $o['stock'] ? $this->stock->syncWarehouse($wh, $actor, $o['date'], $o['dry_run'], $token, $actor)
            : ['status' => 'SKIPPED', 'message' => 'Stok tidak ditarik (tidak dipilih).', 'snapshot_id' => null, 'total' => 0, 'mapped' => 0];
        $row = ['warehouse_id' => $wh->id, 'warehouse_code' => $wh->code, 'warehouse_name' => $wh->name] + $r;
        if (! $this->rejected($row) && ! $o['dry_run']) {
            if ($o['issues']) {
                $row['issues'] = $this->issues->syncWarehouse($wh, $token, $actor);
            }
            if ($o['receipts']) {
                $row['receipts'] = $this->receipts->syncWarehouse($wh, $token, $actor);
            }
        }

        return $row;
    }

    /** True when MIMS refused the token anywhere in the row (an expired token fails every warehouse, so the caller stops). */
    public function rejected(array $row): bool
    {
        return collect([$row, $row['issues'] ?? null, $row['receipts'] ?? null])->contains(fn ($m) => ($m['status'] ?? '') === 'FAILED' && str_contains((string) ($m['message'] ?? ''), 'token ditolak'));
    }

    /** @param array<string,mixed> $options */
    public function start(User $actor, array $options): string
    {
        DB::table('mims_pull_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->where('created_at', '<', now()->subHours(3))
            ->update(['status' => 'FAILED', 'finished_at' => now(), 'message' => 'Dihentikan: proses tidak selesai.']);
        if (DB::table('mims_pull_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists()) {
            throw new AssignmentRuleViolation('Penarikan MIMS sedang berjalan; tunggu sampai selesai.');
        }
        $id = (string) Str::uuid();
        DB::table('mims_pull_runs')->insert(['id' => $id, 'status' => 'QUEUED', 'options' => json_encode($options), 'started_by' => $actor->getKey(), 'created_at' => now()]);

        return $id;
    }

    /** Hands a registered run to a detached process (inline in tests). The token travels in the process environment. */
    public function launch(string $runId, ?string $token): void
    {
        if (config('distriva.mims.run_inline')) {
            $this->execute($runId, $token);

            return;
        }
        $cmd = sprintf('nohup %s artisan distriva:mims-pull-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($runId));
        Process::fromShellCommandline($cmd, base_path(), $token === null ? null : ['DISTRIVA_MIMS_PULL_TOKEN' => $token])->run();
    }

    public function execute(string $runId, ?string $token = null): void
    {
        $run = DB::table('mims_pull_runs')->where('id', $runId)->where('status', 'QUEUED')->first();
        if ($run === null) {
            return;
        }
        $o = json_decode($run->options, true);
        $actor = User::query()->find($run->started_by);
        $fail = function (string $message) use ($runId): void {
            DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => 'FAILED', 'message' => $message, 'finished_at' => now()]);
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
        if ($token === null || $token === '') {
            $fail('Token MIMS tidak tersedia; tempel token sesi dan coba lagi.');

            return;
        }
        $q = DB::table('warehouses')->where('is_active', true)->whereNotNull('plant')->whereNotNull('stor_loc')->orderBy('code');
        if (! empty($o['warehouse_ids'])) {
            $q->whereIn('id', $o['warehouse_ids']);
        }
        $warehouses = $q->get();
        DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => 'RUNNING', 'warehouses_total' => $warehouses->count()]);
        $opts = ['stock' => (bool) $o['sync_stock'], 'issues' => (bool) $o['sync_issues'], 'receipts' => (bool) $o['sync_receipts'], 'dry_run' => (bool) $o['dry_run'], 'date' => $o['date'] ?? null];
        $results = [];
        $rejected = false;
        try {
            foreach ($warehouses as $wh) {
                $row = $this->pullOne($wh, $actor, $token, $opts);
                $results[] = $row;
                DB::table('mims_pull_runs')->where('id', $runId)->update(['results' => json_encode($results)]);
                if ($this->rejected($row)) {
                    $rejected = true;
                    break;
                }
            }
        } catch (\Throwable $e) {
            $fail('Penarikan terhenti: '.mb_substr($e->getMessage(), 0, 300));

            return;
        }
        $worked = collect($results)->contains(fn ($r) => in_array($r['status'], ['OK', 'SKIPPED'], true) || collect([$r['issues'] ?? null, $r['receipts'] ?? null])->contains(fn ($m) => ($m['status'] ?? '') === 'OK'));
        if ($useSaved && ($rejected || $worked)) {
            DB::table('user_mims_tokens')->where('user_id', $actor->getKey())->update(['last_used_at' => now(), 'last_result' => $rejected ? 'REJECTED' : 'OK']);
        }
        if ($rejected) {
            $this->flow->mimsTokenRejected();
        }
        DB::table('mims_pull_runs')->where('id', $runId)->update(['status' => $rejected || ! $worked ? 'FAILED' : 'OK', 'message' => $rejected ? 'Token MIMS ditolak atau kedaluwarsa.' : null, 'finished_at' => now()]);
    }

    /** @return array<string,mixed>|null */
    public function show(string $runId): ?array
    {
        $r = DB::table('mims_pull_runs')->where('id', $runId)->first();

        return $r === null ? null : ['id' => $r->id, 'status' => $r->status, 'message' => $r->message, 'warehouses_total' => (int) $r->warehouses_total, 'results' => json_decode((string) $r->results, true) ?? [],
            'options' => json_decode((string) $r->options, true), 'created_at' => $r->created_at, 'finished_at' => $r->finished_at];
    }
}
