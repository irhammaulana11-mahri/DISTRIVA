<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Template workbook definisi NKO dari definisi aktif (docs/93 §10): satu tab per unit dengan tata letak yang dibaca `NkoWorkbookReader`, sehingga diunggah
 * tanpa diubah menghasilkan definisi yang sama. Realisasi ditulis sebagai angka (tanpa rumus ke workbook lain); lembar sumbernya di kolom "SUMBER REALISASI".
 * Rumus disimpan tanpa hasil hitung, jadi angka acuan pencapaian dan nilai baru ada setelah berkas dibuka dan disimpan di Excel.
 * Untuk tahun yang belum punya definisi, dipakai versi aktif tahun terakhir tanpa target dan realisasi.
 */
class NkoDefinitionTemplateService
{
    private const BLOCK_START = 'Z';

    private const BLOCK_WIDTH = 8;

    private const GUIDE = [
        'Petunjuk workbook definisi NKO',
        '',
        '1. Satu tab per unit, bernama "UP3 <nama unit>" atau "ULP <nama unit>" persis seperti di master unit DISTRIVA. Tab lain (seperti tab ini) dilewati.',
        '2. Baris 9 adalah judul kolom: A NO, B KPI, C POLARITAS, D FORMULA, E SATUAN, F BOBOT. Sel H9 berisi tahun, mis. "TARGET 2026", dan harus sama dengan tahun yang dipilih saat unggah.',
        '3. Kelompok: nomor di kolom A. Indikator: "a. Nama" di kolom B. Sub-indikator: "- Nama" di kolom B.',
        '4. Kolom J "KODE" adalah kunci item lintas versi: jangan diubah, juga saat item berganti nama, agar target dan aturan realisasinya tetap tersambung. Kosongkan untuk item baru; kodenya dibentuk dari nama.',
        '5. Polaritas: 1 atau Negatif (makin kecil makin baik), 2 atau Rentang, 3 atau Positif (makin besar makin baik).',
        '6. Jumlah bobot kelompok harus 100. Bobot pengurang ditulis sebagai teks, mis. "Max-8".',
        '7. Target kumulatif per bulan di kolom M (Januari) sampai X (Desember); wajib diisi untuk setiap item berbobot.',
        '8. Kolom I "SUMBER REALISASI": nama lembar sumber realisasi; kosong berarti item tidak butuh realisasi.',
        '9. Blok bulanan mulai kolom Z (TARGET, REALISASI, PENCAPAIAN, NILAI, tiap bulan 8 kolom) memuat rumus pencapaian dan nilai. Jangan menggeser kolom atau baris TOTAL.',
        '10. Bila ada rumus yang merujuk workbook lain, buka di Excel, perbarui tautan, lalu simpan sebelum diunggah: yang dibaca adalah nilai terakhir yang tersimpan.',
        '11. Unggahan baru berlaku setelah disetujui ASMAN_PERENCANAAN.',
    ];

    /** @throws NkoRuleException 404 bila belum ada definisi sama sekali */
    public function write(int $year, string $path): void
    {
        $book = new Spreadsheet;
        $book->getActiveSheet()->setTitle('PETUNJUK');
        foreach (self::GUIDE as $i => $line) {
            $book->getActiveSheet()->setCellValueExplicit('A'.($i + 1), $line, DataType::TYPE_STRING);
        }
        $book->getActiveSheet()->getStyle('A1')->getFont()->setBold(true);

        $tabs = 0;
        foreach (['UP3', 'ULP'] as $level) {
            $set = DB::table('kpi_definition_sets')->where('unit_level', $level)->where('status', 'AKTIF')->where('year', '<=', $year)->orderByDesc('year')->first();
            if ($set === null) {
                continue;
            }
            $sameYear = (int) $set->year === $year;
            $definitions = DB::table('kpi_definitions')->where('set_id', $set->id)->orderBy('sort_order')->get()->all();
            $monthRules = json_decode($set->month_rules ?? '[]', true) ?: [];
            foreach ($this->units($set->id, $monthRules['canonical_sheet'] ?? null) as $unit) {
                $ws = $book->createSheet();
                $ws->setTitle(mb_substr($level.' '.Str::upper(trim((string) preg_replace('/^'.$level.'\s+/i', '', $unit->name))), 0, 31));
                $this->sheet($ws, $year, $unit, $definitions, $monthRules['months'] ?? [], $sameYear);
                $tabs++;
            }
        }
        if ($tabs === 0) {
            $years = DB::table('kpi_definition_sets')->where('status', 'AKTIF')->distinct()->orderBy('year')->pluck('year')->map(fn ($y) => (string) $y)->all();
            throw new NkoRuleException($years === []
                ? 'Belum ada definisi NKO aktif untuk dijadikan template. Muat workbook definisi lebih dulu.'
                : "Belum ada definisi NKO tahun {$year} atau sebelumnya untuk dijadikan template. Definisi aktif tersedia untuk tahun ".implode(', ', $years).'; pilih tahun itu atau sesudahnya.', 404);
        }

        $writer = new Xlsx($book);
        $writer->setPreCalculateFormulas(false);     // hasil hitung pustaka ini bisa berbeda dari Excel; Excel menghitung ulang saat berkas dibuka
        $writer->save($path);
        $book->disconnectWorksheets();
    }

    /**
     * Unit yang punya target di set itu; tab acuan saat impor lalu didahulukan agar aturan dasarnya tetap.
     *
     * @return list<object>
     */
    private function units(string $setId, ?string $canonical): array
    {
        $units = DB::table('organizational_units as u')->whereIn('u.id', DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->where('d.set_id', $setId)->select('t.organizational_unit_id'))
            ->orderBy('u.name')->get(['u.id', 'u.name', 'u.unit_type'])->all();
        $key = fn (object $u) => Str::lower($u->unit_type.' '.preg_replace('/^'.$u->unit_type.'\s+/i', '', $u->name));
        usort($units, fn (object $a, object $b) => ($key($b) === Str::lower((string) $canonical)) <=> ($key($a) === Str::lower((string) $canonical)));

        return $units;
    }

    /**
     * @param  list<object>  $definitions
     * @param  array<int, array<string, mixed>>  $months
     */
    private function sheet(Worksheet $ws, int $year, object $unit, array $definitions, array $months, bool $sameYear): void
    {
        $row = NkoWorkbookReader::HEADER_ROW;
        $text = fn (string $cell, ?string $value) => $value === null || $value === '' ? null : $ws->setCellValueExplicit($cell, $value, DataType::TYPE_STRING);
        $text('A1', 'DEFINISI NKO '.Str::upper($unit->name));
        $text('A2', "TAHUN {$year}");
        foreach (['A' => 'NO', 'B' => 'KPI', 'C' => 'POLARITAS', 'D' => 'FORMULA', 'E' => 'SATUAN', 'F' => 'BOBOT', 'H' => "TARGET {$year}", NkoWorkbookReader::SOURCE_COLUMN => NkoWorkbookReader::SOURCE_HEADER, NkoWorkbookReader::CODE_COLUMN => NkoWorkbookReader::CODE_HEADER] as $col => $label) {
            $text($col.$row, $label);
        }
        $monthNames = array_flip(NkoWorkbookReader::MONTHS);
        foreach (NkoWorkbookReader::TARGET_COLUMNS as $i => $col) {
            $text($col.($row + 1), mb_substr($monthNames[$i + 1], 0, 3));
        }
        $blocks = [];
        foreach (array_keys($months) as $month) {
            $first = Coordinate::columnIndexFromString(self::BLOCK_START) + self::BLOCK_WIDTH * ((int) $month - 1);
            $blocks[(int) $month] = ['target' => Coordinate::stringFromColumnIndex($first), 'real' => Coordinate::stringFromColumnIndex($first + 1), 'capai' => Coordinate::stringFromColumnIndex($first + 2), 'nilai' => Coordinate::stringFromColumnIndex($first + 3)];
            $name = $monthNames[(int) $month];
            foreach (['target' => "TARGET {$name}", 'real' => "REALISASI {$name}", 'capai' => 'PENCAPAIAN (%)', 'nilai' => 'NILAI'] as $part => $label) {
                $text($blocks[(int) $month][$part].$row, $label);
            }
        }
        $ws->getStyle('A'.$row.':'.($blocks === [] ? 'X' : end($blocks)['nilai']).$row)->getFont()->setBold(true);

        $ids = array_column($definitions, 'id');
        $targets = [];
        $reference = [];
        if ($sameYear) {
            foreach (DB::table('kpi_targets')->whereIn('definition_id', $ids)->where('organizational_unit_id', $unit->id)->get() as $t) {
                $targets[$t->definition_id][(int) substr($t->period, 5, 2)] = $t->target_text ?? (float) $t->target_value;
            }
            foreach (DB::table('kpi_reference_values')->whereIn('definition_id', $ids)->where('organizational_unit_id', $unit->id)->whereNotNull('realisasi')->get(['definition_id', 'period', 'realisasi']) as $r) {
                $reference[$r->definition_id][(int) substr($r->period, 5, 2)] = (float) $r->realisasi;
            }
        }
        $unitRules = DB::table('kpi_unit_rules')->whereIn('definition_id', $ids)->where('organizational_unit_id', $unit->id)->pluck('rules', 'definition_id')->map(fn (string $r) => json_decode($r, true))->all();

        foreach ($definitions as $d) {
            $r = (int) $d->row_no;
            match ((int) $d->level) {
                0 => [$text('A'.$r, (string) $d->number), $text('B'.$r, $d->name)],
                1 => $text('B'.$r, $d->number !== null ? "{$d->number}. {$d->name}" : $d->name),
                default => $text('B'.$r, "- {$d->name}"),
            };
            if ($d->polarity !== null) {
                $ws->setCellValue('C'.$r, (int) $d->polarity);
            }
            $text('D'.$r, $d->formula_text);
            $text('E'.$r, $d->unit_label);
            $d->weight !== null ? $ws->setCellValue('F'.$r, (float) $d->weight) : $text('F'.$r, $d->weight_note);
            $text(NkoWorkbookReader::SOURCE_COLUMN.$r, $d->source_sheet);
            $text(NkoWorkbookReader::CODE_COLUMN.$r, $d->code);
            foreach ($targets[$d->id] ?? [] as $month => $value) {
                $cell = NkoWorkbookReader::TARGET_COLUMNS[$month - 1].$r;
                is_string($value) ? $text($cell, $value) : $ws->setCellValue($cell, $value);
            }

            $rules = array_merge(json_decode($d->rules ?? '[]', true) ?: [], $unitRules[$d->id] ?? []);
            foreach ($blocks as $month => $cols) {
                $ws->setCellValue($cols['target'].$r, '='.NkoWorkbookReader::TARGET_COLUMNS[$month - 1].$r);
                if (isset($reference[$d->id][$month])) {
                    $ws->setCellValue($cols['real'].$r, $reference[$d->id][$month]);
                }
                foreach (['capai' => 'pencapaian', 'nilai' => 'nilai'] as $part => $key) {
                    $formula = $month === 1 || ! array_key_exists($key, $rules['months'][$month] ?? $rules['months'][(string) $month] ?? [])
                        ? ($rules[$key] ?? null) : ($rules['months'][$month] ?? $rules['months'][(string) $month])[$key];
                    $this->formula($ws, $cols[$part].$r, $month === 1 ? $formula : $this->forMonth($formula, $cols));
                }
            }
        }

        $first = $months[array_key_first($months)] ?? null;
        if ($first !== null) {
            $text('B'.$first['total_row'], 'TOTAL');
            if ($first['final_row'] !== null) {
                $text('A'.$first['final_row'], 'NOTE');
            }
        }
        foreach ($blocks as $month => $cols) {
            $m = $months[$month] ?? $months[(string) $month];
            $this->formula($ws, $cols['nilai'].($row + 1), $this->forMonth($m['total_formula'] ?? null, $cols));
            $ws->setCellValue($cols['nilai'].$m['total_row'], '='.$cols['nilai'].($row + 1));         // baris TOTAL merujuk total di baris 10, seperti workbook asal
            if ($m['final_row'] !== null) {
                $this->formula($ws, $cols['nilai'].$m['final_row'], $this->forMonth($m['final_formula'] ?? null, $cols));
            }
        }
        $ws->getColumnDimension('B')->setWidth(60);
        $ws->getColumnDimension('D')->setWidth(40);
        $ws->getColumnDimension(NkoWorkbookReader::CODE_COLUMN)->setWidth(28);
        $ws->freezePane('C'.($row + 2));
    }

    /** rumus disimpan dengan kolom baku Z, AA, AB, AC (lihat NkoWorkbookReader::canon); dikembalikan ke kolom blok bulan itu */
    private function forMonth(?string $formula, array $cols): ?string
    {
        if ($formula === null || ! str_starts_with($formula, '=')) {
            return $formula;
        }
        $map = ['Z' => $cols['target'], 'AA' => $cols['real'], 'AB' => $cols['capai'], 'AC' => $cols['nilai']];

        return preg_replace_callback('/(?<![A-Za-z$!\'])(\$?)([A-Z]{1,3})(\$?\d+)(?![\d(A-Za-z])/', fn ($m) => $m[1].($map[$m[2]] ?? $m[2]).$m[3], $formula);
    }

    private function formula(Worksheet $ws, string $cell, ?string $value): void
    {
        if ($value === null || $value === '') {
            return;
        }
        is_numeric($value) ? $ws->setCellValue($cell, (float) $value) : $ws->setCellValueExplicit($cell, $value, str_starts_with($value, '=') ? DataType::TYPE_FORMULA : DataType::TYPE_STRING);
    }
}
