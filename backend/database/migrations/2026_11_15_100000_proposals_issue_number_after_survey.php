<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Owner 2026-11-15 (docs/82 §11): a survey request (individual or collective) exists first; the usulan NUMBER is issued only when the survey is accepted as "needs network extension".
// A proposal created for a survey therefore has no number yet (`proposal_number` null, `issued_at` null); the number may be set once, from null, and never changes afterwards.
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        Schema::table('proposals', function ($table) {
            $table->timestampTz('issued_at')->nullable();
        });
        DB::statement('ALTER TABLE proposals ALTER COLUMN proposal_number DROP NOT NULL');
        DB::statement('UPDATE proposals SET issued_at = created_at WHERE proposal_number IS NOT NULL AND issued_at IS NULL');
        DB::statement('ALTER TABLE proposal_events DROP CONSTRAINT proposal_events_type_check');
        DB::statement("ALTER TABLE proposal_events ADD CONSTRAINT proposal_events_type_check CHECK (event_type IN ('CREATED','MEMBER_ADDED','MEMBER_REMOVED','CANCELLED','COMPLETED_NO_EXTENSION','ISSUED'))");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_proposal()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Proposals cannot be deleted'; END IF;
                IF OLD.status IN ('CANCELLED','COMPLETED_NO_EXTENSION') THEN RAISE EXCEPTION 'A closed proposal is final'; END IF;
                IF (NEW.representative_application_id, NEW.ulp_unit_id) IS DISTINCT FROM (OLD.representative_application_id, OLD.ulp_unit_id)
                   OR (OLD.proposal_number IS NOT NULL AND NEW.proposal_number IS DISTINCT FROM OLD.proposal_number) THEN
                    RAISE EXCEPTION 'The representative application, unit and number of a proposal never change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        // not reversible once a proposal exists without a number
    }
};
