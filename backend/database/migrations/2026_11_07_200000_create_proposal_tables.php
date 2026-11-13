<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 5C+ (docs/62 §37; owner 7 Nov 2026): "usulan" = ONE work proposal with SEVERAL customers (3-phase, >= 6600 VA). The pipeline (survey, drawing, MTO, RAB, allocation, WO, BASTP)
// keeps running through the proposal's REPRESENTATIVE application (the first customer), the KKF is calculated once for all members. A customer belongs to one live proposal at a time.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('proposal_number_sequences', function (Blueprint $table) {
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_number')->default(0);
            $table->primary(['organizational_unit_id', 'year']);
        });

        Schema::create('proposals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('proposal_number', 60)->unique();
            $table->foreignUuid('ulp_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->foreignUuid('representative_application_id')->constrained('applications')->restrictOnDelete();
            $table->string('title', 200)->nullable();
            $table->string('status', 10)->default('OPEN');                 // OPEN | CANCELLED
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->text('cancel_reason')->nullable();
            $table->timestampsTz();
        });

        Schema::create('proposal_applications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('proposal_id')->constrained('proposals')->restrictOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->foreignUuid('added_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('added_at');
            $table->timestampTz('released_at')->nullable();                 // removed from the proposal (history is kept)
            $table->unique(['proposal_id', 'application_id']);
        });

        Schema::create('proposal_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('proposal_id')->constrained('proposals')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at');
        });

        Schema::table('kkf_runs', function (Blueprint $table) {
            $table->foreignUuid('proposal_id')->nullable()->constrained('proposals')->restrictOnDelete();
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE proposals ADD CONSTRAINT proposals_status_check CHECK (status IN ('OPEN','CANCELLED'))");
        DB::statement('CREATE UNIQUE INDEX proposal_applications_one_live ON proposal_applications (application_id) WHERE released_at IS NULL');
        DB::statement("ALTER TABLE proposal_events ADD CONSTRAINT proposal_events_type_check CHECK (event_type IN ('CREATED','MEMBER_ADDED','MEMBER_REMOVED','CANCELLED'))");
        DB::unprepared('CREATE TRIGGER trg_proposal_events_append_only BEFORE UPDATE OR DELETE ON proposal_events FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_proposal_events_no_truncate BEFORE TRUNCATE ON proposal_events FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_proposal()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Proposals cannot be deleted'; END IF;
                IF OLD.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled proposal is final'; END IF;
                IF (NEW.representative_application_id, NEW.ulp_unit_id, NEW.proposal_number) IS DISTINCT FROM (OLD.representative_application_id, OLD.ulp_unit_id, OLD.proposal_number) THEN
                    RAISE EXCEPTION 'The representative application, unit and number of a proposal never change';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_proposals_guard BEFORE UPDATE OR DELETE ON proposals FOR EACH ROW EXECUTE FUNCTION distriva_guard_proposal()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_proposals_guard ON proposals');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_proposal_events_append_only ON proposal_events');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_proposal_events_no_truncate ON proposal_events');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_proposal()');
        }
        Schema::table('kkf_runs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('proposal_id');
        });
        foreach (['proposal_events', 'proposal_applications', 'proposals', 'proposal_number_sequences'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
