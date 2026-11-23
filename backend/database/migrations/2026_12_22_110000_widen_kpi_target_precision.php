<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Target kumulatif disimpan sebagai double precision agar pencapaian dan nilai (termasuk TRUNC pada kelompok) identik dengan workbook (docs/90). */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table kpi_targets alter column target_value type double precision');
    }

    public function down(): void
    {
        DB::statement('alter table kpi_targets alter column target_value type numeric(20,6)');
    }
};
