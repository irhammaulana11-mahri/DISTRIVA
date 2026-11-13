<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            return;
        }

        if ($driver !== 'pgsql') {
            throw new RuntimeException('T4.2.1 integrity migration requires PostgreSQL.');
        }

        $hasBtreeGist = (int) DB::scalar(
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN 1 ELSE 0 END",
        ) === 1;

        if (! $hasBtreeGist) {
            throw new RuntimeException('PostgreSQL extension btree_gist must be provisioned before T4.2.1 migrations.');
        }

        DB::statement("ALTER TABLE users ADD CONSTRAINT users_account_status_check CHECK (account_status IN ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'))");
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_email_lowercase_check CHECK (email = lower(email))');
        DB::statement("ALTER TABLE organizational_units ADD CONSTRAINT organizational_units_type_check CHECK (unit_type IN ('UP3', 'ULP'))");
        DB::statement("ALTER TABLE roles ADD CONSTRAINT roles_unit_scope_check CHECK ((name = 'SYS_ADMIN' AND requires_unit_scope = false) OR (name <> 'SYS_ADMIN' AND requires_unit_scope = true))");
        DB::statement('ALTER TABLE user_role_assignments ADD CONSTRAINT user_role_assignments_valid_dates_check CHECK (valid_until IS NULL OR valid_until >= valid_from)');
        DB::statement(<<<'SQL'
            ALTER TABLE authorization_change_histories
            ADD CONSTRAINT authorization_change_histories_target_check CHECK (
                (event_type = 'USER_STATUS_CHANGED' AND user_id IS NOT NULL AND role_id IS NULL AND permission_id IS NULL)
                OR (event_type = 'ROLE_METADATA_CHANGED' AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NULL)
                OR (event_type = 'PERMISSION_CATALOG_CHANGED' AND user_id IS NULL AND role_id IS NULL AND permission_id IS NOT NULL)
                OR (event_type IN ('ROLE_PERMISSION_GRANTED', 'ROLE_PERMISSION_REVOKED') AND user_id IS NULL AND role_id IS NOT NULL AND permission_id IS NOT NULL)
            )
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_validate_role_unit_scope()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF NEW.requires_unit_scope
                    AND EXISTS (
                        SELECT 1
                        FROM user_role_assignments
                        WHERE role_id = NEW.id
                            AND organizational_unit_id IS NULL
                    ) THEN
                    RAISE EXCEPTION 'A unit-scoped role cannot retain global assignments';
                END IF;

                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_roles_validate_unit_scope BEFORE UPDATE OF requires_unit_scope ON roles FOR EACH ROW EXECUTE FUNCTION distriva_validate_role_unit_scope()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_validate_organizational_unit()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            DECLARE
                parent_type varchar(10);
                parent_active boolean;
            BEGIN
                IF NEW.unit_type = 'UP3' AND NEW.parent_id IS NOT NULL THEN
                    RAISE EXCEPTION 'UP3 organizational units cannot have a parent';
                END IF;

                IF NEW.unit_type = 'ULP' THEN
                    IF NEW.parent_id IS NULL THEN
                        RAISE EXCEPTION 'ULP organizational units require a parent UP3';
                    END IF;

                    SELECT unit_type, is_active
                    INTO parent_type, parent_active
                    FROM organizational_units
                    WHERE id = NEW.parent_id
                    FOR SHARE;

                    IF NOT FOUND OR parent_type <> 'UP3' OR NOT parent_active THEN
                        RAISE EXCEPTION 'ULP parent must be an active UP3 organizational unit';
                    END IF;
                END IF;

                IF TG_OP = 'UPDATE' AND NEW.unit_type <> 'UP3'
                    AND EXISTS (SELECT 1 FROM organizational_units WHERE parent_id = NEW.id) THEN
                    RAISE EXCEPTION 'An organizational unit with children must remain an UP3';
                END IF;

                IF TG_OP = 'UPDATE' AND NOT NEW.is_active
                    AND EXISTS (SELECT 1 FROM organizational_units WHERE parent_id = NEW.id AND is_active) THEN
                    RAISE EXCEPTION 'An UP3 with active child units cannot be deactivated';
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER trg_organizational_units_validate
            BEFORE INSERT OR UPDATE ON organizational_units
            FOR EACH ROW EXECUTE FUNCTION distriva_validate_organizational_unit();
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_validate_user_role_assignment()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            DECLARE
                requires_scope boolean;
                unit_active boolean;
            BEGIN
                SELECT requires_unit_scope
                INTO requires_scope
                FROM roles
                WHERE id = NEW.role_id
                FOR SHARE;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Assignment role does not exist';
                END IF;

                IF requires_scope AND NEW.organizational_unit_id IS NULL THEN
                    RAISE EXCEPTION 'This role requires an organizational unit';
                END IF;

                IF NEW.organizational_unit_id IS NOT NULL THEN
                    SELECT is_active
                    INTO unit_active
                    FROM organizational_units
                    WHERE id = NEW.organizational_unit_id
                    FOR SHARE;

                    IF NOT FOUND OR NOT unit_active THEN
                        RAISE EXCEPTION 'Assignment organizational unit must be active';
                    END IF;
                END IF;

                RETURN NEW;
            END;
            $$;

            CREATE TRIGGER trg_user_role_assignments_validate
            BEFORE INSERT OR UPDATE OF role_id, organizational_unit_id ON user_role_assignments
            FOR EACH ROW EXECUTE FUNCTION distriva_validate_user_role_assignment();
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE user_role_assignments
            ADD CONSTRAINT user_role_assignments_no_active_scoped_overlap
            EXCLUDE USING gist (
                user_id WITH =,
                role_id WITH =,
                organizational_unit_id WITH =,
                daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&
            )
            WHERE (is_active AND organizational_unit_id IS NOT NULL)
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE user_role_assignments
            ADD CONSTRAINT user_role_assignments_no_active_global_overlap
            EXCLUDE USING gist (
                user_id WITH =,
                role_id WITH =,
                daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&
            )
            WHERE (is_active AND organizational_unit_id IS NULL)
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_reject_history_mutation()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'History records are append-only';
            END;
            $$;
            SQL);

        foreach (['organizational_unit_histories', 'user_role_assignment_histories', 'authorization_change_histories'] as $table) {
            DB::unprepared("CREATE TRIGGER trg_{$table}_append_only BEFORE UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
            DB::unprepared("CREATE TRIGGER trg_{$table}_no_truncate BEFORE TRUNCATE ON {$table} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        foreach (['organizational_unit_histories', 'user_role_assignment_histories', 'authorization_change_histories'] as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS trg_{$table}_append_only ON {$table}");
            DB::unprepared("DROP TRIGGER IF EXISTS trg_{$table}_no_truncate ON {$table}");
        }

        DB::unprepared('DROP TRIGGER IF EXISTS trg_user_role_assignments_validate ON user_role_assignments');
        DB::unprepared('DROP TRIGGER IF EXISTS trg_organizational_units_validate ON organizational_units');
        DB::unprepared('DROP TRIGGER IF EXISTS trg_roles_validate_unit_scope ON roles');
        DB::unprepared('DROP FUNCTION IF EXISTS distriva_reject_history_mutation()');
        DB::unprepared('DROP FUNCTION IF EXISTS distriva_validate_user_role_assignment()');
        DB::unprepared('DROP FUNCTION IF EXISTS distriva_validate_organizational_unit()');
        DB::unprepared('DROP FUNCTION IF EXISTS distriva_validate_role_unit_scope()');

        DB::statement('ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_no_active_global_overlap');
        DB::statement('ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_no_active_scoped_overlap');
        DB::statement('ALTER TABLE authorization_change_histories DROP CONSTRAINT IF EXISTS authorization_change_histories_target_check');
        DB::statement('ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_valid_dates_check');
        DB::statement('ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_unit_scope_check');
        DB::statement('ALTER TABLE organizational_units DROP CONSTRAINT IF EXISTS organizational_units_type_check');
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_lowercase_check');
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check');
    }
};
