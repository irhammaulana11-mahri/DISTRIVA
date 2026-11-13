<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Owner decision 2026-11-07: the creator may not approve their own work, EXCEPT the SYS_ADMIN role ("khusus role SYS_ADMIN saja"). The unconditional CHECK
// constraints cannot know roles, so they are replaced by one BEFORE INSERT/UPDATE trigger per table: approved_by must differ from the creator (and the verifier,
// for MTO packages) unless the approver holds an active SYS_ADMIN assignment today. The services apply the same rule (User::isSysAdmin()).
return new class extends Migration
{
    /** table => [constraint name, columns the approver must differ from, original CHECK expression] */
    private const TABLES = [
        'kkf_parameter_sets' => ['kkf_parameter_sets_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'tariff_books' => ['tariff_books_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'price_books' => ['price_books_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'sr1_schedules' => ['sr1_schedules_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'bom_headers' => ['bom_headers_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'construction_type_versions' => ['construction_type_versions_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'khs_item_versions' => ['khs_item_versions_sod_check', ['created_by'], 'approved_by IS NULL OR approved_by <> created_by'],
        'mto_packages' => ['mto_packages_sod_check', ['verified_by', 'created_by'], 'approved_by IS NULL OR (approved_by <> verified_by AND approved_by <> created_by)'],
    ];

    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_enforce_sod()
            RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE j jsonb := to_jsonb(NEW); a text := j->>TG_ARGV[0]; i int; v_sysadmin boolean;
            BEGIN
                IF a IS NULL THEN RETURN NEW; END IF;
                FOR i IN 1..TG_NARGS - 1 LOOP
                    IF a = j->>TG_ARGV[i] THEN
                        SELECT EXISTS (SELECT 1 FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
                            WHERE ura.user_id = a::uuid AND r.name = 'SYS_ADMIN' AND ura.is_active AND ura.valid_from <= CURRENT_DATE
                              AND (ura.valid_until IS NULL OR ura.valid_until >= CURRENT_DATE)) INTO v_sysadmin;
                        IF NOT v_sysadmin THEN
                            RAISE EXCEPTION 'Separation of duties: % must differ from % (only SYS_ADMIN may approve its own work)', TG_ARGV[0], TG_ARGV[i];
                        END IF;
                    END IF;
                END LOOP;
                RETURN NEW;
            END;
            $$;
            SQL);
        foreach (self::TABLES as $table => [$constraint, $columns]) {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$constraint}");
            $args = implode(', ', array_map(fn ($c) => "'{$c}'", ['approved_by', ...$columns]));
            DB::unprepared("CREATE TRIGGER trg_{$table}_sod BEFORE INSERT OR UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION distriva_enforce_sod({$args})");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        foreach (self::TABLES as $table => [$constraint, , $expression]) {
            DB::unprepared("DROP TRIGGER IF EXISTS trg_{$table}_sod ON {$table}");
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$constraint} CHECK ({$expression})");
        }
        DB::unprepared('DROP FUNCTION IF EXISTS distriva_enforce_sod()');
    }
};
