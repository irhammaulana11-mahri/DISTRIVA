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
    public const HEADER_ROW = 9;

    public const FIRST_ROW = 11;

    public const TARGET_COLUMNS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];

    /** kolom opsional berisi nama lembar sumber realisasi, dipakai template yang tidak membawa rumus ke workbook lain */
    public const SOURCE_COLUMN = 'I';

    public const SOURCE_HEADER = 'SUMBER REALISASI';

    /** kolom opsional berisi kode item tetap (docs/93 §11): kode menghubungkan item lintas versi sehingga ganti nama tidak memutus target dan aturan */
    public const CODE_COLUMN = 'J';

    public const CODE_HEADER = 'KODE';

    public const CODE_PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public const CODE_MAX = 64;

    /** tab definisi tanpa unit dan tanpa target, satu per tingkat (docs/93 §13) */
    public const DEFINITION_TAB = '/^DEFINISI\s+(UP3|ULP)$/i';

    private const POLARITY_TEXT = ['negatif' => 1, 'rentang' => 2, 'range' => 2, 'positif' => 3];

    public const MONTHS = ['JANUARI' => 1, 'FEBRUARI' => 2, 'MARET' => 3, 'APRIL' => 4, 'MEI' => 5, 'JUNI' => 6, 'JULI' => 7, 'AGUSTUS' => 8, 'SEPTEMBER' => 9, 'OKTOBER' => 10, 'NOVEMBER' => 11, 'DESEMBER' => 12];

    /**
     * Tab yang tidak dikenali atau gagal dibaca tidak menghentikan pembacaan; alasannya ada di `tabs`. Pemanggil yang memuat definisi wajib menolak
     * workbook bila `NkoDefinitionImportService::readingErrors()` tidak kosong.
     *
     * @return array{year: ?int, sheets: list<array<string, mixed>>, tabs: list<array{sheet: string, status: string, level: ?string, unit_name: ?string, reason: ?string}>}
     */
    public function read(string $path): array
    {
        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(false);
        $book = $reader->load($path);

        $sheets = [];
        $tabs = [];
        $year = null;
        foreach ($book->getSheetNames() as $name) {
            $ws = $book->getSheetByName($name);
            $layout = $ws instanceof Worksheet && strtoupper(trim((string) $ws->getCell('A'.self::HEADER_ROW)->getValue())) === 'NO';
            $tab = ['sheet' => $name, 'status' => 'DILEWATI', 'level' => null, 'unit_name' => null, 'reason' => null];
            $definitionOnly = preg_match(self::DEFINITION_TAB, trim($name), $m) === 1;
            if (! $definitionOnly && ! preg_match('/^(UP3|ULP)\s+(.+)$/i', trim($name), $m)) {
                $tabs[] = ['reason' => $layout ? 'Tata letaknya NKO, tetapi nama tab harus "UP3 <nama unit>" atau "ULP <nama unit>", mis. "ULP JOMBANG".' : 'Bukan tab unit.'] + $tab;

                continue;
            }
            $tab = ['level' => strtoupper($m[1]), 'unit_name' => $definitionOnly ? null : trim($m[2])] + $tab;
            if (! $layout) {
                $tabs[] = ['reason' => 'Sel A9 harus berisi "NO" (baris judul kolom ke-9: NO, KPI, POLARITAS, FORMULA, SATUAN, BOBOT).'] + $tab;

                continue;
            }
            try {
                $parsed = $this->readSheet($ws);
            } catch (NkoImportException $e) {
                $tabs[] = ['status' => 'GALAT', 'reason' => $e->getMessage()] + $tab;

                continue;
            }
            $year ??= $parsed['year'];
            $sheets[] = ['sheet' => $name, 'level' => $tab['level'], 'unit_name' => $tab['unit_name'], 'definition_only' => $definitionOnly] + $parsed;
            $tabs[] = ['status' => 'DIKENALI'] + $tab;
        }
        $this->release($book);

        return ['year' => $year, 'sheets' => $sheets, 'tabs' => $tabs];
    }

    /**
     * `uncached_targets`: sel target berisi rumus tanpa nilai tersimpan (rumus ke workbook lain yang belum dihitung); `uncached_scores`: sel pencapaian yang belum
     * pernah dihitung (berkas belum dibuka di Excel); `polarity_text`: polaritas tertulis yang dikonversi.
     *
     * `code_column`: tab memakai kolom KODE; node membawa `code_given` (kode dari kolom KODE, bukan dibentuk dari nama).
     *
     * @return array{year: int, code_column: bool, nodes: list<array<string, mixed>>, targets: array<int, array<int, array{value: ?float, text: ?string}>>, month_rules: array<int, array<string, mixed>>, total_weight: ?float, warnings: list<string>, uncached_targets: int, uncached_scores: int, polarity_text: int}
     */
    private function readSheet(Worksheet $ws): array
    {
        $warnings = [];
        $blocks = $this->monthBlocks($ws);
        $jan = $blocks[1] ?? null;
        if ($jan === null) {
            throw new NkoImportException("Tab {$ws->getTitle()}: blok bulan Januari tidak ditemukan.");
        }

        if (! preg_match('/(20\d{2})/', (string) $ws->getCell('H'.self::HEADER_ROW)->getValue(), $ym)) {
            throw new NkoImportException("Tab {$ws->getTitle()}: sel H9 harus memuat tahun, mis. \"TARGET 2026\".");
        }
        $year = (int) $ym[1];
        $sourceColumn = strtoupper(trim((string) $ws->getCell(self::SOURCE_COLUMN.self::HEADER_ROW)->getValue())) === self::SOURCE_HEADER;
        $codeColumn = strtoupper(trim((string) $ws->getCell(self::CODE_COLUMN.self::HEADER_ROW)->getValue())) === self::CODE_HEADER;
        $uncached = 0;
        $polarityText = 0;

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
        $given = $codeColumn ? $this->givenCodes($ws, $totalRow) : [];
        $codes = array_flip($given);
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

            $code = $given[$r] ?? null;
            if ($code === null) {
                $code = rtrim(mb_substr(Str::slug($name), 0, self::CODE_MAX), '-');
                if (isset($codes[$code])) {
                    $code .= '-'.$r;
                }
                $codes[$code] = true;
            }

            $rules = $this->rules($ws, $r, $blocks, $warnings, $sourceColumn);
            $nodes[] = [
                'row_no' => $r,
                'sort_order' => ++$order,
                'level' => $level,
                'parent_row' => $parentRow,
                'code' => $code,
                'code_given' => isset($given[$r]),
                'number' => $number,
                'name' => $name,
                'polarity' => $this->polarity($cValue, "Tab {$ws->getTitle()} baris {$r}", $warnings, $polarityText),
                'unit_label' => $this->text($ws->getCell('E'.$r)->getValue(), 80),
                'weight' => $weight,
                'weight_note' => $weightNote,
                'formula_text' => $this->text($ws->getCell('D'.$r)->getValue(), 2000),
            ] + $rules;
            $stack[] = ['row' => $r, 'level' => $level];

            foreach (self::TARGET_COLUMNS as $i => $col) {
                $raw = $ws->getCell($col.$r)->getValue();
                if (is_string($raw) && str_starts_with($raw, '=') && $ws->getCell($col.$r)->getOldCalculatedValue() === null) {
                    $uncached++;

                    continue;
                }
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
        $uncachedScores = 0;
        foreach ($nodes as $n) {
            foreach ($blocks as $month => $cols) {
                $score = $ws->getCell($cols['capai'].$n['row_no']);
                if (is_string($score->getValue()) && str_starts_with($score->getValue(), '=') && $score->getOldCalculatedValue() === null) {
                    $uncachedScores++;
                }
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

        return ['year' => $year, 'code_column' => $codeColumn, 'nodes' => $nodes, 'targets' => $targets, 'reference' => $reference, 'month_rules' => $monthRules, 'total_weight' => $totalWeight, 'warnings' => $warnings,
            'uncached_targets' => $uncached, 'uncached_scores' => $uncachedScores, 'polarity_text' => $polarityText];
    }

    /**
     * Kode dari kolom KODE per baris item; sel kosong berarti item baru (kodenya dibentuk dari nama).
     *
     * @return array<int, string> baris => kode
     *
     * @throws NkoImportException kode tidak sah atau ganda
     */
    private function givenCodes(Worksheet $ws, int $totalRow): array
    {
        $codes = [];
        for ($r = self::FIRST_ROW; $r < $totalRow; $r++) {
            $code = Str::lower(trim((string) $ws->getCell(self::CODE_COLUMN.$r)->getValue()));
            if ($code === '' || trim((string) $ws->getCell('B'.$r)->getValue()) === '') {
                continue;
            }
            if (! preg_match(self::CODE_PATTERN, $code) || strlen($code) > self::CODE_MAX) {
                throw new NkoImportException("Tab {$ws->getTitle()} baris {$r}: KODE \"{$code}\" tidak sah; hanya huruf kecil, angka, dan tanda minus (paling banyak ".self::CODE_MAX.' karakter).');
            }
            $twin = array_search($code, $codes, true);
            if ($twin !== false) {
                throw new NkoImportException("Tab {$ws->getTitle()}: KODE \"{$code}\" dipakai di baris {$twin} dan {$r}; tiap item harus berkode unik.");
            }
            $codes[$r] = $code;
        }

        return $codes;
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
     * Lembar sumber realisasi dibaca dari rujukan rumus realisasi Januari, atau dari kolom "SUMBER REALISASI" (kolom I, dipakai template) bila rumusnya tidak ada.
     *
     * @param  array<int, array{target: string, real: string, capai: string, nilai: string}>  $blocks
     * @param  list<string>  $warnings
     * @return array{source_sheet: ?string, scoring_rule: ?string, nilai_rule: ?string, rules: array<string, mixed>}
     */
    private function rules(Worksheet $ws, int $row, array $blocks, array &$warnings, bool $sourceColumn): array
    {
        $jan = $blocks[1];
        $real = $this->formula($ws, $jan['real'].$row);
        $capai = $this->formula($ws, $jan['capai'].$row);
        $nilai = $this->formula($ws, $jan['nilai'].$row);

        $sourceSheet = null;
        if ($real !== null && preg_match("/\\[\\d+\\]\\s?'?([^'!]+?)'?!/", $real, $m)) {
            $sourceSheet = trim($m[1]);
        }
        if ($sourceSheet === null && $sourceColumn) {
            $sourceSheet = $this->text($ws->getCell(self::SOURCE_COLUMN.$row)->getValue(), 80);
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

    /**
     * Polaritas: angka 1 (makin kecil makin baik), 2 (rentang), 3 (makin besar makin baik), atau tulisan Negatif, Rentang, Positif.
     *
     * @param  list<string>  $warnings
     */
    private function polarity(mixed $value, string $where, array &$warnings, int &$converted): ?int
    {
        if (is_numeric($value)) {
            return (int) $value;
        }
        $text = Str::lower(trim((string) $value));
        if ($text === '') {
            return null;
        }
        $mapped = self::POLARITY_TEXT[$text] ?? null;
        if ($mapped === null) {
            $warnings[] = "{$where}: polaritas \"{$value}\" tidak dikenal; pakai 1, 2, 3, Negatif, Rentang, atau Positif.";
        } else {
            $converted++;
        }

        return $mapped;
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
