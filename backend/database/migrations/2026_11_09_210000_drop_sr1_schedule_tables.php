<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The SR-APP 1 phase schedule (docs/62 §23) is replaced by the BOM group SR1PH (docs/62 §52, owner 2026-11-09: "SR 1 fasa masuk ke BOM, jangan dipisah ke tabel/menu tersendiri").
 * The tables were empty after the clean rebuild of that day; down() restores the empty structure only (the data would come from a backup).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('sr1_schedule_events');
        Schema::dropIfExists('sr1_schedule_lines');
        Schema::dropIfExists('sr1_schedules');
    }

    public function down(): void
    {
        // intentionally not recreated: the module no longer exists in the code; restore from a backup taken before this migration if ever needed
        DB::statement('SELECT 1');
    }
};
