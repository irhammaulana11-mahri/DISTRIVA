<?php

namespace App\Services\Authorization;

use App\Models\OrganizationalUnit;

final readonly class AuthorizationContext
{
    public function __construct(
        public AuthorizationScopeMode $scopeMode,
        public ?OrganizationalUnit $organizationalUnit = null,
        public ?string $vendorCompanyId = null,
        public ?string $projectId = null,
        public ?string $workOrderId = null,
    ) {}

    public function hasCompleteVendorScope(): bool
    {
        return filled($this->vendorCompanyId)
            && filled($this->projectId)
            && filled($this->workOrderId);
    }
}
