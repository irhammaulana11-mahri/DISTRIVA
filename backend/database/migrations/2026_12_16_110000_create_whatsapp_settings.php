<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * WhatsApp gateway settings kept in the application (menu Pengaturan) instead of only in .env. One row (id = 1); NO row = the .env values stay in force.
 * The API token is stored encrypted and never returned; `whatsapp_setting_events` is an append-only trail of who changed which fields (names only, never values).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_settings', function (Blueprint $table) {
            $table->smallInteger('id')->primary();
            $table->string('driver', 10)->default('http');
            $table->text('url')->nullable();
            $table->string('method', 4)->default('POST');
            $table->string('auth_header', 60)->default('Authorization');
            $table->string('auth_prefix', 30)->default('');
            $table->text('token_encrypted')->nullable();
            $table->string('body_format', 4)->default('form');
            $table->text('body')->nullable();
            $table->string('success_path', 100)->nullable();
            $table->string('success_value', 60)->default('true');
            $table->unsignedSmallInteger('timeout')->default(10);
            $table->string('default_country_code', 4)->default('62');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::unprepared('ALTER TABLE whatsapp_settings ADD CONSTRAINT whatsapp_settings_single CHECK (id = 1)');
        DB::unprepared("ALTER TABLE whatsapp_settings ADD CONSTRAINT whatsapp_settings_check CHECK (driver IN ('null','log','http') AND method IN ('POST','GET') AND body_format IN ('form','json') AND timeout BETWEEN 1 AND 60)");

        Schema::create('whatsapp_setting_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('event_type', 20);          // SETTINGS_CHANGED | TEST_SENT | TEST_FAILED
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->jsonb('details');
            $table->timestampTz('occurred_at');
            $table->index('occurred_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_setting_events');
        Schema::dropIfExists('whatsapp_settings');
    }
};
