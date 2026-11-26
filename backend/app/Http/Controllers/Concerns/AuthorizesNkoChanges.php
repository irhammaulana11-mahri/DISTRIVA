<?php

namespace App\Http\Controllers\Concerns;

use App\Exceptions\AdministrationDenied;
use Illuminate\Http\Request;

/**
 * Perubahan aturan dan definisi NKO berlaku untuk semua unit, sehingga izin tulisnya harus dipegang pada tingkat UP3 (atau SYS_ADMIN dengan MFA).
 * Pemakai harus punya properti `$authorizer` (ApplicationAuthorizer) dan `$mfa` (MfaService).
 */
trait AuthorizesNkoChanges
{
    private function authorizeChange(Request $request, string $key): void
    {
        $actor = $request->user();
        if ($this->authorizer->scopeFor($actor, $key)['unrestricted']) {
            if (! $this->mfa->satisfied($actor)) {
                throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
            }

            return;
        }
        foreach ($this->authorizer->effectiveAssignments($actor) as $assignment) {
            $unit = $assignment->organizationalUnit;
            if ($unit?->unit_type === 'UP3' && $this->authorizer->holdsOnUp3($actor, $key, $unit->getKey())) {
                return;
            }
        }
        throw new AdministrationDenied('Tidak berwenang: aturan dan definisi NKO hanya dapat diubah oleh peran tingkat UP3 yang berizin.', 403);
    }
}
