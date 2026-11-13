<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Survey carries the KKO and the "no extension" outcome (owner 2026-11-14, docs/82): a version keeps the KKO it was submitted with (kko_id + a snapshot of its key figures, so a later re-record of the KKO
 * does not rewrite what the survey judged) and the reason the surveyor gives when "no extension" is chosen although the KKO shows a heavy overload or a low voltage.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_survey_versions', function (Blueprint $table) {
            $table->text('no_extension_reason')->nullable();
            $table->foreignUuid('kko_id')->nullable()->constrained('application_kko')->restrictOnDelete();
            $table->jsonb('kko_snapshot')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('application_survey_versions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('kko_id');
            $table->dropColumn(['no_extension_reason', 'kko_snapshot']);
        });
    }
};
