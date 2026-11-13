<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Documents\DocumentService;
use App\Services\Mto\MtoService;
use App\Services\Notifications\WorkflowNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** MTO per drawing version (stage 4A). Rule violations -> 409, authorization -> 403/404 (bootstrap/app.php). Grant is checked before validation. */
class MtoController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MtoService $mto, private readonly WorkflowNotifier $flow) {}

    public function access(Request $request): JsonResponse
    {
        $can = [];
        foreach (array_keys((array) config('distriva_permissions.mto')) as $key) {
            $can[$key] = $this->authorizer->can($request->user(), $key);
        }

        return response()->json(['can' => $can]);
    }

    /** The MTO package of a drawing version (data:null when none yet). */
    public function forVersion(Request $request, string $drawing, string $version): JsonResponse
    {
        $this->viewableVersion($request, $drawing, $version);
        $p = DB::table('mto_packages')->where('drawing_version_id', $version)->first();

        return response()->json(['data' => $p === null ? null : $this->detail($p->id, $request->user())]);
    }

    public function store(Request $request, string $drawing, string $version): JsonResponse
    {
        $actor = $request->user();
        $this->authorizer->authorizeScope($actor, 'mto.execute');
        $v = $this->versionRow($drawing, $version);
        $this->authorizer->authorizeOnUnit($actor, 'mto.execute', $this->unitOfDrawing($drawing));
        $data = Validator::make($request->all(), ['copy_from_previous' => ['sometimes', 'boolean']])->validate();
        $id = $this->mto->create($drawing, $v->id, (bool) ($data['copy_from_previous'] ?? false), $actor);

        return response()->json(['data' => $this->detail($id, $actor)], 201);
    }

    public function show(Request $request, string $package): JsonResponse
    {
        $this->viewablePackage($request, $package);

        return response()->json(['data' => $this->detail($package, $request->user())]);
    }

    public function putItems(Request $request, string $package): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnPackage($actor, 'mto.execute', $package);
        $data = Validator::make($request->all(), [
            'items' => ['required', 'array', 'max:500'], 'items.*.construction_code' => ['required', 'string', 'max:50'], 'items.*.psg' => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'items.*.bkr' => ['nullable', 'numeric', 'min:0', 'max:100000000'], 'items.*.note' => ['nullable', 'string', 'max:300'],
            'params' => ['nullable', 'array', 'max:50'], 'params.*' => ['present', 'max:100000000'], 'reason' => ['nullable', 'string', 'max:1000'],
        ])->validate();
        $this->mto->replaceItems($package, $data['items'], array_map(fn ($v) => is_numeric($v) ? (float) $v : ($v === null ? '' : (is_string($v) ? trim($v) : $v)), $data['params'] ?? []), $data['reason'] ?? null, $actor);

        return response()->json(['data' => $this->detail($package, $actor)]);
    }

    /** Stage 4B: fill the DRAFT package from the GAMBAR sheet of the version's main Excel file. Returns what was matched / not matched / ignored. */
    public function extract(Request $request, string $package, DocumentService $documents): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnPackage($actor, 'mto.execute', $package);
        $data = Validator::make($request->all(), ['reason' => ['nullable', 'string', 'max:1000'], 'document_id' => ['nullable', 'uuid']])->validate();
        $report = $this->mto->extract($package, $data['reason'] ?? null, $actor, $documents, $data['document_id'] ?? null);

        return response()->json(['data' => $this->detail($package, $actor), 'extraction' => $report]);
    }

    /** Preview of the material need (nothing stored); a verified/approved package returns its frozen snapshot instead. */
    public function calculate(Request $request, string $package): JsonResponse
    {
        $this->viewablePackage($request, $package);
        $p = DB::table('mto_packages')->where('id', $package)->first();
        $calc = $p->status === 'DRAFT' ? $this->mto->calculate($package) : $this->snapshot($package, (string) $p->valid_on);

        return response()->json(['data' => $calc + ['frozen' => $p->status !== 'DRAFT']]);
    }

    public function verify(Request $request, string $package): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnPackage($actor, 'mto.execute', $package);
        $this->mto->verify($package, $actor);
        $this->flow->mtoVerified($package, $actor);

        return response()->json(['data' => $this->detail($package, $actor)]);
    }

    public function decide(Request $request, string $package): JsonResponse
    {
        $actor = $request->user();
        $this->authorizeOnPackage($actor, 'mto.approve', $package);
        $data = Validator::make($request->all(), ['decision' => ['required', Rule::in(['APPROVED', 'REJECTED'])], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $status = $this->mto->decide($package, $data['decision'], $data['notes'] ?? null, $actor);
        $this->flow->mtoDecided($package, $data['decision'], $data['notes'] ?? null, $actor);

        return response()->json(['data' => $this->detail($package, $actor), 'result' => ['status' => $status]]);
    }

    // ------------------------------------------------------------------------------------------------------

    private function versionRow(string $drawing, string $version): object
    {
        return DB::table('application_drawing_versions')->where('id', $version)->where('drawing_id', $drawing)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function unitOfDrawing(string $drawingId): string
    {
        $d = DB::table('application_drawings')->where('id', $drawingId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return (string) DB::table('applications')->where('id', $d->application_id)->value('organizational_unit_id');
    }

    private function viewableVersion(Request $request, string $drawing, string $version): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'mto.view');
        $this->versionRow($drawing, $version);
        if (! $scope['unrestricted'] && ! in_array($this->unitOfDrawing($drawing), $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function unitOfPackage(string $packageId): string
    {
        $p = DB::table('mto_packages')->where('id', $packageId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return (string) DB::table('applications')->where('id', $p->application_id)->value('organizational_unit_id');
    }

    private function viewablePackage(Request $request, string $packageId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'mto.view');
        if (! $scope['unrestricted'] && ! in_array($this->unitOfPackage($packageId), $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function authorizeOnPackage($actor, string $key, string $packageId): void
    {
        $this->authorizer->authorizeScope($actor, $key);
        $this->authorizer->authorizeOnUnit($actor, $key, $this->unitOfPackage($packageId));
    }

    /** @return array<string,mixed> the frozen snapshot of a verified/approved package, shaped like a calculation */
    private function snapshot(string $packageId, string $validOn): array
    {
        $lines = DB::table('mto_lines')->where('package_id', $packageId)->orderBy('group_code')->orderBy('sequence')->get()->map(fn ($l) => [
            'group' => $l->group_code, 'bom_header_id' => $l->bom_header_id, 'sequence' => $l->sequence, 'khs_code' => $l->khs_code, 'khs_name' => $l->khs_name, 'unit_text' => $l->unit_text,
            'material' => (float) $l->material, 'install' => (float) $l->install, 'remove' => (float) $l->remove, 'return' => (float) $l->return])->all();
        $totals = [];
        foreach ($lines as $l) {
            $t = &$totals[$l['khs_code']];
            $t ??= ['khs_code' => $l['khs_code'], 'khs_name' => $l['khs_name'], 'unit_text' => $l['unit_text'], 'material' => 0.0, 'install' => 0.0, 'remove' => 0.0, 'return' => 0.0];
            foreach (['material', 'install', 'remove', 'return'] as $c) {
                $t[$c] += $l[$c];
            }
            unset($t);
        }
        uksort($totals, fn ($a, $b) => (int) $a <=> (int) $b);
        $groups = DB::table('mto_lines as l')->join('bom_headers as h', 'h.id', '=', 'l.bom_header_id')->where('l.package_id', $packageId)->distinct()->get(['l.group_code', 'h.id as bom_header_id', 'h.version_number'])
            ->mapWithKeys(fn ($g) => [$g->group_code => ['bom_header_id' => $g->bom_header_id, 'bom_version' => $g->version_number]])->all();

        return ['valid_on' => substr($validOn, 0, 10), 'groups' => $groups, 'lines' => $lines, 'totals' => array_values($totals)];
    }

    /** @return array<string,mixed> */
    private function detail(string $packageId, $actor): array
    {
        $p = DB::table('mto_packages')->where('id', $packageId)->first();
        $dv = DB::table('application_drawing_versions')->where('id', $p->drawing_version_id)->first();
        $app = DB::table('applications')->where('id', $p->application_id)->first(['id', 'application_number', 'organizational_unit_id']);
        $items = DB::table('mto_items')->where('package_id', $packageId)->orderBy('group_code')->orderBy('construction_code')->get();
        $events = DB::table('mto_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.package_id', $packageId)->orderBy('e.seq')->get(['e.event_type', 'e.reason', 'e.occurred_at', 'u.name as actor_name', 'u.email as actor_email']);
        $user = fn (?string $id) => $id === null ? null : DB::table('users')->where('id', $id)->first(['id', 'name', 'email']);

        $today = now(config('distriva.business_timezone'))->toDateString();
        $paramDefs = [];
        foreach ($items->pluck('group_code')->unique() as $g) {
            $h = DB::table('bom_headers')->where('group_code', $g)->where('status', 'APPROVED')->where('valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->first();
            foreach ((array) json_decode((string) ($h->parameters ?? '[]'), true) as $d) {
                $paramDefs[] = ['name' => $d['name'], 'description' => $d['description'] ?? null, 'default' => $d['default'] ?? 0, 'group' => $g];
            }
        }

        $unit = $app->organizational_unit_id;
        $on = function (string $k) use ($actor, $unit): bool {
            if (! $this->authorizer->can($actor, $k)) {
                return false;
            }
            try {
                $this->authorizer->authorizeOnUnit($actor, $k, $unit);

                return true;
            } catch (AdministrationDenied) {
                return false;
            }
        };
        $open = $dv->status === 'DRAFT' || ($dv->status === 'SUBMITTED' && $dv->stage === 'ULP_MANAGER');
        $isAuthor = true;                       // role-based (owner 7 Nov 2026): the `mto.execute` check on the unit decides
        $can = [
            'edit' => $p->status === 'DRAFT' && $open && $isAuthor && $on('mto.execute'),
            'verify' => $p->status === 'DRAFT' && $open && $isAuthor && $items->isNotEmpty() && $on('mto.execute'),
            'decide' => $p->status === 'VERIFIED' && $open && $p->verified_by !== $actor->getKey() && $p->created_by !== $actor->getKey() && $on('mto.approve'),
        ];

        return ['id' => $p->id, 'package_number' => $p->package_number, 'status' => $p->status, 'valid_on' => $p->valid_on === null ? null : substr((string) $p->valid_on, 0, 10), 'snapshot_hash' => $p->snapshot_hash,
            'params' => (object) json_decode((string) $p->params, true), 'declared_params' => $paramDefs,
            'drawing_version' => ['id' => $dv->id, 'drawing_id' => $dv->drawing_id, 'version_number' => $dv->version_number, 'status' => $dv->status, 'stage' => $dv->stage],
            'application' => ['id' => $app->id, 'application_number' => $app->application_number],
            'created_by' => $user($p->created_by), 'verified_by' => $user($p->verified_by), 'verified_at' => $p->verified_at, 'approved_by' => $user($p->approved_by), 'approved_at' => $p->approved_at,
            'items' => $items->map(fn ($i) => ['construction_type_id' => $i->construction_type_id, 'group' => $i->group_code, 'construction_code' => $i->construction_code, 'construction_label' => $i->construction_label,
                'psg' => (float) $i->psg, 'bkr' => (float) $i->bkr, 'note' => $i->note, 'source' => $i->source, 'detected_psg' => $i->detected_psg === null ? null : (float) $i->detected_psg, 'detected_bkr' => $i->detected_bkr === null ? null : (float) $i->detected_bkr])->all(),
            'events' => $events->map(fn ($e) => (array) $e)->all(), 'can' => $can,
        ];
    }
}
