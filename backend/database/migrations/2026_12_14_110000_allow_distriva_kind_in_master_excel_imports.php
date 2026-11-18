<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** The DISTRIVA master workbook (docs/85) is a third kind of upload next to RAB_KKF and TARIF. Idempotent: the constraint is replaced by one that lists all three kinds. */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table master_excel_imports drop constraint if exists master_excel_imports_kind_check');
        DB::statement("alter table master_excel_imports add constraint master_excel_imports_kind_check check (kind in ('RAB_KKF','TARIF','DISTRIVA'))");
    }

    public function down(): void
    {
        DB::statement("delete from master_excel_imports where kind = 'DISTRIVA'");
        DB::statement('alter table master_excel_imports drop constraint if exists master_excel_imports_kind_check');
        DB::statement("alter table master_excel_imports add constraint master_excel_imports_kind_check check (kind in ('RAB_KKF','TARIF'))");
    }
};
