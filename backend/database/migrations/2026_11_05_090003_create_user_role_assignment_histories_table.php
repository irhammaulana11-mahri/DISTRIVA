<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_role_assignment_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_role_assignment_id');
            $table->string('event_type', 30);
            $table->jsonb('before_values')->nullable();
            $table->jsonb('after_values')->nullable();
            $table->text('reason');
            $table->uuid('actor_user_id')->nullable();
            $table->uuid('actor_assignment_id')->nullable();
            $table->timestampTz('changed_at');

            $table->foreign('user_role_assignment_id')
                ->references('id')
                ->on('user_role_assignments')
                ->restrictOnDelete();
            $table->foreign('actor_user_id')
                ->references('id')
                ->on('users')
                ->restrictOnDelete();
            $table->foreign('actor_assignment_id')
                ->references('id')
                ->on('user_role_assignments')
                ->restrictOnDelete();
            $table->index(['user_role_assignment_id', 'changed_at']);
            $table->index(['actor_user_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_role_assignment_histories');
    }
};
