<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Nko\NkoCalculationException;
use App\Services\Nko\NkoCalculationService;
use App\Services\Nko\NkoRealizationResolver;
use App\Services\Nko\NkoSnapshotService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * NKO/KPI (docs/90). Membaca butuh nko.view (UP3 melihat ULP di bawahnya dan dirinya sendiri); menghitung butuh nko.calculate dan mengisi masukan manual butuh nko.input pada unit yang dituju
 * (peran tingkat UP3 mencakup ULP di bawahnya; unit UP3 sendiri hanya bila perannya bertugas di UP3 itu).
 */
class NkoController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly NkoSnapshotService $snapshots, private readonly NkoRealizationResolver $resolver, private readonly MfaService $mfa) {}

    /** @return list<string>|null unit yang boleh dibaca; null = semua */
    private function visibleUnits(Request $request): ?array
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'nko.view');
        if ($scope['unrestricted']) {
            return null;
        }

        return array_values(array_unique([...$scope['units'], ...DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->all()]));
    }

    /** @return list<string>|null unit yang boleh dihitung/diisi menurut izin $key; null = semua */
    private function writableUnits(Request $request, string $key): ?array
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, $key);
        if ($scope['unrestricted']) {
            if (! $this->mfa->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }

            return null;
        }
        $allowed = $scope['units'];
        foreach (DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->unique() as $up3) {
            $this->authorizer->holdsOnUp3($actor, $key, $up3) && $allowed[] = $up3;
        }

        return array_values(array_unique($allowed));
    }

    private function assertUnit(?array $allowed, string $unitId): void
    {
        if ($allowed !== null && ! in_array($unitId, $allowed, true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    /** GET /nko/definitions?year=2026&level=ULP: definisi aktif (pohon indikator). */
    public function definitions(Request $request): JsonResponse
    {
        $this->visibleUnits($request);
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'level' => ['required', 'in:ULP,UP3']]);
        $set = DB::table('kpi_definition_sets')->where('year', $d['year'])->where('unit_level', $d['level'])->where('status', 'AKTIF')->first();
        if ($set === null) {
            throw new AdministrationDenied('Definisi NKO belum diimpor.', 404);
        }
        $defs = DB::table('kpi_definitions as d')->leftJoin('kpi_definitions as p', 'p.id', '=', 'd.parent_id')->where('d.set_id', $set->id)->orderBy('d.sort_order')
            ->get(['d.id', 'd.code', 'd.number', 'd.name', 'd.level', 'd.polarity', 'd.unit_label', 'd.weight', 'd.weight_note', 'd.formula_text', 'd.source_sheet', 'd.scoring_rule', 'p.code as parent_code']);

        return response()->json(['data' => ['set' => ['id' => $set->id, 'year' => (int) $set->year, 'level' => $set->unit_level, 'version' => (int) $set->version, 'source_name' => $set->source_name, 'total_weight' => $set->total_weight !== null ? (float) $set->total_weight : null],
            'definitions' => $defs->map(fn ($x) => ['id' => $x->id, 'code' => $x->code, 'number' => $x->number, 'name' => $x->name, 'level' => (int) $x->level, 'parent_code' => $x->parent_code, 'polarity' => $x->polarity !== null ? (int) $x->polarity : null,
                'unit_label' => $x->unit_label, 'weight' => $x->weight !== null ? (float) $x->weight : null, 'weight_note' => $x->weight_note, 'formula_text' => $x->formula_text, 'source_sheet' => $x->source_sheet, 'scoring_rule' => $x->scoring_rule])->all()]]);
    }

    /** GET /nko/snapshots?year=&month=&unit_id=&up3_id=: snapshot berlaku (ringkasan). */
    public function index(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['nullable', 'integer', 'between:1,12'], 'unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid']]);
        $rows = DB::table('kpi_snapshots as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->where('s.is_current', true)->whereYear('s.period', $d['year'])
            ->when($visible !== null, fn ($q) => $q->whereIn('s.organizational_unit_id', $visible))
            ->when(! empty($d['month']), fn ($q) => $q->whereMonth('s.period', $d['month']))
            ->when(! empty($d['unit_id']), fn ($q) => $q->where('s.organizational_unit_id', $d['unit_id']))
            ->when(! empty($d['up3_id']), fn ($q) => $q->where(fn ($x) => $x->where('u.parent_id', $d['up3_id'])->orWhere('u.id', $d['up3_id'])))
            ->orderBy('s.period')->orderBy('u.unit_type', 'desc')->orderBy('u.name')
            ->get(['s.id', 's.period', 's.organizational_unit_id', 'u.name as unit_name', 'u.unit_type', 's.total_nilai', 's.nko', 's.rank', 's.rank_of', 's.missing_count', 's.calculated_at']);

        return response()->json(['data' => $rows->map(fn ($r) => $this->summary($r))->all()]);
    }

    /** GET /nko/snapshots/{id}: rincian per indikator. */
    public function show(Request $request, string $snapshot): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $s = DB::table('kpi_snapshots as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->where('s.id', $snapshot)
            ->first(['s.*', 'u.name as unit_name', 'u.unit_type']);
        if ($s === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $this->assertUnit($visible, $s->organizational_unit_id);
        $values = DB::table('kpi_snapshot_values as v')->join('kpi_definitions as d', 'd.id', '=', 'v.definition_id')->leftJoin('kpi_definitions as p', 'p.id', '=', 'd.parent_id')->where('v.snapshot_id', $s->id)->orderBy('d.sort_order')
            ->get(['d.code', 'd.number', 'd.name', 'd.level', 'd.polarity', 'd.unit_label', 'd.weight', 'd.weight_note', 'p.code as parent_code', 'v.target_value', 'v.target_text', 'v.realisasi', 'v.source', 'v.pencapaian', 'v.nilai']);

        return response()->json(['data' => $this->summary((object) ['id' => $s->id, 'period' => $s->period, 'organizational_unit_id' => $s->organizational_unit_id, 'unit_name' => $s->unit_name, 'unit_type' => $s->unit_type, 'total_nilai' => $s->total_nilai,
            'nko' => $s->nko, 'rank' => $s->rank, 'rank_of' => $s->rank_of, 'missing_count' => $s->missing_count, 'calculated_at' => $s->calculated_at]) + [
                'is_current' => (bool) $s->is_current, 'missing' => json_decode($s->missing ?? '[]', true),
                'values' => $values->map(fn ($v) => ['code' => $v->code, 'number' => $v->number, 'name' => $v->name, 'level' => (int) $v->level, 'parent_code' => $v->parent_code, 'polarity' => $v->polarity !== null ? (int) $v->polarity : null, 'unit_label' => $v->unit_label,
                    'weight' => $v->weight !== null ? (float) $v->weight : null, 'weight_note' => $v->weight_note, 'target' => $v->target_value !== null ? (float) $v->target_value : $v->target_text, 'realisasi' => $v->realisasi !== null ? (float) $v->realisasi : null, 'source' => $v->source,
                    'pencapaian' => $v->pencapaian !== null ? (float) $v->pencapaian : null, 'nilai' => $v->nilai !== null ? (float) $v->nilai : null])->all()]]);
    }

    /** GET /nko/ranking?year=&month=&up3_id=: peringkat ULP satu UP3 (snapshot berlaku) beserta NKO UP3. */
    public function ranking(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['required', 'integer', 'between:1,12'], 'up3_id' => ['required', 'uuid']]);
        $this->assertUnit($visible, $d['up3_id']);
        $rows = DB::table('kpi_snapshots as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->where('s.is_current', true)->where('s.period', sprintf('%04d-%02d-01', $d['year'], $d['month']))
            ->where(fn ($x) => $x->where('u.parent_id', $d['up3_id'])->orWhere('u.id', $d['up3_id']))
            ->when($visible !== null, fn ($q) => $q->whereIn('s.organizational_unit_id', $visible))
            ->get(['s.id', 's.period', 's.organizational_unit_id', 'u.name as unit_name', 'u.unit_type', 's.total_nilai', 's.nko', 's.rank', 's.rank_of', 's.missing_count', 's.calculated_at']);
        $ulp = $rows->where('unit_type', 'ULP')->sortBy('rank')->values();

        return response()->json(['data' => ['ulp' => $ulp->map(fn ($r) => $this->summary($r))->all(), 'up3' => ($up3 = $rows->firstWhere('unit_type', 'UP3')) ? $this->summary($up3) : null]]);
    }

    /** GET /nko/inputs?unit_id=&year=&month=: daftar indikator yang butuh realisasi bulan itu beserta sumbernya. */
    public function inputs(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['required', 'integer', 'between:1,12']]);
        $this->assertUnit($visible, $d['unit_id']);
        [$unit, $set, $nodes] = $this->context($d['unit_id'], (int) $d['year']);
        $resolved = $this->resolver->resolve($d['unit_id'], (int) $d['year'], (int) $d['month']);
        $meta = DB::table('kpi_definitions as d')->leftJoin('kpi_definitions as p', 'p.id', '=', 'd.parent_id')->where('d.set_id', $set->id)->get(['d.id', 'd.name', 'd.source_sheet', 'p.name as parent_name'])->keyBy('id');
        $targets = DB::table('kpi_targets')->where('organizational_unit_id', $d['unit_id'])->where('period', sprintf('%04d-%02d-01', $d['year'], $d['month']))->get(['definition_id', 'target_value', 'target_text'])->keyBy('definition_id');
        $items = [];
        foreach ($nodes as $n) {
            if (empty($n['source_sheet'])) {
                continue;
            }
            $needs = $this->snapshots->needsRealisasi($n, (int) $d['month']);
            $r = $resolved[$n['code']] ?? null;
            $t = $targets[$n['id']] ?? null;
            $items[] = ['code' => $n['code'], 'name' => $meta[$n['id']]->name, 'group' => $meta[$n['id']]->parent_name, 'unit_label' => $n['unit_label'], 'polarity' => $n['polarity'], 'weight' => $n['weight'],
                'target' => $t === null ? null : ($t->target_value !== null ? (float) $t->target_value : $t->target_text), 'editable' => $needs, 'system_source' => isset(NkoRealizationResolver::SYSTEM_CODES[$n['code']]), 'system_validated' => ! in_array($n['code'], NkoRealizationResolver::UNVALIDATED_CODES, true),
                'value' => $r['value'] ?? null, 'source' => $r['source'] ?? null, 'manual' => $r['manual'] ?? null, 'system' => $r['system'] ?? null, 'note' => $r['note'] ?? null];
        }

        if (in_array(NkoRealizationResolver::SUSUT_CODE, array_column($nodes, 'code'), true)) {
            foreach (NkoRealizationResolver::SUSUT_INPUTS as $code => $name) {
                $r = $resolved[$code] ?? null;
                $items[] = ['code' => $code, 'name' => $name, 'group' => 'Masukan pembantu susut', 'unit_label' => 'kWh', 'polarity' => null, 'weight' => null, 'target' => null, 'editable' => true, 'auxiliary' => true,
                    'system_source' => false, 'system_validated' => true, 'value' => $r['value'] ?? null, 'source' => $r ? 'MANUAL' : null, 'manual' => $r['manual'] ?? null, 'system' => null, 'note' => $r['note'] ?? null];
            }
        }

        return response()->json(['data' => ['unit_id' => $unit->id, 'unit_name' => $unit->name, 'year' => (int) $d['year'], 'month' => (int) $d['month'], 'items' => $items]]);
    }

    /** PUT /nko/inputs: simpan masukan manual (value null = hapus). Realisasi kumulatif Januari sampai bulan itu. */
    public function saveInputs(Request $request): JsonResponse
    {
        $allowed = $this->writableUnits($request, 'nko.input');
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['required', 'integer', 'between:1,12'],
            'items' => ['required', 'array', 'min:1', 'max:100'], 'items.*.code' => ['required', 'string', 'max:80'], 'items.*.value' => ['nullable', 'numeric'], 'items.*.note' => ['nullable', 'string', 'max:300']]);
        $this->assertUnit($allowed, $d['unit_id']);
        [, , $nodes] = $this->context($d['unit_id'], (int) $d['year']);
        $editable = [];
        foreach ($nodes as $n) {
            if ($this->snapshots->needsRealisasi($n, (int) $d['month'])) {
                $editable[$n['code']] = true;
            }
        }
        if (in_array(NkoRealizationResolver::SUSUT_CODE, array_column($nodes, 'code'), true)) {
            foreach (array_keys(NkoRealizationResolver::SUSUT_INPUTS) as $aux) {
                $editable[$aux] = true;
            }
        }
        $bad = array_values(array_filter(array_column($d['items'], 'code'), fn ($c) => ! isset($editable[$c])));
        if ($bad !== []) {
            throw new AdministrationDenied('Indikator tidak dapat diisi manual pada bulan ini: '.implode(', ', $bad).'.', 422);
        }
        $period = sprintf('%04d-%02d-01', $d['year'], $d['month']);
        $system = $this->resolver->systemValues($d['unit_id'], (int) $d['year'], (int) $d['month']);
        $noReason = array_values(array_filter($d['items'], fn ($it) => ($it['value'] ?? null) !== null && isset($system[$it['code']]) && trim((string) ($it['note'] ?? '')) === ''));
        if ($noReason !== []) {
            throw new AdministrationDenied('Koreksi atas nilai otomatis wajib disertai alasan (note): '.implode(', ', array_column($noReason, 'code')).'.', 422);
        }
        DB::transaction(function () use ($d, $period, $request, $system) {
            foreach ($d['items'] as $it) {
                $where = ['definition_code' => $it['code'], 'organizational_unit_id' => $d['unit_id'], 'period' => $period];
                if (! array_key_exists('value', $it) || $it['value'] === null) {
                    DB::table('kpi_manual_inputs')->where($where)->delete();

                    continue;
                }
                $existing = DB::table('kpi_manual_inputs')->where($where)->first();
                $data = ['value' => $it['value'], 'note' => $it['note'] ?? null, 'system_value' => $system[$it['code']] ?? null, 'entered_by' => $request->user()->id, 'updated_at' => now()];
                $existing === null
                    ? DB::table('kpi_manual_inputs')->insert($where + $data + ['id' => (string) Str::uuid7(), 'created_at' => now()])
                    : DB::table('kpi_manual_inputs')->where('id', $existing->id)->update($data);
            }
        });

        return response()->json(['message' => count($d['items']).' masukan disimpan. Jalankan perhitungan untuk memperbarui nilai.']);
    }

    /** POST /nko/calculate {year, month, unit_id | up3_id}: hitung satu unit, atau satu UP3 beserta ULP di bawahnya. */
    public function calculate(Request $request): JsonResponse
    {
        $allowed = $this->writableUnits($request, 'nko.calculate');
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['required', 'integer', 'between:1,12'], 'unit_id' => ['required_without:up3_id', 'nullable', 'uuid'], 'up3_id' => ['required_without:unit_id', 'nullable', 'uuid']]);
        $targets = ! empty($d['unit_id']) ? [$d['unit_id']] : DB::table('organizational_units')->where('parent_id', $d['up3_id'])->where('unit_type', 'ULP')->orderBy('name')->pluck('id')->prepend($d['up3_id'])->all();
        $results = [];
        foreach ($targets as $unitId) {
            if ($allowed !== null && ! in_array($unitId, $allowed, true)) {
                if (! empty($d['unit_id'])) {
                    throw new AdministrationDenied('Data tidak ditemukan.', 404);
                }

                continue;
            }
            try {
                $results[] = ['ok' => true] + $this->snapshots->calculate($unitId, (int) $d['year'], (int) $d['month'], $request->user());
            } catch (NkoCalculationException $e) {
                $results[] = ['ok' => false, 'unit_id' => $unitId, 'message' => $e->getMessage()];
            }
        }
        $failed = count(array_filter($results, fn ($r) => ! $r['ok']));

        return response()->json(['data' => $results, 'message' => count($results) - $failed.' unit dihitung'.($failed > 0 ? ", {$failed} gagal" : '').'.'], $results !== [] && $failed === count($results) ? 422 : 200);
    }

    /** @return array{0: object, 1: object, 2: list<array<string, mixed>>} */
    private function context(string $unitId, int $year): array
    {
        $unit = DB::table('organizational_units')->where('id', $unitId)->whereIn('unit_type', ['ULP', 'UP3'])->first(['id', 'name', 'unit_type']);
        $set = $unit === null ? null : DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $unit->unit_type)->where('status', 'AKTIF')->first();
        if ($unit === null || $set === null) {
            throw new AdministrationDenied('Definisi NKO belum diimpor untuk unit dan tahun ini.', 404);
        }
        $nodes = app(NkoCalculationService::class)->nodes($set->id, $unitId);
        $sheets = DB::table('kpi_definitions')->where('set_id', $set->id)->pluck('source_sheet', 'id')->all();
        foreach ($nodes as &$n) {
            $n['source_sheet'] = $sheets[$n['id']] ?? null;
        }

        return [$unit, $set, $nodes];
    }

    /** @return array<string, mixed> */
    private function summary(object $r): array
    {
        return ['id' => $r->id, 'period' => substr($r->period, 0, 7), 'unit_id' => $r->organizational_unit_id, 'unit_name' => $r->unit_name, 'unit_type' => $r->unit_type,
            'total_nilai' => $r->total_nilai !== null ? (float) $r->total_nilai : null, 'nko' => $r->nko !== null ? (float) $r->nko : null, 'rank' => $r->rank !== null ? (int) $r->rank : null, 'rank_of' => $r->rank_of !== null ? (int) $r->rank_of : null,
            'missing_count' => (int) $r->missing_count, 'complete' => (int) $r->missing_count === 0, 'calculated_at' => $r->calculated_at];
    }
}
