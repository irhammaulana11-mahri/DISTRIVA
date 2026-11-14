<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** What the automatic MIMS pull fetches each day: stock, issues (pengeluaran), receipts (penerimaan). All on by default, as before. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mims_sync_settings', function (Blueprint $table) {
            $table->boolean('auto_stock')->default(true);
            $table->boolean('auto_issues')->default(true);
            $table->boolean('auto_receipts')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('mims_sync_settings', function (Blueprint $table) {
            $table->dropColumn(['auto_stock', 'auto_issues', 'auto_receipts']);
        });
    }
};
