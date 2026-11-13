<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Alokasi tambahan: material/tiang yang datang menyusul dialokasikan lewat baris alokasi baru (parent_allocation_id = alokasi dasar yang sudah CONFIRMED),
// tanpa membatalkan alokasi dasar. Satu alokasi dasar berjalan per permohonan (DRAFT/CONFIRMED); tambahan boleh banyak, tetapi hanya satu yang DRAFT.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('allocations', function (Blueprint $table) {
            $table->foreignUuid('parent_allocation_id')->nullable()->constrained('allocations')->restrictOnDelete();
        });
        DB::statement('DROP INDEX IF EXISTS allocations_one_open');
        DB::statement("CREATE UNIQUE INDEX allocations_one_open ON allocations (application_id) WHERE status IN ('DRAFT','CONFIRMED') AND parent_allocation_id IS NULL");
        DB::statement("CREATE UNIQUE INDEX allocations_one_open_addition ON allocations (application_id) WHERE status = 'DRAFT' AND parent_allocation_id IS NOT NULL");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS allocations_one_open_addition');
        DB::statement('DROP INDEX IF EXISTS allocations_one_open');
        Schema::table('allocations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_allocation_id');
        });
        DB::statement("CREATE UNIQUE INDEX allocations_one_open ON allocations (application_id) WHERE status IN ('DRAFT','CONFIRMED')");
    }
};
