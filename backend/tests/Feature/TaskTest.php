<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Tasks\BusinessCalendar;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class TaskTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $retail;

    private User $manager;

    private User $teknik;

    private User $teknikB;

    private User $vendor;

    private User $sysAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retail = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->manager = $mk('MANAGER_ULP', $this->ulpA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->vendor = $mk('VENDOR', $this->ulpA);
        $this->sysAdmin = $mk('SYS_ADMIN', null);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function application(string $status = 'APPROVED'): string
    {
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        if ($status !== 'APPROVED') {
            DB::table('applications')->where('id', $id)->update(['current_status' => $status]);
        }

        return $id;
    }

    private function task(string $app, string $type = 'SURVEI', ?User $to = null)
    {
        return $this->as($this->manager)->postJson("/api/applications/{$app}/tasks", ['task_type' => $type, 'title' => 'Survei lokasi pelanggan', 'assignee_id' => ($to ?? $this->teknik)->getKey()]);
    }

    private function taskStatus(string $task): string
    {
        return (string) DB::table('application_tasks')->where('id', $task)->value('status');
    }

    private function inbox(User $u, string $like): int
    {
        return DB::table('user_notifications')->where('user_id', $u->getKey())->where('title', 'like', $like)->count();
    }

    #[Test]
    public function the_task_list_is_narrowed_by_the_up3_and_ulp_filter(): void
    {
        $this->task($this->application())->assertCreated();
        $other = $this->makeUnit('UP3');
        $count = fn (string $query) => $this->as($this->sysAdmin)->getJson("/api/tasks?{$query}")->assertOk()->json('meta.total');

        $this->assertSame([1, 0], [$count('unit_id='.$this->ulpA->getKey()), $count('unit_id='.$this->ulpB->getKey())]);
        $this->assertSame([1, 0], [$count('up3_id='.$this->up3->getKey()), $count('up3_id='.$other->getKey())]);
        $this->as($this->sysAdmin)->getJson('/api/tasks?up3_id=bukan-uuid')->assertStatus(422);
        $this->assertSame([1, 0], [$count('search=lokasi%20pelanggan'), $count('search=tidak-ada-sama-sekali')]);                      // the search box of the page filters by title, application number or assignee
    }

    #[Test]
    public function the_task_keys_are_granted_to_the_intended_roles_only(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('tasks.assign'));
        $this->assertSame(['SYS_ADMIN'], $holders('sla.manage'));
        $this->assertContains('TEKNIK', $holders('tasks.view'));
        $this->assertNotContains('VENDOR', $holders('tasks.view'));
    }

    #[Test]
    public function the_deadline_counts_working_days_and_skips_weekends_and_holidays(): void
    {
        $friday = CarbonImmutable::parse('2026-12-04 10:00:00', config('distriva.business_timezone'));
        $this->assertSame('2026-12-09 23:59:59', app(BusinessCalendar::class)->dueAt($friday, 3)->format('Y-m-d H:i:s'));   // Mon 7, Tue 8, Wed 9
        DB::table('business_holidays')->insert(['holiday_date' => '2026-12-07', 'name' => 'Libur uji', 'created_at' => now()]);
        $this->assertSame('2026-12-10 23:59:59', (new BusinessCalendar)->dueAt($friday, 3)->format('Y-m-d H:i:s'));            // Monday is a holiday
        $this->assertSame(1, (new BusinessCalendar)->workingDaysLeft(CarbonImmutable::parse('2026-12-08 23:59:59', config('distriva.business_timezone')), CarbonImmutable::parse('2026-12-04 08:00:00', config('distriva.business_timezone'))));
    }

    #[Test]
    public function a_task_runs_from_assignment_to_acceptance_with_every_step_recorded_and_the_right_people_told(): void
    {
        $app = $this->application();
        $r = $this->task($app)->assertCreated();
        $id = $r->json('data.id');
        $this->assertSame(3, $r->json('data.sla_working_days'));                                  // the survey standard
        $this->assertNotNull($r->json('data.due_at'));
        $this->assertSame(1, $this->inbox($this->teknik, 'Tugas baru:%'));

        $this->as($this->teknikB)->postJson("/api/tasks/{$id}/start")->assertNotFound();           // another ULP never sees it
        $this->as($this->manager)->postJson("/api/tasks/{$id}/start")->assertStatus(409);          // only the assignee works the task
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit")->assertStatus(409);          // not started yet
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/accept")->assertOk();
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/start")->assertOk();
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit", ['note' => 'Selesai di lapangan'])->assertOk()->assertJsonPath('data.status', 'SUBMITTED');
        $this->assertSame(1, $this->inbox($this->manager, 'Tugas menunggu pemeriksaan:%'));

        $this->as($this->teknik)->postJson("/api/tasks/{$id}/complete")->assertForbidden();        // no tasks.assign
        $this->as($this->manager)->postJson("/api/tasks/{$id}/complete", ['note' => 'Baik'])->assertOk()->assertJsonPath('data.status', 'COMPLETED')->assertJsonPath('data.met_deadline', true);
        $this->assertSame(1, $this->inbox($this->teknik, 'Tugas diterima:%'));
        $this->as($this->manager)->postJson("/api/tasks/{$id}/cancel", ['reason' => 'x'])->assertStatus(409);   // final

        $show = $this->as($this->manager)->getJson("/api/tasks/{$id}")->assertOk()->json('data');
        $this->assertSame(['ASSIGNED', 'ACCEPTED', 'STARTED', 'SUBMITTED', 'COMPLETED'], array_column($show['events'], 'event_type'));
        $this->assertNotNull($show['accepted_at']);
        $this->assertNotNull($show['started_at']);
    }

    #[Test]
    public function a_returned_task_goes_back_to_work_with_the_reason_and_the_reviewer_is_never_the_assignee(): void
    {
        $app = $this->application();
        $id = $this->task($app)->assertCreated()->json('data.id');
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/start")->assertOk();
        $this->assertNotNull(DB::table('application_tasks')->where('id', $id)->value('accepted_at'));   // starting also accepts
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit")->assertOk();
        $this->as($this->manager)->postJson("/api/tasks/{$id}/return", [])->assertStatus(422);
        $this->as($this->manager)->postJson("/api/tasks/{$id}/return", ['reason' => 'Foto belum lengkap'])->assertOk()->assertJsonPath('data.status', 'IN_PROGRESS');
        $this->assertSame(1, $this->inbox($this->teknik, 'Tugas dikembalikan:%'));
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit")->assertOk();

        $own = $this->as($this->manager)->postJson("/api/applications/{$app}/tasks", ['task_type' => 'LAINNYA', 'title' => 'Tugas sendiri', 'assignee_id' => $this->manager->getKey()])->assertCreated()->json('data.id');
        $this->as($this->manager)->postJson("/api/tasks/{$own}/start")->assertOk();
        $this->as($this->manager)->postJson("/api/tasks/{$own}/submit")->assertOk();
        $this->as($this->manager)->postJson("/api/tasks/{$own}/complete")->assertStatus(409);       // nobody reviews their own task
    }

    #[Test]
    public function only_active_staff_of_the_unit_can_receive_a_task_and_the_application_must_still_be_open(): void
    {
        $app = $this->application();
        $this->task($app, 'SURVEI', $this->vendor)->assertStatus(409);
        $this->task($app, 'SURVEI', $this->teknikB)->assertStatus(409);                            // another ULP
        $this->as($this->teknik)->postJson("/api/applications/{$app}/tasks", ['task_type' => 'SURVEI', 'title' => 'x', 'assignee_id' => $this->teknik->getKey()])->assertForbidden();
        $this->as($this->manager)->postJson("/api/applications/{$app}/tasks", ['task_type' => 'TIDAK_ADA', 'title' => 'x', 'assignee_id' => $this->teknik->getKey()])->assertStatus(409);
        $this->as($this->manager)->getJson("/api/applications/{$app}/tasks/assignees")->assertOk()->assertJsonFragment(['id' => $this->teknik->getKey()]);

        DB::table('applications')->where('id', $app)->update(['current_status' => 'COMPLETED']);
        $this->task($app)->assertStatus(409);
    }

    #[Test]
    public function an_overdue_task_is_flagged_counted_and_announced_exactly_once(): void
    {
        $app = $this->application();
        $id = $this->task($app)->assertCreated()->json('data.id');
        $this->as($this->teknik)->getJson('/api/tasks/summary')->assertOk()->assertJsonPath('data.mine_open', 1)->assertJsonPath('data.mine_overdue', 0);

        DB::table('application_tasks')->where('id', $id)->update(['due_at' => now()->subDay()]);
        $this->as($this->teknik)->getJson('/api/tasks?mine=1&overdue=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.is_overdue', true);
        $this->as($this->teknik)->getJson('/api/tasks/summary')->assertJsonPath('data.mine_overdue', 1);
        $this->as($this->manager)->getJson('/api/tasks/summary')->assertJsonPath('data.unit_overdue', 1);
        $this->as($this->teknikB)->getJson('/api/tasks/summary')->assertJsonPath('data.unit_overdue', 0);

        Artisan::call('distriva:tasks-remind');
        Artisan::call('distriva:tasks-remind');                                                    // the flag stops a repeat
        $this->assertSame(1, $this->inbox($this->teknik, 'Tugas melewati tenggat:%'));
        $this->assertSame(1, $this->inbox($this->manager, 'Tugas melewati tenggat:%'));

        $this->as($this->teknik)->postJson("/api/tasks/{$id}/start")->assertOk();
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit")->assertOk();
        $this->as($this->teknik)->getJson('/api/tasks/summary')->assertJsonPath('data.mine_overdue', 0);   // submitted: the assignee no longer owes work
        $this->as($this->manager)->getJson("/api/tasks/{$id}")->assertJsonPath('data.met_deadline', false);
    }

    #[Test]
    public function a_task_about_to_be_due_is_announced_once_and_a_task_without_sla_has_no_deadline(): void
    {
        $app = $this->application();
        $id = $this->task($app)->assertCreated()->json('data.id');
        DB::table('application_tasks')->where('id', $id)->update(['due_at' => now()->addHours(2)]);
        Artisan::call('distriva:tasks-remind');
        Artisan::call('distriva:tasks-remind');
        $this->assertSame(1, $this->inbox($this->teknik, 'Tugas segera jatuh tempo:%'));

        $free = $this->task($app, 'GAMBAR')->assertCreated();
        $this->assertNull($free->json('data.due_at'));
        $this->assertNull($free->json('data.sla_working_days'));
    }

    #[Test]
    public function only_the_administrator_edits_the_sla_and_holidays_and_a_new_sla_applies_to_later_tasks(): void
    {
        $this->as($this->manager)->putJson('/api/sla/configurations/GAMBAR', ['working_days' => 5, 'is_active' => true])->assertForbidden();
        $this->as($this->manager)->postJson('/api/sla/holidays', ['holiday_date' => '2026-12-25', 'name' => 'Natal'])->assertForbidden();
        $this->as($this->manager)->getJson('/api/sla/configurations')->assertOk()->assertJsonPath('can.manage', false)->assertJsonPath('can.assign', true);

        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/GAMBAR', ['working_days' => 5, 'is_active' => true])->assertOk();
        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/GAMBAR', ['working_days' => 0, 'is_active' => true])->assertStatus(422);
        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/XYZ', ['working_days' => 5, 'is_active' => true])->assertNotFound();
        $this->as($this->sysAdmin)->postJson('/api/sla/holidays', ['holiday_date' => '2026-12-25', 'name' => 'Natal'])->assertCreated();
        $this->as($this->sysAdmin)->postJson('/api/sla/holidays', ['holiday_date' => '2026-12-25', 'name' => 'Natal'])->assertStatus(409);
        $this->as($this->teknik)->getJson('/api/sla/holidays?year=2026')->assertOk()->assertJsonCount(1, 'data');

        $app = $this->application();
        $this->assertSame(5, $this->task($app, 'GAMBAR')->assertCreated()->json('data.sla_working_days'));
        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/GAMBAR', ['working_days' => 9, 'is_active' => true])->assertOk();
        $this->assertSame(5, (int) DB::table('application_tasks')->where('task_type', 'GAMBAR')->value('sla_working_days'));   // the snapshot stays
        $this->as($this->sysAdmin)->deleteJson('/api/sla/holidays/2026-12-25')->assertOk();
    }

    #[Test]
    public function a_task_can_be_reassigned_and_cancelled_by_the_manager_with_a_reason(): void
    {
        $app = $this->application();
        $second = $this->makeUser();
        $this->assign($second, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA);
        $id = $this->task($app)->assertCreated()->json('data.id');
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/start")->assertOk();

        $this->as($this->manager)->postJson("/api/tasks/{$id}/reassign", ['assignee_id' => $this->teknik->getKey()])->assertStatus(409);
        $this->as($this->manager)->postJson("/api/tasks/{$id}/reassign", ['assignee_id' => $second->getKey()])->assertOk()->assertJsonPath('data.status', 'ASSIGNED')->assertJsonPath('data.assignee_id', $second->getKey());
        $this->assertSame(1, $this->inbox($second, 'Tugas baru:%'));
        $this->as($this->teknik)->postJson("/api/tasks/{$id}/submit")->assertStatus(409);          // no longer theirs

        $this->as($this->manager)->postJson("/api/tasks/{$id}/cancel", [])->assertStatus(422);
        $this->as($this->manager)->postJson("/api/tasks/{$id}/cancel", ['reason' => 'Pelanggan membatalkan'])->assertOk();
        $this->assertSame('CANCELLED', $this->taskStatus($id));
        $this->as($this->manager)->getJson("/api/applications/{$app}/tasks")->assertOk()->assertJsonCount(1, 'data');
    }
}
