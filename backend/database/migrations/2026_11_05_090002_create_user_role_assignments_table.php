<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_role_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')
                ->constrained('users')
                ->restrictOnDelete();
            $table->foreignId('role_id')
                ->constrained('roles')
                ->restrictOnDelete();
            $table->uuid('organizational_unit_id')->nullable();
            $table->date('valid_from');
            $table->date('valid_until')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('assigned_by')
                ->nullable()
                ->constrained('users')
                ->restrictOnDelete();
            $table->string('assignment_document', 255)->nullable();
            $table->timestampsTz();

            $table->foreign('organizational_unit_id')
                ->references('id')
                ->on('organizational_units')
                ->restrictOnDelete();
            $table->index(['user_id', 'is_active']);
            $table->index(['organizational_unit_id', 'is_active']);
            $table->index(['role_id', 'is_active']);
            $table->index(['user_id', 'organizational_unit_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_role_assignments');
    }
};
