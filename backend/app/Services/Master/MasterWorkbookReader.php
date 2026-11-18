<?php

namespace App\Services\Master;

use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as XlDate;
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
     *   problems: list<string>
     * }
     */
    public function read(string $path): array
    {
        $out = ['meta' => ['template_version' => null, 'valid_from' => null, 'basis' => null], 'docs' => [], 'sim' => [], 'problems' => []];
        try {
            $reader = IOFactory::createReader('Xlsx');
            $reader->setReadDataOnly(false);
            $ss = $reader->load($path);
        } catch (Throwable) {
            $out['problems'][] = 'Berkas tidak dapat dibaca sebagai Excel (.xlsx).';

            return $out;
        }
        $names = $ss->getSheetNames();
        foreach (['INFO', 'GAMBAR', '_PETA'] as $need) {
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
