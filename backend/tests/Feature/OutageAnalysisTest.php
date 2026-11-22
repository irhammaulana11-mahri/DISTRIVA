<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\OutagePermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class OutageAnalysisTest extends PostgresTestCase
{
    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $admin;

    private User $teknikA;

    private User $niaga;

    private string $f1;

    private string $f2;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(OutagePermissionSeeder::class);
        Cache::flush();
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
        $this->up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->admin = $mk('SYS_ADMIN', null);
        $this->teknikA = $mk('TEKNIK', $this->ulpA);
        $this->niaga = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->f1 = $this->feeder('F1', 'FEEDER SATU');
        $this->f2 = $this->feeder('F2', 'FEEDER DUA');
        $this->customers($this->f1, $this->ulpA, 100);
        $this->customers($this->f2, $this->ulpA, 50);
        $this->customers($this->f1, $this->ulpB, 20);
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

    private function feeder(string $code, string $name): string
    {
        $id = (string) Str::uuid();
        DB::table('distribution_feeders')->insert(['id' => $id, 'code' => $code, 'name' => $name, 'gi_name' => 'GI X', 'owner_unit_id' => $this->ulpA->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    /** $n active customers of $feeder in $ulp, behind one gardu (of $capacity kVA) with a reading of $loading %. */
    private function customers(string $feeder, OrganizationalUnit $ulp, int $n, float $loading = 60.0, float $capacity = 100): string
    {
        $sub = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $sub, 'code' => 'G'.Str::random(6), 'name' => 'Gardu '.Str::random(3), 'organizational_unit_id' => $ulp->getKey(), 'feeder_id' => $feeder, 'capacity_kva' => $capacity, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('substation_readings')->insert(['id' => (string) Str::uuid(), 'substation_id' => $sub, 'measured_on' => '2026-10-01', 'loading_pct' => $loading, 'source' => 'MANUAL', 'created_at' => now()]);
        DB::table('customer_connections')->insert(array_map(fn ($i) => ['id' => (string) Str::uuid(), 'idpel' => sprintf('%012d', ++$this->seq), 'organizational_unit_id' => $ulp->getKey(), 'substation_id' => $sub, 'status' => 'AKTIF', 'source' => 'TEST', 'created_at' => now(), 'updated_at' => now()], range(1, $n)));

        return $sub;
    }

    private function event(string $feeder, ?OrganizationalUnit $unit, string $when, string $type, ?float $minutes, ?float $ens = null, string $category = 'ROW'): void
    {
        DB::table('outage_events')->insert(['id' => (string) Str::uuid(), 'source_key' => Str::random(30), 'row_hash' => Str::random(20), 'occurred_at' => $when.' 08:00:00+07', 'duration_minutes' => $minutes, 'organizational_unit_id' => $unit?->getKey(),
            'gi_name' => 'GI X', 'feeder_name' => 'F', 'feeder_id' => $feeder, 'device_group' => 'RECLOSER', 'outage_type' => $type, 'ens_kwh' => $ens, 'category' => $category, 'weather' => 'CERAH', 'created_at' => now(), 'updated_at' => now()]);
    }

    private function analysis(User $u, string $q = ''): array
    {
        return $this->as($u)->getJson('/api/outages/analysis'.($q === '' ? '' : '?'.$q))->assertOk()->json('data');
    }

    #[Test]
    public function counts_ens_saifi_and_saidi_follow_the_definition_with_the_minute_threshold(): void
    {
        $this->event($this->f1, $this->ulpA, '2025-01-10', 'PERMANEN', 60, 500);
        $this->event($this->f1, $this->ulpA, '2025-01-11', 'TEMPORER', 2, 40);              // shorter than 5 minutes: counted as an event and in ENS, not in SAIFI/SAIDI
        $this->event($this->f2, $this->ulpA, '2025-01-12', 'PERMANEN', 30, 200, 'PETIR');
        $this->event($this->f1, $this->ulpB, '2025-02-03', 'TEMPORER', 20, 90);             // recorded by ULP B but on a feeder that also serves ULP A

        $d = $this->analysis($this->admin, 'unit_id='.$this->ulpA->getKey());
        $this->assertSame(150, $d['base_customers']);
        $jan = collect($d['monthly'])->firstWhere('month', '2025-01');
        $this->assertSame([3, 2, 1], [$jan['events'], $jan['permanent'], $jan['temporary']]);
        $this->assertEquals([92.0, 740.0], [$jan['minutes'], $jan['ens_kwh']]);
        $this->assertEqualsWithDelta(1.0, $jan['saifi'], 0.0001);                            // (100 + 50) / 150
        $this->assertEqualsWithDelta(50.0, $jan['saidi'], 0.001);                            // (100*60 + 50*30) / 150
        $feb = collect($d['monthly'])->firstWhere('month', '2025-02');
        $this->assertSame(0, $feb['events']);                                               // the event is ULP B's by RAYON ...
        $this->assertEqualsWithDelta(100 * 20 / 150, $feb['saidi'], 0.001);                  // ... yet it darkens ULP A's customers on the shared feeder
        $this->assertEquals(['PETIR' => 1, 'ROW' => 2], collect($d['by_cause'])->pluck('events', 'label')->all());
        $this->assertSame([1, 1], [$d['yearly'][0]['months'] === 2 ? 1 : 0, count($d['yearly'])]);
    }

    #[Test]
    public function the_settings_can_limit_saidi_to_permanent_outages_and_move_the_threshold(): void
    {
        $this->event($this->f1, $this->ulpA, '2025-03-10', 'TEMPORER', 10, 10);
        $this->event($this->f1, $this->ulpA, '2025-03-11', 'PERMANEN', 60, 10);
        $q = 'unit_id='.$this->ulpA->getKey();
        $this->assertEqualsWithDelta(2 * 100 / 150, collect($this->analysis($this->admin, $q)['monthly'])->firstWhere('month', '2025-03')['saifi'], 0.0001);
        DB::table('outage_sync_settings')->where('id', 1)->update(['saidi_only_permanent' => true]);
        $this->assertEqualsWithDelta(100 / 150, collect($this->analysis($this->admin, $q)['monthly'])->firstWhere('month', '2025-03')['saifi'], 0.0001);
        DB::table('outage_sync_settings')->where('id', 1)->update(['saidi_only_permanent' => false, 'saidi_min_minutes' => 15]);
        $this->assertEqualsWithDelta(100 / 150, collect($this->analysis($this->admin, $q)['monthly'])->firstWhere('month', '2025-03')['saifi'], 0.0001);
    }

    #[Test]
    public function a_ulp_role_sees_only_its_own_events_and_unassigned_events_are_for_unrestricted_accounts(): void
    {
        $this->event($this->f1, $this->ulpA, '2025-04-01', 'PERMANEN', 30, 100);
        $this->event($this->f2, $this->ulpB, '2025-04-02', 'PERMANEN', 30, 100);
        $this->event($this->f2, null, '2025-04-03', 'TEMPORER', 30, 100);

        $this->assertSame(1, $this->analysis($this->teknikA)['coverage']['events']);
        $this->assertSame(3, $this->analysis($this->admin)['coverage']['events']);                         // everything, also the unassigned
        $this->assertSame(2, $this->analysis($this->admin, 'up3_id='.$this->up3->getKey())['coverage']['events']);   // a filter drops the unassigned ones
        $this->as($this->teknikA)->getJson('/api/outages/analysis?unit_id='.$this->ulpB->getKey())->assertNotFound();
        $this->as($this->niaga)->getJson('/api/outages/analysis')->assertForbidden();
        $this->as($this->niaga)->getJson('/api/outages/forecast')->assertForbidden();
    }

    #[Test]
    public function the_feeder_detail_links_the_outages_to_the_gardu_below_it(): void
    {
        $this->customers($this->f1, $this->ulpA, 3, loading: 105, capacity: 200);
        $this->customers($this->f1, $this->ulpA, 3, loading: 85, capacity: 100);
        $this->event($this->f1, $this->ulpA, '2025-05-05', 'PERMANEN', 45, 300, 'PERALATAN');

        $d = $this->as($this->admin)->getJson("/api/outages/analysis/feeders/{$this->f1}?unit_id=".$this->ulpA->getKey())->assertOk()->json('data');
        $this->assertSame(['FEEDER SATU', 106], [$d['feeder']['name'], $d['feeder']['customers']]);
        $this->assertSame([3, 3, 2, 1], [$d['gardu']['count'], $d['gardu']['measured'], $d['gardu']['at_80'], $d['gardu']['at_100']]);   // loading 105, 85, 60
        $this->assertEquals([105.0, 85.0, 60.0], array_column($d['gardu']['items'], 'loading_pct'));                                      // the most loaded first
        $this->assertSame('PERALATAN', $d['recent'][0]['category']);
        $this->as($this->admin)->getJson('/api/outages/analysis/feeders/'.Str::uuid())->assertNotFound();
        $scoped = $this->as($this->teknikA)->getJson("/api/outages/analysis/feeders/{$this->f1}")->assertOk()->json('data');
        $this->assertSame(3, $scoped['gardu']['count']);                                              // only the gardu of its own ULP
    }

    #[Test]
    public function the_forecast_needs_two_years_then_gives_ranges_quality_and_a_feeder_ranking(): void
    {
        $this->event($this->f1, $this->ulpA, '2026-01-10', 'PERMANEN', 30, 10);
        $short = $this->as($this->admin)->getJson('/api/outages/forecast')->assertOk()->json('data');
        $this->assertSame('INSUFFICIENT', $short['status']);

        for ($i = 0; $i < 34; $i++) {                                                                      // 2023-12 .. 2026-09: a seasonal pattern with a mild rise
            $m = CarbonImmutable::parse('2023-12-01')->addMonths($i);
            $n = 3 + ($m->month === 12 ? 4 : 0) + intdiv($i, 12);
            for ($k = 0; $k < $n; $k++) {
                $this->event($k % 2 === 0 ? $this->f1 : $this->f2, $this->ulpA, $m->format('Y-m').'-'.sprintf('%02d', 5 + $k), $k % 3 === 0 ? 'PERMANEN' : 'TEMPORER', 30 + $k, 100 + $k);
            }
        }
        $d = $this->as($this->admin)->getJson('/api/outages/forecast')->assertOk()->json('data');
        $this->assertSame('OK', $d['status']);
        $this->assertGreaterThanOrEqual(24, $d['history_months']);
        $this->assertSame(['permanent', 'temporary', 'ens_kwh', 'saifi', 'saidi'], array_column($d['metrics'], 'key'));
        foreach ($d['metrics'] as $m) {
            $this->assertCount(12, $m['forecast']);
            foreach ($m['forecast'] as $f) {
                $this->assertTrue($f['p10'] <= $f['p50'] && $f['p50'] <= $f['p90'], $m['key'].' '.$f['month']);
            }
            $this->assertTrue($m['next12m']['p10'] <= $m['next12m']['p50'] && $m['next12m']['p50'] <= $m['next12m']['p90']);
            $this->assertNotNull($m['quality']['backtest_points']);
        }
        $ens = collect($d['metrics'])->firstWhere('key', 'ens_kwh');
        $dec = collect($ens['forecast'])->firstWhere('month', '2026-12');
        $oct = collect($ens['forecast'])->firstWhere('month', '2026-10');
        $this->assertGreaterThan($oct['p50'], $dec['p50']);                                                // December is the seasonal peak in the history
        $this->assertNotEmpty($d['feeders']);
        $this->assertGreaterThanOrEqual($d['feeders'][count($d['feeders']) - 1]['expected_12m'], $d['feeders'][0]['expected_12m']);
    }

    #[Test]
    public function the_analysis_can_be_exported(): void
    {
        $this->event($this->f1, $this->ulpA, '2025-06-01', 'PERMANEN', 30, 100);
        $this->as($this->admin)->get('/api/outages/analysis?format=xlsx', ['Accept' => 'application/json'])->assertOk()->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
}
