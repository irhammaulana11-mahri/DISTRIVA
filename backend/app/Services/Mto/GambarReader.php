<?php

namespace App\Services\Mto;

use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Deterministic reader of the filled GAMBAR template of a drawing package (stage 4B). No formula is evaluated and nothing is guessed:
 * it reads the Psg/Bkr numbers beside each construction label, in the fixed blocks of the template, and reports what it could not use.
 * The result is only a CANDIDATE list; TEKNIK still checks and verifies the MTO.
 */
class GambarReader
{
    public const SHEET = 'GAMBAR';

    /** group => [label column, [Psg column, Bkr column], first row, last row] (same layout as tools/extract_bom_json.py) */
    public const BLOCKS = [
        'SUTM' => ['T', ['U', 'V'], 6, 53], 'MVTIC' => ['W', ['X', 'Y'], 6, 34], 'SUTR' => ['W', ['X', 'Y'], 36, 53],
        'SKTM' => ['T', ['U', 'V'], 55, 56], 'KUBIKEL' => ['W', ['X', 'Y'], 55, 56],
        'GTT_UMUM' => ['Z', ['AA', 'AB'], 6, 23], 'GTT_KHUSUS' => ['Z', ['AA', 'AB'], 25, 39],
    ];

    /** the PBPD block: power ranges (label column Z, editable by the user) with the number of customers in Psg/Bkr (owner explanation 2026-11-06) */
    public const PBPD = ['Z', ['AA', 'AB'], 51, 56];

    private const MAX_QUANTITY = 100000000;

    /**
     * @return array{items:list<array{group:string,label:string,psg:float,bkr:float,cell_psg:?string,cell_bkr:?string}>, pbpd:list<array{label:string,psg:float,bkr:float,cell_psg:string,cell_bkr:string}>, warnings:list<array{cell:string,code:string,message:string}>}
     */
    public function read(string $path, string $extension): array
    {
        $sheet = $this->sheet($path, $extension);
        $items = [];
        $warnings = [];
        $inBlock = [];

        foreach (self::BLOCKS as $group => [$labelCol, $qtyCols, $first, $last]) {
            for ($row = $first; $row <= $last; $row++) {
                $label = $this->label($sheet->getCell($labelCol.$row));
                $psg = $bkr = 0.0;
                foreach ($qtyCols as $i => $col) {
                    $inBlock["{$col}{$row}"] = true;
                    [$value, $warning] = $this->quantity($sheet->getCell($col.$row));
                    if ($warning !== null) {
                        $warnings[] = ['cell' => "{$col}{$row}", 'code' => $warning[0], 'message' => $warning[1]];
                    } elseif ($i === 0) {
                        $psg = $value;
                    } else {
                        $bkr = $value;
                    }
                }
                if ($psg == 0.0 && $bkr == 0.0) {
                    continue;
                }
                if ($label === '') {
                    $warnings[] = ['cell' => "{$qtyCols[0]}{$row}", 'code' => 'NO_LABEL', 'message' => "Ada jumlah pada baris {$row} tetapi uraian konstruksinya kosong; diabaikan."];

                    continue;
                }
                $items[] = ['group' => $group, 'label' => $label, 'psg' => $psg, 'bkr' => $bkr, 'cell_psg' => "{$qtyCols[0]}{$row}", 'cell_bkr' => "{$qtyCols[1]}{$row}"];
            }
        }

        $pbpd = [];
        [$pl, $pq, $p0, $p1] = self::PBPD;
        for ($row = $p0; $row <= $p1; $row++) {
            $vals = [];
            foreach ($pq as $col) {
                $inBlock["{$col}{$row}"] = true;
                [$vals[], $warning] = $this->quantity($sheet->getCell($col.$row));
                if ($warning !== null) {
                    $warnings[] = ['cell' => "{$col}{$row}", 'code' => $warning[0], 'message' => $warning[1]];
                }
            }
            $label = $this->label($sheet->getCell($pl.$row));
            if ($label !== '' && ($vals[0] != 0.0 || $vals[1] != 0.0)) {
                $pbpd[] = ['label' => $label, 'psg' => $vals[0], 'bkr' => $vals[1], 'cell_psg' => $pq[0].$row, 'cell_bkr' => $pq[1].$row];
            }
        }

        // numbers typed in a quantity column outside the construction rows (headers, PBPD block...) are reported, never used
        foreach (array_unique(array_merge(...array_values(array_map(fn ($b) => $b[1], self::BLOCKS)))) as $col) {
            for ($row = 1; $row <= 70; $row++) {
                $ref = $col.$row;
                if (isset($inBlock[$ref])) {
                    continue;
                }
                $v = $sheet->getCell($ref)->getValue();
                if (is_numeric($v) && (float) $v != 0.0) {
                    $warnings[] = ['cell' => $ref, 'code' => 'OUTSIDE_BLOCK', 'message' => "Angka {$v} di {$ref} berada di luar baris konstruksi; tidak dipakai."];
                }
            }
        }

        // PBPD job type (Z50) and payment mode (S55): choices that the BOM needs (owner answers 2026-11-07); read as text, matched later against the BOM options
        $meta = ['job_type' => $this->label($sheet->getCell('Z50')), 'payment' => $this->label($sheet->getCell('S55'))];

        return ['items' => $items, 'pbpd' => $pbpd, 'pbpd_meta' => $meta, 'warnings' => $warnings];
    }

    private function sheet(string $path, string $extension): Worksheet
    {
        $type = match (strtolower($extension)) {
            'xlsx' => 'Xlsx', 'xls' => 'Xls',
            default => throw new \InvalidArgumentException('Hanya berkas Excel (xlsx/xls) yang dapat dibaca.'),
        };
        $reader = IOFactory::createReader($type);
        $reader->setReadDataOnly(true);
        $reader->setLoadSheetsOnly([self::SHEET]);
        try {
            $book = $reader->load($path);
        } catch (\Throwable) {
            throw new \InvalidArgumentException('Berkas Excel tidak dapat dibaca atau tidak memuat lembar GAMBAR.');
        }
        $sheet = $book->getSheetByName(self::SHEET);
        if ($sheet === null) {
            throw new \InvalidArgumentException('Lembar GAMBAR tidak ditemukan pada berkas.');
        }

        return $sheet;
    }

    private function label(Cell $cell): string
    {
        $v = $this->raw($cell);

        return is_scalar($v) ? trim((string) preg_replace('/\s+/u', ' ', (string) $v)) : '';
    }

    /** @return array{0:float,1:?array{0:string,1:string}} */
    private function quantity(Cell $cell): array
    {
        $v = $this->raw($cell);
        if ($v === null || $v === '') {
            return [0.0, null];
        }
        if (! is_numeric($v)) {
            return [0.0, ['NOT_NUMERIC', "Isi {$cell->getCoordinate()} bukan angka ('".mb_substr((string) $v, 0, 30)."'); dianggap kosong."]];
        }
        $f = (float) $v;
        if ($f < 0 || $f > self::MAX_QUANTITY) {
            return [0.0, ['OUT_OF_RANGE', "Angka di {$cell->getCoordinate()} di luar batas wajar; diabaikan."]];
        }

        return [$f, null];
    }

    /** The value Excel stored: a formula cell yields its cached result, never a re-calculation. */
    private function raw(Cell $cell): mixed
    {
        $v = $cell->getValue();
        if (is_string($v) && str_starts_with($v, '=')) {
            return $cell->getOldCalculatedValue();
        }

        return $v;
    }
}
