<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Changing the MDU/insured value of one item of a DRAFT price book is recorded as its own event (MDU_SET). Additive and idempotent: the constraint is replaced by one that lists the new type. */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table price_book_events drop constraint if exists price_book_events_type_check');
        DB::statement("alter table price_book_events add constraint price_book_events_type_check check (event_type in ('CREATED','DRAFT_UPDATED','ZONE_SET','APPROVED','AUTO_CLOSED','RETIRED','MDU_SET'))");
    }

    public function down(): void
    {
        if (DB::table('price_book_events')->where('event_type', 'MDU_SET')->exists()) {
            throw new RuntimeException('Ada peristiwa MDU_SET; riwayat tidak boleh dihapus, jadi migrasi tidak dibalik.');
        }
        DB::statement('alter table price_book_events drop constraint if exists price_book_events_type_check');
        DB::statement("alter table price_book_events add constraint price_book_events_type_check check (event_type in ('CREATED','DRAFT_UPDATED','ZONE_SET','APPROVED','AUTO_CLOSED','RETIRED'))");
    }
};
