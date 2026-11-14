<?php

namespace Tests\Feature;

use App\Exceptions\AdministrationDenied;
use App\Services\Output\PdfRenderer;
use PHPUnit\Framework\Attributes\Test;
use Symfony\Component\Process\ExecutableFinder;
use Tests\TestCase;

class PdfRendererTest extends TestCase
{
    /** @return array<string,mixed> */
    private function document(int $columns = 3): array
    {
        $cols = array_map(fn ($i) => "KOL {$i}", range(1, $columns));

        return ['title' => 'RAB <b>UJI</b>', 'header' => ['PT. PLN (PERSERO)'], 'meta' => [['Permohonan', 'A&B']],
            'sections' => [['heading' => 'Rincian', 'columns' => $cols, 'rows' => [array_merge(['Uraian "x"', 1234567.5], array_fill(0, $columns - 2, 12))], 'footer' => array_merge(['JUMLAH', 99], array_fill(0, $columns - 2, 0))]],
            'terbilang' => 'seratus rupiah', 'place_date' => 'Jombang, 1 Desember 2026', 'signatures' => [['title' => 'Manager', 'name' => 'Budi']]];
    }

    #[Test]
    public function the_page_escapes_every_value_formats_numbers_the_indonesian_way_and_goes_landscape_when_wide(): void
    {
        $html = (new PdfRenderer)->html($this->document());

        $this->assertStringContainsString('RAB &lt;b&gt;UJI&lt;/b&gt;', $html);
        $this->assertStringContainsString('A&amp;B', $html);
        $this->assertStringNotContainsString('<b>UJI</b>', $html);
        $this->assertStringContainsString('1.234.567,50', $html);
        $this->assertStringContainsString('Seratus rupiah', $html);
        $this->assertStringContainsString('size:A4;', $html);
        $this->assertStringContainsString('size:A4 landscape;', (new PdfRenderer)->html($this->document(9)));
    }

    #[Test]
    public function a_real_pdf_is_printed_when_chrome_is_available_and_a_clear_error_otherwise(): void
    {
        config(['distriva.pdf.binary' => null]);
        $finder = new ExecutableFinder;
        $available = array_filter(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'], fn ($b) => $finder->find($b) !== null) !== [];
        if (! $available) {
            $this->expectException(AdministrationDenied::class);
            (new PdfRenderer)->render($this->document());

            return;
        }
        $pdf = (new PdfRenderer)->render($this->document());
        $this->assertStringStartsWith('%PDF', $pdf);
        $this->assertGreaterThan(1000, strlen($pdf));
    }
}
