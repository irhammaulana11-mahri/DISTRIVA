<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gardu analysis (owner 2026-11-11): history, phase balance, balance between jurusan (outgoing feeders), base voltage (tegangan pangkal) and end voltage, load forecast.
 * A reading gets the base voltage per phase; each jurusan of the gardu is a child row of the reading with its own R/S/T/N currents and end voltage. Both stay append-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('substation_readings', function (Blueprint $table) {
            $table->decimal('base_voltage_r_v', 8, 2)->nullable();
            $table->decimal('base_voltage_s_v', 8, 2)->nullable();
            $table->decimal('base_voltage_t_v', 8, 2)->nullable();
        });
        DB::statement('ALTER TABLE substation_readings ADD CONSTRAINT substation_readings_base_voltage_check CHECK ((base_voltage_r_v IS NULL OR (base_voltage_r_v > 0 AND base_voltage_r_v < 1000)) AND (base_voltage_s_v IS NULL OR (base_voltage_s_v > 0 AND base_voltage_s_v < 1000)) AND (base_voltage_t_v IS NULL OR (base_voltage_t_v > 0 AND base_voltage_t_v < 1000)))');

        Schema::create('substation_reading_feeders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('reading_id')->constrained('substation_readings')->restrictOnDelete();
            $table->string('label', 40);                                          // the jurusan as the field names it (A, B, 1, 2 …)
            $table->decimal('current_r_a', 9, 2)->nullable();
            $table->decimal('current_s_a', 9, 2)->nullable();
            $table->decimal('current_t_a', 9, 2)->nullable();
            $table->decimal('current_n_a', 9, 2)->nullable();
            $table->decimal('end_voltage_v', 8, 2)->nullable();
            $table->unique(['reading_id', 'label']);
        });
        DB::statement('ALTER TABLE substation_reading_feeders ADD CONSTRAINT substation_reading_feeders_check CHECK ((current_r_a IS NULL OR current_r_a >= 0) AND (current_s_a IS NULL OR current_s_a >= 0) AND (current_t_a IS NULL OR current_t_a >= 0) AND (end_voltage_v IS NULL OR (end_voltage_v > 0 AND end_voltage_v < 1000)))');
        DB::unprepared('CREATE TRIGGER trg_substation_reading_feeders_append_only BEFORE UPDATE OR DELETE ON substation_reading_feeders FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_substation_reading_feeders_no_truncate BEFORE TRUNCATE ON substation_reading_feeders FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS trg_substation_reading_feeders_no_truncate ON substation_reading_feeders');
        Schema::dropIfExists('substation_reading_feeders');
        DB::statement('ALTER TABLE substation_readings DROP CONSTRAINT IF EXISTS substation_readings_base_voltage_check');
        Schema::table('substation_readings', function (Blueprint $table) {
            $table->dropColumn(['base_voltage_r_v', 'base_voltage_s_v', 'base_voltage_t_v']);
        });
    }
};
