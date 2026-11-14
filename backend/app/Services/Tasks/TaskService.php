<?php

namespace App\Services\Tasks;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Notifications\InAppNotifier;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Application tasks (docs/24 §8): ASSIGNED -> ACCEPTED -> IN_PROGRESS -> SUBMITTED -> COMPLETED (reviewed by someone else than the assignee), or SUBMITTED -> IN_PROGRESS when returned,
 * CANCELLED from any open state. Every step is timestamped and recorded in `application_task_events`. The deadline follows the SLA of the task type in working days; a task is overdue
 * while the assignee still owes work (ASSIGNED/ACCEPTED/IN_PROGRESS) after the deadline. Rule violations are AssignmentRuleViolation (409); who may act is decided by the controller.
 */
class TaskService
{
    public const OPEN = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'];

    public const OWING = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

    public function __construct(private readonly BusinessCalendar $calendar, private readonly InAppNotifier $inbox, private readonly ServiceSlaService $service) {}

    public function create(string $applicationId, string $type, string $title, ?string $description, string $assigneeId, User $actor): string
    {
        $app = DB::table('applications')->where('id', $applicationId)->first() ?? throw new AssignmentRuleViolation('Permohonan tidak ditemukan.');
        if (in_array($app->current_status, ['COMPLETED', 'CANCELLED', 'REFUNDED'], true)) {
            throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; tugas baru tidak dapat dibuat.");
        }
        $sla = DB::table('sla_configurations')->where('task_type', $type)->where('kind', 'TASK')->first() ?? throw new AssignmentRuleViolation('Jenis tugas tidak dikenal.');
        if (trim($title) === '') {
            throw new AssignmentRuleViolation('Judul tugas wajib diisi.');
        }
        $this->requireAssignee($assigneeId, (string) $app->organizational_unit_id);
        $now = now();
        $days = $sla->is_active && $sla->working_days !== null ? (int) $sla->working_days : null;
        $id = (string) Str::uuid();
        $due = $days === null ? null : $this->calendar->dueAt($now, $days);
        $basis = 'TASK';
        // The stage work (survey, drawing, KKO, KKF, WO ...) must fit inside the running service SLA of the network extension: the task never ends after it (a task type without days of its own takes it).
        $tmp = $this->service->compute([$app->id])[$app->id] ?? null;
        if ($tmp !== null && $tmp['due_at'] !== null && in_array($tmp['status'], ['ON_TRACK', 'DUE_SOON', 'OVERDUE'], true)) {
            $tmpDue = CarbonImmutable::parse($tmp['due_at']);
            if ($due === null || $tmpDue->lt($due)) {
                $due = $tmpDue;
                $basis = 'TMP';
            }
        }
        DB::transaction(function () use ($id, $app, $type, $title, $description, $assigneeId, $actor, $now, $days, $due, $basis): void {
            DB::table('application_tasks')->insert(['id' => $id, 'application_id' => $app->id, 'task_type' => $type, 'title' => trim($title), 'description' => $description === null ? null : trim($description),
                'status' => 'ASSIGNED', 'assignee_id' => $assigneeId, 'assigned_by' => $actor->getKey(), 'sla_working_days' => $days, 'due_at' => $due, 'due_basis' => $basis,
                'assigned_at' => $now, 'created_at' => $now, 'updated_at' => $now]);
            $this->event($id, 'ASSIGNED', $actor, null);
        });

        return $id;
    }

    public function accept(string $id, User $actor): void
    {
        $this->step($id, ['ASSIGNED'], 'ACCEPTED', 'ACCEPTED', $actor, null, assignee: true, set: ['accepted_at' => now()]);
    }

    public function start(string $id, User $actor): void
    {
        $this->step($id, ['ASSIGNED', 'ACCEPTED'], 'IN_PROGRESS', 'STARTED', $actor, null, assignee: true, set: ['started_at' => now()], fillAccepted: true);
    }

    public function submit(string $id, ?string $note, User $actor): void
    {
        $this->step($id, ['IN_PROGRESS'], 'SUBMITTED', 'SUBMITTED', $actor, $note, assignee: true, set: ['submitted_at' => now()]);
    }

    public function complete(string $id, ?string $note, User $actor): void
    {
        $this->step($id, ['SUBMITTED'], 'COMPLETED', 'COMPLETED', $actor, $note, reviewer: true, set: ['completed_at' => now(), 'reviewed_by' => $actor->getKey(), 'review_note' => $note]);
    }

    public function returnForRevision(string $id, string $reason, User $actor): void
    {
        $this->requireText($reason, 'Pengembalian wajib disertai alasan.');
        $this->step($id, ['SUBMITTED'], 'IN_PROGRESS', 'RETURNED', $actor, $reason, reviewer: true, set: ['submitted_at' => null, 'reviewed_by' => $actor->getKey(), 'review_note' => trim($reason)]);
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        $this->requireText($reason, 'Pembatalan wajib disertai alasan.');
        $this->step($id, self::OPEN, 'CANCELLED', 'CANCELLED', $actor, $reason, set: ['cancelled_at' => now()]);
    }

    public function reassign(string $id, string $assigneeId, User $actor): void
    {
        DB::transaction(function () use ($id, $assigneeId, $actor): void {
            $t = $this->lock($id);
            $this->requireOpen($t, self::OPEN);
            $this->requireAssignee($assigneeId, $this->unitOf($t));
            if ($assigneeId === $t->assignee_id) {
                throw new AssignmentRuleViolation('Tugas sudah dipegang oleh orang tersebut.');
            }
            DB::table('application_tasks')->where('id', $id)->update(['assignee_id' => $assigneeId, 'status' => 'ASSIGNED', 'accepted_at' => null, 'started_at' => null, 'submitted_at' => null,
                'due_soon_notified_at' => null, 'overdue_notified_at' => null, 'updated_at' => now()]);
            $this->event($id, 'REASSIGNED', $actor, DB::table('users')->where('id', $assigneeId)->value('name'));
        });
    }

    /** Is the task past its deadline while the assignee still owes work? */
    public function isOverdue(object $task, ?DateTimeInterface $now = null): bool
    {
        return $task->due_at !== null && in_array($task->status, self::OWING, true) && strtotime((string) $task->due_at) < ($now ?? now())->getTimestamp();
    }

    /** Is the deadline within the reminder window (and not yet passed)? */
    public function isDueSoon(object $task, ?DateTimeInterface $now = null): bool
    {
        if ($task->due_at === null || ! in_array($task->status, self::OWING, true) || $this->isOverdue($task, $now)) {
            return false;
        }

        return $this->calendar->workingDaysLeft(CarbonImmutable::parse($task->due_at), $now === null ? null : CarbonImmutable::instance($now)) <= (int) config('distriva.tasks.due_soon_days');
    }

    /** @return list<string> the users told when a task is late or about to be: its assignee and whoever assigned it */
    public function recipients(object $task): array
    {
        return array_values(array_unique([(string) $task->assignee_id, (string) $task->assigned_by]));
    }

    /**
     * @param  list<string>  $from
     * @param  array<string,mixed>  $set
     */
    private function step(string $id, array $from, string $to, string $event, User $actor, ?string $note, bool $assignee = false, bool $reviewer = false, array $set = [], bool $fillAccepted = false): void
    {
        DB::transaction(function () use ($id, $from, $to, $event, $actor, $note, $assignee, $reviewer, $set, $fillAccepted): void {
            $t = $this->lock($id);
            $this->requireOpen($t, $from);
            if ($assignee && $t->assignee_id !== (string) $actor->getKey()) {
                throw new AssignmentRuleViolation('Hanya penerima tugas yang dapat melakukan langkah ini.');
            }
            if ($reviewer && $t->assignee_id === (string) $actor->getKey()) {
                throw new AssignmentRuleViolation('Penerima tugas tidak dapat memeriksa tugasnya sendiri.');
            }
            if ($fillAccepted && $t->accepted_at === null) {
                $set['accepted_at'] = now();
            }
            DB::table('application_tasks')->where('id', $id)->update($set + ['status' => $to, 'updated_at' => now()]);
            $this->event($id, $event, $actor, $note === null ? null : trim($note));
        });
    }

    private function lock(string $id): object
    {
        return DB::table('application_tasks')->where('id', $id)->lockForUpdate()->first() ?? throw new AssignmentRuleViolation('Tugas tidak ditemukan.');
    }

    /** @param list<string> $from */
    private function requireOpen(object $task, array $from): void
    {
        if (! in_array($task->status, $from, true)) {
            throw new AssignmentRuleViolation("Tugas berstatus {$task->status}; langkah ini hanya untuk status ".implode(' / ', $from).'.');
        }
    }

    private function requireText(string $text, string $message): void
    {
        if (trim($text) === '') {
            throw new AssignmentRuleViolation($message);
        }
    }

    private function requireAssignee(string $userId, string $unitId): void
    {
        if (! in_array($userId, $this->inbox->holdersOf('tasks.view', $unitId), true)) {
            throw new AssignmentRuleViolation('Penerima tugas harus pengguna aktif yang bertugas pada ULP permohonan ini (atau UP3 induknya).');
        }
    }

    private function unitOf(object $task): string
    {
        return (string) DB::table('applications')->where('id', $task->application_id)->value('organizational_unit_id');
    }

    private function event(string $taskId, string $type, ?User $actor, ?string $note): void
    {
        DB::table('application_task_events')->insert(['id' => (string) Str::uuid(), 'task_id' => $taskId, 'event_type' => $type, 'actor_id' => $actor?->getKey(), 'note' => $note, 'occurred_at' => now()]);
    }
}
