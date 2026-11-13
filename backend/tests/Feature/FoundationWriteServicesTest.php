<?php

namespace Tests\Feature;

use App\Events\AuthorizationScopeChanged;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Authorization\AccountStatusService;
use App\Services\Authorization\AssignmentWriteService;
use App\Services\OrganizationalUnitWriteService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class FoundationWriteServicesTest extends PostgresTestCase
{
    #[Test]
    public function account_status_change_is_audited_revokes_tokens_and_dispatches_after_commit(): void
    {
        Event::fake([AuthorizationScopeChanged::class]);
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];
        $target->createToken('t');

        $this->app->make(AccountStatusService::class)->change($target, 'SUSPENDED', ' Cuti panjang ', $actor);

        $this->assertSame('SUSPENDED', $target->fresh()->account_status);
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $h = DB::table('authorization_change_histories')->first();
        $this->assertSame('USER_STATUS_CHANGED', $h->event_type);
        $this->assertSame('Cuti panjang', $h->reason);
        $this->assertSame('ACTIVE', json_decode($h->before_values, true)['account_status']);
        $this->assertSame($actor->getKey(), $h->actor_user_id);
        Event::assertDispatched(AuthorizationScopeChanged::class);
    }

    #[Test]
    public function account_status_rejects_self_change_noop_unknown_status_and_missing_reason(): void
    {
        $svc = $this->app->make(AccountStatusService::class);
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];

        foreach ([
            fn () => $svc->change($actor, 'SUSPENDED', 'x', $actor),
            fn () => $svc->change($target, 'ACTIVE', 'x', $actor),
            fn () => $svc->change($target, 'BOGUS', 'x', $actor),
            fn () => $svc->change($target, 'SUSPENDED', '  ', $actor),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('Expected AssignmentRuleViolation');
            } catch (AssignmentRuleViolation) {
            }
        }
        $this->assertDatabaseCount('authorization_change_histories', 0);
        $this->assertSame('ACTIVE', $target->fresh()->account_status);
    }

    #[Test]
    public function unit_create_and_update_write_history_and_enforce_hierarchy(): void
    {
        $svc = $this->app->make(OrganizationalUnitWriteService::class);
        $actor = $this->makeUser();

        $up3 = $svc->create('UP3-X', 'UP3 X', 'UP3', null, null, 'pembentukan', $actor);
        $ulp = $svc->create('ULP-X1', 'ULP X1', 'ULP', $up3, 'Jl. A', 'pembentukan', $actor);
        $svc->update($ulp, ['name' => 'ULP X1 Baru'], 'ganti nama', $actor);

        $h = DB::table('organizational_unit_histories')->where('organizational_unit_id', $ulp->getKey())->orderBy('changed_at')->get();
        $this->assertCount(2, $h);
        $this->assertNull($h[0]->old_name);
        $this->assertSame('ULP X1', $h[1]->old_name);
        $this->assertSame('ULP X1 Baru', $h[1]->new_name);
        $this->assertSame($actor->getKey(), $h[1]->changed_by);

        $this->expectException(AssignmentRuleViolation::class);
        $svc->update($up3, ['is_active' => false], 'tutup', $actor); // has active child
    }

    #[Test]
    public function unit_code_type_parent_are_immutable_duplicate_codes_and_failed_writes_leave_no_history(): void
    {
        $svc = $this->app->make(OrganizationalUnitWriteService::class);
        $actor = $this->makeUser();
        $up3 = $svc->create('UP3-Y', 'UP3 Y', 'UP3', null, null, 'r', $actor);
        $count = DB::table('organizational_unit_histories')->count();

        foreach ([
            fn () => $svc->update($up3, ['code' => 'NEW'], 'r', $actor),
            fn () => $svc->update($up3, ['unit_type' => 'ULP'], 'r', $actor),
            fn () => $svc->update($up3, ['parent_id' => $up3->getKey()], 'r', $actor),
            fn () => $svc->update($up3, ['name' => $up3->name], 'r', $actor),
            fn () => $svc->create('UP3-Y', 'dup', 'UP3', null, null, 'r', $actor),
            fn () => $svc->create('ULP-Z', 'orphan', 'ULP', null, null, 'r', $actor),
            fn () => $svc->create('UP3-Q', 'q', 'UP3', null, null, '', $actor),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('Expected AssignmentRuleViolation');
            } catch (AssignmentRuleViolation) {
            }
        }
        $this->assertSame($count, DB::table('organizational_unit_histories')->count());
        $this->assertSame('UP3-Y', $up3->fresh()->code);
    }

    #[Test]
    public function change_password_requires_current_password_revokes_other_tokens_and_clears_flag(): void
    {
        $user = $this->makeUser();
        $user->forceFill(['must_change_password' => true])->save();
        $other = $user->createToken('other');
        $token = $user->createToken('mine')->plainTextToken;

        $this->withToken($token)->postJson('/api/me/password', ['current_password' => 'wrong', 'password' => 'Baru-Kuat#2026', 'password_confirmation' => 'Baru-Kuat#2026'])->assertStatus(422);
        $this->withToken($token)->postJson('/api/me/password', ['current_password' => 'secret-password', 'password' => 'short', 'password_confirmation' => 'short'])->assertUnprocessable();
        $this->withToken($token)->postJson('/api/me/password', ['current_password' => 'secret-password', 'password' => 'secret-password', 'password_confirmation' => 'secret-password'])->assertUnprocessable();

        $this->withToken($token)->postJson('/api/me/password', ['current_password' => 'secret-password', 'password' => 'Baru-Kuat#2026', 'password_confirmation' => 'Baru-Kuat#2026'])->assertOk();

        $this->assertFalse($user->fresh()->must_change_password);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $other->accessToken->getKey()]);
        $this->assertDatabaseCount('personal_access_tokens', 1);
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'Baru-Kuat#2026'])->assertOk();
    }

    #[Test]
    public function write_services_reject_non_active_or_unsaved_actors(): void
    {
        $target = $this->makeUser();
        $suspended = $this->makeUser('SUSPENDED');
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');

        $attempts = [
            fn () => $this->app->make(AssignmentWriteService::class)->assign($target, $role, $unit, '2026-01-01', null, 'x', $suspended),
            fn () => $this->app->make(AccountStatusService::class)->change($target, 'SUSPENDED', 'x', $suspended),
            fn () => $this->app->make(OrganizationalUnitWriteService::class)->create('UP3-Z', 'Z', 'UP3', null, null, 'x', $suspended),
            fn () => $this->app->make(OrganizationalUnitWriteService::class)->update($unit, ['name' => 'N'], 'x', new User),
        ];
        foreach ($attempts as $attempt) {
            try {
                $attempt();
                $this->fail('Expected AssignmentRuleViolation');
            } catch (AssignmentRuleViolation) {
            }
        }
        $this->assertDatabaseCount('user_role_assignments', 0);
        $this->assertSame('ACTIVE', $target->fresh()->account_status);
    }
}
