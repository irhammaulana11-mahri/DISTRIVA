<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('authorization_change_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('event_type', 40);
            $table->uuid('user_id')->nullable();
            $table->unsignedBigInteger('role_id')->nullable();
            $table->unsignedBigInteger('permission_id')->nullable();
            $table->uuid('actor_user_id')->nullable();
            $table->jsonb('before_values')->nullable();
            $table->jsonb('after_values')->nullable();
            $table->text('reason')->nullable();
            $table->timestampTz('changed_at');

            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('role_id')->references('id')->on('roles')->restrictOnDelete();
            $table->foreign('permission_id')->references('id')->on('permissions')->restrictOnDelete();
            $table->foreign('actor_user_id')->references('id')->on('users')->restrictOnDelete();
            $table->index(['event_type', 'changed_at']);
            $table->index(['user_id', 'changed_at']);
            $table->index(['role_id', 'changed_at']);
            $table->index(['permission_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('authorization_change_histories');
    }
};
