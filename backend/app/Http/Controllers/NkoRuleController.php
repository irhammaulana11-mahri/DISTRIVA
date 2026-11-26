<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Concerns\AuthorizesNkoChanges;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Nko\NkoFormula;
use App\Services\Nko\NkoMappingCheckService;
use App\Services\Nko\NkoRealizationRules;
use App\Services\Nko\NkoRuleException;
use App\Services\Nko\NkoRulePreviewService;
use App\Services\Nko\NkoRuleProposalService;
use App\Services\Nko\NkoSourceCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Pengaturan aturan realisasi NKO (docs/93). Membaca butuh nko.view; mengusulkan butuh nko.rules.propose dan memutus butuh nko.rules.approve.
 * Aturan berlaku untuk semua unit, sehingga kedua izin tulis harus dipegang pada tingkat UP3 (atau SYS_ADMIN dengan MFA).
 */
class NkoRuleController extends Controller
{
    use AuthorizesNkoChanges;

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MfaService $mfa, private readonly NkoRealizationRules $rules,
        private readonly NkoRuleProposalService $proposalService, private readonly NkoRulePreviewService $previews, private readonly NkoMappingCheckService $mappings) {}

    /** GET /nko/rules?year=&month=: indikator yang butuh realisasi beserta aturan yang berlaku bulan itu (has_rule=false bila belum ada). */
    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'month' => ['required', 'integer', 'between:1,12']]);
        $rules = $this->rules->forPeriod((int) $d['year'], (int) $d['month']);
        $definitions = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('s.year', $d['year'])->where('s.status', 'AKTIF')->where('d.source_sheet', '<>', '')
            ->orderByDesc('s.unit_level')->orderBy('d.sort_order')->get(['d.code', 'd.name', 'd.unit_label', 's.unit_level'])->groupBy('code');
        $items = $definitions->map(function ($rows, string $code) use ($rules) {
            $rule = $rules[$code] ?? null;

            return ['definition_code' => $code, 'name' => $rows[0]->name, 'unit_label' => $rows[0]->unit_label, 'levels' => $rows->pluck('unit_level')->all(), 'has_rule' => $rule !== null,
                'mode' => $rule?->mode, 'formula' => $rule?->formula, 'inputs' => $rule === null ? [] : $this->inputList($rule->inputs), 'is_validated' => $rule === null ? null : (bool) $rule->is_validated,
                'flag_when_negative' => $rule === null ? null : (bool) $rule->flag_when_negative, 'effective_from' => $rule === null ? null : substr($rule->effective_from, 0, 7), 'replaces_code' => $rule?->replaces_code];
        })->values();

        return response()->json(['data' => ['year' => (int) $d['year'], 'month' => (int) $d['month'], 'items' => $items]]);
    }

    /** GET /nko/rules/catalog: besaran, fungsi, dan mode yang boleh dipakai. */
    public function catalog(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $quantities = [];
        foreach (NkoSourceCatalog::QUANTITIES as $name => [, $aggregate, $unit, $label]) {
            $quantities[] = ['name' => $name, 'label' => $label, 'unit_label' => $unit, 'up3_aggregation' => $aggregate];
        }
        $functions = [];
        foreach (NkoFormula::FUNCTIONS as $name => [$min, $max]) {
            $functions[] = ['name' => $name, 'min_args' => $min, 'max_args' => $max];
        }

        return response()->json(['data' => ['quantities' => $quantities, 'functions' => $functions, 'operators' => ['+', '-', '*', '/', '(', ')'], 'modes' => NkoRuleProposalService::MODES]]);
    }

    /** GET /nko/rules/mapping?year=: hasil pencocokan definisi dengan aturan (item bertambah, hilang, tanpa aturan, aturan tanpa item). */
    public function mapping(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100']]);

        return response()->json(['data' => $this->mappings->check((int) $d['year'])]);
    }

    /** POST /nko/rules/preview: hitung rumus tanpa menyimpan, dibandingkan dengan aturan sekarang dan angka workbook. */
    public function preview(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['definition_code' => ['required', 'string', 'max:80'], 'formula' => ['required', 'string', 'max:500'], 'year' => ['required', 'integer', 'between:2000,2100'], 'to_month' => ['nullable', 'integer', 'between:1,12']] + $this->inputRules());
        $toMonth = (int) ($d['to_month'] ?? 12);
        $inputs = $this->declaredInputs($d);
        $errors = $this->proposalService->errors(['definition_code' => $d['definition_code'], 'mode' => 'SISTEM_BOLEH_KOREKSI', 'formula' => $d['formula'], 'inputs' => $inputs, 'effective_from' => sprintf('%04d-%02d-01', $d['year'], $toMonth), 'replaces_code' => null]);
        if ($errors !== []) {
            throw new AdministrationDenied(implode(' ', $errors), 422);
        }
        $units = $scope['unrestricted'] ? null : array_values(array_unique([...$scope['units'], ...DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->all()]));
        $byCode = collect($inputs)->mapWithKeys(fn (array $i) => [$i['code'] => ['name' => $i['name'], 'unit_label' => $i['unit_label']]])->all();

        return response()->json(['data' => ['definition_code' => $d['definition_code'], 'year' => (int) $d['year']] + $this->previews->preview($d['definition_code'], $d['formula'], $byCode, (int) $d['year'], $toMonth, $units)]);
    }

    /** GET /nko/rule-proposals?status=: usulan terbaru lebih dulu. */
    public function proposals(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['status' => ['nullable', 'in:MENUNGGU,DISETUJUI,DITOLAK,DIBATALKAN']]);
        $rows = DB::table('kpi_rule_proposals as p')->leftJoin('users as a', 'a.id', '=', 'p.proposed_by')->leftJoin('users as b', 'b.id', '=', 'p.decided_by')
            ->when(! empty($d['status']), fn ($q) => $q->where('p.status', $d['status']))->orderByDesc('p.proposed_at')->orderByDesc('p.id')->limit(200)
            ->get(['p.*', 'a.name as proposer_name', 'b.name as decider_name']);
        $names = DB::table('kpi_definitions')->whereIn('code', $rows->pluck('definition_code'))->pluck('name', 'code');

        return response()->json(['data' => $rows->map(fn ($p) => [
            'id' => $p->id, 'definition_code' => $p->definition_code, 'definition_name' => $names[$p->definition_code] ?? null, 'mode' => $p->mode, 'formula' => $p->formula, 'inputs' => json_decode($p->inputs ?? '[]', true),
            'is_validated' => (bool) $p->is_validated, 'flag_when_negative' => (bool) $p->flag_when_negative, 'effective_from' => substr($p->effective_from, 0, 7), 'replaces_code' => $p->replaces_code, 'reason' => $p->reason, 'status' => $p->status,
            'proposed_by' => $p->proposed_by === null ? null : ['id' => $p->proposed_by, 'name' => $p->proposer_name], 'proposed_at' => $p->proposed_at,
            'decided_by' => $p->decided_by === null ? null : ['id' => $p->decided_by, 'name' => $p->decider_name], 'decided_at' => $p->decided_at, 'decision_note' => $p->decision_note,
        ])->all()]);
    }

    /** POST /nko/rule-proposals */
    public function propose(Request $request): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate(['definition_code' => ['required', 'string', 'max:80'], 'mode' => ['required', 'string'], 'formula' => ['nullable', 'string', 'max:500'], 'effective_from' => ['required', 'date_format:Y-m'],
            'is_validated' => ['nullable', 'boolean'], 'flag_when_negative' => ['nullable', 'boolean'], 'replaces_code' => ['nullable', 'string', 'max:80'], 'reason' => ['required', 'string', 'max:500']] + $this->inputRules());
        $id = $this->guard(fn () => $this->proposalService->propose([
            'definition_code' => $d['definition_code'], 'mode' => $d['mode'], 'formula' => $d['formula'] ?? null, 'inputs' => $this->declaredInputs($d), 'effective_from' => $d['effective_from'].'-01',
            'is_validated' => (bool) ($d['is_validated'] ?? false), 'flag_when_negative' => (bool) ($d['flag_when_negative'] ?? false), 'replaces_code' => $d['replaces_code'] ?? null, 'reason' => $d['reason'],
        ], $request->user()));

        return response()->json(['message' => 'Usulan tersimpan, menunggu persetujuan.', 'data' => ['id' => $id]], 201);
    }

    /** POST /nko/rule-proposals/{id}/decision {decision: approve|reject, note?} */
    public function decide(Request $request, string $proposal): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.approve');
        $d = $request->validate(['decision' => ['required', 'in:approve,reject'], 'note' => ['nullable', 'string', 'max:500']]);
        $result = $this->guard(fn () => $this->proposalService->decide($proposal, $d['decision'] === 'approve', $d['note'] ?? null, $request->user()));

        return response()->json(['message' => $result['status'] === 'DISETUJUI' ? 'Usulan disetujui dan aturan berlaku. Hitung ulang NKO untuk memperbarui nilai.' : 'Usulan ditolak.', 'data' => $result]);
    }

    /** DELETE /nko/rule-proposals/{id}: pengusul membatalkan usulan yang masih menunggu. */
    public function cancel(Request $request, string $proposal): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $this->guard(fn () => $this->proposalService->cancel($proposal, $request->user()));

        return response()->json(['message' => 'Usulan dibatalkan.']);
    }

    private function guard(callable $action): mixed
    {
        try {
            return $action();
        } catch (NkoRuleException $e) {
            throw new AdministrationDenied($e->getMessage(), $e->status);
        }
    }

    /** @return array<string, list<string>> */
    private function inputRules(): array
    {
        return ['inputs' => ['nullable', 'array', 'max:10'], 'inputs.*.code' => ['required', 'string', 'max:60'], 'inputs.*.name' => ['required', 'string', 'max:200'], 'inputs.*.unit_label' => ['nullable', 'string', 'max:40']];
    }

    /** @return list<array{code: string, name: string, unit_label: ?string}> */
    private function declaredInputs(array $validated): array
    {
        return array_map(fn (array $i) => ['code' => $i['code'], 'name' => $i['name'], 'unit_label' => $i['unit_label'] ?? null], array_values($validated['inputs'] ?? []));
    }

    private function inputList(array $inputs): array
    {
        return array_map(fn (string $code, array $i) => ['code' => $code] + $i, array_keys($inputs), array_values($inputs));
    }
}
