<?php

namespace App\Services\Sync;

use App\Exceptions\AssignmentRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Kode UP3 yang dikirim ke sistem sumber (docs/94 §9). Kode ULP sama di semua sumber (kode unit); kode UP3 berbeda: EIS dan AP2T memakai kode unit (mis. 51MJK), APKT memakai angka sendiri.
 * UP3 utama tetap memakai nilai konfigurasi bila datanya belum diisi, seperti sebelum sinkronisasi dipisah per UP3. UP3 lain tidak pernah meminjam nilai UP3 utama.
 */
class SyncUnitCodes
{
    /**
     * @return array{id: int, name: string}
     *
     * @throws AssignmentRuleViolation bila id APKT UP3 itu belum diisi
     */
    public static function apkt(?string $up3Id): array
    {
        $unit = $up3Id === null ? null : DB::table('organizational_units')->where('id', $up3Id)->first(['name', 'apkt_id']);
        if ($unit?->apkt_id !== null) {
            return ['id' => (int) $unit->apkt_id, 'name' => Str::upper(trim($unit->name))];
        }
        if ($up3Id === null || $up3Id === SyncScope::defaultUp3()) {
            return ['id' => (int) config('distriva.apkt.id_up3'), 'name' => (string) config('distriva.apkt.name_up3')];
        }

        throw new AssignmentRuleViolation('Id APKT untuk '.($unit?->name ?? 'UP3 ini').' belum diisi; muat daftar unit (distriva:units-load).');
    }

    /** `unitap` AP2T. */
    public static function ap2t(?string $up3Id): string
    {
        return self::otherUp3Code($up3Id) ?? (string) config('distriva.ap2t.unitap');
    }

    /** Kode UP3 bila bukan UP3 utama; null berarti pakai nilai bawaan alat. */
    public static function otherUp3Code(?string $up3Id): ?string
    {
        if ($up3Id === null || $up3Id === SyncScope::defaultUp3()) {
            return null;
        }

        return (string) DB::table('organizational_units')->where('id', $up3Id)->value('code');
    }
}
