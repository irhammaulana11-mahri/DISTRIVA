<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Master penyulang (owner 2026-11-12): one managing unit (UP3 or ULP, changeable) owns a feeder for access; the ULPs it serves are derived from its gardu (one feeder can cross ULPs).
 * substations.feeder_id links each gardu to its feeder (feeder_code stays as the source text). Existing gardu are back-filled: a feeder per distinct feeder_code, owned by the UP3 above the ULP with most of its gardu.
 * Every change to a feeder is kept in distribution_feeder_changes (append-only, reason required).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('distribution_feeders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 40)->unique();                                // KD_PYLG (WTGLH)
            $table->string('name', 120)->nullable();
            $table->string('gi_code', 40)->nullable();                           // substation (GI) that feeds it
            $table->string('gi_transformer_no', 10)->nullable();                 // power transformer of the GI
            $table->foreignUuid('owner_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('status', 10)->default('AKTIF');                      // AKTIF | NONAKTIF
            $table->text('notes')->nullable();
            $table->timestampsTz();
            $table->index('owner_unit_id');
        });
        DB::statement("ALTER TABLE distribution_feeders ADD CONSTRAINT distribution_feeders_status_check CHECK (status IN ('AKTIF','NONAKTIF'))");

        Schema::create('distribution_feeder_changes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('feeder_id')->constrained('distribution_feeders')->restrictOnDelete();
            $table->foreignUuid('changed_by')->nullable()->constrained('users');
            $table->string('action', 12);                                        // CREATED | UPDATED | AUTO
            $table->text('reason');
            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();
            $table->timestampTz('created_at');
            $table->index(['feeder_id', 'created_at']);
        });
        DB::unprepared('CREATE TRIGGER trg_distribution_feeder_changes_append_only BEFORE UPDATE OR DELETE ON distribution_feeder_changes FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_distribution_feeder_changes_no_truncate BEFORE TRUNCATE ON distribution_feeder_changes FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');

        Schema::table('substations', function (Blueprint $table) {
            $table->foreignUuid('feeder_id')->nullable()->constrained('distribution_feeders')->restrictOnDelete();
            $table->index('feeder_id');
        });

        $codes = DB::table('substations')->whereNotNull('feeder_code')->where('feeder_code', '!=', '')->distinct()->pluck('feeder_code');
        foreach ($codes as $code) {
            $unitId = DB::table('substations')->where('feeder_code', $code)->select('organizational_unit_id', DB::raw('count(*) n'))->groupBy('organizational_unit_id')->orderByDesc('n')->value('organizational_unit_id');
            $owner = DB::table('organizational_units')->where('id', $unitId)->value('parent_id') ?? $unitId;
            $gi = DB::table('substations')->where('feeder_code', $code)->whereNotNull('gi_code')->select('gi_code', DB::raw('count(*) n'))->groupBy('gi_code')->orderByDesc('n')->value('gi_code');
            $id = (string) Str::uuid();
            DB::table('distribution_feeders')->insert(['id' => $id, 'code' => $code, 'gi_code' => $gi, 'owner_unit_id' => $owner, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('distribution_feeder_changes')->insert(['id' => (string) Str::uuid(), 'feeder_id' => $id, 'action' => 'AUTO', 'reason' => 'Dibentuk dari kode penyulang pada master gardu.', 'after' => json_encode(['code' => $code, 'gi_code' => $gi, 'owner_unit_id' => $owner]), 'created_at' => now()]);
            DB::table('substations')->where('feeder_code', $code)->update(['feeder_id' => $id]);
        }
    }

    public function down(): void
    {
        Schema::table('substations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('feeder_id');
        });
        DB::unprepared('DROP TRIGGER IF EXISTS trg_distribution_feeder_changes_no_truncate ON distribution_feeder_changes');
        Schema::dropIfExists('distribution_feeder_changes');
        Schema::dropIfExists('distribution_feeders');
    }
};
