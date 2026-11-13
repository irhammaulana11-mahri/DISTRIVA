<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Spatie\Permission\Models\Role as SpatieRole;

class Role extends SpatieRole
{
    protected function casts(): array
    {
        return [
            'requires_unit_scope' => 'boolean',
        ];
    }

    public function userAssignments(): HasMany
    {
        return $this->hasMany(UserRoleAssignment::class);
    }
}
