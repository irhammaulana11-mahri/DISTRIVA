<?php

namespace App\Services\WorkOrders;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * WO Tiang (owner 12 Nov 2026): work for the POLE vendor (a company of its own) requested by a letter whose number comes from the internal AMS and that may list several locations.
 * Each line copies one pole line of a CONFIRMED poles part of an allocation (Kontrak Rinci, TM/TR, quantity), so nothing is typed twice. Flow: DRAFT -> ISSUED (PERENCANAAN)
 * -> IN_PROGRESS (the vendor reports progress per line, PERENCANAAN verifies) -> COMPLETED (the pole BASTP is closed by ASMAN_PERENCANAAN). Callers authorize the actor first.
 */
class PoleWorkOrderService
{
    private const LIVE = ['DRAFT', 'ISSUED', 'IN_PROGRESS'];

    /** UP3 of an application: its own unit when it is an UP3, else the parent of its ULP. */
    public static function up3Of(string $applicationId): string
    {
        $u = DB::table('applications as a')->join('organizational_units as o', 'o.id', '=', 'a.organizational_unit_id')->where('a.id', $applicationId)->first(['o.id', 'o.unit_type', 'o.parent_id']) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return (string) ($u->unit_type === 'UP3' ? $u->id : $u->parent_id);
    }

    /**
     * Pole lines that can still be put on a WO Tiang: poles part CONFIRMED, allocation not cancelled, not already on a live or completed pole WO.
     *
     * @param  list<string>|null  $unitIds  ULP ids the caller may act on (null = every unit)
     * @return list<array<string,mixed>>
     */
    public function candidates(?array $unitIds = null, ?string $includeWorkOrder = null): array
    {
        $q = DB::table('allocation_pole_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->join('applications as ap', 'ap.id', '=', 'a.application_id')
            ->join('organizational_units as o', 'o.id', '=', 'ap.organizational_unit_id')->join('pole_contracts as c', 'c.id', '=', 'l.pole_contract_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'ap.customer_id')->leftJoin('khs_items as k', 'k.id', '=', 'l.khs_item_id')
            ->whereNotNull('a.poles_confirmed_at')->where('a.status', '<>', 'CANCELLED')
            ->whereNotExists(fn ($s) => $s->select(DB::raw(1))->from('pole_wo_lines as pl')->join('pole_work_orders as w', 'w.id', '=', 'pl.pole_work_order_id')
                ->whereColumn('pl.allocation_pole_line_id', 'l.id')->where('w.status', '<>', 'CANCELLED')->when($includeWorkOrder !== null, fn ($x) => $x->where('w.id', '<>', $includeWorkOrder)))
            ->orderBy('ap.application_number')->orderBy('c.kr_number');
        $rows = $q->get(['l.id as allocation_pole_line_id', 'a.id as allocation_id', 'a.application_id', 'ap.application_number', 'cu.name as customer_name', 'o.id as unit_id', 'o.unit_type', 'o.parent_id', 'o.name as unit_name',
            'c.id as pole_contract_id', 'c.kr_number', 'c.vendor_company_id as kr_vendor_id', 'c.up3_unit_id as kr_up3_id', 'l.pole_type', 'l.quantity', 'l.khs_item_id', 'k.code as khs_code']);
        $vendorNames = DB::table('vendor_companies')->pluck('name', 'id');
        $up3Names = DB::table('organizational_units')->where('unit_type', 'UP3')->pluck('name', 'id');
        $out = [];
        foreach ($rows as $r) {
            $up3 = $r->unit_type === 'UP3' ? $r->unit_id : $r->parent_id;
            if ($unitIds !== null && ! in_array($r->unit_id, $unitIds, true)) {
                continue;
            }
            $out[] = ['allocation_pole_line_id' => $r->allocation_pole_line_id, 'allocation_id' => $r->allocation_id, 'application_id' => $r->application_id, 'application_number' => $r->application_number, 'customer_name' => $r->customer_name,
                'unit_name' => $r->unit_name, 'unit_id' => $r->unit_id, 'up3_unit_id' => $up3, 'pole_contract_id' => $r->pole_contract_id, 'kr_number' => $r->kr_number, 'kr_vendor_id' => $r->kr_vendor_id, 'kr_vendor_name' => $r->kr_vendor_id === null ? null : ($vendorNames[$r->kr_vendor_id] ?? null),
                'kr_up3_name' => $r->kr_up3_id === null ? null : ($up3Names[$r->kr_up3_id] ?? null), 'from_other_up3' => $r->kr_up3_id !== null && $r->kr_up3_id !== $up3, 'pole_type' => $r->pole_type, 'quantity' => (int) $r->quantity, 'khs_code' => $r->khs_code];
        }

        return $out;
    }

    /** The organizational units (of the applications) a pole WO touches — what the authorization is checked against. @return list<string> */
    public static function unitsOf(string $workOrderId): array
    {
        return DB::table('pole_wo_lines as l')->join('applications as a', 'a.id', '=', 'l.application_id')->where('l.pole_work_order_id', $workOrderId)->distinct()->pluck('a.organizational_unit_id')->all();
    }

    /** @param list<string> $allocationPoleLineIds */
    public function create(string $letterNumber, string $letterDate, ?string $vendorCompanyId, ?string $notes, array $allocationPoleLineIds, User $actor, array $lineMeta = []): string
    {
        $id = (string) Str::uuid();
        try {
            DB::transaction(function () use ($id, $letterNumber, $letterDate, $vendorCompanyId, $notes, $allocationPoleLineIds, $actor, $lineMeta): void {
                [$up3, $lines] = $this->resolveLines($allocationPoleLineIds, null);
                $vendorCompanyId = $this->resolveVendor($lines, $vendorCompanyId);
                $this->requirePoleVendor($vendorCompanyId);
                DB::table('pole_work_orders')->insert(['id' => $id, 'letter_number' => trim($letterNumber), 'letter_date' => $letterDate, 'up3_unit_id' => $up3, 'vendor_company_id' => $vendorCompanyId, 'status' => 'DRAFT',
                    'notes' => $this->blank($notes), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                $this->insertLines($id, $lines, $lineMeta);
                $this->event($id, 'CREATED', $actor, null, ['lines' => count($lines)]);
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Nomor surat sudah dipakai oleh WO Tiang lain.', 0, $e) : $e;
        }

        return $id;
    }

    /** @param list<string> $allocationPoleLineIds */
    public function update(string $id, string $letterNumber, string $letterDate, ?string $vendorCompanyId, ?string $notes, array $allocationPoleLineIds, User $actor, array $lineMeta = []): void
    {
        try {
            DB::transaction(function () use ($id, $letterNumber, $letterDate, $vendorCompanyId, $notes, $allocationPoleLineIds, $actor, $lineMeta): void {
                $wo = $this->lock($id);
                $this->requireStatus($wo, ['DRAFT'], 'diubah');
                [$up3, $lines] = $this->resolveLines($allocationPoleLineIds, $id);
                $vendorCompanyId = $this->resolveVendor($lines, $vendorCompanyId);
                $this->requirePoleVendor($vendorCompanyId);
                DB::table('pole_work_orders')->where('id', $id)->update(['letter_number' => trim($letterNumber), 'letter_date' => $letterDate, 'up3_unit_id' => $up3, 'vendor_company_id' => $vendorCompanyId, 'notes' => $this->blank($notes), 'updated_at' => now()]);
                DB::table('pole_wo_lines')->where('pole_work_order_id', $id)->delete();
                $this->insertLines($id, $lines, $lineMeta);
                $this->event($id, 'UPDATED', $actor, null, ['lines' => count($lines)]);
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Nomor surat sudah dipakai oleh WO Tiang lain.', 0, $e) : $e;
        }
    }

    public function attachLetter(string $id, string $key, string $name, User $actor): ?string
    {
        return DB::transaction(function () use ($id, $key, $name, $actor): ?string {
            $wo = $this->lock($id);
            $this->requireStatus($wo, ['DRAFT', 'ISSUED', 'IN_PROGRESS'], 'diberi lampiran surat');
            DB::table('pole_work_orders')->where('id', $id)->update(['letter_key' => $key, 'letter_name' => $name, 'updated_at' => now()]);
            $this->event($id, 'LETTER_ATTACHED', $actor, $name, null);

            return $wo->letter_key;   // the previous file, for the caller to delete
        });
    }

    public function issue(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $wo = $this->lock($id);
            $this->requireStatus($wo, ['DRAFT'], 'diterbitkan');
            $this->requirePoleVendor($wo->vendor_company_id);
            $ids = DB::table('pole_wo_lines')->where('pole_work_order_id', $id)->pluck('allocation_pole_line_id')->all();
            if ($ids === []) {
                throw new AssignmentRuleViolation('WO Tiang belum memiliki baris lokasi.');
            }
            [, $lines] = $this->resolveLines($ids, $id);   // re-check under lock: the poles part must still be confirmed and not on another pole WO
            $meta = DB::table('pole_wo_lines')->where('pole_work_order_id', $id)->get(['allocation_pole_line_id', 'pole_condition', 'origin_note'])
                ->mapWithKeys(fn ($m) => [$m->allocation_pole_line_id => ['condition' => $m->pole_condition, 'note' => $m->origin_note]])->all();
            DB::table('pole_wo_lines')->where('pole_work_order_id', $id)->delete();
            $this->insertLines($id, $lines, $meta);
            DB::table('pole_work_orders')->where('id', $id)->update(['status' => 'ISSUED', 'issued_by' => $actor->getKey(), 'issued_at' => now(), 'updated_at' => now()]);
            $this->event($id, 'ISSUED', $actor, null, ['vendor_company_id' => $wo->vendor_company_id]);
        });
    }

    /**
     * Revision (amandemen) of an ISSUED / IN_PROGRESS pole WO (owner 12 Nov 2026): the letter number stays, the vendor stays, and only the location lines sent to the vendor change — lines are
     * added or dropped (a location with any progress cannot be dropped) and the condition/origin of kept lines may change. The revision is counted (1, 2, ...) with its reason and the lines before.
     *
     * @param  list<string>  $allocationPoleLineIds  the full set of lines the WO should have after the revision
     * @param  array<string,array{condition?:?string,note?:?string}>  $lineMeta
     */
    public function amend(string $id, string $reason, array $allocationPoleLineIds, array $lineMeta, User $actor): int
    {
        return DB::transaction(function () use ($id, $reason, $allocationPoleLineIds, $lineMeta, $actor): int {
            $wo = $this->lock($id);
            $this->requireStatus($wo, ['ISSUED', 'IN_PROGRESS'], 'direvisi');
            if (trim($reason) === '') {
                throw new AssignmentRuleViolation('Alasan revisi wajib diisi.');
            }
            if (DB::table('pole_wo_bastp')->where('pole_work_order_id', $id)->where('status', 'SUBMITTED')->exists()) {
                throw new AssignmentRuleViolation('BASTP tiang masih menunggu keputusan; selesaikan atau kembalikan dulu sebelum merevisi.');
            }
            [$up3, $lines] = $this->resolveLines($allocationPoleLineIds, $id);
            if ($up3 !== (string) $wo->up3_unit_id) {
                throw new AssignmentRuleViolation('Revisi tidak boleh memindahkan WO Tiang ke UP3 lain.');
            }
            if ($this->resolveVendor($lines, $wo->vendor_company_id) !== (string) $wo->vendor_company_id) {
                throw new AssignmentRuleViolation('Revisi tidak boleh mengganti vendor tiang; batalkan WO dan buat yang baru untuk vendor lain.');
            }
            $existing = DB::table('pole_wo_lines as l')->join('applications as a', 'a.id', '=', 'l.application_id')->join('pole_contracts as c', 'c.id', '=', 'l.pole_contract_id')->where('l.pole_work_order_id', $id)
                ->get(['l.id', 'l.allocation_pole_line_id', 'a.application_number', 'c.kr_number', 'l.pole_type', 'l.quantity', 'l.pole_condition', 'l.origin_note'])->keyBy('allocation_pole_line_id');
            $want = array_flip(array_values(array_unique($allocationPoleLineIds)));
            $remove = $existing->filter(fn ($l, $k) => ! isset($want[$k]));
            foreach ($remove as $l) {
                if (DB::table('pole_wo_progress')->where('line_id', $l->id)->exists()) {
                    throw new AssignmentRuleViolation("Lokasi {$l->application_number} ({$l->kr_number} {$l->pole_type}) sudah memiliki laporan progres dan tidak dapat dihapus dari WO.");
                }
            }
            $add = array_values(array_filter($lines, fn ($l) => ! $existing->has($l['allocation_pole_line_id'])));
            $changed = 0;
            foreach ($lines as $l) {
                $e = $existing[$l['allocation_pole_line_id']] ?? null;
                if ($e === null) {
                    continue;
                }
                $m = $lineMeta[$l['allocation_pole_line_id']] ?? null;
                $cond = $m['condition'] ?? $e->pole_condition;
                $note = $m === null ? $e->origin_note : $this->blank($m['note'] ?? null);
                if ($cond !== $e->pole_condition || $note !== $e->origin_note) {
                    DB::table('pole_wo_lines')->where('id', $e->id)->update(['pole_condition' => $cond, 'origin_note' => $note]);
                    $changed++;
                }
            }
            if ($add === [] && $remove->isEmpty() && $changed === 0) {
                throw new AssignmentRuleViolation('Tidak ada perubahan pada rincian WO Tiang.');
            }
            $before = $existing->values()->map(fn ($l) => ['application_number' => $l->application_number, 'kr_number' => $l->kr_number, 'pole_type' => $l->pole_type, 'quantity' => (int) $l->quantity,
                'pole_condition' => $l->pole_condition, 'origin_note' => $l->origin_note])->all();
            if ($remove->isNotEmpty()) {
                DB::table('pole_wo_lines')->whereIn('id', $remove->pluck('id')->all())->delete();
            }
            $this->insertLines($id, $add, $lineMeta);
            $rev = (int) $wo->revision_number + 1;
            DB::table('pole_work_orders')->where('id', $id)->update(['revision_number' => $rev, 'updated_at' => now()]);
            DB::table('pole_wo_revisions')->insert(['id' => (string) Str::uuid(), 'pole_work_order_id' => $id, 'revision_number' => $rev, 'reason' => trim($reason), 'before_lines' => json_encode($before),
                'added' => count($add), 'removed' => $remove->count(), 'changed' => $changed, 'actor_user_id' => $actor->getKey(), 'created_at' => now()]);
            $this->event($id, 'REVISED', $actor, $reason, ['revision' => $rev, 'added' => count($add), 'removed' => $remove->count(), 'changed' => $changed]);

            return $rev;
        });
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $wo = $this->lock($id);
            $this->requireStatus($wo, self::LIVE, 'dibatalkan');
            DB::table('pole_wo_progress')->where('pole_work_order_id', $id)->where('status', 'SUBMITTED')->update(['status' => 'RETURNED', 'decided_at' => now(), 'return_reason' => 'Dikembalikan otomatis: WO Tiang dibatalkan.']);
            DB::table('pole_wo_bastp')->where('pole_work_order_id', $id)->where('status', 'SUBMITTED')->update(['status' => 'CANCELLED', 'decided_at' => now(), 'return_reason' => 'Dibatalkan otomatis: WO Tiang dibatalkan.', 'updated_at' => now()]);
            DB::table('pole_work_orders')->where('id', $id)->update(['status' => 'CANCELLED', 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => trim($reason), 'updated_at' => now()]);
            $this->event($id, 'CANCELLED', $actor, $reason, null);
        });
    }

    /** @return array{id:string,replayed:bool} */
    public function submitProgress(string $id, string $lineId, string $key, float $percent, string $workDate, ?string $notes, User $actor): array
    {
        try {
            return DB::transaction(function () use ($id, $lineId, $key, $percent, $workDate, $notes, $actor): array {
                $wo = $this->lock($id);
                $this->requireStatus($wo, ['ISSUED', 'IN_PROGRESS'], 'menerima progres');
                DB::table('pole_wo_lines')->where('id', $lineId)->where('pole_work_order_id', $id)->exists() || throw new AssignmentRuleViolation('Baris lokasi tidak ada pada WO Tiang ini.');
                $same = DB::table('pole_wo_progress')->where('pole_work_order_id', $id)->where('submission_key', $key)->first();
                if ($same !== null) {
                    if ($same->line_id !== $lineId || abs((float) $same->cumulative_percent - $percent) > 0.001) {
                        throw new AssignmentRuleViolation('Kunci pengajuan ini sudah dipakai untuk isi yang berbeda.');
                    }

                    return ['id' => $same->id, 'replayed' => true];
                }
                if (DB::table('pole_wo_progress')->where('line_id', $lineId)->where('status', 'SUBMITTED')->exists()) {
                    throw new AssignmentRuleViolation('Lokasi ini masih memiliki progres yang menunggu verifikasi.');
                }
                $floor = $this->verifiedPercent($lineId);
                if ($percent + 1e-9 < $floor) {
                    throw new AssignmentRuleViolation("Progres kumulatif tidak boleh di bawah progres terverifikasi ({$floor} %).");
                }
                $pid = (string) Str::uuid();
                DB::table('pole_wo_progress')->insert(['id' => $pid, 'pole_work_order_id' => $id, 'line_id' => $lineId, 'submission_key' => $key, 'cumulative_percent' => $percent, 'work_date' => $workDate, 'notes' => $this->blank($notes),
                    'status' => 'SUBMITTED', 'submitted_by' => $actor->getKey(), 'submitted_at' => now()]);
                if ($wo->status === 'ISSUED') {
                    DB::table('pole_work_orders')->where('id', $id)->update(['status' => 'IN_PROGRESS', 'updated_at' => now()]);
                }
                $this->event($id, 'PROGRESS_SUBMITTED', $actor, $notes, ['line_id' => $lineId, 'cumulative_percent' => $percent, 'work_date' => $workDate]);

                return ['id' => $pid, 'replayed' => false];
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Pengajuan progres bentrok dengan pengajuan lain pada lokasi yang sama.', 0, $e) : $e;
        }
    }

    public function decideProgress(string $progressId, string $decision, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($progressId, $decision, $reason, $actor): void {
            $p = DB::table('pole_wo_progress')->where('id', $progressId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $wo = $this->lock($p->pole_work_order_id);
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
            DB::table('pole_wo_progress')->where('id', $progressId)->update(['status' => $decision, 'decided_by' => $actor->getKey(), 'decided_at' => now(), 'return_reason' => $decision === 'RETURNED' ? trim((string) $reason) : null]);
            $this->event($wo->id, $decision === 'VERIFIED' ? 'PROGRESS_VERIFIED' : 'PROGRESS_RETURNED', $actor, $reason, ['line_id' => $p->line_id, 'cumulative_percent' => (float) $p->cumulative_percent]);
        });
    }

    /** The official progress of a line: the highest VERIFIED cumulative percent (a submission can never go below the verified floor, so this is also the latest), else 0. */
    public function verifiedPercent(string $lineId): float
    {
        return (float) (DB::table('pole_wo_progress')->where('line_id', $lineId)->where('status', 'VERIFIED')->max('cumulative_percent') ?? 0);
    }

    /** PERENCANAAN prepares the pole BASTP once every line is verified at 100 %; it goes straight to ASMAN_PERENCANAAN. */
    public function prepareBastp(string $id, string $number, string $date, ?string $notes, User $actor): string
    {
        $bid = (string) Str::uuid();
        try {
            DB::transaction(function () use ($id, $number, $date, $notes, $actor, $bid): void {
                $wo = $this->lock($id);
                $this->requireStatus($wo, ['IN_PROGRESS'], 'dibuatkan BASTP');
                if (DB::table('pole_wo_bastp')->where('pole_work_order_id', $id)->where('status', 'SUBMITTED')->exists()) {
                    throw new AssignmentRuleViolation('BASTP tiang masih menunggu keputusan.');
                }
                $this->requireAllDone($id);
                DB::table('pole_wo_bastp')->insert(['id' => $bid, 'pole_work_order_id' => $id, 'bastp_number' => trim($number), 'bastp_date' => $date, 'notes' => $this->blank($notes), 'status' => 'SUBMITTED',
                    'prepared_by' => $actor->getKey(), 'prepared_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
                $this->event($id, 'BASTP_SUBMITTED', $actor, $number, null);
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Nomor BASTP sudah dipakai.', 0, $e) : $e;
        }

        return $bid;
    }

    /** CLOSE completes the WO; RETURN sends the BASTP back with a reason (a new one can be prepared). */
    public function decideBastp(string $bastpId, string $decision, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($bastpId, $decision, $reason, $actor): void {
            $b = DB::table('pole_wo_bastp')->where('id', $bastpId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $wo = $this->lock($b->pole_work_order_id);
            if ($b->status !== 'SUBMITTED') {
                throw new AssignmentRuleViolation("BASTP berstatus {$b->status}; tidak menunggu keputusan.");
            }
            if ($decision === 'RETURN') {
                if (trim((string) $reason) === '') {
                    throw new AssignmentRuleViolation('Pengembalian wajib disertai alasan.');
                }
                DB::table('pole_wo_bastp')->where('id', $bastpId)->update(['status' => 'RETURNED', 'decided_by' => $actor->getKey(), 'decided_at' => now(), 'return_reason' => trim($reason), 'updated_at' => now()]);
                $this->event($wo->id, 'BASTP_RETURNED', $actor, $reason, null);

                return;
            }
            $this->requireStatus($wo, ['IN_PROGRESS'], 'diselesaikan');
            $this->requireAllDone($wo->id);
            DB::table('pole_wo_bastp')->where('id', $bastpId)->update(['status' => 'CLOSED', 'decided_by' => $actor->getKey(), 'decided_at' => now(), 'updated_at' => now()]);
            DB::table('pole_work_orders')->where('id', $wo->id)->update(['status' => 'COMPLETED', 'completed_by' => $actor->getKey(), 'completed_at' => now(), 'updated_at' => now()]);
            $this->event($wo->id, 'COMPLETED', $actor, 'Selesai melalui penutupan BASTP tiang.', null);
        });
    }

    private function requireAllDone(string $id): void
    {
        $open = [];
        foreach (DB::table('pole_wo_lines as l')->join('applications as a', 'a.id', '=', 'l.application_id')->where('l.pole_work_order_id', $id)->get(['l.id', 'a.application_number', 'l.pole_type']) as $l) {
            if ($this->verifiedPercent($l->id) < 100 - 1e-9) {
                $open[] = "{$l->application_number} {$l->pole_type} (".$this->verifiedPercent($l->id).' %)';
            }
        }
        if ($open !== []) {
            throw new AssignmentRuleViolation('Belum semua lokasi terverifikasi 100 %: '.implode('; ', $open).'.');
        }
        if (DB::table('pole_wo_progress')->where('pole_work_order_id', $id)->where('status', 'SUBMITTED')->exists()) {
            throw new AssignmentRuleViolation('Masih ada progres yang menunggu verifikasi.');
        }
    }

    /**
     * Validates the chosen allocation pole lines under lock: one UP3, poles part confirmed, allocation live, not on another live/completed pole WO (except `$exceptWorkOrder`).
     *
     * @param  list<string>  $ids
     * @return array{0:string,1:list<array<string,mixed>>}
     */
    private function resolveLines(array $ids, ?string $exceptWorkOrder): array
    {
        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            throw new AssignmentRuleViolation('Pilih minimal satu baris tiang lokasi.');
        }
        DB::table('allocation_pole_lines')->whereIn('id', $ids)->lockForUpdate()->get();
        $by = collect($this->candidates(null, $exceptWorkOrder))->keyBy('allocation_pole_line_id');
        $lines = [];
        foreach ($ids as $lid) {
            $c = $by[$lid] ?? null;
            if ($c === null) {
                throw new AssignmentRuleViolation('Ada baris tiang yang tidak dapat dipakai: bagian tiang alokasinya belum terkonfirmasi, sudah dibatalkan, atau sudah ada di WO Tiang lain.');
            }
            $lines[] = $c;
        }
        $ups = array_values(array_unique(array_column($lines, 'up3_unit_id')));
        if (count($ups) !== 1) {
            throw new AssignmentRuleViolation('Satu surat/WO Tiang hanya boleh memuat lokasi dari satu UP3.');
        }

        return [$ups[0], $lines];
    }

    /**
     * @param  list<array<string,mixed>>  $lines
     * @param  array<string,array{condition?:?string,note?:?string}>  $meta  per allocation pole line id: pole condition (BARU, BEKAS, RELOKASI) and the origin note
     */
    private function insertLines(string $id, array $lines, array $meta = []): void
    {
        $khs = DB::table('allocation_pole_lines')->whereIn('id', array_column($lines, 'allocation_pole_line_id'))->pluck('khs_item_id', 'id');
        foreach ($lines as $l) {
            DB::table('pole_wo_lines')->insert(['id' => (string) Str::uuid(), 'pole_work_order_id' => $id, 'application_id' => $l['application_id'], 'allocation_id' => $l['allocation_id'], 'allocation_pole_line_id' => $l['allocation_pole_line_id'],
                'pole_contract_id' => $l['pole_contract_id'], 'pole_type' => $l['pole_type'], 'khs_item_id' => $khs[$l['allocation_pole_line_id']] ?? null, 'quantity' => $l['quantity'],
                'pole_condition' => $meta[$l['allocation_pole_line_id']]['condition'] ?? 'BARU', 'origin_note' => $this->blank($meta[$l['allocation_pole_line_id']]['note'] ?? null)]);
        }
    }

    /**
     * The pole vendor follows the Kontrak Rinci (owner 12 Nov 2026): when the chosen lines' KRs have a vendor, that vendor is the WO's (all lines must agree and a given vendor must match);
     * KRs without a vendor (older data) fall back to the vendor given.
     *
     * @param  list<array<string,mixed>>  $lines
     */
    private function resolveVendor(array $lines, ?string $given): string
    {
        $fromKr = array_values(array_unique(array_filter(array_column($lines, 'kr_vendor_id'))));
        if (count($fromKr) > 1) {
            throw new AssignmentRuleViolation('Lokasi dalam satu surat harus dari Kontrak Rinci milik vendor yang sama; ada Kontrak Rinci dengan vendor berbeda.');
        }
        if (count($fromKr) === 1) {
            if ($given !== null && $given !== $fromKr[0]) {
                throw new AssignmentRuleViolation('Vendor tidak sesuai dengan vendor Kontrak Rinci yang dipilih.');
            }
            if (count(array_filter(array_column($lines, 'kr_vendor_id'))) !== count($lines)) {
                throw new AssignmentRuleViolation('Ada Kontrak Rinci tanpa vendor di antara lokasi yang dipilih; lengkapi vendor Kontrak Rinci itu.');
            }

            return $fromKr[0];
        }

        return $given ?? throw new AssignmentRuleViolation('Pilih vendor tiang: Kontrak Rinci yang dipilih belum memiliki vendor.');
    }

    private function requirePoleVendor(string $companyId): void
    {
        $c = DB::table('vendor_companies')->where('id', $companyId)->first();
        if ($c === null || $c->status !== 'ACTIVE') {
            throw new AssignmentRuleViolation('Perusahaan vendor tidak ditemukan atau tidak aktif.');
        }
        if ($c->work_scope === 'JARINGAN') {
            throw new AssignmentRuleViolation('Vendor ini khusus pekerjaan jaringan; pilih vendor tiang.');
        }
    }

    private function requireStatus(object $wo, array $allowed, string $verb): void
    {
        if (! in_array($wo->status, $allowed, true)) {
            throw new AssignmentRuleViolation("WO Tiang berstatus {$wo->status} tidak dapat {$verb}.");
        }
    }

    private function blank(?string $v): ?string
    {
        $v = $v === null ? null : trim($v);

        return $v === '' ? null : $v;
    }

    private function lock(string $id): object
    {
        return DB::table('pole_work_orders')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $id, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('pole_wo_events')->insert(['id' => (string) Str::uuid(), 'pole_work_order_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason),
            'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
