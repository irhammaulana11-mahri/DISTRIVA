<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Notifications\InAppNotifier;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Tasks\TaskService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Application tasks and internal SLA (docs/24 §8). Reading follows `tasks.view` (the unit scope; the assignee always sees the task of an application in the scope of their grant),
 * assigning/reviewing/cancelling follows `tasks.assign` on the ULP of the application (outside it: 404), the assignee's own steps need only to be the assignee.
 * The SLA (working days per task type) and the holidays are edited with `sla.manage` (administrator).
 */
class TaskController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly CatalogAuthorizer $catalog, private readonly TaskService $tasks, private readonly WorkflowNotifier $flow, private readonly InAppNotifier $inbox) {}

    /** GET /tasks?mine=1&status=&task_type=&overdue=1&application_id=&per_page= */
    public function index(Request $request): JsonResponse
    {
        $d = $request->validate(['mine' => ['nullable', 'boolean'], 'status' => ['nullable', 'in:'.implode(',', [...TaskService::OPEN, 'COMPLETED', 'CANCELLED', 'OPEN'])], 'task_type' => ['nullable', 'string', 'max:30'],
            'overdue' => ['nullable', 'boolean'], 'application_id' => ['nullable', 'uuid'], 'per_page' => ['nullable', 'integer', 'between:1,100']]);
        $q = $this->base($request->user());
        if ($request->boolean('mine')) {
            $q->where('t.assignee_id', $request->user()->getKey());
        }
        if (! empty($d['status'])) {
            $d['status'] === 'OPEN' ? $q->whereIn('t.status', TaskService::OPEN) : $q->where('t.status', $d['status']);
        }
        if (! empty($d['task_type'])) {
            $q->where('t.task_type', $d['task_type']);
        }
        if (! empty($d['application_id'])) {
            $q->where('t.application_id', $d['application_id']);
        }
        if ($request->boolean('overdue')) {
            $q->whereIn('t.status', TaskService::OWING)->whereNotNull('t.due_at')->where('t.due_at', '<', now());
        }
        $page = $q->orderByRaw("case when t.status in ('COMPLETED','CANCELLED') then 1 else 0 end")->orderByRaw('t.due_at asc nulls last')->orderByDesc('t.assigned_at')
            ->paginate((int) ($d['per_page'] ?? 25), $this->columns());

        return response()->json(['data' => $page->getCollection()->map(fn ($t) => $this->present($t))->all(), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    /** GET /tasks/summary — numbers for the badge and the dashboard card. */
    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();
        $scope = $this->base($user);
        $mine = (clone $scope)->where('t.assignee_id', $user->getKey())->whereIn('t.status', TaskService::OWING);
        $now = now();
        $unit = (clone $scope)->whereIn('t.status', TaskService::OWING)->whereNotNull('t.due_at')->where('t.due_at', '<', $now);

        return response()->json(['data' => [
            'mine_open' => (clone $mine)->count(),
            'mine_overdue' => (clone $mine)->whereNotNull('t.due_at')->where('t.due_at', '<', $now)->count(),
            'awaiting_my_review' => $this->canAssign($user) ? (clone $scope)->where('t.status', 'SUBMITTED')->where('t.assigned_by', $user->getKey())->count() : 0,
            'unit_overdue' => $unit->count(),
        ]]);
    }

    public function show(Request $request, string $task): JsonResponse
    {
        $row = $this->find($request->user(), $task);
        $events = DB::table('application_task_events as e')->leftJoin('users as u', 'u.id', '=', 'e.actor_id')->where('e.task_id', $task)->orderBy('e.seq')->get(['e.event_type', 'e.note', 'e.occurred_at', 'u.name as actor_name']);

        return response()->json(['data' => $this->present($row) + ['events' => $events->all()]]);
    }

    public function forApplication(Request $request, string $application): JsonResponse
    {
        $this->authorizeApplication($request->user(), 'tasks.view', $application);
        $rows = $this->base($request->user())->where('t.application_id', $application)->orderByDesc('t.assigned_at')->get($this->columns());

        return response()->json(['data' => $rows->map(fn ($t) => $this->present($t))->all()]);
    }

    /** GET /applications/{id}/tasks/assignees — who can be given a task on this application. */
    public function assignees(Request $request, string $application): JsonResponse
    {
        $app = $this->authorizeApplication($request->user(), 'tasks.assign', $application);
        $ids = $this->inbox->holdersOf('tasks.view', (string) $app->organizational_unit_id);
        $users = DB::table('users')->whereIn('id', $ids)->orderBy('name')->get(['id', 'name', 'email']);

        return response()->json(['data' => $users->all()]);
    }

    public function store(Request $request, string $application): JsonResponse
    {
        $this->authorizeApplication($request->user(), 'tasks.assign', $application);
        $d = Validator::make($request->all(), ['task_type' => ['required', 'string', 'max:30'], 'title' => ['required', 'string', 'max:200'], 'description' => ['nullable', 'string', 'max:2000'], 'assignee_id' => ['required', 'uuid']])->validate();
        $id = $this->tasks->create($application, $d['task_type'], $d['title'], $d['description'] ?? null, $d['assignee_id'], $request->user());
        $this->flow->taskAssigned($id, $request->user());

        return response()->json(['data' => $this->present($this->find($request->user(), $id)), 'message' => 'Tugas dibuat.'], 201);
    }

    public function accept(Request $request, string $task): JsonResponse
    {
        $this->find($request->user(), $task);
        $this->tasks->accept($task, $request->user());

        return $this->respond($request, $task, 'Tugas diterima.');
    }

    public function start(Request $request, string $task): JsonResponse
    {
        $this->find($request->user(), $task);
        $this->tasks->start($task, $request->user());

        return $this->respond($request, $task, 'Tugas dimulai.');
    }

    public function submit(Request $request, string $task): JsonResponse
    {
        $this->find($request->user(), $task);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $this->tasks->submit($task, $d['note'] ?? null, $request->user());
        $this->flow->taskStep($task, 'SUBMITTED', $request->user());

        return $this->respond($request, $task, 'Tugas diajukan untuk diperiksa.');
    }

    public function complete(Request $request, string $task): JsonResponse
    {
        $this->authorizeTask($request->user(), $task);
        $d = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $this->tasks->complete($task, $d['note'] ?? null, $request->user());
        $this->flow->taskStep($task, 'COMPLETED', $request->user());

        return $this->respond($request, $task, 'Tugas diterima.');
    }

    public function returnBack(Request $request, string $task): JsonResponse
    {
        $this->authorizeTask($request->user(), $task);
        $d = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->tasks->returnForRevision($task, $d['reason'], $request->user());
        $this->flow->taskStep($task, 'RETURNED', $request->user());

        return $this->respond($request, $task, 'Tugas dikembalikan untuk diperbaiki.');
    }

    public function cancel(Request $request, string $task): JsonResponse
    {
        $this->authorizeTask($request->user(), $task);
        $d = $request->validate(['reason' => ['required', 'string', 'max:1000']]);
        $this->tasks->cancel($task, $d['reason'], $request->user());
        $this->flow->taskStep($task, 'CANCELLED', $request->user());

        return $this->respond($request, $task, 'Tugas dibatalkan.');
    }

    public function reassign(Request $request, string $task): JsonResponse
    {
        $this->authorizeTask($request->user(), $task);
        $d = $request->validate(['assignee_id' => ['required', 'uuid']]);
        $this->tasks->reassign($task, $d['assignee_id'], $request->user());
        $this->flow->taskAssigned($task, $request->user());

        return $this->respond($request, $task, 'Tugas dialihkan.');
    }

    // ---- SLA and holidays ---------------------------------------------------------------------------------

    public function slaIndex(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'tasks.view');

        return response()->json(['data' => DB::table('sla_configurations')->orderBy('task_type')->get(['task_type', 'label', 'kind', 'working_days', 'is_active', 'updated_at'])->all(),
            'can' => ['manage' => $this->catalog->allows($request->user(), 'sla.manage'), 'assign' => $this->canAssign($request->user())]]);
    }

    public function slaUpdate(Request $request, string $type): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'sla.manage');
        $d = Validator::make($request->all(), ['working_days' => ['present', 'nullable', 'integer', 'between:1,365'], 'is_active' => ['required', 'boolean']])->validate();
        if (DB::table('sla_configurations')->where('task_type', $type)->update(['working_days' => $d['working_days'], 'is_active' => $d['is_active'], 'updated_by' => $request->user()->getKey(), 'updated_at' => now()]) === 0) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return response()->json(['data' => DB::table('sla_configurations')->where('task_type', $type)->first(), 'message' => 'SLA disimpan. Berlaku untuk tugas yang dibuat setelahnya.']);
    }

    public function holidays(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'tasks.view');
        $d = $request->validate(['year' => ['nullable', 'integer', 'between:2020,2100']]);

        return response()->json(['data' => DB::table('business_holidays')->when($d['year'] ?? null, fn ($q, $y) => $q->whereYear('holiday_date', $y))->orderBy('holiday_date')->get(['holiday_date', 'name'])->all()]);
    }

    public function addHoliday(Request $request): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'sla.manage');
        $d = Validator::make($request->all(), ['holiday_date' => ['required', 'date_format:Y-m-d'], 'name' => ['required', 'string', 'max:150']])->validate();
        if (DB::table('business_holidays')->where('holiday_date', $d['holiday_date'])->exists()) {
            throw new AssignmentRuleViolation('Tanggal tersebut sudah tercatat sebagai hari libur.');
        }
        DB::table('business_holidays')->insert(['holiday_date' => $d['holiday_date'], 'name' => trim($d['name']), 'created_by' => $request->user()->getKey(), 'created_at' => now()]);

        return response()->json(['data' => ['holiday_date' => $d['holiday_date'], 'name' => trim($d['name'])], 'message' => 'Hari libur ditambahkan.'], 201);
    }

    public function removeHoliday(Request $request, string $date): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'sla.manage');
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || DB::table('business_holidays')->where('holiday_date', $date)->delete() === 0) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return response()->json(['message' => 'Hari libur dihapus.']);
    }

    // ---- helpers ------------------------------------------------------------------------------------------

    /** The tasks the user may see: those of applications in the unit scope of `tasks.view`. */
    private function base(User $user)
    {
        $scope = $this->authorizer->authorizeScope($user, 'tasks.view');

        return DB::table('application_tasks as t')->join('applications as a', 'a.id', '=', 't.application_id')
            ->join('users as au', 'au.id', '=', 't.assignee_id')->join('users as bu', 'bu.id', '=', 't.assigned_by')->join('sla_configurations as s', 's.task_type', '=', 't.task_type')
            ->when(! $scope['unrestricted'], fn ($q) => $q->whereIn('a.organizational_unit_id', $scope['units']));
    }

    /** @return list<string> */
    private function columns(): array
    {
        return ['t.*', 'a.application_number', 'a.organizational_unit_id', 'au.name as assignee_name', 'bu.name as assigned_by_name', 's.label as type_label'];
    }

    private function find(User $user, string $task): object
    {
        return $this->base($user)->where('t.id', $task)->first($this->columns()) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** Assign/review/cancel: the grant on the ULP of the task's application. */
    private function authorizeTask(User $user, string $task): object
    {
        $row = $this->find($user, $task);
        $this->authorizer->authorizeOnUnit($user, 'tasks.assign', (string) $row->organizational_unit_id);

        return $row;
    }

    private function authorizeApplication(User $user, string $permission, string $application): object
    {
        $this->authorizer->authorizeScope($user, $permission);
        $app = DB::table('applications')->where('id', $application)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->authorizer->authorizeOnUnit($user, $permission, (string) $app->organizational_unit_id);

        return $app;
    }

    private function canAssign(User $user): bool
    {
        $scope = $this->authorizer->scopeFor($user, 'tasks.assign');

        return $scope['unrestricted'] || $scope['units'] !== [];
    }

    private function respond(Request $request, string $task, string $message): JsonResponse
    {
        return response()->json(['data' => $this->present($this->find($request->user(), $task)), 'message' => $message]);
    }

    /** @return array<string,mixed> */
    private function present(object $t): array
    {
        return ['id' => $t->id, 'application_id' => $t->application_id, 'application_number' => $t->application_number, 'task_type' => $t->task_type, 'type_label' => $t->type_label, 'title' => $t->title,
            'description' => $t->description, 'status' => $t->status, 'assignee_id' => $t->assignee_id, 'assignee_name' => $t->assignee_name, 'assigned_by' => $t->assigned_by, 'assigned_by_name' => $t->assigned_by_name,
            'sla_working_days' => $t->sla_working_days, 'due_at' => $t->due_at, 'is_overdue' => $this->tasks->isOverdue($t), 'is_due_soon' => $this->tasks->isDueSoon($t),
            'met_deadline' => $t->due_at !== null && $t->submitted_at !== null ? strtotime((string) $t->submitted_at) <= strtotime((string) $t->due_at) : null,
            'assigned_at' => $t->assigned_at, 'accepted_at' => $t->accepted_at, 'started_at' => $t->started_at, 'submitted_at' => $t->submitted_at, 'completed_at' => $t->completed_at, 'cancelled_at' => $t->cancelled_at,
            'review_note' => $t->review_note];
    }
}
