<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Owner 8 Nov 2026: when the representative's survey is accepted with "perluasan jaringan = tidak", the proposal closes as COMPLETED_NO_EXTENSION and its members continue as ordinary applications.
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('ALTER TABLE proposals ALTER COLUMN status TYPE varchar(30)');
        DB::statement('ALTER TABLE proposal_events ALTER COLUMN event_type TYPE varchar(30)');
        DB::statement('ALTER TABLE proposals DROP CONSTRAINT proposals_status_check');
        DB::statement("ALTER TABLE proposals ADD CONSTRAINT proposals_status_check CHECK (status IN ('OPEN','CANCELLED','COMPLETED_NO_EXTENSION'))");
        DB::statement('ALTER TABLE proposal_events DROP CONSTRAINT proposal_events_type_check');
        DB::statement("ALTER TABLE proposal_events ADD CONSTRAINT proposal_events_type_check CHECK (event_type IN ('CREATED','MEMBER_ADDED','MEMBER_REMOVED','CANCELLED','COMPLETED_NO_EXTENSION'))");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_proposal()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Proposals cannot be deleted'; END IF;
                IF OLD.status IN ('CANCELLED','COMPLETED_NO_EXTENSION') THEN RAISE EXCEPTION 'A closed proposal is final'; END IF;
                IF (NEW.representative_application_id, NEW.ulp_unit_id, NEW.proposal_number) IS DISTINCT FROM (OLD.representative_application_id, OLD.ulp_unit_id, OLD.proposal_number) THEN
                    RAISE EXCEPTION 'The representative application, unit and number of a proposal never change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        // not reversible once a proposal was closed this way
    }
};
