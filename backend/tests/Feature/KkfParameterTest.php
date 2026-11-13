<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class KkfParameterTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $up3 = $this->makeUnit('UP3');
        $mk = function (string $role) use ($up3): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $up3);

            return $u;
        };
        $this->engineer = $mk('ENGINEERING');
        $this->manager = $mk('UP3_MANAGER');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
    }

    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    private function create(array $extra = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->postJson('/api/master-data/kkf-parameters', array_merge(['name' => 'Parameter 2026', 'valid_from' => '2026-01-01'], $extra));
    }

    private function approve(string $id, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/kkf-parameters/approve', ['set_ids' => [$id], 'reason' => 'Sesuai keputusan pemilik']);
    }

    #[Test]
    public function owner_defaults_apply_and_a_manager_cannot_approve_own_set(): void
    {
        $id = $this->create()->assertCreated()->json('data.id');
        $row = $this->as($this->viewer)->getJson("/api/master-data/kkf-parameters/{$id}")->assertOk()->json('data');
        $this->assertEquals(0.0778, $row['discount_rate']);
        $this->assertEquals(552, $row['bpp']);
        $this->assertSame(25, $row['horizon_years']);
        $this->assertSame('DRAFT', $row['status']);
        $this->approve($id, $this->engineer)->assertForbidden();
        $this->approve($id)->assertOk()->assertJsonPath('data.approved', 1);
        $this->as($this->viewer)->getJson('/api/master-data/kkf-parameters/active?date=2026-06-01')->assertOk()->assertJsonPath('data.id', $id);
        $this->as($this->viewer)->getJson('/api/master-data/kkf-parameters/active?date=2025-06-01')->assertNotFound();
    }

    #[Test]
    public function sys_admin_can_approve_own_parameter_set(): void
    {
        $sys = $this->makeUser();
        $this->assign($sys, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);

        $id = $this->create([], $sys)->assertCreated()->json('data.id');
        $this->approve($id, $sys)->assertOk()->assertJsonPath('data.approved', 1);

        $this->assertSame('APPROVED', DB::table('kkf_parameter_sets')->where('id', $id)->value('status'));
        $this->assertSame($sys->getKey(), DB::table('kkf_parameter_sets')->where('id', $id)->value('approved_by'));
    }

    #[Test]
    public function grants_and_validation(): void
    {
        $this->create([], $this->vendor)->assertForbidden();
        $this->create([], $this->viewer)->assertForbidden();
        $this->create([], $this->manager)->assertForbidden();           // the approver does not manage
        $this->as($this->vendor)->getJson('/api/master-data/kkf-parameters')->assertForbidden();
        $this->create(['discount_rate' => 7.78])->assertUnprocessable();  // fractions only
        $this->create(['bpp' => 0])->assertUnprocessable();
        $this->create(['load_factor' => 1.5])->assertUnprocessable();
        $this->create(['horizon_years' => 0])->assertUnprocessable();
    }

    #[Test]
    public function draft_is_editable_approved_is_frozen_and_new_set_closes_old(): void
    {
        $a = $this->create(['bpp' => 540.98])->json('data.id');
        $this->as($this->engineer)->putJson("/api/master-data/kkf-parameters/{$a}", ['bpp' => 552, 'discount_rate' => 0.0787])->assertOk();
        $this->assertEquals(552, DB::table('kkf_parameter_sets')->where('id', $a)->value('bpp'));
        $this->approve($a)->assertOk();
        $this->as($this->engineer)->putJson("/api/master-data/kkf-parameters/{$a}", ['bpp' => 600])->assertStatus(409);
        try {
            DB::transaction(fn () => DB::table('kkf_parameter_sets')->where('id', $a)->update(['bpp' => 1]));
            $this->fail('approved values must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->create(['valid_from' => '2026-01-01', 'name' => 'Sama tanggal'])->json('data.id');
        $b = $this->create(['valid_from' => '2026-07-01', 'name' => 'Parameter Juli', 'discount_rate' => 0.08])->json('data.id');
        $same = (string) DB::table('kkf_parameter_sets')->where('name', 'Sama tanggal')->value('id');
        $this->approve($same)->assertStatus(409);                       // must start after the active one
        $this->approve($b)->assertOk()->assertJsonPath('data.auto_closed', 1);
        $this->assertSame('2026-06-30', substr((string) DB::table('kkf_parameter_sets')->where('id', $a)->value('valid_until'), 0, 10));
        $this->as($this->viewer)->getJson('/api/master-data/kkf-parameters/active?date=2026-03-01')->assertJsonPath('data.id', $a);
        $this->as($this->viewer)->getJson('/api/master-data/kkf-parameters/active?date=2026-08-01')->assertJsonPath('data.id', $b);
        $this->as($this->manager)->postJson("/api/master-data/kkf-parameters/{$b}/retire", ['reason' => 'Tidak berlaku'])->assertOk();
        $this->assertSame('INACTIVE', DB::table('kkf_parameter_sets')->where('id', $b)->value('status'));
        $events = $this->as($this->viewer)->getJson("/api/master-data/kkf-parameters/{$a}")->json('data.events');
        $this->assertEqualsCanonicalizing(['CREATED', 'DRAFT_UPDATED', 'APPROVED', 'AUTO_CLOSED'], array_column($events, 'event_type'));
    }
}
