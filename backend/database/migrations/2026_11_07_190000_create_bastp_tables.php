<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 8 (docs/62 §36, docs/73; owner answers 7 Nov 2026): BASTP = handover record of a finished work order, a PRECONDITION of the WO's completion. The assigned vendor (or a TEKNIK of
// the ULP) prepares and submits it; MANAGER_ULP accepts; KONSTRUKSI_UP3 signs; ASMAN_KONSTRUKSI signs and CLOSES it (closing completes the WO). Annex: installed materials. Evidence:
// one or more kWh meters (customer id, meter number, photos). Every step is an electronic signature (password re-confirmed) over the frozen content hash. A return starts a new round.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bastp_number_sequences', function (Blueprint $table) {
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_number')->default(0);
            $table->primary(['organizational_unit_id', 'year']);
        });

        Schema::create('bastps', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('bastp_number', 60)->nullable()->unique();     // given at the first submission: sequence/BASTP/dd-mm/unit code/year
            $table->string('status', 20)->default('DRAFT');               // DRAFT | SUBMITTED | ACCEPTED | KONSTRUKSI_SIGNED | CLOSED | CANCELLED
            $table->unsignedInteger('round')->default(1);                 // +1 for every return
            $table->text('notes')->nullable();
            $table->text('return_reason')->nullable();
            $table->jsonb('content')->nullable();                         // frozen snapshot at submission
            $table->string('content_hash', 64)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('closed_at')->nullable();
            $table->timestampsTz();
        });

        Schema::create('bastp_materials', function (Blueprint $table) {   // annex: planned (from the WO) vs installed
            $table->uuid('id')->primary();
            $table->foreignUuid('bastp_id')->constrained('bastps')->restrictOnDelete();
            $table->foreignUuid('khs_item_id')->constrained('khs_items')->restrictOnDelete();
            $table->decimal('planned_qty', 18, 3);
            $table->decimal('installed_qty', 18, 3)->nullable();           // must be filled before submission
            $table->string('note', 255)->nullable();
            $table->unique(['bastp_id', 'khs_item_id']);
        });

        Schema::create('bastp_meters', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bastp_id')->constrained('bastps')->restrictOnDelete();
            $table->string('customer_idpel', 50);
            $table->string('meter_number', 60);
            $table->unique(['bastp_id', 'meter_number']);
        });

        Schema::create('bastp_meter_photos', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bastp_meter_id')->constrained('bastp_meters')->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('application_documents')->restrictOnDelete();
            $table->unique('document_id');
        });

        Schema::create('bastp_signatures', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bastp_id')->constrained('bastps')->restrictOnDelete();
            $table->unsignedInteger('round');
            $table->string('step', 20);                                    // SUBMIT | ULP_MANAGER | KONSTRUKSI_UP3 | ASMAN_KONSTRUKSI
            $table->foreignUuid('signer_user_id')->constrained('users')->restrictOnDelete();
            $table->string('signer_role', 50);
            $table->timestampTz('signed_at');
            $table->string('content_hash', 64);
            $table->string('signature', 64);                               // HMAC-SHA256(app key, number|round|step|user|time|content hash)
            $table->unique(['bastp_id', 'round', 'step']);
            $table->unique(['bastp_id', 'round', 'signer_user_id']);        // one signature per user per round
        });

        Schema::create('bastp_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bastp_id')->constrained('bastps')->restrictOnDelete();
            $table->string('event_type', 20);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->timestampTz('occurred_at');
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE bastps ADD CONSTRAINT bastps_status_check CHECK (status IN ('DRAFT','SUBMITTED','ACCEPTED','KONSTRUKSI_SIGNED','CLOSED','CANCELLED'))");
        DB::statement("CREATE UNIQUE INDEX bastps_one_live ON bastps (work_order_id) WHERE status IN ('DRAFT','SUBMITTED','ACCEPTED','KONSTRUKSI_SIGNED')");
        DB::statement("CREATE UNIQUE INDEX bastps_one_closed ON bastps (work_order_id) WHERE status = 'CLOSED'");
        DB::statement('ALTER TABLE bastp_materials ADD CONSTRAINT bastp_materials_check CHECK (planned_qty >= 0 AND (installed_qty IS NULL OR installed_qty >= 0))');
        DB::statement("ALTER TABLE bastp_signatures ADD CONSTRAINT bastp_signatures_check CHECK (step IN ('SUBMIT','ULP_MANAGER','KONSTRUKSI_UP3','ASMAN_KONSTRUKSI') AND signature ~ '^[0-9a-f]{64}$')");
        DB::statement("ALTER TABLE bastp_events ADD CONSTRAINT bastp_events_type_check CHECK (event_type IN ('CREATED','SUBMITTED','ACCEPTED','SIGNED','RETURNED','CLOSED','CANCELLED'))");
        foreach (['bastp_signatures', 'bastp_events'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_immutable BEFORE UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()");
            DB::unprepared("CREATE TRIGGER trg_{$t}_no_truncate BEFORE TRUNCATE ON {$t} FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()");
        }
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_bastp()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' OR OLD.bastp_number IS NOT NULL THEN RAISE EXCEPTION 'A submitted BASTP cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'A % BASTP is final', OLD.status; END IF;
                IF OLD.bastp_number IS NOT NULL AND NEW.bastp_number IS DISTINCT FROM OLD.bastp_number THEN RAISE EXCEPTION 'The BASTP number never changes'; END IF;
                IF OLD.status IN ('SUBMITTED','ACCEPTED','KONSTRUKSI_SIGNED') AND NEW.status NOT IN ('DRAFT','CANCELLED') AND (NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.content IS DISTINCT FROM OLD.content) THEN
                    RAISE EXCEPTION 'The signed content of a submitted BASTP is immutable (return it to change it)';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_bastps_guard BEFORE UPDATE OR DELETE ON bastps FOR EACH ROW EXECUTE FUNCTION distriva_guard_bastp()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_bastp_child()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_status text; v_id uuid;
            BEGIN
                IF TG_TABLE_NAME = 'bastp_meter_photos' THEN
                    SELECT bastp_id INTO v_id FROM bastp_meters WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bastp_meter_id ELSE NEW.bastp_meter_id END;
                ELSE
                    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.bastp_id ELSE NEW.bastp_id END;
                END IF;
                SELECT status INTO v_status FROM bastps WHERE id = v_id;
                IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'The annex and evidence of a submitted BASTP are immutable'; END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END;
            $$;
            SQL);
        foreach (['bastp_materials', 'bastp_meters', 'bastp_meter_photos'] as $t) {
            DB::unprepared("CREATE TRIGGER trg_{$t}_guard BEFORE INSERT OR UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION distriva_guard_bastp_child()");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['bastp_materials', 'bastp_meters', 'bastp_meter_photos'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_guard ON {$t}");
            }
            DB::unprepared('DROP TRIGGER IF EXISTS trg_bastps_guard ON bastps');
            foreach (['bastp_signatures', 'bastp_events'] as $t) {
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_immutable ON {$t}");
                DB::unprepared("DROP TRIGGER IF EXISTS trg_{$t}_no_truncate ON {$t}");
            }
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_bastp_child()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_bastp()');
        }
        foreach (['bastp_events', 'bastp_signatures', 'bastp_meter_photos', 'bastp_meters', 'bastp_materials', 'bastps', 'bastp_number_sequences'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
