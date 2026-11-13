<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Backup / restore of the database (and the documents folder) — docs/64. Records of what was backed up, what was verified, what was restored and
// by whom. These tables deliberately have NO foreign keys to the application tables and are excluded from restores (pg_restore -T), so the
// history survives a restore of an older dump. actor ids are plain uuids for the same reason.
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TABLE backup_runs (
                id uuid PRIMARY KEY,
                backup_number varchar(40) NOT NULL UNIQUE,
                trigger varchar(12) NOT NULL,
                status varchar(12) NOT NULL DEFAULT 'RUNNING',
                include_documents boolean NOT NULL DEFAULT false,
                db_file varchar(255), db_size bigint, db_sha256 varchar(64), db_entries integer,
                docs_file varchar(255), docs_size bigint, docs_sha256 varchar(64),
                schema_version varchar(255),
                table_counts jsonb,
                notes varchar(500),
                error text,
                verified_at timestamptz, verify_result jsonb,
                requested_by uuid,
                started_at timestamptz NOT NULL, finished_at timestamptz, deleted_at timestamptz,
                CONSTRAINT backup_runs_trigger_check CHECK (trigger IN ('MANUAL','SCHEDULED','PRE_RESTORE')),
                CONSTRAINT backup_runs_status_check CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','DELETED')),
                CONSTRAINT backup_runs_done_check CHECK (status <> 'SUCCEEDED' OR (db_file IS NOT NULL AND db_sha256 IS NOT NULL AND finished_at IS NOT NULL))
            )
            SQL);
        DB::unprepared("CREATE UNIQUE INDEX backup_runs_one_running ON backup_runs ((true)) WHERE status = 'RUNNING'");
        DB::unprepared('CREATE INDEX backup_runs_started_idx ON backup_runs (started_at DESC)');

        DB::unprepared(<<<'SQL'
            CREATE TABLE restore_runs (
                id uuid PRIMARY KEY,
                backup_run_id uuid NOT NULL,
                backup_number varchar(40) NOT NULL,
                status varchar(12) NOT NULL DEFAULT 'RUNNING',
                restore_documents boolean NOT NULL DEFAULT false,
                safety_backup_id uuid,
                reason varchar(1000) NOT NULL,
                error text,
                requested_by uuid NOT NULL,
                started_at timestamptz NOT NULL, finished_at timestamptz,
                CONSTRAINT restore_runs_status_check CHECK (status IN ('RUNNING','SUCCEEDED','FAILED'))
            )
            SQL);
        DB::unprepared("CREATE UNIQUE INDEX restore_runs_one_running ON restore_runs ((true)) WHERE status = 'RUNNING'");

        DB::unprepared(<<<'SQL'
            CREATE TABLE backup_settings (
                id smallint PRIMARY KEY DEFAULT 1,
                enabled boolean NOT NULL DEFAULT false,
                run_at varchar(5) NOT NULL DEFAULT '02:00',
                include_documents boolean NOT NULL DEFAULT true,
                retention_count smallint NOT NULL DEFAULT 14,
                updated_by uuid, updated_at timestamptz,
                CONSTRAINT backup_settings_single CHECK (id = 1),
                CONSTRAINT backup_settings_time_check CHECK (run_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
                CONSTRAINT backup_settings_retention_check CHECK (retention_count BETWEEN 1 AND 365)
            )
            SQL);
        DB::unprepared('INSERT INTO backup_settings (id) VALUES (1)');

        DB::unprepared(<<<'SQL'
            CREATE TABLE backup_events (
                id uuid PRIMARY KEY,
                seq bigint GENERATED ALWAYS AS IDENTITY,
                backup_run_id uuid, restore_run_id uuid,
                event_type varchar(30) NOT NULL,
                actor_user_id uuid,
                details jsonb,
                occurred_at timestamptz NOT NULL,
                CONSTRAINT backup_events_type_check CHECK (event_type IN ('BACKUP_STARTED','BACKUP_SUCCEEDED','BACKUP_FAILED','VERIFIED','VERIFY_FAILED','DOWNLOADED','DELETED','SETTINGS_CHANGED','RESTORE_STARTED','RESTORE_SUCCEEDED','RESTORE_FAILED','RETENTION_PRUNED'))
            )
            SQL);
        DB::unprepared('CREATE INDEX backup_events_run_idx ON backup_events (backup_run_id, seq)');
        DB::unprepared('CREATE TRIGGER trg_backup_events_append_only BEFORE UPDATE OR DELETE ON backup_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_backup_events_no_truncate BEFORE TRUNCATE ON backup_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        foreach (['backup_events', 'backup_settings', 'restore_runs', 'backup_runs'] as $t) {
            DB::unprepared("DROP TABLE IF EXISTS {$t}");
        }
    }
};
