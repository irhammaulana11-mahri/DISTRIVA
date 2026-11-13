<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** created_at has second precision, so changes within one second tie: an identity column gives the history a strict order (newest = highest seq). */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE distribution_feeder_changes ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY');
        DB::statement('CREATE INDEX distribution_feeder_changes_feeder_seq_index ON distribution_feeder_changes (feeder_id, seq)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS distribution_feeder_changes_feeder_seq_index');
        DB::statement('ALTER TABLE distribution_feeder_changes DROP COLUMN seq');
    }
};
