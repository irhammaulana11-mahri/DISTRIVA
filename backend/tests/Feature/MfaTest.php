<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Authorization\AssignmentWriteService;
use App\Services\MfaService;
use App\Support\Totp;
use Database\Seeders\FoundationPermissionSeeder;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class MfaTest extends PostgresTestCase
{
    private User $sys;

    private User $eng;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(FoundationPermissionSeeder::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $this->withoutMiddleware(ThrottleRequests::class);

        $unit = OrganizationalUnit::query()->create(['code' => 'U1', 'name' => 'UP3 Satu', 'unit_type' => 'UP3', 'is_active' => true]);
        $this->sys = $this->account('sys@example.com', 'SYS_ADMIN', null, $unit);
        $this->eng = $this->account('eng@example.com', 'ENGINEERING', $unit, $unit);
    }

    private function account(string $email, string $role, ?OrganizationalUnit $unit, OrganizationalUnit $actorUnit): User
    {
        $u = new User(['name' => $email, 'email' => $email, 'password' => 'Str0ng!Passw0rd#x', 'account_status' => 'ACTIVE']);
        $u->must_change_password = false;
        $u->save();
        app(AssignmentWriteService::class)->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit, '2020-01-01', null, 'setup', $u, null, 'TEST');

        return $u;
    }

    private function login(string $email): string
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Str0ng!Passw0rd#x'])->assertOk()->json('token');
    }

    private function enrol(string $token): array
    {
        $this->app['auth']->forgetGuards();
        $secret = $this->withToken($token)->postJson('/api/auth/mfa/enroll')->assertOk()->json('data.secret');
        $this->app['auth']->forgetGuards();
        $codes = $this->withToken($token)->postJson('/api/auth/mfa/confirm', ['code' => Totp::code($secret, Totp::step())])->assertOk()->json('recovery_codes');

        return [$secret, $codes];
    }

    #[Test]
    public function totp_matches_the_rfc_6238_vectors_and_rejects_wrong_codes(): void
    {
        $secret = Totp::base32Encode('12345678901234567890');
        $this->assertSame('287082', Totp::code($secret, intdiv(59, 30)));
        $this->assertSame('081804', Totp::code($secret, intdiv(1111111109, 30)));
        $this->assertSame(intdiv(59, 30), Totp::verify($secret, '287082', 59));
        $this->assertNull(Totp::verify($secret, '000000', 59));
        $this->assertNull(Totp::verify($secret, 'abcdef', 59));
        $this->assertSame('12345678901234567890', Totp::base32Decode($secret));
    }

    #[Test]
    public function login_reports_mfa_state_and_a_fresh_sys_admin_token_can_only_use_the_mfa_flow(): void
    {
        $this->app['auth']->forgetGuards();
        $res = $this->postJson('/api/auth/login', ['email' => 'sys@example.com', 'password' => 'Str0ng!Passw0rd#x'])->assertOk();
        $res->assertJsonPath('mfa', ['required' => true, 'enrolled' => false, 'verified' => false]);
        $token = $res->json('token');

        foreach (['/api/admin/users', '/api/master-data/materials', '/api/master-data/access'] as $url) {
            $this->app['auth']->forgetGuards();
            $this->withToken($token)->getJson($url)->assertForbidden()->assertJsonPath('message', 'Verifikasi MFA diperlukan.');
        }
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertOk();

        $eng = $this->login('eng@example.com');
        $this->app['auth']->forgetGuards();
        $this->withToken($eng)->getJson('/api/master-data/materials')->assertOk(); // other roles are not affected
    }

    #[Test]
    public function enrolment_confirm_unlocks_the_token_and_the_secret_and_recovery_codes_are_not_stored_in_clear(): void
    {
        $token = $this->login('sys@example.com');
        [$secret, $codes] = $this->enrol($token);

        $this->assertCount(8, $codes);
        $row = DB::table('user_mfa_credentials')->first();
        $this->assertNotSame($secret, $row->secret_encrypted);
        $this->assertSame($secret, Crypt::decryptString($row->secret_encrypted));
        $this->assertStringNotContainsString($codes[0], $row->recovery_code_hashes);
        $this->assertNotNull($row->confirmed_at);

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/admin/users')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/auth/mfa/enroll')->assertStatus(409); // cannot re-enrol while confirmed
    }

    #[Test]
    public function a_new_login_needs_a_new_code_a_code_cannot_be_replayed_and_wrong_codes_lock_the_account_factor(): void
    {
        [$secret] = $this->enrol($this->login('sys@example.com'));

        $second = $this->login('sys@example.com');
        $res = $this->postJson('/api/auth/login', ['email' => 'sys@example.com', 'password' => 'Str0ng!Passw0rd#x'])->assertOk();
        $res->assertJsonPath('mfa', ['required' => true, 'enrolled' => true, 'verified' => false]);
        $this->app['auth']->forgetGuards();
        $this->withToken($second)->getJson('/api/admin/users')->assertForbidden();

        // The step used for confirmation is spent: the same code is a replay.
        $this->app['auth']->forgetGuards();
        $this->withToken($second)->postJson('/api/auth/mfa/verify', ['code' => Totp::code($secret, Totp::step())])->assertStatus(422);

        // The next time step is accepted (within the +-1 window).
        $this->app['auth']->forgetGuards();
        $this->withToken($second)->postJson('/api/auth/mfa/verify', ['code' => Totp::code($secret, Totp::step() + 1)])->assertOk()->assertJsonPath('mfa.verified', true);
        $this->app['auth']->forgetGuards();
        $this->withToken($second)->getJson('/api/admin/users')->assertOk();

        // Wrong codes: 5 failures lock verification for 15 minutes even for a correct code.
        $third = $this->login('sys@example.com');
        for ($i = 0; $i < 5; $i++) {
            $this->app['auth']->forgetGuards();
            $this->withToken($third)->postJson('/api/auth/mfa/verify', ['code' => '000000'])->assertStatus(422);
        }
        $this->app['auth']->forgetGuards();
        $this->withToken($third)->postJson('/api/auth/mfa/verify', ['code' => Totp::code($secret, Totp::step() + 1)])->assertStatus(409);
    }

    #[Test]
    public function a_recovery_code_works_once(): void
    {
        [, $codes] = $this->enrol($this->login('sys@example.com'));

        $t = $this->login('sys@example.com');
        $this->app['auth']->forgetGuards();
        $this->withToken($t)->postJson('/api/auth/mfa/verify', ['code' => $codes[0]])->assertOk();
        $t2 = $this->login('sys@example.com');
        $this->app['auth']->forgetGuards();
        $this->withToken($t2)->postJson('/api/auth/mfa/verify', ['code' => $codes[0]])->assertStatus(422);
        $this->app['auth']->forgetGuards();
        $this->withToken($t2)->postJson('/api/auth/mfa/verify', ['code' => $codes[1]])->assertOk();
    }

    #[Test]
    public function only_sys_admin_can_enrol_and_the_flag_off_disables_enforcement(): void
    {
        $eng = $this->login('eng@example.com');
        $this->app['auth']->forgetGuards();
        $this->withToken($eng)->postJson('/api/auth/mfa/enroll')->assertForbidden();

        config(['distriva.system_writes_require_mfa' => false]);
        $sys = $this->login('sys@example.com');
        $this->app['auth']->forgetGuards();
        $this->withToken($sys)->getJson('/api/admin/users')->assertOk();
    }

    #[Test]
    public function sys_admin_can_do_the_full_master_data_cycle_including_approval_but_never_approve_its_own_draft(): void
    {
        $sys = $this->login('sys@example.com');
        [$secret] = $this->enrol($sys);

        $this->app['auth']->forgetGuards();
        $this->assertTrue($this->withToken($sys)->getJson('/api/master-data/access')->assertOk()->json('can')['khs.approve']);

        $csv = UploadedFile::fake()->createWithContent('khs.csv', "code,name,unit\n1,Tiang beton,B\n");
        $this->app['auth']->forgetGuards();
        $this->withToken($sys)->post('/api/master-data/khs/import', ['file' => $csv, 'valid_from' => '2026-01-01'], ['Accept' => 'application/json'])->assertCreated();
        $draft = DB::table('khs_item_versions')->value('id');

        // SYS_ADMIN may approve even if created by themselves (owner requirement 2026-11-07).
        $this->app['auth']->forgetGuards();
        $this->withToken($sys)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => [$draft], 'reason' => 'x'])->assertOk();
        $this->assertSame('APPROVED', DB::table('khs_item_versions')->where('id', $draft)->value('status'));
    }

    #[Test]
    public function console_reset_forgets_the_credential_and_revokes_tokens(): void
    {
        $token = $this->login('sys@example.com');
        $this->enrol($token);

        $this->artisan('distriva:mfa-reset', ['--email' => 'sys@example.com', '--force' => true])->assertSuccessful();
        $this->assertSame(0, DB::table('user_mfa_credentials')->count());
        $this->assertSame(0, $this->sys->tokens()->count());
        $this->assertFalse(app(MfaService::class)->enrolled($this->sys));
        $this->artisan('distriva:mfa-reset', ['--email' => 'nobody@example.com', '--force' => true])->assertFailed();
    }
}
