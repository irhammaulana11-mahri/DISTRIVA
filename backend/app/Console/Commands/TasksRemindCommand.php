<?php

namespace App\Console\Commands;

use App\Services\Notifications\WorkflowNotifier;
use App\Services\Tasks\TaskService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Hourly: tells the assignee and the assigner once when a task is about to be due and once when it is overdue (the flags keep it from repeating). */
class TasksRemindCommand extends Command
{
    protected $signature = 'distriva:tasks-remind';

    protected $description = 'Mengirim pengingat tugas yang segera jatuh tempo atau melewati tenggat (sekali per kejadian).';

    public function handle(TaskService $tasks, WorkflowNotifier $flow): int
    {
        $soon = 0;
        $late = 0;
        foreach (DB::table('application_tasks')->whereIn('status', TaskService::OWING)->whereNotNull('due_at')->get() as $t) {
            if ($tasks->isOverdue($t)) {
                if ($t->overdue_notified_at === null) {
                    $flow->taskDeadline($t->id, 'overdue');
                    DB::table('application_tasks')->where('id', $t->id)->update(['overdue_notified_at' => now()]);
                    $late++;
                }
            } elseif ($t->due_soon_notified_at === null && $tasks->isDueSoon($t)) {
                $flow->taskDeadline($t->id, 'due_soon');
                DB::table('application_tasks')->where('id', $t->id)->update(['due_soon_notified_at' => now()]);
                $soon++;
            }
        }
        $this->info("Pengingat tugas: {$soon} segera jatuh tempo, {$late} terlambat.");

        return self::SUCCESS;
    }
}
