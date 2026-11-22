<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\DrawingPermissionSeeder;
use Database\Seeders\KkfPermissionSeeder;
use Database\Seeders\KkoPermissionSeeder;
use Database\Seeders\MasterDataPermissionSeeder;
use Database\Seeders\MtoPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Database\Seeders\RabPermissionSeeder;
use Database\Seeders\SubstationPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** The UP3 / ULP filter is accepted (and validated) by every operational list that has one. The narrowing itself is covered in the tests of the lists with data (tasks, warehouses, customers, gardu). */
class UnitFilterListsTest extends PostgresTestCase
{
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        foreach ([KkoPermissionSeeder::class, SurveyPermissionSeeder::class, DrawingPermissionSeeder::class, MtoPermissionSeeder::class, RabPermissionSeeder::class, KkfPermissionSeeder::class, PlanningPermissionSeeder::class, MasterDataPermissionSeeder::class, SubstationPermissionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
        $this->admin = $this->makeUser();
        $this->assign($this->admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    #[Test]
    public function every_operational_list_accepts_the_unit_filter_and_refuses_a_malformed_one(): void
    {
        $up3 = $this->makeUnit('UP3');
        $ulp = $this->makeUnit('ULP', $up3);
        foreach (['/api/tasks', '/api/surveys', '/api/proposals', '/api/work-orders', '/api/pole-work-orders', '/api/material-requests'] as $url) {
            $this->as($this->admin)->getJson("{$url}?up3_id={$up3->getKey()}&unit_id={$ulp->getKey()}")->assertOk();
            $this->as($this->admin)->getJson("{$url}?unit_id=bukan-uuid")->assertStatus(422);
        }
    }
}
