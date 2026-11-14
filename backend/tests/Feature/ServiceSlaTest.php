<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class ServiceSlaTest extends PostgresTestCase
{
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
        $up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $up3);
        $this->ulpB = $this->makeUnit('ULP', $up3);
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
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
        // the test builds MTO packages directly: the drawing chain behind them is not under test (the transaction is rolled back after each test)
        DB::statement('ALTER TABLE mto_packages DROP CONSTRAINT mto_packages_drawing_version_id_foreign');
        DB::statement('ALTER TABLE mto_lines DROP CONSTRAINT mto_lines_bom_header_id_foreign');
        DB::statement('ALTER TABLE mto_lines DROP CONSTRAINT mto_lines_khs_item_id_foreign');
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

    /** An application of ULP A with an MTO of the given groups and the given status/payment date (items and lines go in while the package is still a draft). @param list<string> $groups @param list<array<string,mixed>> $lines */
    private function application(array $groups, string $status = 'PAID', ?string $paidAt = '2026-10-01', string $mto = 'APPROVED', array $lines = []): string
    {
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        DB::table('applications')->where('id', $id)->update(['current_status' => $status, 'paid_at' => $paidAt]);
        if ($groups !== []) {
            $pkg = (string) Str::uuid();
            DB::table('mto_packages')->insert(['id' => $pkg, 'application_id' => $id, 'drawing_version_id' => (string) Str::uuid(), 'package_number' => 'MTO-T-'.Str::random(8), 'status' => 'DRAFT', 'valid_on' => '2026-10-01',
                'params' => '{}', 'snapshot_hash' => str_repeat('a', 64), 'created_by' => $this->teknik->getKey(), 'verified_by' => $this->teknik->getKey(), 'verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            foreach ($groups as $g) {
                $type = (string) Str::uuid();
                DB::table('construction_types')->insert(['id' => $type, 'group_code' => $g, 'code' => $g.'-'.Str::random(5), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
                DB::table('mto_items')->insert(['id' => (string) Str::uuid(), 'package_id' => $pkg, 'construction_type_id' => $type, 'group_code' => $g, 'construction_code' => $g, 'construction_label' => $g, 'psg' => 1, 'bkr' => 0, 'created_at' => now(), 'updated_at' => now()]);
            }
            foreach ($lines as $l) {
                DB::table('mto_lines')->insert($l + ['id' => (string) Str::uuid(), 'package_id' => $pkg, 'bom_header_id' => (string) Str::uuid(), 'khs_item_id' => (string) Str::uuid()]);
            }
            $mto !== 'DRAFT' && DB::table('mto_packages')->where('id', $pkg)->update(['status' => 'VERIFIED']);
            $mto === 'APPROVED' && DB::table('mto_packages')->where('id', $pkg)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
        }

        return $id;
    }

    private function sla(string $app, ?User $by = null)
    {
        return $this->as($by ?? $this->teknik)->getJson("/api/applications/{$app}/service-sla");
    }

    #[Test]
    public function the_owner_days_are_seeded_per_category_and_longest_category_of_the_mto_wins(): void
    {
        $days = DB::table('sla_configurations')->where('kind', 'SERVICE')->orderBy('working_days')->pluck('working_days', 'task_type')->all();
        $this->assertSame(['LAYANAN_JTR' => 14, 'LAYANAN_JTM_TRAFO' => 24, 'LAYANAN_KUBIKEL' => 100], $days);

        $this->assertSame(['LAYANAN_JTR', 14], [$this->sla($this->application(['SUTR']))->json('data.category'), $this->sla($this->application(['SUTR']))->json('data.working_days')]);
        $this->assertSame(24, $this->sla($this->application(['SUTR', 'GTT_UMUM']))->json('data.working_days'));
        $this->assertSame(24, $this->sla($this->application(['SUTM']))->json('data.working_days'));
        $this->assertSame(100, $this->sla($this->application(['SUTR', 'SUTM', 'KUBIKEL']))->json('data.working_days'));
        $this->assertNull($this->sla($this->application(['PBPD_6_41', 'SR1PH']))->json('data'));     // no extension category: no service SLA
        $this->assertNull($this->sla($this->application([]))->json('data'));                          // no MTO yet
        $this->assertSame(24, $this->sla($this->application(['SUTM'], mto: 'DRAFT'))->json('data.working_days'));   // a draft MTO already shows the expected category
    }

    #[Test]
    public function the_deadline_counts_working_days_from_the_payment_date_and_the_status_follows_it(): void
    {
        $paid = $this->application(['SUTR'], 'PAID', '2026-11-02');                                    // Monday: 14 working days end on Friday 20 Nov
        $r = $this->sla($paid)->json('data');
        $this->assertSame('PAID', $r['start_basis']);
        $this->assertStringStartsWith('2026-11-20T23:59:59', $r['due_at']);
        $this->assertSame('ON_TRACK', $r['status']);                                                    // today is Saturday 14 Nov: 4 working days left

        $soon = $this->application(['SUTR'], 'PAID', '2026-10-29');                                    // due Thu 19 Nov... 14 wd after Thu 29 Oct
        $this->assertContains($this->sla($soon)->json('data.status'), ['ON_TRACK', 'DUE_SOON']);
        $due = $this->application(['SUTR'], 'PAID', '2026-10-21');                                     // 14 wd after Wed 21 Oct = Tue 10 Nov end (past on 14 Nov)
        $late = $this->sla($due)->json('data');
        $this->assertSame('OVERDUE', $late['status']);
        $this->assertSame(3, $late['late_working_days']);                                               // Wed 11, Thu 12, Fri 13 Nov
    }

    #[Test]
    public function the_clock_starts_only_after_payment_and_falls_back_to_the_bayar_status_date_then_the_request_date(): void
    {
        $this->assertSame('NOT_STARTED', $this->sla($this->application(['SUTR'], 'APPROVED', null))->json('data.status'));

        $bayar = $this->application(['SUTR'], 'PAID', null);
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $bayar, 'external_status_code' => 'BAYAR', 'observed_at' => '2026-11-09 07:00:00', 'received_at' => now()]);
        $this->assertSame(['STATUS_BAYAR'], [$this->sla($bayar)->json('data.start_basis')]);
        $this->assertStringStartsWith('2026-11-27T23:59:59', $this->sla($bayar)->json('data.due_at'));

        $plain = $this->application(['SUTR'], 'PAID', null);
        DB::table('applications')->where('id', $plain)->update(['source_created_at' => '2026-11-03 08:00:00']);
        $this->assertSame('REQUESTED', $this->sla($plain)->json('data.start_basis'));

        $this->assertNull($this->sla($this->application(['SUTR'], 'CANCELLED'))->json('data'));
    }

    #[Test]
    public function a_finished_application_is_met_or_met_late_by_its_peremajaan_date(): void
    {
        $inTime = $this->application(['SUTR'], 'CONNECTION_DONE', '2026-10-01');                       // due Wed 21 Oct (14 working days after Thu 1 Oct)
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $inTime, 'external_status_code' => 'PEREMAJAAN', 'observed_at' => '2026-10-15 07:00:00', 'received_at' => now()]);
        $this->assertSame('MET', $this->sla($inTime)->json('data.status'));

        $late = $this->application(['SUTR'], 'COMPLETED', '2026-10-01');
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $late, 'external_status_code' => 'PEREMAJAAN', 'observed_at' => '2026-11-10 07:00:00', 'received_at' => now()]);
        $r = $this->sla($late)->json('data');
        $this->assertSame('MET_LATE', $r['status']);
        $this->assertGreaterThan(0, $r['late_working_days']);
    }

    #[Test]
    public function an_overdue_application_shows_the_material_shortfall_and_takes_an_explanation_from_ulp_staff_only(): void
    {
        $app = $this->application(['SUTR'], 'PAID', '2026-10-01', 'APPROVED', [['group_code' => 'SUTR', 'sequence' => 1, 'khs_code' => 'JTR001', 'khs_name' => 'Kabel TIC 3x70', 'unit_text' => 'ms', 'material' => 120]]);

        $r = $this->sla($app)->assertOk()->json();
        $this->assertSame('OVERDUE', $r['data']['status']);
        $this->assertTrue($r['data']['materials']['known']);
        $this->assertFalse($r['data']['materials']['complete']);
        $this->assertSame('JTR001', $r['data']['materials']['shortfall'][0]['khs_code']);
        $this->assertSame(120.0, (float) $r['data']['materials']['shortfall'][0]['remaining']);
        $this->assertTrue($r['can']['note']);

        $this->as($this->teknikB)->getJson("/api/applications/{$app}/service-sla")->assertNotFound();
        $this->as($this->vendor)->getJson("/api/applications/{$app}/service-sla")->assertForbidden();
        $this->as($this->teknikB)->postJson("/api/applications/{$app}/service-sla/notes", ['note' => 'x'])->assertNotFound();
        $this->as($this->vendor)->postJson("/api/applications/{$app}/service-sla/notes", ['note' => 'x'])->assertForbidden();
        $this->as($this->teknik)->postJson("/api/applications/{$app}/service-sla/notes", ['note' => ''])->assertStatus(422);

        $this->as($this->teknik)->getJson('/api/service-sla?needs_note=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.application_id', $app);
        $this->as($this->teknik)->postJson("/api/applications/{$app}/service-sla/notes", ['note' => 'Kabel TIC belum tersedia di gudang'])->assertCreated()->assertJsonPath('data.notes.0.note', 'Kabel TIC belum tersedia di gudang');
        $this->as($this->teknik)->getJson('/api/service-sla?needs_note=1')->assertJsonPath('meta.total', 0);
        $this->as($this->teknik)->getJson('/api/service-sla?status=OVERDUE')->assertJsonPath('data.0.last_note.note', 'Kabel TIC belum tersedia di gudang');
        $this->as($this->teknik)->getJson('/api/service-sla/summary')->assertJsonPath('data.overdue', 1);

        $fine = $this->application(['SUTR'], 'PAID', '2026-11-12');
        $this->as($this->teknik)->postJson("/api/applications/{$fine}/service-sla/notes", ['note' => 'x'])->assertCreated();   // a note may be written before the deadline too
        $none = $this->application(['SR1PH']);
        $this->as($this->teknik)->postJson("/api/applications/{$none}/service-sla/notes", ['note' => 'x'])->assertStatus(409);
    }

    #[Test]
    public function the_scheduler_announces_a_service_sla_overrun_once_to_the_ulp_staff_and_the_days_are_editable(): void
    {
        $app = $this->application(['SUTR'], 'PAID', '2026-10-01');
        Artisan::call('distriva:tasks-remind');
        Artisan::call('distriva:tasks-remind');
        $title = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->where('title', 'like', 'Permohonan %melewati SLA layanan')->count();
        $this->assertSame(1, $title($this->teknik));
        $this->assertSame(1, $title($this->manager));
        $this->assertSame(0, $title($this->teknikB));
        $this->assertSame(0, $title($this->vendor));

        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/LAYANAN_JTR', ['working_days' => 60, 'is_active' => true])->assertOk();
        $this->assertSame('ON_TRACK', $this->sla($app)->json('data.status'));                          // the new days apply to the computed deadline at once
        $this->as($this->sysAdmin)->putJson('/api/sla/configurations/LAYANAN_JTR', ['working_days' => null, 'is_active' => true])->assertOk();
        $this->assertNull($this->sla($app)->json('data'));                                              // no days = no service SLA

        $task = $this->as($this->manager)->postJson("/api/applications/{$app}/tasks", ['task_type' => 'LAYANAN_JTR', 'title' => 'x', 'assignee_id' => $this->teknik->getKey()]);
        $task->assertStatus(409);                                                                       // a service SLA is not a task type
    }

    #[Test]
    public function a_stage_task_never_ends_after_the_running_service_sla_and_a_task_without_days_takes_its_deadline(): void
    {
        $make = fn (string $app, string $type) => $this->as($this->manager)->postJson("/api/applications/{$app}/tasks", ['task_type' => $type, 'title' => 'Tahap', 'assignee_id' => $this->teknik->getKey()])->assertCreated()->json('data');

        $roomy = $this->application(['SUTR'], 'PAID', '2026-11-12');                                   // service SLA ends in December: the survey's own 3 working days are shorter
        $t = $make($roomy, 'SURVEI');
        $this->assertSame('TASK', $t['due_basis']);
        $this->assertStringStartsWith('2026-11-18 23:59:59', $t['due_at']);

        $tight = $this->application(['SUTR'], 'PAID', '2026-10-28');                                   // service SLA ends Tue 17 Nov, before Wed 18 Nov (own deadline)
        $t = $make($tight, 'SURVEI');
        $this->assertSame('TMP', $t['due_basis']);
        $this->assertStringStartsWith('2026-11-17 23:59:59', $t['due_at']);
        $this->assertSame('TMP', $make($tight, 'GAMBAR')['due_basis']);                                  // no days of its own: takes the service deadline

        $late = $this->application(['SUTR'], 'PAID', '2026-10-01');                                    // already overdue: a new task is born late, with the reason
        $t = $make($late, 'GAMBAR');
        $this->assertSame('TMP', $t['due_basis']);
        $this->assertTrue($t['is_overdue']);

        $unpaid = $this->application(['SUTR'], 'APPROVED', null);                                      // the clock has not started: only the task's own SLA counts
        $this->assertSame('TASK', $make($unpaid, 'SURVEI')['due_basis']);
        $this->assertNull($make($unpaid, 'GAMBAR')['due_at']);

        $this->assertSame(2, $this->sla($tight)->json('data.working_days_left'));                       // Mon 16 and Tue 17 after Sat 14
    }

    #[Test]
    public function the_old_sla_report_uses_the_service_sla_where_it_applies_and_the_general_rule_elsewhere(): void
    {
        $over = $this->application(['SUTR'], 'PAID', '2026-10-01');                                    // service SLA overrun
        $unpaid = $this->application(['SUTM'], 'APPROVED', null);                                      // old, but its clock has not started
        $plain = $this->application([], 'APPROVED', null);                                             // no category: the general rule (> 25 days) stays
        $fine = $this->application(['SUTR'], 'PAID', '2026-11-12');
        DB::table('applications')->whereIn('id', [$unpaid, $plain, $fine])->update(['created_at' => '2026-09-01 08:00:00']);
        DB::table('applications')->where('id', $over)->update(['created_at' => '2026-09-01 08:00:00']);

        $report = fn () => $this->as($this->teknik)->getJson('/api/reports/sla')->assertOk()->json('data');
        $by = fn (array $d) => collect($d['rows'])->keyBy('id');
        $d = $report();
        $rows = $by($d);
        $this->assertSame(['OVERDUE', 'LAYANAN', true, 'OVERDUE'], [$rows[$over]['sla_status'], $rows[$over]['sla_basis'], $rows[$over]['needs_note'], $rows[$over]['service_status']]);
        $this->assertSame(['ON_TRACK', 'LAYANAN'], [$rows[$unpaid]['sla_status'], $rows[$unpaid]['sla_basis']]);
        $this->assertSame(['OVERDUE', 'UMUM', null], [$rows[$plain]['sla_status'], $rows[$plain]['sla_basis'], $rows[$plain]['service_category']]);
        $this->assertSame('ON_TRACK', $rows[$fine]['sla_status']);
        $this->assertSame([2, 1], [$d['summary']['overdue_count'], $d['summary']['needs_note_count']]);

        $this->as($this->teknik)->postJson("/api/applications/{$over}/service-sla/notes", ['note' => 'Trafo belum tersedia'])->assertCreated();
        $d = $report();
        $this->assertSame(['Trafo belum tersedia', false, 0], [$by($d)[$over]['delay_note'], $by($d)[$over]['needs_note'], $d['summary']['needs_note_count']]);

        $this->as($this->teknik)->get('/api/reports/sla?format=xlsx')->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
}
