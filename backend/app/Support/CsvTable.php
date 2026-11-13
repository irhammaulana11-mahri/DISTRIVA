<?php

namespace App\Support;

use App\Exceptions\AssignmentRuleViolation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/**
 * Small, strict CSV reader for uploaded master-data files: UTF-8 only (BOM tolerated), ',' or ';' delimiter chosen
 * from the header line, header aliases (Indonesian or English), required-column check, blank lines skipped,
 * every cell trimmed, quoted cells may span several lines. Throws AssignmentRuleViolation (HTTP 409) with a clear message for unusable files.
 */
final class CsvTable
{
    /**
     * @param  array<string, list<string>>  $aliases  field => accepted header names (already lower-case, '_' for spaces)
     * @param  list<string>  $required
     * @return array{rows: list<array<string, mixed>>, columns: list<string>} each row has 'row' (file line number) plus one trimmed string per present field
     */
    public static function read(UploadedFile $file, array $aliases, array $required): array
    {
        $handle = fopen($file->getRealPath(), 'rb');
        if ($handle === false) {
            throw new AssignmentRuleViolation('Berkas tidak dapat dibaca.');
        }

        try {
            $first = fgets($handle);
            if ($first === false) {
                throw new AssignmentRuleViolation('Berkas kosong.');
            }
            $first = preg_replace('/^\xEF\xBB\xBF/', '', $first) ?? $first;
            if (! mb_check_encoding($first, 'UTF-8')) {
                throw new AssignmentRuleViolation('Berkas harus berenkoding UTF-8.');
            }
            $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
            $header = array_map(fn ($h) => Str::of((string) $h)->lower()->trim()->replace([' ', '-'], '_')->toString(), str_getcsv($first, $delimiter, '"', ''));

            $map = [];
            foreach ($aliases as $field => $names) {
                $map[$field] = null;
                foreach ($names as $alias) {
                    if (($i = array_search($alias, $header, true)) !== false) {
                        $map[$field] = $i;
                        break;
                    }
                }
            }
            foreach ($required as $field) {
                if ($map[$field] === null) {
                    throw new AssignmentRuleViolation("Kolom wajib '{$field}' tidak ditemukan pada baris judul.");
                }
            }

            // From here on read whole CSV records (fgetcsv): a quoted cell may contain line breaks (the real KHS
            // workbook has two such names). `row` is the record number, the header being record 1.
            $rows = [];
            $n = 1;
            while (($cells = fgetcsv($handle, 0, $delimiter, '"', '')) !== false) {
                $n++;
                if ($cells === [null] || trim(implode('', array_map('strval', $cells))) === '') {
                    continue; // blank line
                }
                foreach ($cells as $cell) {
                    if (! mb_check_encoding((string) $cell, 'UTF-8')) {
                        throw new AssignmentRuleViolation("Baris {$n} tidak berenkoding UTF-8.");
                    }
                }
                $row = ['row' => $n];
                foreach ($map as $field => $idx) {
                    $row[$field] = $idx === null ? '' : trim((string) ($cells[$idx] ?? ''));
                }
                $rows[] = $row;
            }
        } finally {
            fclose($handle);
        }

        return ['rows' => $rows, 'columns' => array_keys(array_filter($map, fn ($i) => $i !== null))];
    }
}
