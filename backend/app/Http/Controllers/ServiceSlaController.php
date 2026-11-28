<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Tasks\ServiceSlaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Service SLA of network extension (14 / 24 / 100 working days from payment) and the explanation of a delay. Reading follows `tasks.view` (unit scope); writing the explanation follows `sla.note`
 * on the ULP of the application (outside it: 404). Status and deadline are computed (see ServiceSlaService).
 */
class ServiceSlaController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly ServiceSlaService $sla) {}

    /** GET /service-sla?status=OVERDUE&needs_note=1&search=&page=&per_page= */
    public function index(Request $request): JsonResponse
    {
        $d = $request->validate(['status' => ['nullable', 'in:NOT_STARTED,ON_TRACK,DUE_SOON,OVERDUE,MET,MET_LATE,RUNNING'], 'needs_note' => ['nullable', 'boolean'], 'search' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'between:1,100']]);
        $rows = $this->rows($request->user(), $d['search'] ?? null);
        if (! empty($d['status'])) {
            $rows = $d['status'] === 'RUNNING' ? array_filter($rows, fn ($r) => in_array($r['status'], ['ON_TRACK', 'DUE_SOON', 'OVERDUE'], true)) : array_filter($rows, fn ($r) => $r['status'] === $d['status']);
        }
        if ($request->boolean('needs_note')) {
            $rows = array_filter($rows, fn ($r) => in_array($r['status'], ['OVERDUE', 'MET_LATE'], true) && $r['last_note'] === null);
        }
        $order = ['OVERDUE' => 0, 'DUE_SOON' => 1, 'ON_TRACK' => 2, 'NOT_STARTED' => 3, 'MET_LATE' => 4, 'MET' => 5];
        usort($rows, fn ($a, $b) => [$order[$a['status']], (string) $a['due_at']] <=> [$order[$b['status']], (string) $b['due_at']]);
        $per = (int) ($d['per_page'] ?? 25);
        $page = (int) ($d['page'] ?? 1);

        return response()->json(['data' => array_slice($rows, ($page - 1) * $per, $per), 'meta' => ['current_page' => $page, 'last_page' => max(1, (int) ceil(count($rows) / $per)), 'total' => count($rows)]]);
    }

    /** GET /service-sla/summary */
    public function summary(Request $request): JsonResponse
    {
        $counts = array_count_values(array_column($this->rows($request->user(), null), 'status'));

        return response()->json(['data' => ['overdue' => $counts['OVERDUE'] ?? 0, 'due_soon' => $counts['DUE_SOON'] ?? 0, 'on_track' => $counts['ON_TRACK'] ?? 0, 'not_started' => $counts['NOT_STARTED'] ?? 0,
            'met' => $counts['MET'] ?? 0, 'met_late' => $counts['MET_LATE'] ?? 0]]);
    }

    /** GET /applications/{id}/service-sla — `data` is null when the application has no service SLA (no extension category yet, cancelled). */
    public function show(Request $request, string $application): JsonResponse
    {
        $this->authorizeApplication($request->user(), 'tasks.view', $application, false);

        return response()->json(['data' => $this->sla->detail($application), 'can' => ['note' => $this->canNote($request->user(), $application)]]);
    }

    public function addNote(Request $request, string $application): JsonResponse
    {
        $this->authorizeApplication($request->user(), 'sla.note', $application, true);
        $d = Validator::make($request->all(), ['note' => ['required', 'string', 'max:1000']])->validate();
        $this->sla->addNote($application, $d['note'], $request->user());

        return response()->json(['data' => $this->sla->detail($application), 'message' => 'Keterangan disimpan.'], 201);
    }

    /** @return list<array<string,mixed>> */
    private function rows(User $user, ?string $search): array
    {
        $scope = $this->authorizer->authorizeScope($user, 'tasks.view');
        $apps = ServiceSlaService::candidates(DB::table('applications as a'))->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->whereIn('a.current_status', ['APPROVED', 'PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE', 'COMPLETED'])
            ->when(! $scope['unrestricted'], fn ($q) => $q->whereIn('a.organizational_unit_id', $scope['units']))
            ->when($search, fn ($q, $s) => $q->where(fn ($w) => $w->where('a.application_number', 'ilike', '%'.str_replace(['%', '_'], ['\%', '\_'], $s).'%')->orWhere('c.name', 'ilike', '%'.str_replace(['%', '_'], ['\%', '\_'], $s).'%')))
            ->get(['a.id', 'a.application_number', 'c.name as customer_name', 'u.code as unit_code', 'u.name as unit_name'])->keyBy('id');
        $computed = $this->sla->compute($apps->keys()->all());
        $notes = collect(array_chunk(array_keys($computed), 5000))
            ->flatMap(fn (array $part) => DB::table('application_sla_notes')->whereIn('application_id', $part)->selectRaw('distinct on (application_id) application_id, note, created_at')->orderBy('application_id')->orderByDesc('created_at')->get())
            ->keyBy('application_id');
        $out = [];
        foreach ($computed as $id => $row) {
            $a = $apps[$id];
            $n = $notes[$id] ?? null;
            $out[] = $row + ['application_number' => $a->application_number, 'customer_name' => $a->customer_name, 'unit_code' => $a->unit_code, 'unit_name' => $a->unit_name,
                'last_note' => $n === null ? null : ['note' => $n->note, 'created_at' => $n->created_at]];
        }

        return $out;
    }

    private function authorizeApplication(User $user, string $permission, string $application, bool $onUnit): object
    {
        $this->authorizer->authorizeScope($user, $permission);
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $scope = $this->authorizer->scopeFor($user, $permission);
        if (! $scope['unrestricted'] && ! in_array((string) $app->organizational_unit_id, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        if ($onUnit) {
            $this->authorizer->authorizeOnUnit($user, $permission, (string) $app->organizational_unit_id);
        }

        return $app;
    }

    private function canNote(User $user, string $application): bool
    {
        $scope = $this->authorizer->scopeFor($user, 'sla.note');
        $unit = (string) DB::table('applications')->where('id', $application)->value('organizational_unit_id');

        return $scope['unrestricted'] || in_array($unit, $scope['units'], true);
    }
}
