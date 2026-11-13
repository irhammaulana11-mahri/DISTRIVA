<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Owner 8 Nov 2026: the first drawing package and the survey are ONE package with ONE approval chain (docs/62 §48). A drawing version submitted while a survey version is still open
// "rides" it: this column links them, the survey decisions move the drawing through the same stages, and the drawing is approved when the survey is accepted.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_drawing_versions', function (Blueprint $table): void {
            $table->foreignUuid('survey_version_id')->nullable()->constrained('application_survey_versions')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('application_drawing_versions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('survey_version_id');
        });
    }
};
