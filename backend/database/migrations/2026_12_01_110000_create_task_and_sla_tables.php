<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tasks and internal SLA of applications (docs/24 §8; owner scope Nov 2026): a manager assigns a task of a given type to one person, the person accepts, starts and submits it,
 * the assigner reviews it; the deadline is counted in working days (weekends and `business_holidays` skipped) from the SLA of the task type, snapshotted on the task.
 * No pause/resume (no SOP yet): the events record when a task was returned for revision. `sla_configurations.working_days` NULL = the type has no deadline.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_holidays', function (Blueprint $table) {
            $table->date('holiday_date')->primary();
            $table->string('name', 150);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->nullable();
        });

        Schema::create('sla_configurations', function (Blueprint $table) {
            $table->string('task_type', 30)->primary();
            $table->string('label', 100);
            $table->unsignedSmallInteger('working_days')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });

        Schema::create('application_tasks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('task_type', 30);
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('status', 20)->default('ASSIGNED');
            $table->foreignUuid('assignee_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('assigned_by')->constrained('users')->restrictOnDelete();
            $table->unsignedSmallInteger('sla_working_days')->nullable();      // snapshot of the SLA when the task was assigned (null = none)
            $table->timestampTz('due_at')->nullable();
            $table->timestampTz('assigned_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('review_note')->nullable();
            $table->timestampTz('due_soon_notified_at')->nullable();
            $table->timestampTz('overdue_notified_at')->nullable();
            $table->timestampsTz();
            $table->index(['assignee_id', 'status']);
            $table->index(['application_id', 'status']);
            $table->index(['status', 'due_at']);
        });

        Schema::create('application_task_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('task_id')->constrained('application_tasks')->restrictOnDelete();
            $table->string('event_type', 30);
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('note')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['task_id', 'occurred_at']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE application_tasks ADD CONSTRAINT application_tasks_status_check CHECK (status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS','SUBMITTED','COMPLETED','CANCELLED'))");
            DB::statement('ALTER TABLE application_task_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');         // order of events inside the same second
            DB::statement('ALTER TABLE application_tasks ADD CONSTRAINT application_tasks_days_check CHECK (sla_working_days IS NULL OR sla_working_days > 0)');
            DB::statement('ALTER TABLE sla_configurations ADD CONSTRAINT sla_configurations_days_check CHECK (working_days IS NULL OR working_days BETWEEN 1 AND 365)');
        }

        // The only duration the owner documents so far is the survey (the SLA report flags a survey older than 3 days); the other types start without a deadline until set.
        foreach ((array) config('distriva.tasks.types') as $type => $def) {
            DB::table('sla_configurations')->insert(['task_type' => $type, 'label' => $def['label'], 'working_days' => $def['default_days'], 'is_active' => true, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('application_task_events');
        Schema::dropIfExists('application_tasks');
        Schema::dropIfExists('sla_configurations');
        Schema::dropIfExists('business_holidays');
    }
};
