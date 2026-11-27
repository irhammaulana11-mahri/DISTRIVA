<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;

/**
 * Versi definisi yang berlaku untuk suatu bulan (docs/93 §14): versi bernomor tertinggi pada tahun dan tingkat itu yang `effective_month`-nya tidak melewati bulan tsb.
 * Status AKTIF berarti versi terbaru (dasar perubahan berikutnya); versi ARSIP tetap dipakai untuk bulan sebelum versi terbaru berlaku.
 */
class NkoDefinitionSets
{
    public static function forMonth(int $year, string $level, int $month): ?object
    {
        return DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('effective_month', '<=', $month)->orderByDesc('version')->first();
    }

    /** @return array<int, object> bulan => set; bulan tanpa versi tidak ada */
    public static function byMonth(int $year, string $level): array
    {
        $sets = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->orderByDesc('version')->get()->all();
        $out = [];
        for ($month = 1; $month <= 12; $month++) {
            foreach ($sets as $set) {
                if ((int) $set->effective_month <= $month) {
                    $out[$month] = $set;

                    break;
                }
            }
        }

        return $out;
    }

    /**
     * Pengelompokan bulan per set, untuk menyalin atau membaca data bulanan dari versi yang berlaku.
     *
     * @return array<string, list<int>> id set => bulan
     */
    public static function months(int $year, string $level, int $from = 1): array
    {
        $out = [];
        foreach (self::byMonth($year, $level) as $month => $set) {
            if ($month >= $from) {
                $out[$set->id][] = $month;
            }
        }

        return $out;
    }

    /**
     * Membatasi kueri berkolom `{set}` dan `{period}` pada baris yang berasal dari versi yang berlaku di bulan itu.
     *
     * @param  array<string, list<int>>  $months  hasil `months()`
     */
    public static function scope(object $query, array $months, string $setColumn, string $periodColumn): void
    {
        $query->where(function ($q) use ($months, $setColumn, $periodColumn) {
            $q->whereRaw('false');
            foreach ($months as $setId => $list) {
                $q->orWhere(fn ($g) => $g->where($setColumn, $setId)->whereRaw("extract(month from {$periodColumn})::int in (".implode(',', array_map('intval', $list)).')'));
            }
        });
    }

    /**
     * Target satu unit menurut kode item dan bulan, masing-masing dari versi yang berlaku di bulan itu.
     *
     * @return array<string, array<string, array<int, array{value: ?float, text: ?string}>>> id unit => kode => bulan => target
     */
    public static function targets(int $year, string $level): array
    {
        $months = self::months($year, $level);
        if ($months === []) {
            return [];
        }
        $out = [];
        $rows = DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->whereYear('t.period', $year);
        self::scope($rows, $months, 'd.set_id', 't.period');
        foreach ($rows->get(['d.code', 't.organizational_unit_id', 't.period', 't.target_value', 't.target_text']) as $t) {
            $out[$t->organizational_unit_id][$t->code][(int) substr((string) $t->period, 5, 2)] = ['value' => $t->target_value === null ? null : (float) $t->target_value, 'text' => $t->target_text];
        }

        return $out;
    }
}
