<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizational_units', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 30)->unique();
            $table->string('name', 150);
            $table->string('unit_type', 10);
            $table->uuid('parent_id')->nullable();
            $table->text('address')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();

            $table->index('parent_id');
            $table->index(['unit_type', 'is_active']);
        });

        Schema::table('organizational_units', function (Blueprint $table) {
            $table->foreign('parent_id')
                ->references('id')
                ->on('organizational_units')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organizational_units');
    }
};
