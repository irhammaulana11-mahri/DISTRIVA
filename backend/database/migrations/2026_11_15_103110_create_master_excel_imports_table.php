<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Excel master (RAB & KKF, tarif & jam nyala) uploaded from the screen: the file is read by the extractors, compared with the approved data, and the differences are applied as DRAFT versions. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_excel_imports', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('kind', 10);                        // RAB_KKF, TARIF
            $table->string('file_name', 255);
            $table->char('sha256', 64);
            $table->unsignedBigInteger('size_bytes');
            $table->string('ulp_code', 10)->nullable();        // TARIF: the ULP whose sales report the jam nyala come from (empty = all ULPs)
            $table->string('status', 12);                      // UPLOADED, PROCESSING, READY, FAILED, DISCARDED
            $table->jsonb('report')->nullable();
            $table->jsonb('applied')->nullable();              // dataset => {status, id, message, at, by}
            $table->string('message', 500)->nullable();
            $table->foreignUuid('uploaded_by')->constrained('users');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('processed_at')->nullable();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::statement("alter table master_excel_imports add constraint master_excel_imports_kind_check check (kind in ('RAB_KKF','TARIF'))");
        DB::statement("alter table master_excel_imports add constraint master_excel_imports_status_check check (status in ('UPLOADED','PROCESSING','READY','FAILED','DISCARDED'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('master_excel_imports');
    }
};
