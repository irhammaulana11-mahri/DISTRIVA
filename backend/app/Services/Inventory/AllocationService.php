<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\WorkOrders\MaterialOutbox;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Allocation to ONE application from its APPROVED MTO package (docs/62 §30). Two parts with two owners (owner 7 Nov 2026): the MATERIALS part (all materials except concrete
 * poles, from a warehouse) by the Konstruksi/Gudang role and the POLES part (concrete poles TM/TR with the Kontrak Rinci number) by PERENCANAAN. Each part is replaced as a whole
 * while DRAFT, then confirmed by its own role (stock availability / KR balance re-checked under lock); the allocation is CONFIRMED when both parts are. A confirmed part reserves
 * stock / poles at once. A change to a confirmed allocation = cancel + new version; material/poles that arrive later = a top-up allocation (parent_allocation_id) beside the confirmed base. Callers authorize the actor for the part first.
 */
class AllocationService
{
    public function __construct(private readonly StockService $stock, private readonly PoleContractService $poles) {}

    public function create(string $applicationId, ?string $notes, User $actor): string
    {
        return DB::transaction(function () use ($applicationId, $notes, $actor): string {
            DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $pkg = DB::table('mto_packages')->where('application_id', $applicationId)->where('status', 'APPROVED')->orderByDesc('created_at')->first()
                ?? throw new AssignmentRuleViolation('Permohonan belum memiliki paket MTO yang disetujui; alokasi belum dapat dibuat.');
            $open = DB::table('allocations')->where('application_id', $applicationId)->whereIn('status', ['DRAFT', 'CONFIRMED'])->get();
            if ($open->contains('status', 'DRAFT')) {
                throw new AssignmentRuleViolation('Permohonan masih memiliki alokasi berstatus DRAFT; konfirmasi atau batalkan dulu.');
            }
            // A confirmed base allocation stays; what arrives later is a top-up (alokasi tambahan) linked to it.
            $base = $open->first(fn ($a) => $a->parent_allocation_id === null && $a->status === 'CONFIRMED');
            $id = (string) Str::uuid();
            DB::table('allocations')->insert(['id' => $id, 'application_id' => $applicationId, 'mto_package_id' => $base->mto_package_id ?? $pkg->id, 'parent_allocation_id' => $base->id ?? null,
                'version_number' => ((int) DB::table('allocations')->where('application_id', $applicationId)->max('version_number')) + 1,
                'status' => 'DRAFT', 'notes' => $notes, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);

            return $id;
        });
    }

    /** Material already allocated by the OTHER confirmed (not cancelled) allocations of the application — the base and earlier top-ups — per KHS item. @return array<string,float> */
    private function heldByOthers(string $applicationId, string $exceptId): array
    {
        $held = DB::table('allocation_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->where('a.application_id', $applicationId)->where('a.id', '<>', $exceptId)
            ->whereNotNull('a.materials_confirmed_at')->where('a.status', '<>', 'CANCELLED')->selectRaw('l.khs_item_id, sum(l.quantity) q')->groupBy('l.khs_item_id')->pluck('q', 'khs_item_id')->map(fn ($q) => (float) $q)->all();
        // APP material already reserved when the 1-phase connection started (docs/95) is not allocated again
        foreach (SrReservationService::reservedFor($applicationId) as $item => $q) {
            $held[$item] = ($held[$item] ?? 0.0) + $q;
        }

        return $held;
    }

    /** @param list<array{khs_code:string,warehouse_id:string,quantity:numeric}> $materials */
    public function putMaterials(string $allocationId, array $materials, ?string $notes): void
    {
        DB::transaction(function () use ($allocationId, $materials, $notes): void {
            $a = $this->lock($allocationId);
            $this->requireOpenPart($a, 'materials_confirmed_at', 'material');
            $need = DB::table('mto_lines')->where('package_id', $a->mto_package_id)->selectRaw('khs_item_id, khs_code, sum(material) q')->groupBy('khs_item_id', 'khs_code')->get()->keyBy('khs_code');
            $errs = [];
            $mat = [];
            $materials = array_values(array_filter($materials, fn ($m) => (float) $m['quantity'] > 0));   // a 0 row = "not allocated" (stock short): nothing to store
            foreach ($materials as $m) {
                $n = $need[$m['khs_code']] ?? null;
                if ($n === null) {
                    $errs[] = "KHS {$m['khs_code']} tidak ada pada MTO yang disetujui.";

                    continue;
                }
                $key = $n->khs_item_id.'|'.$m['warehouse_id'];
                if (isset($mat[$key])) {
                    $errs[] = "KHS {$m['khs_code']} pada gudang yang sama muncul lebih dari sekali.";
                }
                $mat[$key] = ['khs_item_id' => $n->khs_item_id, 'khs_code' => $m['khs_code'], 'warehouse_id' => $m['warehouse_id'], 'quantity' => (float) $m['quantity']];
            }
            $supplier = $this->suppliers($a->mto_package_id, array_column($mat, 'khs_item_id'));
            foreach ($mat as $row) {
                if (($supplier[$row['khs_item_id']] ?? null) === 'VENDOR') {
                    $errs[] = "KHS {$row['khs_code']} disediakan vendor (SPK), bukan material PLN; tidak dialokasikan dari gudang.";
                }
            }
            $perKhs = [];
            foreach ($mat as $row) {
                $perKhs[$row['khs_code']] = ($perKhs[$row['khs_code']] ?? 0) + $row['quantity'];
            }
            $others = $this->heldByOthers($a->application_id, $allocationId);
            foreach ($perKhs as $code => $q) {
                $before = $others[$need[$code]->khs_item_id] ?? 0.0;
                if ($q + $before > (float) $need[$code]->q + 1e-9) {
                    $errs[] = "KHS {$code}: alokasi {$q}".($before > 0 ? " + {$before} yang sudah dialokasikan" : '')." melebihi kebutuhan MTO {$need[$code]->q}.";
                }
            }
            $wh = DB::table('warehouses')->whereIn('id', array_unique(array_column($materials, 'warehouse_id')))->get()->keyBy('id');
            foreach ($materials as $m) {
                if (! isset($wh[$m['warehouse_id']]) || ! $wh[$m['warehouse_id']]->is_active) {
                    $errs[] = 'Gudang '.$m['warehouse_id'].' tidak ditemukan atau tidak aktif.';
                }
            }
            if ($errs !== []) {
                throw new AssignmentRuleViolation(implode(' ', array_unique($errs)));
            }
            DB::table('allocation_lines')->where('allocation_id', $allocationId)->delete();
            foreach ($mat as $row) {
                DB::table('allocation_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $allocationId, 'khs_item_id' => $row['khs_item_id'], 'warehouse_id' => $row['warehouse_id'], 'quantity' => $row['quantity']]);
            }
            DB::table('allocations')->where('id', $allocationId)->update(['notes' => $notes ?? $a->notes, 'updated_at' => now()]);
        });
    }

    /**
     * Who supplies each material (see MaterialSupplier): PLN from a warehouse, or VENDOR under the SPK.
     *
     * @param  list<string>  $khsIds
     * @return array<string,'PLN'|'VENDOR'>
     */
    public function suppliers(string $packageId, array $khsIds): array
    {
        return MaterialSupplier::of($packageId, $khsIds);
    }

    /**
     * PLN materials (not poles, not vendor-supplied) of the approved MTO that no confirmed allocation covers yet — the base allocation and its top-ups together. Used as a warning on the
     * network WO (it never blocks: the work does not wait for the last material).
     *
     * @return list<array{khs_code:string,khs_name:string,unit_text:?string,need:float,allocated:float,remaining:float}>
     */
    public function shortfall(string $applicationId): array
    {
        $pkg = DB::table('mto_packages')->where('application_id', $applicationId)->where('status', 'APPROVED')->orderByDesc('created_at')->first();
        if ($pkg === null) {
            return [];
        }
        $need = DB::table('mto_lines')->where('package_id', $pkg->id)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")
            ->selectRaw('khs_item_id, khs_code, min(khs_name) as khs_name, min(unit_text) as unit_text, sum(material) q')->groupBy('khs_item_id', 'khs_code')->orderBy('khs_code')->get();
        $supplier = $this->suppliers($pkg->id, $need->pluck('khs_item_id')->all());
        $held = DB::table('allocation_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->where('a.application_id', $applicationId)->whereNotNull('a.materials_confirmed_at')->where('a.status', '<>', 'CANCELLED')
            ->selectRaw('l.khs_item_id, sum(l.quantity) q')->groupBy('l.khs_item_id')->pluck('q', 'khs_item_id');
        $reserved = SrReservationService::reservedFor($applicationId);
        $out = [];
        foreach ($need as $n) {
            if (($supplier[$n->khs_item_id] ?? null) === 'VENDOR') {
                continue;
            }
            $allocated = (float) ($held[$n->khs_item_id] ?? 0) + ($reserved[$n->khs_item_id] ?? 0.0);
            $remaining = round((float) $n->q - $allocated, 3);
            if ($remaining > 1e-9) {
                $out[] = ['khs_code' => $n->khs_code, 'khs_name' => $n->khs_name, 'unit_text' => $n->unit_text, 'need' => (float) $n->q, 'allocated' => $allocated, 'remaining' => $remaining];
            }
        }

        return $out;
    }

    /** Source levels the owner lets the user choose (UP3 or ULP) for the SR/APP 1 phase materials (BOM group SR1PH). */
    public const SOURCE_CHOICE_GROUPS = ['SR1PH'];

    /**
     * What to allocate: the approved MTO needs except concrete poles (poles are the Perencanaan part), minus what the draft already holds, with the stock of the
     * application's ULP warehouse and its UP3 warehouse. Suggestion rule (owner 2026-11-12): full quantity when one warehouse covers the whole need (ULP first, then UP3),
     * otherwise 0 (nothing partial). SR APP 1 phase materials are flagged `source_choice` so the user picks UP3 or ULP.
     *
     * @return array{warehouses:list<array<string,mixed>>,rows:list<array<string,mixed>>}
     */
    public function materialSuggestions(string $allocationId): array
    {
        $a = DB::table('allocations')->where('id', $allocationId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $app = DB::table('applications')->where('id', $a->application_id)->first();
        $unit = DB::table('organizational_units')->where('id', $app->organizational_unit_id)->first();
        $up3Id = $unit->unit_type === 'UP3' ? $unit->id : $unit->parent_id;
        $wh = DB::table('warehouses as w')->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')->where('w.is_active', true)
            ->whereIn('w.organizational_unit_id', array_filter([$unit->id, $up3Id]))->orderBy('w.code')->get(['w.id', 'w.code', 'w.name', 'u.unit_type as level']);
        $today = now(config('distriva.business_timezone'))->toDateString();
        $pos = [];
        foreach ($wh as $w) {
            $pos[$w->id] = $this->stock->position([$w->id], $today);
        }
        $held = DB::table('allocation_lines')->where('allocation_id', $allocationId)->selectRaw('khs_item_id, sum(quantity) q')->groupBy('khs_item_id')->pluck('q', 'khs_item_id')->map(fn ($q) => (float) $q)->all();
        foreach ($this->heldByOthers($a->application_id, $allocationId) as $item => $q) {
            $held[$item] = ($held[$item] ?? 0.0) + $q;   // the base and earlier top-ups count as already allocated
        }
        $groups = DB::table('mto_lines')->where('package_id', $a->mto_package_id)->where('material', '>', 0)->get(['khs_item_id', 'group_code'])->groupBy('khs_item_id');
        $need = DB::table('mto_lines')->where('package_id', $a->mto_package_id)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")
            ->selectRaw('khs_item_id, khs_code, min(khs_name) as khs_name, min(unit_text) as unit_text, sum(material) q')->groupBy('khs_item_id', 'khs_code')->orderBy('khs_code')->get();
        $supplier = $this->suppliers($a->mto_package_id, $need->pluck('khs_item_id')->all());
        $rows = [];
        foreach ($need as $n) {
            $vendor = ($supplier[$n->khs_item_id] ?? null) === 'VENDOR';
            $remaining = max(0.0, (float) $n->q - (float) ($held[$n->khs_item_id] ?? 0));
            $cands = [];
            foreach ($wh as $w) {
                $cands[] = ['warehouse_id' => $w->id, 'warehouse_code' => $w->code, 'warehouse_name' => $w->name, 'level' => $w->level, 'available' => max(0.0, (float) ($pos[$w->id][$n->khs_item_id]['available'] ?? 0))];
            }
            $pick = null;
            foreach (['ULP', 'UP3'] as $level) {
                $best = collect($cands)->where('level', $level)->sortByDesc('available')->first();
                if ($best !== null && $remaining > 0 && $remaining <= $best['available'] + 1e-9) {
                    $pick = $best;
                    break;
                }
            }
            $fallback = collect($cands)->where('level', 'ULP')->first() ?? collect($cands)->first();
            $choice = ($pick ?? $fallback);
            $rows[] = ['khs_code' => $n->khs_code, 'khs_name' => $n->khs_name, 'unit_text' => $n->unit_text, 'need' => (float) $n->q, 'allocated' => (float) ($held[$n->khs_item_id] ?? 0), 'remaining' => $remaining,
                'supplier' => $supplier[$n->khs_item_id] ?? null,
                'source_choice' => ! $vendor && $groups->has($n->khs_item_id) && $groups[$n->khs_item_id]->pluck('group_code')->intersect(self::SOURCE_CHOICE_GROUPS)->isNotEmpty(),
                'candidates' => $vendor ? [] : $cands, 'suggestion' => $vendor || $choice === null ? null : ['warehouse_id' => $choice['warehouse_id'], 'level' => $choice['level'], 'quantity' => $pick !== null ? $remaining : 0.0, 'covered' => $pick !== null]];
        }

        return ['warehouses' => $wh->map(fn ($w) => (array) $w)->all(), 'rows' => $rows];
    }

    /** @param list<array{pole_contract_id:string,pole_type:string,quantity:int,khs_item_id?:?string,warehouse_id?:?string}> $poles */
    public function putPoles(string $allocationId, array $poles): void
    {
        DB::transaction(function () use ($allocationId, $poles): void {
            $a = $this->lock($allocationId);
            $this->requireOpenPart($a, 'poles_confirmed_at', 'tiang');
            $errs = [];
            $seen = [];
            foreach ($poles as $p) {
                $kr = DB::table('pole_contracts')->where('id', $p['pole_contract_id'])->first();
                if ($kr === null || $kr->status !== 'ACTIVE') {
                    $errs[] = 'Kontrak Rinci '.$p['pole_contract_id'].' tidak ditemukan atau sudah ditutup.';
                }
                $krLines = $kr === null ? collect() : DB::table('pole_contract_lines')->where('pole_contract_id', $kr->id)->get()->keyBy('khs_item_id');
                $khs = $p['khs_item_id'] ?? null;
                if ($krLines->isNotEmpty() && $khs === null) {
                    $errs[] = "Kontrak Rinci {$kr?->kr_number} memiliki baris material tiang: pilih material tiang yang diplot.";
                } elseif ($khs !== null && ($krLines[$khs] ?? null) === null) {
                    $errs[] = "Material tiang tidak terdaftar pada Kontrak Rinci {$kr?->kr_number}.";
                } elseif ($khs !== null && $krLines[$khs]->pole_type !== $p['pole_type']) {
                    $errs[] = "Material tiang pada Kontrak Rinci {$kr?->kr_number} bertipe {$krLines[$khs]->pole_type}, bukan {$p['pole_type']}.";
                }
                if (($p['warehouse_id'] ?? null) !== null && ! DB::table('warehouses')->where('id', $p['warehouse_id'])->where('is_active', true)->exists()) {
                    $errs[] = 'Gudang keterangan tiang tidak ditemukan atau tidak aktif.';
                }
                $k = $p['pole_contract_id'].'|'.$p['pole_type'].'|'.($khs ?? '');
                if (isset($seen[$k])) {
                    $errs[] = "Kontrak Rinci {$kr?->kr_number} tiang {$p['pole_type']} muncul lebih dari sekali.";
                }
                $seen[$k] = true;
            }
            if ($errs !== []) {
                throw new AssignmentRuleViolation(implode(' ', array_unique($errs)));
            }
            DB::table('allocation_pole_lines')->where('allocation_id', $allocationId)->delete();
            foreach ($poles as $p) {
                DB::table('allocation_pole_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $allocationId, 'pole_contract_id' => $p['pole_contract_id'], 'pole_type' => $p['pole_type'], 'quantity' => (int) $p['quantity'], 'khs_item_id' => $p['khs_item_id'] ?? null, 'warehouse_id' => $p['warehouse_id'] ?? null]);
            }
            DB::table('allocations')->where('id', $allocationId)->update(['updated_at' => now()]);
        });
    }

    /** @param 'materials'|'poles' $part */
    public function confirmPart(string $allocationId, string $part, User $actor, bool $acceptDebt = false): void
    {
        try {
            DB::transaction(function () use ($allocationId, $part, $actor, $acceptDebt): void {
                $a = $this->lock($allocationId);
                $col = $part === 'materials' ? 'materials_confirmed' : 'poles_confirmed';
                $this->requireOpenPart($a, $col.'_at', $part === 'materials' ? 'material' : 'tiang');
                $errs = $part === 'materials' ? $this->checkMaterials($allocationId) : $this->checkPoles($allocationId, $acceptDebt);
                if ($errs !== []) {
                    throw new AssignmentRuleViolation(implode(' ', $errs));
                }
                $set = [$col.'_by' => $actor->getKey(), $col.'_at' => now(), 'updated_at' => now()];
                $otherDone = $part === 'materials' ? $a->poles_confirmed_at !== null : $a->materials_confirmed_at !== null;
                if ($otherDone) {
                    $total = DB::table('allocation_lines')->where('allocation_id', $allocationId)->count() + DB::table('allocation_pole_lines')->where('allocation_id', $allocationId)->count();
                    if ($total === 0) {
                        throw new AssignmentRuleViolation('Alokasi belum memiliki baris material maupun tiang.');
                    }
                    $set += ['status' => 'CONFIRMED', 'confirmed_by' => $actor->getKey(), 'confirmed_at' => now()];
                }
                DB::table('allocations')->where('id', $allocationId)->update($set);
                MaterialOutbox::refresh($a->application_id);   // newly confirmed material may be ready for the outbox
            });
        } catch (QueryException $e) {
            throw $e->getCode() === 'P0001' ? new AssignmentRuleViolation('Perubahan melanggar aturan integritas alokasi.', 0, $e) : $e;
        }
    }

    public function cancel(string $allocationId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($allocationId, $reason, $actor): void {
            $a = $this->lock($allocationId);
            if (! in_array($a->status, ['DRAFT', 'CONFIRMED'], true)) {
                throw new AssignmentRuleViolation('Alokasi sudah dibatalkan.');
            }
            $cancel = ['status' => 'CANCELLED', 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => trim($reason), 'updated_at' => now()];
            DB::table('allocations')->where('id', $allocationId)->update($cancel);
            // Cancelling a base allocation also cancels its running top-ups (they have nothing to stand on).
            DB::table('allocations')->where('parent_allocation_id', $allocationId)->whereIn('status', ['DRAFT', 'CONFIRMED'])->update($cancel);
            MaterialOutbox::refresh($a->application_id);
        });
    }

    /** @return list<string> */
    private function checkMaterials(string $allocationId): array
    {
        $lines = DB::table('allocation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.allocation_id', $allocationId)->get(['l.khs_item_id', 'l.warehouse_id', 'l.quantity', 'k.code']);
        $errs = [];
        $today = now(config('distriva.business_timezone'))->toDateString();
        foreach ($lines->groupBy('warehouse_id') as $wid => $ls) {
            $pos = $this->stock->position([(string) $wid], $today);
            foreach ($ls as $l) {
                $avail = $pos[$l->khs_item_id]['available'] ?? 0.0;
                if ((float) $l->quantity > $avail + 1e-9) {
                    $errs[] = "KHS {$l->code}: alokasi {$l->quantity} melebihi stok tersedia {$avail} di gudang.";
                }
            }
        }

        return $errs;
    }

    /**
     * KR must be ACTIVE. A quantity above the KR balance is allowed as a work debt ("utang kerja", owner 12 Nov 2026: the vendor works beyond the quota and a later KR pays it) but only when the
     * confirmer accepts it explicitly; the balance then shows negative on the KR.
     *
     * @return list<string>
     */
    private function checkPoles(string $allocationId, bool $acceptDebt = false): array
    {
        $errs = [];
        $debts = $this->poleDebts($allocationId, true);
        foreach (DB::table('allocation_pole_lines')->where('allocation_id', $allocationId)->get()->pluck('pole_contract_id')->unique() as $krId) {
            $c = DB::table('pole_contracts')->where('id', $krId)->lockForUpdate()->first();
            if ($c->status !== 'ACTIVE') {
                $errs[] = "KR {$c->kr_number} sudah ditutup.";
            }
        }
        if (! $acceptDebt) {
            foreach (DB::table('allocation_pole_lines')->where('allocation_id', $allocationId)->whereNotNull('khs_item_id')->get() as $p) {
                $line = DB::table('pole_contract_lines')->where('pole_contract_id', $p->pole_contract_id)->where('khs_item_id', $p->khs_item_id)->first();
                $left = (int) ($line->quantity ?? 0) - (int) ($this->poles->allocatedByItem($p->pole_contract_id)[$p->khs_item_id] ?? 0);
                if ((int) $p->quantity > $left) {
                    $kr = DB::table('pole_contracts')->where('id', $p->pole_contract_id)->value('kr_number');
                    $errs[] = "KR {$kr} material tiang: butuh {$p->quantity}, sisa {$left}; kelebihan menjadi utang kerja dan harus disetujui.";
                }
            }
        }
        if ($debts !== [] && ! $acceptDebt) {
            foreach ($debts as $d) {
                $errs[] = "KR {$d['kr_number']} tiang {$d['pole_type']}: butuh {$d['quantity']}, sisa {$d['remaining']}; kelebihan {$d['over']} menjadi utang kerja dan harus disetujui.";
            }
        }

        return $errs;
    }

    /**
     * Per KR and pole type of this allocation: the quantity against the balance left (the balance of the KR excluding this allocation's own confirmed lines), and what exceeds it.
     *
     * @return list<array{kr_number:string,pole_type:string,quantity:int,remaining:int,over:int}>
     */
    public function poleDebts(string $allocationId, bool $forConfirm = false): array
    {
        $a = DB::table('allocations')->where('id', $allocationId)->first();
        $own = $a !== null && $a->poles_confirmed_at !== null && ! $forConfirm;
        $out = [];
        $groups = DB::table('allocation_pole_lines')->where('allocation_id', $allocationId)->selectRaw('pole_contract_id, pole_type, sum(quantity) q')->groupBy('pole_contract_id', 'pole_type')->get();
        foreach ($groups as $g) {
            $c = DB::table('pole_contracts')->where('id', $g->pole_contract_id)->first();
            $total = (int) ($g->pole_type === 'TM' ? $c->qty_tm : $c->qty_tr);
            $used = $this->poles->allocated($c->id)[$g->pole_type] - ($own ? (int) $g->q : 0);
            $remaining = $total - $used;
            $over = max(0, (int) $g->q - max(0, $remaining));
            if ($over > 0) {
                $out[] = ['kr_number' => $c->kr_number, 'pole_type' => $g->pole_type, 'quantity' => (int) $g->q, 'remaining' => $remaining, 'over' => $over];
            }
        }

        return $out;
    }

    private function requireOpenPart(object $a, string $confirmedColumn, string $label): void
    {
        if ($a->status !== 'DRAFT' || $a->{$confirmedColumn} !== null) {
            throw new AssignmentRuleViolation("Bagian {$label} alokasi ini sudah dikonfirmasi atau alokasi tidak lagi DRAFT; batalkan untuk membuat versi baru.");
        }
    }

    private function lock(string $id): object
    {
        return DB::table('allocations')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
