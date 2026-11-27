<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Protection;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Workbook target NKO (docs/93 §12): satu tab per unit; baris 4 judul kolom (KODE, KPI, SATUAN, BOBOT, JAN..DES), data mulai baris 5, tahun di sel A2.
 * Baris tanpa KODE hanya judul kelompok. Template ditulis dari definisi aktif dan target yang sedang berlaku.
 */
class NkoTargetWorkbook
{
    private const HEADER_ROW = 4;

    private const FIRST_MONTH_COLUMN = 5;

    private const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];

    /** target berbentuk rentang, mis. "95 - 105" */
    private const RANGE = '/^-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?$/';

    private const GUIDE = [
        'Petunjuk workbook target NKO',
        '',
        '1. Satu tab per unit, bernama "UP3 <nama unit>" atau "ULP <nama unit>" persis seperti di master unit DISTRIVA. Untuk unit baru, salin salah satu tab lalu ganti namanya.',
        '2. Isi hanya kolom JAN sampai DES (target kumulatif). Kolom KODE jangan diubah; baris tanpa KODE adalah judul.',
        '3. Angka ditulis sebagai angka (bukan teks). Target berbentuk rentang ditulis "95 - 105".',
        '4. Sel kosong menghapus target bulan itu. Baris atau tab yang dihapus dari berkas tidak diubah.',
        '5. Item baru ditambahkan lewat workbook definisi, bukan di sini.',
        '6. Unggahan baru berlaku setelah disetujui ASMAN_PERENCANAAN.',
    ];

    /** @throws NkoRuleException 404 bila belum ada definisi aktif atau unit untuk tingkat itu */
    public function write(int $year, string $level, string $path): void
    {
        $set = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('status', 'AKTIF')->first();
        if ($set === null) {
            throw new NkoRuleException("Belum ada definisi NKO {$level} aktif tahun {$year}. Muat definisinya lebih dulu.", 404);
        }
        $definitions = DB::table('kpi_definitions')->where('set_id', $set->id)->orderBy('sort_order')->get()->all();
        $parents = array_flip(array_filter(array_column($definitions, 'parent_id')));
        $targets = [];
        foreach (DB::table('kpi_targets')->whereIn('definition_id', array_column($definitions, 'id'))->get() as $t) {
            $targets[$t->organizational_unit_id][$t->definition_id][(int) substr($t->period, 5, 2)] = $t->target_text ?? (float) $t->target_value;
        }
        // unit yang punya target; bila belum ada satu pun, semua unit aktif tingkat itu
        $units = DB::table('organizational_units')->where('unit_type', $level)->when($targets !== [], fn ($q) => $q->whereIn('id', array_keys($targets)), fn ($q) => $q->where('is_active', true))
            ->orderBy('name')->get(['id', 'name'])->all();
        if ($units === []) {
            throw new NkoRuleException("Belum ada unit {$level} di master unit.", 404);
        }

        $book = new Spreadsheet;
        $guide = $book->getActiveSheet()->setTitle('PETUNJUK');
        foreach (self::GUIDE as $i => $line) {
            $guide->setCellValueExplicit('A'.($i + 1), $line, DataType::TYPE_STRING);
        }
        $guide->getStyle('A1')->getFont()->setBold(true);

        foreach ($units as $unit) {
            $ws = $book->createSheet();
            $ws->setTitle(mb_substr($level.' '.Str::upper(trim((string) preg_replace('/^'.$level.'\s+/i', '', $unit->name))), 0, 31));
            $this->sheet($ws, $year, $unit->name, $definitions, $parents, $targets[$unit->id] ?? []);
        }

        (new Xlsx($book))->save($path);
        $book->disconnectWorksheets();
    }

    /**
     * Tab yang bukan tab target dilewati beserta alasannya; sel yang tidak dapat dibaca dilaporkan di `invalid` dan `uncached`.
     *
     * @return array{year: ?int, sheets: list<array{sheet: string, level: string, unit_name: string, year: ?int, rows: list<array{row: int, code: string, months: array<int, array{value: ?float, text: ?string}>}>, invalid: list<string>, uncached: list<string>}>, tabs: list<array{sheet: string, status: string, level: ?string, unit_name: ?string, reason: ?string}>}
     */
    public function read(string $path): array
    {
        $book = IOFactory::createReaderForFile($path)->load($path);
        $sheets = [];
        $tabs = [];
        foreach ($book->getSheetNames() as $name) {
            $ws = $book->getSheetByName($name);
            $tab = ['sheet' => $name, 'status' => 'DILEWATI', 'level' => null, 'unit_name' => null, 'reason' => 'Bukan tab unit.'];
            if (! preg_match('/^(UP3|ULP)\s+(.+)$/i', trim($name), $m)) {
                $tabs[] = $tab;

                continue;
            }
            $tab = ['level' => strtoupper($m[1]), 'unit_name' => trim($m[2])] + $tab;
            if (strtoupper(trim((string) $ws->getCell('A'.self::HEADER_ROW)->getValue())) !== 'KODE') {
                $tabs[] = ['status' => 'GALAT', 'reason' => 'Sel A4 harus berisi "KODE". Unduh template target; workbook definisi diunggah lewat menu definisi.'] + $tab;

                continue;
            }
            $parsed = $this->readSheet($ws);
            if ($parsed['year'] === null) {
                $tabs[] = ['status' => 'GALAT', 'reason' => 'Sel A2 harus memuat tahun, mis. "TAHUN 2026".'] + $tab;

                continue;
            }
            $sheets[] = ['sheet' => $name, 'level' => $tab['level'], 'unit_name' => $tab['unit_name']] + $parsed;
            $tabs[] = ['status' => 'DIKENALI', 'reason' => null] + $tab;
        }
        $book->disconnectWorksheets();

        return ['year' => $sheets[0]['year'] ?? null, 'sheets' => $sheets, 'tabs' => $tabs];
    }

    /**
     * @param  list<object>  $definitions
     * @param  array<string, int>  $parents
     * @param  array<string, array<int, float|string>>  $targets
     */
    private function sheet(Worksheet $ws, int $year, string $unitName, array $definitions, array $parents, array $targets): void
    {
        $text = fn (string $cell, ?string $value) => $value === null || $value === '' ? null : $ws->setCellValueExplicit($cell, $value, DataType::TYPE_STRING);
        $text('A1', 'TARGET NKO '.Str::upper($unitName));
        $text('A2', "TAHUN {$year}");
        $header = ['KODE', 'KPI', 'SATUAN', 'BOBOT', ...self::MONTHS];
        foreach ($header as $i => $label) {
            $text(Coordinate::stringFromColumnIndex($i + 1).self::HEADER_ROW, $label);
        }
        $last = Coordinate::stringFromColumnIndex(count($header));
        $ws->getStyle('A1:'.$last.self::HEADER_ROW)->getFont()->setBold(true);

        $row = self::HEADER_ROW;
        foreach ($definitions as $d) {
            $row++;
            $input = $d->polarity !== null || isset($targets[$d->id]);
            $text('A'.$row, $input ? $d->code : null);
            $text('B'.$row, str_repeat('   ', (int) $d->level).$d->name);
            $text('C'.$row, $d->unit_label);
            $d->weight !== null ? $ws->setCellValue('D'.$row, (float) $d->weight) : $text('D'.$row, $d->weight_note);
            if (! $input) {
                isset($parents[$d->id]) && $ws->getStyle('B'.$row)->getFont()->setBold(true);

                continue;
            }
            $ws->getStyle(Coordinate::stringFromColumnIndex(self::FIRST_MONTH_COLUMN).$row.':'.$last.$row)->getProtection()->setLocked(Protection::PROTECTION_UNPROTECTED);
            foreach ($targets[$d->id] ?? [] as $month => $value) {
                $cell = Coordinate::stringFromColumnIndex(self::FIRST_MONTH_COLUMN + $month - 1).$row;
                is_string($value) ? $text($cell, $value) : $ws->setCellValue($cell, $value);
            }
        }
        $ws->getColumnDimension('A')->setWidth(28);
        $ws->getColumnDimension('B')->setWidth(60);
        $ws->getProtection()->setSheet(true);
        $ws->freezePane('C'.(self::HEADER_ROW + 1));
    }

    /** @return array{year: ?int, rows: list<array<string, mixed>>, invalid: list<string>, uncached: list<string>} */
    private function readSheet(Worksheet $ws): array
    {
        $year = preg_match('/(20\d{2})/', (string) $ws->getCell('A2')->getValue(), $m) ? (int) $m[1] : null;
        $rows = [];
        $invalid = [];
        $uncached = [];
        $last = $ws->getHighestRow();
        for ($r = self::HEADER_ROW + 1; $r <= $last; $r++) {
            $code = Str::lower(trim((string) $ws->getCell('A'.$r)->getValue()));
            if ($code === '') {
                continue;
            }
            $months = [];
            for ($month = 1; $month <= 12; $month++) {
                $cell = Coordinate::stringFromColumnIndex(self::FIRST_MONTH_COLUMN + $month - 1).$r;
                $value = $ws->getCell($cell)->getValue();
                if (is_string($value) && str_starts_with($value, '=')) {
                    $value = $ws->getCell($cell)->getOldCalculatedValue();
                    if ($value === null) {
                        $uncached[] = $cell;

                        continue;
                    }
                }
                $value = is_string($value) ? trim($value) : $value;
                if ($value === null || $value === '') {
                    continue;
                }
                if (is_int($value) || is_float($value)) {
                    $months[$month] = ['value' => (float) $value, 'text' => null];
                } elseif (is_string($value) && preg_match(self::RANGE, $value)) {
                    $months[$month] = ['value' => null, 'text' => mb_substr($value, 0, 40)];
                } else {
                    $invalid[] = $cell;
                }
            }
            $rows[] = ['row' => $r, 'code' => $code, 'months' => $months];
        }

        return ['year' => $year, 'rows' => $rows, 'invalid' => $invalid, 'uncached' => $uncached];
    }
}
