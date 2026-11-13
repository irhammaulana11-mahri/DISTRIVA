<?php

namespace Tests\Feature;

use App\Events\AuthorizationScopeChanged;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\AssignmentWriteService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class AssignmentWriteServiceTest extends PostgresTestCase
{
    private function svc(): AssignmentWriteService
    {
        return $this->app->make(AssignmentWriteService::class);
    }

    #[Test]
    public function assign_creates_the_row_history_and_event_atomically(): void
    {
        Event::fake([AuthorizationScopeChanged::class]);
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];
        $unit = $this->makeUnit('UP3');

        $a = $this->svc()->assign($target, $this->makeRole('TEKNIK'), $unit, '2026-01-01', null, ' Penugasan awal ', $actor, null, 'SK-1');

        $this->assertDatabaseHas('user_role_assignments', ['id' => $a->getKey(), 'assigned_by' => $actor->getKey(), 'is_active' => true]);
        $h = DB::table('user_role_assignment_histories')->first();
        $this->assertSame('CREATED', $h->event_type);
        $this->assertSame('Penugasan awal', $h->reason);
        $this->assertNull($h->before_values);
        $this->assertSame($unit->getKey(), json_decode($h->after_values, true)['organizational_unit_id']);
        $this->assertStringNotContainsString('password', $h->after_values);
        Event::assertDispatched(AuthorizationScopeChanged::class, fn ($e) => $e->userId === $target->getKey());
    }

    #[Test]
    public function a_reason_is_required_and_nothing_is_written_without_it(): void
    {
        $this->expectException(AssignmentRuleViolation::class);
        try {
            $this->svc()->assign($this->makeUser(), $this->makeRole('TEKNIK'), $this->makeUnit('UP3'), '2026-01-01', null, '   ', $this->makeUser());
        } finally {
            $this->assertDatabaseCount('user_role_assignments', 0);
            $this->assertDatabaseCount('user_role_assignment_histories', 0);
        }
    }

    #[Test]
    public function overlap_and_rule_violations_become_domain_errors_and_leave_no_history_or_event(): void
    {
        Event::fake([AuthorizationScopeChanged::class]);
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');
        $this->svc()->assign($target, $role, $unit, '2026-01-01', null, 'a', $actor);

        foreach ([
            fn () => $this->svc()->assign($target, $role, $unit, '2026-06-01', null, 'overlap', $actor),
            fn () => $this->svc()->assign($target, $role, null, '2026-01-01', null, 'no unit', $actor),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('Expected AssignmentRuleViolation');
            } catch (AssignmentRuleViolation) {
                // expected
            }
        }

        $this->assertDatabaseCount('user_role_assignments', 1);
        $this->assertDatabaseCount('user_role_assignment_histories', 1);
        Event::assertDispatchedTimes(AuthorizationScopeChanged::class, 1);
    }

    #[Test]
    public function actor_assignment_must_belong_to_the_actor(): void
    {
        $actor = $this->makeUser();
        $other = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $foreign = $this->assign($other, $this->makeRole('TEKNIK'), $unit);

        $this->expectException(AssignmentRuleViolation::class);
        $this->svc()->assign($this->makeUser(), $this->makeRole('PERENCANAAN'), $unit, '2026-01-01', null, 'x', $actor, $foreign);
    }

    #[Test]
    public function revoke_deactivates_ends_validity_records_before_after_and_cannot_repeat(): void
    {
        Event::fake([AuthorizationScopeChanged::class]);
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];
        $a = $this->svc()->assign($target, $this->makeRole('TEKNIK'), $this->makeUnit('UP3'), '2026-01-01', null, 'a', $actor);

        $r = $this->svc()->revoke($a, 'Mutasi', $actor, null, CarbonImmutable::parse('2026-03-15', 'Asia/Jakarta'));

        $this->assertFalse($r->is_active);
        $this->assertSame('2026-03-15', $r->valid_until->toDateString());
        $h = DB::table('user_role_assignment_histories')->where('event_type', 'REVOKED')->first();
        $this->assertTrue(json_decode($h->before_values, true)['is_active']);
        $this->assertFalse(json_decode($h->after_values, true)['is_active']);
        Event::assertDispatchedTimes(AuthorizationScopeChanged::class, 2);

        $this->expectException(AssignmentRuleViolation::class);
        $this->svc()->revoke($a, 'again', $actor);
    }

    #[Test]
    public function revoking_a_future_assignment_keeps_dates_valid_and_allows_reassignment(): void
    {
        [$target, $actor] = [$this->makeUser(), $this->makeUser()];
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');
        $a = $this->svc()->assign($target, $role, $unit, '2026-12-01', null, 'future', $actor);

        $r = $this->svc()->revoke($a, 'batal', $actor, null, CarbonImmutable::parse('2026-11-05', 'Asia/Jakarta'));
        $this->assertSame('2026-12-01', $r->valid_until->toDateString());

        $this->svc()->assign($target, $role, $unit, '2026-12-01', null, 'again', $actor); // inactive row no longer blocks
        $this->assertDatabaseCount('user_role_assignments', 2);
    }
}
