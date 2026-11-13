<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // TOTP (RFC 6238) credential per user. The secret is stored encrypted (APP_KEY); recovery codes only as keyed hashes.
        Schema::create('user_mfa_credentials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->text('secret_encrypted');
            $table->timestampTz('confirmed_at')->nullable();
            $table->unsignedBigInteger('last_used_step')->nullable();   // replay protection: a time step is accepted once
            $table->jsonb('recovery_code_hashes')->nullable();
            $table->unsignedSmallInteger('failed_attempts')->default(0);
            $table->timestampTz('locked_until')->nullable();
            $table->timestampsTz();
        });

        // A token becomes "MFA verified" only after a correct TOTP/recovery code on that very token.
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->timestampTz('mfa_verified_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', fn (Blueprint $t) => $t->dropColumn('mfa_verified_at'));
        Schema::dropIfExists('user_mfa_credentials');
    }
};
