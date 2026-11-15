<?php

namespace App\Services\Output;

use App\Exceptions\AdministrationDenied;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Symfony\Component\Process\ExecutableFinder;

/**
 * Renders the same document structure as `XlsxRenderer` (title, header, meta, sections, place+date, signatures) as a PDF: an escaped HTML page printed by headless Chrome/Chromium.
 * Values are only what the document holds; nothing is computed here. Wide tables (more than 7 columns) print in landscape.
 */
final class PdfRenderer
{
    private const BINARIES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

    /** @param array<string,mixed> $doc */
    public function render(array $doc): string
    {
        $binary = $this->binary();
        $dir = sys_get_temp_dir().'/distriva-pdf-'.Str::uuid();
        File::makeDirectory($dir, 0700, true);
        try {
            File::put("{$dir}/doc.html", $this->html($doc));
            $result = Process::timeout((int) config('distriva.pdf.timeout_seconds'))->run([
                $binary, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-pdf-header-footer',
                "--user-data-dir={$dir}/profile", "--print-to-pdf={$dir}/doc.pdf", "file://{$dir}/doc.html",
            ]);
            if (! File::exists("{$dir}/doc.pdf") || ! str_starts_with((string) File::get("{$dir}/doc.pdf"), '%PDF')) {
                throw new AdministrationDenied('PDF belum dapat dibuat di server ini. Gunakan format XLSX atau hubungi administrator.', 503);
            }

            return (string) File::get("{$dir}/doc.pdf");
        } finally {
            File::deleteDirectory($dir);
        }
    }

    /** @param array<string,mixed> $doc */
    public function html(array $doc): string
    {
        $wide = false;
        $body = '';
        foreach ((array) ($doc['header'] ?? []) as $line) {
            $body .= '<div class="company">'.$this->e($line).'</div>';
        }
        $body .= '<h1>'.$this->e($doc['title'] ?? 'Dokumen').'</h1>';
        if (! empty($doc['meta'])) {
            $body .= '<table class="meta">';
            foreach ((array) $doc['meta'] as [$label, $value]) {
                $body .= '<tr><td>'.$this->e($label).'</td><td>: '.$this->e($value).'</td></tr>';
            }
            $body .= '</table>';
        }
        foreach ((array) ($doc['sections'] ?? []) as $s) {
            if (isset($s['heading'])) {
                $body .= '<h2>'.$this->e($s['heading']).'</h2>';
            }
            if (! empty($s['pairs'])) {
                $body .= '<table class="meta">';
                foreach ((array) $s['pairs'] as [$label, $value]) {
                    $body .= '<tr><td>'.$this->e($label).'</td><td>'.$this->cell($value).'</td></tr>';
                }
                $body .= '</table>';
            }
            if (isset($s['columns'])) {
                $wide = $wide || count($s['columns']) > 7;
                $body .= '<table class="grid"><thead><tr>';
                foreach ($s['columns'] as $c) {
                    $body .= '<th>'.$this->e($c).'</th>';
                }
                $body .= '</tr></thead><tbody>';
                foreach ((array) ($s['rows'] ?? []) as $row) {
                    $body .= '<tr>'.$this->cells((array) $row).'</tr>';
                }
                if (isset($s['footer'])) {
                    $body .= '<tr class="foot">'.$this->cells((array) $s['footer']).'</tr>';
                }
                $body .= '</tbody></table>';
            }
        }
        if (isset($doc['terbilang'])) {
            $body .= '<p class="terbilang"><b>TERBILANG JUMLAH TOTAL:</b> '.$this->e(ucfirst((string) $doc['terbilang'])).'</p>';
        }
        $signatures = (array) ($doc['signatures'] ?? []);
        if ($signatures !== []) {
            $body .= '<div class="sign"><div class="place">'.$this->e($doc['place_date'] ?? '').'</div><div class="parties">';
            foreach ($signatures as $sig) {
                $body .= '<div class="party"><div>'.$this->e($sig['title'] ?? '').'</div><div class="space"></div><div><b>'.$this->e($sig['name'] ?? '').'</b></div></div>';
            }
            $body .= '</div></div>';
        }

        $page = $wide ? 'A4 landscape' : 'A4';

        return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>'.$this->e($doc['title'] ?? 'Dokumen').'</title><style>'
            ."@page{size:{$page};margin:14mm 12mm}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111}"
            .'.company{font-weight:bold}h1{font-size:13pt;margin:10pt 0 8pt}h2{font-size:11pt;margin:12pt 0 4pt}'
            .'table{border-collapse:collapse;width:100%;margin:4pt 0}.meta td{padding:1pt 6pt 1pt 0;vertical-align:top}.meta td:first-child{width:28%}'
            .'.grid th,.grid td{border:1px solid #444;padding:2pt 4pt;font-size:9pt;vertical-align:top}.grid th{background:#d9e1f2;text-align:center}'
            .'.grid td.n{text-align:right;white-space:nowrap}.grid tr{page-break-inside:avoid}.grid thead{display:table-header-group}.foot td{font-weight:bold}'
            .'.terbilang{margin-top:8pt}.sign{margin-top:18pt;page-break-inside:avoid}.place{text-align:right}.parties{display:flex;justify-content:space-between;margin-top:6pt}'
            .'.party{text-align:center;min-width:30%}.space{height:48pt}'
            .'</style></head><body>'.$body.'</body></html>';
    }

    /** @param list<mixed> $row */
    private function cells(array $row): string
    {
        return implode('', array_map(fn ($v) => $this->cell($v), $row));
    }

    private function cell(mixed $v): string
    {
        return is_int($v) || is_float($v) ? '<td class="n">'.$this->number($v).'</td>' : '<td>'.$this->e($v).'</td>';
    }

    private function number(int|float $v): string
    {
        return number_format($v, is_float($v) && floor($v) != $v ? 2 : 0, ',', '.');
    }

    private function e(mixed $v): string
    {
        return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /** Path of the Chrome/Chromium that prints the PDFs, or null when none is installed. */
    public function binaryOrNull(): ?string
    {
        try {
            return $this->binary();
        } catch (AdministrationDenied) {
            return null;
        }
    }

    private function binary(): string
    {
        $configured = config('distriva.pdf.binary');
        if (is_string($configured) && $configured !== '' && is_executable($configured)) {
            return $configured;
        }
        $finder = new ExecutableFinder;
        foreach (self::BINARIES as $name) {
            $found = $finder->find($name);
            if ($found !== null) {
                return $found;
            }
        }
        throw new AdministrationDenied('PDF belum dapat dibuat di server ini (Chrome/Chromium belum terpasang). Gunakan format XLSX atau hubungi administrator.', 503);
    }
}
