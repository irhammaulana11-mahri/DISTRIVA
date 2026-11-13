<?php

namespace App\Services\WorkOrders;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Output\OutputDocumentService;
use App\Services\Proposals\ProposalService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Work order (SPK/WO), docs/62 §32, docs/40. Callers authorize the actor first (internal keys on the application's unit, or the vendor relation for vendor progress).
 * Flow: DRAFT (KONSTRUKSI_UP3 prepares: tasks from the RAB groups, materials from the approved MTO, vendor) -> SUBMITTED -> ISSUED (ASMAN_KONSTRUKSI: the approval of the WO
 * and the vendor in ONE decision) -> IN_PROGRESS (first progress) -> COMPLETED (by the closing of the BASTP by ASMAN_KONSTRUKSI, see BastpService: every task verified at 100 % AND the customer at the EIS status PEREMAJAAN). Change = a new version (amend); cancel = final.
 */
class WorkOrderService
{
    public function __construct(private readonly OutputDocumentService $documents, private readonly MaterialRequestService $requests) {}

    public function create(string $applicationId, User $actor): string
    {
        return DB::transaction(function () use ($applicationId, $actor): string {
            $app = DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if (DB::table('work_orders')->where('application_id', $applicationId)->where('status', 'COMPLETED')->exists()) {
                throw new AssignmentRuleViolation('Permohonan ini sudah memiliki WO yang selesai.');
            }
            if (DB::table('work_orders')->where('application_id', $applicationId)->whereIn('status', ['DRAFT', 'SUBMITTED', 'ISSUED', 'IN_PROGRESS'])->exists()) {
                throw new AssignmentRuleViolation('Permohonan sudah memiliki WO yang berjalan; gunakan amandemen atau batalkan dulu.');
            }

            return $this->build($app, null, null, null, $actor);
        });
    }

    public function amend(string $woId, string $reason, User $actor): string
    {
        return DB::transaction(function () use ($woId, $reason, $actor): string {
            $wo = $this->lock($woId);
            if (! in_array($wo->status, ['ISSUED', 'IN_PROGRESS'], true)) {
                throw new AssignmentRuleViolation('Amandemen hanya untuk WO yang sudah diterbitkan dan berjalan.');
            }
            if (DB::table('work_orders')->where('application_id', $wo->application_id)->whereIn('status', ['DRAFT', 'SUBMITTED'])->exists()) {
                throw new AssignmentRuleViolation('Sudah ada versi WO yang sedang disiapkan.');
            }
            $app = DB::table('applications')->where('id', $wo->application_id)->first();

            return $this->build($app, $wo, trim($reason), $wo->vendor_company_id, $actor);
        });
    }

    public function setVendor(string $woId, string $companyId, ?string $note, User $actor, ?string $targetDate = null): void
    {
        DB::transaction(function () use ($woId, $companyId, $note, $actor, $targetDate): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['DRAFT'], 'diubah');
            $c = DB::table('vendor_companies')->where('id', $companyId)->first();
            if ($c === null || $c->status !== 'ACTIVE') {
                throw new AssignmentRuleViolation('Perusahaan vendor tidak ditemukan atau tidak aktif.');
            }
            if ($c->work_scope === 'TIANG') {
                throw new AssignmentRuleViolation('Vendor ini khusus pekerjaan tiang; pilih vendor pekerjaan jaringan.');
            }
            DB::table('work_orders')->where('id', $woId)->update(['vendor_company_id' => $companyId, 'vendor_note' => $note, 'target_date' => $targetDate ?? $wo->target_date, 'updated_at' => now()]);
            $this->event($woId, 'VENDOR_SET', $actor, $note, ['vendor_company_id' => $companyId, 'target_date' => $targetDate]);
        });
    }

    /** The target completion date: free while the WO is being prepared; once issued, a change needs a reason and is kept in the history. */
    public function setTargetDate(string $woId, string $date, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($woId, $date, $reason, $actor): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['DRAFT', 'SUBMITTED', 'ISSUED', 'IN_PROGRESS'], 'diubah');
            if (in_array($wo->status, ['ISSUED', 'IN_PROGRESS'], true) && $wo->target_date !== null && trim((string) $reason) === '') {
                throw new AssignmentRuleViolation('Alasan perubahan target selesai wajib diisi.');
            }
            DB::table('work_orders')->where('id', $woId)->update(['target_date' => $date, 'updated_at' => now()]);
            $this->event($woId, 'TARGET_DATE_SET', $actor, $reason, ['from' => $wo->target_date, 'to' => $date]);
        });
    }

    public function submit(string $woId, User $actor): void
    {
        DB::transaction(function () use ($woId, $actor): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['DRAFT'], 'diajukan');
            if ($wo->vendor_company_id === null) {
                throw new AssignmentRuleViolation('Vendor belum dipilih.');
            }
            if ($wo->target_date === null) {
                throw new AssignmentRuleViolation('Target selesai pekerjaan belum diisi.');
            }
            if (! DB::table('wo_tasks')->where('work_order_id', $woId)->exists()) {
                throw new AssignmentRuleViolation('WO belum memiliki tugas.');
            }
            DB::table('work_orders')->where('id', $woId)->update(['status' => 'SUBMITTED', 'submitted_by' => $actor->getKey(), 'submitted_at' => now(), 'return_reason' => null, 'updated_at' => now()]);
            $this->event($woId, 'SUBMITTED', $actor, null, null);
        });
    }

    /** ISSUE approves the WO and the vendor at once; RETURN sends it back to DRAFT with a reason. */
    public function decide(string $woId, string $decision, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($woId, $decision, $reason, $actor): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['SUBMITTED'], 'diputuskan');
            if ($decision === 'RETURN') {
                if (trim((string) $reason) === '') {
                    throw new AssignmentRuleViolation('Pengembalian wajib disertai alasan.');
                }
                DB::table('work_orders')->where('id', $woId)->update(['status' => 'DRAFT', 'return_reason' => trim($reason), 'updated_at' => now()]);
                $this->event($woId, 'RETURNED', $actor, $reason, null);

                return;
            }
            if ($wo->submitted_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                throw new AdministrationDenied('Pengaju WO tidak dapat menerbitkannya sendiri.', 403);
            }
            $c = DB::table('vendor_companies')->where('id', $wo->vendor_company_id)->first();
            if ($c === null || $c->status !== 'ACTIVE') {
                throw new AssignmentRuleViolation('Perusahaan vendor tidak aktif; pilih vendor lain (kembalikan WO).');
            }
            if ($wo->amended_from_id !== null) {
                $old = DB::table('work_orders')->where('id', $wo->amended_from_id)->lockForUpdate()->first();
                DB::table('work_orders')->where('id', $old->id)->update(['status' => 'SUPERSEDED', 'updated_at' => now()]);
                DB::table('wo_progress')->where('work_order_id', $old->id)->where('status', 'SUBMITTED')->update(['status' => 'RETURNED', 'decided_at' => now(), 'return_reason' => 'Dikembalikan otomatis: WO diganti versi baru.']);
                BastpService::cancelLive($old->id, $actor, 'Dibatalkan otomatis: WO diganti versi baru.');
                MaterialRequestService::closeForWorkOrder($old->id, $actor, 'SUPERSEDED', 'WO diganti versi baru.');
                $this->event($old->id, 'SUPERSEDED', $actor, null, ['by' => $woId]);
            }
            DB::table('work_orders')->where('id', $woId)->update(['status' => 'ISSUED', 'issued_by' => $actor->getKey(), 'issued_at' => now(), 'updated_at' => now()]);
            $this->event($woId, 'ISSUED', $actor, $reason, ['vendor_company_id' => $wo->vendor_company_id]);
            $this->requests->createForWorkOrder($woId, $actor);                   // the material need goes to the outbox in the same transaction (docs/10, docs/62 §40)
        });
    }

    /** @return array{id:string,replayed:bool} */
    public function submitProgress(string $woId, string $taskId, string $key, float $percent, ?string $notes, User $actor): array
    {
        try {
            return DB::transaction(function () use ($woId, $taskId, $key, $percent, $notes, $actor): array {
                $wo = $this->lock($woId);
                $this->requireStatus($wo, ['ISSUED', 'IN_PROGRESS'], 'menerima progres');
                $task = DB::table('wo_tasks')->where('id', $taskId)->where('work_order_id', $woId)->first() ?? throw new AssignmentRuleViolation('Tugas tidak ada pada WO ini.');
                $same = DB::table('wo_progress')->where('work_order_id', $woId)->where('submission_key', $key)->first();
                if ($same !== null) {
                    if ($same->task_id !== $taskId || abs((float) $same->cumulative_percent - $percent) > 0.001) {
                        throw new AssignmentRuleViolation('Kunci pengajuan ini sudah dipakai untuk isi yang berbeda.');
                    }

                    return ['id' => $same->id, 'replayed' => true];
                }
                if (DB::table('wo_progress')->where('task_id', $taskId)->where('status', 'SUBMITTED')->exists()) {
                    throw new AssignmentRuleViolation('Tugas ini masih memiliki progres yang menunggu verifikasi.');
                }
                $floor = $this->verifiedPercent($task);
                if ($percent + 1e-9 < $floor) {
                    throw new AssignmentRuleViolation("Progres kumulatif tidak boleh di bawah progres terverifikasi ({$floor} %).");
                }
                $id = (string) Str::uuid();
                DB::table('wo_progress')->insert(['id' => $id, 'work_order_id' => $woId, 'task_id' => $taskId, 'submission_key' => $key, 'cumulative_percent' => $percent, 'notes' => $notes, 'status' => 'SUBMITTED', 'submitted_by' => $actor->getKey(), 'submitted_at' => now()]);
                if ($wo->status === 'ISSUED') {
                    DB::table('work_orders')->where('id', $woId)->update(['status' => 'IN_PROGRESS', 'updated_at' => now()]);
                }
                $this->event($woId, 'PROGRESS_SUBMITTED', $actor, $notes, ['task_id' => $taskId, 'cumulative_percent' => $percent]);

                return ['id' => $id, 'replayed' => false];
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Pengajuan progres bentrok dengan pengajuan lain pada tugas yang sama.', 0, $e) : $e;
        }
    }

    public function decideProgress(string $progressId, string $decision, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($progressId, $decision, $reason, $actor): void {
            $p = DB::table('wo_progress')->where('id', $progressId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $wo = $this->lock($p->work_order_id);
            $this->requireStatus($wo, ['ISSUED', 'IN_PROGRESS'], 'memverifikasi progres');
            if ($p->status !== 'SUBMITTED') {
                throw new AssignmentRuleViolation('Progres ini sudah diputuskan.');
            }
            if ($p->submitted_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                throw new AdministrationDenied('Pengaju progres tidak dapat memverifikasinya sendiri.', 403);
            }
            if ($decision === 'RETURNED' && trim((string) $reason) === '') {
                throw new AssignmentRuleViolation('Pengembalian wajib disertai alasan.');
            }
            DB::table('wo_progress')->where('id', $progressId)->update(['status' => $decision, 'decided_by' => $actor->getKey(), 'decided_at' => now(), 'return_reason' => $decision === 'RETURNED' ? trim((string) $reason) : null]);
            $this->event($wo->id, $decision === 'VERIFIED' ? 'PROGRESS_VERIFIED' : 'PROGRESS_RETURNED', $actor, $reason, ['task_id' => $p->task_id, 'cumulative_percent' => (float) $p->cumulative_percent]);
        });
    }

    /** The completion is the closing of the BASTP by ASMAN_KONSTRUKSI (owner 7 Nov 2026: the BASTP is a precondition of the WO's completion); only BastpService calls it. */
    public function completeAfterBastp(string $woId, User $actor): void
    {
        DB::transaction(function () use ($woId, $actor): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['IN_PROGRESS'], 'diselesaikan');
            $open = [];
            foreach (DB::table('wo_tasks')->where('work_order_id', $woId)->orderBy('sequence')->get() as $t) {
                if ($this->verifiedPercent($t) < 100 - 1e-9) {
                    $open[] = "{$t->title} (".$this->verifiedPercent($t).' %)';
                }
            }
            if ($open !== []) {
                throw new AssignmentRuleViolation('Belum semua tugas terverifikasi 100 %: '.implode('; ', $open).'.');
            }
            if (DB::table('wo_progress')->where('work_order_id', $woId)->where('status', 'SUBMITTED')->exists()) {
                throw new AssignmentRuleViolation('Masih ada progres yang menunggu verifikasi.');
            }
            // Owner 7 Nov 2026: finished = every work process done AND the customer(s) at the external status PEREMAJAAN (EIS/Bot Daftung; internal CONNECTION_DONE); a proposal needs ALL its members there.
            $apps = ProposalService::scopeOf($wo->application_id);
            $reached = DB::table('application_external_status_histories')->whereIn('application_id', $apps)->whereRaw('upper(external_status_code) = ?', ['PEREMAJAAN'])->distinct()->pluck('application_id')->all();
            $missing = array_diff($apps, $reached);
            if ($missing !== []) {
                $numbers = DB::table('applications')->whereIn('id', $missing)->pluck('application_number')->implode(', ');
                throw new AssignmentRuleViolation(count($apps) === 1 ? 'Pelanggan belum berstatus PEREMAJAAN pada sinkronisasi EIS; WO belum dapat diselesaikan.' : "Pelanggan belum berstatus PEREMAJAAN pada sinkronisasi EIS: {$numbers}; WO belum dapat diselesaikan.");
            }
            DB::table('work_orders')->where('id', $woId)->update(['status' => 'COMPLETED', 'completed_by' => $actor->getKey(), 'completed_at' => now(), 'updated_at' => now()]);
            $this->event($woId, 'COMPLETED', $actor, 'Selesai melalui penutupan BASTP.', null);
        });
    }

    public function cancel(string $woId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($woId, $reason, $actor): void {
            $wo = $this->lock($woId);
            $this->requireStatus($wo, ['DRAFT', 'SUBMITTED', 'ISSUED', 'IN_PROGRESS'], 'dibatalkan');
            DB::table('wo_progress')->where('work_order_id', $woId)->where('status', 'SUBMITTED')->update(['status' => 'RETURNED', 'decided_at' => now(), 'return_reason' => 'Dikembalikan otomatis: WO dibatalkan.']);
            BastpService::cancelLive($woId, $actor, 'Dibatalkan otomatis: WO dibatalkan.');
            MaterialRequestService::closeForWorkOrder($woId, $actor, 'CANCELLED', 'WO dibatalkan.');
            DB::table('work_orders')->where('id', $woId)->update(['status' => 'CANCELLED', 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => trim($reason), 'updated_at' => now()]);
            $this->event($woId, 'CANCELLED', $actor, $reason, null);
        });
    }

    /** The official progress of a task: the latest VERIFIED submission, else the carried-over baseline. */
    public function verifiedPercent(object $task): float
    {
        $v = DB::table('wo_progress')->where('task_id', $task->id)->where('status', 'VERIFIED')->max('cumulative_percent');

        return max((float) $task->baseline_percent, (float) ($v ?? 0));
    }

    /** @param ?object $from the previous version when amending */
    private function build(object $app, ?object $from, ?string $amendReason, ?string $vendorId, User $actor): string
    {
        $pkg = DB::table('mto_packages')->where('application_id', $app->id)->where('status', 'APPROVED')->orderByDesc('created_at')->first()
            ?? throw new AssignmentRuleViolation('Permohonan belum memiliki paket MTO yang disetujui.');
        $rab = DB::table('rab_runs')->where('application_id', $app->id)->orderByDesc('run_number')->first()
            ?? throw new AssignmentRuleViolation('Permohonan belum memiliki run RAB.');
        $unit = DB::table('organizational_units')->where('id', $app->organizational_unit_id)->first();
        $version = ((int) DB::table('work_orders')->where('application_id', $app->id)->max('version_number')) + 1;
        $id = (string) Str::uuid();
        try {
            DB::table('work_orders')->insert(['id' => $id, 'application_id' => $app->id, 'version_number' => $version, 'wo_number' => "WO/{$unit->code}/{$app->application_number}/v{$version}", 'status' => 'DRAFT', 'mto_package_id' => $pkg->id, 'rab_run_id' => $rab->id,
                'vendor_company_id' => $vendorId, 'target_date' => $from?->target_date, 'amended_from_id' => $from?->id, 'amendment_reason' => $amendReason, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Permohonan sudah memiliki WO yang sedang disiapkan atau berjalan.', 0, $e) : $e;
        }
        $groups = (array) json_decode((string) $rab->groups, true);
        $volumes = $this->documents->groupVolumes($rab);
        $titles = (array) config('distriva.document.rekap_rows');
        $baseline = $from === null ? collect() : DB::table('wo_tasks')->where('work_order_id', $from->id)->get()->mapWithKeys(fn ($t) => [$t->group_code => $this->verifiedPercent($t)]);
        $seq = 0;
        foreach ($titles as $code => $def) {
            $total = (float) ($groups[$code]['total'] ?? 0);
            if ($total <= 0) {
                continue;
            }
            DB::table('wo_tasks')->insert(['id' => (string) Str::uuid(), 'work_order_id' => $id, 'sequence' => ++$seq, 'group_code' => $code, 'title' => $def['title'], 'unit_text' => $def['unit'], 'volume' => $volumes[$code] ?? 0,
                'amount' => $total, 'baseline_percent' => $baseline[$code] ?? 0]);
        }
        foreach (DB::table('mto_lines')->where('package_id', $pkg->id)->groupBy('khs_item_id')->selectRaw('khs_item_id, sum(material) q')->havingRaw('sum(material) > 0')->get() as $m) {
            DB::table('wo_materials')->insert(['id' => (string) Str::uuid(), 'work_order_id' => $id, 'khs_item_id' => $m->khs_item_id, 'quantity' => $m->q]);
        }
        if ($seq === 0) {
            throw new AssignmentRuleViolation('Run RAB tidak memiliki kelompok pekerjaan berbiaya; WO tidak dapat dibuat.');
        }
        $this->event($id, $from === null ? 'CREATED' : 'AMENDED', $actor, $amendReason, ['mto_package_id' => $pkg->id, 'rab_run_id' => $rab->id, 'amended_from_id' => $from?->id]);

        return $id;
    }

    /** @param list<string> $allowed */
    private function requireStatus(object $wo, array $allowed, string $verb): void
    {
        if (! in_array($wo->status, $allowed, true)) {
            throw new AssignmentRuleViolation("WO berstatus {$wo->status} tidak dapat {$verb}.");
        }
    }

    private function lock(string $id): object
    {
        return DB::table('work_orders')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $woId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('wo_events')->insert(['id' => (string) Str::uuid(), 'work_order_id' => $woId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
