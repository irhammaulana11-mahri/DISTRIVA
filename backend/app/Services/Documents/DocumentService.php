<?php

namespace App\Services\Documents;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Worksheet\MemoryDrawing;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

/**
 * Documents module (core): a logical document per application and category with immutable file versions on a PRIVATE disk.
 * Files are validated by CONTENT (finfo), not by the client's name or MIME header; the stored key is opaque; downloads go through an
 * authorised endpoint with `nosniff` and are logged. Callers authorize the actor first (ApplicationAuthorizer).
 */
class DocumentService
{
    /** extension => MIME stored with the version (the upload is accepted only when the CONTENT matches the extension). */
    private const MIME = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'pdf' => 'application/pdf',
        'xls' => 'application/vnd.ms-excel', 'doc' => 'application/msword',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'dwg' => 'image/vnd.dwg', 'dxf' => 'image/vnd.dxf',
    ];

    private const MAX_PER_SURVEY_VERSION = 30;

    public function disk(): string
    {
        $disk = (string) config('distriva.documents_disk', 'documents');
        $root = (string) config("filesystems.disks.{$disk}.root");
        // The documents root must never be reachable from the web: refuse to run if it points into a public folder.
        foreach ([public_path(), storage_path('app/public')] as $public) {
            if ($root !== '' && str_starts_with(rtrim($root, '/').'/', rtrim($public, '/').'/')) {
                throw new \RuntimeException('DISTRIVA_DOCUMENTS_ROOT berada di folder publik; penyimpanan dokumen harus privat.');
            }
        }

        return $disk;
    }

    /**
     * Creates a document with its first version. Returns the document id.
     *
     * @param  array{drawing_version_id?:?string, file_role?:?string}  $link  optional drawing-package link
     */
    public function upload(string $applicationId, string $categoryCode, UploadedFile $file, ?string $title, ?string $surveyVersionId, User $actor, array $link = []): string
    {
        $category = DB::table('document_categories')->where('code', $categoryCode)->where('is_active', true)->first() ?? throw new AssignmentRuleViolation('Kategori dokumen tidak dikenal.');
        [$ext, $mime] = $this->inspect($file, $category);
        if ($surveyVersionId !== null && DB::table('application_documents')->where('survey_version_id', $surveyVersionId)->where('status', 'ACTIVE')->count() >= self::MAX_PER_SURVEY_VERSION) {
            throw new AssignmentRuleViolation('Jumlah dokumen pada versi survey ini sudah mencapai batas '.self::MAX_PER_SURVEY_VERSION.'.');
        }
        if (($link['drawing_version_id'] ?? null) !== null && DB::table('application_documents')->where('drawing_version_id', $link['drawing_version_id'])->where('status', 'ACTIVE')->count() >= self::MAX_PER_SURVEY_VERSION) {
            throw new AssignmentRuleViolation('Jumlah berkas pada versi gambar ini sudah mencapai batas '.self::MAX_PER_SURVEY_VERSION.'.');
        }

        $key = $this->store($file);
        try {
            return DB::transaction(function () use ($applicationId, $category, $file, $title, $surveyVersionId, $actor, $ext, $mime, $key, $link): string {
                $docId = (string) Str::uuid();
                $verId = (string) Str::uuid();
                DB::table('application_documents')->insert(['id' => $docId, 'application_id' => $applicationId, 'category_id' => $category->id, 'document_code' => $this->code(),
                    'title' => $link['display_title'] ?? $this->title($title, $file), 'current_version_id' => $verId, 'status' => 'ACTIVE', 'survey_version_id' => $surveyVersionId, 'drawing_version_id' => $link['drawing_version_id'] ?? null, 'file_role' => $link['file_role'] ?? null,
                    'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                $this->insertVersion($docId, $verId, 1, null, $file, $key, $ext, $mime, null, $actor, isset($link['display_title']) ? $link['display_title'].'.'.$ext : null);
                $this->log($verId, $actor, 'UPLOAD');

                return $docId;
            });
        } catch (\Throwable $e) {
            Storage::disk($this->disk())->delete($key);

            throw $e;
        }
    }

    /** A revision never overwrites: it adds version n+1 and supersedes the previous one. */
    public function addVersion(string $documentId, UploadedFile $file, string $reason, User $actor): int
    {
        $doc = DB::table('application_documents')->where('id', $documentId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($doc->status !== 'ACTIVE') {
            throw new AssignmentRuleViolation('Dokumen sudah dihapus dari tampilan.');
        }
        $category = DB::table('document_categories')->where('id', $doc->category_id)->first();
        [$ext, $mime] = $this->inspect($file, $category);
        $key = $this->store($file);
        try {
            return DB::transaction(function () use ($doc, $file, $reason, $actor, $ext, $mime, $key): int {
                $n = ((int) DB::table('application_document_versions')->where('document_id', $doc->id)->max('version_number')) + 1;
                $verId = (string) Str::uuid();
                $this->insertVersion($doc->id, $verId, $n, $doc->current_version_id, $file, $key, $ext, $mime, $reason, $actor, $doc->drawing_version_id !== null ? $doc->title.'.'.$ext : null);
                DB::table('application_document_versions')->where('id', $doc->current_version_id)->update(['lifecycle_status' => 'SUPERSEDED']);
                DB::table('application_documents')->where('id', $doc->id)->update(['current_version_id' => $verId, 'updated_at' => now()]);
                $this->log($verId, $actor, 'UPLOAD');

                return $n;
            });
        } catch (\Throwable $e) {
            Storage::disk($this->disk())->delete($key);

            throw $e;
        }
    }

    /** Hides the document (the files and their history stay). */
    public function remove(string $documentId, User $actor): void
    {
        DB::transaction(function () use ($documentId, $actor): void {
            $doc = DB::table('application_documents')->where('id', $documentId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($doc->status === 'REMOVED') {
                throw new AssignmentRuleViolation('Dokumen sudah dihapus dari tampilan.');
            }
            DB::table('application_documents')->where('id', $documentId)->update(['status' => 'REMOVED', 'updated_at' => now()]);
            $this->log($doc->current_version_id, $actor, 'REMOVE');
        });
    }

    /**
     * A stored version is served or read only when it may be (not quarantined / rejected), exists, and still has the SHA-256 recorded at upload: the database row is immutable, so a file
     * changed on the disk afterwards is detected here instead of being handed out or read into the MTO.
     */
    public function assertReadable(object $version, Filesystem $disk): void
    {
        if (in_array($version->lifecycle_status ?? 'UPLOADED', ['QUARANTINED', 'REJECTED'], true) || ! $disk->exists($version->stored_key)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $stream = $disk->readStream($version->stored_key);
        if (! is_resource($stream)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $ctx = hash_init('sha256');
        hash_update_stream($ctx, $stream);
        fclose($stream);
        if (! hash_equals((string) $version->sha256, hash_final($ctx))) {
            Log::critical('Document version failed its SHA-256 check.', ['version_id' => $version->id ?? null, 'stored_key' => $version->stored_key]);

            throw new AdministrationDenied('Integritas berkas tidak dapat diverifikasi (isi berbeda dari saat diunggah); hubungi administrator.', 409);
        }
    }

    public function download(object $doc, ?int $version, bool $inline, User $actor, ?string $ip): StreamedResponse
    {
        $v = DB::table('application_document_versions')->where('document_id', $doc->id)
            ->when($version !== null, fn ($q) => $q->where('version_number', $version), fn ($q) => $q->where('id', $doc->current_version_id))->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($doc->status !== 'ACTIVE') {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $disk = Storage::disk($this->disk());
        $this->assertReadable($v, $disk);
        $this->log($v->id, $actor, $inline ? 'VIEW' : 'DOWNLOAD', $ip);
        $name = preg_replace('/[^A-Za-z0-9._ -]/', '_', $v->original_name) ?: 'dokumen';

        return $disk->response($v->stored_key, $name, [
            'Content-Type' => $v->mime_type, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], $inline && str_starts_with($v->mime_type, 'image/') ? 'inline' : 'attachment');
    }

    /**
     * Read-only table preview of a spreadsheet (xlsx/xls/csv) so reviewers need not download it. Bounded: 6 sheets, 200 rows, 30 columns.
     *
     * @return array{render_available:bool,sheets:list<array{name:string,images:list<array{src:string,name:string,cell:string}>,rows:list<list<string>>,total_rows:int,total_cols:int,truncated:bool}>}
     */
    public function previewSheets(object $doc, User $actor, ?string $ip): array
    {
        $v = DB::table('application_document_versions')->where('id', $doc->current_version_id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $ext = strtolower((string) pathinfo($v->original_name, PATHINFO_EXTENSION));
        if ($doc->status !== 'ACTIVE' || ! in_array($ext, ['xlsx', 'xls', 'csv'], true)) {
            throw new AssignmentRuleViolation('Pratinjau tabel hanya untuk berkas Excel/CSV.');
        }
        $disk = Storage::disk($this->disk());
        $this->assertReadable($v, $disk);
        $this->log($v->id, $actor, 'VIEW', $ip);
        $tmp = tempnam(sys_get_temp_dir(), 'prv');
        try {
            file_put_contents($tmp, $disk->get($v->stored_key));
            $reader = IOFactory::createReader(ucfirst($ext));
            $reader->setReadEmptyCells(false);
            $book = $reader->load($tmp);
            $sheets = [];
            foreach ($book->getAllSheets() as $i => $ws) {
                if ($i >= 6) {
                    break;
                }
                $totalRows = $ws->getHighestDataRow();
                $totalCols = Coordinate::columnIndexFromString($ws->getHighestDataColumn());
                $maxRow = min($totalRows, 200);
                $maxCol = min($totalCols, 30);
                $rows = [];
                for ($r = 1; $r <= $maxRow; $r++) {
                    $row = [];
                    for ($c = 1; $c <= $maxCol; $c++) {
                        try {
                            $row[] = (string) $ws->getCell([$c, $r])->getFormattedValue();
                        } catch (\Throwable) {
                            $row[] = '#ERR';
                        }
                    }
                    $rows[] = $row;
                }
                $sheets[] = ['name' => $ws->getTitle(), 'images' => $this->sheetImages($ws), 'rows' => $rows, 'total_rows' => $totalRows, 'total_cols' => $totalCols, 'truncated' => $totalRows > $maxRow || $totalCols > $maxCol];
            }
            $book->disconnectWorksheets();
        } catch (AssignmentRuleViolation|AdministrationDenied $e) {
            throw $e;
        } catch (\Throwable) {
            throw new AssignmentRuleViolation('Berkas tidak dapat dipratinjau; silakan unduh.');
        } finally {
            @unlink($tmp);
        }

        return ['sheets' => $sheets, 'render_available' => $ext !== 'csv' && $this->sofficeBinary() !== null];
    }

    /** Path of the LibreOffice binary, or null when none is installed (the preview then shows the table only). */
    public function sofficeBinary(): ?string
    {
        $cfg = (string) config('distriva.soffice_binary', '');
        if ($cfg !== '') {
            return is_executable($cfg) ? $cfg : null;
        }
        $finder = new ExecutableFinder;

        return $finder->find('soffice') ?? $finder->find('libreoffice');
    }

    /**
     * PDF rendering of a spreadsheet exactly as Excel draws it (shapes, symbols, layout), cached per document version.
     * Returns the cached PDF key on the documents disk.
     */
    public function previewPdfKey(object $doc, User $actor, ?string $ip): string
    {
        $v = DB::table('application_document_versions')->where('id', $doc->current_version_id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $ext = strtolower((string) pathinfo($v->original_name, PATHINFO_EXTENSION));
        if ($doc->status !== 'ACTIVE' || ! in_array($ext, ['xlsx', 'xls'], true)) {
            throw new AssignmentRuleViolation('Tampilan gambar hanya untuk berkas Excel.');
        }
        $bin = $this->sofficeBinary() ?? throw new AssignmentRuleViolation('Mesin render (LibreOffice) belum tersedia di server.');
        $disk = Storage::disk($this->disk());
        $this->assertReadable($v, $disk);
        $this->log($v->id, $actor, 'VIEW', $ip);
        $cacheKey = 'preview-cache/'.$v->id.'.pdf';
        if ($disk->exists($cacheKey)) {
            return $cacheKey;
        }
        $work = sys_get_temp_dir().'/prv-'.Str::random(12);
        mkdir($work, 0700, true);
        try {
            $src = $work.'/in.'.$ext;
            file_put_contents($src, $disk->get($v->stored_key));
            if ($ext === 'xlsx') {
                $this->fitSheetsForRender($src);
            }
            $proc = new Process(
                [$bin, '--headless', '--norestore', '--nolockcheck', '-env:UserInstallation=file://'.$work.'/profile', '--convert-to', 'pdf', '--outdir', $work.'/out', $src],
                $work, ['HOME' => $work, 'LC_ALL' => 'C.UTF-8'], null, (float) config('distriva.preview_timeout', 60),
            );
            $proc->run();
            $pdf = $work.'/out/in.pdf';
            if (! $proc->isSuccessful() || ! is_file($pdf) || filesize($pdf) === 0) {
                throw new AssignmentRuleViolation('Berkas tidak dapat dirender; gunakan tampilan tabel atau unduh.');
            }
            $disk->put($cacheKey, (string) file_get_contents($pdf));
        } catch (ProcessTimedOutException) {
            throw new AssignmentRuleViolation('Render berkas terlalu lama; gunakan tampilan tabel atau unduh.');
        } finally {
            $this->rmrf($work);
        }

        return $cacheKey;
    }

    /**
     * Without a print area LibreOffice prints the whole used range (a drawing sheet became 103 pages). Rewrite the sheet XML of a TEMP COPY:
     * print area = cells with data plus every shape anchor, landscape A3, fit to one page per sheet. The stored original is never touched.
     */
    private function fitSheetsForRender(string $path): void
    {
        $zip = new \ZipArchive;
        if ($zip->open($path) !== true) {
            return;
        }
        try {
            $wb = (string) $zip->getFromName('xl/workbook.xml');
            $rels = (string) $zip->getFromName('xl/_rels/workbook.xml.rels');
            if ($wb === '' || $rels === '') {
                return;
            }
            $target = [];
            if (preg_match_all('/<Relationship\b[^>]*>/', $rels, $m)) {
                foreach ($m[0] as $tag) {
                    if (preg_match('/\bId="([^"]+)"/', $tag, $a) && preg_match('/\bTarget="([^"]+)"/', $tag, $b)) {
                        $target[$a[1]] = ltrim(preg_replace('#^/?(xl/)?#', '', $b[1]), '/');
                    }
                }
            }
            $names = '';
            $idx = 0;
            preg_match_all('/<sheet\b[^>]*>/', $wb, $sheetTags);
            foreach ($sheetTags[0] as $tag) {
                if (! preg_match('/\bname="([^"]+)"/', $tag, $n) || ! preg_match('/\br:id="([^"]+)"/', $tag, $r) || ! isset($target[$r[1]])) {
                    $idx++;

                    continue;
                }
                $file = 'xl/'.$target[$r[1]];
                $xml = (string) $zip->getFromName($file);
                if ($xml === '') {
                    $idx++;

                    continue;
                }
                [$maxCol, $maxRow] = $this->usedExtent($zip, $file, $xml);
                if ($maxCol > 0 && $maxRow > 0) {
                    $zip->addFromString($file, $this->withFitToPage($xml));
                    $names .= '<definedName name="_xlnm.Print_Area" localSheetId="'.$idx.'">\''.str_replace("'", "''", html_entity_decode($n[1])).'\'!$A$1:$'.Coordinate::stringFromColumnIndex($maxCol).'$'.$maxRow.'</definedName>';
                }
                $idx++;
            }
            if ($names !== '') {
                $wb = preg_replace('#<definedName\b[^>]*name="_xlnm\.Print_Area"[^>]*>.*?</definedName>#s', '', $wb);
                if (str_contains($wb, '<definedNames>')) {
                    $wb = str_replace('<definedNames>', '<definedNames>'.$names, $wb);
                } elseif (str_contains($wb, '<definedNames/>')) {
                    $wb = str_replace('<definedNames/>', '<definedNames>'.$names.'</definedNames>', $wb);
                } else {
                    $wb = preg_replace('#(</sheets>)#', '$1<definedNames>'.$names.'</definedNames>', $wb, 1);
                }
                $zip->addFromString('xl/workbook.xml', $wb);
            }
        } finally {
            $zip->close();
        }
    }

    /**
     * @return array{0:int,1:int} last column and row (1-based) of the DRAWING area: shape anchors, plus the contiguous run of columns with data
     *                            that touches them (stops at the first empty column, so side tables like a price list are left out).
     */
    private function usedExtent(\ZipArchive $zip, string $sheetFile, string $xml): array
    {
        $cells = [];   // [col, row] of cells holding a value (an empty styled cell has no <v>/<is>)
        if (preg_match_all('#<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*?(?:/>|>(.*?)</c>)#s', $xml, $m, PREG_SET_ORDER)) {
            foreach ($m as $c) {
                if (($c[3] ?? '') !== '' && preg_match('#<(v|is)>#', $c[3])) {
                    $cells[] = [Coordinate::columnIndexFromString($c[1]), (int) $c[2]];
                }
            }
        }
        $shapeCol = 0;
        $shapeRow = 0;
        $relFile = dirname($sheetFile).'/_rels/'.basename($sheetFile).'.rels';
        $rels = (string) $zip->getFromName($relFile);
        if ($rels !== '' && preg_match_all('/<Relationship\b[^>]*>/', $rels, $rm)) {
            foreach ($rm[0] as $tag) {
                if (str_contains($tag, '/drawing"') && preg_match('/\bTarget="([^"]+)"/', $tag, $t)) {
                    $dfile = ltrim(preg_replace('#^(\.\./)+#', 'xl/', $t[1]), '/');
                    $d = (string) $zip->getFromName($dfile);
                    if (preg_match_all('#<xdr:(?:from|to)>\s*<xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>#s', $d, $anch, PREG_SET_ORDER)) {
                        foreach ($anch as $a) {
                            $shapeCol = max($shapeCol, (int) $a[1] + 1);
                            $shapeRow = max($shapeRow, (int) $a[2] + 1);
                        }
                    }
                }
            }
        }
        $valueCols = array_flip(array_column($cells, 0));
        if ($shapeCol === 0) {   // no drawing on this sheet: everything with data
            $maxCol = $valueCols === [] ? 0 : max(array_keys($valueCols));
        } else {
            $maxCol = $shapeCol;
            while (isset($valueCols[$maxCol + 1])) {
                $maxCol++;
            }
        }
        $maxRow = $shapeRow;
        foreach ($cells as [$col, $row]) {
            if ($col <= $maxCol) {
                $maxRow = max($maxRow, $row);
            }
        }

        return [$maxCol, $maxRow];
    }

    private function withFitToPage(string $xml): string
    {
        $xml = preg_replace('#<(rowBreaks|colBreaks)\b.*?</\1>#s', '', $xml);
        $xml = preg_replace('#<pageSetup\b[^>]*/>#', '', $xml);
        if (preg_match('#<sheetPr\b[^>]*/>#', $xml)) {
            $xml = preg_replace('#<sheetPr\b([^>]*)/>#', '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>', $xml, 1);
        } elseif (preg_match('#<sheetPr\b[^>]*>.*?</sheetPr>#s', $xml)) {
            $xml = preg_replace('#<pageSetUpPr\b[^>]*/>#', '', $xml);
            $xml = preg_replace('#</sheetPr>#', '<pageSetUpPr fitToPage="1"/></sheetPr>', $xml, 1);
        } else {
            $xml = preg_replace('#(<worksheet\b[^>]*>)#', '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>', $xml, 1);
        }
        $setup = '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="1"/>';
        if (preg_match('#<pageMargins\b[^>]*/>#', $xml)) {
            return preg_replace('#(<pageMargins\b[^>]*/>)#', '$1'.$setup, $xml, 1);
        }
        $margins = '<pageMargins left="0.2" right="0.2" top="0.2" bottom="0.2" header="0" footer="0"/>';
        foreach (['<headerFooter', '<drawing', '<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'] as $tag) {
            if (str_contains($xml, $tag)) {
                return preg_replace('#'.preg_quote($tag, '#').'#', $margins.$setup.$tag, $xml, 1);
            }
        }

        return $xml;
    }

    private function rmrf(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($dir);
    }

    /** Embedded pictures of a sheet as data URIs (png/jpeg/gif only; max 10 per sheet, 2 MB each). Charts are not rendered. */
    private function sheetImages(Worksheet $ws): array
    {
        $out = [];
        foreach ($ws->getDrawingCollection() as $d) {
            if (count($out) >= 10) {
                break;
            }
            try {
                if ($d instanceof MemoryDrawing) {
                    ob_start();
                    imagepng($d->getImageResource());
                    $bytes = (string) ob_get_clean();
                } else {
                    $bytes = (string) @file_get_contents($d->getPath());
                }
                $mime = $bytes === '' ? '' : (string) (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
                if (strlen($bytes) > 2 * 1024 * 1024 || ! in_array($mime, ['image/png', 'image/jpeg', 'image/gif'], true)) {
                    continue;
                }
                $out[] = ['src' => 'data:'.$mime.';base64,'.base64_encode($bytes), 'name' => (string) $d->getName(), 'cell' => (string) $d->getCoordinates()];
            } catch (\Throwable) {
                continue;
            }
        }

        return $out;
    }

    /** @return array{0:string,1:string} extension, detected MIME */
    private function inspect(UploadedFile $file, object $category): array
    {
        $ext = strtolower($file->getClientOriginalExtension());
        $allowed = json_decode((string) $category->allowed_extensions, true) ?: [];
        if (! in_array($ext, $allowed, true) || ! isset(self::MIME[$ext])) {
            throw new AssignmentRuleViolation('Jenis berkas tidak diizinkan (diizinkan: '.implode(', ', $allowed).').');
        }
        $size = (int) $file->getSize();
        if ($size <= 0 || $size > $category->max_size_kb * 1024) {
            throw new AssignmentRuleViolation('Ukuran berkas harus lebih dari 0 dan paling besar '.$category->max_size_kb.' KB.');
        }
        $detected = $this->verifyContent($ext, $file->getRealPath());

        return [$ext, $detected];
    }

    /**
     * Verifies the bytes against the extension and returns the MIME to store. Images/PDF: libmagic. Legacy Office (OLE): libmagic must say Excel/Word.
     * OOXML: a ZIP with the right main part and NO macro project. DWG: `AC10xx` signature. DXF: ASCII `0 / SECTION`.
     */
    private function verifyContent(string $ext, string $path): string
    {
        $magic = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($path);
        $head = (string) file_get_contents($path, false, null, 0, 512);
        $ok = match ($ext) {
            'jpg', 'jpeg', 'png', 'webp', 'pdf' => $magic === self::MIME[$ext],
            'xls' => str_starts_with($head, "\xD0\xCF\x11\xE0") && in_array($magic, ['application/vnd.ms-excel', 'application/x-ole-storage', 'application/CDFV2', 'application/octet-stream'], true) && $this->oleKind($path) !== 'word',
            'doc' => str_starts_with($head, "\xD0\xCF\x11\xE0") && in_array($magic, ['application/msword', 'application/x-ole-storage', 'application/CDFV2', 'application/octet-stream'], true) && $this->oleKind($path) !== 'excel',
            'xlsx' => $this->ooxml($path, 'xl/workbook.xml'),
            'docx' => $this->ooxml($path, 'word/document.xml'),
            'dwg' => (bool) preg_match('/^AC1[0-9]{3}/', $head),
            'dxf' => (bool) preg_match('/^\s*0\s*\r?\n\s*SECTION\s*\r?\n/', $head),
            default => false,
        };
        if (! $ok) {
            throw new AssignmentRuleViolation("Isi berkas ({$magic}) tidak sesuai dengan ekstensinya (.{$ext}).");
        }

        return self::MIME[$ext];
    }

    private function ooxml(string $path, string $mainPart): bool
    {
        $zip = new \ZipArchive;
        if ($zip->open($path) !== true) {
            return false;
        }
        try {
            return $zip->locateName('[Content_Types].xml') !== false && $zip->locateName($mainPart) !== false && $zip->locateName('xl/vbaProject.bin') === false && $zip->locateName('word/vbaProject.bin') === false;
        } finally {
            $zip->close();
        }
    }

    /** 'excel' | 'word' | null for an OLE container, from the stream names (a heuristic only used to tell .xls from .doc). */
    private function oleKind(string $path): ?string
    {
        $raw = (string) file_get_contents($path, false, null, 0, 262144);
        $has = fn (string $name) => str_contains($raw, mb_convert_encoding($name, 'UTF-16LE', 'UTF-8'));
        if ($has('Workbook') || $has('Book')) {
            return 'excel';
        }
        if ($has('WordDocument')) {
            return 'word';
        }

        return null;
    }

    private function store(UploadedFile $file): string
    {
        $key = 'documents/'.now()->format('Y/m').'/'.Str::uuid();
        Storage::disk($this->disk())->putFileAs(dirname($key), $file, basename($key));

        return $key;
    }

    /** @param array<string,mixed> $extra */
    private function insertVersion(string $docId, string $verId, int $n, ?string $previous, UploadedFile $file, string $key, string $ext, string $mime, ?string $reason, User $actor, ?string $displayName = null): void
    {
        DB::table('application_document_versions')->insert(['id' => $verId, 'document_id' => $docId, 'version_number' => $n, 'previous_version_id' => $previous,
            'original_name' => mb_substr(preg_replace('/[\x00-\x1F\x7F\/\\\\]/u', '_', basename($displayName ?? $file->getClientOriginalName())) ?? 'dokumen', 0, 255), 'stored_key' => $key, 'mime_type' => $mime, 'extension' => $ext,
            'size_bytes' => (int) $file->getSize(), 'sha256' => (string) hash_file('sha256', $file->getRealPath()), 'revision_reason' => $reason, 'lifecycle_status' => 'UPLOADED', 'uploaded_by' => $actor->getKey(), 'uploaded_at' => now()]);
    }

    private function log(string $versionId, User $actor, string $action, ?string $ip = null): void
    {
        DB::table('document_access_logs')->insert(['id' => (string) Str::uuid(), 'document_version_id' => $versionId, 'actor_user_id' => $actor->getKey(), 'action' => $action, 'ip_address' => $ip, 'occurred_at' => now()]);
    }

    private function code(): string
    {
        do {
            $c = 'DOC-'.now()->format('Ymd').'-'.strtoupper(Str::random(6));
        } while (DB::table('application_documents')->where('document_code', $c)->exists());

        return $c;
    }

    /**
     * Drawing files are named by the system (owner 2026-11-15): `GBR_{agenda number}_{customer name}`, e.g. GBR_514539912610278772_CV.JAYA BERKAH FOODS 2; without an agenda number `GBR_{customer name}`.
     * A drawing package belongs to the representative application, so the name follows the representative's customer; attachments of the same version get ` - Lampiran n`.
     */
    public function drawingTitle(string $applicationId, string $role, string $drawingVersionId): string
    {
        $name = (string) DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->where('a.id', $applicationId)->value('c.name');
        $agenda = DB::table('application_external_references')->where('application_id', $applicationId)->where('reference_type', 'AGENDA')->where('is_active', true)->orderByDesc('created_at')->value('reference_number');
        $clean = fn (string $v): string => trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F\/\\\\:*?"<>|]/u', ' ', $v) ?? $v) ?? $v);
        $base = 'GBR_'.($agenda !== null && $agenda !== '' ? $clean((string) $agenda).'_' : '').($clean($name) !== '' ? $clean($name) : 'PELANGGAN');
        $base = mb_substr($base, 0, 180);
        if ($role !== 'ATTACHMENT') {
            return $base;
        }
        $n = DB::table('application_documents')->where('drawing_version_id', $drawingVersionId)->where('file_role', 'ATTACHMENT')->count() + 1;

        return "{$base} - Lampiran {$n}";
    }

    private function title(?string $title, UploadedFile $file): string
    {
        $t = trim((string) $title) !== '' ? trim((string) $title) : pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);

        return mb_substr(trim(preg_replace('/\s+/u', ' ', $t) ?? $t) ?: 'Dokumen', 0, 200);
    }
}
