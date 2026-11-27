<?php

namespace App\Services\Sync;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Akun sistem sumber (EIS, Maximo) per ULP (docs/94). Akun UP3 tetap berada di pengaturan sinkronisasi UP3; ULP tanpa akun sendiri memakai akun UP3.
 * Kata sandi tersimpan terenkripsi dan tidak pernah dikembalikan.
 */
class SyncAccounts
{
    /** sumber => [tabel pengaturan UP3, kolom pengguna, kolom sandi, izin, nama] */
    public const SOURCES = [
        'eis' => ['eis_sync_settings', 'eis_username', 'eis_password_encrypted', 'eis_sync.manage', 'EIS'],
        'maximo' => ['maximo_sync_settings', 'maximo_username', 'maximo_password_encrypted', 'substations.sync', 'Maximo'],
    ];

    /**
     * Membagi ULP yang ditarik menjadi satu kelompok per akun: tiap ULP yang punya akun sendiri, lalu sisanya bersama akun UP3.
     *
     * @param  list<string>  $ulpIds
     * @return list<array{account_unit_id: ?string, ulp_ids: list<string>}>
     *
     * @throws AssignmentRuleViolation bila ada ULP tanpa akun apa pun
     */
    public function groups(string $source, string $up3Id, array $ulpIds): array
    {
        [$settings, $userColumn, $passwordColumn, , $label] = self::SOURCES[$source];
        $own = DB::table('sync_accounts')->where('source', $source)->whereIn('organizational_unit_id', $ulpIds)->pluck('organizational_unit_id')->all();
        $groups = array_map(fn (string $id) => ['account_unit_id' => $id, 'ulp_ids' => [$id]], $own);
        $rest = array_values(array_diff($ulpIds, $own));
        if ($rest === [] && $ulpIds !== []) {
            return $groups;
        }
        $up3 = SyncScope::settings($settings, $up3Id);
        if ($up3->{$userColumn} === null || $up3->{$passwordColumn} === null) {
            $names = DB::table('organizational_units')->whereIn('id', $rest)->orderBy('name')->pluck('name')->implode(', ');
            throw new AssignmentRuleViolation("User dan password {$label} belum diisi".($own === [] || $names === '' ? ' pada pengaturan sinkronisasi.' : " untuk {$names}: isi akun UP3 atau akun ULP-nya."));
        }

        return [...$groups, ['account_unit_id' => null, 'ulp_ids' => $rest]];
    }

    /** @return array{username: string, password: string} akun ULP bila disebut, selain itu akun UP3 */
    public function credentials(string $source, string $up3Id, ?string $accountUnitId): array
    {
        [$settings, $userColumn, $passwordColumn, , $label] = self::SOURCES[$source];
        [$username, $encrypted] = $accountUnitId === null
            ? [($s = SyncScope::settings($settings, $up3Id))->{$userColumn}, $s->{$passwordColumn}]
            : array_values((array) (DB::table('sync_accounts')->where('source', $source)->where('organizational_unit_id', $accountUnitId)->first(['username', 'password_encrypted']) ?? ['username' => null, 'password_encrypted' => null]));
        if ($username === null || $encrypted === null) {
            throw new AssignmentRuleViolation("Akun {$label} untuk run ini sudah tidak tersedia.");
        }
        try {
            return ['username' => (string) $username, 'password' => Crypt::decryptString($encrypted)];
        } catch (DecryptException) {
            throw new AssignmentRuleViolation("Password {$label} tidak dapat dibaca; simpan ulang akunnya.");
        }
    }

    /**
     * @param  list<string>  $ulpIds  ULP yang boleh dilihat pengguna
     * @return list<array<string, mixed>> satu baris per ULP, dengan atau tanpa akun sendiri
     */
    public function list(string $source, array $ulpIds): array
    {
        $accounts = DB::table('sync_accounts as a')->leftJoin('users as u', 'u.id', '=', 'a.updated_by')->where('a.source', $source)->whereIn('a.organizational_unit_id', $ulpIds)
            ->get(['a.organizational_unit_id', 'a.username', 'a.updated_at', 'u.name as updated_by_name'])->keyBy('organizational_unit_id');

        return DB::table('organizational_units')->whereIn('id', $ulpIds)->orderBy('code')->get(['id', 'code', 'name'])->map(function (object $unit) use ($accounts) {
            $a = $accounts[$unit->id] ?? null;

            return ['unit_id' => $unit->id, 'code' => (string) $unit->code, 'name' => $unit->name, 'has_own_account' => $a !== null,
                'username' => $a?->username, 'updated_at' => $a?->updated_at, 'updated_by' => $a?->updated_by_name];
        })->all();
    }

    /** Sandi boleh dikosongkan saat mengubah akun yang sudah ada. */
    public function save(string $source, string $ulpId, string $username, ?string $password, User $actor): void
    {
        $existing = DB::table('sync_accounts')->where('source', $source)->where('organizational_unit_id', $ulpId)->first(['id', 'password_encrypted']);
        $encrypted = filled($password) ? Crypt::encryptString((string) $password) : $existing?->password_encrypted;
        if ($encrypted === null) {
            throw new AssignmentRuleViolation('Password wajib diisi untuk akun baru.');
        }
        $data = ['username' => trim($username), 'password_encrypted' => $encrypted, 'updated_by' => $actor->getKey(), 'updated_at' => now()];
        $existing === null
            ? DB::table('sync_accounts')->insert($data + ['id' => (string) Str::uuid(), 'source' => $source, 'organizational_unit_id' => $ulpId, 'created_at' => now()])
            : DB::table('sync_accounts')->where('id', $existing->id)->update($data);
    }

    public function delete(string $source, string $ulpId): bool
    {
        return DB::table('sync_accounts')->where('source', $source)->where('organizational_unit_id', $ulpId)->delete() > 0;
    }
}
