<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Stage 1A (docs/24, docs/62): customers, applications (PB/PD), external references, append-only status history.
// Deviations from docs/24, on purpose: power is stored WITH its unit (VA|kVA) and delta_power_kva is derived from both;
// tariff codes are plain text (no tariff master yet); Bot Daftung staging/payments/external status history come in 1B-1D.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('customer_number', 50)->unique();
            $table->string('name', 200);
            $table->string('phone', 30)->nullable();      // required before an application is submitted; E.164
            $table->string('email', 150)->nullable();
            $table->timestampsTz();
            $table->index('name');
        });

        Schema::create('customer_external_references', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('customer_id')->constrained('customers')->restrictOnDelete();
            $table->string('source_system', 50);
            $table->string('reference_type', 50);          // IDPEL
            $table->string('reference_value', 150);        // string: leading zeros matter
            $table->boolean('is_primary')->default(false);
            $table->timestampTz('valid_from')->nullable();
            $table->timestampTz('valid_until')->nullable();
            $table->timestampsTz();
            $table->index('customer_id');
        });

        Schema::create('application_number_sequences', function (Blueprint $table) {
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_number')->default(0);
            $table->primary(['organizational_unit_id', 'year']);
        });

        Schema::create('applications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('application_number', 50)->unique();
            $table->string('application_type', 5);
            $table->string('transaction_type', 50);
            $table->foreignUuid('customer_id')->constrained('customers')->restrictOnDelete();
            $table->foreignUuid('organizational_unit_id')->constrained('organizational_units')->restrictOnDelete();
            $table->string('source_type', 30)->default('MANUAL');
            $table->string('source_reference_id', 150)->nullable();
            $table->timestampTz('source_created_at')->nullable();
            $table->timestampTz('imported_at')->nullable();
            $table->text('service_address')->nullable();
            $table->string('old_tariff_code', 30)->nullable();
            $table->decimal('old_power_value', 14, 3)->nullable();
            $table->string('old_power_unit', 10)->nullable();
            $table->string('new_tariff_code', 30)->nullable();
            $table->decimal('new_power_value', 14, 3)->nullable();
            $table->string('new_power_unit', 10)->nullable();
            $table->decimal('delta_power_kva', 14, 3)->nullable();
            $table->string('sar_package', 150)->nullable();
            $table->decimal('total_cost', 18, 2)->nullable();
            $table->string('service_criteria', 50)->nullable();
            $table->boolean('requires_drawing')->nullable();
            $table->boolean('requires_feasibility_study')->nullable();
            $table->boolean('requires_network_extension')->nullable();
            $table->string('current_status', 50)->default('DRAFT');
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->index(['organizational_unit_id', 'current_status', 'submitted_at']);
            $table->index('customer_id');
        });

        Schema::create('application_external_references', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('external_system', 50)->default('AP2T');
            $table->string('reference_type', 30);          // AGENDA | PAYMENT_REGISTER
            $table->string('reference_number', 100);       // string: leading digits
            $table->string('registration_source', 30)->default('MANUAL');
            $table->timestampTz('received_at');
            $table->foreignUuid('received_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->boolean('is_active')->default(true);
            $table->jsonb('raw_reference')->nullable();
            $table->timestampsTz();
            $table->index(['application_id', 'reference_type']);
        });

        Schema::create('application_status_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('application_id')->constrained('applications')->restrictOnDelete();
            $table->string('from_status', 50)->nullable();
            $table->string('to_status', 50);
            $table->foreignUuid('changed_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('changed_at');
            $table->text('reason')->nullable();
            $table->index(['application_id', 'changed_at']);
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_type_check CHECK (application_type IN ('PB','PD'))");
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK (current_status IN ('DRAFT','SUBMITTED','CANCELLED'))");
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_source_check CHECK (source_type IN ('MANUAL','BOT_DAFTUNG'))");
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_power_units_check CHECK ((old_power_unit IS NULL OR old_power_unit IN ('VA','kVA')) AND (new_power_unit IS NULL OR new_power_unit IN ('VA','kVA')))");
        DB::statement('ALTER TABLE applications ADD CONSTRAINT applications_power_values_check CHECK ((old_power_value IS NULL OR old_power_value >= 0) AND (new_power_value IS NULL OR new_power_value >= 0) AND (total_cost IS NULL OR total_cost >= 0))');
        DB::statement('ALTER TABLE applications ADD CONSTRAINT applications_power_pairs_check CHECK ((old_power_value IS NULL) = (old_power_unit IS NULL) AND (new_power_value IS NULL) = (new_power_unit IS NULL))');
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_submitted_check CHECK (current_status = 'DRAFT' OR submitted_at IS NOT NULL OR current_status = 'CANCELLED')");
        DB::statement('CREATE UNIQUE INDEX applications_source_reference_unique ON applications (source_type, source_reference_id) WHERE source_reference_id IS NOT NULL');
        DB::statement("ALTER TABLE customers ADD CONSTRAINT customers_phone_check CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$')");
        DB::statement("ALTER TABLE application_external_references ADD CONSTRAINT application_external_references_type_check CHECK (reference_type IN ('AGENDA','PAYMENT_REGISTER'))");
        DB::statement('CREATE UNIQUE INDEX customer_external_references_unique ON customer_external_references (source_system, reference_type, reference_value) WHERE valid_until IS NULL');
        DB::statement('CREATE UNIQUE INDEX application_external_references_active_unique ON application_external_references (external_system, reference_type, reference_number) WHERE is_active');

        // An application belongs to an ULP; identity columns never change after insert.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_application()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE v_type text; v_active boolean;
            BEGIN
                SELECT unit_type, is_active INTO v_type, v_active FROM organizational_units WHERE id = NEW.organizational_unit_id;
                IF v_type IS DISTINCT FROM 'ULP' THEN RAISE EXCEPTION 'An application must belong to a ULP unit'; END IF;
                IF TG_OP = 'INSERT' AND v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'The ULP unit is not active'; END IF;
                IF TG_OP = 'UPDATE' AND (
                    NEW.application_number, NEW.application_type, NEW.customer_id, NEW.organizational_unit_id, NEW.created_by
                ) IS DISTINCT FROM (
                    OLD.application_number, OLD.application_type, OLD.customer_id, OLD.organizational_unit_id, OLD.created_by
                ) THEN
                    RAISE EXCEPTION 'Application identity columns are immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
        DB::unprepared('CREATE TRIGGER trg_applications_guard BEFORE INSERT OR UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION distriva_guard_application()');
        DB::unprepared('CREATE TRIGGER trg_application_status_histories_append_only BEFORE UPDATE OR DELETE ON application_status_histories FOR EACH ROW EXECUTE FUNCTION distriva_reject_history_mutation()');
        DB::unprepared('CREATE TRIGGER trg_application_status_histories_no_truncate BEFORE TRUNCATE ON application_status_histories FOR EACH STATEMENT EXECUTE FUNCTION distriva_reject_history_mutation()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_status_histories_append_only ON application_status_histories');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_application_status_histories_no_truncate ON application_status_histories');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_applications_guard ON applications');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_guard_application()');
        }
        foreach (['application_status_histories', 'application_external_references', 'applications', 'application_number_sequences', 'customer_external_references', 'customers'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
