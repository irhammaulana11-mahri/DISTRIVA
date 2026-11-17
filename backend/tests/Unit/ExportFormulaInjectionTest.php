<?php

namespace Tests\Unit;

use App\Http\Controllers\MaterialRequestController;
use App\Services\Output\XlsxRenderer;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** Data that reaches an export (customer names, notes entered by vendors) must never become a live formula in the spreadsheet or the CSV. */
class ExportFormulaInjectionTest extends TestCase
{
    #[Test]
    public function text_that_looks_like_a_formula_is_stored_as_text_in_xlsx(): void
    {
        $doc = ['title' => '=1+1', 'header' => [], 'meta' => [['Catatan', '=cmd|calc']], 'sections' => [['columns' => ['NAMA'], 'rows' => [['=HYPERLINK("http://x","a")'], [5], ['@SUM(1)']]]], 'signatures' => [], 'place_date' => 'Mojokerto, 18 November 2026'];
        $path = tempnam(sys_get_temp_dir(), 'x').'.xlsx';
        file_put_contents($path, (new XlsxRenderer)->render($doc));
        $ws = IOFactory::load($path)->getActiveSheet();
        $formulas = $values = [];
        foreach ($ws->getRowIterator() as $row) {
            foreach ($row->getCellIterator() as $cell) {
                $cell->getDataType() === DataType::TYPE_FORMULA && $formulas[] = $cell->getCoordinate();
                $values[] = $cell->getValue();
            }
        }
        $this->assertSame([], $formulas);
        $this->assertContains('=HYPERLINK("http://x","a")', $values);                                                       // kept, as text
    }

    #[Test]
    public function csv_cells_that_a_spreadsheet_would_run_get_an_apostrophe_and_numbers_are_untouched(): void
    {
        $this->assertSame("'=1+1", MaterialRequestController::csvSafe('=1+1'));
        $this->assertSame("'@SUM(A1)", MaterialRequestController::csvSafe('@SUM(A1)'));
        $this->assertSame("'+cmd|' /C calc", MaterialRequestController::csvSafe("+cmd|' /C calc"));
        $this->assertSame('+62812', MaterialRequestController::csvSafe('+62812'));
        $this->assertSame('-5', MaterialRequestController::csvSafe('-5'));
        $this->assertSame('KABEL', MaterialRequestController::csvSafe('KABEL'));
        $this->assertSame(3.5, MaterialRequestController::csvSafe(3.5));
        $this->assertNull(MaterialRequestController::csvSafe(null));
    }
}
