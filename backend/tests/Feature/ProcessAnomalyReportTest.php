<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Laporan "Anomali & Rekonsiliasi" memuat anomali seluruh proses (bukan hanya MIMS) dan dibatasi ULP/UP3 peminta. */
class ProcessAnomalyReportTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $retailA;

    private User $retailB;

    private User $teknikA;

    private User $managerUp3;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role, OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retailA = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->retailB = $mk('NIAGA_RETAIL', $this->ulpB);
        $this->teknikA = $mk('TEKNIK', $this->ulpA);
        $this->managerUp3 = $mk('MANAGER_UP3', $this->up3);
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
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

    private function application(User $by, OrganizationalUnit $unit, string $status, string $createdAt): string
    {
        CarbonImmutable::setTestNow($createdAt);                                                           // riwayat status bersifat append-only: dibuat pada tanggalnya
        $id = $this->as($by)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $unit->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
        DB::table('applications')->where('id', $id)->update(['current_status' => $status, 'created_at' => $createdAt]);

        return $id;
    }

    #[Test]
    public function a_stalled_application_is_reported_only_to_the_units_the_caller_may_see(): void
    {
        $oldA = $this->application($this->retailA, $this->ulpA, 'PAID', '2026-09-01 08:00:00');         // 74 hari tanpa perubahan
        $this->application($this->retailA, $this->ulpA, 'PAID', '2026-11-10 08:00:00');                  // baru: tidak macet
        $this->application($this->retailA, $this->ulpA, 'CONNECTION_DONE', '2026-01-01 08:00:00');       // selesai: bukan anomali
        $oldB = $this->application($this->retailB, $this->ulpB, 'APPROVED', '2026-08-01 08:00:00');

        $rows = fn (User $u) => collect($this->as($u)->getJson('/api/reports/erp-anomalies')->assertOk()->json('data.process_anomalies'));

        $a = $rows($this->teknikA);                                          // peran ULP: hanya ULP-nya
        $this->assertCount(1, $a->where('category', 'APP_STALLED'));
        $this->assertSame($this->ulpA->code, $a->first()['unit_code']);

        $up3 = $rows($this->managerUp3);                                     // peran UP3: semua ULP di bawahnya
        $this->assertCount(2, $up3->where('category', 'APP_STALLED'));
        $this->assertEqualsCanonicalizing([$this->ulpA->code, $this->ulpB->code], $up3->pluck('unit_code')->all());

        $summary = $this->as($this->managerUp3)->getJson('/api/reports/erp-anomalies')->json('data.summary');
        $this->assertSame(2, collect($summary['by_category'])->firstWhere('category', 'APP_STALLED')['count']);
        $this->assertGreaterThanOrEqual(2, $summary['process_anomalies_count']);
        $this->assertNotEmpty($oldA.$oldB);
    }

    #[Test]
    public function a_unit_without_anomalies_gets_an_empty_list_and_the_export_covers_the_whole_process(): void
    {
        $this->as($this->teknikA)->getJson('/api/reports/erp-anomalies')->assertOk()->assertJsonPath('data.summary.process_anomalies_count', 0)->assertJsonPath('data.process_anomalies', []);
        $this->application($this->retailA, $this->ulpA, 'PAID', '2026-09-01 08:00:00');
        $this->as($this->teknikA)->get('/api/reports/erp-anomalies?format=xlsx')->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
}
