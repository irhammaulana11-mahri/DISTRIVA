<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Target completion date of a work order (basis of the on-time score) and the admin-set parameters of the stock and vendor reports. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('work_orders', function (Blueprint $table) {
            $table->date('target_date')->nullable();
        });
        Schema::create('report_settings', function (Blueprint $table) {
            $table->string('key', 40)->primary();
            $table->jsonb('value');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_settings');
        Schema::table('work_orders', function (Blueprint $table) {
            $table->dropColumn('target_date');
        });
    }
};
