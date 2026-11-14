<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Forecast runs (docs/11 section 8; owner Nov 2026: deep learning only). A run stores the model, training window, data cutoff, parameters, evaluation metrics, assumptions and the review
 * status; `forecast_gardu_results` holds the forecast load of every substation (as a ratio of its capacity: p10 / p50 / p90 at 1, 3 and 5 years) and when it is expected to pass 80 % / 100 %.
 * A forecast is a recommendation: a planner reviews it (review_status) before anyone relies on it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forecast_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('kind', 20)->default('GARDU_LOAD');
            $table->string('status', 10)->default('RUNNING');                 // RUNNING | SUCCEEDED | FAILED
            $table->foreignUuid('started_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at')->nullable();
            $table->date('data_cutoff')->nullable();                           // the latest reading used
            $table->jsonb('model')->nullable();                                // name, version, framework, seeds, epochs, target, quantiles, range scale
            $table->jsonb('data_window')->nullable();                          // first/last reading, training/validation/test boundaries
            $table->jsonb('counts')->nullable();
            $table->jsonb('metrics')->nullable();                              // MAE, WAPE, bias, coverage, overload recall, per horizon, with the persistence yardstick
            $table->text('assumptions')->nullable();
            $table->text('error')->nullable();
            $table->string('review_status', 10)->default('DRAFT');             // DRAFT | REVIEWED
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('reviewed_at')->nullable();
            $table->text('review_note')->nullable();
            $table->timestampsTz();
            $table->index(['kind', 'started_at']);
        });

        Schema::create('forecast_gardu_results', function (Blueprint $table) {
            $table->foreignUuid('run_id')->constrained('forecast_runs')->cascadeOnDelete();
            $table->foreignUuid('substation_id')->constrained('substations')->restrictOnDelete();
            $table->foreignUuid('unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->decimal('capacity_kva', 12, 3);
            $table->date('last_reading_on');
            $table->decimal('last_ratio', 8, 4);
            $table->unsignedSmallInteger('history_readings');
            $table->boolean('stale')->default(false);                          // last reading older than 3 years
            foreach ([1, 3, 5] as $y) {
                foreach (['p10', 'p50', 'p90'] as $q) {
                    $table->decimal("h{$y}_{$q}", 8, 4);
                }
            }
            $table->string('exceed80_state', 10);                               // already | forecast | none
            $table->date('exceed80_on')->nullable();
            $table->string('exceed100_state', 10);
            $table->date('exceed100_on')->nullable();
            $table->primary(['run_id', 'substation_id']);
            $table->index(['run_id', 'unit_id']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_status_check CHECK (status IN ('RUNNING','SUCCEEDED','FAILED'))");
            DB::statement("ALTER TABLE forecast_runs ADD CONSTRAINT forecast_runs_review_check CHECK (review_status IN ('DRAFT','REVIEWED') AND (review_status = 'DRAFT' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)))");
            DB::statement("ALTER TABLE forecast_gardu_results ADD CONSTRAINT forecast_gardu_results_state_check CHECK (exceed80_state IN ('already','forecast','none') AND exceed100_state IN ('already','forecast','none'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('forecast_gardu_results');
        Schema::dropIfExists('forecast_runs');
    }
};
