<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A wrong DRAFT of a price book, tariff book or KKF parameter set can be DISCARDED (never deleted: the events tables are append-only), like BOM drafts. Additive and idempotent:
 * a fourth status, a new event type and one more allowed transition (DRAFT -> DISCARDED); a discarded row is immutable like an approved one.
 */
return new class extends Migration
{
    /** table => [approval check, status check, events table, events type check, guard function, event types before] */
    private const TABLES = [
        'price_books' => ['price_books_approval_check', 'price_books_status_check', 'price_book_events', 'price_book_events_type_check', 'distriva_guard_price_book', ['CREATED', 'DRAFT_UPDATED', 'ZONE_SET', 'APPROVED', 'AUTO_CLOSED', 'RETIRED', 'MDU_SET']],
        'tariff_books' => ['tariff_books_approval_check', 'tariff_books_status_check', 'tariff_book_events', 'tariff_book_events_type_check', 'distriva_guard_tariff_book', ['CREATED', 'APPROVED', 'AUTO_CLOSED', 'RETIRED']],
        'kkf_parameter_sets' => ['kkf_parameter_sets_approval_check', 'kkf_parameter_sets_status_check', 'kkf_parameter_events', 'kkf_parameter_events_type_check', 'distriva_guard_kkf_parameter_set', ['CREATED', 'DRAFT_UPDATED', 'APPROVED', 'AUTO_CLOSED', 'RETIRED']],
    ];

    private const FROM = "(OLD.status = 'DRAFT' AND NEW.status = 'APPROVED')";

    private const TO = "(OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED','DISCARDED'))";

    public function up(): void
    {
        foreach (self::TABLES as $table => [$approval, $status, $events, $typeCheck, $guard, $types]) {
            DB::statement("alter table {$table} drop constraint if exists {$status}");
            DB::statement("alter table {$table} add constraint {$status} check (status in ('DRAFT','APPROVED','INACTIVE','DISCARDED'))");
            DB::statement("alter table {$table} drop constraint if exists {$approval}");
            DB::statement("alter table {$table} add constraint {$approval} check (status in ('DRAFT','DISCARDED') or (approved_by is not null and approved_at is not null))");
            $this->eventTypes($events, $typeCheck, [...$types, 'DISCARDED']);
            $def = (string) DB::selectOne("select pg_get_functiondef('{$guard}'::regproc) as d")?->d;
            if (str_contains($def, self::FROM)) {
                DB::unprepared(str_replace(self::FROM, self::TO, $def));
            }
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table => [$approval, $status, $events, $typeCheck, $guard, $types]) {
            if (DB::table($table)->where('status', 'DISCARDED')->exists() || DB::table($events)->where('event_type', 'DISCARDED')->exists()) {
                throw new RuntimeException("Ada {$table} berstatus DISCARDED; riwayatnya tidak boleh dihapus, jadi migrasi tidak dibalik.");
            }
        }
        foreach (self::TABLES as $table => [$approval, $status, $events, $typeCheck, $guard, $types]) {
            $def = (string) DB::selectOne("select pg_get_functiondef('{$guard}'::regproc) as d")?->d;
            DB::unprepared(str_replace(self::TO, self::FROM, $def));
            $this->eventTypes($events, $typeCheck, $types);
            DB::statement("alter table {$table} drop constraint if exists {$approval}");
            DB::statement("alter table {$table} add constraint {$approval} check (status = 'DRAFT' or (approved_by is not null and approved_at is not null))");
            DB::statement("alter table {$table} drop constraint if exists {$status}");
            DB::statement("alter table {$table} add constraint {$status} check (status in ('DRAFT','APPROVED','INACTIVE'))");
        }
    }

    /** @param list<string> $types */
    private function eventTypes(string $events, string $check, array $types): void
    {
        $list = implode(',', array_map(fn (string $t) => "'{$t}'", $types));
        DB::statement("alter table {$events} drop constraint if exists {$check}");
        DB::statement("alter table {$events} add constraint {$check} check (event_type in ({$list}))");
    }
};
