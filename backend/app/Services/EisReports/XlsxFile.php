<?php

namespace App\Services\EisReports;

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use ZipArchive;

/**
 * Pembungkus kecil agar workbook bisa disimpan ke jalur berkas lalu dilepas dari memori. Berkas yang dihasilkan **deterministik**: isi yang sama menghasilkan byte yang sama
 * (impor laporan memakai sidik SHA-256 berkas untuk mengenali duplikat), jadi cap waktu pada properti dokumen dan pada entri ZIP ditetapkan tetap.
 */
class XlsxFile
{
    /** 2000-01-01 00:00 UTC. */
    private const FIXED_TIME = 946684800;

    public function __construct(private readonly Spreadsheet $sheet) {}

    public function save(string $path): void
    {
        $this->sheet->getProperties()->setCreator('DISTRIVA')->setLastModifiedBy('DISTRIVA')->setCreated(self::FIXED_TIME)->setModified(self::FIXED_TIME);
        (new Xlsx($this->sheet))->save($path);
        $this->sheet->disconnectWorksheets();

        $zip = new ZipArchive;
        if ($zip->open($path) === true) {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $zip->setMtimeIndex($i, self::FIXED_TIME);
            }
            $zip->close();
        }
    }

    public function spreadsheet(): Spreadsheet
    {
        return $this->sheet;
    }
}
