<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Substations\SubstationAnalysisService;
use App\Services\Substations\SubstationService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\KkoPermissionSeeder;
use Database\Seeders\SubstationPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Master gardu for KKO (docs/80, owner 2026-11-10): staged import, readings (0 = not measured, append-only, 12-month freshness), the daily bot, and the KKO that picks a gardu. */
class SubstationTest extends PostgresTestCase
{
    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $planning;

    private User $teknik;

    private User $teknikB;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(KkoPermissionSeeder::class);
        $this->seed(SubstationPermissionSeeder::class);
        $upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $upA);
        $this->ulpB = $this->makeUnit('ULP', $this->makeUnit('UP3'));
        $mk = function (string $role, OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->planning = $mk('PERENCANAAN', $upA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->vendor = $mk('VENDOR', $this->ulpA);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** @param list<array<string,string>> $rows */
    private function csv(array $rows): UploadedFile
    {
        $cols = array_keys(array_merge(...$rows));
        $out = fopen('php://temp', 'w+');
        fputcsv($out, $cols);
        foreach ($rows as $r) {
            fputcsv($out, array_map(fn ($c) => $r[$c] ?? '', $cols));
        }
        rewind($out);

        return UploadedFile::fake()->createWithContent('gardu.csv', stream_get_contents($out));
    }

    /** @return array<string,string> */
    private function row(string $code, array $over = []): array
    {
        return $over + ['KD_GARDU' => $code, 'ULP_CODE' => $this->ulpA->code, 'ASSETNUM' => '1'.$code, 'LOCATION' => 'GD01.'.$code, 'KD_PYLG' => 'KLWNG', 'JNS_GRD' => 'Gardu Distribusi 2 Tiang', 'TRFMILIK' => 'PLN', 'STATUS' => 'UMUM',
            'LOKASI' => 'JL TEST '.$code, 'KAP_TOTAL' => '200', 'LATITUDEY' => '-7,5394573', 'LONGITUDEX' => '112,2378485'];
    }

    private function load(array $rows, bool $full = false): array
    {
        $b = $this->as($this->planning)->postJson('/api/master-data/substations/imports', ['file' => $this->csv($rows), 'full_snapshot' => $full])->assertCreated()->json('data');
        $this->as($this->planning)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertOk();

        return $b;
    }

    private function sid(string $code): string
    {
        return (string) DB::table('substations')->where('code', $code)->value('id');
    }

    #[Test]
    public function a_reading_keeps_its_time_and_the_capacity_at_that_time_and_several_readings_a_day_are_possible(): void
    {
        $this->load([$this->row('HD0001')]);                                                             // master capacity 200 kVA
        $id = $this->sid('HD0001');
        $url = "/api/master-data/substations/{$id}/readings";
        $day = now()->subDays(10)->toDateString();
        // an old reading taken when the transformer was still 100 kVA (transformer management happened since)
        $r1 = $this->as($this->teknik)->postJson($url, ['measured_at' => "{$day} 08:15:30", 'capacity_kva' => 100, 'load_kva' => 60, 'current_r_a' => 90, 'current_s_a' => 80, 'current_t_a' => 70])->assertCreated();
        $this->assertSame(100.0, (float) DB::table('substation_readings')->where('id', $r1->json('data.id'))->value('capacity_kva'));
        $this->assertEquals(60, DB::table('substation_readings')->where('id', $r1->json('data.id'))->value('loading_pct'));        // 60 kVA of the 100 kVA of that time, not of today's 200
        $this->as($this->teknik)->postJson($url, ['measured_at' => "{$day} 08:15:30", 'capacity_kva' => 100, 'load_kva' => 61, 'current_r_a' => 90])->assertCreated()->assertJsonPath('data.result', 'unchanged');   // same time: idempotent
        $this->as($this->teknik)->postJson($url, ['measured_at' => "{$day} 17:40:00", 'load_kva' => 70, 'current_r_a' => 100, 'current_s_a' => 90, 'current_t_a' => 80])->assertCreated()->assertJsonPath('data.result', 'stored');   // the same day, another time
        $this->assertSame(2, DB::table('substation_readings')->where('substation_id', $id)->count());
        $this->as($this->teknik)->postJson($url, ['measured_at' => now()->addDays(2)->toDateTimeString(), 'load_kva' => 5])->assertStatus(409);
        $this->as($this->teknik)->postJson($url, ['measured_at' => 'bukan waktu', 'load_kva' => 5])->assertUnprocessable();

        $latest = $this->as($this->teknik)->getJson('/api/master-data/substations?q=HD0001')->json('data.0.reading');
        $this->assertSame("{$day}T17:40:00+07:00", $latest['measured_at']);                                // the later time of the day is the latest reading, shown with its time (WIB)
        $this->assertEquals(200, $latest['capacity_kva']);                                                // no capacity given: the master's at that time is kept with the reading
        $h = $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis")->json('data.history');
        $this->assertSame([100, 200], array_map(fn ($x) => (int) $x['capacity_kva'], $h));
        $this->assertNull($h[0]['capacity_change']);
        $this->assertEquals(['from' => 100, 'to' => 200], $h[1]['capacity_change']);                       // transformer management is visible in the history
        $this->assertSame("{$day}T08:15:30+07:00", $h[0]['measured_at']);

        // a date-only reading (the old way) still works and is idempotent per day
        $d2 = now()->subDays(20)->toDateString();
        $this->as($this->teknik)->postJson($url, ['measured_on' => $d2, 'load_kva' => 50])->assertCreated()->assertJsonPath('data.result', 'stored');
        $this->as($this->teknik)->postJson($url, ['measured_on' => $d2, 'load_kva' => 51])->assertCreated()->assertJsonPath('data.result', 'unchanged');
    }

    #[Test]
    public function the_gardu_code_people_use_is_the_gadis_number_when_there_is_one_and_the_feeder_list_names_the_units_it_serves(): void
    {
        $this->load([$this->row('HD0001', ['NO_GADIS' => 'GD514530003', 'KD_PYLG' => 'KLWNG']), $this->row('HD0002', ['KD_PYLG' => 'KLWNG'])]);
        $list = $this->as($this->teknik)->getJson('/api/master-data/substations?per_page=10')->assertOk()->json('data');
        $by = collect($list)->keyBy('code');
        $this->assertSame(['GD514530003', 'HD0002'], [$by['HD0001']['display_code'], $by['HD0002']['display_code']]);        // the Maximo code stays the fallback until the GADIS number is known
        $this->assertSame('HD0001', $by['HD0001']['code']);                                                                  // ...and the technical key
        $this->assertSame(['HD0001'], array_column($this->as($this->teknik)->getJson('/api/master-data/substations?q=GD514530003')->json('data'), 'code'));   // searchable by the GADIS number
        $this->assertSame(['HD0001'], array_column($this->as($this->teknik)->getJson('/api/master-data/substations?q=HD0001')->json('data'), 'code'));
        $f = $this->as($this->teknik)->getJson('/api/master-data/feeders?q=KLWNG')->assertOk()->json('data.0');
        $this->assertSame([[$this->ulpA->name, 2]], array_map(fn ($u) => [$u['name'], $u['substation_count']], $f['served_units']));   // the units served by the feeder, derived from its gardu
    }

    #[Test]
    public function load_kva_comes_from_the_source_then_percent_then_phase_currents_never_from_a_single_unnamed_current(): void
    {
        $this->assertSame([150.0, 75.0, 'GIVEN'], SubstationService::deriveLoad(150, null, 200));
        $this->assertSame([148.0, 74.0, 'PERCENT'], SubstationService::deriveLoad(null, 74, 200));
        $this->assertSame([null, null, null], SubstationService::deriveLoad(null, null, 200, []));                       // a single BEBAN current alone gives no kVA
        [$kva, $pct, $basis] = SubstationService::deriveLoad(null, null, 200, ['r' => 100.0, 's' => 90.0, 't' => 110.0]);   // (100+90+110) A x 220 V = 66 kVA
        $this->assertSame([66.0, 33.0, 'CURRENT'], [$kva, $pct, $basis]);
        $this->assertSame([null, null, null], SubstationService::deriveLoad(0, 0, 200, ['r' => 0.0]));                   // 0 = not measured
    }

    #[Test]
    public function grants_and_scope(): void
    {
        $this->as($this->vendor)->getJson('/api/master-data/substations')->assertForbidden();
        $this->as($this->teknik)->postJson('/api/master-data/substations/imports', [])->assertForbidden();                // TEKNIK reads and adds readings, but does not import
        $this->load([$this->row('HD0001')]);
        $id = $this->sid('HD0001');
        $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}")->assertOk()->assertJsonPath('data.substation.code', 'HD0001');
        $this->as($this->teknikB)->getJson("/api/master-data/substations/{$id}")->assertNotFound();                      // another ULP
        $this->assertSame(0, $this->as($this->teknikB)->getJson('/api/master-data/substations')->json('meta.total'));
        $this->assertSame(1, $this->as($this->planning)->getJson('/api/master-data/substations')->json('meta.total'));      // the UP3 sees its ULPs
    }

    #[Test]
    public function the_import_is_staged_classified_and_nothing_is_written_before_the_confirmation(): void
    {
        $rows = [$this->row('HD0001'), $this->row('HD0002', ['KAP_TOTAL' => '0']), $this->row('HD0003', ['ULP_CODE' => 'XXXXX']), ['KD_GARDU' => '', 'KAP_TOTAL' => ''] + $this->row('HD0004'), $this->row('HD0001')];
        $rows[3]['KD_GARDU'] = '';
        $b = $this->as($this->planning)->postJson('/api/master-data/substations/imports', ['file' => $this->csv($rows)])->assertCreated()->json('data');
        $this->assertEquals(['NEW' => 1, 'CHANGED' => 0, 'UNCHANGED' => 0, 'REJECT' => 4], $b['counts']);
        $this->assertSame(0, DB::table('substations')->count());
        $rej = $this->as($this->planning)->getJson("/api/master-data/substations/imports/{$b['id']}?action=REJECT")->json('rows');
        $this->assertStringContainsString('Kapasitas', $rej[0]['errors'][0]);
        $this->as($this->planning)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'CONFIRMED');
        $this->assertSame(1, DB::table('substations')->count());
        $this->as($this->planning)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertStatus(409);     // not twice
        $this->assertEquals(-7.5394573, DB::table('substations')->value('latitude'));                                          // the decimal comma is read
    }

    #[Test]
    public function a_second_file_updates_changes_and_a_full_file_only_marks_the_missing_gardu(): void
    {
        $this->load([$this->row('HD0001'), $this->row('HD0002')]);
        $b = $this->as($this->planning)->postJson('/api/master-data/substations/imports', ['file' => $this->csv([$this->row('HD0001', ['KAP_TOTAL' => '250'])]), 'full_snapshot' => true])->assertCreated()->json('data');
        $this->assertSame(1, $b['counts']['CHANGED']);
        $this->as($this->planning)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertOk();
        $this->assertEquals(250, DB::table('substations')->where('code', 'HD0001')->value('capacity_kva'));
        $gone = DB::table('substations')->where('code', 'HD0002')->first();
        $this->assertTrue((bool) $gone->needs_review);
        $this->assertSame('AKTIF', $gone->status);                                                                           // marked only, never switched off by itself
    }

    #[Test]
    public function zero_is_not_a_measurement_a_reading_is_idempotent_append_only_and_goes_stale_after_twelve_months(): void
    {
        $this->load([$this->row('HD0001')]);
        $id = $this->sid('HD0001');
        $url = "/api/master-data/substations/{$id}/readings";
        $this->as($this->teknik)->postJson($url, ['measured_on' => now()->toDateString(), 'loading_pct' => 0, 'end_voltage_v' => 0])->assertStatus(409);      // nothing measured
        $this->as($this->teknik)->postJson($url, ['measured_on' => now()->addDay()->toDateString(), 'loading_pct' => 50])->assertStatus(422);
        $r = $this->as($this->teknik)->postJson($url, ['measured_on' => now()->toDateString(), 'loading_pct' => 74, 'end_voltage_v' => 198])->assertCreated()->json('data');
        $this->assertEquals(148, $r['load_kva']);
        $this->as($this->teknik)->postJson($url, ['measured_on' => now()->toDateString(), 'loading_pct' => 10])->assertCreated()->assertJsonPath('data.result', 'unchanged');
        $this->assertSame(1, DB::table('substation_readings')->count());
        $this->assertSame('FRESH', $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}")->json('data.substation.reading_status'));
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('substation_readings')->update(['loading_pct' => 1]);                                                       // append-only
    }

    #[Test]
    public function an_impossible_end_voltage_in_the_file_is_dropped_and_does_not_block_the_import(): void
    {
        // TEG_UJUNG 2200 (a slip for 220,0) found in the real SEP2026 file: the gardu and its percent are kept, only the voltage is treated as not measured.
        $this->load([$this->row('HD0001', ['BLTHUKUR' => '122016', 'PERSEN' => '66', 'TEG_UJUNG' => '2200']), $this->row('HD0002', ['BLTHUKUR' => '102026', 'PERSEN' => '50', 'TEG_UJUNG' => '215'])]);
        $a = DB::table('substation_readings')->where('substation_id', $this->sid('HD0001'))->first();
        $this->assertEquals(66, $a->loading_pct);
        $this->assertNull($a->end_voltage_v);
        $this->assertEquals(215, DB::table('substation_readings')->where('substation_id', $this->sid('HD0002'))->value('end_voltage_v'));
    }

    #[Test]
    public function the_access_endpoint_reports_the_substation_keys_so_the_menu_can_appear(): void
    {
        $can = $this->as($this->planning)->getJson('/api/applications/access')->assertOk()->json('can');
        $this->assertTrue($can['substations.view']);
        $this->assertTrue($can['substations.import']);
        $this->assertTrue($can['substations.reading']);
    }

    #[Test]
    public function imbalance_is_the_mean_deviation_over_the_mean_and_needs_all_phases(): void
    {
        $this->assertEquals(0.0, SubstationAnalysisService::imbalance(['r' => 100.0, 's' => 100.0, 't' => 100.0], 3));
        $this->assertEquals(33.33, SubstationAnalysisService::imbalance(['r' => 150.0, 's' => 100.0, 't' => 50.0], 3));
        $this->assertNull(SubstationAnalysisService::imbalance(['r' => 150.0, 's' => 100.0, 't' => null], 3));      // a phase not measured: no figure, never a guess
        $this->assertEquals(20.0, SubstationAnalysisService::imbalance(['a' => 120.0, 'b' => 80.0], 2));
        $this->assertNull(SubstationAnalysisService::imbalance(['a' => 120.0], 2));
    }

    #[Test]
    public function jurusan_readings_give_phase_and_jurusan_balance_and_the_voltage_flags(): void
    {
        $this->load([$this->row('HD0001')]);
        $id = $this->sid('HD0001');
        $this->as($this->teknik)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->subDays(3)->toDateString(), 'base_voltage_r_v' => 228, 'base_voltage_s_v' => 232, 'base_voltage_t_v' => 230, 'end_voltage_v' => 190,
            'feeders' => [['label' => 'A', 'current_r_a' => 100, 'current_s_a' => 60, 'current_t_a' => 40], ['label' => 'B', 'current_r_a' => 20, 'current_s_a' => 20, 'current_t_a' => 20, 'end_voltage_v' => 0], ['label' => 'C']]])->assertCreated();
        $a = $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis")->assertOk()->json('data');
        $l = $a['latest'];
        $this->assertEquals([120, 80, 60], [$l['current_r_a'], $l['current_s_a'], $l['current_t_a']]);        // no gardu-level currents: the sum of the jurusan
        $this->assertEquals(28.6, $l['loading_pct']);                                                         // 260 A x 220 V = 57.2 kVA of 200
        $this->assertEqualsWithDelta(25.64, $l['phase_imbalance_pct'], 0.01);
        $this->assertCount(2, $l['feeders']);                                                                 // C had nothing measured; B's 0 V is not a voltage
        $this->assertEquals(76.9, $l['feeders'][0]['share_pct']);
        $this->assertEqualsWithDelta(53.85, $l['feeder_imbalance_pct'], 0.01);
        $this->assertEquals(228, $l['base_voltage_min_v']);
        $this->assertEquals(30, $l['drop_v']);                                       // against the 220 V nominal (owner 2026-11-16): 220 - 190
        $this->assertEqualsWithDelta(13.64, $l['drop_pct'], 0.01);
        $this->assertEqualsCanonicalizing(['BASE_LOW', 'FEEDER_UNBALANCED', 'END_LOW', 'END_DROP'], $l['flags']);      // 25.64 % between the phases is under the 30 % limit (owner 2026-11-16); the jurusan at 53.85 % are over it
        $this->as($this->teknik)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->subDays(2)->toDateString(), 'base_voltage_r_v' => 1500, 'loading_pct' => 10])->assertStatus(422);
        $ok = $this->as($this->teknik)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->subDays(1)->toDateString(), 'base_voltage_r_v' => 233, 'base_voltage_s_v' => 233, 'base_voltage_t_v' => 233,
            'current_r_a' => 90, 'current_s_a' => 90, 'current_t_a' => 90, 'end_voltage_v' => 225])->assertCreated();
        $this->assertSame([], $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis")->json('data.latest.flags'));
        $this->assertCount(2, $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis")->json('data.history'));
        $this->as($this->makeNiaga())->getJson("/api/master-data/substations/{$id}/analysis")->assertForbidden();
        $this->load([$this->row('HD0002')]);
        $this->as($this->teknik)->postJson('/api/master-data/substations/'.$this->sid('HD0002').'/readings', ['measured_on' => now()->toDateString(), 'base_voltage_r_v' => 226, 'end_voltage_v' => 195])->assertCreated();
        $list = fn (string $alert) => collect($this->as($this->teknik)->getJson("/api/master-data/substations?alert={$alert}")->json('data'))->pluck('code')->all();
        $this->assertSame(['HD0002'], $list('BASE_LOW'));                                                    // HD0001's latest reading is 233 V: the older low one no longer counts
        $this->assertSame(['HD0002'], $list('END_LOW'));
        $this->assertSame(['BASE_LOW', 'END_DROP', 'END_LOW'], collect($this->as($this->teknik)->getJson('/api/master-data/substations?q=HD0002')->json('data.0.reading.flags'))->sort()->values()->all());     // 226 V base, 195 V end = 13.7 % drop
    }

    #[Test]
    public function the_forecast_adds_customers_connected_since_the_measurement_the_pipeline_and_the_monthly_average(): void
    {
        $this->load([$this->row('HD0001')]);
        $id = $this->sid('HD0001');
        $this->as($this->teknik)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->subDays(40)->toDateString(), 'loading_pct' => 50])->assertCreated();      // 100 of 200 kVA
        $this->linked($id, 10, 'CONNECTION_DONE', now()->subDays(10)->toDateTimeString());     // 8 kVA, connected after the measurement
        $this->linked($id, 20, 'PAID', null);                                                      // 16 kVA in the pipeline
        $this->linked($id, 50, 'CANCELLED', null);                                                 // never counted
        $f = $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis?horizon=6")->assertOk()->json('data.forecast');
        $this->assertTrue($f['available']);
        $this->assertEquals(8, $f['base']['connected_since_kva']);
        $this->assertEquals(16, $f['additions']['pipeline_kva']);
        $this->assertEquals(0.667, $f['growth_kva_per_month']);                                  // 8 kVA over the last 12 months
        $this->assertEquals([108, 124, 124.67], [$f['months'][0]['load_kva'], $f['months'][1]['load_kva'], $f['months'][2]['load_kva']]);
        $this->assertEquals(54, $f['months'][0]['loading_pct']);
        $w = $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}/analysis?horizon=12&growth_kva=20")->json('data.forecast');          // what-if: 20 kVA a month
        $this->assertTrue($w['growth_overridden']);
        $this->assertNotNull($w['over_100_on']);
        $this->assertNull($f['over_100_on']);
        $this->load([$this->row('HD0009')]);
        $other = $this->sid('HD0009');
        $this->as($this->teknik)->postJson("/api/master-data/substations/{$other}/readings", ['measured_on' => now()->toDateString(), 'end_voltage_v' => 215])->assertCreated();     // no load measured
        $n = $this->as($this->teknik)->getJson("/api/master-data/substations/{$other}/analysis")->json('data.forecast');
        $this->assertFalse($n['available']);
        $this->assertContains('NO_LOAD_READING', $n['notes']);
    }

    private function linked(string $substationId, float $kva, string $status, ?string $completedAt): void
    {
        $app = $this->as($this->makeNiaga())->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Budi', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        DB::table('applications')->where('id', $app)->update(['delta_power_kva' => $kva, 'new_power_value' => $kva, 'new_power_unit' => 'kVA']);
        $this->as($this->teknik)->putJson("/api/applications/{$app}/kko", ['substation_id' => $substationId])->assertOk();
        DB::table('applications')->where('id', $app)->update(['current_status' => $status, 'completed_at' => $completedAt]);
    }

    #[Test]
    public function the_import_builds_the_feeder_master_owned_by_the_up3_and_served_by_every_ulp_with_a_gardu_on_it(): void
    {
        $up3A = $this->ulpA->parent_id;
        $planB = $this->makeUser();
        $this->assign($planB, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), OrganizationalUnit::query()->findOrFail($this->ulpB->parent_id));
        $loadB = function (array $rows) use ($planB): void {
            $b = $this->as($planB)->postJson('/api/master-data/substations/imports', ['file' => $this->csv($rows)])->assertCreated()->json('data');
            $this->as($planB)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertOk();
        };
        $this->load([$this->row('HD0001'), $this->row('HD0002')]);
        $loadB([$this->row('HD0003', ['ULP_CODE' => $this->ulpB->code, 'KD_PYLG' => 'XYZ'])]);
        $this->assertSame(2, DB::table('distribution_feeders')->count());
        $kl = DB::table('distribution_feeders')->where('code', 'KLWNG')->first();
        $this->assertSame($up3A, $kl->owner_unit_id);                                                                   // the UP3 above the ULP of its gardu
        $this->assertSame($kl->id, DB::table('substations')->where('code', 'HD0001')->value('feeder_id'));
        $this->assertSame('XYZ', DB::table('distribution_feeders')->where('id', DB::table('substations')->where('code', 'HD0003')->value('feeder_id'))->value('code'));

        $codes = fn (User $u) => collect($this->as($u)->getJson('/api/master-data/feeders')->assertOk()->json('data'))->pluck('code')->all();
        $this->assertSame(['KLWNG'], $codes($this->teknik));                                                            // sees its own feeder only
        $this->assertSame(['XYZ'], $codes($this->teknikB));
        $this->assertSame(['KLWNG'], $codes($this->planning));
        $this->as($this->teknik)->getJson('/api/master-data/feeders/'.DB::table('distribution_feeders')->where('code', 'XYZ')->value('id'))->assertNotFound();
        $this->as($this->vendor)->getJson('/api/master-data/feeders')->assertForbidden();

        $loadB([$this->row('HD0004', ['ULP_CODE' => $this->ulpB->code])]);                                                // a gardu of ULP B on KLWNG: the feeder now crosses two ULPs
        $d = $this->as($this->planning)->getJson("/api/master-data/feeders/{$kl->id}")->assertOk()->json('data');
        $this->assertSame(3, $d['feeder']['substation_count']);
        $this->assertEquals(600, $d['feeder']['capacity_kva']);
        $this->assertCount(2, $d['served_units']);
        $this->assertSame([$kl->id], collect($this->as($this->teknikB)->getJson('/api/master-data/feeders')->json('data'))->pluck('id')->intersect([$kl->id])->values()->all());     // ULP B serves it: it sees it
        $this->as($this->teknikB)->patchJson("/api/master-data/feeders/{$kl->id}", ['name' => 'x', 'reason' => 'coba'])->assertForbidden();    // but may not change it (no manage grant)
    }

    #[Test]
    public function a_feeder_is_changed_with_a_reason_inside_the_scope_and_its_history_is_kept(): void
    {
        $this->load([$this->row('HD0001')]);
        $id = (string) DB::table('distribution_feeders')->where('code', 'KLWNG')->value('id');
        $url = "/api/master-data/feeders/{$id}";
        $this->as($this->planning)->patchJson($url, ['name' => 'Kalawang'])->assertStatus(422);                              // reason required
        $this->as($this->planning)->patchJson($url, ['name' => 'Kalawang', 'gi_transformer_no' => '2', 'reason' => 'Melengkapi data'])->assertOk()->assertJsonPath('data.feeder.name', 'Kalawang');
        $this->as($this->planning)->patchJson($url, ['name' => 'Kalawang', 'reason' => 'Sama saja'])->assertStatus(409);       // nothing changed
        $this->as($this->planning)->patchJson($url, ['owner_unit_id' => $this->ulpB->getKey(), 'reason' => 'Pindah'])->assertStatus(409);   // outside the actor's scope
        $this->as($this->planning)->patchJson($url, ['owner_unit_id' => $this->ulpA->getKey(), 'reason' => 'Dikelola ULP'])->assertOk()->assertJsonPath('data.feeder.owner_unit_id', $this->ulpA->getKey());
        $h = $this->as($this->planning)->getJson($url)->json('data.history');
        $this->assertSame(['UPDATED', 'UPDATED', 'AUTO'], array_column($h, 'action'));
        $this->assertSame('Dikelola ULP', $h[0]['reason']);
        $this->as($this->planning)->postJson('/api/master-data/feeders', ['code' => 'klwng', 'owner_unit_id' => $this->ulpA->parent_id, 'reason' => 'ganda'])->assertStatus(409);
        $this->as($this->planning)->postJson('/api/master-data/feeders', ['code' => 'new-1', 'owner_unit_id' => $this->ulpA->parent_id, 'reason' => 'Penyulang baru'])->assertCreated()->assertJsonPath('data.feeder.code', 'NEW-1');
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('distribution_feeder_changes')->delete();                                                                  // append-only
    }

    #[Test]
    public function correcting_a_gardus_feeder_code_relinks_it_and_the_feeder_loading_reports_its_coverage(): void
    {
        $this->load([$this->row('HD0001'), $this->row('HD0002')]);
        $this->as($this->teknik)->postJson('/api/master-data/substations/'.$this->sid('HD0001').'/readings', ['measured_on' => now()->toDateString(), 'loading_pct' => 50])->assertCreated();      // 100 of 200 kVA
        $fid = (string) DB::table('distribution_feeders')->where('code', 'KLWNG')->value('id');
        $l = $this->as($this->planning)->getJson("/api/master-data/feeders/{$fid}")->json('data.loading');
        $this->assertSame(1, $l['measured_substations']);                                                                  // HD0002 has no kVA reading: not guessed
        $this->assertEquals(100, $l['load_kva']);
        $this->assertEquals(200, $l['capacity_kva']);
        $this->assertEquals(50, $l['loading_pct']);
        $this->as($this->planning)->patchJson('/api/master-data/substations/'.$this->sid('HD0002'), ['feeder_code' => 'BARU', 'reason' => 'Salah kode'])->assertOk();
        $new = DB::table('distribution_feeders')->where('code', 'BARU')->first();
        $this->assertNotNull($new);
        $this->assertSame($new->id, DB::table('substations')->where('code', 'HD0002')->value('feeder_id'));
        $this->assertSame(1, $this->as($this->planning)->getJson("/api/master-data/feeders/{$fid}")->json('data.feeder.substation_count'));
        $this->assertSame([$fid], collect($this->as($this->planning)->getJson('/api/master-data/substations?feeder_id='.$fid)->json('data'))->pluck('feeder_id')->unique()->values()->all());
    }

    #[Test]
    public function the_list_carries_address_and_transformer_brand_year_and_age_and_filters_and_sorts_on_them(): void
    {
        $geo = ['LOKASI2' => 'DS DIWEK', 'KELURAHAN' => 'DESA DIWEK', 'KECAMATAN' => 'KECAMATAN DIWEK', 'KABUPATEN' => 'KABUPATEN JOMBANG'];
        $this->load([$this->row('HD0001', $geo + ['MRKTRF1' => 'BAMBANG DJAJA', 'THNTRF1' => '2017', 'KAP_TOTAL' => '200']),
            $this->row('HD0002', ['MRKTRF1' => 'STARLITE', 'THNTRF1' => '2024', 'KAP_TOTAL' => '400', 'LATITUDEY' => '', 'LONGITUDEX' => '']),
            $this->row('HD0003', ['KAP_TOTAL' => '100'])]);
        $list = fn (string $qs = '') => collect($this->as($this->teknik)->getJson('/api/master-data/substations?per_page=50&'.$qs)->assertOk()->json('data'));
        $a = $list('q=HD0001')->first();
        $this->assertSame('DS DIWEK, DESA DIWEK, KECAMATAN DIWEK, KABUPATEN JOMBANG', $a['address']);
        $this->assertSame(['BAMBANG DJAJA', 2017, (int) date('Y') - 2017], [$a['transformer_brand'], $a['transformer_year'], $a['transformer_age_years']]);
        $this->assertNull($list('q=HD0003')->first()['transformer_year']);                                  // no transformer data: no age is invented
        $codes = fn (string $qs) => $list($qs)->pluck('code')->all();
        $this->assertSame(['HD0002'], $codes('brand=starlite'));
        $this->assertSame(['HD0002'], $codes('year_from=2020'));
        $this->assertSame(['HD0001'], $codes('year_to=2018'));
        $this->assertSame(['HD0002'], $codes('capacity_min=300'));
        $this->assertSame(['HD0001', 'HD0003'], $codes('capacity_max=200'));
        $this->assertSame(['HD0002'], $codes('has_coordinates=0'));
        $this->assertSame(['HD0001'], $codes('kecamatan=diwek'));
        $this->assertSame(['HD0002', 'HD0001', 'HD0003'], $codes('sort=capacity&dir=desc'));
        $this->assertSame(['HD0001', 'HD0002', 'HD0003'], $codes('sort=year'));                              // gardu without a year last
        $this->assertSame(['HD0002', 'HD0001', 'HD0003'], $codes('sort=year&dir=desc'));
    }

    #[Test]
    public function the_measurement_filters_and_sort_work_in_the_query_so_the_paging_stays_right(): void
    {
        $this->load([$this->row('HD0001'), $this->row('HD0002'), $this->row('HD0003'), $this->row('HD0004')]);
        $add = fn (string $code, array $body) => $this->as($this->teknik)->postJson('/api/master-data/substations/'.$this->sid($code).'/readings', $body)->assertCreated();
        $add('HD0001', ['measured_on' => now()->subDays(5)->toDateString(), 'loading_pct' => 90, 'current_r_a' => 150, 'current_s_a' => 100, 'current_t_a' => 50]);
        $add('HD0002', ['measured_on' => now()->subDays(5)->toDateString(), 'loading_pct' => 30, 'base_voltage_r_v' => 226, 'end_voltage_v' => 195]);
        $add('HD0003', ['measured_on' => now()->subDays(400)->toDateString(), 'loading_pct' => 50]);
        $list = fn (string $qs) => $this->as($this->teknik)->getJson('/api/master-data/substations?'.$qs)->assertOk()->json();
        $page = $list('reading_status=FRESH&per_page=1&page=2');
        $this->assertSame(2, $page['meta']['total']);                                                         // counted over all pages, not just the shown one
        $this->assertSame(['HD0002'], array_column($page['data'], 'code'));
        $this->assertSame(['HD0003'], array_column($list('reading_status=STALE')['data'], 'code'));
        $this->assertSame(['HD0004'], array_column($list('reading_status=NONE')['data'], 'code'));
        $this->assertSame(['HD0001'], array_column($list('loading_min=60')['data'], 'code'));
        $this->assertSame(['HD0002', 'HD0003'], array_column($list('loading_max=60')['data'], 'code'));
        $this->assertSame(['HD0001'], array_column($list('alert=PHASE_UNBALANCED')['data'], 'code'));
        $this->assertSame(['HD0002'], array_column($list('alert=END_DROP')['data'], 'code'));
        $this->assertSame(['HD0002'], array_column($list('alert=BASE_LOW')['data'], 'code'));
        $this->assertSame(['HD0001', 'HD0003', 'HD0002', 'HD0004'], array_column($list('sort=loading&dir=desc')['data'], 'code'));      // no reading last
        $this->assertSame(['HD0001', 'HD0002', 'HD0003', 'HD0004'], array_column($list('sort=measured_on&dir=desc')['data'], 'code'));      // newest first (a tie by code), no reading last
    }

    #[Test]
    public function a_correction_of_the_gardu_master_keeps_who_what_and_why(): void
    {
        $this->load([$this->row('HD0001', ['KAP_TOTAL' => '200'])]);
        $id = $this->sid('HD0001');
        $url = "/api/master-data/substations/{$id}";
        $this->as($this->planning)->patchJson($url, ['capacity_kva' => 250, 'name' => 'GARDU BARU'])->assertStatus(422);                       // the reason is required
        $d = $this->as($this->planning)->patchJson($url, ['capacity_kva' => 250, 'name' => 'GARDU BARU', 'reason' => 'Koreksi sesuai papan nama'])->assertOk()->json('data');
        $this->assertCount(1, $d['history']);
        $this->assertSame('Koreksi sesuai papan nama', $d['history'][0]['reason']);
        $this->assertEquals(200, $d['history'][0]['before']['capacity_kva']);
        $this->assertEquals(250, $d['history'][0]['after']['capacity_kva']);
        $this->assertSame($this->planning->name, $d['history'][0]['changed_by_name']);
        $again = $this->as($this->planning)->patchJson($url, ['capacity_kva' => 250, 'reason' => 'Sama saja'])->assertOk()->json('data');
        $this->assertCount(1, $again['history']);                                                                                         // nothing changed: nothing logged
        $this->as($this->planning)->patchJson($url, ['status' => 'NONAKTIF', 'reason' => 'Dibongkar'])->assertOk();
        $h = $this->as($this->teknik)->getJson($url)->json('data.history');
        $this->assertSame(['Dibongkar', 'Koreksi sesuai papan nama'], array_column($h, 'reason'));                                          // newest first
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('substation_changes')->delete();                                                                                       // append-only
    }

    #[Test]
    public function an_old_reading_is_flagged_stale(): void
    {
        $this->load([$this->row('HD0001')]);
        $id = $this->sid('HD0001');
        $this->as($this->planning)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->subMonths(13)->toDateString(), 'loading_pct' => 60])->assertCreated();
        $d = $this->as($this->teknik)->getJson("/api/master-data/substations/{$id}")->assertOk()->json('data.substation');
        $this->assertSame('STALE', $d['reading_status']);
        $this->assertTrue($d['reading']['stale']);
        $this->assertSame(1, $this->as($this->teknik)->getJson('/api/master-data/substations?reading_status=STALE')->json('meta.total') ? 1 : 0);
    }

    #[Test]
    public function the_bot_sends_readings_by_code_idempotently_and_unknown_codes_are_reported(): void
    {
        $this->load([$this->row('HD0001')]);
        $day = now()->subDay()->toDateString();
        $items = [['code' => 'HD0001', 'measured_on' => $day, 'current_r_a' => 100, 'current_s_a' => 90, 'current_t_a' => 110, 'end_voltage_v' => 205], ['code' => 'NOPE', 'measured_on' => $day, 'loading_pct' => 50],
            ['code' => 'HD0001', 'measured_on' => now()->subDays(2)->toDateString(), 'loading_pct' => 0]];
        $this->as($this->teknik)->postJson('/api/master-data/substations/readings/bulk', ['items' => $items])->assertForbidden();         // only the sync grant
        $r = $this->as($this->planning)->postJson('/api/master-data/substations/readings/bulk', ['items' => $items])->assertOk()->json('data');
        $this->assertEquals(['stored' => 1, 'unchanged' => 0, 'skipped' => 1, 'unknown' => 1, 'out_of_scope' => 0, 'total' => 3], $r['counts']);
        $again = $this->as($this->planning)->postJson('/api/master-data/substations/readings/bulk', ['items' => $items])->json('data.counts');
        $this->assertSame(1, $again['unchanged']);
        $this->assertSame(1, DB::table('substation_readings')->count());
        $this->assertEquals(66, DB::table('substation_readings')->value('load_kva'));
        $this->as($this->planning)->postJson('/api/master-data/substations/readings/bulk', ['items' => []])->assertStatus(422);
    }

    #[Test]
    public function a_customer_owned_or_inactive_gardu_cannot_be_chosen_but_stays_in_the_master(): void
    {
        $this->load([$this->row('HD0001'), $this->row('HD0002', ['TRFMILIK' => 'Pelanggan'])]);
        $this->assertSame(1, $this->as($this->teknik)->getJson('/api/master-data/substations?pickable=1')->json('meta.total'));
        $this->assertSame(2, $this->as($this->teknik)->getJson('/api/master-data/substations')->json('meta.total'));
        $this->as($this->planning)->patchJson('/api/master-data/substations/'.$this->sid('HD0001'), ['status' => 'NONAKTIF'])->assertStatus(422);        // a reason is required
        $this->as($this->planning)->patchJson('/api/master-data/substations/'.$this->sid('HD0001'), ['status' => 'NONAKTIF', 'reason' => 'Dibongkar'])->assertOk();
        $this->assertSame(0, $this->as($this->teknik)->getJson('/api/master-data/substations?pickable=1')->json('meta.total'));
    }

    #[Test]
    public function the_kko_fills_from_the_chosen_gardu_and_keeps_its_numbers_as_a_snapshot(): void
    {
        $this->load([$this->row('HD0001'), $this->row('HD0002', ['TRFMILIK' => 'Pelanggan'])]);
        $id = $this->sid('HD0001');
        $this->as($this->planning)->postJson("/api/master-data/substations/{$id}/readings", ['measured_on' => now()->toDateString(), 'loading_pct' => 60, 'end_voltage_v' => 212])->assertCreated();
        $app = $this->as($this->makeNiaga())->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Budi', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        DB::table('applications')->where('id', $app)->update(['delta_power_kva' => 20, 'new_power_value' => 20, 'new_power_unit' => 'kVA']);
        $url = "/api/applications/{$app}/kko";
        $r = $this->as($this->teknik)->putJson($url, ['substation_id' => $id])->assertOk()->json('data.record');
        $this->assertSame('HD0001', $r['substation_code']);
        $this->assertSame($id, $r['substation_id']);
        $this->assertEquals(200, $r['transformer_capacity_kva']);
        $this->assertEquals(120, $r['measured_load_kva']);                       // 60 % of 200 kVA, from the master's latest reading
        $this->assertNull($r['voltage_location_v']);                             // the customer's voltage is measured by the surveyor (2026-11-16), not taken from the gardu's end voltage
        $this->assertEquals(60, $r['loading_before_pct']);
        $this->assertEquals(68, $r['loading_after_pct']);                         // + 20 kVA x 0.8
        DB::table('substations')->where('id', $id)->update(['capacity_kva' => 400]);      // the master changes later: the study keeps what it judged
        $this->assertEquals(200, $this->as($this->teknik)->getJson($url)->json('data.record.transformer_capacity_kva'));
        $this->as($this->teknik)->putJson($url, ['substation_id' => $this->sid('HD0002')])->assertStatus(409);             // customer-owned
        $this->as($this->teknik)->putJson($url, ['substation_id' => (string) Str::uuid()])->assertNotFound();
    }

    private function makeNiaga(): User
    {
        $u = $this->makeUser();
        $this->assign($u, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->ulpA);

        return $u;
    }
}
