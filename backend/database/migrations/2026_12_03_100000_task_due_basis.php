<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** `application_tasks.due_basis`: TASK = the deadline of the task type's own SLA, TMP = capped by (or taken from) the running service SLA of the network extension (14/24/100 working days). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_tasks', function (Blueprint $table) {
            $table->string('due_basis', 5)->default('TASK');
        });
    }

    public function down(): void
    {
        Schema::table('application_tasks', function (Blueprint $table) {
            $table->dropColumn('due_basis');
        });
    }
};
