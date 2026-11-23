<?php

namespace App\Services\Nko;

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * Mesin hitung NKO satu unit untuk satu bulan: menyusun lembar kerja memori dengan rumus asli workbook (rumus pencapaian dan nilai per indikator, rumus total dan NKO akhir
 * per bulan, semuanya sudah dibakukan ke kolom Z/AA/AB/AC oleh pembaca) lalu menghitungnya dengan mesin rumus PhpSpreadsheet. Dengan begitu aturan tetap sama dengan workbook
 * dan dapat direkonsiliasi baris demi baris (docs/90).
 *
 * Indikator yang realisasinya belum tersedia (null) tidak dihitung: pencapaian dan nilainya kosong (bernilai 0 pada jumlah), kecuali indikator bernilai tetap.
 */
class NkoCalculator
{
    /**
     * @param  list<array<string, mixed>>  $nodes  baris definisi: row_no, polarity, unit_label, weight, weight_note, rules (pencapaian, nilai, months)
     * @param  array<int, array{value: ?float, text: ?string}>  $targets  target kumulatif bulan itu menurut row_no
     * @param  array<int, ?float>  $realisasi  realisasi kumulatif menurut row_no
     * @param  array<string, mixed>  $monthRule  total_formula, final_formula, total_row
     * @return array{rows: array<int, array{pencapaian: ?float, nilai: ?float}>, total: ?float, nko: ?float}
     */
    public function calculate(array $nodes, array $targets, array $realisasi, array $monthRule, int $month): array
    {
        $book = new Spreadsheet;
        $ws = $book->getActiveSheet();

        foreach ($nodes as $n) {
            $r = (int) $n['row_no'];
            if ($n['polarity'] !== null) {
                $ws->setCellValue("C{$r}", $n['polarity']);
            }
            if ($n['unit_label'] !== null) {
                // Satuan "%" dibaca mesin rumus sebagai angka persen (0); rumus hanya menguji E>0 sehingga diganti kata biasa.
                $ws->setCellValueExplicit("E{$r}", trim((string) $n['unit_label']) === '%' ? 'persen' : (string) $n['unit_label'], DataType::TYPE_STRING);
            }
            if ($n['weight'] !== null) {
                $ws->setCellValue("F{$r}", $n['weight']);
            } elseif ($n['weight_note'] !== null) {
                $ws->setCellValueExplicit("F{$r}", (string) $n['weight_note'], DataType::TYPE_STRING);
            }
            $t = $targets[$r] ?? null;
            if ($t !== null) {
                $t['value'] !== null ? $ws->setCellValue("Z{$r}", $t['value']) : $ws->setCellValueExplicit("Z{$r}", (string) $t['text'], DataType::TYPE_STRING);
            }
            $real = $realisasi[$r] ?? null;
            if ($real !== null) {
                $ws->setCellValue("AA{$r}", $real);
            }

            $rules = $n['rules'] ?? [];
            $override = $rules['months'][$month] ?? [];
            $capai = array_key_exists('pencapaian', $override) ? $override['pencapaian'] : ($rules['pencapaian'] ?? null);
            $nilai = array_key_exists('nilai', $override) ? $override['nilai'] : ($rules['nilai'] ?? null);

            $fixed = $capai !== null && is_numeric($capai);
            $hasRealisasi = $real !== null || $fixed;
            if ($capai !== null && $capai !== '' && ($hasRealisasi || ! $this->isItemFormula($capai))) {
                $native = $fixed ? null : $this->nativeScore((string) $capai, $n['polarity'], $n['unit_label'], $t['value'] ?? null, $real);
                if ($fixed) {
                    $ws->setCellValue("AB{$r}", (float) $capai);
                } elseif ($native !== false) {
                    $native === null ?: $ws->setCellValue("AB{$r}", $native);
                } else {
                    $ws->setCellValue("AB{$r}", $capai);
                }
            }
            if ($nilai !== null && $nilai !== '' && ($hasRealisasi || ! $this->isItemFormula((string) $capai) || ! $this->isItemNilai($nilai))) {
                $ws->setCellValue("AC{$r}", $nilai);
            }
        }

        $total = $monthRule['total_formula'] ?? null;
        $totalRow = (int) ($monthRule['total_row'] ?? 0);
        $finalFormula = $monthRule['final_formula'] ?? null;
        if ($total !== null) {
            $ws->setCellValue('AC10', $total);
        }
        if ($totalRow > 0) {
            $ws->setCellValue("AC{$totalRow}", '=AC10');
        }
        $finalRow = (int) ($monthRule['final_row'] ?? ($totalRow + 4));
        if ($finalFormula !== null) {
            $ws->setCellValue("AC{$finalRow}", $finalFormula);
        }

        $rows = [];
        foreach ($nodes as $n) {
            $r = (int) $n['row_no'];
            $rows[$r] = ['pencapaian' => $this->number($ws, "AB{$r}"), 'nilai' => $this->number($ws, "AC{$r}")];
        }
        $out = ['rows' => $rows, 'total' => $total !== null ? $this->number($ws, 'AC10') : null, 'nko' => $finalFormula !== null ? $this->number($ws, "AC{$finalRow}") : null];

        $book->disconnectWorksheets();

        return $out;
    }

    /**
     * Pencapaian untuk tiga pola rumus yang membagi dengan target, dihitung langsung dengan semantik Excel (mesin rumus tidak meneruskan galat bagi-nol seperti Excel).
     * Mengembalikan false bila pola rumus tidak dikenal (dihitung oleh mesin rumus) dan null bila hasilnya galat pada Excel.
     */
    private function nativeScore(string $formula, ?int $polarity, ?string $unit, ?float $target, ?float $real): float|false|null
    {
        $z = $target;
        $aa = (float) $real;
        if (str_contains($formula, 'ISBLANK($C')) {
            if ($unit === null || trim($unit) === '') {
                return null;
            }
            if ($polarity !== 1 && $polarity !== 3) {
                return 0.0;
            }
            if ($z === null || $z == 0.0) {
                return match (true) {
                    $polarity === 3 && $aa > 0 => 110.0,
                    $polarity === 1 && $aa != 0.0 => 0.0,
                    $polarity === 1 => 100.0,
                    default => null,
                };
            }
            $ratio = $aa / $z;
            $x = $polarity === 3 ? $ratio : 2 - $ratio;

            return ($x <= 0 ? 0.0 : ($x >= 1.1 ? 1.1 : $x)) * 100;
        }
        if (str_contains($formula, '*0.4+0.6')) {
            if ($z === null || $z == 0.0) {
                return null;
            }
            $ratio = $aa / $z;

            return ($ratio < 1 ? $ratio * 0.4 + 0.6 : ($ratio >= 1.1 ? 1.1 : $ratio)) * 100;
        }
        if (str_contains($formula, 'ISERROR(')) {
            return $z === null || $z == 0.0 ? 100.0 : $aa / $z * 100;
        }

        return false;
    }

    /** Rumus pencapaian yang bergantung pada realisasi (bukan nilai tetap). */
    private function isItemFormula(string $capai): bool
    {
        return str_starts_with($capai, '=') && str_contains($capai, 'AA');
    }

    /** Rumus nilai indikator tunggal: bergantung pada pencapaian baris itu sendiri. */
    private function isItemNilai(string $nilai): bool
    {
        return str_starts_with($nilai, '=IF(AB');
    }

    private function number(Worksheet $ws, string $coordinate): ?float
    {
        try {
            $v = $ws->getCell($coordinate)->getCalculatedValue();
        } catch (\Throwable) {
            return null;
        }

        return is_numeric($v) && ! is_string($v) ? (float) $v : (is_string($v) && is_numeric($v) ? (float) $v : null);
    }
}
