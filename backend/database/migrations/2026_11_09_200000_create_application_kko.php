<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * KKO (docs/62 §51, owner 2026-11-09): the technical study of one application — loading of the transformer (gardu) before and after the new load, and the voltage at the
 * customer's location. One row per application; the survey result is recorded by TEKNIK / PERENCANAAN, the decision (LAYAK / TIDAK LAYAK, with an improvement proposal)
 * by TEKNIK. It never blocks the flow. Every change is an append-only event with a snapshot.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('application_kko', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->unique()->constrained('applications');
            $table->string('substation_code', 60)->nullable();
            $table->string('substation_name', 150)->nullable();
            $table->decimal('transformer_capacity_kva', 12, 3)->nullable();
            $table->decimal('measured_load_kva', 12, 3)->nullable();
            $table->date('measured_at')->nullable();
            $table->decimal('voltage_location_v', 8, 2)->nullable();
            $table->boolean('dedicated_transformer')->default(false);          // a dedicated transformer is proposed (new connection of 53 kVA or more): the PLN transformer is not loaded
            $table->decimal('dedicated_transformer_kva', 12, 3)->nullable();
            $table->decimal('added_power_kva', 12, 3)->nullable();             // snapshot of the application's power delta when recorded
            $table->decimal('load_factor', 9, 6)->nullable();
            $table->decimal('loading_before_pct', 8, 2)->nullable();
            $table->decimal('loading_after_pct', 8, 2)->nullable();
            $table->string('class_before', 12)->nullable();                    // UNDERLOAD | NORMAL | OVERLOAD | OVERBLAST
            $table->string('class_after', 12)->nullable();
            $table->boolean('voltage_low')->nullable();                        // voltage at the location is not above 200 V
            $table->string('decision', 12)->nullable();                        // LAYAK | TIDAK_LAYAK
            $table->text('decision_notes')->nullable();
            $table->text('improvement_proposal')->nullable();
            $table->foreignUuid('decided_by')->nullable()->constrained('users');
            $table->timestampTz('decided_at')->nullable();
            $table->foreignUuid('recorded_by')->constrained('users');
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE application_kko ADD CONSTRAINT application_kko_values_check CHECK ((transformer_capacity_kva IS NULL OR transformer_capacity_kva > 0) AND (measured_load_kva IS NULL OR measured_load_kva >= 0) AND (voltage_location_v IS NULL OR (voltage_location_v > 0 AND voltage_location_v < 1000)) AND (load_factor IS NULL OR (load_factor > 0 AND load_factor <= 1)) AND (dedicated_transformer_kva IS NULL OR dedicated_transformer_kva > 0) AND (decision IS NULL OR decision IN ('LAYAK','TIDAK_LAYAK')) AND (class_before IS NULL OR class_before IN ('UNDERLOAD','NORMAL','OVERLOAD','OVERBLAST')) AND (class_after IS NULL OR class_after IN ('UNDERLOAD','NORMAL','OVERLOAD','OVERBLAST')))");
        DB::statement("ALTER TABLE application_kko ADD CONSTRAINT application_kko_decision_check CHECK (decision IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND (decision <> 'TIDAK_LAYAK' OR (decision_notes IS NOT NULL AND length(btrim(decision_notes)) > 0))))");

        Schema::create('application_kko_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('kko_id')->constrained('application_kko');
            $table->string('action', 20);                                     // RECORDED | DECIDED | DECISION_RESET
            $table->foreignUuid('actor_id')->constrained('users');
            $table->jsonb('snapshot');
            $table->timestampTz('created_at');
            $table->index(['kko_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('application_kko_events');
        Schema::dropIfExists('application_kko');
    }
};
