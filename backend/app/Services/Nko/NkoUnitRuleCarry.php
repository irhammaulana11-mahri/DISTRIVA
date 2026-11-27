<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/**
 * Menentukan aturan khusus unit versi aktif yang dapat dibawa ke definisi baru yang tidak memuat tab unit (docs/93 §13). Aturan dibawa bila rumus dasar
 * itemnya (setelah nomor baris disesuaikan menurut KODE) tidak berubah; bila berubah, aturan lama tidak dapat dipercaya lagi.
 */
class NkoUnitRuleCarry
{
    private const PARTS = ['pencapaian', 'nilai', 'months'];

    /**
     * @param  list<array<string, mixed>>  $nodes  item definisi baru (hasil pembaca)
     * @return array{keep: list<array{code: string, organizational_unit_id: string, rules: array<string, mixed>}>, dropped: list<array{code: string, name: string, units: list<string>}>}
     */
    public function plan(string $setId, array $nodes): array
    {
        $new = array_column($nodes, null, 'code');
        $old = DB::table('kpi_definitions')->where('set_id', $setId)->get(['code', 'name', 'row_no', 'rules'])->keyBy('code');
        $rows = [];
        foreach ($old as $code => $d) {
            if (isset($new[$code])) {
                $rows[(int) $d->row_no] = (int) $new[$code]['row_no'];
            }
        }

        $keep = [];
        $dropped = [];
        $unitRules = DB::table('kpi_unit_rules as r')->join('kpi_definitions as d', 'd.id', '=', 'r.definition_id')->join('organizational_units as u', 'u.id', '=', 'r.organizational_unit_id')
            ->where('d.set_id', $setId)->orderBy('u.name')->get(['d.code', 'r.organizational_unit_id', 'u.name as unit_name', 'r.rules']);
        foreach ($unitRules as $rule) {
            $node = $new[$rule->code] ?? null;
            if ($node === null) {
                continue;     // item hilang sudah dilaporkan sebagai item hilang
            }
            $before = array_intersect_key(json_decode($old[$rule->code]->rules ?? '[]', true) ?: [], array_flip(self::PARTS));
            $after = array_intersect_key($node['rules'], array_flip(self::PARTS));
            if (NkoSheetFormula::compact(NkoSheetFormula::moveRows($before, $rows)) != NkoSheetFormula::compact($after)) {
                $dropped[$rule->code] ??= ['code' => $rule->code, 'name' => $old[$rule->code]->name, 'units' => []];
                $dropped[$rule->code]['units'][] = $rule->unit_name;

                continue;
            }
            $keep[] = ['code' => $rule->code, 'organizational_unit_id' => $rule->organizational_unit_id, 'rules' => NkoSheetFormula::moveRows(json_decode($rule->rules, true) ?: [], $rows)];
        }

        return ['keep' => $keep, 'dropped' => array_values($dropped)];
    }
}
