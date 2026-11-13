<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Authorization\AuthorizationContext;
use App\Services\Authorization\AuthorizationScopeMode as Mode;
use App\Services\Authorization\ScopedAuthorizationService;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\Test;
use Spatie\Permission\Models\Permission;
use Tests\PostgresTestCase;

class PostgresAuthorizationServiceTest extends PostgresTestCase
{
    private const PERM = 'test.catalog.permission';

    private function service(): ScopedAuthorizationService
    {
        return $this->app->make(ScopedAuthorizationService::class);
    }

    private function roleWithPerm(string $name, bool $scoped = true)
    {
        $role = $this->makeRole($name, $scoped);
        $role->givePermissionTo(Permission::findOrCreate(self::PERM, 'web'));

        return $role;
    }

    private function allows($user, ?OrganizationalUnit $unit, Mode $mode = Mode::SAME_UNIT, string $date = '2026-11-05'): bool
    {
        return $this->service()->allows($user, self::PERM, new AuthorizationContext($mode, $unit), CarbonImmutable::parse($date, 'Asia/Jakarta'));
    }

    #[Test]
    public function same_unit_assignment_is_allowed_and_other_unit_denied_via_real_queries(): void
    {
        $user = $this->makeUser();
        $a = $this->makeUnit('UP3');
        $b = $this->makeUnit('UP3');
        $this->assign($user, $this->roleWithPerm('TEKNIK'), $a);

        $this->assertTrue($this->allows($user, $a));
        $this->assertFalse($this->allows($user, $b));
    }

    #[Test]
    public function inclusive_date_boundaries_and_inactive_states_are_enforced(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $this->assign($user, $this->roleWithPerm('TEKNIK'), $unit, '2026-11-05', '2026-11-10');

        $this->assertFalse($this->allows($user, $unit, date: '2026-11-04'));
        $this->assertTrue($this->allows($user, $unit, date: '2026-11-05'));
        $this->assertTrue($this->allows($user, $unit, date: '2026-11-10'));
        $this->assertFalse($this->allows($user, $unit, date: '2026-11-11'));

        $user->update(['account_status' => 'SUSPENDED']);
        $this->assertFalse($this->allows($user->fresh(), $unit, date: '2026-11-06'));
    }

    #[Test]
    public function deactivated_assignment_or_unit_denies(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $assignment = $this->assign($user, $this->roleWithPerm('TEKNIK'), $unit);
        $this->assertTrue($this->allows($user, $unit));

        $assignment->update(['is_active' => false]);
        $this->assertFalse($this->allows($user, $unit));

        $assignment->update(['is_active' => true]);
        $unit->update(['is_active' => false]);
        $this->assertFalse($this->allows($user, $unit->fresh()));
    }

    #[Test]
    public function up3_descendant_read_only_applies_to_own_child_ulp_in_that_mode(): void
    {
        $up3 = $this->makeUnit('UP3');
        $otherUp3 = $this->makeUnit('UP3');
        $ulp = $this->makeUnit('ULP', $up3);
        $foreignUlp = $this->makeUnit('ULP', $otherUp3);
        $user = $this->makeUser();
        $this->assign($user, $this->roleWithPerm('KONSTRUKSI_UP3'), $up3);

        $this->assertFalse($this->allows($user, $ulp, Mode::SAME_UNIT));
        $this->assertTrue($this->allows($user, $ulp, Mode::UP3_DESCENDANT_READ));
        $this->assertFalse($this->allows($user, $foreignUlp, Mode::UP3_DESCENDANT_READ));
    }

    #[Test]
    public function sys_admin_has_system_context_only_and_no_business_unit_access(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $this->assign($user, $this->roleWithPerm('SYS_ADMIN', false), null);

        $this->assertTrue($this->allows($user, null, Mode::SYSTEM));
        $this->assertFalse($this->allows($user, $unit));
        $this->assertFalse($this->allows($user, $unit, Mode::UP3_DESCENDANT_READ));
    }

    #[Test]
    public function vendor_is_denied_even_with_assignment_and_catalog_permission(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $this->assign($user, $this->roleWithPerm('VENDOR'), $unit);

        $this->assertFalse($this->allows($user, $unit));
    }

    #[Test]
    public function permission_must_exist_in_the_catalog_for_the_role(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $this->assign($user, $this->makeRole('TEKNIK'), $unit); // no permission granted

        $this->assertFalse($this->allows($user, $unit));
    }
}
