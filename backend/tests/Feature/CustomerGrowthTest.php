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

class CustomerGrowthTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private OrganizationalUnit $ulpC;

    private User $admin;

    private User $teknikA;

    private User $retail;

    /** @var array<string,mixed> */
    private array $template = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $this->ulpC = $this->makeUnit('ULP', $this->makeUnit('UP3'));
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->admin = $mk('SYS_ADMIN', null);
        $this->teknikA = $mk('TEKNIK', $this->ulpA);
        $this->retail = $mk('NIAGA_RETAIL', $this->ulpA);
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->template = (array) DB::table('applications')->where('id', $id)->first();
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

    /** One application of the given type/unit/delta, connected (PEREMAJAAN seen on $when) unless another status is given. */
    private function done(OrganizationalUnit $ulp, string $type, float $delta, string $when, string $tariff = 'R1T', string $status = 'CONNECTION_DONE'): string
    {
        $id = (string) Str::uuid();
        DB::table('applications')->insert(array_merge($this->template, ['id' => $id, 'application_number' => 'T-'.Str::random(10), 'application_type' => $type, 'transaction_type' => $type === 'PB' ? 'PASANG BARU' : 'PERUBAHAN DAYA',
            'organizational_unit_id' => $ulp->getKey(), 'delta_power_kva' => $delta, 'new_tariff_code' => $tariff, 'current_status' => $status, 'source_created_at' => $when.' 08:00:00', 'last_external_status_at' => $when.' 09:00:00',
            'created_at' => $when.' 08:00:00', 'updated_at' => $when.' 09:00:00']));
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $id, 'external_system' => 'EIS', 'external_status_code' => 'PEREMAJAAN', 'observed_at' => $when.' 09:00:00', 'received_at' => $when.' 09:00:00']);

        return $id;
    }

    private function growth(User $u, string $query = ''): array
    {
        return $this->as($u)->getJson('/api/reports/customer-growth'.($query === '' ? '' : '?'.$query))->assertOk()->json('data');
    }

    #[Test]
    public function months_years_tariffs_and_units_are_counted_from_connected_applications_only(): void
    {
        $this->done($this->ulpA, 'PB', 4.4, '2025-01-10');
        $this->done($this->ulpA, 'PB', 3.3, '2025-01-20');
        $this->done($this->ulpB, 'PB', 10.0, '2025-02-05', 'B1T');
        $this->done($this->ulpA, 'PD', 5.0, '2025-02-07');
        $this->done($this->ulpA, 'PD', -2.0, '2025-02-08');
        $this->done($this->ulpA, 'PD', 0.0, '2025-02-09');
        $this->done($this->ulpA, 'PB', 99.0, '2025-01-15', 'R1T', 'CANCELLED');          // was connected once, now cancelled: not counted
        $this->done($this->ulpC, 'PB', 50.0, '2025-01-12');                              // another UP3

        $d = $this->growth($this->admin, 'up3_id='.$this->up3->getKey());
        $m = collect($d['monthly'])->keyBy('month');
        $this->assertSame(['2025-01', '2025-02'], array_keys($m->all()));
        $this->assertEquals([2, 7.7], [$m['2025-01']['pb_count'], $m['2025-01']['pb_kva']]);
        $this->assertEquals([1, 10.0, 1, 5.0, 1, -2.0, 1, 3.0], [$m['2025-02']['pb_count'], $m['2025-02']['pb_kva'], $m['2025-02']['pd_up_count'], $m['2025-02']['pd_up_kva'], $m['2025-02']['pd_down_count'], $m['2025-02']['pd_down_kva'], $m['2025-02']['pd_same_count'], $m['2025-02']['pd_net_kva']]);
        $this->assertSame(1, $m['2025-01']['cancelled']);                                  // the cancelled one shows in the cancelled column of its month
        $this->assertEquals([3, 17.7], [$d['yearly'][0]['pb_count'], $d['yearly'][0]['pb_kva']]);
        $this->assertEquals(['Rumah tangga' => 2, 'Bisnis' => 1], collect($d['by_tariff']['groups'])->pluck('count', 'group')->all());
        $this->assertEquals([2, 1], collect($d['by_unit'])->whereIn('unit_id', [$this->ulpA->getKey(), $this->ulpB->getKey()])->sortByDesc('pb_count')->pluck('pb_count')->values()->all());
        $this->assertNotContains($this->ulpC->getKey(), array_column($d['by_unit'], 'unit_id'));
    }

    #[Test]
    public function a_role_sees_only_its_own_ulp_and_the_unit_filter_narrows_further(): void
    {
        $this->done($this->ulpA, 'PB', 4.0, '2025-03-01');
        $this->done($this->ulpB, 'PB', 6.0, '2025-03-02');

        $this->assertSame(1, $this->growth($this->teknikA)['kpi']['pb_total']);
        $this->assertSame(2, $this->growth($this->admin, 'up3_id='.$this->up3->getKey())['kpi']['pb_total']);
        $this->assertSame(1, $this->growth($this->admin, 'unit_id='.$this->ulpB->getKey())['kpi']['pb_total']);
        $this->as($this->teknikA)->getJson('/api/reports/customer-growth?unit_id='.$this->ulpB->getKey())->assertNotFound();
        $this->as($this->admin)->getJson('/api/reports/customer-growth?from=2025-05-01&to=2025-03-01')->assertStatus(422);
        $this->assertSame(0, $this->growth($this->admin, 'from=2025-04-01')['kpi']['pb_total']);                           // a range that excludes the data
    }

    #[Test]
    public function growth_rates_seasonality_and_anomalies_need_complete_months_and_enough_history(): void
    {
        $counts = [];   // 2024: 24 months-worth baseline of 2 PB a month (varying 1..3), 2025 Jan..Oct baseline, Nov 2025 spike
        foreach (['2024' => range(1, 12), '2025' => range(1, 12)] as $year => $months) {
            foreach ($months as $mo) {
                $n = ((int) $year === 2025 && $mo === 6) ? 12 : (($mo % 3) + 1);
                $counts[sprintf('%s-%02d', $year, $mo)] = $n;
                for ($i = 0; $i < $n; $i++) {
                    $this->done($this->ulpA, 'PB', 2.0, sprintf('%s-%02d-%02d', $year, $mo, 10 + $i));
                }
            }
        }
        $this->done($this->ulpA, 'PB', 2.0, '2026-11-02');                                    // current month: partial

        $d = $this->growth($this->admin, 'up3_id='.$this->up3->getKey());
        $m = collect($d['monthly'])->keyBy('month');
        $this->assertTrue($m['2026-11']['partial']);
        $this->assertNull($m['2026-11']['mom_pct']);                                       // a partial month has no growth figure
        $this->assertEquals(round(($counts['2025-02'] - $counts['2025-01']) / $counts['2025-01'] * 100, 1), $m['2025-02']['mom_pct']);
        $this->assertEquals(round(($counts['2025-03'] - $counts['2024-03']) / $counts['2024-03'] * 100, 1), $m['2025-03']['yoy_pct']);
        $y = collect($d['yearly'])->keyBy('year');
        $this->assertEquals([array_sum(array_filter($counts, fn ($v, $k) => str_starts_with($k, '2024'), ARRAY_FILTER_USE_BOTH)), null], [$y[2024]['pb_count'], $y[2024]['yoy_pct']]);
        $this->assertNotNull($y[2025]['yoy_pct']);
        $this->assertTrue($y[2026]['partial']);
        $this->assertNull($y[2026]['yoy_pct']);                                            // 2026 is incomplete: no yearly growth claimed
        $this->assertEquals([2024, 2025], $d['seasonality']['years']);
        $this->assertCount(12, $d['seasonality']['months']);
        $this->assertContains('2025-06', array_column($d['anomalies'], 'month'));          // 12 in one month against a baseline of 1..3
        $this->assertSame('NAIK', collect($d['anomalies'])->firstWhere('month', '2025-06')['direction']);
        $this->assertSame('2026-10', $d['kpi']['last_full_month']);
        $this->assertSame('2026-11', $d['kpi']['partial_month']);
    }

    #[Test]
    public function the_analysis_can_be_exported_and_is_closed_to_roles_without_the_report_grant(): void
    {
        $this->done($this->ulpA, 'PB', 4.0, '2025-03-01');
        $this->as($this->admin)->get('/api/reports/customer-growth?format=xlsx', ['Accept' => 'application/json'])->assertOk()->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $vendor = $this->makeUser();
        $this->assign($vendor, Role::query()->where('name', 'VENDOR')->firstOrFail(), $this->ulpA);
        $this->as($vendor)->getJson('/api/reports/customer-growth')->assertForbidden();
    }
}
