<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sinkronisasi paralel multi-UP3 (docs/94): tiap run mencatat UP3, sumber, dataset, antrean, dan progres; kunci "satu run aktif" menjadi indeks unik parsial per
 * (up3_id, sync_source, sync_dataset); pengaturan tiap sumber menjadi satu baris per UP3; peristiwa gangguan dipisahkan per UP3.
 * Data yang sudah ada menjadi milik UP3 dengan gardu terbanyak, lalu ULP aktif terbanyak.
 */
return new class extends Migration
{
    private const RUNS = ['eis_sync_runs', 'outage_sync_runs', 'maximo_sync_runs', 'dil_sync_runs', 'mims_pull_runs'];

    private const SETTINGS = ['eis_sync_settings', 'outage_sync_settings', 'maximo_sync_settings', 'mims_sync_settings'];

    public function up(): void
    {
        $default = DB::table('organizational_units as p')->where('p.unit_type', 'UP3')
            ->orderByRaw("(select count(*) from substations s join organizational_units c on c.id = s.organizational_unit_id where c.parent_id = p.id) desc,
                (select count(*) from organizational_units c where c.parent_id = p.id and c.unit_type = 'ULP' and c.is_active) desc, p.code")->value('p.id');

        foreach (self::RUNS as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('up3_id')->nullable()->constrained('organizational_units')->nullOnDelete();
                $table->string('sync_source', 16)->nullable();
                $table->string('sync_dataset', 40)->nullable();
                $table->string('queue', 16)->nullable();
                $table->unsignedInteger('done_units')->nullable();
                $table->unsignedInteger('total_units')->nullable();
            });
            if ($default !== null) {
                DB::table($name)->update(['up3_id' => $default]);
            }
            DB::statement("create unique index {$name}_active_unique on {$name} (up3_id, sync_source, sync_dataset) where status in ('QUEUED','RUNNING')");
            DB::statement("create index {$name}_up3_created_index on {$name} (up3_id, created_at desc)");
        }

        foreach (self::SETTINGS as $name) {
            DB::statement("alter table {$name} drop constraint if exists {$name}_single");
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('up3_id')->nullable()->unique()->constrained('organizational_units')->cascadeOnDelete();
            });
            if ($default !== null) {
                DB::table($name)->where('id', 1)->update(['up3_id' => $default]);
            }
        }

        Schema::table('outage_events', function (Blueprint $table) {
            $table->foreignUuid('up3_id')->nullable()->constrained('organizational_units')->nullOnDelete();
        });
        if ($default !== null) {
            DB::table('outage_events')->update(['up3_id' => $default]);
        }
        DB::statement('alter table outage_events drop constraint if exists outage_events_source_key_unique');
        DB::statement('alter table outage_events add constraint outage_events_up3_source_key_unique unique nulls not distinct (up3_id, source_key)');
    }

    public function down(): void
    {
        DB::statement('alter table outage_events drop constraint if exists outage_events_up3_source_key_unique');
        Schema::table('outage_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('up3_id');
            $table->unique('source_key');
        });
        foreach (self::SETTINGS as $name) {
            DB::table($name)->where('id', '<>', 1)->delete();
            Schema::table($name, fn (Blueprint $table) => $table->dropConstrainedForeignId('up3_id'));
            DB::statement("alter table {$name} add constraint {$name}_single check (id = 1)");
        }
        foreach (self::RUNS as $name) {
            DB::statement("drop index if exists {$name}_active_unique");
            DB::statement("drop index if exists {$name}_up3_created_index");
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('up3_id');
                $table->dropColumn(['sync_source', 'sync_dataset', 'queue', 'done_units', 'total_units']);
            });
        }
    }
};
