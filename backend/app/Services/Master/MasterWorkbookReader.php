<?php

namespace App\Services\Master;

use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as XlDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use Throwable;

/**
 * Reads an uploaded MASTER DISTRIVA workbook (see {@see MasterWorkbookExporter}) into the documents the BOM import takes ({group, inputs, params, constants, lines}), the drawing inputs typed on GAMBAR,
 * and the values Excel stored for each formula (to be compared with DISTRIVA's own calculation). Nothing is executed: formulas are read as text. Every layout problem is reported by cell, never guessed.
 */
class MasterWorkbookReader
{
    /**
     * @return array{
     *   meta: array{template_version:?string, valid_from:?string, basis:?string},
     *   docs: array<string,array<string,mixed>>,
     *   sim: array<string,array{psg_bkr:array<string,array{psg?:float,bkr?:float}>,params:array<string,mixed>,expected:array<int,array<string,mixed>>}>,
     *   problems: list<string>,
     *   price: array{rows:list<array<string,string>>,zones:list<int>},
     *   tariff: array{rows:list<array<string,string>>},
     *   kkf: array{values:array<string,float>,rules:array<string,string>,cases:list<array<string,mixed>>},
     *   rab_cases: list<array<string,mixed>>
     * }
     */
    public function read(string $path): array
    {
        $out = ['meta' => ['template_version' => null, 'valid_from' => null, 'basis' => null], 'docs' => [], 'sim' => [], 'problems' => [], 'price' => ['rows' => [], 'zones' => []], 'tariff' => ['rows' => []], 'kkf' => ['values' => [], 'rules' => [], 'cases' => []], 'rab_cases' => []];
        try {
            $reader = IOFactory::createReader('Xlsx');
            $reader->setReadDataOnly(false);
            $ss = $reader->load($path);
        } catch (Throwable) {
            $out['problems'][] = 'Berkas tidak dapat dibaca sebagai Excel (.xlsx).';

            return $out;
        }
        $names = $ss->getSheetNames();
        foreach (['INFO', 'GAMBAR', '_PETA', 'HARGA', 'TARIF', 'PARAMETER_KKF', 'ATURAN', 'UJI_KKF', 'UJI_RAB'] as $need) {
            if (! in_array($need, $names, true)) {
                $out['problems'][] = "Lembar {$need} tidak ditemukan: gunakan template yang diunduh dari DISTRIVA (jangan ubah nama lembar).";
            }
        }
        if ($out['problems'] !== []) {
            return $out;
        }

        $info = $ss->getSheetByName('INFO');
        $out['meta'] = ['template_version' => $this->text($info->getCell(MasterWorkbookExporter::INFO_VERSION)), 'valid_from' => $this->date($info->getCell(MasterWorkbookExporter::INFO_VALID_FROM)), 'basis' => $this->text($info->getCell(MasterWorkbookExporter::INFO_BASIS))];
        if ($out['meta']['template_version'] !== MasterWorkbookExporter::TEMPLATE_VERSION) {
            $out['problems'][] = 'Versi template '.($out['meta']['template_version'] ?? '(kosong)').' tidak sesuai; DISTRIVA memerlukan versi '.MasterWorkbookExporter::TEMPLATE_VERSION.'. Unduh template terbaru.';

            return $out;
        }
        if ($out['meta']['valid_from'] === null) {
            $out['problems'][] = 'INFO!'.MasterWorkbookExporter::INFO_VALID_FROM.': "Berlaku sejak" harus berupa tanggal YYYY-MM-DD.';
        }

        $gambar = $ss->getSheetByName('GAMBAR');
        $peta = ['INPUT' => [], 'PARAM' => [], 'CONST' => []];
        $ps = $ss->getSheetByName('_PETA');
        for ($r = 2; $r <= $ps->getHighestRow(); $r++) {
            $kind = $this->text($ps->getCell("A{$r}"));
            $group = $this->text($ps->getCell("B{$r}"));
            $cell = $this->text($ps->getCell("C{$r}"));
            if ($kind === null || $group === null || $cell === null || ! isset($peta[$kind])) {
                continue;
            }
            $peta[$kind][$group][] = ['cell' => $cell, 'label' => $this->text($ps->getCell("D{$r}")) ?? '', 'extra' => json_decode((string) $ps->getCell("E{$r}")->getValue(), true) ?: []];
        }

        foreach ($ss->getSheetNames() as $name) {
            if (! in_array($name, (array) config('distriva.bom_groups'), true)) {
                continue;
            }
            $inputs = array_map(fn ($p) => ['cell' => $p['cell'], 'group' => $name, 'label' => $p['label'], 'kind' => $p['extra']['kind'] ?? 'PSG'], $peta['INPUT'][$name] ?? []);
            $params = array_map(fn ($p) => ['cell' => $p['cell'], 'name' => $p['label'], 'group' => $name, 'type' => $p['extra']['type'] ?? 'number', 'default' => $p['extra']['default'] ?? 0, 'options' => $p['extra']['options'] ?? null, 'description' => $p['extra']['description'] ?? null], $peta['PARAM'][$name] ?? []);
            $constants = [];
            foreach ($peta['CONST'][$name] ?? [] as $c) {
                $constants[$c['cell']] = $c['label'];
            }
            $lines = [];
            $expected = [];
            $problems = &$out['problems'];
            $this->lines($ss->getSheetByName($name), $name, $lines, $expected, $problems);
            unset($problems);
            $out['docs'][$name] = ['group' => $name, 'source' => 'MASTER DISTRIVA', 'inputs' => $inputs, 'params' => $params, 'constants' => (object) $constants, 'lines' => $lines];

            $typed = [];
            foreach ($inputs as $in) {
                $v = $gambar->getCell($in['cell'])->getValue();
                $typed[$in['cell']] = is_numeric($v) ? (float) $v : 0.0;
            }
            $values = [];
            foreach ($params as $p) {
                $v = $gambar->getCell($p['cell'])->getValue();
                $values[$p['name']] = $p['type'] === 'text' ? trim((string) $v) : (is_numeric($v) ? (float) $v : 0.0);
            }
            $out['sim'][$name] = ['typed' => $typed, 'params' => $values, 'expected' => $expected];
        }
        if ($out['docs'] === []) {
            $out['problems'][] = 'Tidak ada lembar BOM (SUTM, MVTIC, ...) pada berkas.';
        }
        $out['price'] = $this->price($ss, $out['problems']);
        $out['tariff'] = $this->tariff($ss, $out['problems']);
        $out['kkf'] = $this->kkf($ss, $out['problems']);
        $out['rab_cases'] = $this->rabCases($ss, $out['problems']);
        $ss->disconnectWorksheets();

        return $out;
    }

    /**
     * @param  list<array<string,mixed>>  $lines
     * @param  array<int,array<string,mixed>>  $expected
     * @param  list<string>  $problems
     */
    private function lines(Worksheet $s, string $group, array &$lines, array &$expected, array &$problems): void
    {
        for ($r = MasterWorkbookExporter::BOM_HEAD_ROW + 1; $r <= $s->getHighestDataRow(); $r++) {
            $b = $s->getCell("B{$r}");
            $desc = $this->text($s->getCell("C{$r}"));
            $cols = ['H', 'I', 'J', 'K'];
            $any = $this->text($b) !== null || $desc !== null;
            foreach ($cols as $c) {
                $any = $any || $this->text($s->getCell("{$c}{$r}")) !== null;
            }
            if (! $any) {
                continue;
            }
            $a = $s->getCell("A{$r}")->getValue();
            if (is_numeric($a) && (int) $a !== $r) {
                $problems[] = "{$group}!A{$r}: nomor baris {$a} tidak sama dengan baris Excel {$r}; baris disisip/dihapus. Kembalikan susunan baris (nomor baris adalah nomor urut BOM).";

                continue;
            }
            $line = ['sequence' => $r, 'khs_code' => null, 'description' => $desc];
            $exp = [];
            if ($b->isFormula()) {
                $line['B'] = ltrim((string) $b->getValue(), '=');
                $exp['B'] = $this->cached($b);
            } else {
                $code = $this->text($b);
                $line['khs_code'] = $code;
            }
            foreach ($cols as $c) {
                $cell = $s->getCell("{$c}{$r}");
                if ($cell->isFormula()) {
                    $line[$c] = ltrim((string) $cell->getValue(), '=');
                    $exp[$c] = $this->cached($cell);
                } else {
                    $v = $cell->getValue();
                    if ($v === null || $v === '') {
                        continue;
                    }
                    if (is_numeric($v)) {
                        $line[$c] = (string) (floor((float) $v) == (float) $v ? (int) $v : (float) $v);
                        $exp[$c] = (float) $v;
                    } else {
                        $problems[] = "{$group}!{$c}{$r}: isi \"".mb_substr((string) $v, 0, 40).'" bukan angka maupun rumus (rumus harus diawali "=").';
                    }
                }
            }
            $lines[] = $line;
            $expected[$r] = $exp;
        }
        if ($lines === []) {
            $problems[] = "{$group}: tidak ada baris BOM.";
        }
    }

    /**
     * HARGA: material price and the install / remove price of every zone, per KHS code (the same columns the price-book CSV has).
     *
     * @param  list<string>  $problems
     * @return array{rows:list<array<string,string>>,zones:list<int>}
     */
    private function price(Spreadsheet $ss, array &$problems): array
    {
        $s = $ss->getSheetByName('HARGA');
        $h = MasterWorkbookExporter::TABLE_HEAD_ROW;
        $fixed = ['KODE KHS', 'NAMA', 'STATUS MATERIAL', 'HARGA MATERIAL', 'NILAI ASURANSI'];
        foreach ($fixed as $i => $title) {
            if (strtoupper((string) $this->text($s->getCell([$i + 1, $h]))) !== $title) {
                $problems[] = 'HARGA!'.Coordinate::stringFromColumnIndex($i + 1)."{$h}: judul kolom harus \"{$title}\" (jangan mengubah susunan kolom).";

                return ['rows' => [], 'zones' => []];
            }
        }
        $zoneCols = [];
        $zones = [];
        for ($c = 6; $c <= Coordinate::columnIndexFromString($s->getHighestDataColumn($h)); $c++) {
            $title = strtoupper((string) $this->text($s->getCell([$c, $h])));
            if (! preg_match('/^ZONA (\d+) (PASANG|BONGKAR)$/', $title, $m)) {
                $problems[] = 'HARGA!'.Coordinate::stringFromColumnIndex($c)."{$h}: judul kolom \"{$title}\" tidak dikenal (harus \"ZONA n PASANG\" atau \"ZONA n BONGKAR\").";

                return ['rows' => [], 'zones' => []];
            }
            $zoneCols[$c] = 'z'.$m[1].'_'.strtolower($m[2]);
            $zones[(int) $m[1]] = true;
        }
        $rows = [];
        $seen = [];
        $max = $s->getHighestDataRow();
        for ($r = $h + 1; $r <= $max; $r++) {
            $code = $this->text($s->getCell("A{$r}"));
            if ($code === null) {
                continue;
            }
            if (isset($seen[$code])) {
                $problems[] = "HARGA!A{$r}: kode {$code} muncul dua kali.";

                continue;
            }
            $seen[$code] = true;
            $row = ['kode' => $code, 'nama' => $this->text($s->getCell("B{$r}")) ?? '', 'status_material' => $this->text($s->getCell("C{$r}")) ?? '',
                'harga_material' => $this->number($s->getCell("D{$r}"), "HARGA!D{$r}", $problems), 'nilai_asuransi' => $this->number($s->getCell("E{$r}"), "HARGA!E{$r}", $problems)];
            foreach ($zoneCols as $c => $key) {
                $row[$key] = $this->number($s->getCell([$c, $r]), 'HARGA!'.Coordinate::stringFromColumnIndex($c).$r, $problems);
            }
            $rows[] = $row;
        }

        return ['rows' => $rows, 'zones' => array_keys($zones)];
    }

    /**
     * TARIF: average price, jam nyala and UJL per tariff, power and ULP (blank ULP = every ULP).
     *
     * @param  list<string>  $problems
     * @return array{rows:list<array<string,string>>}
     */
    private function tariff(Spreadsheet $ss, array &$problems): array
    {
        $s = $ss->getSheetByName('TARIF');
        $h = MasterWorkbookExporter::TABLE_HEAD_ROW;
        foreach (['TARIF', 'DAYA (VA)', 'HARGA RATA-RATA', 'JAM NYALA', 'UJL', 'ULP'] as $i => $title) {
            if (strtoupper((string) $this->text($s->getCell([$i + 1, $h]))) !== $title) {
                $problems[] = 'TARIF!'.Coordinate::stringFromColumnIndex($i + 1)."{$h}: judul kolom harus \"{$title}\" (jangan mengubah susunan kolom).";

                return ['rows' => []];
            }
        }
        $rows = [];
        $seen = [];
        $max = $s->getHighestDataRow();
        for ($r = $h + 1; $r <= $max; $r++) {
            $tariff = $this->text($s->getCell("A{$r}"));
            if ($tariff === null) {
                continue;
            }
            $power = $this->number($s->getCell("B{$r}"), "TARIF!B{$r}", $problems);
            $avg = $this->number($s->getCell("C{$r}"), "TARIF!C{$r}", $problems);
            $jam = $this->number($s->getCell("D{$r}"), "TARIF!D{$r}", $problems);
            $ujl = $this->number($s->getCell("E{$r}"), "TARIF!E{$r}", $problems);
            $ulp = $this->text($s->getCell("F{$r}")) ?? '';
            foreach ([['harga rata-rata', $avg, 'C'], ['jam nyala', $jam, 'D']] as [$label, $v, $col]) {
                if ($v === '') {
                    $problems[] = "TARIF!{$col}{$r}: {$label} wajib diisi.";
                }
            }
            $key = strtoupper($tariff).'|'.$power.'|'.$ulp;
            if (isset($seen[$key])) {
                $problems[] = "TARIF!A{$r}: baris {$tariff} {$power} {$ulp} muncul dua kali.";

                continue;
            }
            $seen[$key] = true;
            $rows[] = ['tarif' => $tariff, 'daya_va' => $power, 'harga_rata2' => $avg, 'jam_nyala' => $jam, 'ujl' => $ujl, 'ulp' => $ulp];
        }

        return ['rows' => $rows];
    }

    /** A number cell as text ('' when empty); anything else is a problem naming the cell. @param list<string> $problems */
    private function number(Cell $c, string $where, array &$problems, bool $allowNegative = false): string
    {
        try {
            $v = $c->isFormula() ? $c->getCalculatedValue() : $c->getValue();
        } catch (Throwable) {
            $v = null;
        }
        if ($v === null || (is_string($v) && trim($v) === '')) {
            return '';
        }
        if (! is_numeric($v) || (! $allowNegative && (float) $v < 0)) {
            $problems[] = "{$where}: isi \"".mb_substr((string) $v, 0, 30).'" harus berupa angka'.($allowNegative ? '.' : ' (tidak negatif).');

            return '';
        }

        return (string) (floor((float) $v) == (float) $v ? (int) $v : (float) $v);
    }

    /**
     * PARAMETER_KKF (the nine values of a parameter set, within the ranges the database enforces), ATURAN (fixed rules, for comparison only) and UJI_KKF (sample cases with Excel's expected results).
     *
     * @param  list<string>  $problems
     * @return array{values:array<string,float>,rules:array<string,string>,cases:list<array<string,mixed>>}
     */
    private function kkf(Spreadsheet $ss, array &$problems): array
    {
        $h = MasterWorkbookExporter::TABLE_HEAD_ROW;
        $out = ['values' => [], 'rules' => [], 'cases' => []];
        $range = ['discount_rate' => [0.0, 1.0, false], 'bpp' => [0.0, 1e9, false], 'om_rate' => [0.0, 1.0, true], 'load_factor' => [0.0, 1.0, false], 'roe' => [0.0, 1.0, true], 'interest_rate' => [0.0, 1.0, true], 'tax_rate' => [0.0, 1.0, true], 'horizon_years' => [1.0, 50.0, true], 'payback_limit_months' => [1.0, 600.0, true]];

        $s = $ss->getSheetByName('PARAMETER_KKF');
        if (strtoupper((string) $this->text($s->getCell("A{$h}"))) !== 'KUNCI' || strtoupper((string) $this->text($s->getCell("B{$h}"))) !== 'NILAI') {
            $problems[] = "PARAMETER_KKF!A{$h}: judul kolom harus \"KUNCI\" dan \"NILAI\" (jangan mengubah susunan).";
        } else {
            for ($r = $h + 1; $r <= $s->getHighestDataRow(); $r++) {
                $key = $this->text($s->getCell("A{$r}"));
                if ($key === null) {
                    continue;
                }
                if (! isset($range[$key])) {
                    $problems[] = "PARAMETER_KKF!A{$r}: kunci \"{$key}\" tidak dikenal.";

                    continue;
                }
                $raw = $this->number($s->getCell("B{$r}"), "PARAMETER_KKF!B{$r}", $problems);
                if ($raw === '') {
                    $problems[] = "PARAMETER_KKF!B{$r}: nilai {$key} wajib diisi.";

                    continue;
                }
                [$min, $max, $inclusiveMin] = $range[$key];
                $v = (float) $raw;
                $okMin = $inclusiveMin ? $v >= $min : $v > $min;
                $okMax = in_array($key, ['load_factor', 'horizon_years', 'payback_limit_months', 'bpp'], true) ? $v <= $max : $v < $max;
                if (! $okMin || ! $okMax) {
                    $problems[] = "PARAMETER_KKF!B{$r}: nilai {$key} = {$raw} di luar batas yang diizinkan.";

                    continue;
                }
                $out['values'][$key] = $v;
            }
            $missing = array_diff(array_keys($range), array_keys($out['values']));
            if ($missing !== [] && $problems === []) {
                $problems[] = 'PARAMETER_KKF: baris tidak lengkap, kurang: '.implode(', ', $missing).'.';
            }
        }

        $a = $ss->getSheetByName('ATURAN');
        for ($r = $h + 1; $r <= $a->getHighestDataRow(); $r++) {
            $key = $this->text($a->getCell("A{$r}"));
            $key !== null && $out['rules'][$key] = $this->text($a->getCell("B{$r}")) ?? '';
        }

        $u = $ss->getSheetByName('UJI_KKF');
        for ($r = $h + 1; $r <= $u->getHighestDataRow(); $r++) {
            $name = $this->text($u->getCell("A{$r}"));
            $cols = ['investment' => 'B', 'connection_fee' => 'C', 'power_kva' => 'D', 'jam_nyala' => 'E', 'avg_price' => 'F', 'esthetic_fee' => 'G', 'npv' => 'H', 'irr_percent' => 'I', 'payback_months' => 'J'];
            $any = $name !== null;
            $vals = [];
            foreach ($cols as $key => $col) {
                $vals[$key] = $this->number($u->getCell("{$col}{$r}"), "UJI_KKF!{$col}{$r}", $problems, in_array($key, ['npv', 'irr_percent'], true));
                $any = $any || $vals[$key] !== '';
            }
            $feasible = strtoupper($this->text($u->getCell("K{$r}")) ?? '');
            if (! $any && $feasible === '') {
                continue;
            }
            if ($feasible !== '' && ! in_array($feasible, ['YA', 'TIDAK'], true)) {
                $problems[] = "UJI_KKF!K{$r}: isi harus YA atau TIDAK.";
            }
            foreach (['investment', 'connection_fee', 'power_kva', 'jam_nyala', 'avg_price'] as $need) {
                if ($vals[$need] === '') {
                    $problems[] = 'UJI_KKF!'.$cols[$need]."{$r}: masukan wajib diisi.";
                }
            }
            $out['cases'][] = ['row' => $r, 'name' => $name ?? "baris {$r}", 'inputs' => $vals, 'feasible' => $feasible];
        }

        return $out;
    }

    /**
     * UJI_RAB: group subtotal with the PPN and rounded total the parent unit's Excel gives.
     *
     * @param  list<string>  $problems
     * @return list<array<string,mixed>>
     */
    private function rabCases(Spreadsheet $ss, array &$problems): array
    {
        $h = MasterWorkbookExporter::TABLE_HEAD_ROW;
        $u = $ss->getSheetByName('UJI_RAB');
        $cases = [];
        for ($r = $h + 1; $r <= $u->getHighestDataRow(); $r++) {
            $name = $this->text($u->getCell("A{$r}"));
            $subtotal = $this->number($u->getCell("B{$r}"), "UJI_RAB!B{$r}", $problems);
            $ppn = $this->number($u->getCell("C{$r}"), "UJI_RAB!C{$r}", $problems);
            $total = $this->number($u->getCell("D{$r}"), "UJI_RAB!D{$r}", $problems);
            if ($name === null && $subtotal === '' && $ppn === '' && $total === '') {
                continue;
            }
            if ($subtotal === '') {
                $problems[] = "UJI_RAB!B{$r}: subtotal wajib diisi.";
            }
            $cases[] = ['row' => $r, 'name' => $name ?? "baris {$r}", 'subtotal' => $subtotal, 'ppn' => $ppn, 'total' => $total];
        }

        return $cases;
    }

    private function cached(Cell $c): mixed
    {
        try {
            $v = $c->getOldCalculatedValue();
        } catch (Throwable) {
            return null;
        }

        return $v;
    }

    private function text(Cell $c): ?string
    {
        $v = $c->getValue();
        if ($v === null) {
            return null;
        }
        if (is_float($v) && floor($v) == $v) {
            $v = (int) $v;
        }
        $t = trim((string) $v);

        return $t === '' ? null : $t;
    }

    private function date(Cell $c): ?string
    {
        $v = $c->getValue();
        if (is_numeric($v) && (float) $v > 20000) {
            return XlDate::excelToDateTimeObject((float) $v)->format('Y-m-d');
        }
        $t = $this->text($c);

        return $t !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $t) && strtotime($t) !== false ? $t : null;
    }
}
