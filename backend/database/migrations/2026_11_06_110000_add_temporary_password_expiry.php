<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// docs/16 + docs/54 G-5: initial password is one-time and expires after 24 hours. Also adds audit event types
// for user creation / credential re-issue to authorization_change_histories.
return new class extends Migration
{
    private const BASE = "(event_type = 'USER_STATUS_CHANGED' AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL)
        OR (event_type = 'ROLE_METADATA_CHANGED' AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NULL)
        OR (event_type = 'PERMISSION_CATALOG_CHANGED' AND user_id IS NULL AND role_id IS NULL AND permission_id IS NOT NULL)
        OR (event_type IN ('ROLE_PERMISSION_GRANTED', 'ROLE_PERMISSION_REVOKED') AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NOT NULL)";

    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestampTz('password_expires_at')->nullable()->after('locked_until');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE authorization_change_histories DROP CONSTRAINT authorization_change_histories_target_check');
            DB::statement('ALTER TABLE authorization_change_histories ADD CONSTRAINT authorization_change_histories_target_check CHECK ('.self::BASE
                ." OR (event_type IN ('USER_CREATED', 'USER_CREDENTIALS_REISSUED') AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL))");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE authorization_change_histories DROP CONSTRAINT authorization_change_histories_target_check');
            DB::statement('ALTER TABLE authorization_change_histories ADD CONSTRAINT authorization_change_histories_target_check CHECK ('.self::BASE.')');
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('password_expires_at');
        });
    }
};
