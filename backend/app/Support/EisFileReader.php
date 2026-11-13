<?php

namespace App\Support;

use App\Exceptions\AssignmentRuleViolation;
use Illuminate\Http\UploadedFile;
use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date;

/**
 * Reads the EIS / Bot Daftung download as TEXT, never as numbers: CSV, XLSX / binary XLS (first sheet, via PhpSpreadsheet) or an HTML table
 * saved as .xls. Every cell comes back as a trimmed string; the header row is normalised to UPPER_CASE with '_'.
 *
 * @phpstan-type Parsed array{format:string, columns:list<string>, rows:list<array{row:int, cells:array<string,string>}>}
 */
final class EisFileReader
{
    /** @return array{format:string, columns:list<string>, rows:list<array{row:int, cells:array<string,string>}>} */
    public static function read(UploadedFile $file): array
    {
        $path = $file->getRealPath();
        $head = (string) file_get_contents($path, false, null, 0, 8);
        if (str_starts_with($head, "\xD0\xCF\x11\xE0")) {
            [$format, $matrix] = ['xls', self::spreadsheet($path)];
        } elseif (str_starts_with($head, 'PK')) {
            [$format, $matrix] = ['xlsx', self::spreadsheet($path)];
        } elseif (preg_match('/^\s*</', $head) || stripos((string) file_get_contents($path, false, null, 0, 2000), '<table') !== false) {
            [$format, $matrix] = ['html', self::html($path)];
        } else {
            [$format, $matrix] = ['csv', self::csv($path)];
        }

        return self::table($format, $matrix);
    }

    /**
     * @param  list<list<string>>  $matrix
     * @return array{format:string, columns:list<string>, rows:list<array{row:int, cells:array<string,string>}>}
     */
    private static function table(string $format, array $matrix): array
    {
        if ($matrix === []) {
            throw new AssignmentRuleViolation('Berkas kosong.');
        }
        $columns = array_map(fn ($h) => strtoupper(preg_replace('/\s+/', '_', trim((string) $h)) ?? ''), array_shift($matrix));
        $rows = [];
        foreach ($matrix as $i => $cells) {
            if (trim(implode('', $cells)) === '') {
                continue;
            }
            $assoc = [];
            foreach ($columns as $c => $name) {
                if ($name !== '' && ! isset($assoc[$name])) {
                    $assoc[$name] = trim((string) ($cells[$c] ?? ''));
                }
            }
            $rows[] = ['row' => $i + 2, 'cells' => $assoc];     // the header is row 1
        }
        if ($rows === []) {
            throw new AssignmentRuleViolation('Berkas tidak memuat baris data.');
        }
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if (count($rows) > $max) {
            throw new AssignmentRuleViolation("Berkas melebihi batas {$max} baris.");
        }

        return ['format' => $format, 'columns' => array_values(array_filter($columns)), 'rows' => $rows];
    }

    /** @return list<list<string>> */
    private static function csv(string $path): array
    {
        $first = (string) fgets(fopen($path, 'rb'));
        $first = preg_replace('/^\xEF\xBB\xBF/', '', $first) ?? $first;
        if (! mb_check_encoding($first, 'UTF-8')) {
            throw new AssignmentRuleViolation('Berkas harus berenkoding UTF-8.');
        }
        $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
        $h = fopen($path, 'rb');
        $out = [];
        $n = 0;
        while (($cells = fgetcsv($h, 0, $delimiter, '"', '')) !== false) {
            $n++;
            if ($n === 1 && isset($cells[0])) {
                $cells[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $cells[0]);
            }
            foreach ($cells as $cell) {
                if (! mb_check_encoding((string) $cell, 'UTF-8')) {
                    throw new AssignmentRuleViolation("Baris {$n} tidak berenkoding UTF-8.");
                }
            }
            $out[] = array_map('strval', $cells === [null] ? [''] : $cells);
        }
        fclose($h);

        return $out;
    }

    /** @return list<list<string>> */
    private static function html(string $path): array
    {
        $dom = new \DOMDocument;
        $prev = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="UTF-8">'.(string) file_get_contents($path), LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        $table = $dom->getElementsByTagName('table')->item(0);
        if ($table === null) {
            throw new AssignmentRuleViolation('Tidak ada tabel pada berkas HTML.');
        }
        $out = [];
        foreach ($table->getElementsByTagName('tr') as $tr) {
            $row = [];
            foreach ($tr->childNodes as $cell) {
                if ($cell instanceof \DOMElement && in_array(strtolower($cell->tagName), ['td', 'th'], true)) {
                    $row[] = trim(preg_replace('/\s+/u', ' ', $cell->textContent) ?? '');
                }
            }
            if ($row !== []) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * .xls (BIFF) and .xlsx through PhpSpreadsheet. Text cells stay text (trimmed); a cell with a date format becomes
     * 'Y-m-d' (a genuine date cell is unambiguous — only re-typed text/serials of foreign files are not, see EisImportService);
     * other numbers become plain digits without exponent.
     *
     * @return list<list<string>>
     */
    private static function spreadsheet(string $path): array
    {
        try {
            $reader = IOFactory::createReaderForFile($path);
            $reader->setReadEmptyCells(false);
            $sheet = $reader->load($path)->getSheet(0);
        } catch (\Throwable $e) {
            throw new AssignmentRuleViolation('Berkas Excel tidak dapat dibaca: '.mb_substr($e->getMessage(), 0, 120));
        }
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        $lastRow = $sheet->getHighestDataRow();      // computed ONCE: it scans every cell, so calling it in the loop condition made reading quadratic (227 s for 9,660 rows)
        if ($lastRow > $max + 1) {
            throw new AssignmentRuleViolation("Berkas melebihi batas {$max} baris.");
        }
        $out = [];
        $lastCol = Coordinate::columnIndexFromString($sheet->getHighestDataColumn());
        for ($r = 1; $r <= $lastRow; $r++) {
            $line = [];
            for ($c = 1; $c <= $lastCol; $c++) {
                $line[] = self::cellText($sheet->getCell([$c, $r]));
            }
            $out[] = $line;
        }

        return $out;
    }

    private static function cellText(Cell $cell): string
    {
        $v = $cell->getValue();
        if ($v === null) {
            return '';
        }
        if (is_bool($v)) {
            return $v ? 'TRUE' : 'FALSE';
        }
        if (is_int($v) || is_float($v)) {
            if (Date::isDateTime($cell)) {
                return Date::excelToDateTimeObject((float) $v)->format('Y-m-d');
            }
            if (is_float($v) && floor($v) !== $v) {
                return rtrim(rtrim(sprintf('%.10F', $v), '0'), '.');
            }

            return sprintf('%.0F', $v);
        }

        return trim((string) $v);
    }
}
