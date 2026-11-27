<?php

namespace App\Services\Analytics;

use App\Services\Nko\NkoCalculationService;
use App\Services\Nko\NkoCalculator;
use App\Services\Nko\NkoDefinitionSets;
use App\Services\Nko\NkoRealizationResolver;
use App\Services\Nko\NkoRealizationRules;
use Illuminate\Support\Facades\DB;

/**
 * Target NKO untuk kartu status menu Analisa & Tren Pengusahaan (docs/92 §3, docs/91): target kumulatif dari `kpi_targets`, realisasi dari sumber yang sama dengan NKO
 * (`NkoRealizationResolver`, termasuk masukan manual), dan pencapaian dihitung dengan aturan definisi indikator itu (`NkoCalculator`), sehingga angka sama dengan halaman NKO.
 */
class BusinessTargetService
{
    /** Pencapaian minimal untuk status: sama atau di atas `aman` = aman, sama atau di atas `waspada` = waspada, di bawahnya tertinggal (ditetapkan pemilik 26 Nov 2026: hijau 100% atau lebih, kuning 90 sampai 99%, merah di bawah 90%; docs/92 §10). */
    public const STATUS = ['aman' => 100.0, 'waspada' => 90.0];

    /**
     * Metrik pengusahaan => indikator NKO yang terkait. `series`: seri metrik yang setara (null bila ukuran NKO berbeda dari seri mana pun); `additive`: realisasi kumulatif berupa jumlah bulanan,
     * sehingga sisa per bulan bermakna (bukan rata-rata atau rasio); `combined`: indikator gabungan beberapa menu.
     *
     * @var array<string, list<array{code: string, series: ?string, additive: bool, combined?: bool}>>
     */
    public const LINKS = [
        'pelanggan' => [['code' => 'penambahan-pelanggan', 'series' => null, 'additive' => true]],
        'daya' => [['code' => 'daya-tersambung', 'series' => null, 'additive' => true]],
        'kwh-jual' => [['code' => 'penjualan-tenaga-listrik', 'series' => null, 'additive' => true]],
        'hpl-bp' => [['code' => 'pendapatan-biaya-penyambungan', 'series' => null, 'additive' => true]],
        'saidi-saifi' => [['code' => 'saidi', 'series' => 'saidi', 'additive' => true], ['code' => 'saifi', 'series' => 'saifi', 'additive' => true]],
        'ens' => [['code' => 'ens', 'series' => 'ens', 'additive' => true]],
        'gangguan' => [['code' => 'gangguan-tm', 'series' => 'jumlah', 'additive' => true]],
        'rpt-rct-gangguan' => [['code' => 'response-time-atas-gangguan-diluar-clear-tamper', 'series' => 'rpt_tanpa_ct', 'additive' => false]],
        'anomali-gangguan' => [['code' => 'feedback-rating-negatif-pada-pln-mobile-gangguan', 'series' => 'negatif_nonmarking', 'additive' => true]],
        'kwh-p2tl' => [['code' => 'perolehan-kwh-p2tl', 'series' => 'kwh', 'additive' => true]],
        'susut' => [['code' => 'susut-distribusi-tanpa-e-min', 'series' => 'susut', 'additive' => false]],
        'piutang-pascabayar' => [['code' => 'pencapaian-saldo-rata-rata-akhir-bulan-diluar-konsumen-instansi', 'series' => null, 'additive' => false]],
        'piutang-prabayar' => [['code' => NkoRealizationResolver::PELUNASAN_CODE, 'series' => null, 'additive' => true, 'combined' => true]],
        'pelunasan-prr' => [['code' => NkoRealizationResolver::PELUNASAN_CODE, 'series' => null, 'additive' => true, 'combined' => true]],
        'pelunasan-ex-prr' => [['code' => NkoRealizationResolver::PELUNASAN_CODE, 'series' => null, 'additive' => true, 'combined' => true]],
    ];

    public function __construct(private readonly NkoCalculationService $nodes, private readonly NkoRealizationResolver $resolver, private readonly NkoCalculator $calculator, private readonly NkoRealizationRules $rules) {}

    /**
     * Target NKO bulan `$to` untuk unit itu; kosong bila metrik tidak punya indikator NKO atau definisi NKO tahun itu belum diimpor.
     *
     * Realisasi diambil dari perhitungan NKO (sistem atau masukan manual); bila belum ada dan indikatornya punya seri setara, dipakai kumulatif seri metrik itu (`$metricYtd`, kunci seri) dan ditandai `METRIK`.
     *
     * @param  object{id: string, unit_type: string}  $unit
     * @param  array<string, ?float>  $metricYtd
     * @return list<array<string, mixed>>
     */
    public function targets(string $code, object $unit, string $to, array $metricYtd = []): array
    {
        $links = self::LINKS[$code] ?? [];
        $year = (int) substr($to, 0, 4);
        $month = (int) substr($to, 5, 2);
        $set = $links === [] ? null : NkoDefinitionSets::forMonth($year, $unit->unit_type, $month);
        if ($set === null) {
            return [];
        }
        $nodes = collect($this->nodes->nodes($set->id, $unit->id))->keyBy('code');
        // indikator yang sudah berganti nama diikuti lewat `replaces_code` aturannya (docs/93)
        $links = array_map(fn (array $link) => ['code' => $nodes->has($link['code']) ? $link['code'] : ($this->rules->successor($link['code'], $year, $month) ?? $link['code'])] + $link, $links);
        $definitions = DB::table('kpi_definitions')->where('set_id', $set->id)->whereIn('code', array_column($links, 'code'))->get(['id', 'code', 'name'])->keyBy('code');
        $resolved = $this->resolver->resolve($unit->id, $year, $month);
        $rules = $this->rules->forPeriod($year, $month);
        $yearEndSet = NkoDefinitionSets::forMonth($year, $unit->unit_type, 12);
        $out = [];
        foreach ($links as $link) {
            $node = $nodes->get($link['code']);
            $definition = $definitions->get($link['code']);
            if ($node === null || $definition === null) {
                continue;
            }
            $target = DB::table('kpi_targets')->where('definition_id', $definition->id)->where('organizational_unit_id', $unit->id)
                ->where('period', sprintf('%04d-%02d-01', $year, $month))->first(['target_value', 'target_text']);
            // target akhir tahun diambil dari versi yang berlaku di Desember
            $yearEnd = $yearEndSet === null ? null : DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->where('d.set_id', $yearEndSet->id)->where('d.code', $link['code'])
                ->where('t.organizational_unit_id', $unit->id)->where('t.period', "{$year}-12-01")->first(['t.target_value', 't.target_text']);
            $real = $resolved[$link['code']] ?? null;
            if ($real === null && $link['series'] !== null && ($metricYtd[$link['series']] ?? null) !== null) {
                $real = ['value' => (float) $metricYtd[$link['series']], 'source' => 'METRIK'];
            }
            $pencapaian = $target === null ? null : $this->calculator->calculate([$node], [$node['row_no'] => ['value' => $target->target_value !== null ? (float) $target->target_value : null, 'text' => $target->target_text]],
                [$node['row_no'] => $real['value'] ?? null], [], $month)['rows'][$node['row_no']]['pencapaian'];
            $pencapaian = $real === null ? null : $pencapaian;
            $remaining = null;
            $current = null;
            if ($link['additive'] && $real !== null && $yearEnd?->target_value !== null && $month < 12) {
                $remaining = ((float) $yearEnd->target_value - $real['value']) / (12 - $month);
                $current = $real['value'] / $month;
            }
            $out[] = [
                'definition_code' => $link['code'], 'name' => $definition->name, 'unit_label' => $node['unit_label'], 'polarity' => match ($node['polarity']) {
                    3 => 'up',
                    1 => 'down',
                    default => null,
                },
                'series_key' => $link['series'], 'combined' => $link['combined'] ?? false, 'month' => $to,
                'target' => $target?->target_value !== null ? (float) $target->target_value : null, 'target_text' => $target?->target_text,
                'realisasi' => $real['value'] ?? null, 'realisasi_source' => $real['source'] ?? null,
                'validated' => $real === null || $real['source'] === 'METRIK' ? null : (bool) ($rules[$link['code']]->is_validated ?? true),
                'pencapaian_pct' => $pencapaian, 'status' => $this->status($pencapaian),
                'target_year_end' => $yearEnd?->target_value !== null ? (float) $yearEnd->target_value : null, 'remaining_per_month' => $remaining, 'current_per_month' => $current,
            ];
        }

        return $out;
    }

    private function status(?float $pencapaian): ?string
    {
        return match (true) {
            $pencapaian === null => null,
            $pencapaian >= self::STATUS['aman'] => 'aman',
            $pencapaian >= self::STATUS['waspada'] => 'waspada',
            default => 'tertinggal',
        };
    }
}
