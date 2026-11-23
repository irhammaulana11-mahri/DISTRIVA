<?php

namespace App\Services\Nko;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Menghitung NKO satu unit untuk satu bulan dan menyimpannya sebagai snapshot yang menunjuk ke set definisi yang dipakai (docs/90).
 * Satu snapshot berlaku per unit dan bulan; menghitung ulang menjadikan yang lama riwayat. Peringkat dihitung antar ULP satu UP3 pada bulan yang sama.
 */
class NkoSnapshotService
{
    public function __construct(private readonly NkoCalculator $calculator, private readonly NkoCalculationService $nodes, private readonly NkoRealizationResolver $resolver) {}

    /**
     * Indikator yang harus punya realisasi pada bulan itu: punya sumber realisasi dan pencapaiannya bukan nilai tetap.
     *
     * @param  array<string, mixed>  $node
     */
    public function needsRealisasi(array $node, int $month): bool
    {
        $rules = $node['rules'];
        $capai = array_key_exists('pencapaian', $rules['months'][$month] ?? []) ? $rules['months'][$month]['pencapaian'] : ($rules['pencapaian'] ?? null);

        return $capai !== null && $capai !== '' && ! is_numeric($capai) && ! empty($node['source_sheet']);
    }

    /**
     * @return array{snapshot_id: string, unit_id: string, unit_name: string, period: string, nko: ?float, total_nilai: ?float, missing_count: int, rank: ?int, rank_of: ?int}
     */
    public function calculate(string $unitId, int $year, int $month, ?User $user = null): array
    {
        $unit = DB::table('organizational_units')->where('id', $unitId)->first(['id', 'name', 'unit_type', 'parent_id']);
        if ($unit === null || ! in_array($unit->unit_type, ['ULP', 'UP3'], true)) {
            throw new NkoCalculationException('Unit tidak ditemukan atau bukan ULP/UP3.');
        }
        $set = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $unit->unit_type)->where('status', 'AKTIF')->first();
        if ($set === null) {
            throw new NkoCalculationException("Definisi NKO {$year} untuk tingkat {$unit->unit_type} belum diimpor.");
        }
        $monthRule = (json_decode($set->month_rules, true)['months'] ?? [])[(string) $month] ?? null;
        if ($monthRule === null) {
            throw new NkoCalculationException("Aturan hitung bulan {$month} belum tersedia pada definisi NKO {$year}.");
        }
        $period = sprintf('%04d-%02d-01', $year, $month);

        $nodes = $this->nodes->nodes($set->id, $unitId);
        $sourceSheets = DB::table('kpi_definitions')->where('set_id', $set->id)->pluck('source_sheet', 'id')->all();
        foreach ($nodes as &$n) {
            $n['source_sheet'] = $sourceSheets[$n['id']] ?? null;
        }
        unset($n);

        $targets = [];
        $targetByRow = DB::table('kpi_targets as k')->join('kpi_definitions as d', 'd.id', '=', 'k.definition_id')->where('d.set_id', $set->id)
            ->where('k.organizational_unit_id', $unitId)->where('k.period', $period)->get(['d.row_no', 'k.target_value', 'k.target_text']);
        foreach ($targetByRow as $t) {
            $targets[(int) $t->row_no] = ['value' => $t->target_value !== null ? (float) $t->target_value : null, 'text' => $t->target_text];
        }

        $resolved = $this->resolver->resolve($unitId, $year, $month);
        $real = [];
        $source = [];
        $missing = [];
        foreach ($nodes as $n) {
            $r = $resolved[$n['code']] ?? null;
            if ($r !== null) {
                $real[$n['row_no']] = $r['value'];
                $source[$n['row_no']] = $r['source'];
            } elseif ($this->needsRealisasi($n, $month)) {
                $missing[] = ['code' => $n['code'], 'name' => DB::table('kpi_definitions')->where('id', $n['id'])->value('name')];
            }
        }

        $res = $this->calculator->calculate($nodes, $targets, $real, $monthRule, $month);

        return DB::transaction(function () use ($set, $unit, $unitId, $period, $nodes, $targets, $real, $source, $missing, $res, $user) {
            DB::table('kpi_snapshots')->where('organizational_unit_id', $unitId)->where('period', $period)->where('is_current', true)->update(['is_current' => false, 'updated_at' => now()]);
            $id = (string) Str::uuid7();
            DB::table('kpi_snapshots')->insert([
                'id' => $id, 'set_id' => $set->id, 'organizational_unit_id' => $unitId, 'period' => $period, 'is_current' => true, 'total_nilai' => $res['total'], 'nko' => $res['nko'],
                'missing_count' => count($missing), 'missing' => json_encode($missing, JSON_UNESCAPED_UNICODE), 'calculated_by' => $user?->id, 'calculated_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            $rows = [];
            foreach ($nodes as $n) {
                $r = $n['row_no'];
                $rows[] = ['snapshot_id' => $id, 'definition_id' => $n['id'], 'target_value' => $targets[$r]['value'] ?? null, 'target_text' => $targets[$r]['text'] ?? null, 'realisasi' => $real[$r] ?? null,
                    'source' => $source[$r] ?? null, 'pencapaian' => $res['rows'][$r]['pencapaian'], 'nilai' => $res['rows'][$r]['nilai']];
            }
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('kpi_snapshot_values')->insert($chunk);
            }
            [$rank, $of] = $this->rerank($unit, $period);

            return ['snapshot_id' => $id, 'unit_id' => $unitId, 'unit_name' => $unit->name, 'period' => substr($period, 0, 7), 'nko' => $res['nko'], 'total_nilai' => $res['total'],
                'missing_count' => count($missing), 'rank' => $rank[$id] ?? null, 'rank_of' => $of];
        });
    }

    /**
     * Peringkat NKO antar ULP satu UP3 pada bulan itu (hanya snapshot berlaku); UP3 tidak diberi peringkat.
     *
     * @return array{0: array<string, int>, 1: ?int} id snapshot => peringkat, jumlah ULP berperingkat
     */
    private function rerank(object $unit, string $period): array
    {
        if ($unit->unit_type !== 'ULP' || $unit->parent_id === null) {
            return [[], null];
        }
        $snaps = DB::table('kpi_snapshots as s')->join('organizational_units as u', 'u.id', '=', 's.organizational_unit_id')->where('u.parent_id', $unit->parent_id)->where('u.unit_type', 'ULP')
            ->where('s.period', $period)->where('s.is_current', true)->whereNotNull('s.nko')->orderByDesc('s.nko')->orderBy('u.name')->get(['s.id']);
        $of = $snaps->count();
        $rank = [];
        foreach ($snaps as $i => $s) {
            $rank[$s->id] = $i + 1;
            DB::table('kpi_snapshots')->where('id', $s->id)->update(['rank' => $i + 1, 'rank_of' => $of]);
        }

        return [$rank, $of];
    }
}
