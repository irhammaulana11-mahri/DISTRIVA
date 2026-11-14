<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A manual MIMS pull (stock, issues, receipts) running in a detached process: the dialog starts it and watches the results per warehouse (docs/82 §19.15). The token is never stored here. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mims_pull_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('status', 10);                              // QUEUED | RUNNING | OK | FAILED
            $table->jsonb('options');                                  // sync_stock, sync_issues, sync_receipts, dry_run, date, warehouse_ids, use_saved_token
            $table->jsonb('results')->default('[]');                   // one entry per warehouse, filled as it goes
            $table->unsignedSmallInteger('warehouses_total')->default(0);
            $table->string('message', 1000)->nullable();
            $table->foreignUuid('started_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->timestampTz('finished_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mims_pull_runs');
    }
};
