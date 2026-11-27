<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Membandingkan isi workbook (hasil `NkoDefinitionImportService::analyze()`) dengan definisi yang berlaku, sebelum diaktifkan (docs/93 tahap 5). Hanya membaca.
 * Pembanding: set aktif tahun itu; bila belum ada, set aktif tahun terakhir sebelumnya (target tidak dibandingkan antartahun).
 */
class NkoDefinitionDiffService
{
    private const FIELDS = ['name', 'level', 'polarity', 'unit_label', 'weight', 'weight_note', 'formula_text', 'source_sheet', 'scoring_rule', 'nilai_rule'];

    /** skor minimal agar pasangan item hilang dan item baru disarankan sebagai ganti nama */
    private const MIN_SCORE = 0.6;

    public function __construct(private readonly NkoRealizationRules $rules) {}

    /**
     * @param  array<string, mixed>  $book  hasil `analyze()`
     * @return list<array{level: string, status: string, compared_with: ?string, items: int,
     *     added: list<array{code: string, name: string, weight: ?float, needs_realization: bool, has_rule: bool}>,
     *     removed: list<array{code: string, name: string, weight: ?float, has_rule: bool}>,
     *     possible_renames: list<array{from_code: string, from_name: string, to_code: string, to_name: string, score: float}>,
     *     changed: list<array{code: string, name: string, fields: array<string, array{from: mixed, to: mixed}>}>,
     *     total_rule_changed: bool, targets_changed: array<string, int>, units: list<string>, warnings: list<string>, alerts: list<string>}>
     */
    public function diff(array $book): array
    {
        $rules = $this->rules->forPeriod($book['year'], 12);
        $out = [];
        foreach ($book['levels'] as $level => $plan) {
            $base = $plan['active'] ?? DB::table('kpi_definition_sets')->where('unit_level', $level)->where('year', '<', $book['year'])->where('status', 'AKTIF')->orderByDesc('year')->first();
            $result = ['level' => $level, 'status' => $plan['status'], 'compared_with' => $base === null ? null : "{$base->year} v{$base->version}", 'items' => count($plan['canon']['nodes']),
                'added' => [], 'removed' => [], 'possible_renames' => [], 'changed' => [], 'total_rule_changed' => false, 'targets_changed' => [], 'alerts' => [],
                'units' => array_values(array_map(fn (array $s) => $s['unit_name'], array_filter($plan['sheets'], fn (array $s) => isset($plan['unit_ids'][$s['sheet']])))), 'warnings' => $plan['warnings']];
            if ($base !== null && in_array($plan['status'], ['BARU', 'DIGANTIKAN'], true)) {
                $result = $this->compare($result, $base, $plan, $book['year'], $rules);
            }
            $out[] = $result;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $result
     * @param  array<string, mixed>  $plan
     * @param  array<string, object>  $rules
     * @return array<string, mixed>
     */
    private function compare(array $result, object $base, array $plan, int $year, array $rules): array
    {
        $old = DB::table('kpi_definitions')->where('set_id', $base->id)->orderBy('sort_order')->get()->keyBy('code')->all();
        $new = array_column($plan['canon']['nodes'], null, 'code');
        $weight = fn (mixed $w) => $w === null ? null : (float) $w;

        foreach (array_diff_key($new, $old) as $code => $n) {
            $result['added'][] = ['code' => $code, 'name' => $n['name'], 'weight' => $weight($n['weight']), 'needs_realization' => ! empty($n['source_sheet']), 'has_rule' => isset($rules[$code])];
        }
        foreach (array_diff_key($old, $new) as $code => $o) {
            $result['removed'][] = ['code' => $code, 'name' => $o->name, 'weight' => $weight($o->weight), 'has_rule' => isset($rules[$code])];
        }
        $result['possible_renames'] = $this->renames(array_diff_key($old, $new), array_diff_key($new, $old));

        foreach (array_intersect_key($new, $old) as $code => $n) {
            $fields = $this->changedFields($old[$code], $n);
            if ($fields !== []) {
                $result['changed'][] = ['code' => $code, 'name' => $n['name'], 'fields' => $fields];
            }
        }

        $formulas = fn (array $months) => array_map(fn (array $m) => [$this->comparable($m['total_formula'] ?? null, (int) ($m['total_row'] ?? 0)), $this->comparable($m['final_formula'] ?? null, (int) ($m['final_row'] ?? 0))], array_filter($months, 'is_array'));
        $oldMonths = (json_decode($base->month_rules ?? '[]', true) ?: [])['months'] ?? [];
        $result['total_rule_changed'] = $formulas($oldMonths) != $formulas($plan['canon']['month_rules']);

        if ((int) $base->year === $year) {
            $result['targets_changed'] = $this->changedTargets($base->id, $plan, array_intersect_key($new, $old));
        }
        $result['alerts'] = $this->alerts($result, $base, $old, $new, $year);

        return $result;
    }

    /**
     * Hal yang perlu diperhatikan penyetuju: unit yang hilang, jumlah indikator turun tajam, item beraturan yang hilang, dan dugaan ganti nama.
     *
     * @param  array<string, mixed>  $result
     * @param  array<string, object>  $old
     * @param  array<string, array<string, mixed>>  $new
     * @return list<string>
     */
    private function alerts(array $result, object $base, array $old, array $new, int $year): array
    {
        $alerts = [];
        $units = DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->join('organizational_units as u', 'u.id', '=', 't.organizational_unit_id')
            ->where('d.set_id', $base->id)->distinct()->orderBy('u.name')->pluck('u.name')->all();
        $kept = array_map(fn (string $name) => Str::lower($result['level'].' '.$name), $result['units']);
        $missing = array_values(array_filter($units, fn (string $name) => ! in_array(Str::lower($name), $kept, true) && ! in_array(Str::lower($result['level'].' '.$name), $kept, true)));
        if ($missing !== []) {
            $alerts[] = 'Unit '.implode(', ', $missing)." punya target di versi {$result['compared_with']} tetapi tidak ada di workbook; "
                .((int) $base->year === $year ? 'targetnya disalin dari versi itu.' : 'versi baru tidak akan memuat targetnya.');
        }
        $indicators = fn (array $rows) => count(array_filter($rows, fn (mixed $d) => (is_array($d) ? $d['polarity'] : $d->polarity) !== null));
        [$before, $after] = [$indicators($old), $indicators($new)];
        if ($before > 0 && $after < $before * 0.8) {
            $alerts[] = "Jumlah indikator turun dari {$before} menjadi {$after}.";
        }
        $ruled = array_column(array_filter($result['removed'], fn (array $r) => $r['has_rule']), 'name');
        if ($ruled !== []) {
            $alerts[] = 'Item hilang yang punya aturan realisasi: '.implode(', ', $ruled).'.';
        }
        $unknown = array_map(fn (array $n) => "{$n['code']} ({$n['name']})", array_filter(array_diff_key($new, $old), fn (array $n) => $n['code_given'] ?? false));
        if ($unknown !== []) {
            $alerts[] = 'KODE '.implode(', ', $unknown)." tidak ada di versi {$result['compared_with']}; dianggap item baru. Bila ini item lama, perbaiki KODE-nya agar target dan aturannya tetap tersambung.";
        }
        if ($result['possible_renames'] !== []) {
            $alerts[] = count($result['possible_renames']).' item kemungkinan berganti nama. Setelah disetujui, usulkan aturan untuk nama baru dengan menunjuk kode lama.';
        }

        return $alerts;
    }

    /** @return array<string, array{from: mixed, to: mixed}> */
    private function changedFields(object $old, array $new): array
    {
        $fields = [];
        foreach (self::FIELDS as $f) {
            $from = $old->{$f};
            $to = $f === 'name' ? mb_substr($new['name'], 0, 300) : $new[$f];
            if ($f === 'weight') {
                $from = $from === null ? null : (float) $from;
                $to = $to === null ? null : (float) $to;
            }
            if ($from !== $to) {
                $fields[$f] = ['from' => $from, 'to' => $to];
            }
        }
        $before = json_decode($old->rules ?? '[]', true) ?: [];
        foreach (['pencapaian' => 'scoring_formula', 'nilai' => 'value_formula', 'months' => 'monthly_formulas'] as $part => $field) {
            if ($this->comparable($before[$part] ?? null, (int) $old->row_no) != $this->comparable($new['rules'][$part] ?? null, (int) $new['row_no'])) {
                $fields[$field] = ['from' => $before[$part] ?? null, 'to' => $new['rules'][$part] ?? null];
            }
        }

        return $fields;
    }

    /**
     * Bentuk rumus untuk dibandingkan: di luar tanda kutip spasi dibuang, huruf dijadikan kapital, dan FALSE()/TRUE() (tulisan LibreOffice) disamakan dengan FALSE/TRUE; nomor baris dijadikan jarak dari baris item agar menyisipkan baris di workbook tidak terbaca sebagai rumus berubah.
     */
    private function comparable(mixed $rules, int $row): mixed
    {
        if (is_array($rules)) {
            return array_map(fn (mixed $r) => $this->comparable($r, $row), $rules);
        }
        if (! is_string($rules)) {
            return $rules;
        }
        $compact = preg_replace_callback('/"[^"]*"|[^"]+/', fn (array $m) => str_starts_with($m[0], '"') ? $m[0] : str_replace(['FALSE()', 'TRUE()'], ['FALSE', 'TRUE'], strtoupper((string) preg_replace('/\s+/', '', $m[0]))), $rules);

        return preg_replace_callback('/(?<![A-Za-z])(\$?[A-Z]{1,3}\$?)(\d+)(?![\d(A-Za-z])/', fn (array $m) => $m[1].'{'.((int) $m[2] - $row).'}', $compact);
    }

    /**
     * Jumlah target bulanan yang berbeda per unit, untuk item yang ada di kedua versi.
     *
     * @param  array<string, mixed>  $plan
     * @param  array<string, array<string, mixed>>  $shared  item lama dan baru, menurut kode
     * @return array<string, int> nama unit => jumlah
     */
    private function changedTargets(string $setId, array $plan, array $shared): array
    {
        $key = fn (mixed $value, ?string $text) => ($value === null ? '' : number_format((float) $value, 6, '.', '')).'|'.$text;
        $stored = [];
        foreach (DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->where('d.set_id', $setId)->get(['d.code', 't.organizational_unit_id', 't.period', 't.target_value', 't.target_text']) as $t) {
            $stored[$t->organizational_unit_id][$t->code.'|'.(int) substr($t->period, 5, 2)] = $key($t->target_value, $t->target_text);
        }

        $out = [];
        foreach ($plan['sheets'] as $sheet) {
            $unitId = $plan['unit_ids'][$sheet['sheet']] ?? null;
            if ($unitId === null) {
                continue;
            }
            $codes = array_column($sheet['nodes'], 'code', 'row_no');
            $incoming = [];
            $filled = [];
            foreach ($sheet['targets'] as $row => $months) {
                $code = $codes[$row] ?? null;
                foreach ($code !== null && isset($shared[$code]) ? $months : [] as $month => $t) {
                    $incoming[$code.'|'.$month] = $key($t['value'], $t['text']);
                    $filled[$code] = true;
                }
            }
            // item yang sama sekali tidak diisi workbook disalin dari versi aktif, jadi bukan perubahan
            $before = array_filter($stored[$unitId] ?? [], fn (string $k) => isset($filled[Str::before($k, '|')]), ARRAY_FILTER_USE_KEY);
            $count = count(array_filter(array_keys($incoming + $before), fn (string $k) => ($incoming[$k] ?? null) !== ($before[$k] ?? null)));
            if ($count > 0) {
                $out[$sheet['unit_name']] = $count;
            }
        }

        return $out;
    }

    /**
     * Satu pasangan terbaik per item hilang. Skor: kemiripan nama (0,6), lembar sumber sama (0,2), satuan sama (0,1), polaritas sama (0,1).
     *
     * @param  array<string, object>  $removed
     * @param  array<string, array<string, mixed>>  $added
     * @return list<array{from_code: string, from_name: string, to_code: string, to_name: string, score: float}>
     */
    private function renames(array $removed, array $added): array
    {
        $same = fn (mixed $a, mixed $b) => $a !== null && Str::lower(trim((string) $a)) === Str::lower(trim((string) $b)) ? 1 : 0;
        $out = [];
        foreach ($removed as $from => $o) {
            $best = null;
            foreach ($added as $to => $n) {
                similar_text(Str::lower($o->name), Str::lower($n['name']), $percent);
                $score = 0.6 * $percent / 100 + 0.2 * $same($o->source_sheet, $n['source_sheet']) + 0.1 * $same($o->unit_label, $n['unit_label']) + 0.1 * $same($o->polarity, $n['polarity']);
                if ($score >= self::MIN_SCORE && ($best === null || $score > $best['score'])) {
                    $best = ['from_code' => $from, 'from_name' => $o->name, 'to_code' => $to, 'to_name' => $n['name'], 'score' => round($score, 2)];
                }
            }
            if ($best !== null) {
                $out[] = $best;
            }
        }

        return $out;
    }
}
