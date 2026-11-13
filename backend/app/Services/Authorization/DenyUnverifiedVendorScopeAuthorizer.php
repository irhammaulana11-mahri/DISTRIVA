<?php

namespace App\Services\Authorization;

use App\Models\UserRoleAssignment;

class DenyUnverifiedVendorScopeAuthorizer implements VendorScopeAuthorizer
{
    public function allows(
        UserRoleAssignment $assignment,
        AuthorizationContext $context,
    ): bool {
        return false;
    }
}
