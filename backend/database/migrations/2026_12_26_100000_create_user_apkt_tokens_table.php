<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Token sesi APKT yang dipilih pengguna untuk disimpan (terenkripsi, satu per pengguna, tidak pernah dikembalikan), sama dengan token MIMS (user_mims_tokens). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_apkt_tokens', function (Blueprint $table) {
            $table->foreignUuid('user_id')->primary()->constrained('users')->cascadeOnDelete();
            $table->text('token_encrypted');
            $table->timestampTz('saved_at');
            $table->timestampTz('last_used_at')->nullable();
            $table->string('last_result', 12)->nullable();   // OK | REJECTED
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_apkt_tokens');
    }
};
