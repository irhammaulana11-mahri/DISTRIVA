<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Pemeriksaan workbook definisi sebelum diunggah (docs/93 §10): hasil per tab, galat yang menghentikan unggahan, peringatan, dan pratinjau perubahan. Hanya membaca.
 */
class NkoDefinitionCheckService
{
    /** paling banyak nama item yang disebut dalam satu pesan */
    private const NAMES = 5;

    public function __construct(private readonly NkoWorkbookReader $reader, private readonly NkoDefinitionImportService $importer, private readonly NkoDefinitionDiffService $differ) {}

    /**
     * @return array{report: array{year: int, year_found: ?int, can_upload: bool, errors: list<string>, warnings: list<string>,
     *     tabs: list<array{sheet: string, status: string, level: ?string, unit_name: ?string, unit_found: ?bool, reason: ?string, items: ?int, total_weight: ?float, errors: list<string>, warnings: list<string>}>,
     *     changes: list<array<string, mixed>>}, book: ?array<string, mixed>}
     */
    public function check(string $path, int $year): array
    {
        $report = ['year' => $year, 'year_found' => null, 'can_upload' => false, 'errors' => [], 'warnings' => [], 'tabs' => [], 'changes' => []];
        try {
            $read = $this->reader->read($path);
        } catch (Throwable $e) {
            report($e);

            return ['report' => ['errors' => ['Berkas tidak dapat dibaca sebagai workbook Excel (.xlsx).']] + $report, 'book' => null];
        }
        $report['year_found'] = $read['year'];
        $report['tabs'] = array_map(fn (array $t) => $t + ['unit_found' => null, 'items' => null, 'total_weight' => null, 'errors' => [], 'warnings' => []], $read['tabs']);
        $report['errors'] = NkoDefinitionImportService::readingErrors($read);
        if ($read['year'] !== null && $read['year'] !== $year) {
            $report['errors'][] = "Berkas berisi definisi tahun {$read['year']} (sel H9), bukan {$year}.";
        }
        if ($report['errors'] !== []) {
            return ['report' => $report, 'book' => null];
        }

        $book = $this->importer->analyze($path, $read);
        $bySheet = array_column($read['sheets'], null, 'sheet');
        foreach ($report['tabs'] as &$tab) {
            $sheet = $bySheet[$tab['sheet']] ?? null;
            if ($sheet === null) {
                continue;
            }
            $tab['unit_found'] = $sheet['definition_only'] ? null : isset($book['levels'][$sheet['level']]['unit_ids'][$sheet['sheet']]);
            $tab['items'] = count(array_filter($sheet['nodes'], fn (array $n) => $n['polarity'] !== null));
            $tab['total_weight'] = $sheet['total_weight'];
            $inherited = $this->inheritedCodes($book['levels'][$sheet['level']], $sheet);
            [$tab['errors'], $tab['warnings']] = $this->sheetProblems($sheet, $tab['unit_found'], $inherited);
            foreach ($tab['errors'] as $error) {
                $report['errors'][] = "Tab {$tab['sheet']}: {$error}";
            }
        }
        unset($tab);

        foreach ($book['levels'] as $level => $plan) {
            $withCode = array_column(array_filter($plan['sheets'], fn (array $s) => $s['code_column']), 'sheet');
            if ($withCode !== [] && count($withCode) < count($plan['sheets'])) {
                $without = array_diff(array_column($plan['sheets'], 'sheet'), $withCode);
                $report['errors'][] = "Tab {$level} harus seragam: ".implode(', ', $without).' tidak memiliki kolom KODE (sel J9) sementara tab lain memilikinya.';
            }
            foreach ($plan['warnings'] as $warning) {
                if (! str_contains($warning, 'unit tidak ada di master unit')) {
                    $report['warnings'][] = $warning;
                }
            }
        }
        if (array_intersect(array_column($book['levels'], 'status'), ['BARU', 'DIGANTIKAN']) === []) {
            $report['errors'][] = 'Isi workbook ini sudah pernah dimuat; tidak ada yang berubah.';
        }
        $report['changes'] = $this->differ->diff($book);
        $report['can_upload'] = $report['errors'] === [];

        return ['report' => $report, 'book' => $book];
    }

    /**
     * Kode item yang targetnya sudah ada di versi aktif (untuk unit tab itu; unit mana pun pada tab DEFINISI), jadi akan disalin bila workbook tidak mengisinya.
     *
     * @param  array<string, mixed>  $plan
     * @param  array<string, mixed>  $sheet
     * @return array<string, int>
     */
    private function inheritedCodes(array $plan, array $sheet): array
    {
        $unitId = $plan['unit_ids'][$sheet['sheet']] ?? null;
        if ($plan['active'] === null || ($unitId === null && ! $sheet['definition_only'])) {
            return [];
        }

        return array_flip(DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')
            ->where('d.set_id', $plan['active']->id)->when($unitId !== null, fn ($q) => $q->where('t.organizational_unit_id', $unitId))->distinct()->pluck('d.code')->all());
    }

    /**
     * @param  array<string, mixed>  $sheet
     * @param  array<string, int>  $inherited
     * @return array{0: list<string>, 1: list<string>} galat dan peringatan
     */
    private function sheetProblems(array $sheet, ?bool $unitFound, array $inherited): array
    {
        $errors = [];
        $warnings = [];
        $definitionOnly = $sheet['definition_only'];
        if ($unitFound === false) {
            $errors[] = "unit \"{$sheet['level']} {$sheet['unit_name']}\" tidak ada di master unit; periksa ejaan nama tab.";
        }
        if ($sheet['total_weight'] === null || abs($sheet['total_weight'] - 100) > 0.001) {
            $errors[] = 'jumlah bobot kelompok '.($sheet['total_weight'] ?? 0).', harus 100.';
        }
        if ($definitionOnly && ($sheet['targets'] !== [] || $sheet['uncached_targets'] > 0)) {
            $errors[] = 'tab DEFINISI tidak memuat target (kolom M sampai X harus kosong); unggah target lewat workbook target.';
        } elseif ($sheet['uncached_targets'] > 0) {
            $errors[] = "{$sheet['uncached_targets']} sel target berisi rumus tanpa nilai tersimpan (rumus ke workbook lain). Buka di Excel, perbarui tautan, simpan, lalu unggah lagi.";
        }

        $parents = array_flip(array_filter(array_column($sheet['nodes'], 'parent_row')));
        $noTarget = [];
        $copied = [];
        $partial = [];
        $noPolarity = [];
        foreach ($sheet['nodes'] as $n) {
            if (isset($parents[$n['row_no']]) || ! is_float($n['weight']) || $n['weight'] <= 0) {
                continue;
            }
            $months = count($sheet['targets'][$n['row_no']] ?? []);
            if ($months === 0) {
                isset($inherited[$n['code']]) ? $copied[] = $n['name'] : $noTarget[] = $n['name'];
            } elseif ($months < count($sheet['month_rules'])) {
                $partial[] = $n['name'];
            }
            if ($n['polarity'] === null) {
                $noPolarity[] = $n['name'];
            }
        }
        if ($definitionOnly) {
            if ($noTarget !== []) {
                $warnings[] = 'target belum ada untuk item berbobot: '.$this->names($noTarget).'. Isi lewat workbook target setelah definisi disetujui.';
            }
            [$noTarget, $copied, $partial] = [[], [], []];
        }
        if ($noTarget !== []) {
            $errors[] = 'target bulanan (kolom M sampai X) kosong untuk item berbobot: '.$this->names($noTarget).'.';
        }
        if ($noPolarity !== []) {
            $errors[] = 'polaritas (kolom C) kosong untuk item berbobot: '.$this->names($noPolarity).'.';
        }
        if ($copied !== []) {
            $warnings[] = 'target kosong di workbook; diambil dari versi aktif: '.$this->names($copied).'.';
        }
        if ($partial !== []) {
            $warnings[] = 'target sebagian bulan kosong: '.$this->names($partial).'.';
        }
        if ($sheet['uncached_scores'] > 0 && ! $definitionOnly) {
            $warnings[] = 'rumus pencapaian belum pernah dihitung (berkas belum dibuka di Excel), sehingga angka acuan pencapaian dan nilai workbook tidak tersimpan. Perhitungan NKO tidak terpengaruh; buka dan simpan di Excel bila angka acuan diperlukan.';
        }
        if ($sheet['polarity_text'] > 0) {
            $warnings[] = "{$sheet['polarity_text']} polaritas tertulis dibaca sebagai angka (Negatif 1, Rentang 2, Positif 3).";
        }

        return [$errors, $warnings];
    }

    /** @param  list<string>  $names */
    private function names(array $names): string
    {
        $shown = implode(', ', array_slice($names, 0, self::NAMES));

        return count($names) > self::NAMES ? $shown.' (dan '.(count($names) - self::NAMES).' lainnya)' : $shown;
    }
}
