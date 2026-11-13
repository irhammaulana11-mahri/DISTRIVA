<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// In-app notifications (docs/62 §44): created by the server when something really happens (a draft awaits approval, a decision was taken) and read by its recipient only.
// Not Laravel's `notifications` table: that one is the framework's polymorphic database channel, this one is a plain per-user inbox. The only mutable column is read_at.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('level', 10)->default('info');                 // info | success | warning | error
            $table->string('title', 150);
            $table->text('body')->nullable();
            $table->string('tag', 40)->nullable();                        // module label shown as a chip ("KHS", "BOM", ...)
            $table->string('link', 255)->nullable();                      // in-app path the notification opens
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['user_id', 'read_at', 'created_at']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_level_check CHECK (level IN ('info','success','warning','error'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_notifications');
    }
};
