<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Owner 2026-11-17 (docs/83): a reading keeps its TIME of day (not only the date) and the transformer capacity AT THE TIME of the measurement - the capacity of a gardu changes over the years (transformer management),
// so the loading of an old reading must not be judged against today's capacity. Several readings of one gardu on one day are possible when their times differ.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('substation_readings', function ($table) {
            $table->timestampTz('measured_at')->nullable();
            $table->decimal('capacity_kva', 10, 2)->nullable();
        });
        DB::statement('ALTER TABLE substation_readings DROP CONSTRAINT substation_readings_substation_id_measured_on_source_unique');
        DB::statement('CREATE UNIQUE INDEX substation_readings_day_unique ON substation_readings (substation_id, measured_on, source) WHERE measured_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX substation_readings_time_unique ON substation_readings (substation_id, source, measured_at) WHERE measured_at IS NOT NULL');
        DB::statement('ALTER TABLE substation_readings ADD CONSTRAINT substation_readings_capacity_check CHECK (capacity_kva IS NULL OR capacity_kva > 0)');
    }

    public function down(): void
    {
        // not reversible once readings with a time exist
    }
};
