<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Runs of the DIL sync started from Master Pelanggan: the files found in the inbox folder are loaded by a detached process; progress and the result per file are kept here. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dil_sync_runs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('status', 12);                         // QUEUED, RUNNING, OK, PARTIAL, FAILED
            $table->jsonb('files');                               // [{name, size}] at the moment of the start
            $table->jsonb('results')->nullable();                 // per file: status, rows, counts, message
            $table->string('current_file', 255)->nullable();
            $table->unsignedBigInteger('rows_done')->default(0);
            $table->string('message', 500)->nullable();
            $table->foreignUuid('started_by')->constrained('users');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
        });
        DB::statement("alter table dil_sync_runs add constraint dil_sync_runs_status_check check (status in ('QUEUED','RUNNING','OK','PARTIAL','FAILED'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('dil_sync_runs');
    }
};
