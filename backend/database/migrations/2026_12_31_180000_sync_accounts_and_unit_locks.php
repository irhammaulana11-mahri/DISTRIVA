<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sinkronisasi per akun dan per ULP (docs/94): akun EIS/Maximo milik ULP; kunci data pindah dari "satu run per UP3" ke "satu run per (sumber, dataset, sasaran)",
 * dengan sasaran ULP, gudang, atau UP3. Baris kunci hanya ada selama run antre atau berjalan: trigger menghapusnya begitu run selesai, dari jalur mana pun.
 */
return new class extends Migration
{
    private const RUNS = ['eis_sync_runs', 'outage_sync_runs', 'maximo_sync_runs', 'dil_sync_runs', 'mims_pull_runs'];

    public function up(): void
    {
        Schema::create('sync_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source', 12);                                   // eis | maximo
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->cascadeOnDelete();
            $table->string('username', 150);
            $table->text('password_encrypted');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['source', 'organizational_unit_id']);
        });

        Schema::create('sync_locks', function (Blueprint $table) {
            $table->string('source', 16);
            $table->string('dataset', 40);
            $table->uuid('target_id');                                      // ULP, gudang, atau UP3
            $table->string('run_table', 40);
            $table->uuid('run_id');
            $table->primary(['source', 'dataset', 'target_id']);
            $table->index('run_id');
        });

        DB::unprepared(<<<'SQL'
            create or replace function sync_release_locks() returns trigger language plpgsql as $$
            begin
                if tg_op = 'DELETE' then
                    delete from sync_locks where run_id = old.id;
                    return old;
                end if;
                if new.status not in ('QUEUED', 'RUNNING') then
                    delete from sync_locks where run_id = new.id;
                end if;
                return new;
            end $$
            SQL);

        foreach (self::RUNS as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignUuid('scope_unit_id')->nullable()->constrained('organizational_units')->nullOnDelete();       // tingkat pemicu: UP3 atau ULP
                $table->foreignUuid('account_unit_id')->nullable()->constrained('organizational_units')->nullOnDelete();     // akun ULP yang dipakai; kosong = akun UP3
            });
            DB::statement("drop index if exists {$name}_active_unique");
            DB::unprepared("create trigger {$name}_release_locks after update of status or delete on {$name} for each row execute function sync_release_locks()");
        }
    }

    public function down(): void
    {
        foreach (self::RUNS as $name) {
            DB::unprepared("drop trigger if exists {$name}_release_locks on {$name}");
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('scope_unit_id');
                $table->dropConstrainedForeignId('account_unit_id');
            });
            DB::statement("create unique index {$name}_active_unique on {$name} (up3_id, sync_source, sync_dataset) where status in ('QUEUED','RUNNING')");
        }
        DB::unprepared('drop function if exists sync_release_locks()');
        Schema::dropIfExists('sync_locks');
        Schema::dropIfExists('sync_accounts');
    }
};
