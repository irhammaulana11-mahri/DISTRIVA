<?php

namespace App\Services\Nko;

use App\Services\Analytics\BusinessTargetService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Pencocokan definisi NKO dengan aturan realisasi (docs/93 tahap 3), agar item yang berganti nama tidak putus diam-diam. Hanya membaca dan melaporkan; tidak mengubah aturan.
 */
class NkoMappingCheckService
{
    /** skor minimal (0 sampai 1) agar sebuah item disarankan sebagai pengganti */
    private const MIN_SCORE = 0.6;

    public function __construct(private readonly NkoRealizationRules $rules) {}

    /**
     * @return array{
     *     year: int,
     *     changes: array<string, array{compared_with: ?string, added: list<array{code: string, name: string}>, removed: list<array{code: string, name: string}>}>,
     *     orphaned: list<array{code: string, name: ?string, formula: string, manual_inputs: int, linked_menus: list<string>, suggestions: list<array{code: string, name: string, level: string, score: float}>}>,
     *     unmapped: list<array{code: string, name: string, levels: list<string>}>
     * }
     */
    public function check(int $year): array
    {
        $sets = DB::table('kpi_definition_sets')->where('year', $year)->where('status', 'AKTIF')->orderByDesc('unit_level')->get(['id', 'unit_level', 'version']);
        $rules = $this->rules->forPeriod($year, 12);

        $current = [];      // level => kode => definisi
        $changes = [];
        foreach ($sets as $set) {
            $current[$set->unit_level] = $this->definitions($set->id);
            $previous = $this->previousSet($year, $set->unit_level, (int) $set->version);
            $before = $previous === null ? [] : $this->definitions($previous->id);
            $brief = fn (object $d) => ['code' => $d->code, 'name' => $d->name];
            $changes[$set->unit_level] = [
                'compared_with' => $previous === null ? null : "{$previous->year} v{$previous->version}",
                'added' => $previous === null ? [] : array_values(array_map($brief, array_diff_key($current[$set->unit_level], $before))),
                'removed' => array_values(array_map($brief, array_diff_key($before, $current[$set->unit_level]))),
            ];
        }
        if ($current === []) {
            return ['year' => $year, 'changes' => [], 'orphaned' => [], 'unmapped' => []];
        }

        // hanya indikator yang butuh realisasi (punya lembar sumber, sama dengan daftar masukan NKO)
        $unmapped = [];
        foreach ($current as $level => $definitions) {
            foreach ($definitions as $code => $d) {
                if (! empty($d->source_sheet) && ! isset($rules[$code])) {
                    $unmapped[$code] ??= ['code' => $code, 'name' => $d->name, 'levels' => []];
                    $unmapped[$code]['levels'][] = $level;
                }
            }
        }

        $orphaned = [];
        foreach ($rules as $code => $rule) {
            if (array_filter($current, fn (array $definitions) => isset($definitions[$code])) !== []) {
                continue;
            }
            $old = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('d.code', $code)->where('s.year', '<=', $year)
                ->orderByDesc('s.year')->orderByDesc('s.version')->first(['d.name', 'd.source_sheet', 'd.unit_label', 'd.polarity', 's.unit_level']);
            $orphaned[] = [
                'code' => $code, 'name' => $old?->name, 'formula' => $rule->formula,
                'manual_inputs' => DB::table('kpi_manual_inputs')->where('definition_code', $code)->whereBetween('period', ["{$year}-01-01", "{$year}-12-01"])->count(),
                'linked_menus' => array_keys(array_filter(BusinessTargetService::LINKS, fn (array $links) => in_array($code, array_column($links, 'code'), true))),
                'suggestions' => $old === null ? [] : $this->suggestions($old, $current, $unmapped),
            ];
        }

        return ['year' => $year, 'changes' => $changes, 'orphaned' => $orphaned, 'unmapped' => array_values($unmapped)];
    }

    /** set sebelumnya pada tingkat yang sama: versi lebih lama tahun itu, atau set terakhir tahun sebelumnya */
    private function previousSet(int $year, string $level, int $version): ?object
    {
        return DB::table('kpi_definition_sets')->where('unit_level', $level)
            ->where(fn ($q) => $q->where('year', '<', $year)->orWhere(fn ($w) => $w->where('year', $year)->where('version', '<', $version)))
            ->orderByDesc('year')->orderByDesc('version')->first(['id', 'year', 'version']);
    }

    /** @return array<string, object> menurut kode */
    private function definitions(string $setId): array
    {
        return DB::table('kpi_definitions')->where('set_id', $setId)->orderBy('sort_order')->get(['code', 'name', 'source_sheet', 'unit_label', 'polarity'])->keyBy('code')->all();
    }

    /**
     * Calon pengganti hanya dari item belum dipetakan, pada tingkat unit yang sama. Skor: kemiripan nama (0,6), lembar sumber sama (0,2), satuan sama (0,1), polaritas sama (0,1).
     *
     * @param  array<string, array<string, object>>  $current
     * @param  array<string, array{code: string, name: string, levels: list<string>}>  $unmapped
     * @return list<array{code: string, name: string, level: string, score: float}>
     */
    private function suggestions(object $old, array $current, array $unmapped): array
    {
        $same = fn (mixed $a, mixed $b) => $a !== null && Str::lower(trim((string) $a)) === Str::lower(trim((string) $b)) ? 1 : 0;
        $out = [];
        foreach (array_intersect_key($current[$old->unit_level] ?? [], $unmapped) as $code => $d) {
            similar_text(Str::lower($old->name), Str::lower($d->name), $percent);
            $score = 0.6 * $percent / 100 + 0.2 * $same($old->source_sheet, $d->source_sheet) + 0.1 * $same($old->unit_label, $d->unit_label) + 0.1 * $same($old->polarity, $d->polarity);
            if ($score >= self::MIN_SCORE) {
                $out[] = ['code' => $code, 'name' => $d->name, 'level' => $old->unit_level, 'score' => round($score, 2)];
            }
        }
        usort($out, fn (array $a, array $b) => $b['score'] <=> $a['score']);

        return array_slice($out, 0, 3);
    }
}
