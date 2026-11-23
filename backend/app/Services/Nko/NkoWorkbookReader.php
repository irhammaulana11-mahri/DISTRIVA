<?php

namespace App\Services\Nko;

use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Membaca definisi NKO/KPI dari workbook realisasi (tab "UP3 ..." dan "ULP ..."): pohon indikator, polaritas, bobot, target kumulatif bulanan, serta
 * aturan pencapaian dan nilai yang dibaca dari rumus bulan pertama. Nilai realisasi tidak diambil (acuan hitung ulang di tahap berikutnya, lihat docs/89).
 *
 * Tata letak tiap tab: baris judul kolom ke-9 (NO, KPI, POLARITAS, FORMULA, SATUAN, BOBOT), target kumulatif bulan pada kolom M..X (baris 10 = JAN..DES),
 * blok bulanan 8 kolom (TARGET, REALISASI, PENCAPAIAN, NILAI, KETERANGAN, ...) yang kepalanya dikenali dari teks "TARGET <BULAN>".
 */
class NkoWorkbookReader
{
    private const HEADER_ROW = 9;

    private const FIRST_ROW = 11;

    private const TARGET_COLUMNS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];

    private const MONTHS = ['JANUARI' => 1, 'FEBRUARI' => 2, 'MARET' => 3, 'APRIL' => 4, 'MEI' => 5, 'JUNI' => 6, 'JULI' => 7, 'AGUSTUS' => 8, 'SEPTEMBER' => 9, 'OKTOBER' => 10, 'NOVEMBER' => 11, 'DESEMBER' => 12];

    /**
     * @return array{year: int, sheets: list<array{sheet: string, level: string, unit_name: string, nodes: list<array<string, mixed>>, targets: array<int, array<int, array{value: ?float, text: ?string}>>, month_rules: array<int, array<string, mixed>>, total_weight: ?float, warnings: list<string>}>}
     */
    public function read(string $path): array
    {
        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(false);
        $book = $reader->load($path);

        $sheets = [];
        $year = null;
        foreach ($book->getSheetNames() as $name) {
            if (! preg_match('/^(UP3|ULP)\s+(.+)$/i', trim($name), $m)) {
                continue;
            }
            $ws = $book->getSheetByName($name);
            if (! $ws instanceof Worksheet || strtoupper(trim((string) $ws->getCell('A'.self::HEADER_ROW)->getValue())) !== 'NO') {
                continue;
            }
            $parsed = $this->readSheet($ws);
            $year ??= $parsed['year'];
            $sheets[] = ['sheet' => $name, 'level' => strtoupper($m[1]), 'unit_name' => trim($m[2])] + $parsed;
        }
        $this->release($book);

        if ($sheets === []) {
            throw new NkoImportException('Workbook tidak memuat tab UP3/ULP dengan tata letak NKO (judul NO/KPI pada baris 9).');
        }

        return ['year' => $year ?? (int) date('Y'), 'sheets' => $sheets];
    }

    /**
     * @return array{year: ?int, nodes: list<array<string, mixed>>, targets: array<int, array<int, array{value: ?float, text: ?string}>>, month_rules: array<int, array<string, mixed>>, total_weight: ?float, warnings: list<string>}
     */
    private function readSheet(Worksheet $ws): array
    {
        $warnings = [];
        $blocks = $this->monthBlocks($ws);
        $jan = $blocks[1] ?? null;
        if ($jan === null) {
            throw new NkoImportException("Tab {$ws->getTitle()}: blok bulan Januari tidak ditemukan.");
        }

        $year = null;
        if (preg_match('/(20\d{2})/', (string) $ws->getCell('H'.self::HEADER_ROW)->getValue(), $ym)) {
            $year = (int) $ym[1];
        }

        $lastRow = $ws->getHighestRow();
        $totalRow = null;
        $finalRow = null;
        for ($r = self::FIRST_ROW; $r <= $lastRow; $r++) {
            $b = strtoupper(trim((string) $ws->getCell('B'.$r)->getValue()));
            $a = strtoupper(trim((string) $ws->getCell('A'.$r)->getValue()));
            if ($b === 'TOTAL' && $totalRow === null) {
                $totalRow = $r;
            }
            if (str_starts_with($a, 'NOTE') && $finalRow === null) {
                $finalRow = $r;
            }
            if ($totalRow !== null && $finalRow !== null) {
                break;
            }
        }
        if ($totalRow === null) {
            throw new NkoImportException("Tab {$ws->getTitle()}: baris TOTAL tidak ditemukan.");
        }

        $nodes = [];
        $targets = [];
        $stack = [];
        $order = 0;
        $codes = [];
        for ($r = self::FIRST_ROW; $r < $totalRow; $r++) {
            $a = trim((string) $ws->getCell('A'.$r)->getValue());
            $b = trim((string) $ws->getCell('B'.$r)->getValue());
            if ($b === '') {
                continue;
            }
            $cValue = $ws->getCell('C'.$r)->getValue();
            $level = ctype_digit($a) ? 0 : (str_starts_with($b, '-') ? 2 : 1);
            $name = trim(preg_replace('/^(?:[a-z]\.|-)\s*/iu', '', $b));
            $name = trim(preg_replace('/\s*\(sesuai kewenangan\)\s*$/iu', '', $name));
            $number = $level === 0 ? $a : ($level === 1 && preg_match('/^([a-z])\./i', $b, $nm) ? strtolower($nm[1]) : null);

            $weightRaw = $this->value($ws, 'F'.$r);
            $weight = is_numeric($weightRaw) ? (float) $weightRaw : null;
            $weightNote = ! is_numeric($weightRaw) && trim((string) $weightRaw) !== '' ? trim((string) $weightRaw) : null;

            $parentRow = null;
            while ($stack !== [] && $stack[array_key_last($stack)]['level'] >= $level) {
                array_pop($stack);
            }
            if ($stack !== []) {
                $parentRow = $stack[array_key_last($stack)]['row'];
            }

            $code = rtrim(mb_substr(Str::slug($name), 0, 64), '-');
            if (isset($codes[$code])) {
                $code .= '-'.$r;
            }
            $codes[$code] = true;

            $rules = $this->rules($ws, $r, $blocks, $warnings);
            $nodes[] = [
                'row_no' => $r,
                'sort_order' => ++$order,
                'level' => $level,
                'parent_row' => $parentRow,
                'code' => $code,
                'number' => $number,
                'name' => $name,
                'polarity' => is_numeric($cValue) ? (int) $cValue : null,
                'unit_label' => $this->text($ws->getCell('E'.$r)->getValue(), 80),
                'weight' => $weight,
                'weight_note' => $weightNote,
                'formula_text' => $this->text($ws->getCell('D'.$r)->getValue(), 2000),
            ] + $rules;
            $stack[] = ['row' => $r, 'level' => $level];

            foreach (self::TARGET_COLUMNS as $i => $col) {
                $v = $this->value($ws, $col.$r);
                if ($v === null || $v === '') {
                    continue;
                }
                $targets[$r][$i + 1] = is_numeric($v) ? ['value' => (float) $v, 'text' => null] : ['value' => null, 'text' => $this->text($v, 40)];
            }
        }

        $monthRules = [];
        foreach ($blocks as $month => $cols) {
            $nilai = $cols['nilai'];
            $monthRules[$month] = [
                'total_formula' => $this->canon($this->formula($ws, $nilai.'10'), $cols),
                'total_value' => $this->cached($ws, $nilai.'10'),
                'final_formula' => $finalRow !== null ? $this->canon($this->formula($ws, $nilai.$finalRow), $cols) : null,
                'final_value' => $finalRow !== null ? $this->cached($ws, $nilai.$finalRow) : null,
                'total_row' => $totalRow,
                'final_row' => $finalRow,
            ];
        }

        $reference = [];
        foreach ($nodes as $n) {
            foreach ($blocks as $month => $cols) {
                $real = $this->cached($ws, $cols['real'].$n['row_no']);
                $capai = $this->cached($ws, $cols['capai'].$n['row_no']);
                $nilaiV = $this->cached($ws, $cols['nilai'].$n['row_no']);
                if ($real !== null || $capai !== null || $nilaiV !== null) {
                    $reference[$n['row_no']][$month] = ['real' => $real, 'capai' => $capai, 'nilai' => $nilaiV];
                }
            }
        }

        $weights = array_filter(array_map(fn ($n) => $n['level'] === 0 ? $n['weight'] : null, $nodes), fn ($w) => $w !== null);
        $totalWeight = $weights === [] ? null : array_sum($weights);
        if ($totalWeight !== null && abs($totalWeight - 100) > 0.001) {
            $warnings[] = "Tab {$ws->getTitle()}: jumlah bobot kelompok {$totalWeight}, bukan 100.";
        }

        return ['year' => $year, 'nodes' => $nodes, 'targets' => $targets, 'reference' => $reference, 'month_rules' => $monthRules, 'total_weight' => $totalWeight, 'warnings' => $warnings];
    }

    /**
     * @return array<int, array{target: string, real: string, capai: string, nilai: string}>
     */
    private function monthBlocks(Worksheet $ws): array
    {
        $blocks = [];
        $highest = Coordinate::columnIndexFromString($ws->getHighestColumn());
        for ($i = 1; $i <= $highest; $i++) {
            $col = Coordinate::stringFromColumnIndex($i);
            $text = strtoupper(trim(preg_replace('/\s+/', ' ', (string) $ws->getCell($col.self::HEADER_ROW)->getValue())));
            if (preg_match('/^TARGET (\p{L}+)$/u', $text, $m) && isset(self::MONTHS[$m[1]])) {
                $blocks[self::MONTHS[$m[1]]] = [
                    'target' => $col,
                    'real' => Coordinate::stringFromColumnIndex($i + 1),
                    'capai' => Coordinate::stringFromColumnIndex($i + 2),
                    'nilai' => Coordinate::stringFromColumnIndex($i + 3),
                ];
            }
        }

        return $blocks;
    }

    /**
     * Aturan pencapaian dan nilai dari rumus bulan pertama pada baris itu.
     *
     * @param  array<int, array{target: string, real: string, capai: string, nilai: string}>  $blocks
     * @param  list<string>  $warnings
     * @return array{source_sheet: ?string, scoring_rule: ?string, nilai_rule: ?string, rules: array<string, mixed>}
     */
    private function rules(Worksheet $ws, int $row, array $blocks, array &$warnings): array
    {
        $jan = $blocks[1];
        $real = $this->formula($ws, $jan['real'].$row);
        $capai = $this->formula($ws, $jan['capai'].$row);
        $nilai = $this->formula($ws, $jan['nilai'].$row);

        $sourceSheet = null;
        if ($real !== null && preg_match("/\\[\\d+\\]\\s?'?([^'!]+?)'?!/", $real, $m)) {
            $sourceSheet = trim($m[1]);
        }

        $scoring = null;
        if ($capai !== null && $capai !== '') {
            $plain = $ws->getCell($jan['capai'].$row)->getValue();
            $scoring = match (true) {
                is_numeric($plain) => 'FIXED',
                str_contains($capai, 'ISBLANK($C') => 'STANDARD',
                str_contains($capai, '*0.4+0.6') => 'FLOOR_60',
                str_contains($capai, '<95') => 'RANGE_BAND',
                str_contains($capai, 'ISERROR(') => 'RATIO_DEFAULT_100',
                default => 'OTHER',
            };
            if (preg_match_all('/\$C(\d+)/', $capai, $refs) && array_filter($refs[1], fn ($n) => (int) $n !== $row) !== []) {
                $warnings[] = "Tab {$ws->getTitle()} baris {$row}: rumus pencapaian merujuk polaritas/satuan baris lain; hasil sama hanya bila polaritas dan satuan kedua baris itu sama.";
            }
        }

        $nilaiRule = null;
        if ($nilai !== null && $nilai !== '') {
            $nilaiRule = match (true) {
                str_contains($nilai, 'TRUNC(AVERAGE') => 'AVERAGE_TRUNC',
                (bool) preg_match('/^=[A-Z]+\d+(\+[A-Z]+\d+)+$/', $nilai) => 'SUM_CHILDREN',
                str_starts_with($nilai, '=IF(') => 'ITEM',
                default => 'OTHER',
            };
        }

        $capaiJan = $capai !== null ? preg_replace('/\s+/', ' ', $capai) : null;
        $overrides = [];
        foreach ($blocks as $month => $cols) {
            if ($month === 1) {
                continue;
            }
            $c = $this->canon($this->formula($ws, $cols['capai'].$row), $cols);
            $n = $this->canon($this->formula($ws, $cols['nilai'].$row), $cols);
            $c = $c !== null ? preg_replace('/\s+/', ' ', $c) : null;
            $diff = [];
            if ($c !== $capaiJan) {
                $diff['pencapaian'] = $c;
            }
            if ($n !== $nilai) {
                $diff['nilai'] = $n;
            }
            if ($diff !== []) {
                $overrides[$month] = $diff;
            }
        }

        return [
            'source_sheet' => $sourceSheet,
            'scoring_rule' => $scoring,
            'nilai_rule' => $nilaiRule,
            'rules' => array_filter(['realisasi' => $real, 'pencapaian' => $capaiJan, 'nilai' => $nilai, 'months' => $overrides === [] ? null : $overrides], fn ($v) => $v !== null && $v !== ''),
        ];
    }

    /** Nilai sel: angka/teks apa adanya, atau hasil tersimpan bila sel berisi rumus (rumus ke workbook luar tidak dapat dihitung ulang). */
    private function value(Worksheet $ws, string $coordinate): mixed
    {
        $cell = $ws->getCell($coordinate);
        $v = $cell->getValue();

        return is_string($v) && str_starts_with($v, '=') ? $cell->getOldCalculatedValue() : $v;
    }

    /**
     * Mengubah rujukan kolom blok bulan (target, realisasi, pencapaian, nilai) menjadi kolom baku Z, AA, AB, AC agar rumus bulan mana pun sebanding dengan rumus Januari.
     *
     * @param  array{target: string, real: string, capai: string, nilai: string}  $cols
     */
    private function canon(?string $formula, array $cols): ?string
    {
        if ($formula === null || ! str_starts_with($formula, '=')) {
            return $formula;
        }
        $map = [$cols['target'] => 'Z', $cols['real'] => 'AA', $cols['capai'] => 'AB', $cols['nilai'] => 'AC'];

        return preg_replace_callback('/(?<![A-Za-z$!\'])(\$?)([A-Z]{1,3})(\$?\d+)(?![\d(A-Za-z])/', fn ($m) => $m[1].($map[$m[2]] ?? $m[2]).$m[3], $formula);
    }

    private function formula(Worksheet $ws, string $coordinate): ?string
    {
        $v = $ws->getCell($coordinate)->getValue();

        return $v === null || $v === '' ? null : (string) $v;
    }

    private function cached(Worksheet $ws, string $coordinate): ?float
    {
        $v = $ws->getCell($coordinate)->getOldCalculatedValue();
        if (! is_numeric($v)) {
            $plain = $ws->getCell($coordinate)->getValue();
            $v = is_numeric($plain) ? $plain : null;
        }

        return $v === null ? null : (float) $v;
    }

    private function text(mixed $v, int $max): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim(preg_replace('/\s+/', ' ', (string) $v));

        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    private function release(Spreadsheet $book): void
    {
        $book->disconnectWorksheets();
    }
}
