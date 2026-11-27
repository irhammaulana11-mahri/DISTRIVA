<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\MfaService;
use App\Services\Sync\SyncAccounts;
use App\Services\Sync\SyncScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Akun EIS/Maximo per ULP (docs/94 §7). Admin UP3 mengelola semua ULP di bawahnya; admin ULP hanya akun ULP-nya. Kata sandi tidak pernah dikembalikan.
 */
class SyncAccountController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly MfaService $mfa, private readonly SyncScope $scope, private readonly SyncAccounts $accounts) {}

    /** GET /sync/accounts?source=eis|maximo&up3_id= */
    public function index(Request $request): JsonResponse
    {
        $d = $request->validate(['source' => ['required', 'in:eis,maximo'], 'up3_id' => ['nullable', 'uuid']]);
        $permission = SyncAccounts::SOURCES[$d['source']][3];
        $this->authorizer->authorizeScope($request->user(), $permission);
        $up3Id = $this->scope->resolve($request->user(), $permission, $d['up3_id'] ?? null);

        return response()->json(['data' => $this->accounts->list($d['source'], array_column($this->scope->ulpsFor($request->user(), $permission, $up3Id), 'id')), 'up3_id' => $up3Id]);
    }

    /** PUT /sync/accounts {source, unit_id, username, password?} */
    public function save(Request $request): JsonResponse
    {
        $d = $request->validate(['source' => ['required', 'in:eis,maximo'], 'unit_id' => ['required', 'uuid'], 'username' => ['required', 'string', 'max:150'], 'password' => ['nullable', 'string', 'max:200']]);
        $this->authorizeUnit($request->user(), $d['source'], $d['unit_id']);
        $this->accounts->save($d['source'], $d['unit_id'], $d['username'], $d['password'] ?? null, $request->user());

        return response()->json(['message' => 'Akun sinkronisasi disimpan.']);
    }

    /** DELETE /sync/accounts/{source}/{unit}: ULP kembali memakai akun UP3. */
    public function destroy(Request $request, string $source, string $unit): JsonResponse
    {
        $this->authorizeUnit($request->user(), $source, $unit);
        if (! $this->accounts->delete($source, $unit)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return response()->json(['message' => 'Akun sinkronisasi dihapus; ULP memakai akun UP3.']);
    }

    private function authorizeUnit(User $actor, string $source, string $unitId): void
    {
        $permission = SyncAccounts::SOURCES[$source][3];
        $scope = $this->authorizer->authorizeScope($actor, $permission);
        if ($scope['unrestricted'] && ! $this->mfa->satisfied($actor)) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }
        $up3Id = DB::table('organizational_units')->where('id', $unitId)->where('unit_type', 'ULP')->value('parent_id');
        if ($up3Id === null || ! in_array($up3Id, $this->scope->up3Ids($actor, $permission), true) || ! in_array($unitId, array_column($this->scope->ulpsFor($actor, $permission, $up3Id), 'id'), true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }
}
