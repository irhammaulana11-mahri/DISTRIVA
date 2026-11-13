<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

// The gardu induk (GI) a feeder comes from, by NAME (docs/83 §6): `gi_code` keeps the Maximo code (JMBNG), `gi_name` the readable name (JOMBANG) from the owner's feeder list (rayon / GI / penyulang).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('distribution_feeders', function ($table) {
            $table->string('gi_name', 60)->nullable()->after('gi_code');
        });
    }

    public function down(): void
    {
        Schema::table('distribution_feeders', function ($table) {
            $table->dropColumn('gi_name');
        });
    }
};
