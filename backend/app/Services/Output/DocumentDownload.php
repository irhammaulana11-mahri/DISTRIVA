<?php

namespace App\Services\Output;

use Symfony\Component\HttpFoundation\Response;

/** The downloadable forms of a document structure: .xlsx or .pdf (`?format=`). */
final class DocumentDownload
{
    public const FORMATS = ['xlsx', 'pdf'];

    public function __construct(private readonly XlsxRenderer $xlsx, private readonly PdfRenderer $pdf) {}

    /** @param array<string,mixed> $doc */
    public function response(array $doc, string $format, string $name): Response
    {
        $pdf = $format === 'pdf';

        return response($pdf ? $this->pdf->render($doc) : $this->xlsx->render($doc), 200, [
            'Content-Type' => $pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$name.($pdf ? '.pdf' : '.xlsx').'"',
        ]);
    }
}
