<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/**
 * Aturan realisasi yang berlaku pada satu periode (docs/93): per indikator dipakai baris `effective_from` terbaru yang tidak melewati periode itu.
 */
class NkoRealizationRules
{
    /**
     * @return array<string, object{formula: string, inputs: array<string, array{name: string, unit_label: ?string}>, is_validated: bool, flag_when_negative: bool}> menurut kode indikator
     */
    public function forPeriod(int $year, int $month): array
    {
        $rows = DB::table('kpi_realization_rules')->where('effective_from', '<=', sprintf('%04d-%02d-01', $year, $month))
            ->orderBy('effective_from')->get(['definition_code', 'formula', 'inputs', 'is_validated', 'flag_when_negative']);

        return $rows->map(function (object $row) {
            $row->inputs = collect(json_decode($row->inputs ?? '[]', true))->mapWithKeys(fn (array $i) => [$i['code'] => ['name' => $i['name'], 'unit_label' => $i['unit_label'] ?? null]])->all();

            return $row;
        })->keyBy('definition_code')->all();
    }

    /**
     * Masukan manual yang diperlukan rumus periode itu: masukan pembantu bawaan katalog, lalu masukan yang dideklarasikan aturan.
     *
     * @return list<array{owner: string, code: string, name: string, unit_label: ?string}> `owner` = kode indikator pemakainya
     */
    public function auxiliaryInputs(int $year, int $month): array
    {
        $rules = $this->forPeriod($year, $month);
        $variables = array_map(fn (object $rule) => NkoFormula::parse($rule->formula)->variables(), $rules);
        $out = [];
        foreach (NkoSourceCatalog::AUXILIARY as $auxiliary) {      // urutan mengikuti katalog, bukan urutan baris database
            foreach ($variables as $owner => $used) {
                if (array_intersect($used, $auxiliary['used_by']) !== []) {
                    foreach ($auxiliary['inputs'] as $code => $name) {
                        $out[] = ['owner' => $owner, 'code' => $code, 'name' => $name, 'unit_label' => $auxiliary['unit_label']];
                    }
                }
            }
        }
        foreach ($rules as $owner => $rule) {
            foreach ($rule->inputs as $code => $input) {
                $out[] = ['owner' => $owner, 'code' => $code] + $input;
            }
        }

        return $out;
    }
}
