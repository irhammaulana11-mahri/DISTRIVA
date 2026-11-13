<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Settings of the automatic MIMS stock pull (one row): on/off, time of day, and whose saved MIMS token is used (docs/82 §19.15). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mims_sync_settings', function (Blueprint $table) {
            $table->smallInteger('id')->primary();
            $table->boolean('auto_enabled')->default(false);
            $table->string('auto_time', 5)->default('02:00');
            $table->foreignUuid('auto_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('last_auto_date')->nullable();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::statement('ALTER TABLE mims_sync_settings ADD CONSTRAINT mims_sync_settings_single CHECK (id = 1)');
        DB::table('mims_sync_settings')->insert(['id' => 1]);
    }

    public function down(): void
    {
        Schema::dropIfExists('mims_sync_settings');
    }
};
