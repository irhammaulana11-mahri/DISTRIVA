<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Service SLA of an application whose MTO has no network extension (only APP / SR): 4 working days from payment (owner, Nov 2026).
 * Additive and idempotent: a database built after this change already has the row from the first service-SLA migration (it reads the config).
 */
return new class extends Migration
{
    public function up(): void
    {
        $def = config('distriva.service_sla.categories.LAYANAN_TANPA_PERLUASAN');
        if (DB::table('sla_configurations')->where('task_type', 'LAYANAN_TANPA_PERLUASAN')->doesntExist()) {
            DB::table('sla_configurations')->insert(['task_type' => 'LAYANAN_TANPA_PERLUASAN', 'label' => $def['label'], 'working_days' => $def['days'], 'is_active' => true, 'kind' => 'SERVICE', 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('sla_configurations')->where('task_type', 'LAYANAN_TANPA_PERLUASAN')->delete();
    }
};
