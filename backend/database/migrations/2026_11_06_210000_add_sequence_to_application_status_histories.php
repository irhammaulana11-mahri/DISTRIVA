<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// The status history is read in INSERTION order. changed_at alone cannot guarantee that (equal or out-of-order clocks), so every row gets a
// monotonic identity `seq`. Additive; the append-only trigger is not affected (DDL does not fire row triggers).
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql' && ! Schema::hasColumn('application_status_histories', 'seq')) {
            DB::statement('ALTER TABLE application_status_histories ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
            DB::statement('CREATE INDEX application_status_histories_app_seq_idx ON application_status_histories (application_id, seq)');
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql' && Schema::hasColumn('application_status_histories', 'seq')) {
            DB::statement('DROP INDEX IF EXISTS application_status_histories_app_seq_idx');
            DB::statement('ALTER TABLE application_status_histories DROP COLUMN seq');
        }
    }
};
