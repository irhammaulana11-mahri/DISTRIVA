<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Owner decision 2026-11-06: account activation and recovery (incl. locked accounts) use a one-time code (OTP)
// sent by e-mail and/or WhatsApp. No temporary password is issued by administrators any more.
return new class extends Migration
{
    private const BASE = "(event_type = 'USER_STATUS_CHANGED' AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL)
        OR (event_type = 'ROLE_METADATA_CHANGED' AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NULL)
        OR (event_type = 'PERMISSION_CATALOG_CHANGED' AND user_id IS NULL AND role_id IS NULL AND permission_id IS NOT NULL)
        OR (event_type IN ('ROLE_PERMISSION_GRANTED', 'ROLE_PERMISSION_REVOKED') AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NOT NULL)
        OR (event_type IN ('USER_CREATED', 'USER_CREDENTIALS_REISSUED') AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL)";

    public function up(): void
    {
        Schema::create('otp_challenges', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->string('purpose', 20);
            $table->string('code_hash', 64); // HMAC-SHA256; the code itself is never stored
            $table->timestampTz('expires_at');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampTz('consumed_at')->nullable();
            $table->timestampTz('invalidated_at')->nullable();
            $table->timestampTz('created_at');
            $table->index(['user_id', 'purpose', 'created_at']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('ACTIVATION', 'RECOVERY'))");
            DB::statement('ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_attempts_check CHECK (attempts >= 0)');
            // At most one live challenge per user and purpose, enforced by the database (concurrent requests cannot both win).
            DB::statement('CREATE UNIQUE INDEX otp_challenges_one_active ON otp_challenges (user_id, purpose) WHERE consumed_at IS NULL AND invalidated_at IS NULL');

            DB::statement('ALTER TABLE authorization_change_histories DROP CONSTRAINT authorization_change_histories_target_check');
            DB::statement('ALTER TABLE authorization_change_histories ADD CONSTRAINT authorization_change_histories_target_check CHECK ('.self::BASE
                ." OR (event_type IN ('USER_ACTIVATED', 'USER_PASSWORD_RECOVERED', 'USER_INVITATION_SENT') AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL))");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE authorization_change_histories DROP CONSTRAINT authorization_change_histories_target_check');
            DB::statement('ALTER TABLE authorization_change_histories ADD CONSTRAINT authorization_change_histories_target_check CHECK ('.self::BASE.')');
        }

        Schema::dropIfExists('otp_challenges');
    }
};
