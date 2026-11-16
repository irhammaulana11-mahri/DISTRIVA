<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PasswordPolicy;
use Database\Seeders\FoundationPermissionSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class BootstrapAdminCommandTest extends PostgresTestCase
{
    private function bootstrap(array $args): array
    {
        $code = Artisan::call('distriva:bootstrap-admin', $args + ['--force' => true]);

        return [$code, Artisan::output()];
    }

    private function up3Args(array $over = []): array
    {
        return $over + ['--role' => 'ADMIN', '--email' => 'First.Admin@Example.com', '--name' => 'Admin Pertama', '--unit-code' => 'UP3-TEST', '--unit-name' => 'UP3 Uji'];
    }

    #[Test]
    public function it_fails_clearly_when_roles_are_not_seeded(): void
    {
        [$code, $out] = $this->bootstrap($this->up3Args());
        $this->assertSame(1, $code);
        $this->assertStringContainsString('FoundationPermissionSeeder', $out);
        $this->assertDatabaseCount('users', 0);
    }

    #[Test]
    public function it_creates_the_first_up3_admin_with_unit_audit_and_a_policy_compliant_one_time_password(): void
    {
        $this->seed(FoundationPermissionSeeder::class);
        [$code, $out] = $this->bootstrap($this->up3Args());

        $this->assertSame(0, $code);
        preg_match('/Password sementara: (\S+)/', $out, $m);
        $password = $m[1] ?? '';
        $user = User::query()->where('email', 'first.admin@example.com')->firstOrFail();

        $this->assertTrue(Hash::check($password, $user->password));
        $this->assertTrue($user->must_change_password);
        $this->assertSame('ACTIVE', $user->account_status);
        $this->assertSame([], app(PasswordPolicy::class)->violations($password));
        $this->assertSame(1, DB::table('organizational_units')->where('code', 'UP3-TEST')->where('unit_type', 'UP3')->count());
        $this->assertDatabaseHas('user_role_assignments', ['user_id' => $user->getKey(), 'assignment_document' => 'BOOTSTRAP-CONSOLE', 'assigned_by' => $user->getKey()]);
        $this->assertDatabaseHas('user_role_assignment_histories', ['event_type' => 'CREATED', 'actor_user_id' => $user->getKey()]);
        $this->assertDatabaseHas('organizational_unit_histories', ['changed_by' => $user->getKey(), 'new_code' => 'UP3-TEST']);
        $this->assertStringNotContainsString($password, json_encode(DB::table('user_role_assignment_histories')->get()));
    }

    #[Test]
    public function the_new_admin_can_log_in_must_change_the_password_and_then_use_the_admin_api(): void
    {
        $this->seed(FoundationPermissionSeeder::class);
        [, $out] = $this->bootstrap($this->up3Args());
        preg_match('/Password sementara: (\S+)/', $out, $m);

        $login = $this->postJson('/api/auth/login', ['email' => 'first.admin@example.com', 'password' => $m[1]])->assertOk();
        $this->assertTrue($login->json('must_change_password'));
        $this->withToken($login->json('token'))->getJson('/api/admin/organizational-units')
            ->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.code', 'UP3-TEST');
    }

    #[Test]
    public function it_runs_only_once_per_role_and_refuses_duplicates(): void
    {
        $this->seed(FoundationPermissionSeeder::class);
        $this->assertSame(0, $this->bootstrap($this->up3Args())[0]);

        [$code, $out] = $this->bootstrap($this->up3Args(['--email' => 'second@example.com', '--unit-code' => 'UP3-OTHER']));
        $this->assertSame(1, $code);
        $this->assertStringContainsString('sudah memiliki penugasan', $out);
        $this->assertDatabaseCount('users', 1);
        $this->assertSame(1, DB::table('organizational_units')->count());
    }

    #[Test]
    public function sys_admin_bootstrap_has_no_unit_and_is_also_one_time(): void
    {
        $this->seed(FoundationPermissionSeeder::class);
        $args = ['--role' => 'SYS_ADMIN', '--email' => 'sys@example.com', '--name' => 'Sistem'];

        $this->assertSame(0, $this->bootstrap($args)[0]);
        $this->assertDatabaseHas('user_role_assignments', ['organizational_unit_id' => null]);
        $this->assertSame(1, $this->bootstrap(['--email' => 'sys2@example.com'] + $args)[0]);
    }

    #[Test]
    public function it_validates_input_and_rejects_duplicate_email_or_unit_code_without_partial_writes(): void
    {
        $this->seed(FoundationPermissionSeeder::class);
        $this->assertSame(2, $this->bootstrap($this->up3Args(['--email' => 'not-an-email']))[0]);
        $this->assertSame(2, $this->bootstrap($this->up3Args(['--unit-code' => '']))[0]);
        $this->assertSame(2, $this->bootstrap(['--role' => 'VENDOR'])[0]);

        $this->makeUser('ACTIVE', 'first.admin@example.com');
        $this->assertSame(1, $this->bootstrap($this->up3Args())[0]);
        $this->makeUnit('UP3')->forceFill(['code' => 'UP3-TEST'])->save();
        $this->assertSame(1, $this->bootstrap($this->up3Args(['--email' => 'other@example.com']))[0]);
        $this->assertDatabaseMissing('users', ['email' => 'other@example.com']);
    }
}
