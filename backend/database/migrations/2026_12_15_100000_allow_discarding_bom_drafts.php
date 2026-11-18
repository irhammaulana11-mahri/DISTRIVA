<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A BOM draft that is wrong can be DISCARDED (never deleted: every version keeps its history, and the events table is append-only). Additive and idempotent:
 * a fourth status, a fourth event type and one more allowed transition (DRAFT -> DISCARDED); a discarded version is immutable like an approved one.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table bom_headers drop constraint if exists bom_headers_status_check');
        DB::statement("alter table bom_headers add constraint bom_headers_status_check check (status in ('DRAFT','APPROVED','INACTIVE','DISCARDED'))");
        DB::statement('alter table bom_headers drop constraint if exists bom_headers_approval_check');
        DB::statement("alter table bom_headers add constraint bom_headers_approval_check check (status in ('DRAFT','DISCARDED') or (approved_by is not null and approved_at is not null))");
        DB::statement('alter table bom_events drop constraint if exists bom_events_type_check');
        DB::statement("alter table bom_events add constraint bom_events_type_check check (event_type in ('CREATED','DRAFT_UPDATED','APPROVED','AUTO_CLOSED','RETIRED','DISCARDED'))");

        $def = (string) DB::selectOne("select pg_get_functiondef('distriva_guard_bom_header'::regproc) as d")?->d;
        $from = "(OLD.status = 'DRAFT' AND NEW.status = 'APPROVED') OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')";
        $to = "(OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED','DISCARDED')) OR (OLD.status = 'APPROVED' AND NEW.status = 'INACTIVE')";
        if (str_contains($def, $from)) {
            DB::unprepared(str_replace($from, $to, $def));
        }
    }

    public function down(): void
    {
        if (DB::table('bom_headers')->where('status', 'DISCARDED')->exists() || DB::table('bom_events')->where('event_type', 'DISCARDED')->exists()) {
            throw new RuntimeException('Ada versi BOM berstatus DISCARDED; riwayatnya tidak boleh dihapus, jadi migrasi tidak dibalik.');
        }
        $def = (string) DB::selectOne("select pg_get_functiondef('distriva_guard_bom_header'::regproc) as d")?->d;
        DB::unprepared(str_replace("NEW.status IN ('APPROVED','DISCARDED')", "NEW.status = 'APPROVED'", $def));
        DB::statement('alter table bom_events drop constraint if exists bom_events_type_check');
        DB::statement("alter table bom_events add constraint bom_events_type_check check (event_type in ('CREATED','DRAFT_UPDATED','APPROVED','AUTO_CLOSED','RETIRED'))");
        DB::statement('alter table bom_headers drop constraint if exists bom_headers_approval_check');
        DB::statement("alter table bom_headers add constraint bom_headers_approval_check check (status = 'DRAFT' or (approved_by is not null and approved_at is not null))");
        DB::statement('alter table bom_headers drop constraint if exists bom_headers_status_check');
        DB::statement("alter table bom_headers add constraint bom_headers_status_check check (status in ('DRAFT','APPROVED','INACTIVE'))");
    }
};
