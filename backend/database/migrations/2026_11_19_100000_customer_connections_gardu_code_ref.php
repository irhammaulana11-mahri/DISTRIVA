<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Migrations\Migration;

// The DIL of March 2026 no longer carries the GADIS number in NOMOR_GARDU (51453GD010000330276) but names the gardu in NAMA_GARDU ("GD HD0008 PENYULANG DENANYAR", "CEWENG-HD742"): the gardu code found
// there is kept (padded: HD742 -> HD0742) as `gardu_code_ref`, and a customer links to the gardu of that code in its own ULP (source DIL_NAMA). docs/84.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_connections', function ($table) {
            $table->string('gardu_code_ref', 20)->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('customer_connections', function ($table) {
            $table->dropColumn('gardu_code_ref');
        });
    }
};
