<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Owner 2026-11-16 (docs/82 §12): (1) a survey is accepted by the ULP manager alone, whatever its result (SUBMITTED -> ACCEPTED); a drawing riding the survey continues in its own UP3 review.
// (2) `sr_length_m` (service-line length needed) joins the survey content and freezes with it. (3) The KKO keeps the per-phase form of the paper KKO in `phase_detail` (json) - docs/82 §12.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_survey_versions', function ($table) {
            $table->decimal('sr_length_m', 8, 2)->nullable();
        });
        Schema::table('application_kko', function ($table) {
            $table->jsonb('phase_detail')->nullable();
        });
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_survey_version()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Survey versions cannot be deleted'; END IF;
                IF (NEW.survey_id, NEW.version_number) IS DISTINCT FROM (OLD.survey_id, OLD.version_number) THEN
                    RAISE EXCEPTION 'Survey version identity is immutable';
                END IF;
                IF OLD.status <> 'DRAFT' AND NEW.surveyor_id IS DISTINCT FROM OLD.surveyor_id THEN
                    RAISE EXCEPTION 'The surveyor of a submitted version cannot change';
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.survey_date, NEW.findings, NEW.technical_recommendation, NEW.requires_drawing, NEW.requires_network_extension, NEW.requires_feasibility_study,
                    NEW.latitude, NEW.longitude, NEW.network_distance_m, NEW.network_type, NEW.transformer_capacity_kva, NEW.network_condition, NEW.notes, NEW.measurements,
                    NEW.no_extension_reason, NEW.kko_id, NEW.kko_snapshot, NEW.sr_length_m
                ) IS DISTINCT FROM (
                    OLD.survey_date, OLD.findings, OLD.technical_recommendation, OLD.requires_drawing, OLD.requires_network_extension, OLD.requires_feasibility_study,
                    OLD.latitude, OLD.longitude, OLD.network_distance_m, OLD.network_type, OLD.transformer_capacity_kva, OLD.network_condition, OLD.notes, OLD.measurements,
                    OLD.no_extension_reason, OLD.kko_id, OLD.kko_snapshot, OLD.sr_length_m
                ) THEN
                    RAISE EXCEPTION 'Survey version content is frozen once submitted';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
                    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('UNDER_REVIEW','RETURNED','ACCEPTED'))
                    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('ACCEPTED','RETURNED'))
                ) THEN
                    RAISE EXCEPTION 'Invalid survey version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status = 'UNDER_REVIEW' AND NEW.status = 'UNDER_REVIEW' AND NEW.stage IS DISTINCT FROM OLD.stage AND NOT (
                    (OLD.stage = 'UP3_REVIEW' AND NEW.stage = 'ASMAN') OR (OLD.stage = 'ASMAN' AND NEW.stage = 'UP3_MANAGER')
                ) THEN
                    RAISE EXCEPTION 'Invalid survey stage transition % -> %', OLD.stage, NEW.stage;
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        // not reversible once surveys were accepted by the manager alone
    }
};
