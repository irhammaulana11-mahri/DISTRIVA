<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Applications\EisImportService;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** Import of the EIS / Bot Daftung download (stage 1B/1C). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class ApplicationImportController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly EisImportService $import, private readonly WorkflowNotifier $flow) {}

    public function index(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.import');
        $q = DB::table('application_import_batches as b')->join('users as u', 'u.id', '=', 'b.initiated_by')->orderByDesc('b.created_at');
        if (! $scope['unrestricted']) {
            $q->where('b.initiated_by', $request->user()->getKey());
        }
        $page = $q->select('b.*', 'u.email as initiated_by_email')->paginate(max(1, min((int) $request->query('per_page', 25), 100)));

        return response()->json(['data' => collect($page->items())->map(fn ($b) => $this->batch($b))->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.import');     // grant first, then validate
        if ($scope['unrestricted'] && ! app(MfaService::class)->satisfied($request->user())) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }
        Validator::make($request->all(), ['file' => ['required', 'file', 'extensions:csv,txt,xlsx,xls,html,htm', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')]])->validate();

        return response()->json(['data' => $this->import->stage($request->file('file'), $scope, $request->user())], 201);
    }

    /**
     * GET /applications/imports/limits — what an upload can really be: DISTRIVA's own limit (max_kb, max_rows) and the PHP limits of the server that answers (upload_max_filesize, post_max_size),
     * so the EIS sync cuts its files to fit instead of failing with "The file failed to upload" (PHP's default upload_max_filesize is only 2 MB). A web server in front (nginx
     * client_max_body_size) cannot be seen from here. Read only.
     */
    public function limits(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'applications.import');
        $cfg = (array) config('distriva_permissions.master_data_import');
        $own = (int) $cfg['max_kb'] * 1024;
        $upload = $this->iniBytes((string) ini_get('upload_max_filesize'));
        $post = $this->iniBytes((string) ini_get('post_max_size'));
        $candidates = array_filter([$own, $upload > 0 ? $upload : null, $post > 0 ? $post - 65536 : null], fn ($v) => $v !== null && $v > 0);

        return response()->json(['data' => ['max_rows' => (int) $cfg['max_rows'], 'max_bytes_config' => $own, 'php_upload_max_bytes' => $upload, 'php_post_max_bytes' => $post, 'effective_max_bytes' => $candidates === [] ? $own : min($candidates)]]);
    }

    /** PHP ini shorthand ("2M", "512K", "1G", "-1") -> bytes (0 or less = unlimited). */
    private function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || ! preg_match('/^(-?\d+)\s*([KMG]?)/i', $v, $m)) {
            return 0;
        }

        return (int) $m[1] * match (strtoupper($m[2])) {
            'K' => 1024, 'M' => 1024 ** 2, 'G' => 1024 ** 3, default => 1,
        };
    }

    /**
     * GET /applications/imports/stale?before=YYYY-MM-DD — EIS applications of the caller's scope that are STILL RUNNING here (not CONNECTION_DONE / CANCELLED / REFUNDED) but were requested before the
     * date: a sync whose Range Mohon starts at that date never refreshes them, so their status may be out of date (owner 2026-11-09: no application may stay "not yet peremajaan" in DISTRIVA only
     * because it is older than the synced range). Read only.
     */
    public function stale(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.import');
        $data = Validator::make($request->query(), ['before' => ['required', 'date_format:Y-m-d']])->validate();
        $q = DB::table('applications as a')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')->where('a.source_type', 'BOT_DAFTUNG')
            ->whereNotIn('a.current_status', ['CONNECTION_DONE', 'CANCELLED', 'REFUNDED'])->whereNotNull('a.source_created_at')->where('a.source_created_at', '<', $data['before']);
        if (! $scope['unrestricted']) {
            $q->whereIn('a.organizational_unit_id', $scope['units']);
        }
        $oldest = (clone $q)->min('a.source_created_at');
        $byUnit = (clone $q)->selectRaw('u.code as unit_code, count(*) as total, min(a.source_created_at) as oldest')->groupBy('u.code')->orderBy('u.code')->get()
            ->map(fn ($r) => ['unit_code' => $r->unit_code, 'total' => (int) $r->total, 'oldest' => substr((string) $r->oldest, 0, 10)])->all();

        return response()->json(['data' => ['before' => $data['before'], 'total' => (int) (clone $q)->count(), 'oldest' => $oldest === null ? null : substr((string) $oldest, 0, 10), 'by_unit' => $byUnit]]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'applications.import');
        $request->validate(['action' => ['nullable', Rule::in(['NEW', 'MATCHED', 'UNCHANGED', 'REJECT'])], 'per_page' => ['nullable', 'integer']]);
        $b = DB::table('application_import_batches as b')->join('users as u', 'u.id', '=', 'b.initiated_by')->where('b.id', $id)->select('b.*', 'u.email as initiated_by_email')->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->import->requireOwner($b, $scope, $request->user());

        $q = DB::table('application_import_staging')->where('batch_id', $id)->orderBy('row_number');
        if ($request->filled('action')) {
            $q->where('action', $request->query('action'));
        }
        $page = $q->paginate(max(1, min((int) $request->query('per_page', 50), 200)));

        return response()->json(['data' => $this->batch($b), 'rows' => collect($page->items())->map(function ($r) {
            $n = json_decode((string) $r->normalized, true) ?: [];

            return ['row' => $r->row_number, 'agenda' => $r->source_reference_id, 'name' => $n['name'] ?? null, 'type' => $n['type'] ?? null, 'unit_code' => $n['unit_code'] ?? null, 'external_status' => $n['ext_status'] ?? null,
                'action' => $r->action, 'errors' => json_decode((string) $r->errors, true), 'warnings' => json_decode((string) $r->warnings, true), 'changes' => json_decode((string) $r->changes, true),
                'apply_status' => $r->apply_status, 'apply_message' => $r->apply_message, 'application_id' => $r->application_id];
        })->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]]);
    }

    public function confirm(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, 'applications.import');
        if ($scope['unrestricted'] && ! app(MfaService::class)->satisfied($actor)) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }
        $result = $this->import->confirm($id, $scope, $actor);
        $this->flow->importApplied($id, $actor);

        return response()->json(['data' => $this->batch(DB::table('application_import_batches as b')->join('users as u', 'u.id', '=', 'b.initiated_by')->where('b.id', $id)->select('b.*', 'u.email as initiated_by_email')->first()), 'result' => $result]);
    }

    public function discard(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, 'applications.import');
        $this->import->discard($id, $scope, $actor);

        return response()->json(['message' => 'Batch dibuang; tidak ada data permohonan yang berubah.']);
    }

    /** @return array<string,mixed> */
    private function batch(object $b): array
    {
        return ['id' => $b->id, 'file_name' => $b->file_name, 'format' => $b->file_format, 'status' => $b->status, 'total_rows' => $b->total_rows, 'counts' => json_decode((string) $b->counts, true),
            'initiated_by' => $b->initiated_by_email ?? $b->initiated_by, 'created_at' => $b->created_at, 'confirmed_at' => $b->confirmed_at];
    }
}
