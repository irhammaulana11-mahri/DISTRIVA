<?php

namespace App\Console\Commands;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Authorization\AssignmentWriteService;
use App\Services\OrganizationalUnitWriteService;
use App\Services\PasswordPolicy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * One-time console bootstrap of the very first administrator (docs/55 "Masalah bootstrap").
 * The API cannot create the first admin: SYS_ADMIN writes are closed until MFA exists (docs/54 D-3).
 *
 * Each role can be bootstrapped only once: the command refuses if the role already has ANY assignment
 * row. All writes go through the audited write services in a single transaction.
 */
class BootstrapAdmin extends Command
{
    protected $signature = 'distriva:bootstrap-admin
        {--role=ADMIN : ADMIN (creates the first UP3 too) or SYS_ADMIN}
        {--email= : E-mail of the new administrator}
        {--name= : Full name}
        {--unit-code= : Code of the first UP3 (ADMIN only)}
        {--unit-name= : Name of the first UP3 (ADMIN only)}
        {--force : Do not ask for confirmation}';

    protected $description = 'Create the first ADMIN (with its UP3) or SYS_ADMIN from the console, once per role.';

    public function handle(AssignmentWriteService $assignments, OrganizationalUnitWriteService $units, PasswordPolicy $policy): int
    {
        $roleName = (string) $this->option('role');
        if (! in_array($roleName, ['ADMIN', 'SYS_ADMIN'], true)) {
            $this->error('--role harus ADMIN atau SYS_ADMIN.');

            return self::INVALID;
        }

        $input = [
            'email' => (string) $this->option('email'),
            'name' => (string) $this->option('name'),
            'unit_code' => (string) $this->option('unit-code'),
            'unit_name' => (string) $this->option('unit-name'),
        ];
        $rules = [
            'email' => ['required', 'email', 'max:150'],
            'name' => ['required', 'string', 'max:150'],
        ];
        if ($roleName === 'ADMIN') {
            $rules += ['unit_code' => ['required', 'string', 'max:30'], 'unit_name' => ['required', 'string', 'max:150']];
        }
        $validator = Validator::make($input, $rules);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }

            return self::INVALID;
        }

        $role = Role::query()->where(['name' => $roleName, 'guard_name' => config('distriva.authorization_guard')])->first();
        if ($role === null) {
            $this->error('Role belum ada. Jalankan dulu: php artisan db:seed --class=FoundationPermissionSeeder');

            return self::FAILURE;
        }
        if (DB::table('user_role_assignments')->where('role_id', $role->getKey())->exists()) {
            $this->error("Ditolak: role {$roleName} sudah memiliki penugasan. Perintah ini hanya untuk bootstrap pertama.");

            return self::FAILURE;
        }
        if (User::query()->where('email', mb_strtolower(trim($input['email'])))->exists()) {
            $this->error('Ditolak: email sudah terdaftar.');

            return self::FAILURE;
        }
        if ($roleName === 'ADMIN' && OrganizationalUnit::query()->where('code', trim($input['unit_code']))->exists()) {
            $this->error('Ditolak: kode unit sudah ada (kode tidak boleh dipakai ulang).');

            return self::FAILURE;
        }

        $database = DB::connection()->getDatabaseName();
        $this->warn("Target database: {$database}");
        if (! $this->option('force') && ! $this->confirm("Buat {$roleName} pertama '{$input['name']}' <{$input['email']}> di database ini?")) {
            $this->line('Dibatalkan.');

            return self::SUCCESS;
        }

        $password = $policy->generate();

        try {
            DB::transaction(function () use ($input, $role, $roleName, $password, $assignments, $units): void {
                $user = new User(['name' => trim($input['name']), 'email' => $input['email'], 'password' => $password, 'account_status' => 'ACTIVE']);
                $user->must_change_password = true;
                $user->save();

                $reason = 'Bootstrap administrator pertama melalui konsol (docs/55).';
                $unit = null;
                if ($roleName === 'ADMIN') {
                    // The new account is the audit actor: no other ACTIVE actor exists yet.
                    $unit = $units->create(trim($input['unit_code']), trim($input['unit_name']), 'UP3', null, null, $reason, $user);
                }
                $assignments->assign($user, $role, $unit, now(config('distriva.business_timezone'))->toDateString(), null, $reason, $user, null, 'BOOTSTRAP-CONSOLE');
            });
        } catch (AssignmentRuleViolation $e) {
            $this->error('Gagal: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info("{$roleName} pertama berhasil dibuat.");
        $this->line("Email             : {$input['email']}");
        $this->line("Password sementara: {$password}");
        $this->warn('Catat sekarang — password ini tidak disimpan dan tidak ditampilkan lagi. Wajib diganti saat login pertama.');
        $this->line('Catatan: password bootstrap sengaja tidak kedaluwarsa 24 jam (admin ini satu-satunya yang dapat menerbitkan ulang kredensial); segera ganti.');

        return self::SUCCESS;
    }
}
