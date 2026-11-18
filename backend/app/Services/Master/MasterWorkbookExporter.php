<?php

namespace App\Services\Master;

use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Cell\DataValidation;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use RuntimeException;

/**
 * "MASTER DISTRIVA.xlsx": one workbook with the rules in force, built from the approved data, to be edited by the parent unit and uploaded again (docs/85).
 * Sheets: PETUNJUK, INFO, KHS and STANDAR_KONSTRUKSI (reference: the BOM may only use their codes), GAMBAR (the drawing inputs at the same cells the formulas refer to, so Excel calculates by itself),
 * one sheet per BOM group (row = line number; B = KHS code or formula, C = description, H..K = material / install / remove / return formulas) and a hidden _PETA (what each GAMBAR cell means).
 * Formulas are written exactly as stored (the workbook's own cell references), so an unchanged upload compares equal to the approved version.
 */
class MasterWorkbookExporter
{
    public const TEMPLATE_VERSION = '2';

    public const INFO_VERSION = 'B3';

    public const INFO_VALID_FROM = 'B5';

    public const INFO_BASIS = 'B6';

    public const BOM_HEAD_ROW = 8;

    /** HARGA and TARIF: titles above, column headers on this row, data below. */
    public const TABLE_HEAD_ROW = 4;

    /** @return array{groups:array<string,array{version:int,lines:int}>,skipped:list<string>,price_rows:int,tariff_rows:int} */
    public function build(string $path): array
    {
        $ss = new Spreadsheet;
        $ss->getProperties()->setTitle('MASTER DISTRIVA')->setCreator('DISTRIVA');
        $first = $ss->getActiveSheet();
        $first->setTitle('PETUNJUK');
        $info = $ss->createSheet()->setTitle('INFO');
        $khs = $ss->createSheet()->setTitle('KHS');
        $std = $ss->createSheet()->setTitle('STANDAR_KONSTRUKSI');
        $harga = $ss->createSheet()->setTitle('HARGA');
        $tarif = $ss->createSheet()->setTitle('TARIF');
        $gambar = $ss->createSheet()->setTitle('GAMBAR');

        $summary = ['groups' => [], 'skipped' => [], 'price_rows' => 0, 'tariff_rows' => 0];
        $peta = [];
        $occupied = [];
        $bomSheets = [];
        foreach ((array) config('distriva.bom_groups') as $group) {
            $h = DB::table('bom_headers')->where('group_code', $group)->where('status', 'APPROVED')->orderByDesc('version_number')->first();
            $map = $h === null ? null : DB::table('bom_input_maps')->where('bom_header_id', $h->id)->first();
            if ($h === null || $map === null) {
                $summary['skipped'][] = $group.($h === null ? ' (belum ada versi disetujui)' : ' (peta sel gambar belum ada: jalankan php artisan bom:backfill-input-maps)');

                continue;
            }
            $inputs = json_decode((string) $map->inputs, true) ?: [];
            $constants = (array) (json_decode((string) $map->constants, true) ?: []);
            $params = json_decode((string) $h->parameters, true) ?: [];
            foreach ($inputs as $in) {
                $occupied[$in['cell']] = true;
                $peta[] = ['INPUT', $group, $in['cell'], $in['label'], json_encode(['kind' => $in['kind']])];
            }
            foreach ($params as $p) {
                $occupied[$p['cell']] = true;
                $peta[] = ['PARAM', $group, $p['cell'], $p['name'], json_encode(['type' => $p['type'] ?? 'number', 'default' => $p['default'] ?? 0, 'options' => $p['options'] ?? null, 'description' => $p['description'] ?? null], JSON_UNESCAPED_UNICODE)];
            }
            foreach ($constants as $cell => $text) {
                $occupied[$cell] = true;
                $peta[] = ['CONST', $group, $cell, $text, null];
            }
            $bomSheets[$group] = [$h, $inputs, $params, $constants];
        }

        $this->petunjuk($first);
        $this->infoSheet($info, $bomSheets);
        $this->khsSheet($khs);
        $this->standardSheet($std);
        $summary['price_rows'] = $this->hargaSheet($harga);
        $summary['tariff_rows'] = $this->tarifSheet($tarif);
        $this->gambarSheet($gambar, $bomSheets, $occupied);
        foreach ($bomSheets as $group => [$h]) {
            $lines = $this->bomSheet($ss->createSheet()->setTitle($group), (string) $group, $h);
            $summary['groups'][$group] = ['version' => (int) $h->version_number, 'lines' => $lines];
        }
        $petaSheet = $ss->createSheet()->setTitle('_PETA');
        $petaSheet->fromArray(array_merge([['JENIS', 'KELOMPOK', 'SEL', 'LABEL / NAMA', 'KETERANGAN (JSON)']], $peta), null, 'A1');
        $petaSheet->setSheetState(Worksheet::SHEETSTATE_HIDDEN);
        $ss->setActiveSheetIndex(0);

        $writer = new Xlsx($ss);
        $writer->setPreCalculateFormulas(true);
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            throw new RuntimeException('Folder keluaran tidak dapat dibuat.');
        }
        $writer->save($path);
        $ss->disconnectWorksheets();

        return $summary;
    }

    private function head(Worksheet $s, string $range): void
    {
        $s->getStyle($range)->getFont()->setBold(true);
        $s->getStyle($range)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('DCE6F1');
    }

    private function petunjuk(Worksheet $s): void
    {
        $rows = [
            'MASTER DISTRIVA: aturan hitung BOM yang berlaku (diisi dan dikirim kembali oleh unit induk)',
            '',
            '1. Berkas ini dibuat DISTRIVA dari data yang BERLAKU. Ubah hanya sel yang dibolehkan di bawah, lalu kirim kembali ke tim DISTRIVA untuk diunggah.',
            '2. Lembar INFO: isi "Berlaku sejak" (tanggal mulai berlaku aturan baru) dan "Dasar perubahan" (nomor dan tanggal surat). Jangan ubah nomor versi template.',
            '3. Lembar BOM per kelompok (SUTM, MVTIC, ...): satu baris = satu baris BOM. Nomor baris Excel adalah nomor urut BOM, jadi JANGAN menyisip atau menghapus baris; ubah isi sel saja.',
            '   Kolom B = kode KHS (atau rumus yang menghasilkan kode), C = uraian, H = kebutuhan material, I = pasang, J = bongkar, K = kembali (angka tetap atau rumus).',
            '4. Rumus ditulis seperti di Excel. Fungsi yang dikenali: IF, OR, AND, SUM, SUMIF, TRUNC, ROUND, ROUNDUP, dan operator + - * / ^ & dan pembanding. Fungsi lain ditolak.',
            '   Rujukan yang boleh: sel pada baris lembar yang sama (kolom B, H, I, J, K) dan sel lembar GAMBAR. Rujukan ke lembar lain ditolak.',
            '5. Kode KHS pada kolom B harus ada di lembar KHS. Kode baru harus didaftarkan lebih dulu lewat halaman KHS DISTRIVA.',
            '6. Lembar GAMBAR berisi jumlah pasang/bongkar tiap jenis konstruksi dan parameter (sel kuning). Isi contoh angka di sana untuk melihat hasil hitung di lembar BOM; DISTRIVA menghitung ulang',
            '   dengan angka yang sama dan membandingkannya dengan hasil Excel. Jika berbeda, unggahan ditolak dengan daftar baris yang berbeda.',
            '7. Simpan dari Excel (agar hasil hitung tersimpan). Lembar _PETA tersembunyi: jangan diubah. Lembar KHS dan STANDAR_KONSTRUKSI hanya rujukan.',
            '8. Lembar HARGA: ubah HARGA MATERIAL dan harga jasa PASANG/BONGKAR per zona (angka, rupiah). Kode KHS, status (HARGA/PLN), dan nilai asuransi hanya rujukan: yang berlaku tetap dipertahankan. Baris tidak boleh ditambah atau dihapus.',
            '9. Lembar TARIF: ubah harga rata-rata, jam nyala (jam per bulan, bukan ribuan), dan UJL per tarif dan daya. Kolom ULP kosong = berlaku untuk semua ULP; jam nyala per ULP diisi dengan kode ULP. Baris yang tidak ada di sini tetap seperti yang berlaku.',
            '10. Berkas yang diterima menjadi DRAFT; aturan baru berlaku setelah disetujui akun DISTRIVA lain. Data yang sudah berlaku tidak pernah ditimpa.',
        ];
        foreach ($rows as $i => $t) {
            $s->setCellValue('A'.($i + 1), $t);
        }
        $s->getStyle('A1')->getFont()->setBold(true)->setSize(13);
        $s->getColumnDimension('A')->setWidth(150);
    }

    /** @param array<string,array{0:object}> $bomSheets */
    private function infoSheet(Worksheet $s, array $bomSheets): void
    {
        $s->setCellValue('A1', 'INFO TEMPLATE');
        $s->getStyle('A1')->getFont()->setBold(true)->setSize(13);
        $s->setCellValue('A3', 'Versi template');
        $s->setCellValueExplicit(self::INFO_VERSION, self::TEMPLATE_VERSION, DataType::TYPE_STRING);
        $s->setCellValue('A4', 'Dibuat');
        $s->setCellValue('B4', now()->toDateTimeString());
        $s->setCellValue('A5', 'Berlaku sejak (YYYY-MM-DD)');
        $s->setCellValueExplicit(self::INFO_VALID_FROM, now()->addDay()->toDateString(), DataType::TYPE_STRING);
        $s->setCellValue('A6', 'Dasar perubahan (no. dan tanggal surat)');
        $s->getStyle(self::INFO_VALID_FROM.':'.self::INFO_BASIS)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FFF2CC');
        $s->setCellValue('A8', 'KELOMPOK');
        $s->setCellValue('B8', 'VERSI DASAR');
        $s->setCellValue('C8', 'BERLAKU SEJAK');
        $this->head($s, 'A8:C8');
        $r = 9;
        foreach ($bomSheets as $group => [$h]) {
            $s->setCellValue('A'.$r, $group);
            $s->setCellValue('B'.$r, (int) $h->version_number);
            $s->setCellValue('C'.$r, (string) $h->valid_from);
            $r++;
        }
        $s->getColumnDimension('A')->setWidth(42);
        $s->getColumnDimension('B')->setWidth(28);
        $s->getColumnDimension('C')->setWidth(18);
    }

    /** The approved price book: per KHS code the material price and the install / remove price of every zone the book uses. @return int rows written */
    private function hargaSheet(Worksheet $s): int
    {
        $pb = DB::table('price_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
        $s->setCellValue('A1', 'HARGA: '.($pb === null ? 'belum ada buku harga yang disetujui' : "{$pb->name} (berlaku sejak {$pb->valid_from})"));
        $s->getStyle('A1')->getFont()->setBold(true)->setSize(13);
        $s->setCellValue('A2', 'Ubah angka pada kolom HARGA MATERIAL dan PASANG/BONGKAR (rupiah). Kolom A-C dan E hanya rujukan. Jangan sisip, hapus, atau ubah urutan kolom dan baris.');
        $h = self::TABLE_HEAD_ROW;
        $zones = $pb === null ? [] : DB::table('price_book_service_prices as sp')->join('price_book_items as pi', 'pi.id', '=', 'sp.price_book_item_id')->where('pi.price_book_id', $pb->id)->distinct()->orderBy('sp.zone')->pluck('sp.zone')->map(fn ($z) => (int) $z)->all();
        $head = ['KODE KHS', 'NAMA', 'STATUS MATERIAL', 'HARGA MATERIAL', 'NILAI ASURANSI'];
        foreach ($zones as $z) {
            array_push($head, "ZONA {$z} PASANG", "ZONA {$z} BONGKAR");
        }
        $last = Coordinate::stringFromColumnIndex(count($head));
        $s->fromArray([$head], null, 'A'.$h);
        $this->head($s, "A{$h}:{$last}{$h}");
        $r = $h;
        if ($pb !== null) {
            $names = DB::table('khs_item_versions as v')->whereRaw('v.version_number = (select max(x.version_number) from khs_item_versions x where x.khs_item_id = v.khs_item_id)')->pluck('v.name', 'v.khs_item_id')->all();
            foreach (DB::table('price_book_items as p')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')->where('p.price_book_id', $pb->id)->orderBy('i.code')->get(['p.id', 'p.khs_item_id', 'i.code', 'p.material_status', 'p.material_price', 'p.insured_value']) as $p) {
                $r++;
                $s->setCellValueExplicit('A'.$r, (string) $p->code, DataType::TYPE_STRING);
                $s->setCellValueExplicit('B'.$r, (string) ($names[$p->khs_item_id] ?? ''), DataType::TYPE_STRING);
                $s->setCellValueExplicit('C'.$r, $p->material_status === 'PLN' ? 'PLN' : 'HARGA', DataType::TYPE_STRING);
                $p->material_price !== null && $s->setCellValue('D'.$r, (float) $p->material_price);
                $p->insured_value !== null && $s->setCellValue('E'.$r, (float) $p->insured_value);
                $svc = DB::table('price_book_service_prices')->where('price_book_item_id', $p->id)->get()->keyBy(fn ($x) => (int) $x->zone);
                foreach ($zones as $i => $z) {
                    if (isset($svc[$z])) {
                        $s->setCellValue(Coordinate::stringFromColumnIndex(6 + $i * 2).$r, (float) $svc[$z]->install_price);
                        $s->setCellValue(Coordinate::stringFromColumnIndex(7 + $i * 2).$r, (float) $svc[$z]->remove_price);
                    }
                }
            }
            if ($r > $h) {
                $s->getStyle('D'.($h + 1).':'.$last.$r)->getNumberFormat()->setFormatCode('#,##0');
                $s->getStyle('D'.($h + 1).':D'.$r)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FFF2CC');
                if ($zones !== []) {
                    $s->getStyle('F'.($h + 1).':'.$last.$r)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FFF2CC');
                }
            }
        }
        $s->getColumnDimension('A')->setWidth(14);
        $s->getColumnDimension('B')->setWidth(60);
        $s->getColumnDimension('C')->setWidth(16);
        $s->freezePane('C'.($h + 1));

        return $r - $h;
    }

    /** The approved tariff book: average price, jam nyala and UJL per tariff, power and ULP (blank ULP = every ULP). @return int rows written */
    private function tarifSheet(Worksheet $s): int
    {
        $book = DB::table('tariff_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
        $s->setCellValue('A1', 'TARIF: '.($book === null ? 'belum ada buku tarif yang disetujui' : "{$book->name} (berlaku sejak {$book->valid_from})"));
        $s->getStyle('A1')->getFont()->setBold(true)->setSize(13);
        $s->setCellValue('A2', 'Ubah harga rata-rata, jam nyala (jam per bulan), dan UJL. Kolom TARIF, DAYA, dan ULP menentukan baris: jangan diubah. Kolom ULP kosong = berlaku untuk semua ULP.');
        $h = self::TABLE_HEAD_ROW;
        $s->fromArray([['TARIF', 'DAYA (VA)', 'HARGA RATA-RATA', 'JAM NYALA', 'UJL', 'ULP']], null, 'A'.$h);
        $this->head($s, "A{$h}:F{$h}");
        $r = $h;
        if ($book !== null) {
            foreach (DB::table('tariff_book_rows as t')->leftJoin('organizational_units as u', 'u.id', '=', 't.ulp_unit_id')->where('t.tariff_book_id', $book->id)->orderBy('t.tariff_code')->orderBy('t.power_va')->orderBy('u.code')->get(['t.tariff_code', 't.power_va', 't.avg_price', 't.jam_nyala', 't.ujl', 'u.code as ulp']) as $t) {
                $r++;
                $s->setCellValueExplicit('A'.$r, (string) $t->tariff_code, DataType::TYPE_STRING);
                $t->power_va !== null && $s->setCellValue('B'.$r, (int) $t->power_va);
                $t->avg_price !== null && $s->setCellValue('C'.$r, (float) $t->avg_price);
                $t->jam_nyala !== null && $s->setCellValue('D'.$r, (float) $t->jam_nyala);
                $t->ujl !== null && $s->setCellValue('E'.$r, (float) $t->ujl);
                $s->setCellValueExplicit('F'.$r, (string) ($t->ulp ?? ''), DataType::TYPE_STRING);
            }
            if ($r > $h) {
                $s->getStyle('C'.($h + 1).':E'.$r)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('FFF2CC');
            }
        }
        foreach (['A' => 12, 'B' => 12, 'C' => 18, 'D' => 14, 'E' => 12, 'F' => 14] as $c => $w) {
            $s->getColumnDimension($c)->setWidth($w);
        }
        $s->freezePane('A'.($h + 1));

        return $r - $h;
    }

    private function khsSheet(Worksheet $s): void
    {
        $s->fromArray([['KODE KHS', 'NAMA', 'SATUAN', 'KATEGORI', 'BERLAKU SEJAK']], null, 'A1');
        $this->head($s, 'A1:E1');
        $rows = DB::table('khs_items as i')->join('khs_item_versions as v', 'v.khs_item_id', '=', 'i.id')->where('v.status', 'APPROVED')
            ->orderBy('i.code')->orderByDesc('v.version_number')->get(['i.code', 'v.name', 'v.unit_text', 'v.category', 'v.valid_from'])->unique('code');
        $r = 2;
        foreach ($rows as $x) {
            $s->setCellValueExplicit('A'.$r, (string) $x->code, DataType::TYPE_STRING);
            $s->setCellValueExplicit('B'.$r, (string) $x->name, DataType::TYPE_STRING);
            $s->setCellValueExplicit('C'.$r, (string) $x->unit_text, DataType::TYPE_STRING);
            $s->setCellValueExplicit('D'.$r, (string) $x->category, DataType::TYPE_STRING);
            $s->setCellValueExplicit('E'.$r, (string) $x->valid_from, DataType::TYPE_STRING);
            $r++;
        }
        $s->getColumnDimension('A')->setWidth(16);
        $s->getColumnDimension('B')->setWidth(70);
        $s->freezePane('A2');
    }

    private function standardSheet(Worksheet $s): void
    {
        $s->fromArray([['KELOMPOK', 'KODE', 'NAMA', 'SIMBOL ACUAN']], null, 'A1');
        $this->head($s, 'A1:D1');
        $rows = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->where('v.status', 'APPROVED')
            ->orderBy('t.group_code')->orderBy('t.code')->orderByDesc('v.version_number')->get(['t.group_code', 't.code', 'v.name', 'v.reference_symbol'])->unique('code');
        $r = 2;
        foreach ($rows as $x) {
            foreach ([(string) $x->group_code, (string) $x->code, (string) $x->name, (string) $x->reference_symbol] as $i => $v) {
                $s->setCellValueExplicit(Coordinate::stringFromColumnIndex($i + 1).$r, $v, DataType::TYPE_STRING);
            }
            $r++;
        }
        $s->getColumnDimension('C')->setWidth(60);
        $s->freezePane('A2');
    }

    /**
     * @param  array<string,array{0:object,1:list<array<string,mixed>>,2:list<array<string,mixed>>,3:array<string,string>}>  $bomSheets
     * @param  array<string,bool>  $occupied
     */
    private function gambarSheet(Worksheet $s, array $bomSheets, array $occupied): void
    {
        $yellow = 'FFF2CC';
        foreach ($bomSheets as $group => [, $inputs, $params, $constants]) {
            foreach ($inputs as $in) {
                $s->setCellValue($in['cell'], 0);
                $s->getStyle($in['cell'])->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB($yellow);
                if ($in['kind'] === 'PSG') {                                      // the label sits left of the PSG cell, as in the drawing sheet
                    [$col, $row] = Coordinate::coordinateFromString($in['cell']);
                    $idx = Coordinate::columnIndexFromString($col);
                    $label = $idx > 1 ? Coordinate::stringFromColumnIndex($idx - 1).$row : null;
                    if ($label !== null && ! isset($occupied[$label])) {
                        $s->setCellValueExplicit($label, (string) $in['label'], DataType::TYPE_STRING);
                    }
                }
            }
            foreach ($params as $p) {
                if (($p['type'] ?? 'number') === 'text') {
                    $s->setCellValueExplicit($p['cell'], (string) ($p['default'] ?? ''), DataType::TYPE_STRING);
                    if (is_array($p['options'] ?? null) && $p['options'] !== []) {
                        $v = $s->getCell($p['cell'])->getDataValidation();
                        $v->setType(DataValidation::TYPE_LIST)->setAllowBlank(true)->setShowDropDown(true)->setFormula1('"'.str_replace('"', '', implode(',', $p['options'])).'"');
                    }
                } else {
                    $s->setCellValue($p['cell'], (float) ($p['default'] ?? 0));
                }
                $s->getStyle($p['cell'])->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB($yellow);
                if (! empty($p['description'])) {
                    $s->getComment($p['cell'])->getText()->createTextRun((string) $p['description']);
                }
            }
            foreach ($constants as $cell => $text) {
                $s->setCellValueExplicit($cell, (string) $text, DataType::TYPE_STRING);
            }
        }
        $s->getStyle('A1:ZZ1')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_LEFT);
    }

    private function bomSheet(Worksheet $s, string $group, object $h): int
    {
        $s->setCellValue('A1', "BOM {$group}: versi {$h->version_number} (berlaku sejak {$h->valid_from})");
        $s->getStyle('A1')->getFont()->setBold(true)->setSize(13);
        $s->setCellValue('A2', 'Baris Excel = nomor urut BOM (jangan sisip/hapus baris). B = kode KHS atau rumus; H..K = angka atau rumus; rujukan hanya ke baris ini (B, H-K) dan lembar GAMBAR.');
        $r0 = self::BOM_HEAD_ROW;
        $s->fromArray([['BARIS', 'KODE KHS / RUMUS', 'URAIAN', '', '', '', '', 'MATERIAL', 'PASANG', 'BONGKAR', 'KEMBALI']], null, 'A'.$r0);
        $this->head($s, "A{$r0}:K{$r0}");
        $n = 0;
        foreach (DB::table('bom_lines as l')->leftJoin('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.bom_header_id', $h->id)->orderBy('l.sequence')->get(['l.sequence', 'l.description', 'l.source_formulas', 'k.code as khs_code']) as $l) {
            $r = (int) $l->sequence;
            if ($r <= $r0) {
                throw new RuntimeException("BOM {$group}: baris {$r} bertabrakan dengan judul kolom template (baris 1-{$r0}); nomor urut BOM harus lebih besar dari {$r0}.");
            }
            $src = json_decode((string) $l->source_formulas, true) ?: [];
            $s->setCellValue('A'.$r, $r);
            $s->setCellValueExplicit('C'.$r, (string) ($l->description ?? ''), DataType::TYPE_STRING);
            if (isset($src['B']) && trim((string) $src['B']) !== '') {
                $s->setCellValue('B'.$r, '='.ltrim(trim((string) $src['B']), '='));
            } elseif ($l->khs_code !== null) {
                $s->setCellValueExplicit('B'.$r, (string) $l->khs_code, DataType::TYPE_STRING);
            }
            foreach (['H', 'I', 'J', 'K'] as $col) {
                $t = isset($src[$col]) ? trim((string) $src[$col]) : '';
                if ($t === '') {
                    continue;
                }
                is_numeric($t) ? $s->setCellValue($col.$r, $t + 0) : $s->setCellValue($col.$r, '='.ltrim($t, '='));
            }
            $n++;
        }
        $s->getColumnDimension('A')->setWidth(8);
        $s->getColumnDimension('B')->setWidth(34);
        $s->getColumnDimension('C')->setWidth(58);
        foreach (['H', 'I', 'J', 'K'] as $c) {
            $s->getColumnDimension($c)->setWidth(14);
        }
        $s->freezePane('D'.($r0 + 1));

        return $n;
    }
}
