<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizational_unit_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organizational_unit_id');
            $table->string('old_code', 30)->nullable();
            $table->string('new_code', 30)->nullable();
            $table->string('old_name', 150)->nullable();
            $table->string('new_name', 150)->nullable();
            $table->string('old_unit_type', 10)->nullable();
            $table->string('new_unit_type', 10)->nullable();
            $table->uuid('old_parent_id')->nullable();
            $table->uuid('new_parent_id')->nullable();
            $table->boolean('old_is_active')->nullable();
            $table->boolean('new_is_active')->nullable();
            $table->text('reason');
            $table->uuid('changed_by');
            $table->timestampTz('changed_at');

            $table->foreign('organizational_unit_id')
                ->references('id')
                ->on('organizational_units')
                ->restrictOnDelete();
            $table->foreign('changed_by')
                ->references('id')
                ->on('users')
                ->restrictOnDelete();
            $table->index(['organizational_unit_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organizational_unit_histories');
    }
};
