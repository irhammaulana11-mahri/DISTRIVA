<?php

namespace App\Services\WorkOrders;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Simple vendor master (docs/62 §32): companies and the vendor accounts linked to them (one account = one company). Callers authorize `vendors.manage` first. */
class VendorService
{
    /** The profile columns of a vendor company (all optional). */
    public const PROFILE_FIELDS = ['npwp', 'nib', 'address', 'city', 'province', 'postal_code', 'phone', 'email', 'website', 'pic_name', 'pic_position', 'pic_phone', 'pic_email', 'sbu_classification', 'sbu_number', 'sbu_valid_until',
        'contract_number', 'contract_valid_from', 'contract_valid_until', 'bank_name', 'bank_account_number', 'bank_account_name', 'notes', 'work_scope'];

    /** @param array<string,mixed> $profile @return array<string,mixed> only the profile columns, blank strings stored as null */
    private static function cleanProfile(array $profile): array
    {
        $out = [];
        foreach (self::PROFILE_FIELDS as $f) {
            if (array_key_exists($f, $profile)) {
                $v = is_string($profile[$f]) ? trim($profile[$f]) : $profile[$f];
                if ($f === 'work_scope' && ($v === '' || $v === null)) {
                    continue;   // never null: the column defaults to KEDUANYA
                }
                $out[$f] = $v === '' ? null : $v;
            }
        }

        return $out;
    }

    /** @param array<string,mixed> $profile */
    public function createCompany(string $code, string $name, User $actor, array $profile = []): string
    {
        $id = (string) Str::uuid();
        try {
            DB::transaction(fn () => DB::table('vendor_companies')->insert(['id' => $id, 'code' => strtoupper(trim($code)), 'name' => trim($name), 'status' => 'ACTIVE', 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()] + self::cleanProfile($profile)));
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Kode perusahaan vendor sudah dipakai.', 0, $e) : $e;
        }

        return $id;
    }

    /** Replaces the name and the profile fields given (code and status do not change here). @param array<string,mixed> $data */
    public function updateProfile(string $companyId, array $data): void
    {
        DB::table('vendor_companies')->where('id', $companyId)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $set = self::cleanProfile($data);
        if (isset($data['name'])) {
            $set['name'] = trim((string) $data['name']);
        }
        DB::table('vendor_companies')->where('id', $companyId)->update($set + ['updated_at' => now()]);
    }

    public function setStatus(string $companyId, string $status): void
    {
        DB::table('vendor_companies')->where('id', $companyId)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        DB::table('vendor_companies')->where('id', $companyId)->update(['status' => $status, 'updated_at' => now()]);
    }

    public function linkAccount(string $companyId, string $userId, User $actor): string
    {
        DB::table('vendor_companies')->where('id', $companyId)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $user = User::query()->find($userId) ?? throw new AssignmentRuleViolation('Pengguna tidak ditemukan.');
        $isVendor = DB::table('user_role_assignments as a')->join('roles as r', 'r.id', '=', 'a.role_id')->where('a.user_id', $userId)->where('r.name', 'VENDOR')->where('a.is_active', true)->exists();
        if (! $isVendor || ! in_array($user->account_status, ['ACTIVE', 'PENDING_ACTIVATION'], true)) {
            throw new AssignmentRuleViolation('Akun harus aktif (atau menunggu aktivasi) dan memiliki penugasan peran VENDOR.');
        }
        $id = (string) Str::uuid();
        try {
            DB::transaction(fn () => DB::table('vendor_accounts')->insert(['id' => $id, 'user_id' => $userId, 'vendor_company_id' => $companyId, 'is_active' => true, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Akun ini sudah tertaut ke perusahaan vendor.', 0, $e) : $e;
        }

        return $id;
    }

    public function deactivateAccount(string $accountId): void
    {
        DB::table('vendor_accounts')->where('id', $accountId)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        DB::table('vendor_accounts')->where('id', $accountId)->update(['is_active' => false, 'updated_at' => now()]);
    }

    /** The active company of a vendor user, or null (no account, inactive account, suspended company or inactive user). */
    public static function companyOf(User $user): ?string
    {
        if ($user->account_status !== 'ACTIVE') {
            return null;
        }
        $row = DB::table('vendor_accounts as a')->join('vendor_companies as c', 'c.id', '=', 'a.vendor_company_id')->where('a.user_id', $user->getKey())->where('a.is_active', true)->where('c.status', 'ACTIVE')->first(['c.id']);

        return $row?->id;
    }
}
