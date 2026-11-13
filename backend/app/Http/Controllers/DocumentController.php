<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Documents\DocumentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/** Documents module endpoints. Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class DocumentController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly DocumentService $documents) {}

    /** Upload an evidence file to a survey version (surveyor only, DRAFT version). */
    public function uploadToSurvey(Request $request, string $survey, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'surveys.execute');
        $s = DB::table('application_surveys')->where('id', $survey)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $app = DB::table('applications')->where('id', $s->application_id)->first();
        $this->authorizer->authorizeOnUnit($actor, 'surveys.execute', $app->organizational_unit_id);
        $v = $this->draftVersionOf($s, $version, $actor);
        $data = Validator::make($request->all(), ['file' => ['required', 'file'], 'title' => ['nullable', 'string', 'max:200']])->validate();
        $id = $this->documents->upload($app->id, 'SURVEY', $request->file('file'), $data['title'] ?? null, $v->id, $actor);

        return response()->json(['data' => $this->view($id)], 201);
    }

    /** Upload a file of a drawing package version (author only, DRAFT version). `role`: MAIN (exactly one) or ATTACHMENT. */
    public function uploadToDrawing(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'drawings.execute');
        $d = DB::table('application_drawings')->where('id', $drawing)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $app = DB::table('applications')->where('id', $d->application_id)->first();
        $this->authorizer->authorizeOnUnit($actor, 'drawings.execute', $app->organizational_unit_id);
        $v = $this->draftDrawingVersion($d, $version, $actor);
        $data = Validator::make($request->all(), ['file' => ['required', 'file'], 'title' => ['nullable', 'string', 'max:200'], 'role' => ['nullable', 'in:MAIN,ATTACHMENT']])->validate();
        $role = $data['role'] ?? 'MAIN';
        if ($role === 'MAIN' && DB::table('application_documents')->where('drawing_version_id', $v->id)->where('file_role', 'MAIN')->where('status', 'ACTIVE')->exists()) {
            throw new AssignmentRuleViolation('Versi ini sudah memiliki berkas gambar utama; hapus dulu atau unggah sebagai lampiran.');
        }
        $title = $this->documents->drawingTitle($app->id, $role, $v->id);
        $id = $this->documents->upload($app->id, 'TECHNICAL_DRAWING', $request->file('file'), null, null, $actor, ['drawing_version_id' => $v->id, 'file_role' => $role, 'display_title' => $title]);
        if ($role === 'MAIN' && blank($v->title)) {
            // the technical drawing's title follows the main file's name until the drafter writes another one
            DB::table('application_drawing_versions')->where('id', $v->id)->where('status', 'DRAFT')->whereNull('title')->update(['title' => $title, 'updated_at' => now()]);
        }

        return response()->json(['data' => $this->view($id)], 201);
    }

    public function indexForApplication(Request $request, string $application): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.view');
        $app = DB::table('applications')->where('id', $application)->first();
        if ($app === null || (! $scope['unrestricted'] && ! in_array($app->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $ids = DB::table('application_documents')->where('application_id', $app->id)->where('status', 'ACTIVE')->orderBy('created_at')->pluck('id');

        return response()->json(['data' => $ids->map(fn ($id) => $this->view($id))->all()]);
    }

    public function show(Request $request, string $document): JsonResponse
    {
        $this->viewable($request, $document);

        return response()->json(['data' => $this->view($document)]);
    }

    public function download(Request $request, string $document)
    {
        $doc = $this->viewable($request, $document);
        $request->validate(['version' => ['nullable', 'integer', 'min:1'], 'inline' => ['nullable', 'boolean']]);

        return $this->documents->download($doc, $request->filled('version') ? (int) $request->query('version') : null, $request->boolean('inline'), $request->user(), $request->ip());
    }

    public function preview(Request $request, string $document): JsonResponse
    {
        $doc = $this->viewable($request, $document);

        return response()->json(['data' => $this->documents->previewSheets($doc, $request->user(), $request->ip())]);
    }

    /** Spreadsheet rendered to PDF (LibreOffice) so shapes and layout look as in Excel. */
    public function previewPdf(Request $request, string $document)
    {
        $doc = $this->viewable($request, $document);
        $key = $this->documents->previewPdfKey($doc, $request->user(), $request->ip());

        return \Illuminate\Support\Facades\Storage::disk($this->documents->disk())->response($key, 'pratinjau.pdf', [
            'Content-Type' => 'application/pdf', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], 'inline');
    }

    /** Hide a survey document while its version is still a DRAFT (surveyor only). */
    public function remove(Request $request, string $document): JsonResponse
    {
        $actor = $request->user();
        $doc = DB::table('application_documents')->where('id', $document)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $app = DB::table('applications')->where('id', $doc->application_id)->first();
        if ($doc->survey_version_id !== null) {
            $this->authorizer->authorizeScope($actor, 'surveys.execute');
            $this->authorizer->authorizeOnUnit($actor, 'surveys.execute', $app->organizational_unit_id);
            $sv = DB::table('application_survey_versions')->where('id', $doc->survey_version_id)->first();
            $this->draftVersionOf(DB::table('application_surveys')->where('id', $sv->survey_id)->first(), $sv->id, $actor);
        } elseif ($doc->drawing_version_id !== null) {
            $this->authorizer->authorizeScope($actor, 'drawings.execute');
            $this->authorizer->authorizeOnUnit($actor, 'drawings.execute', $app->organizational_unit_id);
            $dv = DB::table('application_drawing_versions')->where('id', $doc->drawing_version_id)->first();
            $this->draftDrawingVersion(DB::table('application_drawings')->where('id', $dv->drawing_id)->first(), $dv->id, $actor);
        } else {
            throw new AdministrationDenied('Dokumen ini tidak dapat dihapus dari sini.', 403);
        }
        $this->documents->remove($document, $actor);

        return response()->json(['message' => 'Dokumen dihapus dari tampilan; berkas dan riwayatnya tetap tersimpan.']);
    }

    // ------------------------------------------------------------------------------------------------------

    private function draftVersionOf(object $survey, string $versionId, $actor): object
    {
        $v = DB::table('application_survey_versions')->where('id', $versionId)->where('survey_id', $survey->id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($survey->status !== 'ACTIVE' || $v->status !== 'DRAFT') {
            throw new AssignmentRuleViolation('Dokumen hanya dapat ditambah/dihapus saat versi survey masih DRAFT.');
        }
        if ($v->surveyor_id !== $actor->getKey()) {
            throw new AdministrationDenied('Hanya surveyor yang ditugaskan yang dapat mengelola dokumen survey.', 403);
        }

        return $v;
    }

    private function draftDrawingVersion(object $drawing, string $versionId, $actor): object
    {
        $v = DB::table('application_drawing_versions')->where('id', $versionId)->where('drawing_id', $drawing->id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($v->status !== 'DRAFT') {
            throw new AssignmentRuleViolation('Berkas hanya dapat ditambah/dihapus saat versi gambar masih DRAFT.');
        }
        if ($v->author_id !== $actor->getKey()) {
            throw new AdministrationDenied('Hanya penyusun yang ditugaskan yang dapat mengelola berkas gambar.', 403);
        }

        return $v;
    }

    private function viewable(Request $request, string $documentId): object
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.view');
        $doc = DB::table('application_documents')->where('id', $documentId)->first();
        $unit = $doc === null ? null : DB::table('applications')->where('id', $doc->application_id)->value('organizational_unit_id');
        if ($doc === null || (! $scope['unrestricted'] && ! in_array($unit, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $doc;
    }

    /** @return array<string,mixed> */
    private function view(string $id): array
    {
        $d = DB::table('application_documents as d')->join('document_categories as c', 'c.id', '=', 'd.category_id')->join('application_document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->join('users as u', 'u.id', '=', 'v.uploaded_by')->where('d.id', $id)
            ->first(['d.id', 'd.application_id', 'd.document_code', 'd.title', 'd.status', 'd.survey_version_id', 'd.drawing_version_id', 'd.file_role', 'c.code as category', 'v.version_number', 'v.original_name', 'v.mime_type', 'v.size_bytes', 'v.sha256', 'v.uploaded_at', 'u.email as uploaded_by_email']);

        return (array) $d + ['versions_count' => DB::table('application_document_versions')->where('document_id', $id)->count()];
    }
}
