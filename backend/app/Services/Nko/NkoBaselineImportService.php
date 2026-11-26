<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;

/**
 * Impor baseline adjustment (BA) bulanan Penjualan Tenaga Listrik dari tab "PENJUALAN TL" workbook TRP (docs/90): BA = target kWh jual bulanan - target delta kWh jual bulanan, per ULP per bulan.
 * Blok dikenali dari judul di kolom A ("TARGET KWH JUAL BULANAN TAHUN yyyy" dan "TARGET DELTA KWH JUAL BULANAN TAHUN yyyy"), baris ULP dari nama di kolom B, bulan Januari sampai Desember di kolom C sampai N.
 * UP3 tidak disimpan karena realisasi UP3 dijumlahkan dari ULP.
 */
class NkoBaselineImportService
{
    public const CODE = 'penjualan-tenaga-listrik';

    public const SHEET = 'PENJUALAN TL';

    /**
     * @return array{year: int, units: int, rows: int, skipped: list<string>}
     */
    public function import(string $path, string $originalName): array
    {
        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(true);
        $reader->setLoadSheetsOnly([self::SHEET]);
        try {
            $sheet = $reader->load($path)->getSheetByName(self::SHEET);
        } catch (\Throwable) {
            $sheet = null;
        }
        if ($sheet === null) {
            throw new NkoImportException('Tab "'.self::SHEET.'" tidak ditemukan di workbook.');
        }
        $rows = $sheet->toArray(null, true, false, false);
        $jual = $this->block($rows, '/^TARGET KWH JUAL BULANAN TAHUN (\d{4})/');
        $delta = $this->block($rows, '/^TARGET DELTA KWH JUAL BULANAN TAHUN (\d{4})/');
        if ($jual === null || $delta === null) {
            throw new NkoImportException('Blok "TARGET KWH JUAL BULANAN" atau "TARGET DELTA KWH JUAL BULANAN" tidak ditemukan pada tab '.self::SHEET.'.');
        }
        if ($jual['year'] !== $delta['year']) {
            throw new NkoImportException("Tahun blok target jual ({$jual['year']}) berbeda dari blok target delta ({$delta['year']}).");
        }
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->get(['id', 'name'])->mapWithKeys(fn ($u) => [Str::upper(trim((string) preg_replace('/^ULP\s+/i', '', $u->name))) => $u->id]);

        $skipped = [];
        $written = 0;
        $touched = [];
        DB::transaction(function () use ($jual, $delta, $units, $originalName, &$skipped, &$written, &$touched) {
            foreach ($jual['rows'] as $name => $months) {
                if (! isset($units[$name])) {
                    $skipped[] = $name;

                    continue;
                }
                if (! isset($delta['rows'][$name])) {
                    $skipped[] = $name.' (tanpa baris target delta)';

                    continue;
                }
                foreach ($months as $i => $target) {
                    $d = $delta['rows'][$name][$i] ?? null;
                    if ($target === null || $d === null) {
                        continue;
                    }
                    DB::table('kpi_baselines')->upsert([['definition_code' => self::CODE, 'organizational_unit_id' => $units[$name], 'year' => $jual['year'], 'month' => $i + 1, 'value' => $target - $d,
                        'source' => mb_substr($originalName, 0, 200), 'created_at' => now(), 'updated_at' => now()]], ['definition_code', 'organizational_unit_id', 'year', 'month'], ['value', 'source', 'updated_at']);
                    $written++;
                    $touched[$name] = true;
                }
            }
        });

        return ['year' => $jual['year'], 'units' => count($touched), 'rows' => $written, 'skipped' => $skipped];
    }

    /**
     * Blok bulanan per ULP di bawah judul yang cocok dengan pola: baris judul kolom ("NO." dan "ULP") lalu baris ULP sampai baris tanpa nama atau baris UP3.
     *
     * @param  list<list<mixed>>  $rows
     * @return array{year: int, rows: array<string, list<?float>>}|null
     */
    private function block(array $rows, string $titlePattern): ?array
    {
        $first = Coordinate::columnIndexFromString('C') - 1;
        foreach ($rows as $i => $row) {
            $title = Str::upper(trim((string) preg_replace('/\s+/', ' ', (string) ($row[0] ?? ''))));
            if (preg_match($titlePattern, $title, $m) !== 1) {
                continue;
            }
            $out = [];
            for ($r = $i + 1; $r < count($rows); $r++) {
                $name = Str::upper(trim((string) ($rows[$r][1] ?? '')));
                $label = Str::upper(trim((string) ($rows[$r][0] ?? '')));
                if ($name === 'ULP' || $name === '') {
                    if ($out !== [] && $name === '') {
                        break;
                    }

                    continue;
                }
                if (str_starts_with($name, 'UP3') || ($label !== '' && ! is_numeric($label))) {
                    break;
                }
                $months = [];
                for ($c = 0; $c < 12; $c++) {
                    $v = $rows[$r][$first + $c] ?? null;
                    $months[] = is_numeric($v) ? (float) $v : null;
                }
                $out[$name] = $months;
            }

            return ['year' => (int) $m[1], 'rows' => $out];
        }

        return null;
    }
}
