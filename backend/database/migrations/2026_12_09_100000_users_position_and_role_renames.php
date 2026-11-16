<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Owner 2026-11-16: users get a position (jabatan); role names follow the owner's list. Idempotent: a database whose roles were already renamed by hand is left as it is.
return new class extends Migration
{
    private const RENAMES = ['UP3_ADMIN' => 'ADMIN', 'UP3_MANAGER' => 'MANAGER_UP3', 'KONSTRUKSI_UP3' => 'KONSTRUKSI', 'ENGINEERING' => 'ASMAN_JARINGAN'];

    public function up(): void
    {
        if (! Schema::hasColumn('users', 'position')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->string('position', 100)->nullable()->after('name');
            });
        }
        foreach (self::RENAMES as $old => $new) {
            if (DB::table('roles')->where('name', $old)->exists() && ! DB::table('roles')->where('name', $new)->exists()) {
                DB::table('roles')->where('name', $old)->update(['name' => $new, 'updated_at' => now()]);
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'position')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->dropColumn('position');
            });
        }
        foreach (self::RENAMES as $old => $new) {
            if (DB::table('roles')->where('name', $new)->exists() && ! DB::table('roles')->where('name', $old)->exists()) {
                DB::table('roles')->where('name', $new)->update(['name' => $old, 'updated_at' => now()]);
            }
        }
    }
};
