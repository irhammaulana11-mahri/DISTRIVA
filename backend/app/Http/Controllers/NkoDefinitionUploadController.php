<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Concerns\AuthorizesNkoChanges;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Nko\NkoDefinitionTemplateService;
use App\Services\Nko\NkoDefinitionUploadService;
use App\Services\Nko\NkoRuleException;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Versi definisi NKO dan unggahan workbooknya (docs/93 tahap 5). Membaca butuh nko.view; mengunggah butuh nko.rules.propose dan memutus butuh nko.rules.approve, keduanya tingkat UP3.
 */
class NkoDefinitionUploadController extends Controller
{
    use AuthorizesNkoChanges;

    private const MAX_KB = 8192;

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MfaService $mfa, private readonly NkoDefinitionUploadService $uploads,
        private readonly NkoDefinitionTemplateService $templates) {}

    /** GET /nko/definition-sets?year=: versi definisi yang pernah dimuat. */
    public function sets(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['year' => ['nullable', 'integer', 'between:2000,2100']]);
        $rows = DB::table('kpi_definition_sets as s')->leftJoin('users as u', 'u.id', '=', 's.imported_by')->when(! empty($d['year']), fn ($q) => $q->where('s.year', $d['year']))
            ->orderByDesc('s.year')->orderByDesc('s.unit_level')->orderByDesc('s.version')->limit(200)
            ->get(['s.id', 's.year', 's.unit_level', 's.version', 's.status', 's.source_name', 's.total_weight', 's.warnings', 's.imported_at', 's.imported_by', 'u.name as importer_name']);

        return response()->json(['data' => $rows->map(fn ($s) => [
            'id' => $s->id, 'year' => (int) $s->year, 'unit_level' => $s->unit_level, 'version' => (int) $s->version, 'status' => $s->status, 'source_name' => $s->source_name,
            'total_weight' => $s->total_weight === null ? null : (float) $s->total_weight, 'warnings' => json_decode($s->warnings ?? '[]', true), 'imported_at' => $s->imported_at,
            'imported_by' => $s->imported_by === null ? null : ['id' => $s->imported_by, 'name' => $s->importer_name],
        ])->all()]);
    }

    /** GET /nko/definition-uploads?status=: terbaru lebih dulu, tanpa rincian perubahan. */
    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['status' => ['nullable', 'in:MENUNGGU,DISETUJUI,DITOLAK,DIBATALKAN']]);
        $rows = $this->query()->where('p.kind', 'DEFINISI')->when(! empty($d['status']), fn ($q) => $q->where('p.status', $d['status']))->orderByDesc('p.uploaded_at')->orderByDesc('p.id')->limit(100)->get();

        return response()->json(['data' => $rows->map(fn (object $row) => $this->present($row))->all()]);
    }

    /** GET /nko/definition-uploads/{id}: beserta pratinjau perubahan per tingkat. */
    public function show(Request $request, string $upload): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $row = $this->query()->where('p.kind', 'DEFINISI')->where('p.id', $upload)->first();
        if ($row === null) {
            throw new AdministrationDenied('Unggahan tidak ditemukan.', 404);
        }

        return response()->json(['data' => $this->present($row) + ['changes' => json_decode($row->changes, true), 'check' => json_decode($row->check_report ?? 'null', true)]]);
    }

    /** GET /nko/definition-template?year=&format=lengkap|definisi: workbook dari definisi aktif, untuk diubah lalu diunggah. */
    public function template(Request $request): BinaryFileResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'format' => ['nullable', 'in:lengkap,definisi']]);
        $definitionOnly = ($d['format'] ?? null) === 'definisi';
        $path = storage_path('app/nko-template-'.Str::uuid().'.xlsx');
        try {
            $this->templates->write((int) $d['year'], $path, $definitionOnly);
        } catch (NkoRuleException $e) {
            @unlink($path);
            throw new AdministrationDenied($e->getMessage(), $e->status);
        }

        return response()->download($path, ($definitionOnly ? 'TEMPLATE-DEFINISI-SAJA-NKO' : 'TEMPLATE-DEFINISI-NKO')."-{$d['year']}.xlsx", ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /** POST /nko/definition-uploads/check (multipart: file, year): hasil pemeriksaan tanpa menyimpan. */
    public function check(Request $request): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate($this->fileRules());
        @set_time_limit(300);

        return response()->json(['data' => $this->uploads->check($request->file('file'), (int) $d['year'])]);
    }

    /** POST /nko/definition-uploads (multipart: file, year, note); 422 dengan `data` = hasil pemeriksaan bila workbook tidak lolos. */
    public function store(Request $request): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate($this->fileRules() + ['note' => ['required', 'string', 'max:500']]);
        @set_time_limit(300);
        try {
            $id = $this->uploads->upload($request->file('file'), (int) $d['year'], $d['note'], $request->user());
        } catch (NkoRuleException $e) {
            return $this->failure($e);
        }

        return response()->json(['message' => 'Workbook diterima. Periksa perubahannya; definisi baru berlaku setelah disetujui.', 'data' => ['id' => $id]], 201);
    }

    /** POST /nko/definition-uploads/{id}/decision {decision: approve|reject, note?} */
    public function decide(Request $request, string $upload): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.approve');
        $d = $request->validate(['decision' => ['required', 'in:approve,reject'], 'note' => ['nullable', 'string', 'max:500']]);
        @set_time_limit(300);
        try {
            $result = $this->uploads->decide($upload, $d['decision'] === 'approve', $d['note'] ?? null, $request->user());
        } catch (NkoRuleException $e) {
            return $this->failure($e);
        }

        return response()->json(['message' => $result['status'] === 'DISETUJUI' ? 'Definisi baru aktif. Periksa item tanpa aturan, lalu hitung ulang NKO.' : 'Unggahan ditolak.', 'data' => $result]);
    }

    /** DELETE /nko/definition-uploads/{id}: pengunggah membatalkan unggahan yang masih menunggu. */
    public function cancel(Request $request, string $upload): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $this->guard(fn () => $this->uploads->cancel($upload, $request->user()));

        return response()->json(['message' => 'Unggahan dibatalkan.']);
    }

    private function query(): Builder
    {
        return DB::table('kpi_definition_uploads as p')->leftJoin('users as a', 'a.id', '=', 'p.uploaded_by')->leftJoin('users as b', 'b.id', '=', 'p.decided_by')->select(['p.*', 'a.name as uploader_name', 'b.name as decider_name']);
    }

    private function present(object $p): array
    {
        return ['id' => $p->id, 'year' => (int) $p->year, 'source_name' => $p->source_name, 'note' => $p->note, 'status' => $p->status,
            'uploaded_by' => $p->uploaded_by === null ? null : ['id' => $p->uploaded_by, 'name' => $p->uploader_name], 'uploaded_at' => $p->uploaded_at,
            'decided_by' => $p->decided_by === null ? null : ['id' => $p->decided_by, 'name' => $p->decider_name], 'decided_at' => $p->decided_at, 'decision_note' => $p->decision_note];
    }

    /** @return array<string, list<string>> */
    private function fileRules(): array
    {
        return ['file' => ['required', 'file', 'extensions:xlsx', 'max:'.self::MAX_KB], 'year' => ['required', 'integer', 'between:2000,2100']];
    }

    private function failure(NkoRuleException $e): JsonResponse
    {
        if ($e->data === null) {
            throw new AdministrationDenied($e->getMessage(), $e->status);
        }

        return response()->json(['message' => $e->getMessage(), 'data' => $e->data], $e->status);
    }

    private function guard(callable $action): mixed
    {
        try {
            return $action();
        } catch (NkoRuleException $e) {
            throw new AdministrationDenied($e->getMessage(), $e->status);
        }
    }
}
