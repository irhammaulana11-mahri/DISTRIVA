<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// docs/60 §4 (owner answer 2026-11-06): the commissioning-test volume is an INPUT taken from the drawing page (GAMBAR),
// not a construction quantity. A BOM version declares such inputs as named parameters: [{name, description, default, source}].
// The parameter list is part of the version's content, so the immutability trigger now covers it.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bom_headers', function (Blueprint $table) {
            $table->jsonb('parameters')->default('[]');
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement("ALTER TABLE bom_headers ADD CONSTRAINT bom_headers_parameters_check CHECK (jsonb_typeof(parameters) = 'array')");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_guard_bom_header()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Approved BOM versions cannot be deleted'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' AND (
                    NEW.group_code, NEW.version_number, NEW.name, NEW.description, NEW.valid_from, NEW.source_reference, NEW.created_by, NEW.parameters
                ) IS DISTINCT FROM (
                    OLD.group_code, OLD.version_number, OLD.name, OLD.description, OLD.valid_from, OLD.source_reference, OLD.created_by, OLD.parameters
                ) THEN
                    RAISE EXCEPTION 'Approved BOM version content is immutable';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')
                ) THEN
                    RAISE EXCEPTION 'Invalid BOM version status transition % -> %', OLD.status, NEW.status;
                END IF;
                IF OLD.status <> 'DRAFT' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
                    RAISE EXCEPTION 'Approval data is immutable';
                END IF;
                RETURN NEW;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE bom_headers DROP CONSTRAINT IF EXISTS bom_headers_parameters_check');
        }
        Schema::table('bom_headers', fn (Blueprint $t) => $t->dropColumn('parameters'));
    }
};
