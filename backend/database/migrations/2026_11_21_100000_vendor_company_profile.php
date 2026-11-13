<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Profil lengkap perusahaan vendor: identitas legal, alamat dan kontak, penanggung jawab (PIC), kualifikasi usaha (SBU), kontrak/SPK dan rekening. Semua opsional kecuali kode dan nama.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendor_companies', function (Blueprint $table) {
            $table->string('npwp', 25)->nullable();
            $table->string('nib', 40)->nullable();                          // Nomor Induk Berusaha
            $table->text('address')->nullable();
            $table->string('city', 100)->nullable();
            $table->string('province', 100)->nullable();
            $table->string('postal_code', 10)->nullable();
            $table->string('phone', 30)->nullable();
            $table->string('email', 150)->nullable();
            $table->string('website', 150)->nullable();
            $table->string('pic_name', 150)->nullable();
            $table->string('pic_position', 100)->nullable();
            $table->string('pic_phone', 30)->nullable();
            $table->string('pic_email', 150)->nullable();
            $table->string('sbu_classification', 150)->nullable();          // bidang/kualifikasi usaha
            $table->string('sbu_number', 60)->nullable();
            $table->date('sbu_valid_until')->nullable();
            $table->string('contract_number', 100)->nullable();             // nomor kontrak payung / SPK
            $table->date('contract_valid_from')->nullable();
            $table->date('contract_valid_until')->nullable();
            $table->string('bank_name', 100)->nullable();
            $table->string('bank_account_number', 40)->nullable();
            $table->string('bank_account_name', 150)->nullable();
            $table->text('notes')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('vendor_companies', function (Blueprint $table) {
            $table->dropColumn(['npwp', 'nib', 'address', 'city', 'province', 'postal_code', 'phone', 'email', 'website', 'pic_name', 'pic_position', 'pic_phone', 'pic_email', 'sbu_classification', 'sbu_number', 'sbu_valid_until',
                'contract_number', 'contract_valid_from', 'contract_valid_until', 'bank_name', 'bank_account_number', 'bank_account_name', 'notes']);
        });
    }
};
