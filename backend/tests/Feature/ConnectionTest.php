<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\KkoPermissionSeeder;
use Database\Seeders\SubstationPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Master pelanggan (docs/81, owner 2026-11-12): DIL loaded in batches by IDPEL, linked to ULP, gardu (by GADIS number) and feeder; manual links; KKO link; summaries. */
class ConnectionTest extends PostgresTestCase
{
    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $planning;

    private User $teknik;

    private User $niagaUlp;

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
        $this->niagaUlp = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
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
    private function loadGardu(array $rows): array
    {
        $cols = array_keys(array_merge(...$rows));
        $out = fopen('php://temp', 'w+');
        fputcsv($out, $cols);
        foreach ($rows as $r) {
            fputcsv($out, array_map(fn ($c) => $r[$c] ?? '', $cols));
        }
        rewind($out);
        $file = UploadedFile::fake()->createWithContent('gardu.csv', stream_get_contents($out));
        $b = $this->as($this->planning)->postJson('/api/master-data/substations/imports', ['file' => $file])->assertCreated()->json('data');

        return $this->as($this->planning)->postJson("/api/master-data/substations/imports/{$b['id']}/confirm")->assertOk()->json('data.applied');
    }

    private function gardu(string $code, string $gadis, array $over = []): array
    {
        return $over + ['KD_GARDU' => $code, 'ULP_CODE' => $this->ulpA->code, 'KD_PYLG' => 'KLWNG', 'NO_GADIS' => $gadis, 'TRFMILIK' => 'PLN', 'KAP_TOTAL' => '200', 'JNS_GRD' => 'Gardu Distribusi 2 Tiang'];
    }

    /** @return array<string,mixed> */
    private function item(string $idpel, string $gadis = '', array $over = []): array
    {
        return $over + ['idpel' => $idpel, 'unit_code' => $this->ulpA->code, 'name' => 'AB*****', 'tariff_code' => 'R1', 'power_va' => 900, 'service_type' => 'PRABAYAR', 'meter_number' => '1234567', 'kelurahan' => 'KLW', 'status' => 'AKTIF', 'gardu_ref' => $gadis];
    }

    /** @param list<array<string,mixed>> $items */
    private function send(User $u, array $items): array
    {
        $b = $this->as($u)->postJson('/api/master-data/customer-connections/batches', ['file_name' => 'dil.mdb', 'snapshot_month' => '202210'])->assertCreated()->json('data.id');
        $r = $this->as($u)->postJson("/api/master-data/customer-connections/batches/{$b}/items", ['items' => $items])->assertOk()->json('data');
        $this->as($u)->postJson("/api/master-data/customer-connections/batches/{$b}/complete")->assertOk()->assertJsonPath('data.status', 'COMPLETED');

        return $r;
    }

    #[Test]
    public function the_dil_is_loaded_by_idpel_linked_to_the_gardu_by_the_gadis_number_and_is_idempotent(): void
    {
        $this->loadGardu([$this->gardu('HD0001', 'GD514530001')]);
        $items = [$this->item('514530000001', 'GD514530001'), $this->item('514530000002', 'GD999'), $this->item('514530000003', '', ['unit_code' => 'ZZZZZ']), $this->item('514530000004', '', ['unit_code' => $this->ulpB->code]),
            $this->item('12', ''), $this->item('514530000005', 'gd514530001 ', ['status' => 'BONGKAR'])];
        $r = $this->send($this->planning, $items);
        $this->assertEquals(['created' => 3, 'updated' => 0, 'unchanged' => 0, 'gardu_linked' => 2, 'gardu_unlinked' => 1, 'linked_by_code' => 0, 'invalid' => 1, 'unknown_unit' => 1, 'out_of_scope' => 1], $r['counts']);
        $this->assertCount(3, $r['problems']);
        $sid = (string) DB::table('substations')->where('code', 'HD0001')->value('id');
        $this->assertSame($sid, DB::table('customer_connections')->where('idpel', '514530000001')->value('substation_id'));
        $this->assertSame('DIL', DB::table('customer_connections')->where('idpel', '514530000001')->value('link_source'));
        $this->assertNull(DB::table('customer_connections')->where('idpel', '514530000002')->value('substation_id'));        // unknown gardu: kept as gardu_ref, not guessed
        $this->assertSame('GD999', DB::table('customer_connections')->where('idpel', '514530000002')->value('gardu_ref'));
        $this->assertSame(0, DB::table('customer_connections')->whereIn('idpel', ['514530000003', '514530000004', '12'])->count());

        $again = $this->send($this->planning, [$this->item('514530000001', 'GD514530001'), $this->item('514530000002', 'GD999')]);
        $this->assertSame(2, $again['counts']['unchanged']);
        $chg = $this->send($this->planning, [$this->item('514530000001', 'GD514530001', ['power_va' => 1300, 'tariff_code' => 'R1M'])]);
        $this->assertSame(1, $chg['counts']['updated']);
        $this->assertEquals(1300, DB::table('customer_connections')->where('idpel', '514530000001')->value('power_va'));
        $this->assertSame(3, DB::table('customer_connections')->count());
        $this->assertFalse(Schema::hasColumn('customer_connections', 'nik'));                                                // personal data has no column at all
        $this->assertFalse(Schema::hasColumn('customer_connections', 'phone'));
        $this->as($this->vendor)->postJson('/api/master-data/customer-connections/batches', [])->assertForbidden();
    }

    #[Test]
    public function customers_waiting_for_a_gardu_are_linked_when_that_gardu_is_imported_and_a_manual_link_is_kept(): void
    {
        $this->send($this->planning, [$this->item('514530000001', 'GD514530007'), $this->item('514530000002', 'GD514530007')]);
        $applied = $this->loadGardu([$this->gardu('HD0007', 'GD514530007')]);
        $this->assertSame(2, $applied['customers_linked']);
        $sid = (string) DB::table('substations')->where('code', 'HD0007')->value('id');
        $this->assertSame(2, DB::table('customer_connections')->where('substation_id', $sid)->count());

        $this->loadGardu([$this->gardu('HD0008', 'GD514530008')]);
        $other = (string) DB::table('substations')->where('code', 'HD0008')->value('id');
        $cid = (string) DB::table('customer_connections')->where('idpel', '514530000001')->value('id');
        $this->as($this->teknik)->patchJson("/api/master-data/customer-connections/{$cid}/link", ['substation_id' => $other])->assertOk()->assertJsonPath('data.connection.link_source', 'MANUAL')->assertJsonPath('data.connection.substation_code', 'HD0008');
        $this->send($this->planning, [$this->item('514530000001', 'GD514530007')]);                                         // a later load does not undo the manual link
        $this->assertSame($other, DB::table('customer_connections')->where('id', $cid)->value('substation_id'));
        $this->as($this->teknik)->patchJson("/api/master-data/customer-connections/{$cid}/link", ['substation_id' => null])->assertOk()->assertJsonPath('data.connection.substation_id', null);
        $this->as($this->teknik)->patchJson("/api/master-data/customer-connections/{$cid}/link", [])->assertStatus(422);
        $this->as($this->vendor)->patchJson("/api/master-data/customer-connections/{$cid}/link", ['substation_id' => $other])->assertForbidden();
    }

    #[Test]
    public function the_gardu_and_the_feeder_report_their_active_customers_and_contracted_power_and_the_list_filters(): void
    {
        $this->loadGardu([$this->gardu('HD0001', 'GD1'), $this->gardu('HD0002', 'GD2', ['KD_PYLG' => 'XYZ'])]);
        $this->send($this->planning, [$this->item('514530000001', 'GD1', ['power_va' => 900]), $this->item('514530000002', 'GD1', ['power_va' => 6600]), $this->item('514530000003', 'GD1', ['status' => 'BONGKAR', 'power_va' => 5500]),
            $this->item('514530000004', 'GD2', ['power_va' => 2200]), $this->item('514530000005', '', [])]);
        $s = $this->as($this->teknik)->getJson('/api/master-data/substations/'.DB::table('substations')->where('code', 'HD0001')->value('id'))->assertOk()->json('data.customers');
        $this->assertEquals(['active_customers' => 2, 'connected_va' => 7500, 'connected_kva' => 7.5, 'large_customers' => 1], $s);       // the dismantled one is not counted
        $fid = (string) DB::table('distribution_feeders')->where('code', 'KLWNG')->value('id');
        $this->assertSame(2, $this->as($this->planning)->getJson("/api/master-data/feeders/{$fid}")->json('data.customers.active_customers'));
        $q = fn (string $qs) => collect($this->as($this->planning)->getJson("/api/master-data/customer-connections?{$qs}")->assertOk()->json('data'))->pluck('idpel')->all();
        $this->assertSame(['514530000001', '514530000002', '514530000003'], $q('feeder_id='.$fid));
        $this->assertSame(['514530000005'], $q('linked=0'));
        $this->assertSame(['514530000003'], $q('status=BONGKAR'));
        $this->assertSame(['514530000002'], $q('q=5145300000&tariff_code=R1&service_type=PRABAYAR&substation_id='.DB::table('substations')->where('code', 'HD0001')->value('id').'&status=AKTIF&per_page=1&page=2'));
        $row = $this->as($this->planning)->getJson('/api/master-data/customer-connections?q=514530000001')->json('data.0');
        $this->assertSame('KLWNG', $row['feeder_code']);
        $this->assertTrue($row['name_masked']);
        $this->as($this->vendor)->getJson('/api/master-data/customer-connections')->assertForbidden();
    }

    #[Test]
    public function the_kko_links_the_applicants_only_idpel_to_the_chosen_gardu_and_never_guesses(): void
    {
        $this->loadGardu([$this->gardu('HD0001', 'GD1')]);
        $sid = (string) DB::table('substations')->where('code', 'HD0001')->value('id');
        $this->as($this->planning)->postJson("/api/master-data/substations/{$sid}/readings", ['measured_on' => now()->toDateString(), 'loading_pct' => 50])->assertCreated();
        $mkApp = function (array $idpels): string {
            $app = $this->as($this->niagaUlp)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
                'customer' => ['name' => 'Budi', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 6600, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
            $cust = DB::table('applications')->where('id', $app)->value('customer_id');
            foreach ($idpels as $i) {
                DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $cust, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $i, 'is_primary' => true, 'created_at' => now(), 'updated_at' => now()]);
            }
            DB::table('applications')->where('id', $app)->update(['delta_power_kva' => 6.6]);

            return $app;
        };
        $one = $mkApp(['514530000009']);
        $r = $this->as($this->teknik)->putJson("/api/applications/{$one}/kko", ['substation_id' => $sid])->assertOk()->json();
        $this->assertSame('created', $r['customer_link']['result']);                                                          // not in the DIL yet: created as PROSES
        $c = DB::table('customer_connections')->where('idpel', '514530000009')->first();
        $this->assertSame([$sid, 'PROSES', 'KKO', 'APPLICATION'], [$c->substation_id, $c->status, $c->link_source, $c->source]);
        $this->assertEquals(6600, $c->power_va);
        $this->assertSame('linked', $this->as($this->teknik)->putJson("/api/applications/{$one}/kko", ['substation_id' => $sid])->json('customer_link.result'));
        DB::table('customer_connections')->where('idpel', '514530000009')->update(['link_source' => 'MANUAL']);
        $this->assertSame('kept_manual', $this->as($this->teknik)->putJson("/api/applications/{$one}/kko", ['substation_id' => $sid])->json('customer_link.result'));
        $two = $mkApp(['514530000010', '514530000011']);
        $this->assertSame('ambiguous_idpel', $this->as($this->teknik)->putJson("/api/applications/{$two}/kko", ['substation_id' => $sid])->assertOk()->json('customer_link.result'));    // two IDPEL: no guess
        $none = $mkApp([]);
        $this->assertSame('no_idpel', $this->as($this->teknik)->putJson("/api/applications/{$none}/kko", ['substation_id' => $sid])->json('customer_link.result'));
        $this->assertSame(1, DB::table('customer_connections')->count());
    }

    #[Test]
    public function a_short_dil_code_is_completed_to_the_gardu_code_only_in_the_same_ulp_after_the_gadis_number_and_a_manual_decision_is_kept(): void
    {
        $this->loadGardu([$this->gardu('HD0127', 'GD514530127'), $this->gardu('HD0345', 'GD514530345')]);
        $sid = fn (string $code) => (string) DB::table('substations')->where('code', $code)->value('id');
        $r = $this->send($this->planning, [$this->item('514530000001', 'HD127'), $this->item('514530000002', 'hd127 '), $this->item('514530000003', 'GD514530345'), $this->item('514530000004', 'HD999'),
            $this->item('514530000005', 'D0127'), $this->item('514530000006', 'HD12345'), $this->item('514530000007', 'GD514530127')]);
        $this->assertSame(2, $r['counts']['linked_by_code']);
        $link = fn (string $idpel) => DB::table('customer_connections')->where('idpel', $idpel)->first(['substation_id', 'link_source']);
        $this->assertSame([$sid('HD0127'), 'DIL_KODE'], [$link('514530000001')->substation_id, $link('514530000001')->link_source]);
        $this->assertSame($sid('HD0127'), $link('514530000002')->substation_id);                                          // case and spaces do not matter
        $this->assertSame([$sid('HD0345'), 'DIL'], [$link('514530000003')->substation_id, $link('514530000003')->link_source]);      // the GADIS number stays the first key
        $this->assertSame([$sid('HD0127'), 'DIL'], [$link('514530000007')->substation_id, $link('514530000007')->link_source]);
        foreach (['514530000004', '514530000005', '514530000006'] as $none) {                                                // no such gardu / another form: never a guess
            $this->assertNull($link($none)->substation_id);
        }
        $this->assertSame(4, $this->as($this->planning)->getJson('/api/master-data/customer-connections?linked=1')->json('meta.total'));

        // a gardu that arrives later picks up the waiting short codes; the same short code in another ULP is not touched
        $this->send($this->planning, [$this->item('514530000008', 'HD555')]);
        $planB = $this->makeUser();
        $this->assign($planB, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), OrganizationalUnit::query()->findOrFail($this->ulpB->parent_id));
        $this->send($planB, [$this->item('514540000001', 'HD555', ['unit_code' => $this->ulpB->code])]);                    // the same short code, but a customer of ULP B
        $applied = $this->loadGardu([$this->gardu('HD0555', 'GD514530555'), $this->gardu('HD0556', 'GD514530556', ['ULP_CODE' => $this->ulpA->code])]);
        $this->assertSame(1, $applied['customers_linked']);
        $this->assertSame('DIL_KODE', $link('514530000008')->link_source);
        $this->assertNull($link('514540000001')->substation_id);                                                          // ULP B has no HD0555: its customer stays unlinked

        // an unlink by hand is a decision: neither a later load nor a gardu import links it again
        $cid = (string) DB::table('customer_connections')->where('idpel', '514530000001')->value('id');
        $this->as($this->teknik)->patchJson("/api/master-data/customer-connections/{$cid}/link", ['substation_id' => null])->assertOk();
        $this->send($this->planning, [$this->item('514530000001', 'HD127')]);
        $this->assertNull($link('514530000001')->substation_id);
        $this->assertSame(0, app(\App\Services\Substations\ConnectionService::class)->linkPending());
        $this->assertNull($link('514530000001')->substation_id);
    }

    #[Test]
    public function the_gardu_named_in_the_dil_name_links_the_customer_in_its_own_ulp_and_a_gardu_that_arrives_later_picks_it_up(): void
    {
        $this->assertSame(['HD0008', 'HD0742', 'HL0141', null, null], array_map([\App\Services\Substations\ConnectionService::class, 'codeFromName'],
            ['GD HD0008 PENYULANG DENANYAR', 'CEWENG-HD742', 'gd hl0141 penyulang x', 'GARDU PORTAL', 'XHD0008']));
        $this->assertSame(['HL0141', 'HD0001', null], array_map([\App\Services\Substations\ConnectionService::class, 'paddedCode'], ['hl141', 'HD1', 'D0049']));
        $this->loadGardu([$this->gardu('HD0008', 'GD514530003'), $this->gardu('HD0742', 'GD514530535')]);                  // the GADIS numbers of the master differ from the NOMOR_GARDU of the new DIL
        $sid = fn (string $code) => (string) DB::table('substations')->where('code', $code)->value('id');
        $long = '51453GD010000330276';
        $r = $this->send($this->planning, [
            $this->item('514530000001', $long, ['gardu_name' => 'GD HD0008 PENYULANG DENANYAR']),
            $this->item('514530000002', 'GD514530535', ['gardu_name' => 'CEWENG-HD742']),                                      // the old GADIS number still wins when it matches
            $this->item('514530000003', $long, ['gardu_name' => 'GD HD0999 PENYULANG DENANYAR']),                              // a gardu the master does not have yet
            $this->item('514530000004', 'HD8', ['gardu_name' => '']),                                                          // no name: the short code of NOMOR_GARDU as before
        ]);
        $link = fn (string $idpel) => DB::table('customer_connections')->where('idpel', $idpel)->first(['substation_id', 'link_source', 'gardu_code_ref']);
        $this->assertSame([$sid('HD0008'), 'DIL_NAMA', 'HD0008'], [$link('514530000001')->substation_id, $link('514530000001')->link_source, $link('514530000001')->gardu_code_ref]);
        $this->assertSame([$sid('HD0742'), 'DIL'], [$link('514530000002')->substation_id, $link('514530000002')->link_source]);
        $this->assertNull($link('514530000003')->substation_id);
        $this->assertSame('HD0999', $link('514530000003')->gardu_code_ref);                                                       // kept, waiting
        $this->assertSame([$sid('HD0008'), 'DIL_KODE'], [$link('514530000004')->substation_id, $link('514530000004')->link_source]);
        $this->assertSame(2, $r['counts']['linked_by_code']);
        // the same code in another ULP is not touched; the gardu that arrives later picks the waiting customer up
        $applied = $this->loadGardu([$this->gardu('HD0999', 'GD514530999')]);
        $this->assertSame(1, $applied['customers_linked']);
        $this->assertSame('DIL_NAMA', $link('514530000003')->link_source);
    }

}
