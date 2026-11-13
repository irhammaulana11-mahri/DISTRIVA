<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\FoundationPermissionSeeder;
use Illuminate\Http\Client\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Owner decision 2026-11-06: admins create accounts on the web; people activate them with an OTP. */
class UserProvisioningTest extends PostgresTestCase
{
    private const WA_URL = 'https://gateway.example.test/send';

    private OrganizationalUnit $upA;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $upB;

    private User $adminA;

    private User $sysAdmin;

    private User $plain;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(FoundationPermissionSeeder::class);

        $this->upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->upA);
        $this->upB = $this->makeUnit('UP3');

        $this->adminA = $this->makeUser();
        $this->sysAdmin = $this->makeUser();
        $this->plain = $this->makeUser();
        $this->assign($this->adminA, Role::query()->where('name', 'UP3_ADMIN')->firstOrFail(), $this->upA);
        $this->assign($this->sysAdmin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
        $this->assign($this->plain, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA);

        config([
            'distriva_notifications.channels' => ['mail', 'whatsapp'],
            'distriva_notifications.whatsapp.driver' => 'http',
            'distriva_notifications.whatsapp.http' => ['url' => self::WA_URL, 'token' => 'GW-TOKEN', 'body' => '{"target":"{phone}","message":"{message}"}'],
            'distriva.frontend_url' => 'https://distriva.example.test',
        ]);
        Http::fake([self::WA_URL => Http::response(['status' => true])]);
    }

    /** @param bool $mfa SYS_ADMIN tokens are MFA-verified by default; pass false for a freshly logged-in token. */
    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    private function body(array $over = []): array
    {
        return $over + [
            'name' => 'Siti Aminah', 'email' => 'Siti.Aminah@Example.com', 'phone' => '0812-3456-7890',
            'role_id' => Role::query()->where('name', 'TEKNIK')->value('id'),
            'organizational_unit_id' => $this->ulpA->getKey(), 'valid_from' => '2026-11-06',
            'assignment_document' => 'SK-777', 'reason' => 'Pegawai baru',
        ];
    }

    private function mails(): Collection
    {
        return Mail::mailer('array')->getSymfonyTransport()->messages();
    }

    #[Test]
    public function creating_a_user_makes_a_pending_account_with_no_usable_password_and_sends_only_an_invitation(): void
    {
        $res = $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();

        $user = User::query()->where('email', 'siti.aminah@example.com')->firstOrFail();
        $this->assertSame('PENDING_ACTIVATION', $user->account_status);
        $this->assertSame('PENDING_ACTIVATION', $res->json('data.account_status'));
        $this->assertNull($user->password_expires_at);

        // The invitation reached both channels and holds no secret: no password, no OTP.
        $this->assertSame(['mail', 'whatsapp'], $res->json('delivery.delivered'));
        $mail = $this->mails();
        $this->assertCount(1, $mail);
        $text = $mail[0]->getOriginalMessage()->getTextBody();
        $this->assertStringContainsString('https://distriva.example.test/aktivasi', $text);
        $this->assertStringContainsString('siti.aminah@example.com', $text);
        $this->assertDoesNotMatchRegularExpression('/\b\d{6}\b/', $text);
        $this->assertStringNotContainsString('sementara', $text); // the word "password" appears legitimately; no secret does
        Http::assertSent(fn (Request $r) => $r['target'] === '6281234567890' && str_contains($r['message'], '/aktivasi'));

        // Nobody can sign in yet, whatever they try.
        foreach (['', 'password', 'secret-password'] as $guess) {
            $this->postJson('/api/auth/login', ['email' => 'siti.aminah@example.com', 'password' => $guess ?: 'x'])->assertUnauthorized();
        }
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->getKey())->count());
    }

    #[Test]
    public function the_assignment_and_audit_are_created_with_the_user_and_the_admin_can_see_it(): void
    {
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();
        $user = User::query()->where('email', 'siti.aminah@example.com')->firstOrFail();

        $this->assertDatabaseHas('user_role_assignments', ['user_id' => $user->getKey(), 'assigned_by' => $this->adminA->getKey(), 'assignment_document' => 'SK-777', 'organizational_unit_id' => $this->ulpA->getKey()]);
        $audit = DB::table('authorization_change_histories')->where('event_type', 'USER_CREATED')->first();
        $this->assertSame($this->adminA->getKey(), $audit->actor_user_id);
        $this->assertSame('PENDING_ACTIVATION', json_decode($audit->after_values, true)['account_status']);

        $this->as($this->adminA)->getJson("/api/admin/users/{$user->getKey()}")->assertOk()->assertJsonPath('data.account_status', 'PENDING_ACTIVATION');
    }

    #[Test]
    public function a_delivery_failure_does_not_undo_the_creation_and_is_reported(): void
    {
        config(['distriva_notifications.whatsapp.driver' => 'null', 'mail.default' => 'log']);

        $res = $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();

        $this->assertSame([], $res->json('delivery.delivered'));
        $this->assertSame(['mail' => 'mailer_not_deliverable', 'whatsapp' => 'no_provider_configured'], $res->json('delivery.skipped'));
        $this->assertDatabaseHas('users', ['email' => 'siti.aminah@example.com', 'account_status' => 'PENDING_ACTIVATION']);
    }

    #[Test]
    public function one_failing_channel_is_reported_while_the_other_delivers(): void
    {
        $down = 'https://down.example.test/send';
        config(['distriva_notifications.whatsapp.http.url' => $down]);
        Http::fake([$down => Http::response('x', 500)]);

        $res = $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();

        $this->assertSame(['mail'], $res->json('delivery.delivered'));
        $this->assertSame(['whatsapp'], $res->json('delivery.failed'));
    }

    #[Test]
    public function a_user_without_a_phone_is_invited_by_email_only(): void
    {
        $res = $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['phone' => null]))->assertCreated();
        $this->assertSame(['mail'], $res->json('delivery.delivered'));
        $this->assertSame(['whatsapp' => 'no_valid_phone'], $res->json('delivery.skipped'));
    }

    #[Test]
    public function creation_is_denied_without_the_grant_before_validation_and_outside_scope(): void
    {
        $this->as($this->plain)->postJson('/api/admin/users', [])->assertForbidden();
        $this->as($this->plain)->postJson('/api/admin/users', $this->body())->assertForbidden();

        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['organizational_unit_id' => $this->upB->getKey()]))->assertNotFound();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['role_id' => Role::query()->where('name', 'SYS_ADMIN')->value('id')]))->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['role_id' => Role::query()->where('name', 'VENDOR')->value('id')]))->assertForbidden();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['role_id' => Role::query()->where('name', 'UP3_ADMIN')->value('id')]))->assertForbidden();
        $this->as($this->sysAdmin, false)->postJson('/api/admin/users', $this->body())->assertForbidden()->assertJsonPath('message', 'Verifikasi MFA diperlukan.');

        $this->assertDatabaseMissing('users', ['email' => 'siti.aminah@example.com']);
        Http::assertNothingSent();
        $this->assertCount(0, $this->mails());
    }

    #[Test]
    public function validation_rejects_duplicates_bad_phone_missing_document_and_bad_dates(): void
    {
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['email' => strtoupper($this->plain->email)]))->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['phone' => 'abc']))->assertUnprocessable()->assertJsonValidationErrors('phone');
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['email' => 'bukan-email']))->assertUnprocessable();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['assignment_document' => '']))->assertUnprocessable();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['valid_until' => '2020-01-01']))->assertUnprocessable();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['reason' => ' ']))->assertUnprocessable();
        Http::assertNothingSent();
    }

    #[Test]
    public function the_email_is_normalized_so_case_variants_cannot_create_duplicates(): void
    {
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body(['email' => 'SITI.AMINAH@EXAMPLE.COM']))->assertUnprocessable();
        $this->assertSame(1, User::query()->where('email', 'siti.aminah@example.com')->count());
    }

    // ---- resend invitation --------------------------------------------------------------

    private function pending(): User
    {
        $this->as($this->adminA)->postJson('/api/admin/users', $this->body())->assertCreated();
        Mail::mailer('array')->getSymfonyTransport()->flush();
        Http::fake([self::WA_URL => Http::response(['status' => true])]);

        return User::query()->where('email', 'siti.aminah@example.com')->firstOrFail();
    }

    #[Test]
    public function the_invitation_can_be_resent_with_a_reason_and_is_audited(): void
    {
        $user = $this->pending();

        $res = $this->as($this->adminA)->postJson("/api/admin/users/{$user->getKey()}/resend-invitation", ['reason' => 'Email lama tidak terbaca'])->assertOk();

        $this->assertSame(['mail', 'whatsapp'], $res->json('delivery.delivered'));
        $this->assertCount(1, $this->mails());
        $this->assertDatabaseHas('authorization_change_histories', ['event_type' => 'USER_INVITATION_SENT', 'user_id' => $user->getKey(), 'actor_user_id' => $this->adminA->getKey(), 'reason' => 'Email lama tidak terbaca']);
        $this->as($this->adminA)->postJson("/api/admin/users/{$user->getKey()}/resend-invitation", [])->assertUnprocessable();
    }

    #[Test]
    public function resending_is_refused_for_activated_accounts_self_out_of_scope_and_ungranted_callers(): void
    {
        $user = $this->pending();

        $this->as($this->plain)->postJson("/api/admin/users/{$user->getKey()}/resend-invitation", ['reason' => 'x'])->assertForbidden();
        $this->as($this->sysAdmin, false)->postJson("/api/admin/users/{$user->getKey()}/resend-invitation", ['reason' => 'x'])->assertForbidden();

        $outsider = $this->makeUser('PENDING_ACTIVATION');
        $this->assign($outsider, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->upB);
        $this->as($this->adminA)->postJson("/api/admin/users/{$outsider->getKey()}/resend-invitation", ['reason' => 'x'])->assertNotFound();
        $this->as($this->adminA)->postJson('/api/admin/users/'.fake()->uuid().'/resend-invitation', ['reason' => 'x'])->assertNotFound();

        $this->adminA->forceFill(['account_status' => 'PENDING_ACTIVATION'])->save();
        $this->as($this->adminA)->postJson("/api/admin/users/{$this->adminA->getKey()}/resend-invitation", ['reason' => 'x'])->assertForbidden();
        $this->adminA->forceFill(['account_status' => 'ACTIVE'])->save();

        $user->forceFill(['account_status' => 'ACTIVE'])->save();
        $this->as($this->adminA)->postJson("/api/admin/users/{$user->getKey()}/resend-invitation", ['reason' => 'x'])->assertStatus(409);
        $this->assertCount(0, $this->mails());
    }

    #[Test]
    public function the_old_credential_reissue_endpoint_is_gone(): void
    {
        $user = $this->pending();
        $this->as($this->adminA)->postJson("/api/admin/users/{$user->getKey()}/reissue-credentials", ['reason' => 'x'])->assertNotFound();
    }

    #[Test]
    public function the_audit_constraint_accepts_the_new_events_only_with_a_user(): void
    {
        $u = $this->makeUser();
        $row = fn (string $event, ?string $user) => fn () => DB::table('authorization_change_histories')->insert([
            'id' => (string) Str::uuid(), 'event_type' => $event, 'user_id' => $user, 'changed_at' => now(),
        ]);

        foreach (['USER_CREATED', 'USER_INVITATION_SENT', 'USER_ACTIVATED', 'USER_PASSWORD_RECOVERED'] as $event) {
            $row($event, $u->getKey())();
            $this->assertDbRejects($row($event, null));
        }
        $this->assertDbRejects($row('SOMETHING_ELSE', $u->getKey()));
        $this->assertFalse(Hash::check('x', $u->password));
    }
}
