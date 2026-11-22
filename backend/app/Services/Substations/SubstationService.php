<?php

namespace App\Services\Substations;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Kko\KkoService;
use App\Support\EisFileReader;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Master gardu for KKO (docs/80, owner 2026-11-10).
 * - Master import goes through staging like the EIS import: every row is classified (NEW / CHANGED / UNCHANGED / REJECT), nothing is written before the confirmation.
 *   A gardu that is absent from a FULL file is only marked needs_review (never switched off by itself). A unit comes from the ULP_CODE column, else the 5-digit prefix of SSOTNUMG
 *   (Maximo), else the unit chosen for the whole file; an unknown unit or one outside the actor's scope rejects the row.
 * - A reading is operational data (loading, end voltage, phase currents, kWh). 0 means "not measured", never "no load": it is not stored. The kVA load is taken from the source,
 *   else loading % x capacity, else the phase currents x the phase-to-neutral voltage (a single unnamed current is NOT turned into kVA). Readings are append-only.
 * - Reading freshness: older than distriva.substation_reading_max_age_days (12 months) = stale. A customer-owned or inactive gardu cannot be chosen for a KKO.
 */
class SubstationService
{
    private const TYPES = ['GARDU DISTRIBUSI 2 TIANG' => 'GD2T', 'GARDU DISTRIBUSI 1 TIANG' => 'GD1T', 'GARDU BETON CUBICLE' => 'BETON', 'GARDU BETON' => 'BETON'];

    private const MASTER_FIELDS = ['asset_number', 'location_code', 'gadis_number', 'organizational_unit_id', 'feeder_code', 'gi_code', 'jtm_number', 'type_code', 'ownership', 'usage', 'name', 'area_note',
        'kabupaten', 'kecamatan', 'kelurahan', 'latitude', 'longitude', 'capacity_kva', 'transformer_count'];

    /** kVA of a reading. @param array<string,float|null> $phases r,s,t @return array{0:?float,1:?float,2:?string} [load_kva, loading_pct, basis] */
    public static function deriveLoad(?float $givenKva, ?float $pct, ?float $capacityKva, array $phases = []): array
    {
        $pct = $pct !== null && $pct > 0 ? $pct : null;
        if ($givenKva !== null && $givenKva > 0) {
            return [round($givenKva, 3), $pct ?? ($capacityKva ? round($givenKva / $capacityKva * 100, 2) : null), 'GIVEN'];
        }
        if ($pct !== null && $capacityKva) {
            return [round($capacityKva * $pct / 100, 3), $pct, 'PERCENT'];
        }
        $amps = array_sum(array_map(fn ($v) => $v !== null && $v > 0 ? $v : 0.0, $phases));
        if ($amps > 0) {
            $kva = round($amps * (float) config('distriva.substation_phase_voltage_v') / 1000, 3);

            return [$kva, $capacityKva ? round($kva / $capacityKva * 100, 2) : null, 'CURRENT'];
        }

        return [null, $pct, null];
    }

    /** @param array<string,mixed> $f filters @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function search(array $f, array $scope): array
    {
        $q = DB::table('substations as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')
            ->leftJoinLateral(DB::table('substation_readings as r')->whereColumn('r.substation_id', 's.id')->orderByDesc('r.measured_on')->orderByRaw('r.measured_at desc nulls last')->orderByDesc('r.created_at')->limit(1)
                ->select('r.id', 'r.measured_on', 'r.loading_pct', 'r.base_voltage_r_v', 'r.base_voltage_s_v', 'r.base_voltage_t_v', 'r.end_voltage_v', 'r.current_r_a', 'r.current_s_a', 'r.current_t_a'), 'lr')
            ->select('s.*', 'u.name as unit_name', 'u.code as unit_code');
        $this->limit($q, $scope);
        if (! empty($f['q'])) {
            $like = '%'.mb_strtolower(trim((string) $f['q'])).'%';
            $q->where(fn ($w) => $w->whereRaw('lower(s.code) like ?', [$like])
                ->orWhereRaw('lower(coalesce(s.name, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(s.location_code, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(s.kelurahan, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(s.kecamatan, \'\')) like ?', [$like])
                ->orWhereRaw('lower(coalesce(s.gadis_number, \'\')) like ?', [$like])
                ->orWhereExists(fn ($e) => $e->select(DB::raw(1))->from('substation_transformers as t')->whereColumn('t.substation_id', 's.id')->whereRaw('lower(coalesce(t.brand, \'\')) like ?', [$like])));
        }
        foreach (['organizational_unit_id', 'feeder_id', 'feeder_code', 'type_code', 'usage', 'ownership', 'status'] as $k) {
            if (! empty($f[$k])) {
                $q->where("s.{$k}", $f[$k]);
            }
        }
        ! empty($f['up3_id']) && $q->whereIn('s.organizational_unit_id', DB::table('organizational_units')->where('id', $f['up3_id'])->orWhere('parent_id', $f['up3_id'])->select('id'));      // a UP3 = its ULPs (and itself)
        ! empty($f['kecamatan']) && $q->whereRaw('lower(coalesce(s.kecamatan, \'\')) like ?', ['%'.mb_strtolower(trim((string) $f['kecamatan'])).'%']);
        isset($f['capacity_min']) && $q->where('s.capacity_kva', '>=', $f['capacity_min']);
        isset($f['capacity_max']) && $q->where('s.capacity_kva', '<=', $f['capacity_max']);
        isset($f['has_coordinates']) && ($f['has_coordinates'] ? $q->whereNotNull('s.latitude')->whereNotNull('s.longitude') : $q->where(fn ($w) => $w->whereNull('s.latitude')->orWhereNull('s.longitude')));
        // transformer: brand and year of manufacture (any of the gardu's transformers)
        $year = "case when t.year_made ~ '^[0-9]{4}\$' then t.year_made::int end";
        ! empty($f['brand']) && $q->whereExists(fn ($e) => $e->select(DB::raw(1))->from('substation_transformers as t')->whereColumn('t.substation_id', 's.id')->whereRaw('lower(coalesce(t.brand, \'\')) like ?', ['%'.mb_strtolower(trim((string) $f['brand'])).'%']));
        isset($f['year_from']) && $q->whereExists(fn ($e) => $e->select(DB::raw(1))->from('substation_transformers as t')->whereColumn('t.substation_id', 's.id')->whereRaw("({$year}) >= ?", [(int) $f['year_from']]));
        isset($f['year_to']) && $q->whereExists(fn ($e) => $e->select(DB::raw(1))->from('substation_transformers as t')->whereColumn('t.substation_id', 's.id')->whereRaw("({$year}) <= ?", [(int) $f['year_to']]));
        // the latest reading of each gardu (lateral join): its freshness, loading and the voltage / balance alerts
        $maxAge = (int) config('distriva.substation_reading_max_age_days');
        $cutoff = CarbonImmutable::today()->subDays($maxAge)->toDateString();
        match ($f['reading_status'] ?? null) {
            'FRESH' => $q->whereNotNull('lr.id')->where('lr.measured_on', '>=', $cutoff),
            'STALE' => $q->whereNotNull('lr.id')->where('lr.measured_on', '<', $cutoff),
            'NONE' => $q->whereNull('lr.id'),
            default => null,
        };
        isset($f['loading_min']) && $q->where('lr.loading_pct', '>=', $f['loading_min']);
        isset($f['loading_max']) && $q->where('lr.loading_pct', '<=', $f['loading_max']);
        $baseMin = 'least(lr.base_voltage_r_v, lr.base_voltage_s_v, lr.base_voltage_t_v)';
        $avg = '((lr.current_r_a + lr.current_s_a + lr.current_t_a) / 3)';
        $imb = "case when lr.current_r_a > 0 and lr.current_s_a > 0 and lr.current_t_a > 0 then (abs(lr.current_r_a - {$avg}) + abs(lr.current_s_a - {$avg}) + abs(lr.current_t_a - {$avg})) / 3 / {$avg} * 100 end";
        $nominal = (float) config('distriva.substation_nominal_voltage_v');
        $drop = "case when lr.end_voltage_v is not null then ({$nominal} - lr.end_voltage_v) / {$nominal} * 100 end";
        match ($f['alert'] ?? null) {
            'BASE_LOW' => $q->whereRaw("{$baseMin} < ?", [(float) config('distriva.substation_base_voltage_min_v')]),
            'END_LOW' => $q->whereRaw('lr.end_voltage_v < ?', [KkoService::MIN_VOLTAGE]),
            'PHASE_UNBALANCED' => $q->whereRaw("({$imb}) > ?", [(float) config('distriva.substation_imbalance_max_pct')]),
            'END_DROP' => $q->whereRaw("({$drop}) > ?", [(float) config('distriva.substation_drop_max_pct')]),
            default => null,
        };
        if (isset($f['needs_review'])) {
            $q->where('s.needs_review', (bool) $f['needs_review']);
        }
        if (! empty($f['pickable'])) {
            $q->where('s.status', 'AKTIF')->where('s.ownership', 'PLN');
        }
        if (! empty($f['near']) && preg_match('/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/', (string) $f['near'], $m)) {
            $q->whereNotNull('s.latitude')->orderByRaw('((s.latitude - ?)^2 + (s.longitude - ?)^2)', [(float) $m[1], (float) $m[2]]);
        } else {
            $sorts = ['code' => 's.code', 'name' => 's.name', 'capacity' => 's.capacity_kva', 'loading' => 'lr.loading_pct', 'measured_on' => 'lr.measured_on',
                'year' => "(select min(case when t.year_made ~ '^[0-9]{4}\$' then t.year_made::int end) from substation_transformers t where t.substation_id = s.id)"];
            $dir = ($f['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc';
            $q->orderByRaw(($sorts[$f['sort'] ?? 'code'] ?? 's.code')." {$dir} nulls last")->orderBy('s.code');
        }
        $page = $q->paginate(max(1, min((int) ($f['per_page'] ?? 25), 100)));
        $ids = collect($page->items())->pluck('id')->all();
        $latest = $this->latestReadings($ids);
        $trafos = $ids === [] ? collect() : DB::table('substation_transformers')->whereIn('substation_id', $ids)->orderBy('slot')->get()->groupBy('substation_id');
        $rows = collect($page->items())->map(fn ($r) => $this->present($r, $latest[$r->id] ?? null, $trafos[$r->id] ?? collect()))->all();

        return ['data' => $rows, 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]];
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function show(string $id, array $scope): array
    {
        $s = $this->find($id, $scope);
        $unit = DB::table('organizational_units')->where('id', $s->organizational_unit_id)->first(['name', 'code']);
        $s->unit_name = $unit->name ?? null;
        $s->unit_code = $unit->code ?? null;
        $readings = DB::table('substation_readings')->where('substation_id', $id)->orderByDesc('measured_on')->orderByRaw('measured_at desc nulls last')->orderByDesc('created_at')->limit(12)->get();
        $trafos = DB::table('substation_transformers')->where('substation_id', $id)->orderBy('slot')->get();
        $history = DB::table('substation_changes as c')->leftJoin('users as u', 'u.id', '=', 'c.changed_by')->where('c.substation_id', $id)->orderByDesc('c.seq')->limit(20)
            ->get(['c.action', 'c.reason', 'c.before', 'c.after', 'c.created_at', 'u.name as changed_by_name'])->map(fn ($h) => ['action' => $h->action, 'reason' => $h->reason, 'before' => json_decode((string) $h->before, true),
                'after' => json_decode((string) $h->after, true), 'created_at' => $h->created_at, 'changed_by_name' => $h->changed_by_name])->all();

        return ['substation' => $this->present($s, $readings->first(), $trafos), 'customers' => app(ConnectionService::class)->summary('substation', $id), 'transformers' => $trafos->all(),
            'readings' => $readings->map(fn ($r) => $this->reading($r))->all(), 'history' => $history];
    }

    /** The gardu a KKO may use: active, PLN-owned, inside the scope. Rule violation (409) otherwise. @param array{unrestricted: bool, units: list<string>} $scope */
    public function pickable(string $id, array $scope): object
    {
        $s = $this->find($id, $scope);
        if ($s->status !== 'AKTIF') {
            throw new AssignmentRuleViolation("Gardu {$s->code} tidak aktif dan tidak dapat dipilih.");
        }
        if ($s->ownership !== 'PLN') {
            throw new AssignmentRuleViolation("Gardu {$s->code} milik pelanggan dan tidak dapat dipilih untuk KKO.");
        }

        return $s;
    }

    /** Latest reading of a gardu with its freshness (null when there is none). @return array<string,mixed>|null */
    public function latestReading(string $substationId): ?array
    {
        $r = DB::table('substation_readings')->where('substation_id', $substationId)->orderByDesc('measured_on')->orderByRaw('measured_at desc nulls last')->orderByDesc('created_at')->first();

        if ($r === null) {
            return null;
        }
        $f = fn ($v) => $v === null ? null : (float) $v;
        $feeders = DB::table('substation_reading_feeders')->where('reading_id', $r->id)->orderBy('label')->get()
            ->map(fn ($x) => ['label' => $x->label, 'current_r_a' => $f($x->current_r_a), 'current_s_a' => $f($x->current_s_a), 'current_t_a' => $f($x->current_t_a)])->all();

        return $this->reading($r) + ['feeders' => $feeders];
    }

    /** One reading entered by hand (survey / planning). @param array<string,mixed> $in @return array<string,mixed> */
    public function addReading(string $id, array $in, string $source, User $actor, array $scope): array
    {
        $s = $this->find($id, $scope);

        $r = $this->storeReading($s, $in, $source, null, $actor->getKey());
        if ($r['result'] === 'skipped') {
            throw new AssignmentRuleViolation('Pembacaan tidak berisi nilai yang terukur (nilai 0 dianggap belum diukur).');
        }

        return $r;
    }

    /**
     * The daily bot: readings by gardu code, idempotent per (gardu, date, SYNC). Unknown / out-of-scope codes and empty readings are reported, never guessed.
     *
     * @param  list<array<string,mixed>>  $items
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array<string,mixed>
     */
    public function bulkReadings(array $items, array $scope, User $actor): array
    {
        $codes = array_values(array_unique(array_map(fn ($i) => (string) $i['code'], $items)));
        $subs = DB::table('substations')->whereIn('code', $codes)->get()->keyBy('code');
        $counts = ['stored' => 0, 'unchanged' => 0, 'skipped' => 0, 'unknown' => 0, 'out_of_scope' => 0];
        $problems = [];
        DB::transaction(function () use ($items, $subs, $scope, $actor, &$counts, &$problems): void {
            foreach ($items as $n => $i) {
                $s = $subs[$i['code']] ?? null;
                if ($s === null) {
                    $counts['unknown']++;
                    $problems[] = ['index' => $n, 'code' => $i['code'], 'problem' => 'Kode gardu tidak dikenal.'];

                    continue;
                }
                if (! $scope['unrestricted'] && ! in_array($s->organizational_unit_id, $scope['units'], true)) {
                    $counts['out_of_scope']++;
                    $problems[] = ['index' => $n, 'code' => $i['code'], 'problem' => 'Gardu di luar cakupan unit.'];

                    continue;
                }
                $r = $this->storeReading($s, $i, 'SYNC', null, $actor->getKey());
                match ($r['result'] ?? 'skipped') {
                    'stored' => $counts['stored']++,
                    'unchanged' => $counts['unchanged']++,
                    default => $counts['skipped']++,
                };
            }
        });

        return ['counts' => $counts + ['total' => count($items)], 'problems' => $problems];
    }

    /** Correction of the master data (reason required). @param array<string,mixed> $in @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function update(string $id, array $in, array $scope, User $actor): array
    {
        $s = $this->find($id, $scope);
        $set = array_intersect_key($in, array_flip(['name', 'area_note', 'latitude', 'longitude', 'capacity_kva', 'ownership', 'usage', 'type_code', 'feeder_code', 'status', 'needs_review']));
        if (($set['status'] ?? $s->status) === 'AKTIF' && ($set['capacity_kva'] ?? $s->capacity_kva) !== null && (float) ($set['capacity_kva'] ?? $s->capacity_kva) <= 0) {
            throw new AssignmentRuleViolation('Kapasitas harus lebih dari 0.');
        }
        $before = [];
        $after = [];
        foreach ($set as $k => $v) {                                          // only what really changes is applied and kept in the history
            $old = $s->{$k};
            $same = is_numeric($old) && is_numeric($v) ? abs((float) $old - (float) $v) < 0.0000001 : (is_bool($v) || is_bool($old) ? (bool) $old === (bool) $v : (string) $old === (string) ($v ?? ''));
            if (! $same) {
                $before[$k] = $old;
                $after[$k] = $v;
            }
        }
        $set = array_intersect_key($set, $after);
        if (array_key_exists('feeder_code', $set)) {          // the feeder master follows the corrected code (a new code creates its feeder)
            $set['feeder_id'] = app(FeederService::class)->resolve($set['feeder_code'], $s->gi_code, $s->organizational_unit_id, null, 'Dibentuk dari koreksi kode penyulang gardu '.$s->code.'.');
        }
        DB::transaction(function () use ($id, $set, $before, $after, $in, $actor): void {
            DB::table('substations')->where('id', $id)->update($set + ['updated_at' => now()]);
            if ($after !== []) {
                DB::table('substation_changes')->insert(['id' => (string) Str::uuid(), 'substation_id' => $id, 'changed_by' => $actor->getKey(), 'action' => 'UPDATED', 'reason' => (string) $in['reason'],
                    'before' => json_encode($before), 'after' => json_encode($after), 'created_at' => now()]);
            }
        });

        return $this->show($id, $scope);
    }

    // ---- import (staging) -------------------------------------------------------------------------------------------------------------------------------------------------

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function stage(UploadedFile $file, array $scope, User $actor, ?string $defaultUnitId, bool $full): array
    {
        $parsed = EisFileReader::read($file);
        if (! in_array('KD_GARDU', $parsed['columns'], true)) {
            throw new AssignmentRuleViolation('Kolom wajib KD_GARDU tidak ditemukan pada berkas.');
        }
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->pluck('id', 'code')->all();
        $default = $defaultUnitId === null ? null : (DB::table('organizational_units')->where('id', $defaultUnitId)->where('unit_type', 'ULP')->value('id') ?? throw new AssignmentRuleViolation('Unit bawaan harus berupa ULP yang dikenal.'));
        $codes = array_values(array_filter(array_map(fn ($r) => trim($r['cells']['KD_GARDU'] ?? ''), $parsed['rows'])));
        $existing = DB::table('substations')->whereIn('code', $codes)->get()->keyBy('code');
        $seen = [];
        $rows = [];
        $counts = ['NEW' => 0, 'CHANGED' => 0, 'UNCHANGED' => 0, 'REJECT' => 0];
        $batchId = (string) Str::uuid();
        foreach ($parsed['rows'] as $r) {
            $res = $this->classify($r['cells'], $units, $default, $scope, $existing, $seen);
            $counts[$res['action']]++;
            $rows[] = ['id' => (string) Str::uuid(), 'batch_id' => $batchId, 'row_number' => $r['row'], 'code' => $res['code'], 'action' => $res['action'], 'normalized' => json_encode($res['normalized']),
                'changes' => $res['changes'] === null ? null : json_encode($res['changes']), 'errors' => $res['errors'] === [] ? null : json_encode($res['errors'])];
        }
        DB::transaction(function () use ($batchId, $file, $actor, $default, $full, $parsed, $counts, $rows): void {
            DB::table('substation_sync_batches')->insert(['id' => $batchId, 'source' => 'FILE', 'kind' => 'MASTER', 'status' => 'STAGED', 'file_name' => $file->getClientOriginalName(), 'file_sha256' => hash_file('sha256', $file->getRealPath()),
                'full_snapshot' => $full, 'default_unit_id' => $default, 'total_rows' => count($parsed['rows']), 'counts' => json_encode($counts), 'initiated_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($rows, 300) as $chunk) {
                DB::table('substation_sync_rows')->insert($chunk);
            }
        });

        return $this->batch($batchId);
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function confirm(string $batchId, array $scope, User $actor): array
    {
        return DB::transaction(function () use ($batchId, $scope, $actor): array {
            $b = DB::table('substation_sync_batches')->where('id', $batchId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireOwner($b, $actor);
            if ($b->status !== 'STAGED') {
                throw new AssignmentRuleViolation('Batch ini sudah '.($b->status === 'CONFIRMED' ? 'dikonfirmasi' : 'dibuang').'.');
            }
            $applied = ['created' => 0, 'updated' => 0, 'readings' => 0, 'review_marked' => 0, 'customers_linked' => 0];
            $seenIds = [];
            $unitsSeen = [];
            foreach (DB::table('substation_sync_rows')->where('batch_id', $batchId)->whereIn('action', ['NEW', 'CHANGED', 'UNCHANGED'])->orderBy('row_number')->cursor() as $row) {
                $n = json_decode((string) $row->normalized, true);
                $m = $n['master'];
                $unitId = $m['organizational_unit_id'];
                if (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
                    throw new AssignmentRuleViolation("Baris {$row->row_number}: unit di luar cakupan Anda.");
                }
                $unitsSeen[$unitId] = true;
                $feederId = app(FeederService::class)->resolve($m['feeder_code'] ?? null, $m['gi_code'] ?? null, $unitId, $actor->getKey(), 'Dibentuk dari impor gardu.');
                $current = DB::table('substations')->where('code', $row->code)->lockForUpdate()->first();
                if ($current === null) {
                    $id = (string) Str::uuid();
                    DB::table('substations')->insert(['id' => $id, 'code' => $row->code, 'status' => 'AKTIF', 'last_seen_at' => now(), 'last_batch_id' => $batchId, 'created_at' => now(), 'updated_at' => now(), 'feeder_id' => $feederId] + $m);
                    $applied['created']++;
                } else {
                    $id = $current->id;
                    DB::table('substations')->where('id', $id)->update(($row->action === 'UNCHANGED' ? [] : $m) + ['needs_review' => false, 'last_seen_at' => now(), 'last_batch_id' => $batchId, 'updated_at' => now(), 'feeder_id' => $feederId]);
                    $row->action === 'CHANGED' && $applied['updated']++;
                }
                $seenIds[] = $id;
                foreach ($n['transformers'] ?? [] as $t) {
                    DB::table('substation_transformers')->updateOrInsert(['substation_id' => $id, 'slot' => $t['slot']], $t + ['id' => (string) Str::uuid()]);
                }
                if (! empty($n['reading'])) {
                    $applied['readings'] += $this->storeReading((object) ['id' => $id, 'capacity_kva' => $m['capacity_kva']], $n['reading'], 'IMPORT', $batchId, $actor->getKey())['result'] === 'stored' ? 1 : 0;
                }
            }
            if ($b->full_snapshot && $seenIds !== []) {
                $applied['review_marked'] = DB::table('substations')->whereIn('organizational_unit_id', array_keys($unitsSeen))->where('status', 'AKTIF')->whereNotIn('id', $seenIds)->update(['needs_review' => true, 'updated_at' => now()]);
            }
            $applied['customers_linked'] = app(ConnectionService::class)->linkPending($seenIds);          // customers whose gardu_ref was waiting for this gardu
            DB::table('substation_sync_batches')->where('id', $batchId)->update(['status' => 'CONFIRMED', 'confirmed_at' => now(), 'updated_at' => now()]);

            return $this->batch($batchId) + ['applied' => $applied];
        });
    }

    public function discard(string $batchId, User $actor): void
    {
        DB::transaction(function () use ($batchId, $actor): void {
            $b = DB::table('substation_sync_batches')->where('id', $batchId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireOwner($b, $actor);
            if ($b->status !== 'STAGED') {
                throw new AssignmentRuleViolation('Hanya batch sementara yang dapat dibuang.');
            }
            DB::table('substation_sync_batches')->where('id', $batchId)->update(['status' => 'DISCARDED', 'updated_at' => now()]);
        });
    }

    /** @return array<string,mixed> */
    public function batch(string $id): array
    {
        $b = DB::table('substation_sync_batches')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return ['id' => $b->id, 'source' => $b->source, 'status' => $b->status, 'file_name' => $b->file_name, 'full_snapshot' => (bool) $b->full_snapshot, 'total_rows' => $b->total_rows,
            'counts' => json_decode((string) $b->counts, true), 'created_at' => $b->created_at, 'confirmed_at' => $b->confirmed_at, 'initiated_by' => $b->initiated_by];
    }

    /** @return array<string,mixed> */
    public function batchRows(string $id, User $actor, ?string $action, int $perPage): array
    {
        $b = DB::table('substation_sync_batches')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->requireOwner($b, $actor);
        $q = DB::table('substation_sync_rows')->where('batch_id', $id)->orderBy('row_number');
        $action && $q->where('action', $action);
        $page = $q->paginate(max(1, min($perPage, 200)));

        return ['data' => $this->batch($id), 'rows' => collect($page->items())->map(fn ($r) => ['row' => $r->row_number, 'code' => $r->code, 'action' => $r->action, 'changes' => json_decode((string) $r->changes, true),
            'errors' => json_decode((string) $r->errors, true)])->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]];
    }

    // ---- internals --------------------------------------------------------------------------------------------------------------------------------------------------------

    /** @param array<string,string> $c @param array<string,string> $units code => id @return array<string,mixed> */
    private function classify(array $c, array $units, ?string $default, array $scope, $existing, array &$seen): array
    {
        $get = fn (string $k) => trim((string) ($c[$k] ?? ''));
        $code = $get('KD_GARDU');
        $errors = [];
        $unitId = null;
        if ($code === '') {
            $errors[] = 'KD_GARDU kosong: baris tidak lengkap.';
        } elseif (isset($seen[$code])) {
            $errors[] = "Kode {$code} ganda di berkas (baris {$seen[$code]}).";
        } else {
            $seen[$code] = count($seen) + 2;
        }
        $unitCode = $get('ULP_CODE') !== '' ? $get('ULP_CODE') : (preg_match('/^(\d{5})/', $get('SSOTNUMG'), $m) ? $m[1] : '');
        $unitId = $unitCode !== '' ? ($units[$unitCode] ?? null) : $default;
        if ($code !== '' && $unitId === null) {
            $errors[] = $unitCode !== '' ? "Unit {$unitCode} tidak dikenal." : 'Unit tidak dapat ditentukan (ULP_CODE / awalan SSOTNUMG kosong dan tidak ada unit bawaan).';
        }
        if ($unitId !== null && ! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
            $errors[] = 'Unit di luar cakupan Anda.';
        }
        $cap = $this->num($get('KAP_TOTAL'));
        if ($code !== '' && ($cap === null || $cap <= 0)) {
            $errors[] = 'Kapasitas (KAP_TOTAL) kosong atau bukan angka positif.';
        }
        $lat = $this->coord($get('LATITUDEY') ?: $get('K_Y'));
        $lng = $this->coord($get('LONGITUDEX') ?: $get('K_X'));
        $type = self::TYPES[mb_strtoupper($get('JNS_GRD'))] ?? ($get('JNS_GRD') === '' ? null : 'LAINNYA');
        $owner = mb_strtoupper($get('TRFMILIK'));
        $usage = mb_strtoupper($get('STATUS'));
        $master = ['asset_number' => $this->nul($get('ASSETNUM')), 'location_code' => $this->nul($get('LOCATION')), 'gadis_number' => $this->nul($get('NO_GADIS')), 'organizational_unit_id' => $unitId,
            'feeder_code' => $this->nul($get('KD_PYLG')), 'gi_code' => $this->nul($get('KD_GI')), 'jtm_number' => $this->nul($get('NO_JTM')), 'type_code' => $type, 'ownership' => $owner === '' || $owner === 'PLN' ? 'PLN' : 'PELANGGAN',
            'usage' => in_array($usage, ['UMUM', 'KHUSUS', 'CAMPURAN'], true) ? $usage : null, 'name' => $this->nul($get('LOKASI')), 'area_note' => $this->nul($get('LOKASI2')), 'kabupaten' => $this->nul($get('KABUPATEN')),
            'kecamatan' => $this->nul($get('KECAMATAN')), 'kelurahan' => $this->nul($get('KELURAHAN')), 'latitude' => $lat, 'longitude' => $lng, 'capacity_kva' => $cap,
            'transformer_count' => max(1, (int) ($this->num($get('JMLTRF1')) ?? 1))];
        $tr = [];
        if ($get('MRKTRF1') !== '' || $get('NOSERITRF1') !== '') {
            $tr[] = ['slot' => 1, 'brand' => $this->nul($get('MRKTRF1')), 'serial_number' => $this->nul($get('NOSERITRF1')), 'year_made' => $this->nul($get('THNTRF1')), 'capacity_kva' => $cap ?? 1, 'phase' => $this->nul($get('PHASA1')),
                'vector_group' => $this->nul($get('JNSHUB1')), 'tap' => $this->nul($get('TAP1')), 'impedance' => $this->nul($get('IMPEDAN1')), 'unit_status' => $this->nul($get('STSTRF1'))];
        }
        $reading = null;
        if (preg_match('/^(0[1-9]|1[0-2])(\d{4})$/', $get('BLTHUKUR'), $m)) {                   // mmYYYY: the month of the last measurement
            [$kva, $pct, $basis] = self::deriveLoad(null, $this->num($get('PERSEN')), $cap);
            $volt = $this->num($get('TEG_UJUNG'));
            if ($pct !== null || $this->volt($volt) !== null) {
                $reading = ['measured_on' => "{$m[2]}-{$m[1]}-01", 'loading_pct' => $pct, 'current_max_a' => $this->pos($this->num($get('BEBAN'))), 'end_voltage_v' => $this->volt($volt), 'kwh_total' => $this->pos($this->num($get('JMLKWH')))];
            }
        }
        $row = $existing[$code] ?? null;
        $action = 'NEW';
        $changes = null;
        if ($errors !== []) {
            $action = 'REJECT';
        } elseif ($row !== null) {
            $changes = [];
            foreach (self::MASTER_FIELDS as $f) {
                $old = $row->{$f};
                $new = $master[$f];
                $same = is_numeric($old) && is_numeric($new) ? abs((float) $old - (float) $new) < 0.0000001 : (string) $old === (string) $new;
                $same || $changes[$f] = ['from' => $old, 'to' => $new];
            }
            $action = $changes === [] ? 'UNCHANGED' : 'CHANGED';
            $changes = $changes === [] ? null : $changes;
        }

        return ['code' => $code === '' ? null : $code, 'action' => $action, 'errors' => $errors, 'changes' => $changes, 'normalized' => ['master' => $master, 'transformers' => $tr, 'reading' => $reading]];
    }

    /**
     * @param  array<string,mixed>  $in
     * @return array<string,mixed> the stored reading (with 'result' = stored|unchanged) or ['result' => 'skipped'] when nothing was measured
     */
    private function storeReading(object $s, array $in, string $source, ?string $batchId, ?string $actorId): array
    {
        $tz = (string) config('distriva.business_timezone');
        $at = null;
        if (! empty($in['measured_at'])) {                                    // the time of day of the measurement (owner 2026-11-17); without an offset it is the business time zone (WIB)
            try {
                $at = CarbonImmutable::parse((string) $in['measured_at'], $tz);
            } catch (\Throwable) {
                throw new AssignmentRuleViolation('Waktu ukur tidak valid.');
            }
            $on = $at->setTimezone($tz)->toDateString();
            if ($at->isAfter(CarbonImmutable::now()->addMinutes(5))) {
                throw new AssignmentRuleViolation('Waktu ukur tidak boleh di masa depan.');
            }
        } else {
            $on = $in['measured_on'] ?? null;
            if ($on === null || CarbonImmutable::parse($on)->isAfter(CarbonImmutable::today())) {
                throw new AssignmentRuleViolation('Tanggal ukur wajib dan tidak boleh di masa depan.');
            }
        }
        $capacity = $this->pos($this->num($in['capacity_kva'] ?? null)) ?? ($s->capacity_kva === null ? null : (float) $s->capacity_kva);          // the capacity AT THE TIME of the measurement (transformer management changes it over the years)
        $ph = ['r' => $this->pos($this->num($in['current_r_a'] ?? null)), 's' => $this->pos($this->num($in['current_s_a'] ?? null)), 't' => $this->pos($this->num($in['current_t_a'] ?? null))];
        $feeders = $this->feeders($in['feeders'] ?? []);
        if (array_filter($ph, fn ($v) => $v !== null) === [] && $feeders !== []) {              // no gardu-level currents: the phase currents are the sum of the jurusan
            foreach (['r', 's', 't'] as $k) {
                $sum = array_sum(array_map(fn ($f) => $f[$k] ?? 0.0, $feeders));
                $ph[$k] = $sum > 0 ? round($sum, 2) : null;
            }
        }
        [$kva, $pct, $basis] = self::deriveLoad($this->pos($this->num($in['load_kva'] ?? null)), $this->pos($this->num($in['loading_pct'] ?? null)), $capacity, $ph);
        $row = ['load_kva' => $kva, 'loading_pct' => $pct, 'load_basis' => $basis, 'current_r_a' => $ph['r'], 'current_s_a' => $ph['s'], 'current_t_a' => $ph['t'], 'current_n_a' => $this->pos($this->num($in['current_n_a'] ?? null)),
            'current_max_a' => $this->pos($this->num($in['current_max_a'] ?? null)), 'end_voltage_v' => $this->volt($this->num($in['end_voltage_v'] ?? null)), 'kwh_total' => $this->pos($this->num($in['kwh_total'] ?? null)),
            'base_voltage_r_v' => $this->volt($this->num($in['base_voltage_r_v'] ?? null)), 'base_voltage_s_v' => $this->volt($this->num($in['base_voltage_s_v'] ?? null)), 'base_voltage_t_v' => $this->volt($this->num($in['base_voltage_t_v'] ?? null))];
        if (count(array_filter($row, fn ($v) => $v !== null && $v !== $basis)) === 0) {
            return ['result' => 'skipped'];
        }
        $day = CarbonImmutable::parse($on)->toDateString();
        $key = $at === null ? ['substation_id' => $s->id, 'measured_on' => $day, 'source' => $source] : ['substation_id' => $s->id, 'source' => $source, 'measured_at' => $at->utc()->format('Y-m-d H:i:s+00')];
        $exists = $at === null ? DB::table('substation_readings')->where($key)->whereNull('measured_at')->exists() : DB::table('substation_readings')->where($key)->exists();
        if ($exists) {
            return ['result' => 'unchanged'] + $key;
        }
        $key['measured_on'] = $day;
        $row += ['capacity_kva' => $capacity];
        $readingId = (string) Str::uuid();
        DB::table('substation_readings')->insert($key + $row + ['id' => $readingId, 'batch_id' => $batchId, 'recorded_by' => $actorId, 'created_at' => now()]);
        foreach ($feeders as $label => $f) {
            DB::table('substation_reading_feeders')->insert(['id' => (string) Str::uuid(), 'reading_id' => $readingId, 'label' => (string) $label, 'current_r_a' => $f['r'], 'current_s_a' => $f['s'], 'current_t_a' => $f['t'], 'current_n_a' => $f['n'], 'end_voltage_v' => $f['v']]);
        }

        return ['result' => 'stored', 'id' => $readingId] + $key + $row;
    }

    /** The jurusan of a reading, keyed by label; a jurusan without any measured value is dropped (0 = not measured). @param mixed $raw @return array<string,array{r:?float,s:?float,t:?float,n:?float,v:?float}> */
    private function feeders(mixed $raw): array
    {
        $out = [];
        foreach (is_array($raw) ? $raw : [] as $f) {
            $label = Str::limit(trim((string) ($f['label'] ?? '')), 40, '');
            $v = ['r' => $this->pos($this->num($f['current_r_a'] ?? null)), 's' => $this->pos($this->num($f['current_s_a'] ?? null)), 't' => $this->pos($this->num($f['current_t_a'] ?? null)),
                'n' => $this->pos($this->num($f['current_n_a'] ?? null)), 'v' => $this->volt($this->num($f['end_voltage_v'] ?? null))];
            if ($label !== '' && count(array_filter($v, fn ($x) => $x !== null)) > 0) {
                $out[$label] = $v;
            }
        }

        return $out;
    }

    /** @param array<string,mixed>|object|null $r @return array<string,mixed> */
    private function present(object $s, ?object $reading, ?Collection $trafos = null): array
    {
        $rd = $reading === null ? null : $this->reading($reading);
        $t1 = $trafos?->first();
        $yr = $t1 !== null && preg_match('/^\d{4}$/', (string) $t1->year_made) && (int) $t1->year_made >= 1950 && (int) $t1->year_made <= (int) date('Y') ? (int) $t1->year_made : null;
        $address = implode(', ', array_filter([$s->area_note, $s->kelurahan, $s->kecamatan, $s->kabupaten], fn ($v) => $v !== null && trim((string) $v) !== ''));

        return ['id' => $s->id, 'code' => $s->code, 'display_code' => self::displayCode($s), 'asset_number' => $s->asset_number, 'location_code' => $s->location_code, 'gadis_number' => $s->gadis_number, 'organizational_unit_id' => $s->organizational_unit_id,
            'unit_name' => $s->unit_name ?? null, 'unit_code' => $s->unit_code ?? null, 'feeder_code' => $s->feeder_code, 'feeder_id' => $s->feeder_id ?? null, 'gi_code' => $s->gi_code, 'type_code' => $s->type_code, 'ownership' => $s->ownership, 'usage' => $s->usage,
            'name' => $s->name, 'area_note' => $s->area_note, 'kabupaten' => $s->kabupaten, 'kecamatan' => $s->kecamatan, 'kelurahan' => $s->kelurahan,
            'latitude' => $s->latitude === null ? null : (float) $s->latitude, 'longitude' => $s->longitude === null ? null : (float) $s->longitude, 'capacity_kva' => $s->capacity_kva === null ? null : (float) $s->capacity_kva,
            'transformer_count' => $s->transformer_count, 'status' => $s->status, 'needs_review' => (bool) $s->needs_review, 'pickable' => $s->status === 'AKTIF' && $s->ownership === 'PLN',
            'address' => $address === '' ? null : $address, 'transformer_brand' => $t1?->brand, 'transformer_year' => $yr, 'transformer_age_years' => $yr === null ? null : (int) date('Y') - $yr,
            'reading' => $rd, 'reading_status' => $rd === null ? 'NONE' : ($rd['stale'] ? 'STALE' : 'FRESH')];
    }

    /** @return array<string,mixed> */
    private function reading(object $r): array
    {
        $age = (int) CarbonImmutable::parse($r->measured_on)->diffInDays(CarbonImmutable::today());
        $f = fn ($v) => $v === null ? null : (float) $v;

        return ['measured_on' => CarbonImmutable::parse($r->measured_on)->toDateString(), 'measured_at' => $this->timeOf($r), 'capacity_kva' => $f($r->capacity_kva ?? null), 'age_days' => $age, 'stale' => $age > (int) config('distriva.substation_reading_max_age_days'), 'load_kva' => $f($r->load_kva), 'loading_pct' => $f($r->loading_pct),
            'load_basis' => $r->load_basis, 'current_r_a' => $f($r->current_r_a), 'current_s_a' => $f($r->current_s_a), 'current_t_a' => $f($r->current_t_a), 'current_n_a' => $f($r->current_n_a), 'current_max_a' => $f($r->current_max_a),
            'end_voltage_v' => $f($r->end_voltage_v), 'kwh_total' => $f($r->kwh_total), 'source' => $r->source,
            'base_voltage_r_v' => $f($r->base_voltage_r_v ?? null), 'base_voltage_s_v' => $f($r->base_voltage_s_v ?? null), 'base_voltage_t_v' => $f($r->base_voltage_t_v ?? null),
            'flags' => SubstationAnalysisService::quickFlags($r)];
    }

    /** The gardu code people use (owner 2026-11-19): the GADIS number (GD514530003) when the gardu has one, else the Maximo code (HD0001) until its GADIS number is known. The Maximo code stays the technical key. */
    public static function displayCode(object $s): string
    {
        return trim((string) ($s->gadis_number ?? '')) !== '' ? trim((string) $s->gadis_number) : (string) $s->code;
    }

    /** One reading of the OMT load (docs/83): same rules as every reading (idempotent per gardu, source and time). @param array<string,mixed> $in @return array<string,mixed> */
    public function storeImportedReading(object $substation, array $in, ?string $actorId): array
    {
        return $this->storeReading($substation, $in, 'IMPORT', null, $actorId);
    }

    /** ISO time of the measurement in the business time zone, e.g. 2026-11-09T19:59:05+07:00; null for a reading that only knows its date. */
    public static function timeOf(object $r): ?string
    {
        return empty($r->measured_at) ? null : CarbonImmutable::parse($r->measured_at)->setTimezone((string) config('distriva.business_timezone'))->toIso8601String();
    }

    /** @param list<string> $ids @return array<string,object> */
    private function latestReadings(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach (DB::table('substation_readings')->whereIn('substation_id', $ids)->orderBy('measured_on')->orderByRaw('measured_at asc nulls first')->orderBy('created_at')->get() as $r) {
            $out[$r->substation_id] = $r;
        }

        return $out;
    }

    public function find(string $id, array $scope): object
    {
        $s = DB::table('substations')->where('id', $id)->first();
        if ($s === null || (! $scope['unrestricted'] && ! in_array($s->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $s;
    }

    private function limit($q, array $scope): void
    {
        if (! $scope['unrestricted']) {
            $q->whereIn('s.organizational_unit_id', $scope['units']);
        }
    }

    private function requireOwner(object $b, User $actor): void
    {
        if ($b->initiated_by !== $actor->getKey()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function num(mixed $v): ?float
    {
        $v = trim((string) $v);
        if ($v === '' || $v === '-') {
            return null;
        }
        $v = str_replace(',', '.', $v);

        return is_numeric($v) ? (float) $v : null;
    }

    private function pos(?float $v): ?float
    {
        return $v !== null && $v > 0 ? $v : null;
    }

    /** An end voltage outside 0..1000 V is a data-entry slip in the source (e.g. 2200 for 220.0): treated as not measured, so it can neither block a gardu nor reach the table's check. */
    private function volt(?float $v): ?float
    {
        return $v !== null && $v > 0 && $v < 1000 ? $v : null;
    }

    private function coord(string $v): ?float
    {
        $n = $this->num($v);

        return $n === null || $n == 0.0 ? null : $n;
    }

    private function nul(string $v): ?string
    {
        return $v === '' || $v === '-' ? null : $v;
    }
}
