<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/** Memuat definisi dari database, menjalankan mesin hitung, dan merekonsiliasinya dengan angka workbook (docs/90). */
class NkoCalculationService
{
    public function __construct(private readonly NkoCalculator $calculator) {}

    /**
     * Baris definisi satu set berbentuk larik yang dimengerti mesin hitung.
     *
     * @return list<array<string, mixed>>
     */
    public function nodes(string $setId, ?string $unitId = null): array
    {
        $overrides = $unitId === null ? [] : DB::table('kpi_unit_rules as r')->join('kpi_definitions as d', 'd.id', '=', 'r.definition_id')
            ->where('d.set_id', $setId)->where('r.organizational_unit_id', $unitId)->pluck('r.rules', 'r.definition_id')->all();

        return DB::table('kpi_definitions')->where('set_id', $setId)->orderBy('sort_order')->get()->map(function ($d) use ($overrides) {
            $rules = json_decode($d->rules ?? '[]', true) ?: [];
            if (isset($overrides[$d->id])) {
                unset($rules['pencapaian'], $rules['nilai'], $rules['months']);
                $rules = json_decode($overrides[$d->id], true) + $rules;
            }

            return [
                'id' => $d->id, 'row_no' => (int) $d->row_no, 'code' => $d->code, 'level' => (int) $d->level, 'polarity' => $d->polarity !== null ? (int) $d->polarity : null,
                'unit_label' => $d->unit_label, 'weight' => $d->weight !== null ? (float) $d->weight : null, 'weight_note' => $d->weight_note, 'rules' => $rules,
            ];
        })->all();
    }

    /**
     * Rekonsiliasi: realisasi dari workbook dimasukkan ke mesin hitung dan hasilnya dibandingkan dengan pencapaian, nilai, total, dan NKO akhir pada workbook.
     *
     * @return array{compared_units: int, rows_compared: int, rows_mismatch: int, totals_mismatch: int, mismatches: list<string>}
     */
    public function reconcile(int $year, ?int $month = null, ?string $unitCode = null, float $tolerance = 0.0001): array
    {
        $out = ['compared_units' => 0, 'rows_compared' => 0, 'rows_mismatch' => 0, 'totals_mismatch' => 0, 'mismatches' => []];
        // tiap bulan direkonsiliasi pada versi yang berlaku di bulan itu
        $inForce = NkoDefinitionSets::months($year, 'UP3') + NkoDefinitionSets::months($year, 'ULP');
        $sets = DB::table('kpi_definition_sets')->whereIn('id', array_keys($inForce))->get();
        foreach ($sets as $set) {
            $rules = json_decode($set->month_rules, true)['months'] ?? [];
            $totals = DB::table('kpi_reference_totals as t')->join('organizational_units as u', 'u.id', '=', 't.organizational_unit_id')
                ->where('t.set_id', $set->id)->when($month, fn ($q) => $q->whereMonth('t.period', $month))->when($unitCode, fn ($q) => $q->where('u.code', $unitCode))
                ->get(['t.organizational_unit_id', 'u.code', 'u.name', 't.period', 't.total', 't.nko']);
            foreach ($totals as $t) {
                $m = (int) substr($t->period, 5, 2);
                $rule = $rules[(string) $m] ?? null;
                if ($rule === null || ! in_array($m, $inForce[$set->id], true)) {
                    continue;
                }
                $nodes = $this->nodes($set->id, $t->organizational_unit_id);
                $byId = array_column($nodes, null, 'id');
                $ref = DB::table('kpi_reference_values as v')->join('kpi_definitions as d', 'd.id', '=', 'v.definition_id')
                    ->where('d.set_id', $set->id)->where('v.organizational_unit_id', $t->organizational_unit_id)->where('v.period', $t->period)->get(['v.definition_id', 'v.realisasi', 'v.pencapaian', 'v.nilai']);
                $tg = DB::table('kpi_targets as k')->join('kpi_definitions as d', 'd.id', '=', 'k.definition_id')
                    ->where('d.set_id', $set->id)->where('k.organizational_unit_id', $t->organizational_unit_id)->where('k.period', $t->period)->get(['k.definition_id', 'k.target_value', 'k.target_text']);
                $targets = [];
                foreach ($tg as $x) {
                    $targets[$byId[$x->definition_id]['row_no']] = ['value' => $x->target_value !== null ? (float) $x->target_value : null, 'text' => $x->target_text];
                }
                $real = [];
                foreach ($ref as $x) {
                    $real[$byId[$x->definition_id]['row_no']] = $x->realisasi !== null ? (float) $x->realisasi : null;
                }
                $res = $this->calculator->calculate($nodes, $targets, $real, $rule, $m);
                $out['compared_units']++;
                foreach ($ref as $x) {
                    $row = $byId[$x->definition_id]['row_no'];
                    foreach (['pencapaian', 'nilai'] as $f) {
                        if ($x->{$f} === null) {
                            continue;
                        }
                        $out['rows_compared']++;
                        $got = $res['rows'][$row][$f];
                        if ($got === null || abs($got - (float) $x->{$f}) > $tolerance) {
                            $out['rows_mismatch']++;
                            if (count($out['mismatches']) < 40) {
                                $out['mismatches'][] = "{$set->unit_level} {$t->name} bln {$m} baris {$row} ({$byId[$x->definition_id]['code']}) {$f}: workbook {$x->{$f}}, hitung ".($got ?? 'null');
                            }
                        }
                    }
                }
                foreach (['total' => 'total', 'nko' => 'nko'] as $f => $k) {
                    if ($t->{$f} === null) {
                        continue;
                    }
                    $got = $res[$k];
                    if ($got === null || abs($got - (float) $t->{$f}) > $tolerance) {
                        $out['totals_mismatch']++;
                        if (count($out['mismatches']) < 40) {
                            $out['mismatches'][] = "{$set->unit_level} {$t->name} bln {$m} {$f}: workbook {$t->{$f}}, hitung ".($got ?? 'null');
                        }
                    }
                }
            }
        }

        return $out;
    }
}
