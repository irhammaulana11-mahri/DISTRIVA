<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Service SLA of network extension (owner, Nov 2026): 14 working days for LV poles only (JTR), 24 for MV line / transformer (JTM, trafo), 100 for a cubicle (kubikel), counted from the payment date.
 * The days live in `sla_configurations` (kind SERVICE, editable); the category of an application follows its MTO. `applications.paid_at` keeps the EIS payment date (TGLBAYAR, filled by the EIS import).
 * `application_sla_notes` = explanations of a delay (append-only); `application_sla_alerts` = the one "overdue" announcement per application.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('applications', function (Blueprint $table) {
            $table->date('paid_at')->nullable();
        });
        Schema::table('sla_configurations', function (Blueprint $table) {
            $table->string('kind', 10)->default('TASK');
        });
        Schema::create('application_sla_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->text('note');
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->index(['application_id', 'created_at']);
        });
        Schema::create('application_sla_alerts', function (Blueprint $table) {
            $table->foreignUuid('application_id')->primary()->constrained('applications')->restrictOnDelete();
            $table->timestampTz('notified_at');
        });
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE sla_configurations ADD CONSTRAINT sla_configurations_kind_check CHECK (kind IN ('TASK','SERVICE'))");
        }
        foreach ((array) config('distriva.service_sla.categories') as $type => $def) {
            DB::table('sla_configurations')->insert(['task_type' => $type, 'label' => $def['label'], 'working_days' => $def['days'], 'is_active' => true, 'kind' => 'SERVICE', 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('application_sla_alerts');
        Schema::dropIfExists('application_sla_notes');
        DB::table('sla_configurations')->where('kind', 'SERVICE')->delete();
        Schema::table('sla_configurations', function (Blueprint $table) {
            $table->dropColumn('kind');
        });
        Schema::table('applications', function (Blueprint $table) {
            $table->dropColumn('paid_at');
        });
    }
};
