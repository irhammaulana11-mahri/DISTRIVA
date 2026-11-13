<?php

namespace App\Services\Mto;

use Symfony\Component\Process\Process;

/**
 * Reads the GAMBAR sheet when it was exported to PDF from Excel (stage 4C). Such a PDF has real text, so no OCR is involved: `pdftotext -bbox`
 * gives every word with its position, and the same fixed template is rebuilt from the column headers (Uraian / Psg / Bkr) and the section titles
 * ("Konstruksi SUTM (ms)", ...). Page size and zoom do not matter: everything is relative to the header words of the page itself.
 * A scanned or photographed drawing has no text layer and is refused (a person enters the quantities).
 */
class PdfGambarReader
{
    private const SECTIONS = ['sutm' => 'SUTM', 'mvtic' => 'MVTIC', 'sutr' => 'SUTR', 'sktm' => 'SKTM', 'gardu kubikel' => 'KUBIKEL', 'gtt umum' => 'GTT_UMUM', 'gtt khusus' => 'GTT_KHUSUS', 'estetika' => null];

    private const MAX_BYTES = 15 * 1024 * 1024;

    /**
     * @return array{items:list<array<string,mixed>>, pbpd:list<array<string,mixed>>, warnings:list<array<string,mixed>>}
     */
    public function read(string $path): array
    {
        if (! is_file($path) || filesize($path) > self::MAX_BYTES) {
            throw new \InvalidArgumentException('Berkas PDF tidak dapat dibaca atau terlalu besar.');
        }
        $pages = $this->words($path);
        foreach ($pages as $words) {
            $columns = $this->columns($words);
            if ($columns !== []) {
                return $this->table($words, $columns);
            }
        }
        throw new \InvalidArgumentException('PDF tidak memuat tabel GAMBAR yang dapat dibaca (kolom Uraian/Psg/Bkr tidak ditemukan). PDF hasil pindai atau foto tidak dapat dibaca otomatis; isi jumlah secara manual.');
    }

    /** @return list<list<array{x0:float,y0:float,x1:float,y1:float,t:string}>> */
    private function words(string $path): array
    {
        $p = new Process([(string) config('distriva.pdftotext', 'pdftotext'), '-bbox', '-enc', 'UTF-8', '-q', $path, '-'], null, null, null, 60);
        try {
            $p->run();
        } catch (\Throwable) {
            throw new \InvalidArgumentException('Pembaca PDF (pdftotext) tidak tersedia di server.');
        }
        if (! $p->isSuccessful()) {
            throw new \InvalidArgumentException('PDF tidak dapat dibaca (rusak atau terkunci).');
        }
        $pages = [];
        foreach (preg_split('/<page /', $p->getOutput()) ?: [] as $i => $chunk) {
            if ($i === 0) {
                continue;
            }
            preg_match_all('/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/su', $chunk, $m, PREG_SET_ORDER);
            $pages[] = array_map(fn ($w) => ['x0' => (float) $w[1], 'y0' => (float) $w[2], 'x1' => (float) $w[3], 'y1' => (float) $w[4], 't' => html_entity_decode($w[5], ENT_QUOTES | ENT_HTML5, 'UTF-8')], $m);
        }

        return $pages;
    }

    /** Header triples "Uraian Psg Bkr" of the page, left to right. @return list<array{label_x:float,psg0:float,psg1:float,bkr0:float,bkr1:float,y:float,h:float}> */
    private function columns(array $words): array
    {
        $cols = [];
        foreach ($words as $psg) {
            if ($psg['t'] !== 'Psg') {
                continue;
            }
            $h = $psg['y1'] - $psg['y0'];
            $bkr = $this->nearest($words, 'Bkr', $psg, $h, 'right');
            $uraian = $this->nearest($words, 'Uraian', $psg, $h, 'left');
            if ($bkr !== null && $uraian !== null) {
                $cols[] = ['label_x' => 0.0, 'psg0' => $psg['x0'], 'psg1' => $psg['x1'], 'bkr0' => $bkr['x0'], 'bkr1' => $bkr['x1'], 'y' => $psg['y0'], 'h' => $h];
            }
        }
        usort($cols, fn ($a, $b) => $a['psg0'] <=> $b['psg0']);
        foreach ($cols as $i => &$c) {
            // labels start after the previous column's Bkr numbers; the first column starts after the "Ket." (symbol) column
            if ($i > 0) {
                $c['label_x'] = $cols[$i - 1]['bkr1'] + $c['h'] * 0.6;
            } else {
                $ket = null;
                foreach ($words as $w) {
                    if ($w['t'] === 'Ket.' && abs($w['y0'] - $c['y']) < $c['h'] * 3 && $w['x1'] < $c['psg0'] && ($ket === null || $w['x1'] > $ket)) {
                        $ket = $w['x1'];
                    }
                }
                $c['label_x'] = $ket !== null ? $ket + $c['h'] * 0.2 : $c['psg0'] - $c['h'] * 14;
            }
        }
        unset($c);

        return $cols;
    }

    private function nearest(array $words, string $text, array $from, float $h, string $side): ?array
    {
        $best = null;
        foreach ($words as $w) {
            if ($w['t'] !== $text || abs($w['y0'] - $from['y0']) > $h * 0.6) {
                continue;
            }
            $d = $side === 'right' ? $w['x0'] - $from['x1'] : $from['x0'] - $w['x1'];
            if ($d > 0 && $d < $h * 30 && ($best === null || $d < $best[0])) {
                $best = [$d, $w];
            }
        }

        return $best[1] ?? null;
    }

    /** @return array{items:list<array<string,mixed>>, pbpd:list<array<string,mixed>>, warnings:list<array<string,mixed>>} */
    private function table(array $words, array $columns): array
    {
        $items = [];
        $pbpd = [];
        $warnings = [];
        $headerY = $columns[0]['y'];
        $h = $columns[0]['h'];
        $tol = $h * 0.55;

        foreach ($columns as $i => $col) {
            $psgMax = ($col['psg1'] + $col['bkr0']) / 2;                       // boundary between the Psg and Bkr numbers
            $bkrMax = $col['bkr1'] + $h * 0.5;
            $rows = [];
            foreach ($words as $w) {
                $cx = ($w['x0'] + $w['x1']) / 2;
                if ($w['y0'] <= $headerY + $h * 0.5 || $cx < $col['label_x'] || $cx > $bkrMax) {
                    continue;
                }
                $rows[(int) round($w['y0'] / $tol)][] = $w;                     // same printed row = same y bucket
            }
            ksort($rows);
            $section = 'NONE';
            foreach ($this->mergeAdjacent($rows) as $row) {
                usort($row, fn ($a, $b) => $a['x0'] <=> $b['x0']);
                $label = [];
                $psg = $bkr = null;
                foreach ($row as $w) {
                    $cx = ($w['x0'] + $w['x1']) / 2;
                    if ($cx >= $col['psg0'] - 2.0 && $this->isNumber($w['t']) && $w['x0'] >= $col['psg0'] - 3.0) {
                        if ($cx <= $psgMax) {
                            $psg = (float) str_replace(',', '.', $w['t']);
                        } else {
                            $bkr = (float) str_replace(',', '.', $w['t']);
                        }
                    } elseif ($cx < $col['psg0'] - 1.0) {
                        $label[] = $w['t'];
                    }
                }
                $text = trim(implode(' ', $label));
                if ($text === '') {
                    if (($psg ?? 0) != 0 || ($bkr ?? 0) != 0) {
                        $warnings[] = ['cell' => 'kolom '.($i + 1), 'code' => 'NO_LABEL', 'message' => 'Ada angka tanpa uraian konstruksi pada kolom '.($i + 1).'; diabaikan.'];
                    }

                    continue;
                }
                if (preg_match('/^no\.?\s*gambar/iu', $text)) {
                    break;                                                       // the title block below the table
                }
                if (preg_match('/^konstruksi\s+(.+)$/iu', $text, $m)) {
                    $key = trim(preg_replace('/\s*\(ms\)\s*/iu', ' ', mb_strtolower($m[1])));
                    $section = array_key_exists($key, self::SECTIONS) ? (self::SECTIONS[$key] ?? 'NONE') : 'NONE';
                    if (($psg ?? 0) != 0 || ($bkr ?? 0) != 0) {
                        $warnings[] = ['cell' => $text, 'code' => 'OUTSIDE_BLOCK', 'message' => "Angka pada baris judul '{$text}' tidak dipakai."];
                    }

                    continue;
                }
                if (mb_strtolower($text) === 'pbpd') {
                    $section = 'PBPD';

                    continue;
                }
                if (($psg ?? 0) == 0 && ($bkr ?? 0) == 0) {
                    continue;
                }
                if ($section === 'PBPD') {
                    if (! preg_match('/k?va\s*$/iu', $text)) {
                        continue;                                                // not a power range (e.g. the printed date under the block)
                    }
                    $pbpd[] = ['label' => $text, 'psg' => $psg ?? 0.0, 'bkr' => $bkr ?? 0.0];
                } elseif ($section !== 'NONE') {
                    $items[] = ['group' => $section, 'label' => $text, 'psg' => $psg ?? 0.0, 'bkr' => $bkr ?? 0.0, 'cell_psg' => null, 'cell_bkr' => null];
                }
            }
        }

        return ['items' => $items, 'pbpd' => $pbpd, 'warnings' => $warnings];
    }

    /** y buckets that are only one step apart belong to the same printed row. @return list<list<array>> */
    private function mergeAdjacent(array $rows): array
    {
        $out = [];
        $last = null;
        foreach ($rows as $key => $row) {
            if ($last !== null && $key - $last <= 0) {
                $out[array_key_last($out)] = array_merge($out[array_key_last($out)], $row);
            } else {
                $out[] = $row;
            }
            $last = $key;
        }

        return $out;
    }

    private function isNumber(string $t): bool
    {
        return (bool) preg_match('/^\d+([.,]\d+)?$/', $t);
    }
}
