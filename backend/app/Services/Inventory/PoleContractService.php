<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Pole contracts ("Kontrak Rinci", KR): the number of TM and TR poles of each KR, managed by PERENCANAAN. Allocated = pole lines of allocations whose poles part is confirmed (and not cancelled). */
class PoleContractService
{
    /** @param list<array{khs_item_id:string,pole_type:string,quantity:int}>|null $lines when given, the KR totals are the sums of its lines and the KR adds that pole stock */
    public function create(string $kr, ?string $description, int $tm, int $tr, User $actor, ?array $lines = null, ?string $vendorCompanyId = null, ?string $up3UnitId = null): string
    {
        $this->checkOwners($vendorCompanyId, $up3UnitId);
        $id = (string) Str::uuid();
        try {
            DB::transaction(function () use ($id, $kr, $description, $tm, $tr, $actor, $lines, $vendorCompanyId, $up3UnitId): void {
                if ($lines !== null && $lines !== []) {
                    $this->checkLines($lines);
                    [$tm, $tr] = $this->totals($lines);
                }
                DB::table('pole_contracts')->insert(['id' => $id, 'kr_number' => trim($kr), 'description' => $description, 'qty_tm' => $tm, 'qty_tr' => $tr, 'status' => 'ACTIVE', 'vendor_company_id' => $vendorCompanyId, 'up3_unit_id' => $up3UnitId, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                if ($lines !== null && $lines !== []) {
                    $this->putLines($id, $lines);
                }
                $this->event($id, 'CREATED', $actor, null, ['qty_tm' => $tm, 'qty_tr' => $tr, 'lines' => $lines ?? []]);
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Nomor Kontrak Rinci sudah ada.', 0, $e) : $e;
        }

        return $id;
    }

    /** @param list<array{khs_item_id:string,pole_type:string,quantity:int}>|null $lines replaces the KR lines as a whole (a line cannot drop below what is already plotted from it) */
    /** @param array{vendor_company_id?:?string,up3_unit_id?:?string} $owners only the keys present are changed (null clears) */
    public function update(string $id, ?string $description, ?int $tm, ?int $tr, string $reason, User $actor, ?array $lines = null, array $owners = []): void
    {
        $this->checkOwners($owners['vendor_company_id'] ?? null, $owners['up3_unit_id'] ?? null);
        DB::transaction(function () use ($id, $description, $tm, $tr, $reason, $actor, $lines, $owners): void {
            $c = DB::table('pole_contracts')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($c->status !== 'ACTIVE') {
                throw new AssignmentRuleViolation('Kontrak Rinci yang ditutup tidak dapat diubah.');
            }
            if ($lines !== null) {
                if ($lines === []) {
                    throw new AssignmentRuleViolation('Daftar baris tiang Kontrak Rinci tidak boleh kosong.');
                }
                $this->checkLines($lines);
                $byItem = $this->allocatedByItem($id);
                $newQty = [];
                foreach ($lines as $l) {
                    $newQty[$l['khs_item_id']] = (int) $l['quantity'];
                }
                foreach ($byItem as $khs => $q) {
                    if ($q > ($newQty[$khs] ?? 0)) {
                        throw new AssignmentRuleViolation('Baris tiang tidak boleh dikurangi di bawah yang sudah dialokasikan ('.$q.') atau dihapus.');
                    }
                }
                [$tm, $tr] = $this->totals($lines);
            }
            $used = $this->allocated($id);
            $new = ['qty_tm' => $tm ?? (int) $c->qty_tm, 'qty_tr' => $tr ?? (int) $c->qty_tr];
            foreach (['TM' => 'qty_tm', 'TR' => 'qty_tr'] as $type => $col) {
                if ($new[$col] < $used[$type]) {
                    throw new AssignmentRuleViolation("Jumlah tiang {$type} tidak boleh di bawah yang sudah dialokasikan ({$used[$type]}).");
                }
            }
            DB::table('pole_contracts')->where('id', $id)->update($new + array_intersect_key($owners, ['vendor_company_id' => 1, 'up3_unit_id' => 1]) + ['description' => $description ?? $c->description, 'updated_at' => now()]);
            if ($lines !== null) {
                $before = $this->lines($id);
                DB::table('pole_contract_lines')->where('pole_contract_id', $id)->delete();
                $this->putLines($id, $lines);
            }
            $this->event($id, 'UPDATED', $actor, $reason, ['before' => ['qty_tm' => (int) $c->qty_tm, 'qty_tr' => (int) $c->qty_tr]] + ['after' => $new] + ($lines === null ? [] : ['lines_before' => $before ?? [], 'lines_after' => $lines]));
        });
    }

    /** The pole vendor must be an active company that may take pole work; the owner must be an UP3. */
    private function checkOwners(?string $vendorCompanyId, ?string $up3UnitId): void
    {
        if ($vendorCompanyId !== null) {
            $v = DB::table('vendor_companies')->where('id', $vendorCompanyId)->first();
            if ($v === null || $v->status !== 'ACTIVE' || $v->work_scope === 'JARINGAN') {
                throw new AssignmentRuleViolation('Vendor Kontrak Rinci harus perusahaan vendor aktif untuk pekerjaan tiang.');
            }
        }
        if ($up3UnitId !== null && DB::table('organizational_units')->where('id', $up3UnitId)->where('unit_type', 'UP3')->doesntExist()) {
            throw new AssignmentRuleViolation('UP3 pemilik Kontrak Rinci tidak ditemukan.');
        }
    }

    public function close(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $c = DB::table('pole_contracts')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($c->status !== 'ACTIVE') {
                throw new AssignmentRuleViolation('Kontrak Rinci sudah ditutup.');
            }
            DB::table('pole_contracts')->where('id', $id)->update(['status' => 'CLOSED', 'updated_at' => now()]);
            $this->event($id, 'CLOSED', $actor, $reason, null);
        });
    }

    /** @return array{TM:int,TR:int} poles of allocations whose poles part is confirmed */
    public function allocated(string $id): array
    {
        $rows = DB::table('allocation_pole_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->where('l.pole_contract_id', $id)->whereNotNull('a.poles_confirmed_at')->where('a.status', '<>', 'CANCELLED')
            ->groupBy('l.pole_type')->selectRaw('l.pole_type, sum(l.quantity) q')->pluck('q', 'pole_type');

        return ['TM' => (int) ($rows['TM'] ?? 0), 'TR' => (int) ($rows['TR'] ?? 0)];
    }

    /** @param list<array{khs_item_id:string,pole_type:string,quantity:int}> $lines */
    private function checkLines(array $lines): void
    {
        $seen = [];
        $errs = [];
        $ids = DB::table('khs_items')->whereIn('id', array_column($lines, 'khs_item_id'))->pluck('id')->all();
        foreach ($lines as $l) {
            if (! in_array($l['khs_item_id'], $ids, true)) {
                $errs[] = 'Material tiang '.$l['khs_item_id'].' tidak ditemukan pada katalog KHS.';
            }
            if (isset($seen[$l['khs_item_id']])) {
                $errs[] = 'Material tiang yang sama muncul lebih dari sekali pada Kontrak Rinci.';
            }
            $seen[$l['khs_item_id']] = true;
        }
        if ($errs !== []) {
            throw new AssignmentRuleViolation(implode(' ', array_unique($errs)));
        }
    }

    /** @param list<array{khs_item_id:string,pole_type:string,quantity:int}> $lines @return array{0:int,1:int} TM and TR totals */
    private function totals(array $lines): array
    {
        $t = ['TM' => 0, 'TR' => 0];
        foreach ($lines as $l) {
            $t[$l['pole_type']] += (int) $l['quantity'];
        }

        return [$t['TM'], $t['TR']];
    }

    /** @param list<array{khs_item_id:string,pole_type:string,quantity:int}> $lines */
    private function putLines(string $id, array $lines): void
    {
        foreach ($lines as $l) {
            DB::table('pole_contract_lines')->insert(['id' => (string) Str::uuid(), 'pole_contract_id' => $id, 'khs_item_id' => $l['khs_item_id'], 'pole_type' => $l['pole_type'], 'quantity' => (int) $l['quantity'], 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    /** @return list<array{khs_item_id:string,pole_type:string,quantity:int}> */
    public function lines(string $id): array
    {
        return DB::table('pole_contract_lines')->where('pole_contract_id', $id)->get()->map(fn ($l) => ['khs_item_id' => $l->khs_item_id, 'pole_type' => $l->pole_type, 'quantity' => (int) $l->quantity])->all();
    }

    /** @return array<string,int> poles plotted per KHS item from this KR (confirmed pole parts, not cancelled) */
    public function allocatedByItem(string $id): array
    {
        return DB::table('allocation_pole_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->where('l.pole_contract_id', $id)->whereNotNull('l.khs_item_id')->whereNotNull('a.poles_confirmed_at')->where('a.status', '<>', 'CANCELLED')
            ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) q')->pluck('q', 'khs_item_id')->map(fn ($q) => (int) $q)->all();
    }

    /**
     * Lines of a KR with the stock they add: total, plotted, remaining, and whether the ERP stock now carries that material (a snapshot dated after the KR was entered holds it): from then on the ERP position is the truth
     * and the KR no longer counts as extra supply (no double counting, docs/62 §49).
     *
     * @return list<array<string,mixed>>
     */
    public function lineStock(object $kr): array
    {
        $by = $this->allocatedByItem($kr->id);
        $entered = CarbonImmutable::parse($kr->created_at)->setTimezone((string) config('distriva.business_timezone'))->toDateString();
        $out = [];
        foreach (DB::table('pole_contract_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.pole_contract_id', $kr->id)->orderBy('l.pole_type')->orderBy('k.code')->selectRaw('l.khs_item_id, l.pole_type, l.quantity, k.code, (select v.name from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as name')->get() as $l) {
            $inErp = DB::table('stock_snapshot_lines as sl')->join('stock_snapshots as s', 's.id', '=', 'sl.snapshot_id')->where('sl.khs_item_id', $l->khs_item_id)->where('sl.on_hand', '>', 0)->where('s.as_of', '>', $entered)->exists();
            $allocated = (int) ($by[$l->khs_item_id] ?? 0);
            $out[] = ['khs_item_id' => $l->khs_item_id, 'khs_code' => $l->code, 'khs_name' => $l->name, 'pole_type' => $l->pole_type, 'total' => (int) $l->quantity, 'allocated' => $allocated, 'remaining' => (int) $l->quantity - $allocated, 'in_erp_stock' => $inErp];
        }

        return $out;
    }

    /** @return array<string,int> extra pole supply per KHS item: remaining of the lines of ACTIVE KR that the ERP stock does not carry yet */
    public function supplyByItem(): array
    {
        $out = [];
        foreach (DB::table('pole_contracts')->where('status', 'ACTIVE')->get() as $kr) {
            foreach ($this->lineStock($kr) as $l) {
                if (! $l['in_erp_stock']) {
                    $out[$l['khs_item_id']] = ($out[$l['khs_item_id']] ?? 0) + max(0, $l['remaining']);
                }
            }
        }

        return $out;
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $id, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('pole_contract_events')->insert(['id' => (string) Str::uuid(), 'pole_contract_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason, 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
