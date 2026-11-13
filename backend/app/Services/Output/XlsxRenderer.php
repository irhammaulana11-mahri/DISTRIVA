<?php

namespace App\Services\Output;

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/** Renders an `OutputDocumentService` document as an .xlsx file (values only, no formulas). Returns the file content. */
final class XlsxRenderer
{
    /** @param array<string,mixed> $doc */
    public function render(array $doc): string
    {
        $book = new Spreadsheet;
        $ws = $book->getActiveSheet();
        $ws->setTitle(mb_substr(preg_replace('/[\\\\\/?*\[\]:]/', ' ', (string) $doc['title']) ?? 'Dokumen', 0, 31));
        $r = 1;
        foreach ((array) $doc['header'] as $line) {
            $ws->setCellValue("A{$r}", (string) $line);
            $ws->getStyle("A{$r}")->getFont()->setBold(true);
            $r++;
        }
        $r++;
        $ws->setCellValue("A{$r}", (string) $doc['title']);
        $ws->getStyle("A{$r}")->getFont()->setBold(true)->setSize(13);
        $r += 2;
        foreach ((array) $doc['meta'] as [$label, $value]) {
            $ws->setCellValue("A{$r}", (string) $label);
            $ws->setCellValue("C{$r}", ': '.$value);
            $r++;
        }
        $r++;
        $width = 1;
        foreach ((array) $doc['sections'] as $s) {
            if (isset($s['heading'])) {
                $ws->setCellValue("A{$r}", (string) $s['heading']);
                $ws->getStyle("A{$r}")->getFont()->setBold(true);
                $r++;
            }
            foreach ((array) ($s['pairs'] ?? []) as [$label, $value]) {
                $ws->setCellValue("A{$r}", (string) $label);
                $this->put($ws, 4, $r, $value);
                $r++;
            }
            if (isset($s['columns'])) {
                $cols = count($s['columns']);
                $width = max($width, $cols);
                foreach ($s['columns'] as $i => $c) {
                    $ws->setCellValue([$i + 1, $r], (string) $c);
                }
                $ws->getStyle([1, $r, $cols, $r])->applyFromArray(['font' => ['bold' => true], 'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => 'D9E1F2']],
                    'alignment' => ['horizontal' => Alignment::HORIZONTAL_CENTER, 'wrapText' => true], 'borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN]]]);
                $start = ++$r;
                foreach ((array) $s['rows'] as $row) {
                    foreach ($row as $i => $v) {
                        $this->put($ws, $i + 1, $r, $v);
                    }
                    $r++;
                }
                if (isset($s['footer'])) {
                    foreach ($s['footer'] as $i => $v) {
                        $this->put($ws, $i + 1, $r, $v);
                    }
                    $ws->getStyle([1, $r, $cols, $r])->getFont()->setBold(true);
                    $r++;
                }
                $ws->getStyle([1, $start, $cols, $r - 1])->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);
            }
            $r++;
        }
        if (isset($doc['terbilang'])) {
            $ws->setCellValue("A{$r}", 'TERBILANG JUMLAH TOTAL');
            $ws->setCellValue("C{$r}", ucfirst((string) $doc['terbilang']));
            $r += 2;
        }
        $ws->setCellValue([max(3, $width - 1), $r], (string) $doc['place_date']);
        $r += 1;
        foreach ((array) $doc['signatures'] as $i => $sig) {
            $ws->setCellValue([$i === 0 ? 2 : max(3, $width - 1), $r], (string) $sig['title']);
            $ws->setCellValue([$i === 0 ? 2 : max(3, $width - 1), $r + 4], (string) ($sig['name'] ?? ''));
        }
        foreach (range(1, max($width, 6)) as $c) {
            $ws->getColumnDimensionByColumn($c)->setAutoSize(true);
        }
        $stream = fopen('php://temp', 'w+b');
        (new Xlsx($book))->save($stream);
        rewind($stream);

        return (string) stream_get_contents($stream);
    }

    private function put(Worksheet $ws, int $col, int $row, mixed $v): void
    {
        if (is_float($v) || is_int($v)) {
            $ws->setCellValue([$col, $row], $v);
            $ws->getStyle([$col, $row])->getNumberFormat()->setFormatCode(is_float($v) && floor($v) != $v ? '#,##0.00##' : '#,##0');
        } elseif ($v !== null) {
            $ws->setCellValue([$col, $row], (string) $v);
        }
    }
}
