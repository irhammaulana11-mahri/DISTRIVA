<?php

namespace App\Services\Authorization;

use App\Models\UserRoleAssignment;

interface VendorScopeAuthorizer
{
    public function allows(
        UserRoleAssignment $assignment,
        AuthorizationContext $context,
    ): bool;
}
