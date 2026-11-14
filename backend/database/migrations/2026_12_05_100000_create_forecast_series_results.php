<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Monthly demand forecasts (docs/11; owner Nov 2026: deep learning only): new customers, added contracted power (kVA) and material consumption per ULP, 12 months ahead with a p10/p50/p90 range.
 * A run with too little history ends as INSUFFICIENT (with the coverage of the data and what is missing) instead of producing numbers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forecast_series_results', function (Blueprint $table) {
            $table->foreignUuid('run_id')->constrained('forecast_runs')->cascadeOnDelete();
            $table->string('series_id', 120);
            $table->string('kind', 20);                                        // CUSTOMERS_ADDED | VA_ADDED | MATERIAL_ISSUE
            $table->foreignUuid('unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('item_code', 40)->nullable();
            $table->string('item_label', 255)->nullable();
            $table->unsignedSmallInteger('history_months');
            $table->decimal('last_12_months', 18, 3);                          // the actual total of the last 12 months, for comparison
            $table->jsonb('months');                                           // [{month, p10, p50, p90}] x 12
            foreach ([3, 6, 12] as $n) {
                foreach (['p10', 'p50', 'p90'] as $q) {
                    $table->decimal("t{$n}_{$q}", 18, 3);                       // sum over the next n months (the range is the sum of the monthly ranges: wide on purpose)
                }
            }
            $table->primary(['run_id', 'series_id']);
            $table->index(['run_id', 'kind', 'unit_id']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE forecast_runs DROP CONSTRAINT forecast_runs_status_check');
            DB::statement('ALTER TABLE forecast_runs ALTER COLUMN status TYPE varchar(20)');
            DB::statement("ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_status_check CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','INSUFFICIENT'))");
            DB::statement("ALTER TABLE forecast_series_results ADD CONSTRAINT forecast_series_results_kind_check CHECK (kind IN ('CUSTOMERS_ADDED','VA_ADDED','MATERIAL_ISSUE'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('forecast_series_results');
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::table('forecast_runs')->where('status', 'INSUFFICIENT')->update(['status' => 'FAILED']);
            DB::statement('ALTER TABLE forecast_runs DROP CONSTRAINT forecast_runs_status_check');
            DB::statement("ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_status_check CHECK (status IN ('RUNNING','SUCCEEDED','FAILED'))");
        }
    }
};
