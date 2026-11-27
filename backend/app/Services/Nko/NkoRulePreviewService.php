<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/** Pratinjau rumus sebelum diusulkan: hasil usulan, hasil aturan sekarang, dan angka acuan workbook per unit dan bulan (docs/93 tahap 4). Hanya membaca. */
class NkoRulePreviewService
{
    /** toleransi cocok dengan angka workbook (sama dengan uji pencocokan docs/92 §10) */
    public const TOLERANCE_PCT = 0.5;

    public function __construct(private readonly NkoRealizationRules $rules, private readonly NkoRealizationResolver $resolver) {}

    /**
     * @param  array<string, array{name: string, unit_label: ?string}>  $inputs  masukan yang dideklarasikan usulan, menurut kode
     * @param  list<string>|null  $unitIds  unit yang boleh dilihat; null = semua
     * @return array{rows: list<array<string, mixed>>, summary: array{with_value: int, compared: int, matched: int, tolerance_pct: float}}
     */
    public function preview(string $code, string $formula, array $inputs, int $year, int $toMonth, ?array $unitIds): array
    {
        $proposed = (object) ['formula' => $formula, 'inputs' => $inputs, 'mode' => 'SISTEM_BOLEH_KOREKSI'];
        // acuan workbook dan daftar unit: hanya unit yang tingkatnya memuat indikator ini
        $inForce = NkoDefinitionSets::months($year, 'UP3') + NkoDefinitionSets::months($year, 'ULP');
        $definitions = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->whereIn('s.id', array_keys($inForce))->where('d.code', $code)->get(['d.id', 's.id as set_id', 's.unit_level']);
        $units = DB::table('organizational_units')->whereIn('unit_type', $definitions->pluck('unit_level'))->when($unitIds !== null, fn ($q) => $q->whereIn('id', $unitIds))
            ->orderByDesc('unit_type')->orderBy('name')->get(['id', 'name', 'unit_type']);
        $query = DB::table('kpi_reference_values as v')->join('kpi_definitions as d', 'd.id', '=', 'v.definition_id')->whereIn('v.definition_id', $definitions->pluck('id'))->whereBetween('v.period', ["{$year}-01-01", "{$year}-12-01"]);
        NkoDefinitionSets::scope($query, $inForce, 'd.set_id', 'v.period');
        $reference = $query->get(['v.organizational_unit_id', 'v.period', 'v.realisasi'])->keyBy(fn ($r) => $r->organizational_unit_id.'|'.(int) substr((string) $r->period, 5, 2));

        $rows = [];
        $summary = ['with_value' => 0, 'compared' => 0, 'matched' => 0, 'tolerance_pct' => self::TOLERANCE_PCT];
        foreach (range(1, $toMonth) as $month) {
            $current = $this->rules->forPeriod($year, $month)[$code] ?? null;
            foreach ($units as $u) {
                $value = $this->resolver->evaluate($proposed, $u->id, $year, $month);
                $now = $current === null || $current->mode === 'MANUAL' ? null : $this->resolver->evaluate($current, $u->id, $year, $month);
                $ref = $reference->get("{$u->id}|{$month}")?->realisasi;
                $ref = $ref === null ? null : (float) $ref;
                if ($value === null && $now === null && $ref === null) {
                    continue;
                }
                $matches = $value === null || $ref === null ? null : abs($value - $ref) <= max(abs($ref) * self::TOLERANCE_PCT / 100, 1e-6);
                $summary['with_value'] += $value === null ? 0 : 1;
                $summary['compared'] += $matches === null ? 0 : 1;
                $summary['matched'] += $matches === true ? 1 : 0;
                $rows[] = ['unit_id' => $u->id, 'unit_name' => $u->name, 'unit_type' => $u->unit_type, 'month' => $month, 'proposed' => $value, 'current' => $now, 'reference' => $ref, 'matches' => $matches];
            }
        }

        return ['rows' => $rows, 'summary' => $summary];
    }
}
