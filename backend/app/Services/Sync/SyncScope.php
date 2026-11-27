<?php

namespace App\Services\Sync;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Support\Facades\DB;

/** UP3 yang boleh dilihat dan ditarik seorang pengguna untuk suatu izin sinkronisasi (docs/94). */
class SyncScope
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer) {}

    /**
     * SYS_ADMIN: semua UP3 aktif. Lainnya: UP3 tempat ia bertugas, atau induk ULP tempat ia bertugas, bila perannya memegang izin itu.
     *
     * @return list<string>
     */
    public function up3Ids(User $actor, string $permission): array
    {
        $guard = (string) config('distriva.authorization_guard');
        $ids = [];
        foreach ($this->authorizer->effectiveAssignments($actor) as $a) {
            if ($a->role === null) {
                continue;
            }
            if ($a->role->name === 'SYS_ADMIN') {
                return DB::table('organizational_units')->where('unit_type', 'UP3')->where('is_active', true)->orderBy('code')->pluck('id')->all();
            }
            $unit = $a->organizationalUnit;
            if ($unit !== null && $a->role->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard)) {
                $ids[] = $unit->unit_type === 'UP3' ? $unit->getKey() : $unit->parent_id;
            }
        }

        return array_values(array_unique(array_filter($ids)));
    }

    /**
     * UP3 yang dipakai sebuah permintaan. Tanpa pilihan: satu-satunya UP3 pengguna, atau UP3 utama bila pengguna mencakup beberapa.
     *
     * @throws AdministrationDenied 403 tanpa cakupan, 404 di luar cakupan
     * @throws AssignmentRuleViolation bila UP3 harus dipilih
     */
    public function resolve(User $actor, string $permission, ?string $requested = null): string
    {
        $ids = $this->up3Ids($actor, $permission);
        if ($ids === []) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
        if ($requested !== null) {
            if (! in_array($requested, $ids, true)) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }

            return $requested;
        }
        if (count($ids) === 1) {
            return $ids[0];
        }
        $default = self::defaultUp3();

        return in_array($default, $ids, true) ? $default : throw new AssignmentRuleViolation('Pilih UP3 (up3_id).');
    }

    /** Pengguna bertugas pada UP3 itu sendiri (atau SYS_ADMIN), sehingga boleh bertindak atas seluruh UP3. */
    public function coversUp3(User $actor, string $permission, string $up3Id): bool
    {
        $guard = (string) config('distriva.authorization_guard');
        foreach ($this->authorizer->effectiveAssignments($actor) as $a) {
            if ($a->role?->name === 'SYS_ADMIN' || ($a->organizationalUnit?->getKey() === $up3Id && $a->role?->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Pengaturan sinkronisasi UP3 (akun, alamat, jadwal) dipakai semua ULP-nya, jadi hanya diubah dari tingkat UP3.
     *
     * @throws AdministrationDenied
     */
    public function assertManagesUp3(User $actor, string $permission, string $up3Id): void
    {
        if (! $this->coversUp3($actor, $permission, $up3Id)) {
            throw new AdministrationDenied('Pengaturan sinkronisasi UP3 hanya dapat diubah dari tingkat UP3.', 403);
        }
    }

    /**
     * ULP aktif UP3 itu yang boleh ditarik pengguna: semuanya bila ia mencakup UP3, selain itu hanya ULP tempat ia bertugas.
     *
     * @return list<object> (id, code, name)
     */
    public function ulpsFor(User $actor, string $permission, string $up3Id): array
    {
        $all = self::ulps($up3Id);
        if ($this->coversUp3($actor, $permission, $up3Id)) {
            return $all;
        }
        $guard = (string) config('distriva.authorization_guard');
        $own = [];
        foreach ($this->authorizer->effectiveAssignments($actor) as $a) {
            if ($a->role?->permissions->contains(fn ($p) => $p->name === $permission && $p->guard_name === $guard)) {
                $own[] = $a->organizationalUnit?->getKey();
            }
        }

        return array_values(array_filter($all, fn (object $u) => in_array($u->id, $own, true)));
    }

    /** Tingkat sebuah permintaan untuk keterangan "dijalankan oleh siapa": UP3, atau ULP pengguna. */
    public function level(User $actor, string $permission, string $up3Id): string
    {
        return $this->coversUp3($actor, $permission, $up3Id) ? $up3Id : ($this->ulpsFor($actor, $permission, $up3Id)[0]->id ?? $up3Id);
    }

    /** @return list<array{id: string, name: string}> */
    public function options(User $actor, string $permission): array
    {
        return DB::table('organizational_units')->whereIn('id', $this->up3Ids($actor, $permission))->orderBy('name')->get(['id', 'name'])
            ->map(fn (object $u) => ['id' => $u->id, 'name' => $u->name])->all();
    }

    /**
     * UP3 utama: pemilik data sebelum sinkronisasi dipisah per UP3, yaitu pemilik pengaturan sinkronisasi pertama. Bila belum ada pemiliknya, UP3 dengan gardu terbanyak,
     * lalu ULP aktif terbanyak. Pilihannya tidak boleh berpindah hanya karena unit baru ditambahkan.
     */
    public static function defaultUp3(): ?string
    {
        return DB::table('eis_sync_settings')->where('id', 1)->value('up3_id')
            ?? DB::table('organizational_units as p')->where('p.unit_type', 'UP3')
                ->orderByRaw("(select count(*) from substations s join organizational_units c on c.id = s.organizational_unit_id where c.parent_id = p.id) desc,
                    (select count(*) from organizational_units c where c.parent_id = p.id and c.unit_type = 'ULP' and c.is_active) desc, p.code")->value('p.id');
    }

    /** @return list<string> gudang milik UP3 itu: unit gudang adalah UP3 tersebut atau salah satu unit di bawahnya */
    public static function warehouseIds(array $up3Ids): array
    {
        return DB::table('warehouses as w')->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')
            ->where(fn ($q) => $q->whereIn('u.id', $up3Ids)->orWhereIn('u.parent_id', $up3Ids))->pluck('w.id')->all();
    }

    /** @return list<object> ULP aktif di bawah UP3 itu (id, code, name) */
    public static function ulps(string $up3Id): array
    {
        return DB::table('organizational_units')->where('parent_id', $up3Id)->where('unit_type', 'ULP')->where('is_active', true)->orderBy('code')->get(['id', 'code', 'name'])->all();
    }

    /**
     * Baris pengaturan sinkronisasi milik satu UP3. Baris lama yang belum dimiliki siapa pun menjadi milik UP3 utama; UP3 lain mendapat baris baru dengan nilai bawaan.
     */
    public static function settings(string $table, ?string $up3Id): object
    {
        if ($up3Id === null) {
            return DB::table($table)->orderBy('id')->first();
        }
        $row = DB::table($table)->where('up3_id', $up3Id)->first();
        if ($row !== null) {
            return $row;
        }
        DB::transaction(function () use ($table, $up3Id) {
            DB::select('select pg_advisory_xact_lock(hashtext(?))', [$table]);
            if (DB::table($table)->where('up3_id', $up3Id)->exists()) {
                return;
            }
            $claimed = $up3Id === self::defaultUp3() && DB::table($table)->whereNull('up3_id')->update(['up3_id' => $up3Id]) > 0;
            $claimed || DB::table($table)->insert(['id' => (int) DB::table($table)->max('id') + 1, 'up3_id' => $up3Id]);
        });

        return DB::table($table)->where('up3_id', $up3Id)->first();
    }
}
