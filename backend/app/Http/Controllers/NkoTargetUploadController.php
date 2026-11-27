<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Http\Controllers\Concerns\AuthorizesNkoChanges;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Nko\NkoDefinitionUploadService;
use App\Services\Nko\NkoRuleException;
use App\Services\Nko\NkoTargetWorkbook;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Unggahan workbook target NKO (docs/93 §12). Izin sama dengan workbook definisi: membaca butuh nko.view; mengunggah butuh nko.rules.propose dan memutus butuh nko.rules.approve, keduanya tingkat UP3.
 */
class NkoTargetUploadController extends Controller
{
    use AuthorizesNkoChanges;

    private const MAX_KB = 8192;

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MfaService $mfa, private readonly NkoDefinitionUploadService $uploads,
        private readonly NkoTargetWorkbook $workbook) {}

    /** GET /nko/target-template?year=&level=UP3|ULP: target yang sedang berlaku, satu tab per unit. */
    public function template(Request $request): BinaryFileResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'level' => ['required', 'in:UP3,ULP']]);
        $path = storage_path('app/nko-template-'.Str::uuid().'.xlsx');
        $this->guard(fn () => $this->workbook->write((int) $d['year'], $d['level'], $path));

        return response()->download($path, "TEMPLATE-TARGET-NKO-{$d['level']}-{$d['year']}.xlsx", ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /** GET /nko/target-uploads?status=: terbaru lebih dulu, tanpa rincian perubahan. */
    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $d = $request->validate(['status' => ['nullable', 'in:MENUNGGU,DISETUJUI,DITOLAK,DIBATALKAN']]);
        $rows = $this->query()->when(! empty($d['status']), fn ($q) => $q->where('p.status', $d['status']))->orderByDesc('p.uploaded_at')->orderByDesc('p.id')->limit(100)->get();

        return response()->json(['data' => $rows->map(fn (object $row) => $this->present($row))->all()]);
    }

    /** GET /nko/target-uploads/{id}: beserta sel yang berubah per unit. */
    public function show(Request $request, string $upload): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'nko.view');
        $row = $this->query()->where('p.id', $upload)->first();
        if ($row === null) {
            throw new AdministrationDenied('Unggahan tidak ditemukan.', 404);
        }

        return response()->json(['data' => $this->present($row) + ['changes' => json_decode($row->changes, true), 'check' => json_decode($row->check_report ?? 'null', true)]]);
    }

    /** POST /nko/target-uploads/check (multipart: file, year): hasil pemeriksaan tanpa menyimpan. */
    public function check(Request $request): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate($this->fileRules());
        @set_time_limit(300);

        return response()->json(['data' => $this->uploads->checkTarget($request->file('file'), (int) $d['year'])]);
    }

    /** POST /nko/target-uploads (multipart: file, year, note); 422 dengan `data` = hasil pemeriksaan bila workbook tidak lolos. */
    public function store(Request $request): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $d = $request->validate($this->fileRules() + ['note' => ['required', 'string', 'max:500']]);
        @set_time_limit(300);
        try {
            $id = $this->uploads->uploadTarget($request->file('file'), (int) $d['year'], $d['note'], $request->user());
        } catch (NkoRuleException $e) {
            return $this->failure($e);
        }

        return response()->json(['message' => 'Workbook target diterima. Periksa perubahannya; target baru berlaku setelah disetujui.', 'data' => ['id' => $id]], 201);
    }

    /** POST /nko/target-uploads/{id}/decision {decision: approve|reject, note?} */
    public function decide(Request $request, string $upload): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.approve');
        $d = $request->validate(['decision' => ['required', 'in:approve,reject'], 'note' => ['nullable', 'string', 'max:500']]);
        @set_time_limit(300);
        try {
            $result = $this->uploads->decide($upload, $d['decision'] === 'approve', $d['note'] ?? null, $request->user(), 'TARGET');
        } catch (NkoRuleException $e) {
            return $this->failure($e);
        }

        return response()->json(['message' => $result['status'] === 'DISETUJUI' ? "{$result['cells']} target bulanan diperbarui. Hitung ulang NKO bulan yang terdampak." : 'Unggahan ditolak.',
            'data' => ['status' => $result['status'], 'cells' => $result['cells']]]);
    }

    /** DELETE /nko/target-uploads/{id}: pengunggah membatalkan unggahan yang masih menunggu. */
    public function cancel(Request $request, string $upload): JsonResponse
    {
        $this->authorizeChange($request, 'nko.rules.propose');
        $this->guard(fn () => $this->uploads->cancel($upload, $request->user(), 'TARGET'));

        return response()->json(['message' => 'Unggahan dibatalkan.']);
    }

    private function query(): Builder
    {
        return DB::table('kpi_definition_uploads as p')->leftJoin('users as a', 'a.id', '=', 'p.uploaded_by')->leftJoin('users as b', 'b.id', '=', 'p.decided_by')
            ->where('p.kind', 'TARGET')->select(['p.*', 'a.name as uploader_name', 'b.name as decider_name']);
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
