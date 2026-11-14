<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Adds the internal status COMPLETED to applications: set when the BASTP of the work order is closed (owner decision, Nov 2026). Additive only. */
return new class extends Migration
{
    private const BASE = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE', 'CANCELLED', 'REFUNDED'];

    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        $this->apply([...self::BASE, 'COMPLETED']);
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::table('applications')->where('current_status', 'COMPLETED')->update(['current_status' => 'CONNECTION_DONE']);
        $this->apply(self::BASE);
    }

    /** @param list<string> $statuses */
    private function apply(array $statuses): void
    {
        $list = "'".implode("','", $statuses)."'";
        $noSubmit = "'".implode("','", array_values(array_diff($statuses, ['SUBMITTED'])))."'";
        DB::statement('ALTER TABLE applications DROP CONSTRAINT applications_status_check');
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK (current_status IN ({$list}))");
        DB::statement('ALTER TABLE applications DROP CONSTRAINT applications_submitted_check');
        DB::statement("ALTER TABLE applications ADD CONSTRAINT applications_submitted_check CHECK (current_status IN ({$noSubmit}) OR submitted_at IS NOT NULL)");
    }
};
