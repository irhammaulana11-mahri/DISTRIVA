<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** History of corrections of the gardu master (owner 2026-11-13): who changed what and why, append-only; `seq` gives a strict order (created_at has second precision). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('substation_changes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('substation_id')->constrained('substations')->restrictOnDelete();
            $table->foreignUuid('changed_by')->nullable()->constrained('users');
            $table->string('action', 12)->default('UPDATED');
            $table->text('reason');
            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();
            $table->timestampTz('created_at');
            $table->index('substation_id');
        });
        DB::statement('ALTER TABLE substation_changes ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
        DB::statement('CREATE INDEX substation_changes_substation_seq_index ON substation_changes (substation_id, seq)');
        DB::unprepared('CREATE TRIGGER trg_substation_changes_append_only BEFORE UPDATE OR DELETE ON substation_changes FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_substation_changes_no_truncate BEFORE TRUNCATE ON substation_changes FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS trg_substation_changes_no_truncate ON substation_changes');
        Schema::dropIfExists('substation_changes');
    }
};
