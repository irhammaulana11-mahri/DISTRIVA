<?php

namespace App\Http\Controllers\MasterData;

use App\Exceptions\AdministrationDenied;
use App\Formula\FormulaException;
use App\Http\Controllers\Controller;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Bom\BomCalculator;
use App\Services\Bom\BomService;
use App\Services\Mto\MtoService;
use App\Services\Notifications\InAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** BOM versions per construction group (docs/60). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). */
class BomController extends Controller
{
    public function __construct(private readonly CatalogAuthorizer $authorizer, private readonly BomService $bom, private readonly BomCalculator $calculator, private readonly InAppNotifier $notifier) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $request->validate(['group' => ['nullable', Rule::in((array) config('distriva.bom_groups'))], 'status' => ['nullable', Rule::in(['DRAFT', 'APPROVED', 'INACTIVE'])]]);

        $q = DB::table('bom_headers as h')->selectRaw('h.*, (select count(*) from bom_lines l where l.bom_header_id = h.id) as lines_count');
        $groups = (array) config('distriva.bom_groups');
        $q->orderByRaw('array_position(?::text[], h.group_code), h.version_number desc', ['{'.implode(',', $groups).'}']);
        if ($request->filled('group')) {
            $q->where('h.group_code', $request->query('group'));
        }
        if ($request->filled('status')) {
            $q->where('h.status', $request->query('status'));
        }

        return response()->json(['data' => $q->get()->map(fn ($h) => $this->header($h))->all()]);
    }

    public function show(Request $request, string $header): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $h = DB::table('bom_headers')->selectRaw('bom_headers.*, (select count(*) from bom_lines l where l.bom_header_id = bom_headers.id) as lines_count')->where('id', $header)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $events = DB::table('bom_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.bom_header_id', $header)->orderBy('e.occurred_at')
            ->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.email as actor_email']);

        return response()->json(['data' => $this->header($h) + ['events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_email' => $e->actor_email])->all()]]);
    }

    public function lines(Request $request, string $header): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        DB::table('bom_headers')->where('id', $header)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $page = DB::table('bom_lines as l')->leftJoin('khs_items as i', 'i.id', '=', 'l.khs_item_id')->where('l.bom_header_id', $header)->orderBy('l.sequence')
            ->select('l.sequence', 'l.description', 'l.source_formulas', 'l.source_reference', 'i.code as khs_code')->paginate(max(1, min((int) $request->query('per_page', 50), 200)));

        return response()->json([
            'data' => collect($page->items())->map(fn ($l) => ['sequence' => $l->sequence, 'khs_code' => $l->khs_code, 'description' => $l->description, 'formulas' => json_decode($l->source_formulas, true), 'source_reference' => $l->source_reference])->all(),
            'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'bom.manage'); // grant first, then validate
        $data = Validator::make($request->all(), [
            'file' => ['required', 'file', 'extensions:json', 'max:'.(int) config('distriva_permissions.master_data_import.max_kb')],
            'valid_from' => ['required', 'date_format:Y-m-d'], 'source_reference' => ['nullable', 'string', 'max:255'], 'dry_run' => ['sometimes', 'boolean'],
        ])->validate();
        $doc = json_decode((string) file_get_contents($request->file('file')->getRealPath()), true, 64);
        if (! is_array($doc)) {
            throw ValidationException::withMessages(['file' => 'Berkas bukan JSON yang valid.']);
        }
        $result = $this->bom->import($doc, $data['valid_from'], $data['source_reference'] ?? null, $request->boolean('dry_run'), $actor);

        if (! $request->boolean('dry_run') && $result['summary']['created']) {
            $this->notifier->approvalRequested('bom.approve', 'bom_headers', 'BOM', $actor, 'BOM', '/master-data/bom');
        }

        return response()->json(['data' => $result['summary'], 'problems' => $result['problems']], $result['summary']['created'] ? 201 : 200);
    }

    public function updateDraft(Request $request, string $header): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'bom.manage');
        $data = Validator::make($request->all(), [
            'name' => ['sometimes', 'required', 'string', 'max:150'], 'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'valid_from' => ['sometimes', 'required', 'date_format:Y-m-d'], 'reason' => ['required', 'string', 'max:1000'],
        ])->validate();
        $reason = $data['reason'];
        unset($data['reason']);
        $this->bom->updateDraft($header, $data, $reason, $actor);

        return response()->json(['data' => $this->header(DB::table('bom_headers')->where('id', $header)->first())]);
    }

    public function approve(Request $request): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'bom.approve');
        $data = Validator::make($request->all(), ['version_ids' => ['required', 'array', 'min:1', 'max:50'], 'version_ids.*' => ['uuid', 'distinct'], 'reason' => ['required', 'string', 'max:1000']])->validate();

        $out = $this->bom->approve($data['version_ids'], $actor, $data['reason']);
        $this->notifier->approved('bom_headers', $data['version_ids'], 'BOM', $actor, $data['reason'], 'BOM', '/master-data/bom');

        return response()->json(['data' => $out]);
    }

    public function retire(Request $request, string $header): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorize($actor, 'bom.approve');
        $data = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->bom->retire($header, $data['reason'], $actor);

        return response()->json(['data' => $this->header(DB::table('bom_headers')->where('id', $header)->first())]);
    }

    /** Pure calculation: nothing is stored. Body: {inputs:[{code, psg?, bkr?}]}. */
    public function calculate(Request $request, string $header): JsonResponse
    {
        $this->authorizer->authorize($request->user(), 'master_data.view');
        $h = DB::table('bom_headers')->where('id', $header)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $data = Validator::make($request->all(), [
            'inputs' => ['nullable', 'array', 'max:500'], 'inputs.*.code' => ['required', 'string', 'max:50', 'distinct'],
            'inputs.*.psg' => ['nullable', 'numeric', 'min:0', 'max:1000000'], 'inputs.*.bkr' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'params' => ['nullable', 'array', 'max:50'], 'params.*' => ['present', 'max:1000000'],
        ])->validate();
        if (($data['inputs'] ?? []) === [] && ! in_array($h->group_code, MtoService::PARAM_DRIVEN_GROUPS, true)) {   // only PBPD sheets have no construction rows
            throw ValidationException::withMessages(['inputs' => 'Isian jumlah konstruksi wajib diisi.']);
        }
        $defs = collect(json_decode((string) $h->parameters, true) ?: [])->keyBy('name');
        foreach ($data['params'] ?? [] as $name => $value) {   // numbers >= 0, or one of the options of a text parameter
            $d = $defs[$name] ?? null;
            $text = ($d['type'] ?? 'number') === 'text';
            if ($d !== null && ($text ? (($value !== null && ! is_string($value)) || (is_array($d['options'] ?? null) && trim((string) $value) !== '' && ! in_array(trim((string) $value), $d['options'], true))) : (! is_numeric($value) || $value < 0))) {
                throw ValidationException::withMessages(['params' => "Nilai parameter {$name} tidak valid."]);
            }
        }
        $declared = $defs->keys()->all();
        $strange = array_values(array_diff(array_keys($data['params'] ?? []), $declared));
        if ($strange !== []) {
            throw ValidationException::withMessages(['params' => 'Parameter tidak dideklarasikan pada versi BOM ini: '.implode(', ', array_slice($strange, 0, 5))]);
        }
        $known = DB::table('construction_types')->where('group_code', $h->group_code)->pluck('code')->all();
        $unknown = array_values(array_diff(array_column($data['inputs'] ?? [], 'code'), $known));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['inputs' => 'Kode jenis konstruksi bukan bagian dari kelompok '.$h->group_code.': '.implode(', ', array_slice($unknown, 0, 5))]);
        }
        $inputs = [];
        foreach ($data['inputs'] ?? [] as $in) {
            $inputs[$in['code']] = ['psg' => (float) ($in['psg'] ?? 0), 'bkr' => (float) ($in['bkr'] ?? 0)];
        }
        try {
            $lines = $this->calculator->calculate($header, $inputs, array_map(fn ($v) => is_numeric($v) ? (float) $v : trim((string) $v), $data['params'] ?? []));
        } catch (FormulaException $e) {
            throw ValidationException::withMessages(['formula' => $e->getMessage()]);
        }

        return response()->json(['data' => ['bom' => $this->header($h), 'lines' => $lines]]);
    }

    /** @return array<string,mixed> */
    private function header(object $h): array
    {
        return ['id' => $h->id, 'group' => $h->group_code, 'version_number' => $h->version_number, 'name' => $h->name, 'description' => $h->description, 'valid_from' => $h->valid_from,
            'valid_until' => $h->valid_until, 'status' => $h->status, 'source_reference' => $h->source_reference, 'created_by' => $h->created_by, 'approved_by' => $h->approved_by,
            'approved_at' => $h->approved_at, 'parameters' => json_decode((string) ($h->parameters ?? '[]'), true), 'lines_count' => isset($h->lines_count) ? (int) $h->lines_count : null];
    }
}
