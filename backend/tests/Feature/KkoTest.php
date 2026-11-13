<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Kko\KkoService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\KkoPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** KKO (docs/62 §51, owner 2026-11-09): transformer loading before/after, voltage at the location, TEKNIK's decision; never blocks the flow. */
class KkoTest extends PostgresTestCase
{
    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $retail;

    private User $teknik;

    private User $teknikB;

    private User $perencanaan;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(KkoPermissionSeeder::class);
        $upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $upA);
        $this->ulpB = $this->makeUnit('ULP', $this->makeUnit('UP3'));
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retail = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->perencanaan = $mk('PERENCANAAN', $upA);
        $this->vendor = $mk('VENDOR', $this->ulpA);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** A new connection of ULP A with the given power delta (kVA) and new power. */
    private function application(float $delta = 16.5, float $newKva = 16.5, string $type = 'PB'): string
    {
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Budi '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        DB::table('applications')->where('id', $id)->update(['delta_power_kva' => $delta, 'new_power_value' => $newKva, 'new_power_unit' => 'kVA']);

        return $id;
    }

    #[Test]
    public function loading_classes_follow_the_owner_thresholds_at_every_boundary(): void
    {
        foreach ([[0, 'UNDERLOAD'], [40, 'UNDERLOAD'], [40.01, 'NORMAL'], [80, 'NORMAL'], [80.01, 'OVERLOAD'], [100, 'OVERLOAD'], [100.01, 'OVERBLAST'], [234, 'OVERBLAST']] as [$pct, $class]) {
            $this->assertSame($class, KkoService::classify($pct), "{$pct} %");
        }
    }

    #[Test]
    public function grants_scope_and_the_empty_state(): void
    {
        $app = $this->application(delta: 16.5, newKva: 16.5);
        $this->as($this->vendor)->getJson("/api/applications/{$app}/kko")->assertForbidden();
        $this->as($this->teknikB)->getJson("/api/applications/{$app}/kko")->assertNotFound();           // another ULP
        $this->as($this->teknikB)->putJson("/api/applications/{$app}/kko", [])->assertStatus(404);
        $this->as($this->vendor)->putJson("/api/applications/{$app}/kko", [])->assertForbidden();
        $r = $this->as($this->teknik)->getJson("/api/applications/{$app}/kko")->assertOk()->assertJsonPath('data.status', 'NOT_RECORDED')->assertJsonPath('data.record', null);
        $this->assertEquals(0.8, $r->json('data.context.load_factor_default'));     // no parameter set: the owner's usual 0.8
        $this->assertFalse($r->json('data.context.dedicated_expected'));
        $this->assertEquals(100, $r->json('data.context.thresholds.overload_max'));
        $this->as($this->teknik)->getJson('/api/applications/'.Str::uuid().'/kko')->assertNotFound();
    }

    #[Test]
    public function the_loading_after_the_new_load_uses_the_load_factor_and_is_classified(): void
    {
        $app = $this->application(delta: 20, newKva: 20);
        $url = "/api/applications/{$app}/kko";
        $base = ['substation_code' => 'HD0004', 'substation_name' => 'Taman Merdeka', 'transformer_capacity_kva' => 200, 'measured_at' => now()->toDateString()];

        // 120 kVA of 200 = 60 %; + 20 x 0.8 = 136 -> 68 %: both NORMAL
        $r = $this->as($this->teknik)->putJson($url, $base + ['measured_load_kva' => 120])->assertOk()->assertJsonPath('data.status', 'RECORDED');
        $this->assertEquals(60, $r->json('data.record.loading_before_pct'));
        $this->assertEquals(68, $r->json('data.record.loading_after_pct'));
        $this->assertSame('NORMAL', $r->json('data.record.class_before'));
        $this->assertSame('NORMAL', $r->json('data.record.class_after'));
        $this->assertEquals(0.8, $r->json('data.record.load_factor'));
        $this->assertEquals(20, $r->json('data.record.added_power_kva'));

        // the load factor can be set for this record: 150 of 200 = 75 % NORMAL; + 20 x 1 = 170 -> 85 % OVERLOAD
        $r = $this->as($this->teknik)->putJson($url, $base + ['measured_load_kva' => 150, 'load_factor' => 1])->assertOk();
        $this->assertSame('NORMAL', $r->json('data.record.class_before'));
        $this->assertEquals(85, $r->json('data.record.loading_after_pct'));
        $this->assertSame('OVERLOAD', $r->json('data.record.class_after'));

        // 190 of 200 = 95 %; + 16 = 206 -> 103 % OVERBLAST
        $r = $this->as($this->teknik)->putJson($url, $base + ['measured_load_kva' => 190])->assertOk();
        $this->assertSame('OVERLOAD', $r->json('data.record.class_before'));
        $this->assertSame('OVERBLAST', $r->json('data.record.class_after'));

        // 60 of 200 = 30 % UNDERLOAD
        $r = $this->as($this->perencanaan)->putJson($url, $base + ['measured_load_kva' => 60])->assertOk();   // PERENCANAAN (UP3) may record too
        $this->assertSame('UNDERLOAD', $r->json('data.record.class_before'));
        $this->assertSame(1, DB::table('application_kko')->where('application_id', $app)->count());          // one row per application
    }

    #[Test]
    public function the_per_phase_form_reproduces_the_paper_kko_and_decides_the_loading_and_the_voltage(): void
    {
        $app = $this->application(delta: 11.0, newKva: 11.0);
        $pd = ['gtt' => ['jurusan_count' => 2, 'jurusan_length_km' => 2, 'conductor' => 'BDC 4x70', 'loading_pattern' => 'Merata dan seimbang', 'distance_gtt_km' => 0.36],
            'load' => ['r' => 199, 's' => 200, 't' => 235], 'jurusan' => [['name' => 'A', 'r' => 125, 's' => 85, 't' => 112]],
            'base_voltage' => ['r' => 235, 's' => 236, 't' => 236], 'existing_voltage' => ['r' => 209, 's' => 209, 't' => 208], 'added' => ['r' => 0, 's' => 50, 't' => 0],
            'plan' => ['sutr_km' => 0.32]];
        $r = $this->as($this->teknik)->putJson("/api/applications/{$app}/kko", ['transformer_capacity_kva' => 250, 'substation_code' => 'HD200', 'phase_detail' => $pd])->assertOk();
        $rec = $r->json('data.record');
        $this->assertEquals([66.55, 70.8], [$rec['loading_before_pct'], $rec['loading_after_pct']]);                      // the figures on the paper form
        $this->assertEquals([7.47, 8.48], [$rec['phase_result']['before']['imbalance_pct'], $rec['phase_result']['after']['imbalance_pct']]);
        $this->assertEquals(208, $rec['voltage_location_v']);                                                             // the lowest existing voltage of the customer, measured by hand
        $this->assertTrue($rec['voltage_low'] === false);
        $this->assertSame('NORMAL', $rec['class_after']);
        $this->assertSame(0.32, (float) $rec['phase_detail']['plan']['sutr_km']);
        $this->assertSame(66.55, KkoService::phaseResult($pd, 250.0)['before']['loading_pct']);
        $this->assertNull(KkoService::imbalance(['r' => 1.0, 's' => null, 't' => 2.0]));

        $this->as($this->teknik)->putJson("/api/applications/{$app}/kko", ['transformer_capacity_kva' => 250, 'phase_detail' => ['load' => ['r' => 'x']]])->assertUnprocessable();
        $this->as($this->teknik)->putJson("/api/applications/{$app}/kko", ['phase_detail' => ['existing_voltage' => ['r' => 2000]]])->assertUnprocessable();
    }

    #[Test]
    public function a_suggested_added_load_goes_on_the_lightest_phase_for_one_phase_and_is_shared_for_three_phase(): void
    {
        $this->assertSame(['r' => 47.8, 's' => 0.0, 't' => 0.0], KkoService::suggestAdded(11.0, false, ['r' => 199.0, 's' => 200.0, 't' => 235.0]));
        $this->assertSame(['r' => 31.9, 's' => 31.9, 't' => 31.9], KkoService::suggestAdded(22.0, true, ['r' => 1.0, 's' => 2.0, 't' => 3.0]));
        $this->assertSame(['r' => 0.0, 's' => 0.0, 't' => 0.0], KkoService::suggestAdded(null, false, []));
    }

    #[Test]
    public function the_voltage_is_shown_and_flagged_when_it_is_below_198_volts_220_minus_10_percent(): void
    {
        $app = $this->application();
        $url = "/api/applications/{$app}/kko";
        $this->assertFalse($this->as($this->teknik)->putJson($url, ['voltage_location_v' => 198])->assertOk()->json('data.record.voltage_low'));       // the limit itself is allowed
        $this->assertFalse($this->as($this->teknik)->putJson($url, ['voltage_location_v' => 199])->assertOk()->json('data.record.voltage_low'));       // the paper KKO's 199 V is LAYAK
        $this->assertTrue($this->as($this->teknik)->putJson($url, ['voltage_location_v' => 197.9])->assertOk()->json('data.record.voltage_low'));
        $this->assertTrue($this->as($this->teknik)->putJson($url, ['voltage_location_v' => 187.5])->assertOk()->json('data.record.voltage_low'));
        $r = $this->as($this->teknik)->putJson($url, ['voltage_location_v' => 207])->assertOk();
        $this->assertFalse($r->json('data.record.voltage_low'));
        $this->assertEquals(207, $r->json('data.record.voltage_location_v'));
        $this->assertNull($r->json('data.record.loading_before_pct'));                // no transformer data given: nothing to compute, nothing guessed
        $this->assertNull($this->as($this->teknik)->putJson($url, [])->assertOk()->json('data.record.voltage_low'));
    }

    #[Test]
    public function validation_and_a_dedicated_transformer_for_a_new_connection_of_53_kva_or_more(): void
    {
        $app = $this->application(delta: 66, newKva: 66);
        $url = "/api/applications/{$app}/kko";
        $this->assertTrue($this->as($this->teknik)->getJson($url)->json('data.context.dedicated_expected'));   // PB of 66 kVA: a dedicated transformer is expected
        $this->as($this->teknik)->putJson($url, ['transformer_capacity_kva' => 200])->assertUnprocessable();    // capacity without the measured load
        $this->as($this->teknik)->putJson($url, ['transformer_capacity_kva' => 0, 'measured_load_kva' => 10])->assertUnprocessable();
        $this->as($this->teknik)->putJson($url, ['measured_at' => now()->addDay()->toDateString()])->assertUnprocessable();
        $this->as($this->teknik)->putJson($url, ['load_factor' => 1.5])->assertUnprocessable();
        $this->as($this->teknik)->putJson($url, ['voltage_location_v' => 0])->assertUnprocessable();
        $this->as($this->teknik)->putJson($url, ['dedicated_transformer' => true])->assertStatus(409);        // the proposed capacity is required

        $r = $this->as($this->teknik)->putJson($url, ['dedicated_transformer' => true, 'dedicated_transformer_kva' => 100, 'transformer_capacity_kva' => 200, 'measured_load_kva' => 150])->assertOk();
        $this->assertTrue($r->json('data.record.dedicated_transformer'));
        $this->assertEquals(100, $r->json('data.record.dedicated_transformer_kva'));
        $this->assertNull($r->json('data.record.loading_after_pct'));                 // the PLN transformer is not loaded by a dedicated one
        $this->assertNull($r->json('data.record.class_after'));

        $small = $this->application(delta: 16.5, newKva: 16.5);
        $this->assertFalse($this->as($this->teknik)->getJson("/api/applications/{$small}/kko")->json('data.context.dedicated_expected'));
    }

    #[Test]
    public function teknik_decides_with_a_reason_and_an_improvement_proposal_and_a_new_record_resets_the_decision(): void
    {
        $app = $this->application();
        $url = "/api/applications/{$app}/kko";
        $before = DB::table('applications')->where('id', $app)->value('current_status');
        $this->as($this->teknik)->postJson("{$url}/decision", ['decision' => 'LAYAK'])->assertStatus(409);       // nothing recorded yet
        $this->as($this->teknik)->putJson($url, ['transformer_capacity_kva' => 160, 'measured_load_kva' => 170, 'voltage_location_v' => 195])->assertOk();

        $this->as($this->vendor)->postJson("{$url}/decision", ['decision' => 'LAYAK'])->assertForbidden();
        $this->as($this->perencanaan)->postJson("{$url}/decision", ['decision' => 'LAYAK'])->assertForbidden();   // may record, may not decide
        $this->as($this->teknikB)->postJson("{$url}/decision", ['decision' => 'LAYAK'])->assertStatus(404);
        $this->as($this->teknik)->postJson("{$url}/decision", ['decision' => 'BOLEH'])->assertUnprocessable();
        $this->as($this->teknik)->postJson("{$url}/decision", ['decision' => 'TIDAK_LAYAK'])->assertStatus(409);  // the reason is required

        $r = $this->as($this->teknik)->postJson("{$url}/decision", ['decision' => 'TIDAK_LAYAK', 'notes' => 'Trafo overbeban dan tegangan ujung rendah.', 'improvement_proposal' => 'Uprating trafo 160 ke 250 kVA dan pecah beban.'])
            ->assertOk()->assertJsonPath('data.status', 'TIDAK_LAYAK');
        $this->assertSame('Uprating trafo 160 ke 250 kVA dan pecah beban.', $r->json('data.record.improvement_proposal'));
        $this->assertSame('TIDAK_LAYAK', DB::table('application_kko')->where('application_id', $app)->value('decision'));
        $this->assertSame($before, DB::table('applications')->where('id', $app)->value('current_status'));          // the flow is untouched

        // the data the decision judged changed: the decision is reset, the history keeps it
        $r = $this->as($this->teknik)->putJson($url, ['transformer_capacity_kva' => 250, 'measured_load_kva' => 170, 'voltage_location_v' => 210])->assertOk()->assertJsonPath('data.status', 'RECORDED');
        $this->assertNull($r->json('data.record.decision'));
        $this->assertNull($r->json('data.record.improvement_proposal'));
        $reset = DB::table('application_kko_events')->where('action', 'DECISION_RESET')->first();
        $this->assertNotNull($reset);
        $this->assertSame('TIDAK_LAYAK', json_decode($reset->snapshot, true)['previous_decision']);
        $this->as($this->teknik)->postJson("{$url}/decision", ['decision' => 'LAYAK', 'notes' => 'Setelah uprating.'])->assertOk()->assertJsonPath('data.status', 'LAYAK');
        $actions = collect($r->json('data.events'))->pluck('action');
        $this->assertTrue($actions->contains('RECORDED'));
    }
}
