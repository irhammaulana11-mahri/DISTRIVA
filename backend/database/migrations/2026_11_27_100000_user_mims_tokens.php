<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The MIMS session token a user chose to keep for their own stock pulls: encrypted with the application key, one per user, never returned by the API (docs/82 §19.16). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_mims_tokens', function (Blueprint $table) {
            $table->foreignUuid('user_id')->primary()->constrained('users')->cascadeOnDelete();
            $table->text('token_encrypted');
            $table->timestampTz('saved_at');
            $table->timestampTz('last_used_at')->nullable();
            $table->string('last_result', 12)->nullable();   // OK | REJECTED
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_mims_tokens');
    }
};
