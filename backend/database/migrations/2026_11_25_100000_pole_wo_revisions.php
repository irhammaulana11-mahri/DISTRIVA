<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Revisi (amandemen) WO Tiang yang sudah terbit: nomor surat tetap sama; hanya rincian lokasi yang dikirim ke vendor tiang berubah. Tiap revisi menyimpan alasan dan rincian sebelum perubahan.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pole_work_orders', function (Blueprint $table) {
            $table->unsignedInteger('revision_number')->default(0);
        });
        Schema::create('pole_wo_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('pole_work_order_id')->constrained('pole_work_orders')->restrictOnDelete();
            $table->unsignedInteger('revision_number');
            $table->text('reason');
            $table->jsonb('before_lines');                                  // rincian lokasi sebelum revisi
            $table->unsignedInteger('added')->default(0);
            $table->unsignedInteger('removed')->default(0);
            $table->unsignedInteger('changed')->default(0);
            $table->foreignUuid('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['pole_work_order_id', 'revision_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pole_wo_revisions');
        Schema::table('pole_work_orders', fn (Blueprint $table) => $table->dropColumn('revision_number'));
    }
};
