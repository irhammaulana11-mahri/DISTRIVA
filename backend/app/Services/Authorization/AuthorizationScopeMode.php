<?php

namespace App\Services\Authorization;

enum AuthorizationScopeMode: string
{
    case SYSTEM = 'system';
    case SAME_UNIT = 'same_unit';
    case UP3_DESCENDANT_READ = 'up3_descendant_read';
    /** Administration actions (docs/54 D-5): own UP3 and its child ULPs, only for configured admin keys and the UP3_ADMIN role. */
    case UP3_ADMIN_DELEGATION = 'up3_admin_delegation';
}
