<?php

namespace Tests\Unit;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Authorization\AuthorizationContext;
use App\Services\Authorization\AuthorizationScopeMode;
use App\Services\Authorization\DenyUnverifiedVendorScopeAuthorizer;
use App\Services\Authorization\ScopedAuthorizationService;
use App\Services\Authorization\VendorScopeAuthorizer;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Mockery;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class ScopedAuthorizationServiceTest extends TestCase
{
    #[Test]
    public function it_grants_a_permission_for_an_effective_assignment_on_the_same_unit(): void
    {
        $unit = $this->unit('ULP');
        $assignment = $this->assignment($this->role('TEKNIK', ['applications.view']), $unit);

        $this->assertTrue($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
            CarbonImmutable::parse('2026-11-05', 'Asia/Jakarta'),
        ));
    }

    #[Test]
    public function it_rejects_non_active_accounts(): void
    {
        $service = new TestScopedAuthorizationService(
            new DenyUnverifiedVendorScopeAuthorizer,
            new Collection([$this->assignment(
                $this->role('TEKNIK', ['applications.view']),
                $this->unit('ULP'),
            )]),
        );

        $this->assertFalse($service->allows(
            $this->user('SUSPENDED'),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $this->unit('ULP')),
        ));
        $this->assertFalse($service->assignmentsWereRequested);
    }

    #[Test]
    public function it_rejects_inactive_assignments_and_assignments_outside_the_validity_dates(): void
    {
        $unit = $this->unit('ULP');
        $role = $this->role('TEKNIK', ['applications.view']);
        $inactive = $this->assignment($role, $unit, isActive: false);
        $notStarted = $this->assignment($role, $unit, validFrom: '2026-11-06');
        $expired = $this->assignment($role, $unit, validUntil: '2026-11-04');
        $service = $this->service([$inactive, $notStarted, $expired]);

        $this->assertFalse($service->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
            CarbonImmutable::parse('2026-11-05', 'Asia/Jakarta'),
        ));
    }

    #[Test]
    public function assignment_validity_dates_are_inclusive(): void
    {
        $unit = $this->unit('ULP');
        $assignment = $this->assignment(
            $this->role('TEKNIK', ['applications.view']),
            $unit,
            validFrom: '2026-11-05',
            validUntil: '2026-11-05',
        );
        $service = $this->service([$assignment]);

        $this->assertTrue($service->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
            CarbonImmutable::parse('2026-11-05', 'Asia/Jakarta'),
        ));
    }

    #[Test]
    public function an_effective_assignment_must_have_an_active_unit(): void
    {
        $unit = $this->unit('ULP', isActive: false);
        $assignment = $this->assignment($this->role('TEKNIK', ['applications.view']), $unit);

        $this->assertFalse($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
        ));
    }

    #[Test]
    public function it_checks_multiple_assignments_without_using_a_user_role_pivot(): void
    {
        $firstUnit = $this->unit('ULP');
        $secondUnit = $this->unit('UP3');
        $assignments = [
            $this->assignment($this->role('TEKNIK', ['drawings.view']), $firstUnit),
            $this->assignment($this->role('PERENCANAAN', ['applications.view']), $secondUnit),
        ];

        $this->assertTrue($this->service($assignments)->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $secondUnit),
        ));
    }

    #[Test]
    public function it_does_not_accept_an_assignment_belonging_to_a_different_user(): void
    {
        $unit = $this->unit('ULP');
        $assignment = $this->assignment($this->role('TEKNIK', ['applications.view']), $unit);
        $assignment->user_id = 'another-user';

        $this->assertFalse($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
        ));
    }

    #[Test]
    public function it_rejects_a_different_unit_by_default(): void
    {
        $assignedUnit = $this->unit('ULP');
        $targetUnit = $this->unit('ULP');
        $assignment = $this->assignment($this->role('TEKNIK', ['applications.view']), $assignedUnit);

        $this->assertFalse($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $targetUnit),
        ));
    }

    #[Test]
    public function an_up3_assignment_can_read_a_child_ulp_only_in_the_explicit_descendant_mode(): void
    {
        $up3 = $this->unit('UP3');
        $ulp = $this->unit('ULP', parentId: $up3->getKey());
        $assignment = $this->assignment($this->role('UP3_MANAGER', ['applications.view']), $up3);
        $service = $this->service([$assignment]);

        $this->assertFalse($service->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $ulp),
        ));
        $this->assertTrue($service->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::UP3_DESCENDANT_READ, $ulp),
        ));
    }

    #[Test]
    public function a_global_sys_admin_assignment_only_authorizes_explicit_system_scope(): void
    {
        $assignment = $this->assignment(
            $this->role('SYS_ADMIN', ['configuration.manage'], requiresUnitScope: false),
            null,
        );
        $service = $this->service([$assignment]);

        $this->assertTrue($service->allows(
            $this->user(),
            'configuration.manage',
            new AuthorizationContext(AuthorizationScopeMode::SYSTEM),
        ));
        $this->assertFalse($service->allows(
            $this->user(),
            'configuration.manage',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $this->unit('UP3')),
        ));
    }

    #[Test]
    public function it_rejects_permissions_missing_from_the_role_catalog(): void
    {
        $unit = $this->unit('ULP');
        $assignment = $this->assignment($this->role('TEKNIK', ['drawings.view']), $unit);

        $this->assertFalse($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
        ));
    }

    #[Test]
    public function it_rejects_a_role_from_a_non_canonical_guard(): void
    {
        $unit = $this->unit('ULP');
        $assignment = $this->assignment($this->role('TEKNIK', ['applications.view'], guard: 'api'), $unit);

        $this->assertFalse($this->service([$assignment])->allows(
            $this->user(),
            'applications.view',
            new AuthorizationContext(AuthorizationScopeMode::SAME_UNIT, $unit),
        ));
    }

    #[Test]
    public function vendor_assignments_fail_closed_without_verified_company_project_and_work_order_scope(): void
    {
        $unit = $this->unit('UP3');
        $assignment = $this->assignment($this->role('VENDOR', ['work_orders.view']), $unit);
        $context = new AuthorizationContext(
            AuthorizationScopeMode::SAME_UNIT,
            $unit,
            vendorCompanyId: 'vendor-1',
            projectId: 'project-1',
            workOrderId: 'work-order-1',
        );
        $authorizer = Mockery::mock(VendorScopeAuthorizer::class);
        $authorizer->shouldReceive('allows')->once()->with($assignment, $context)->andReturn(false);

        $this->assertFalse($this->service([$assignment], $authorizer)->allows(
            $this->user(),
            'work_orders.view',
            $context,
        ));
    }

    #[Test]
    public function vendor_assignment_requires_all_three_scope_identifiers(): void
    {
        $unit = $this->unit('UP3');
        $assignment = $this->assignment($this->role('VENDOR', ['work_orders.view']), $unit);
        $authorizer = Mockery::mock(VendorScopeAuthorizer::class);
        $authorizer->shouldNotReceive('allows');

        $this->assertFalse($this->service([$assignment], $authorizer)->allows(
            $this->user(),
            'work_orders.view',
            new AuthorizationContext(
                AuthorizationScopeMode::SAME_UNIT,
                $unit,
                vendorCompanyId: 'vendor-1',
                projectId: 'project-1',
            ),
        ));
    }

    #[Test]
    public function the_container_uses_the_fail_closed_vendor_authorizer_by_default(): void
    {
        $this->assertInstanceOf(
            DenyUnverifiedVendorScopeAuthorizer::class,
            app(VendorScopeAuthorizer::class),
        );
    }

    private function service(
        array $assignments,
        ?VendorScopeAuthorizer $vendorScopeAuthorizer = null,
    ): TestScopedAuthorizationService {
        return new TestScopedAuthorizationService(
            $vendorScopeAuthorizer ?? new DenyUnverifiedVendorScopeAuthorizer,
            new Collection($assignments),
        );
    }

    private function user(string $status = 'ACTIVE'): User
    {
        $user = new User;
        $user->setRawAttributes([
            'id' => 'user-1',
            'account_status' => $status,
        ], true);
        $user->exists = true;

        return $user;
    }

    private function role(
        string $name,
        array $permissions,
        bool $requiresUnitScope = true,
        string $guard = 'web',
    ): Role {
        $role = new Role;
        $role->setRawAttributes([
            'id' => 1,
            'name' => $name,
            'guard_name' => $guard,
            'requires_unit_scope' => $requiresUnitScope,
        ], true);
        $role->exists = true;
        $role->setRelation('permissions', new Collection(array_map(
            static function (string $permission) use ($guard): object {
                return (object) [
                    'name' => $permission,
                    'guard_name' => $guard,
                ];
            },
            $permissions,
        )));

        return $role;
    }

    private function unit(
        string $type,
        ?string $parentId = null,
        bool $isActive = true,
    ): OrganizationalUnit {
        $unit = new OrganizationalUnit;
        $unit->setRawAttributes([
            'id' => str()->uuid()->toString(),
            'unit_type' => $type,
            'parent_id' => $parentId,
            'is_active' => $isActive,
        ], true);
        $unit->exists = true;

        return $unit;
    }

    private function assignment(
        Role $role,
        ?OrganizationalUnit $unit,
        bool $isActive = true,
        string $validFrom = '2026-01-01',
        ?string $validUntil = null,
    ): UserRoleAssignment {
        $assignment = new UserRoleAssignment;
        $assignment->setRawAttributes([
            'id' => str()->uuid()->toString(),
            'user_id' => 'user-1',
            'role_id' => $role->getKey(),
            'organizational_unit_id' => $unit?->getKey(),
            'is_active' => $isActive,
            'valid_from' => $validFrom,
            'valid_until' => $validUntil,
        ], true);
        $assignment->exists = true;
        $assignment->setRelation('role', $role);
        $assignment->setRelation('organizationalUnit', $unit);

        return $assignment;
    }
}

class TestScopedAuthorizationService extends ScopedAuthorizationService
{
    public bool $assignmentsWereRequested = false;

    /**
     * @param  Collection<int, UserRoleAssignment>  $assignments
     */
    public function __construct(
        VendorScopeAuthorizer $vendorScopeAuthorizer,
        private readonly Collection $assignments,
    ) {
        parent::__construct($vendorScopeAuthorizer);
    }

    public function effectiveAssignments(
        User $user,
        ?CarbonImmutable $asOf = null,
    ): Collection {
        $this->assignmentsWereRequested = true;

        return $this->assignments;
    }
}
