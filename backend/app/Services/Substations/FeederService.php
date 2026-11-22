<?php

namespace App\Services\Substations;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Master penyulang (owner 2026-11-12). One managing unit (UP3 or ULP) owns a feeder; the ULPs it serves come from its gardu. A feeder is seen by the owner's scope and by every unit that has a gardu on it;
 * it is changed only by a unit that owns it (or SYS_ADMIN). Every change keeps its reason in distribution_feeder_changes. Gardu import creates a feeder that does not exist yet (owner = the UP3 above the gardu's ULP).
 */
class FeederService
{
    /** Units whose feeders the actor sees: the scope's ULPs, their UP3 parents. @param array{unrestricted: bool, units: list<string>} $scope @return list<string> */
    private function ownerUnits(array $scope): array
    {
        return array_values(array_unique(array_merge($scope['units'], DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->all())));
    }

    /**
     * Marks a scope as ULP-only when the actor holds no assignment above a ULP. The scope itself cannot tell: for a UP3 assignment `units` lists the ULPs below it, never the UP3,
     * so a UP3 actor and a ULP actor look alike there. A scope without the mark keeps the wider rule (owners and their parents).
     *
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array{unrestricted: bool, units: list<string>, ulp_only: bool}
     */
    public function withLevel(array $scope, User $actor): array
    {
        $upper = ! $scope['unrestricted'] && app(ApplicationAuthorizer::class)->effectiveAssignments($actor)
            ->contains(fn ($a) => $a->role?->name !== 'VENDOR' && $a->organizationalUnit !== null && $a->organizationalUnit->unit_type !== 'ULP');

        return $scope + ['ulp_only' => ! $scope['unrestricted'] && ! $upper];
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope */
    private function visible($q, array $scope): void
    {
        if ($scope['unrestricted']) {
            return;
        }
        if (($scope['ulp_only'] ?? false) === true) {
            // Role ULP: hanya melihat penyulang yang ada di ULP tersebut (melayani atau dimiliki ULP)
            $q->where(fn ($w) => $w->whereIn('f.owner_unit_id', $scope['units'])
                ->orWhereExists(fn ($e) => $e->select(DB::raw(1))->from('substations as s')->whereColumn('s.feeder_id', 'f.id')->whereIn('s.organizational_unit_id', $scope['units']))
            );

            return;
        }
        $owners = $this->ownerUnits($scope);
        $q->where(fn ($w) => $w->whereIn('f.owner_unit_id', $owners)->orWhereExists(fn ($e) => $e->select(DB::raw(1))->from('substations as s')->whereColumn('s.feeder_id', 'f.id')->whereIn('s.organizational_unit_id', $scope['units'])));
    }

    /** @param array<string,mixed> $f @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function search(array $f, array $scope): array
    {
        $q = DB::table('distribution_feeders as f')->join('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')->select('f.*', 'u.name as owner_unit_name', 'u.code as owner_unit_code',
            DB::raw('(select count(*) from substations s where s.feeder_id = f.id) as substation_count'), DB::raw('(select coalesce(sum(s.capacity_kva), 0) from substations s where s.feeder_id = f.id) as capacity_kva'));
        $this->visible($q, $scope);
        if (! empty($f['q'])) {
            $like = '%'.mb_strtolower(trim((string) $f['q'])).'%';
            $q->where(fn ($w) => $w->whereRaw('lower(f.code) like ?', [$like])
                ->orWhereRaw('lower(coalesce(f.name, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(f.gi_code, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(f.gi_name, \'\')) like ?', [$like]));
        }
        foreach (['owner_unit_id' => 'f.owner_unit_id', 'gi_code' => 'f.gi_code', 'status' => 'f.status'] as $k => $col) {
            ! empty($f[$k]) && $q->where($col, $f[$k]);
        }
        if (! empty($f['up3_id'])) {
            $ulpIds = DB::table('organizational_units')->where('parent_id', $f['up3_id'])->pluck('id')->all();
            $targetUnits = array_merge([$f['up3_id']], $ulpIds);
            $q->where(fn ($w) => $w->whereIn('f.owner_unit_id', $targetUnits)
                ->orWhereExists(fn ($e) => $e->select(DB::raw(1))->from('substations as s')->whereColumn('s.feeder_id', 'f.id')->whereIn('s.organizational_unit_id', $targetUnits))
            );
        }
        if (! empty($f['serves_unit_id'])) {
            $q->where(fn ($w) => $w->where('f.owner_unit_id', $f['serves_unit_id'])
                ->orWhereExists(fn ($e) => $e->select(DB::raw(1))->from('substations as s')->whereColumn('s.feeder_id', 'f.id')->where('s.organizational_unit_id', $f['serves_unit_id']))
            );
        }
        $page = $q->orderBy('f.code')->paginate(max(1, min((int) ($f['per_page'] ?? 25), 1000)));

        $ids = collect($page->items())->pluck('id')->all();
        $served = $ids === [] ? collect() : DB::table('substations as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->whereIn('s.feeder_id', $ids)->groupBy('s.feeder_id', 'u.id', 'u.code', 'u.name')
            ->orderBy('u.name')->get(['s.feeder_id', 'u.id', 'u.code', 'u.name', DB::raw('count(*) as substation_count')])->groupBy('feeder_id');

        return ['data' => collect($page->items())->map(fn ($r) => $this->present($r) + ['served_units' => ($served[$r->id] ?? collect())->map(fn ($u) => ['id' => $u->id, 'code' => $u->code, 'name' => $u->name, 'substation_count' => (int) $u->substation_count])->values()->all()])->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]];
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function show(string $id, array $scope): array
    {
        $r = $this->find($id, $scope, true);
        $served = DB::table('substations as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->where('s.feeder_id', $id)->groupBy('u.id', 'u.code', 'u.name')->orderBy('u.code')
            ->get(['u.id', 'u.code', 'u.name', DB::raw('count(*) as substation_count'), DB::raw('coalesce(sum(s.capacity_kva), 0) as capacity_kva')]);
        // loading of the feeder = the latest kVA load of its gardu over their capacity, over the gardu that have a kVA reading (the coverage is reported, never assumed).
        $load = DB::selectOne('select count(*) filter (where lr.load_kva is not null) as measured, coalesce(sum(lr.load_kva), 0) as load_kva, coalesce(sum(s.capacity_kva) filter (where lr.load_kva is not null), 0) as capacity_kva
            from substations s left join lateral (select load_kva from substation_readings where substation_id = s.id and load_kva is not null order by measured_on desc, measured_at desc nulls last, created_at desc limit 1) lr on true where s.feeder_id = ?', [$id]);
        $history = DB::table('distribution_feeder_changes as c')->leftJoin('users as u', 'u.id', '=', 'c.changed_by')->where('c.feeder_id', $id)->orderByDesc('c.seq')->limit(20)
            ->get(['c.action', 'c.reason', 'c.before', 'c.after', 'c.created_at', 'u.name as changed_by_name'])->map(fn ($h) => ['action' => $h->action, 'reason' => $h->reason, 'before' => json_decode((string) $h->before, true), 'after' => json_decode((string) $h->after, true),
                'created_at' => $h->created_at, 'changed_by_name' => $h->changed_by_name])->all();

        return ['feeder' => $this->present($r), 'customers' => app(ConnectionService::class)->summary('feeder', $id), 'served_units' => $served->map(fn ($s) => ['id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'substation_count' => (int) $s->substation_count, 'capacity_kva' => (float) $s->capacity_kva])->all(),
            'loading' => ['measured_substations' => (int) $load->measured, 'load_kva' => round((float) $load->load_kva, 2), 'capacity_kva' => (float) $load->capacity_kva,
                'loading_pct' => (float) $load->capacity_kva > 0 ? round((float) $load->load_kva / (float) $load->capacity_kva * 100, 1) : null], 'history' => $history];
    }

    /** @param array<string,mixed> $in @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function create(array $in, array $scope, User $actor): array
    {
        $code = mb_strtoupper(trim((string) $in['code']));
        if (DB::table('distribution_feeders')->where('code', $code)->exists()) {
            throw new AssignmentRuleViolation("Penyulang {$code} sudah ada.");
        }
        $this->assertOwnerInScope((string) $in['owner_unit_id'], $scope);
        $id = (string) Str::uuid();
        $row = ['code' => $code, 'name' => $in['name'] ?? null, 'gi_code' => $in['gi_code'] ?? null, 'gi_name' => $in['gi_name'] ?? null, 'gi_transformer_no' => $in['gi_transformer_no'] ?? null, 'owner_unit_id' => $in['owner_unit_id'], 'notes' => $in['notes'] ?? null];
        DB::transaction(function () use ($id, $row, $actor, $in): void {
            DB::table('distribution_feeders')->insert(['id' => $id, 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()] + $row);
            $this->log($id, 'CREATED', (string) $in['reason'], null, $row, $actor->getKey());
        });

        return $this->show($id, $scope);
    }

    /** @param array<string,mixed> $in @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function update(string $id, array $in, array $scope, User $actor): array
    {
        $cur = $this->find($id, $scope, false);
        $set = array_intersect_key($in, array_flip(['name', 'gi_code', 'gi_name', 'gi_transformer_no', 'owner_unit_id', 'status', 'notes']));
        if (isset($set['owner_unit_id'])) {
            $this->assertOwnerInScope($set['owner_unit_id'], $scope);
        }
        $before = array_intersect_key((array) $cur, $set);
        $set = array_filter($set, fn ($v, $k) => (string) ($before[$k] ?? '') !== (string) ($v ?? ''), ARRAY_FILTER_USE_BOTH);
        if ($set === []) {
            throw new AssignmentRuleViolation('Tidak ada perubahan.');
        }
        DB::transaction(function () use ($id, $set, $before, $in, $actor): void {
            DB::table('distribution_feeders')->where('id', $id)->update($set + ['updated_at' => now()]);
            $this->log($id, 'UPDATED', (string) $in['reason'], array_intersect_key($before, $set), $set, $actor->getKey());
        });

        return $this->show($id, $scope);
    }

    /**
     * The feeder of a gardu by its code; created (owner = the UP3 above the unit) when it does not exist yet. Used by the gardu import and by the correction of a gardu's feeder code.
     */
    public function resolve(?string $code, ?string $giCode, string $unitId, ?string $actorId, string $reason): ?string
    {
        $code = $code === null ? '' : mb_strtoupper(trim($code));
        if ($code === '') {
            return null;
        }
        $id = DB::table('distribution_feeders')->where('code', $code)->value('id');
        if ($id !== null) {
            return $id;
        }
        $owner = DB::table('organizational_units')->where('id', $unitId)->value('parent_id') ?? $unitId;
        $id = (string) Str::uuid();
        DB::table('distribution_feeders')->insert(['id' => $id, 'code' => $code, 'gi_code' => $giCode, 'owner_unit_id' => $owner, 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);
        $this->log($id, 'AUTO', $reason, null, ['code' => $code, 'gi_code' => $giCode, 'owner_unit_id' => $owner], $actorId);

        return $id;
    }

    /**
     * A feeder formed from the OMT measurement files (docs/83): the OMT gives only the feeder NAME. The code is abbreviated from it (first letter + the next consonants, 5 characters, unique) and should be corrected to the
     * Maximo code when it differs. Owner = the UP3 above the ULP, as for every automatically formed feeder.
     */
    public function createFromName(string $name, string $unitId, ?string $actorId): array
    {
        $letters = preg_replace('/[^A-Z0-9]/', '', mb_strtoupper($name)) ?? '';
        $code = substr($letters[0].preg_replace('/[AEIOU0-9]/', '', substr($letters, 1)), 0, 5);
        $code = str_pad($code, 3, 'X');
        for ($i = 2; DB::table('distribution_feeders')->where('code', $code)->exists(); $i++) {
            $code = substr($code, 0, 4).$i;
        }
        $owner = DB::table('organizational_units')->where('id', $unitId)->value('parent_id') ?? $unitId;
        $id = (string) Str::uuid();
        DB::table('distribution_feeders')->insert(['id' => $id, 'code' => $code, 'name' => mb_substr(trim($name), 0, 120), 'owner_unit_id' => $owner, 'status' => 'AKTIF', 'notes' => 'Dibentuk dari data pengukuran OMT; kode disingkat otomatis, koreksi bila berbeda dari kode Maximo.', 'created_at' => now(), 'updated_at' => now()]);
        $this->log($id, 'AUTO', 'Dibentuk dari data pengukuran gardu OMT (docs/83).', null, ['code' => $code, 'name' => $name, 'owner_unit_id' => $owner], $actorId);

        return ['id' => $id, 'code' => $code];
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope */
    private function find(string $id, array $scope, bool $forRead): object
    {
        $q = DB::table('distribution_feeders as f')->join('organizational_units as u', 'u.id', '=', 'f.owner_unit_id')->where('f.id', $id)
            ->select('f.*', 'u.name as owner_unit_name', 'u.code as owner_unit_code', DB::raw('(select count(*) from substations s where s.feeder_id = f.id) as substation_count'), DB::raw('(select coalesce(sum(s.capacity_kva), 0) from substations s where s.feeder_id = f.id) as capacity_kva'));
        $forRead ? $this->visible($q, $scope) : (! $scope['unrestricted'] && $q->whereIn('f.owner_unit_id', $this->ownerUnits($scope)));

        return $q->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** The owner must be an active UP3 / ULP the actor acts in (a UP3 counts when the actor holds one of its ULPs). @param array{unrestricted: bool, units: list<string>} $scope */
    private function assertOwnerInScope(string $unitId, array $scope): void
    {
        $unit = DB::table('organizational_units')->where('id', $unitId)->where('is_active', true)->whereIn('unit_type', ['UP3', 'ULP'])->first();
        if ($unit === null) {
            throw new AssignmentRuleViolation('Unit pemilik harus UP3 atau ULP yang aktif.');
        }
        if (! $scope['unrestricted'] && ! in_array($unitId, $this->ownerUnits($scope), true)) {
            throw new AssignmentRuleViolation('Unit pemilik di luar cakupan Anda.');
        }
    }

    /** @param array<string,mixed>|null $before @param array<string,mixed> $after */
    private function log(string $id, string $action, string $reason, ?array $before, array $after, ?string $actorId): void
    {
        DB::table('distribution_feeder_changes')->insert(['id' => (string) Str::uuid(), 'feeder_id' => $id, 'changed_by' => $actorId, 'action' => $action, 'reason' => $reason, 'before' => $before === null ? null : json_encode($before), 'after' => json_encode($after), 'created_at' => now()]);
    }

    /** @return array<string,mixed> */
    private function present(object $r): array
    {
        return ['id' => $r->id, 'code' => $r->code, 'name' => $r->name, 'gi_code' => $r->gi_code, 'gi_name' => $r->gi_name ?? null, 'gi_transformer_no' => $r->gi_transformer_no, 'owner_unit_id' => $r->owner_unit_id, 'owner_unit_name' => $r->owner_unit_name ?? null,
            'owner_unit_code' => $r->owner_unit_code ?? null, 'status' => $r->status, 'notes' => $r->notes, 'substation_count' => (int) ($r->substation_count ?? 0), 'capacity_kva' => (float) ($r->capacity_kva ?? 0)];
    }
}
