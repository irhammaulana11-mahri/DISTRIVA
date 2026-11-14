<?php

namespace Tests\Feature;

use App\Formula\Parser;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Inventory\MaterialSupplier;
use App\Services\Kkf\KkfCalculator;
use App\Services\Mto\GambarReader;
use App\Services\Mto\PdfGambarReader;
use App\Services\WorkOrders\MaterialOutbox;
use App\Support\Terbilang;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\DrawingPermissionSeeder;
use Database\Seeders\KkfPermissionSeeder;
use Database\Seeders\MasterDataPermissionSeeder;
use Database\Seeders\MtoPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Database\Seeders\RabPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class MtoTest extends PostgresTestCase
{
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private string $appType = 'PB';

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $retail;

    private User $manager;

    private User $teknik;

    private User $teknik2;

    private User $managerB;

    private User $perencanaan;

    private User $vendor;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        foreach ([ApplicationPermissionSeeder::class, SurveyPermissionSeeder::class, DrawingPermissionSeeder::class, MtoPermissionSeeder::class, RabPermissionSeeder::class, KkfPermissionSeeder::class, PlanningPermissionSeeder::class, MasterDataPermissionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
        $upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $upA);
        $this->ulpB = $this->makeUnit('ULP', $this->makeUnit('UP3'));
        $mk = function (string $role, OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retail = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->manager = $mk('MANAGER_ULP', $this->ulpA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
        $this->teknik2 = $mk('TEKNIK', $this->ulpA);
        $this->managerB = $mk('MANAGER_ULP', $this->ulpB);
        $this->perencanaan = $mk('PERENCANAAN', $upA);
        $this->vendor = $mk('VENDOR', $this->ulpA);
        $this->admin = $this->makeUser();
        $this->assign($this->admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
        $this->catalogue();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** Approved KHS items 1..4, construction types, and two approved BOMs (SUTM with a declared parameter, GTT_UMUM), valid from 2025-01-01. */
    private function catalogue(): void
    {
        $by = $this->teknik->getKey();
        $khs = [];
        foreach ([1 => 'Tiang beton', 2 => 'Konduktor', 3 => 'Commissioning test', 4 => 'Isolator'] as $code => $name) {
            $id = (string) Str::uuid();
            $khs[$code] = $id;
            DB::table('khs_items')->insert(['id' => $id, 'code' => (string) $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => $name, 'unit_text' => $code === 2 ? 'M' : 'B', 'valid_from' => '2025-01-01',
                'status' => 'APPROVED', 'created_by' => $by, 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        foreach ([['SUTM', 'SUTM-01', 'A3C 150'], ['SUTM', 'SUTM-02', 'TM 1'], ['GTT_UMUM', 'GTT_UMUM-01', 'TM 1']] as [$group, $code, $label]) {
            $id = (string) Str::uuid();
            DB::table('construction_types')->insert(['id' => $id, 'group_code' => $group, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('construction_type_versions')->insert(['id' => (string) Str::uuid(), 'construction_type_id' => $id, 'version_number' => 1, 'name' => $label, 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
                'created_by' => $by, 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->bom('SUTM', [
            [9, 1, ['H' => '+I9', 'I' => 'TRUNC(({PSG:SUTM-01}*1.02*3)/1)*1', 'J' => '+{BKR:SUTM-01}', 'K' => '+J9']],
            [10, 2, ['H' => '+I10', 'I' => 'TRUNC((I9*1.01)/1)*1']],
            [11, null, ['I' => 'SUM(I9:I10)']],                                              // helper row: never in the material need
            [12, 3, ['H' => '+{PARAM:COMMISSIONING:SUTM}']],
        ], $khs, [['name' => 'COMMISSIONING:SUTM', 'cell' => 'U5', 'description' => 'Volume commissioning test', 'default' => 0, 'group' => 'SUTM']]);
        $this->bom('GTT_UMUM', [[9, 1, ['H' => '+{PSG:GTT_UMUM-01}*2']], [10, 4, ['H' => '+{PSG:GTT_UMUM-01}']]], $khs, []);
    }

    /** @param list<array{0:int,1:?int,2:array<string,string>}> $lines */
    private function bom(string $group, array $lines, array $khs, array $params): void
    {
        $h = (string) Str::uuid();
        DB::table('bom_headers')->insert(['id' => $h, 'group_code' => $group, 'version_number' => 1, 'name' => "BOM {$group}", 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'parameters' => json_encode($params),
            'created_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ($lines as [$seq, $code, $f]) {
            DB::table('bom_lines')->insert(['id' => (string) Str::uuid(), 'bom_header_id' => $h, 'sequence' => $seq, 'khs_item_id' => $code === null ? null : $khs[$code], 'description' => "baris {$seq}",
                'formulas' => json_encode((object) array_map(fn ($t) => Parser::parse($t), $f)), 'source_formulas' => json_encode((object) $f), 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('bom_headers')->where('id', $h)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);   // lines first, approval last (immutability trigger)
    }

    private function png(string $name = 'denah.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, (string) base64_decode(self::PNG));
    }

    /** An APPROVED application with an ACCEPTED survey that requires a drawing, and a started drawing package. @return array{0:string,1:string,2:string} drawing, version, application */
    private function drawing(): array
    {
        $app = $this->as($this->retail)->postJson('/api/applications', ['application_type' => $this->appType, 'transaction_type' => $this->appType === 'PB' ? 'PASANG BARU' : 'PERUBAHAN DAYA', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4)], 'new_power_value' => 900, 'new_power_unit' => 'VA'] + ($this->appType === 'PD' ? ['old_power_value' => 450, 'old_power_unit' => 'VA'] : []))->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$app}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        $sid = (string) Str::uuid();
        DB::table('application_surveys')->insert(['id' => $sid, 'application_id' => $app, 'sequence_number' => 1, 'survey_number' => 'SRV-'.Str::random(6), 'status' => 'ACCEPTED', 'assigned_to' => $this->teknik->getKey(),
            'assigned_by' => $this->manager->getKey(), 'created_by' => $this->manager->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('application_survey_versions')->insert(['id' => (string) Str::uuid(), 'survey_id' => $sid, 'version_number' => 1, 'status' => 'ACCEPTED', 'surveyor_id' => $this->teknik->getKey(),
            'requires_drawing' => true, 'accepted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $pid = (string) Str::uuid();                                          // owner 2026-11-16: the drawing belongs to the usulan Teknik ULP made after the survey
        DB::table('proposals')->insert(['id' => $pid, 'proposal_number' => '9'.Str::random(4).'/USULAN-PBPD/T', 'issued_at' => now(), 'ulp_unit_id' => $this->ulpA->getKey(), 'representative_application_id' => $app, 'status' => 'OPEN',
            'created_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('proposal_applications')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $pid, 'application_id' => $app, 'added_by' => $this->teknik->getKey(), 'added_at' => now()]);
        $r = $this->as($this->manager)->postJson("/api/applications/{$app}/drawing", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        DB::table('proposal_applications')->where('proposal_id', $pid)->update(['released_at' => now()]);      // the usulan only had to exist for the drawing; the application-level tests below stay as they were

        return [$r->json('data.id'), $r->json('data.versions.0.id'), $app];
    }

    /** @return array{0:string,1:string,2:string,3:string} package, drawing, version, application */
    private function package(): array
    {
        [$d, $v, $app] = $this->drawing();
        $p = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/mto")->assertCreated()->json('data.id');

        return [$p, $d, $v, $app];
    }

    private function putItems(string $p, array $items, array $extra = [], ?User $by = null)
    {
        return $this->as($by ?? $this->teknik)->putJson("/api/mto/{$p}/items", ['items' => $items] + $extra);
    }

    private function sampleItems(): array
    {
        return [['construction_code' => 'SUTM-01', 'psg' => 10, 'bkr' => 2], ['construction_code' => 'GTT_UMUM-01', 'psg' => 3]];
    }

    private function filled(): array
    {
        [$p, $d, $v, $app] = $this->package();
        $this->putItems($p, $this->sampleItems())->assertOk();

        return [$p, $d, $v, $app];
    }

    // ---- grants -------------------------------------------------------------------------------------

    #[Test]
    public function the_mto_keys_are_granted_to_the_owner_decided_roles(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['SYS_ADMIN', 'TEKNIK'], $holders('mto.execute'));
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('mto.approve'));
        $this->assertNotContains('VENDOR', $holders('mto.view'));
        $this->assertSame(3, DB::table('permissions')->where('name', 'like', 'mto.%')->count());
        $this->seed(MtoPermissionSeeder::class);
        $this->assertSame(3, DB::table('permissions')->where('name', 'like', 'mto.%')->count());
    }

    // ---- creation ----------------------------------------------------------------------------------------

    #[Test]
    public function only_the_drawing_author_creates_the_package_once_per_version_while_the_version_is_open(): void
    {
        [$d, $v] = $this->drawing();
        foreach ([$this->manager, $this->retail, $this->perencanaan, $this->vendor, $this->managerB] as $u) {
            $this->as($u)->postJson("/api/drawings/{$d}/versions/{$v}/mto")->assertForbidden();
        }
        $r = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/mto")->assertCreated();
        $this->assertSame(['DRAFT', []], [$r->json('data.status'), $r->json('data.items')]);
        $this->assertStringStartsWith('MTO-PBPD-', $r->json('data.package_number'));
        $this->assertTrue($r->json('data.can.edit'));
        $this->assertFalse($r->json('data.can.decide'));
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/mto")->assertStatus(409);                  // one per drawing version
        $this->as($this->teknik)->getJson("/api/drawings/{$d}/versions/{$v}/mto")->assertOk()->assertJsonPath('data.id', $r->json('data.id'));

        [$d2, $v2] = $this->drawing();
        $this->as($this->manager)->getJson("/api/drawings/{$d2}/versions/{$v2}/mto")->assertOk()->assertJsonPath('data', null);
        DB::table('application_drawing_versions')->where('id', $v2)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER', 'submitted_at' => now()]);
        $this->as($this->teknik)->postJson("/api/drawings/{$d2}/versions/{$v2}/mto")->assertCreated();                   // waiting at the ULP manager is still open
        [$d3, $v3] = $this->drawing();
        DB::table('application_drawing_versions')->where('id', $v3)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER', 'submitted_at' => now()]);
        DB::table('application_drawing_versions')->where('id', $v3)->update(['status' => 'UNDER_REVIEW', 'stage' => 'UP3_REVIEW']);
        $this->as($this->teknik)->postJson("/api/drawings/{$d3}/versions/{$v3}/mto")->assertStatus(409);                 // UP3 review already started
    }

    // ---- quantities ---------------------------------------------------------------------------------------------

    #[Test]
    public function items_are_replaced_as_a_whole_validated_against_approved_constructions_and_logged_with_a_reason(): void
    {
        [$p] = $this->package();
        $this->putItems($p, [['construction_code' => 'NOPE-01', 'psg' => 1]])->assertUnprocessable();
        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => -1]])->assertUnprocessable();
        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 1], ['construction_code' => 'SUTM-01', 'psg' => 2]])->assertUnprocessable();       // duplicate
        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 1]], ['params' => ['TIDAK-ADA' => 1]])->assertUnprocessable();                       // undeclared parameter
        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 1]], ['params' => ['COMMISSIONING:SUTM' => -3]])->assertUnprocessable();
        $this->putItems($p, [], [])->assertUnprocessable();
        $this->as($this->vendor)->putJson("/api/mto/{$p}/items", [])->assertForbidden();                                                                    // grant before validation
        $this->putItems($p, $this->sampleItems(), [], $this->manager)->assertForbidden();

        $r = $this->putItems($p, array_merge($this->sampleItems(), [['construction_code' => 'SUTM-02', 'psg' => 0, 'bkr' => 0]]), ['params' => ['COMMISSIONING:SUTM' => 4]], $this->teknik2)->assertOk();   // role-based (owner 7 Nov 2026): any TEKNIK of the ULP, not only the one who opened the drawing
        $this->assertSame(['GTT_UMUM-01', 'SUTM-01'], array_column($r->json('data.items'), 'construction_code'));         // the empty row carries nothing
        $this->assertSame(4, $r->json('data.params.COMMISSIONING:SUTM'));
        $this->assertSame('COMMISSIONING:SUTM', $r->json('data.declared_params.0.name'));
        $this->assertSame('A3C 150', collect($r->json('data.items'))->firstWhere('construction_code', 'SUTM-01')['construction_label']);

        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 12]])->assertStatus(409);                                                                // a reason is needed after the first fill
        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 12]], ['reason' => 'Jumlah tiang dikoreksi dari gambar'])->assertOk();
        $ev = DB::table('mto_events')->where('event_type', 'ITEMS_CHANGED')->orderBy('seq')->get();
        $this->assertCount(2, $ev);
        $this->assertSame('Jumlah tiang dikoreksi dari gambar', $ev[1]->reason);
        $this->assertEquals([['code' => 'GTT_UMUM-01', 'psg' => 3, 'bkr' => 0], ['code' => 'SUTM-01', 'psg' => 10, 'bkr' => 2]], json_decode($ev[1]->details, true)['before']);      // jsonb sorts keys
        $this->assertEquals([['code' => 'SUTM-01', 'psg' => 12, 'bkr' => 0]], json_decode($ev[1]->details, true)['after']);
    }

    // ---- calculation ----------------------------------------------------------------------------------------------

    #[Test]
    public function the_material_need_is_computed_by_the_approved_boms_per_group_and_merged_per_khs_code(): void
    {
        [$p] = $this->filled();
        $this->putItems($p, $this->sampleItems(), ['params' => ['COMMISSIONING:SUTM' => 2], 'reason' => 'isi parameter'])->assertOk();
        $c = $this->as($this->teknik)->postJson("/api/mto/{$p}/calculate")->assertOk()->json('data');
        $this->assertFalse($c['frozen']);

        $line = fn (string $group, int $seq) => collect($c['lines'])->first(fn ($l) => $l['group'] === $group && $l['sequence'] === $seq);
        $this->assertEquals(30, $line('SUTM', 9)['install']);              // TRUNC(10 x 1.02 x 3) on the aggregate
        $this->assertEquals(2, $line('SUTM', 9)['remove']);
        $this->assertEquals(30, $line('SUTM', 9)['material']);
        $this->assertEquals(30, $line('SUTM', 10)['install']);             // TRUNC(30 x 1.01)
        $this->assertEquals(2, $line('SUTM', 12)['material']);             // the declared parameter
        $this->assertNull($line('SUTM', 11));                              // helper row (no KHS) is not material
        $this->assertEquals(6, $line('GTT_UMUM', 9)['material']);
        $this->assertEqualsCanonicalizing(['SUTM', 'GTT_UMUM'], array_keys($c['groups']));      // order of groups is not guaranteed

        $total = fn (string $code) => collect($c['totals'])->firstWhere('khs_code', $code);
        $this->assertEquals(36, $total('1')['material']);                  // KHS 1 appears in both BOMs: 30 + 6
        $this->assertSame(['Tiang beton', 'B'], [$total('1')['khs_name'], $total('1')['unit_text']]);
        $this->assertEquals(2, $total('3')['material']);
        $this->assertEquals(3, $total('4')['material']);
        $this->assertSame(['1', '2', '3', '4'], array_column($c['totals'], 'khs_code'));
        $this->assertSame(0, DB::table('mto_lines')->count());             // a preview stores nothing
    }

    #[Test]
    public function the_calculation_refuses_a_group_without_an_approved_bom_and_verification_a_khs_without_an_approved_version(): void
    {
        [$p] = $this->package();
        DB::table('construction_types')->insert(['id' => $tid = (string) Str::uuid(), 'group_code' => 'MVTIC', 'code' => 'MVTIC-01', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('construction_type_versions')->insert(['id' => (string) Str::uuid(), 'construction_type_id' => $tid, 'version_number' => 1, 'name' => 'Tibet', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $this->teknik->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->putItems($p, [['construction_code' => 'MVTIC-01', 'psg' => 1]])->assertOk();
        $r = $this->as($this->teknik)->postJson("/api/mto/{$p}/calculate")->assertStatus(409);
        $this->assertStringContainsString('BOM kelompok MVTIC belum disetujui', $r->json('message'));
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertStatus(409);

        $this->putItems($p, $this->sampleItems(), ['reason' => 'ganti'])->assertOk();
        DB::table('khs_item_versions')->whereIn('khs_item_id', DB::table('khs_items')->where('code', '4')->pluck('id'))->update(['valid_until' => '2025-12-31']);   // KHS 4 no longer valid today
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertStatus(409);
        $this->assertSame(0, DB::table('mto_lines')->count());
        $this->assertSame('DRAFT', DB::table('mto_packages')->where('id', $p)->value('status'));
    }

    // ---- verification and approval --------------------------------------------------------------------------------------

    #[Test]
    public function verification_stores_a_frozen_snapshot_with_a_hash_and_only_the_author_verifies(): void
    {
        [$p] = $this->filled();
        $this->as($this->manager)->postJson("/api/mto/{$p}/verify")->assertForbidden();
        [$empty] = $this->package();
        $this->as($this->teknik)->postJson("/api/mto/{$empty}/verify")->assertStatus(409);                              // nothing to verify

        $v = $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->assertSame('VERIFIED', $v->json('data.status'));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $v->json('data.snapshot_hash'));
        $this->assertNotNull($v->json('data.valid_on'));
        $this->assertSame($this->teknik->getKey(), $v->json('data.verified_by.id'));
        $this->assertGreaterThan(0, DB::table('mto_lines')->where('package_id', $p)->count());
        $this->assertTrue($v->json('data.can.decide') === false);                                                          // the verifier cannot decide

        $this->putItems($p, $this->sampleItems(), ['reason' => 'x'])->assertStatus(409);                                         // frozen
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertStatus(409);
        $this->assertDbRejects(fn () => DB::table('mto_items')->where('package_id', $p)->update(['psg' => 99]));
        $this->assertDbRejects(fn () => DB::table('mto_items')->where('package_id', $p)->delete());
        $this->assertDbRejects(fn () => DB::table('mto_lines')->where('package_id', $p)->update(['material' => 1]));
        $this->assertDbRejects(fn () => DB::table('mto_lines')->where('package_id', $p)->delete());
        $this->assertDbRejects(fn () => DB::table('mto_packages')->where('id', $p)->update(['snapshot_hash' => str_repeat('b', 64)]));

        $frozen = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/calculate")->assertOk()->json('data');              // anyone with view sees the frozen snapshot
        $this->assertTrue($frozen['frozen']);
        $this->assertEquals(36, collect($frozen['totals'])->firstWhere('khs_code', '1')['material']);
    }

    #[Test]
    public function manager_ulp_approves_and_the_verifier_can_never_approve_their_own_mto(): void
    {
        [$p] = $this->filled();
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        foreach ([$this->teknik, $this->teknik2, $this->retail, $this->perencanaan, $this->vendor] as $u) {
            $this->as($u)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertForbidden();
        }
        $this->as($this->managerB)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertNotFound();      // manager of another ULP
        $this->as($this->vendor)->postJson("/api/mto/{$p}/decision", [])->assertForbidden();                                 // grant before validation
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", [])->assertUnprocessable();

        // a person who is both TEKNIK (author/verifier) and MANAGER_ULP still cannot approve
        $dual = $this->makeUser();
        $this->assign($dual, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);
        $this->assign($dual, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA);
        [$p2, $d2] = $this->package();
        $this->as($this->manager)->postJson("/api/drawings/{$d2}/reassign", ['assigned_to' => $dual->getKey()])->assertOk();
        $this->putItems($p2, $this->sampleItems(), [], $dual)->assertOk();
        $this->as($dual)->postJson("/api/mto/{$p2}/verify")->assertOk();
        $this->as($dual)->postJson("/api/mto/{$p2}/decision", ['decision' => 'APPROVED'])->assertForbidden();
        $this->assertDbRejects(fn () => DB::table('mto_packages')->where('id', $p2)->update(['status' => 'APPROVED', 'approved_by' => $dual->getKey(), 'approved_at' => now()]));

        $ok = $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED', 'notes' => 'Sesuai gambar'])->assertOk();
        $this->assertSame('APPROVED', $ok->json('result.status'));
        $this->assertSame($this->manager->getKey(), $ok->json('data.approved_by.id'));
        $this->assertSame(['CREATED', 'ITEMS_CHANGED', 'VERIFIED', 'APPROVED'], array_column($ok->json('data.events'), 'event_type'));
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertStatus(409);       // already decided
        $this->assertDbRejects(fn () => DB::table('mto_packages')->where('id', $p)->update(['updated_at' => now()]));        // an approved package never changes
        $this->assertDbRejects(fn () => DB::table('mto_events')->update(['reason' => 'x']));
        $this->assertDbRejects(fn () => DB::table('mto_events')->delete());
    }

    #[Test]
    public function a_rejection_reopens_the_package_with_the_history_kept_and_the_cycle_can_repeat(): void
    {
        [$p] = $this->filled();
        $first = $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk()->json('data.snapshot_hash');
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'REJECTED'])->assertStatus(409);        // a reason is mandatory
        $r = $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'REJECTED', 'notes' => 'Jumlah Tibet tidak sesuai gambar'])->assertOk();
        $this->assertSame('DRAFT', $r->json('result.status'));
        $this->assertNull($r->json('data.snapshot_hash'));
        $this->assertNull($r->json('data.verified_by'));
        $this->assertSame(0, DB::table('mto_lines')->where('package_id', $p)->count());
        $this->assertTrue($r->json('data.can.edit') === false);                                                                // the manager cannot edit; the TEKNIK can

        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 20, 'bkr' => 2]], ['reason' => 'Dikoreksi sesuai catatan Manager ULP'])->assertOk();
        $second = $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk()->json('data.snapshot_hash');
        $this->assertNotSame($first, $second);
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertOk();
        $types = DB::table('mto_events')->orderBy('seq')->pluck('event_type')->all();
        $this->assertSame(['CREATED', 'ITEMS_CHANGED', 'VERIFIED', 'REJECTED', 'ITEMS_CHANGED', 'VERIFIED', 'APPROVED'], $types);
        $this->assertSame($first, json_decode((string) DB::table('mto_events')->where('event_type', 'REJECTED')->value('details'), true)['rejected_hash']);   // the rejected snapshot stays on record
    }

    // ---- the gate on the drawing -------------------------------------------------------------------------------------------

    #[Test]
    public function submitting_the_drawing_verifies_its_mto_and_the_manager_approves_both_in_one_decision(): void
    {
        [$p, $d, $v] = $this->filled();
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => 'SLD'])->assertOk();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
        $this->assertSame('DRAFT', DB::table('mto_packages')->where('id', $p)->value('status'));
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();                         // one submission: the MTO is verified with it
        $this->assertSame('VERIFIED', DB::table('mto_packages')->where('id', $p)->value('status'));
        $this->assertNotNull(DB::table('mto_packages')->where('id', $p)->value('snapshot_hash'));
        $step = fn (string $decision, ?string $notes = null) => $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/decisions", array_filter(['step' => 'ULP_MANAGER', 'decision' => $decision, 'notes' => $notes]));

        $step('APPROVED')->assertOk()->assertJsonPath('result.stage', 'UP3_REVIEW');                                          // one decision approves the drawing ...
        $this->assertSame('APPROVED', DB::table('mto_packages')->where('id', $p)->value('status'));                           // ... and its MTO
        $this->assertSame($this->manager->getKey(), DB::table('mto_packages')->where('id', $p)->value('approved_by'));
        $this->assertTrue(DB::table('mto_events')->where('package_id', $p)->where('event_type', 'APPROVED')->exists());
    }

    #[Test]
    public function a_rejection_of_the_drawing_needs_no_mto_and_the_next_version_can_start_from_the_previous_quantities(): void
    {
        [$p, $d, $v] = $this->filled();
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => 'SLD'])->assertOk();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();
        $rej = $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/decisions", ['step' => 'ULP_MANAGER', 'decision' => 'REJECTED', 'notes' => 'Gambar tidak terbaca'])->assertOk();
        $v2 = $rej->json('result.new_version_id');

        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertStatus(409);                                         // the old version is closed: its MTO no longer moves
        $new = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v2}/mto", ['copy_from_previous' => true])->assertCreated();
        $this->assertSame(['GTT_UMUM-01', 'SUTM-01'], array_column($new->json('data.items'), 'construction_code'));
        $this->assertEquals(10, collect($new->json('data.items'))->firstWhere('construction_code', 'SUTM-01')['psg']);
        $this->assertSame('DRAFT', $new->json('data.status'));
        $this->assertNotSame($p, $new->json('data.id'));
    }

    // ---- visibility and hints --------------------------------------------------------------------------------------------------

    #[Test]
    public function reading_follows_the_application_scope_and_the_hints_follow_the_flow(): void
    {
        [$p, $d, $v] = $this->filled();
        foreach ([$this->retail, $this->manager, $this->teknik, $this->perencanaan, $this->admin] as $u) {
            $this->as($u)->getJson("/api/mto/{$p}")->assertOk();
            $this->as($u)->getJson("/api/drawings/{$d}/versions/{$v}/mto")->assertOk();
        }
        $this->as($this->managerB)->getJson("/api/mto/{$p}")->assertNotFound();
        $this->as($this->managerB)->getJson("/api/drawings/{$d}/versions/{$v}/mto")->assertNotFound();
        $this->as($this->vendor)->getJson("/api/mto/{$p}")->assertForbidden();
        $this->as($this->vendor)->postJson("/api/mto/{$p}/calculate")->assertForbidden();

        $can = fn (User $u) => $this->as($u)->getJson("/api/mto/{$p}")->assertOk()->json('data.can');
        $this->assertSame(['edit' => true, 'verify' => true, 'decide' => false], $can($this->teknik));
        $this->assertSame(['edit' => false, 'verify' => false, 'decide' => false], $can($this->manager));                   // not verified yet
        $this->assertSame(['edit' => true, 'verify' => true, 'decide' => false], $can($this->teknik2));                      // role-based: any TEKNIK of the ULP
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->assertSame(['edit' => false, 'verify' => false, 'decide' => true], $can($this->manager));
        $this->assertSame(['edit' => false, 'verify' => false, 'decide' => false], $can($this->teknik));
        $caps = $this->as($this->manager)->getJson('/api/mto/access')->assertOk()->json('can');
        $this->assertTrue($caps['mto.approve']);
        $this->assertFalse($caps['mto.execute']);
    }

    #[Test]
    public function an_application_that_is_no_longer_open_blocks_the_mto(): void
    {
        [$p, $d, $v, $app] = $this->filled();
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CANCELLED']);
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertStatus(409);
        $this->putItems($p, $this->sampleItems(), ['reason' => 'x'])->assertStatus(409);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'PAID']);
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
    }

    // ---- stage 4B: reading the GAMBAR sheet --------------------------------------------------------------

    /** @param array<string,mixed> $cells */
    private function gambarXlsx(array $cells, string $sheetName = 'GAMBAR'): UploadedFile
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet()->setTitle($sheetName);
        foreach ($cells as $ref => $value) {
            $sheet->setCellValue($ref, $value);
        }
        $path = tempnam(sys_get_temp_dir(), 'gx');
        (new Xlsx($book))->save($path);
        $content = (string) file_get_contents($path);
        @unlink($path);

        return UploadedFile::fake()->createWithContent('gambar.xlsx', $content);
    }

    private function mainFile(string $d, string $v, UploadedFile $file): void
    {
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $file, 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
    }

    private function template(): array
    {
        return ['T6' => 'A3C 150', 'U6' => 5, 'V6' => 1, 'T7' => ' TM  1 ', 'U7' => 2, 'Z6' => 'TM 1', 'AA6' => 4, 'T8' => 'Konstruksi Asing', 'U8' => 3,
            'T9' => 'Tak ada angka', 'U10' => 7, 'U5' => 9, 'V20' => 'abc', 'AA54' => 1];
    }

    #[Test]
    public function the_gambar_sheet_fills_the_package_with_candidates_and_reports_what_it_could_not_use(): void
    {
        [$p, $d, $v] = $this->package();
        $this->mainFile($d, $v, $this->gambarXlsx($this->template()));

        $r = $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertOk();
        $items = collect($r->json('data.items'))->keyBy('construction_code');
        $this->assertEqualsCanonicalizing(['SUTM-01', 'SUTM-02', 'GTT_UMUM-01'], $items->keys()->all());
        $this->assertEquals(5, $items['SUTM-01']['psg']);
        $this->assertEquals(1, $items['SUTM-01']['bkr']);
        $this->assertEquals(2, $items['SUTM-02']['psg']);                              // label matched ignoring spaces and case
        $this->assertEquals(4, $items['GTT_UMUM-01']['psg']);                          // same name in another group is its own type
        $this->assertSame('EXTRACTED', $items['SUTM-01']['source']);
        $this->assertEquals(5, $items['SUTM-01']['detected_psg']);

        $this->assertSame(['Konstruksi Asing'], array_column($r->json('extraction.unmatched'), 'label'));
        $codes = array_column($r->json('extraction.warnings'), 'code');
        $this->assertContains('OUTSIDE_BLOCK', $codes);
        $this->assertContains('NO_LABEL', $codes);                                     // U10 has a number but no label
        $this->assertContains('NOT_NUMERIC', $codes);                                  // V20 holds text
        $this->assertSame(1, DB::table('mto_events')->where('package_id', $p)->where('event_type', 'ITEMS_CHANGED')->count());
        $this->assertMatchesRegularExpression('/^GBR_.+\.xlsx$/', json_decode((string) DB::table('mto_events')->where('package_id', $p)->where('event_type', 'ITEMS_CHANGED')->value('details'), true)['extracted_from']['file']);          // the system names drawing files GBR_{agenda}_{customer} (owner 2026-11-15)
    }

    #[Test]
    public function an_edited_candidate_keeps_the_detected_value_visible_and_a_second_extraction_needs_a_reason(): void
    {
        [$p, $d, $v] = $this->package();
        $this->mainFile($d, $v, $this->gambarXlsx($this->template()));
        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertOk();

        $this->putItems($p, [['construction_code' => 'SUTM-01', 'psg' => 6, 'bkr' => 1], ['construction_code' => 'SUTM-02', 'psg' => 2], ['construction_code' => 'GTT_UMUM-01', 'psg' => 0]], ['reason' => 'Dihitung ulang di lapangan'])->assertOk();
        $items = collect($this->as($this->teknik)->getJson("/api/mto/{$p}")->json('data.items'))->keyBy('construction_code');
        $this->assertSame('MANUAL', $items['SUTM-01']['source']);                      // changed: no longer the detection
        $this->assertEquals(6, $items['SUTM-01']['psg']);
        $this->assertEquals(5, $items['SUTM-01']['detected_psg']);                     // ... but what was detected stays
        $this->assertSame('EXTRACTED', $items['SUTM-02']['source']);
        $this->assertEquals(4, $items['GTT_UMUM-01']['detected_psg']);                  // set to zero by the edit: the row stays so the difference is visible
        $this->assertEquals(0, $items['GTT_UMUM-01']['psg']);

        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertStatus(409);   // already filled: reason is mandatory
        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract", ['reason' => 'Berkas gambar diperbarui'])->assertOk();
        $this->assertSame('EXTRACTED', collect($this->as($this->teknik)->getJson("/api/mto/{$p}")->json('data.items'))->firstWhere('construction_code', 'SUTM-01')['source']);
    }

    #[Test]
    public function extraction_refuses_a_missing_or_non_excel_main_file_a_wrong_sheet_other_users_and_a_closed_package(): void
    {
        [$p, $d, $v] = $this->package();
        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertStatus(409);                       // no main file
        $this->mainFile($d, $v, $this->png());
        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertStatus(409);                       // image, not Excel

        [$p2, $d2, $v2] = $this->package();
        $this->mainFile($d2, $v2, $this->gambarXlsx($this->template(), 'SHEET1'));
        $this->as($this->teknik)->postJson("/api/mto/{$p2}/extract")->assertStatus(409)->assertJsonFragment(['message' => 'Berkas Excel tidak dapat dibaca atau tidak memuat lembar GAMBAR.']);

        [$p3, $d3, $v3] = $this->package();
        $this->mainFile($d3, $v3, $this->gambarXlsx($this->template()));
        $this->as($this->vendor)->postJson("/api/mto/{$p3}/extract")->assertForbidden();
        $this->as($this->managerB)->postJson("/api/mto/{$p3}/extract")->assertForbidden();
        $this->assertSame(0, DB::table('mto_items')->where('package_id', $p3)->count());
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract")->assertOk();
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/verify")->assertOk();
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract", ['reason' => 'x'])->assertStatus(409);    // verified: frozen
    }

    /** A one-page PDF with real text at fixed positions (what Excel's "save as PDF" produces for the GAMBAR sheet), so no personal sample is needed. */
    private function gambarPdf(array $words): UploadedFile
    {
        $stream = "BT /F1 5 Tf\n";
        foreach ($words as [$x, $y, $text]) {
            $stream .= sprintf("1 0 0 1 %.2f %.2f Tm (%s) Tj\n", $x, 600 - $y, str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text));
        }
        $stream .= 'ET';
        $objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 600] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length '.strlen($stream)." >>\nstream\n{$stream}\nendstream"];
        $pdf = "%PDF-1.4\n";
        $offsets = [];
        foreach ($objs as $i => $o) {
            $offsets[] = strlen($pdf);
            $pdf .= ($i + 1)." 0 obj\n{$o}\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= "xref\n0 ".(count($objs) + 1)."\n0000000000 65535 f \n";
        foreach ($offsets as $o) {
            $pdf .= sprintf("%010d 00000 n \n", $o);
        }
        $pdf .= 'trailer << /Size '.(count($objs) + 1)." /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";

        return UploadedFile::fake()->createWithContent('gambar.pdf', $pdf);
    }

    /** @return list<array{0:float,1:float,2:string}> two construction columns (SUTM left, GTT Umum right), PBPD block and a date line */
    private function pdfTemplate(): array
    {
        $w = [[100, 100, 'Ket.'], [130, 100, 'Uraian'], [200, 100, 'Psg'], [220, 100, 'Bkr'], [330, 100, 'Uraian'], [400, 100, 'Psg'], [420, 100, 'Bkr'],
            [110, 110, 'Konstruksi'], [150, 110, 'SUTM'], [172, 110, '(ms)'], [201, 110, '1'],                      // a number on a title row is never a quantity
            [110, 120, 'A3C'], [124, 120, '150'], [201, 120, '5'], [221, 120, '1'],
            [110, 130, 'TM'], [118, 130, '1'], [201, 130, '2'],
            [110, 140, 'Konstruksi'], [150, 140, 'Estetika'], [110, 150, 'Gardu'], [128, 150, 'Beton'], [201, 150, '9'],   // ignored section
            [310, 110, 'Konstruksi'], [350, 110, 'GTT'], [362, 110, 'Umum'],
            [310, 120, 'TM'], [318, 120, '1'], [401, 120, '4'],
            [310, 130, 'Barang'], [340, 130, 'Asing'], [401, 130, '3'],
            [310, 140, 'PBPD'],
            [310, 150, '450-5500'], [345, 150, 'VA'], [401, 150, '3'],
            [310, 160, '23'], [320, 160, 'kVA'], [421, 160, '1'],
            [310, 170, 'Friday,'], [335, 170, 'November'], [401, 170, '2026'],
            [110, 190, 'No.'], [120, 190, 'Gambar'], [135, 190, ':']];

        return $w;
    }

    #[Test]
    public function a_pdf_export_of_the_gambar_sheet_is_read_by_position_and_fills_the_package(): void
    {
        [$p, $d, $v] = $this->package();
        $this->mainFile($d, $v, $this->gambarPdf($this->pdfTemplate()));

        $r = $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertOk();
        $items = collect($r->json('data.items'))->keyBy('construction_code');
        $this->assertEqualsCanonicalizing(['SUTM-01', 'SUTM-02', 'GTT_UMUM-01'], $items->keys()->all());
        $this->assertEquals([5, 1], [$items['SUTM-01']['psg'], $items['SUTM-01']['bkr']]);
        $this->assertEquals(2, $items['SUTM-02']['psg']);
        $this->assertEquals(4, $items['GTT_UMUM-01']['psg']);                                                       // same name, other group
        $this->assertSame('pdf', $r->json('extraction.file.format'));
        $this->assertSame(['Barang Asing'], array_column($r->json('extraction.unmatched'), 'label'));                      // unknown label is only reported
        // PBPD ranges are reported (not stored); the printed date under the block is not a range
        $this->assertSame(['450-5500 VA', '23 kVA'], array_column($r->json('extraction.pbpd'), 'label'));
        $this->assertEquals([[3, 0], [0, 1]], array_map(fn ($b) => [$b['psg'], $b['bkr']], $r->json('extraction.pbpd')));
        $this->assertContains('OUTSIDE_BLOCK', array_column($r->json('extraction.warnings'), 'code'));               // the 1 on the SUTM title row
    }

    #[Test]
    public function a_pdf_without_the_template_a_corrupt_pdf_and_a_chosen_attachment_are_handled(): void
    {
        [$p, $d, $v] = $this->package();
        $this->mainFile($d, $v, $this->gambarPdf([[100, 100, 'Hanya'], [140, 100, 'teks']]));
        $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertStatus(409);                          // no Uraian/Psg/Bkr columns

        [$p2, $d2, $v2] = $this->package();
        $this->mainFile($d2, $v2, UploadedFile::fake()->createWithContent('rusak.pdf', "%PDF-1.4\nbukan pdf sungguhan"));
        $this->as($this->teknik)->postJson("/api/mto/{$p2}/extract")->assertStatus(409);

        // a PDF attached next to an image MAIN file can be chosen explicitly
        [$p3, $d3, $v3] = $this->package();
        $this->mainFile($d3, $v3, $this->png());
        $doc = $this->as($this->teknik)->post("/api/drawings/{$d3}/versions/{$v3}/documents", ['file' => $this->gambarPdf($this->pdfTemplate()), 'role' => 'ATTACHMENT'], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract")->assertStatus(409);                          // MAIN is an image
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract", ['document_id' => $doc])->assertOk();
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract", ['document_id' => (string) Str::uuid(), 'reason' => 'x'])->assertStatus(409);
        $this->as($this->teknik)->postJson("/api/mto/{$p3}/extract", ['document_id' => 'bukan-uuid'])->assertUnprocessable();
    }

    #[Test]
    public function the_xlsx_reader_reports_the_pbpd_ranges_and_the_real_sample_files_read_as_expected(): void
    {
        $x = (new GambarReader)->read($this->writeXlsx(['Z51' => '450-5500 VA', 'AA51' => 3, 'Z53' => '147 kVA', 'AB53' => 1, 'Z57' => '=TODAY()']), 'xlsx');
        $this->assertSame([['450-5500 VA', 3.0, 0.0], ['147 kVA', 0.0, 1.0]], array_map(fn ($b) => [$b['label'], $b['psg'], $b['bkr']], $x['pbpd']));
        $this->assertSame([], array_column($x['warnings'], 'code'));                                            // PBPD cells are inside a block now

        $dir = base_path('../tools/samples/');
        $pdf = $dir.'CARGO GUDANG BONGKAR MUAT.pdf';
        if (! is_file($pdf)) {
            $this->markTestSkipped('Contoh gambar tidak ada di mesin ini.');
        }
        $read = (new PdfGambarReader)->read($pdf);
        $this->assertCount(9, $read['items']);                                                                    // the same nine constructions the Excel version of this drawing gave
        $this->assertSame(60.0, collect($read['items'])->firstWhere('label', 'A3C-S 150')['psg']);
        $this->assertSame(['105 kVA'], array_column($read['pbpd'], 'label'));
    }

    #[Test]
    public function the_pbpd_block_of_the_drawing_drives_the_pbpd_boms_through_text_parameters(): void
    {
        $khs = DB::table('khs_items')->pluck('id', 'code')->mapWithKeys(fn ($id, $c) => [(int) $c => $id])->all();
        $ranges = ['450-5500 VA', '6,6-16,5 kVA', '23 kVA', '33 kVA', '41,5 kVA'];
        $defs = [['name' => 'PBPD:JENIS', 'cell' => 'Z50', 'type' => 'text', 'options' => ['PBPD', 'PD 6,6-23 KVA'], 'default' => 'PBPD', 'group' => 'PBPD_6_41'],
            ['name' => 'PBPD:PEMBAYARAN', 'cell' => 'S55', 'type' => 'text', 'options' => ['TUNAI', 'PLN'], 'default' => 'PLN', 'group' => 'PBPD_6_41']];
        foreach (range(1, 6) as $n) {
            $defs[] = ['name' => "PBPD:RENTANG_{$n}", 'cell' => 'Z'.(50 + $n), 'type' => 'text', 'options' => $ranges, 'default' => '', 'group' => 'PBPD_6_41'];
            $defs[] = ['name' => "PBPD:PSG_{$n}", 'cell' => 'AA'.(50 + $n), 'default' => 0, 'group' => 'PBPD_6_41'];
            $defs[] = ['name' => "PBPD:BKR_{$n}", 'cell' => 'AB'.(50 + $n), 'default' => 0, 'group' => 'PBPD_6_41'];
        }
        $this->bom('PBPD_6_41', [[9, 1, [
            'B' => 'IF(OR({PARAM:PBPD:RENTANG_1}="23 kVA",{PARAM:PBPD:RENTANG_2}="23 kVA"),1,"")',
            'H' => 'IF({PARAM:PBPD:JENIS}="PD 6,6-23 KVA",0,IF({PARAM:PBPD:RENTANG_1}="450-5500 VA",{PARAM:PBPD:PSG_1},0)+IF({PARAM:PBPD:RENTANG_2}="23 kVA",{PARAM:PBPD:PSG_2},0))']]], $khs, $defs);
        $this->bom('PBPD_53_197', [[9, 2, ['H' => '+{PARAM:PBPD:PSG_1}']]], $khs, [['name' => 'PBPD:PSG_1', 'cell' => 'AA51', 'default' => 0, 'group' => 'PBPD_53_197']]);

        [$p, $d, $v] = $this->package();
        $this->mainFile($d, $v, $this->gambarXlsx($this->template() + ['Z50' => 'PBPD', 'S55' => 'TUNAI', 'Z51' => '7700 VA', 'AA51' => 3, 'Z52' => '23 kVA', 'AA52' => 2, 'Z53' => '999 kVA', 'AA53' => 1]));
        $r = $this->as($this->teknik)->postJson("/api/mto/{$p}/extract")->assertOk();
        $this->assertTrue($r->json('extraction.pbpd_applied'));
        $this->assertSame(['999 kVA'], array_column($r->json('extraction.pbpd_unmatched'), 'label'));
        $params = (array) $r->json('data.params');
        $this->assertSame(['450-5500 VA', 'TUNAI', 'PBPD', '23 kVA', ''], [$params['PBPD:RENTANG_1'], $params['PBPD:PEMBAYARAN'], $params['PBPD:JENIS'], $params['PBPD:RENTANG_2'], $params['PBPD:RENTANG_3']]);   // 7700 VA = 450-5500 VA
        $this->assertEquals(3, $params['PBPD:PSG_1']);

        $c = $this->as($this->teknik)->postJson("/api/mto/{$p}/calculate")->assertOk()->json('data');
        $pb = collect($c['lines'])->first(fn ($l) => $l['group'] === 'PBPD_6_41');
        $this->assertSame('1', $pb['khs_code']);
        $this->assertEquals(5, $pb['material']);                                     // 3 (450-5500/7700 VA) + 2 (23 kVA)

        $this->putItems($p, $this->sampleItems(), ['params' => ['PBPD:JENIS' => 'PD 6,6-23 KVA'], 'reason' => 'perubahan daya'])->assertOk();
        $c = $this->as($this->teknik)->postJson("/api/mto/{$p}/calculate")->assertOk()->json('data');
        $this->assertNull(collect($c['lines'])->first(fn ($l) => $l['group'] === 'PBPD_6_41'));   // PD blanks the row (quantity 0)
        $this->putItems($p, $this->sampleItems(), ['params' => ['PBPD:RENTANG_1' => '123 kVA'], 'reason' => 'salah'])->assertStatus(422);
    }

    #[Test]
    public function an_insurance_basis_row_is_not_counted_twice_as_a_material_need(): void
    {
        $khs = DB::table('khs_items')->pluck('id', 'code')->mapWithKeys(fn ($id, $c) => [(int) $c => $id])->all();
        $this->bom('PBPD_53_197', [
            [9, 4, ['H' => '+{PARAM:PBPD:PSG_1}*3']],
            [20, 4, ['H' => 'SUMIF($B$9:$B$19,B20,$H$9:$H$19)']],        // the workbook's "Asuransi Material PLN" row: repeats the total of code 4
        ], $khs, [['name' => 'PBPD:PSG_1', 'cell' => 'AA51', 'default' => 0, 'group' => 'PBPD_53_197']]);
        $this->bom('PBPD_6_41', [[9, 1, ['H' => '+1']]], $khs, [['name' => 'PBPD:PSG_2', 'cell' => 'AA52', 'default' => 0, 'group' => 'PBPD_6_41']]);
        [$p] = $this->package();
        $this->putItems($p, $this->sampleItems(), ['params' => ['PBPD:PSG_1' => 2]])->assertOk();
        $c = $this->as($this->teknik)->postJson("/api/mto/{$p}/calculate")->assertOk()->json('data');
        $this->assertEquals(9, collect($c['totals'])->firstWhere('khs_code', '4')['material']);                 // 3 (GTT umum) + 2 x 3 (PBPD); the insurance row would have added 6 more
        $this->assertNull(collect($c['lines'])->first(fn ($l) => $l['group'] === 'PBPD_53_197' && $l['sequence'] === 20));
    }

    /** An APPROVED price book for the codes of the test catalogue; zone 2 for the UP3 of ULP A. code => [status, material price, insured value, install price, remove price] */
    private function priceBook(array $rows, bool $zone = true): string
    {
        $id = (string) Str::uuid();
        DB::table('price_books')->insert(['id' => $id, 'name' => 'Kontrak uji', 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'created_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ($rows as $code => [$status, $price, $insured, $install, $remove]) {
            $item = (string) Str::uuid();
            DB::table('price_book_items')->insert(['id' => $item, 'price_book_id' => $id, 'khs_item_id' => DB::table('khs_items')->where('code', (string) $code)->value('id'), 'material_status' => $status,
                'material_price' => $price, 'insured_value' => $insured, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('price_book_service_prices')->insert(['id' => (string) Str::uuid(), 'price_book_item_id' => $item, 'zone' => 2, 'install_price' => $install, 'remove_price' => $remove]);
        }
        if ($zone) {
            DB::table('price_book_zones')->insert(['id' => (string) Str::uuid(), 'price_book_id' => $id, 'up3_unit_id' => $this->ulpA->parent_id, 'zone' => 2, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('price_books')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);

        return $id;
    }

    /** An APPROVED MTO package whose PBPD_53_197 group has a commissioning row, a K3L row and an insurance-basis row (hand-computable). */
    private function approvedPackageWithPbpd(array $extraParams = []): string
    {
        $khs = DB::table('khs_items')->pluck('id', 'code')->mapWithKeys(fn ($id, $c) => [(int) $c => $id])->all();
        $slotDefs = [['name' => 'PBPD:PSG_2', 'cell' => 'AA52', 'default' => 0, 'group' => 'PBPD_6_41'], ['name' => 'PBPD:PSG_3', 'cell' => 'AA53', 'default' => 0, 'group' => 'PBPD_6_41']];
        foreach ([1, 2, 3] as $n) {
            $slotDefs[] = ['name' => "PBPD:RENTANG_{$n}", 'cell' => 'Z'.(50 + $n), 'type' => 'text', 'options' => ['450-5500 VA', '23 kVA'], 'default' => '', 'group' => 'PBPD_6_41'];
        }
        $this->bom('PBPD_6_41', [[9, 4, ['H' => '+0']]], $khs, $slotDefs);
        $this->bom('PBPD_53_197', [
            [8, null, ['H' => '+5']],                                  // a volume row (no KHS code), as the real BOM sheets have
            [9, 1, ['H' => '+{PARAM:PBPD:PSG_1}*10', 'I' => '+{PARAM:PBPD:PSG_1}*2']],
            [10, 2, ['H' => '+5', 'J' => '+1']],
            [12, 3, ['H' => '+{PARAM:COMMISSIONING:PBPD_53_197}']],
            [13, 4, ['H' => '+H12']],
            [20, 1, ['H' => 'SUMIF($B$9:$B$19,B20,$H$9:$H$19)']],
        ], $khs, [['name' => 'PBPD:PSG_1', 'cell' => 'AA51', 'default' => 0, 'group' => 'PBPD_53_197'], ['name' => 'COMMISSIONING:PBPD_53_197', 'cell' => 'AA9', 'default' => 0, 'group' => 'PBPD_53_197']]);
        [$p] = $this->package();
        $this->putItems($p, $this->sampleItems(), ['params' => $extraParams + ['PBPD:PSG_1' => 2, 'COMMISSIONING:PBPD_53_197' => 3], 'reason' => 'uji'])->assertOk();
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertOk();

        return $p;
    }

    #[Test]
    public function the_rab_prices_the_frozen_mto_per_group_like_the_workbook_with_one_rounding_per_group(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);

        $r = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs", ['dry_run' => 1])->assertOk()->assertJsonPath('stored', false);
        $g = $r->json('data.groups.PBPD_53_197');
        $this->assertEquals(20000, $g['material']);                 // code 1: 20 x 1000; code 2 is PLN -> no material cost
        $this->assertEquals(480, $g['service']);                    // install 4 x 100 + remove 1 x 80
        $this->assertEquals(900, $g['commissioning']);              // 3 x install price 300
        $this->assertEquals(150, $g['k3l']);                        // 3 x install price 50
        $this->assertEquals(3000, $g['insurance']);                 // ROUND(50000 x 3/1000) x 20
        $this->assertEquals(24530, $g['subtotal']);
        $this->assertEquals(2698, $g['ppn']);                       // ROUND(24530 x 11%)
        $this->assertEquals(27300, $g['total']);                    // ROUNDUP(27228, -2)
        $this->assertEquals(collect($r->json('data.groups'))->sum('total'), $r->json('data.grand_total'));
        $this->assertSame(2, $r->json('data.zone'));
        $this->assertSame(0, DB::table('rab_runs')->count());       // a dry run stores nothing
        $this->assertNull(collect($r->json('data.lines'))->first(fn ($l) => $l['group'] === 'PBPD_53_197' && $l['category'] === 'ITEM' && $l['sequence'] === 20));   // the insurance-basis row is not an item

        $a = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $this->assertSame(1, $a->json('data.run_number'));
        $b = $this->as($this->admin)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $this->assertSame(2, $b->json('data.run_number'));
        $this->assertSame($a->json('data.snapshot_hash'), $b->json('data.snapshot_hash'));           // same inputs, same result
        $show = $this->as($this->teknik)->getJson('/api/rab-runs/'.$a->json('data.id'))->assertOk();
        $ins = collect($show->json('data.lines'))->first(fn ($l) => $l['category'] === 'INSURANCE' && $l['group'] === 'PBPD_53_197');
        $this->assertEquals(3000, $ins['insurance_cost']);
        $this->assertEquals(50000, $ins['insured_value']);
        $this->assertCount(2, $this->as($this->teknik)->getJson("/api/mto/{$p}/rab-runs")->assertOk()->json('data'));

        $this->assertDbRejects(fn () => DB::table('rab_runs')->update(['grand_total' => 1]));
        $this->assertDbRejects(fn () => DB::table('rab_run_lines')->delete());
    }

    #[Test]
    public function the_rab_needs_an_approved_package_a_price_book_a_zone_and_a_price_for_every_code_and_follows_the_scope(): void
    {
        [$p] = $this->filled();                                                                  // a package that is not APPROVED
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertStatus(409);
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertStatus(409)->assertJsonFragment(['message' => 'Belum ada buku harga yang disetujui dan berlaku pada '.now(config('distriva.business_timezone'))->toDateString().'.']);

        $this->priceBook([1 => ['PRICED', 1000, null, 100, 40], 2 => ['PLN', null, null, 200, 80]], false);     // no zone, codes 3 and 4 missing
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertStatus(409)->assertJsonFragment(['message' => 'Zona jasa UP3 ini belum ditetapkan pada buku harga "Kontrak uji".']);
        DB::statement('ALTER TABLE price_book_zones DISABLE TRIGGER trg_price_book_zones_guard');
        DB::table('price_book_zones')->insert(['id' => (string) Str::uuid(), 'price_book_id' => DB::table('price_books')->value('id'), 'up3_unit_id' => $this->ulpA->parent_id, 'zone' => 2, 'created_at' => now(), 'updated_at' => now()]);
        DB::statement('ALTER TABLE price_book_zones ENABLE TRIGGER trg_price_book_zones_guard');
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertStatus(409)->assertJsonFragment(['message' => '1 kode KHS pada MTO belum dapat dihargai oleh buku harga "Kontrak uji": 4 (tidak ada di buku harga).']);

        foreach ([$this->teknik, $this->retail, $this->vendor, $this->manager] as $u) {
            $this->as($u)->postJson("/api/mto/{$p}/rab-runs")->assertForbidden();               // only PERENCANAAN (and SYS_ADMIN) run
        }
        $this->as($this->vendor)->getJson("/api/mto/{$p}/rab-runs")->assertForbidden();
        $this->as($this->managerB)->getJson("/api/mto/{$p}/rab-runs")->assertNotFound();         // has rab.view, but not on this application's unit
    }

    /** An APPROVED parameter set and tariff book (R1 / 33000 VA, ULP-specific row) valid from 2025-01-01. */
    private function kkfSources(bool $params = true, bool $tariff = true, array $extraRows = []): void
    {
        if ($params) {
            DB::table('kkf_parameter_sets')->insert(['id' => (string) Str::uuid(), 'name' => 'Parameter uji', 'valid_from' => '2025-01-01', 'status' => 'APPROVED', 'discount_rate' => 0.0778, 'bpp' => 552, 'om_rate' => 0.02, 'load_factor' => 1,
                'roe' => 0.0047, 'interest_rate' => 0.0778, 'tax_rate' => 0.25, 'horizon_years' => 25, 'payback_limit_months' => 60, 'created_by' => $this->teknik->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        if ($tariff) {
            $book = (string) Str::uuid();
            DB::table('tariff_books')->insert(['id' => $book, 'name' => 'Tarif uji', 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'created_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            DB::table('tariff_book_rows')->insert(['id' => (string) Str::uuid(), 'tariff_book_id' => $book, 'ulp_unit_id' => null, 'tariff_code' => 'R1', 'power_va' => 33000, 'avg_price' => 1000, 'jam_nyala' => 100, 'ujl' => null, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('tariff_book_rows')->insert(['id' => (string) Str::uuid(), 'tariff_book_id' => $book, 'ulp_unit_id' => $this->ulpA->getKey(), 'tariff_code' => 'R1', 'power_va' => 33000, 'avg_price' => 1444.7, 'jam_nyala' => 117, 'ujl' => 165, 'created_at' => now(), 'updated_at' => now()]);
            foreach ($extraRows as $r) {
                DB::table('tariff_book_rows')->insert(['id' => (string) Str::uuid(), 'tariff_book_id' => $book, 'ulp_unit_id' => null, 'tariff_code' => 'R1', 'power_va' => $r['power_va'], 'avg_price' => $r['price'], 'jam_nyala' => $r['jam'], 'ujl' => null, 'created_at' => now(), 'updated_at' => now()]);
            }
            DB::table('tariff_books')->where('id', $book)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
        }
    }

    #[Test]
    public function a_kkf_run_takes_every_input_from_the_rab_the_parameter_set_and_the_tariff_book_and_is_stored_immutably_with_a_hash(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $rab = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R-1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => 12000, 'sar_package' => 'Prabayar (Prepaid) Satu Arah']);
        $url = "/api/applications/{$app}/kkf-runs";

        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1])->assertStatus(409);   // no parameter set / tariff book yet
        $this->kkfSources();
        $this->as($this->vendor)->postJson($url, [])->assertForbidden();
        $this->as($this->perencanaan)->postJson($url, ['esthetic_fee' => -1])->assertUnprocessable();
        $this->as($this->perencanaan)->postJson($url, ['load_factor' => 1.2, 'dry_run' => 1])->assertUnprocessable();   // load factor must be > 0 and <= 1
        $this->as($this->perencanaan)->postJson($url, ['load_factor' => 0, 'dry_run' => 1])->assertUnprocessable();
        $manual = $this->as($this->perencanaan)->postJson($url, ['load_factor' => 0.8, 'dry_run' => 1])->assertOk();   // the planner sets it for this run only
        $this->assertEquals(0.8, $manual->json('data.inputs.load_factor'));
        $this->assertSame('MANUAL', $manual->json('data.sources.load_factor_source'));
        $dry = $this->as($this->perencanaan)->postJson($url, ['esthetic_fee' => 500, 'dry_run' => 1])->assertOk()->assertJsonPath('stored', false);
        $this->assertSame(0, DB::table('kkf_runs')->count());
        $in = $dry->json('data.inputs');
        $this->assertEquals($rab->json('data.grand_total'), $in['investment']);
        $this->assertEquals(16.5, $in['power_kva']);
        $this->assertEquals(117, $in['jam_nyala']);                // the ULP's own row, not the all-ULP row (100)
        $this->assertEquals(1444.7, $in['avg_price']);
        $this->assertEquals(552, $in['bpp']);
        $this->assertEquals(0.0778, $in['discount_rate']);
        $this->assertSame('PARAMETER_SET', $dry->json('data.sources.load_factor_source'));   // not given -> the parameter set's value
        $this->assertNotEquals($manual->json('data.snapshot_hash'), $dry->json('data.snapshot_hash'));
        $expected = (new KkfCalculator)->calculate($in);
        $this->assertEquals($expected['npv'], $dry->json('data.result.npv'));
        $this->assertSame($expected['feasible'], $dry->json('data.feasible'));
        $this->assertSame(! $expected['feasible'], $dry->json('data.extended_required'));

        $run = $this->as($this->perencanaan)->postJson($url, ['esthetic_fee' => 500])->assertCreated()->assertJsonPath('stored', true)->assertJsonPath('data.run_number', 1);
        $this->assertSame($dry->json('data.snapshot_hash'), $run->json('data.snapshot_hash'));   // same snapshot -> same hash
        $second = $this->as($this->perencanaan)->postJson($url, ['esthetic_fee' => 600])->assertCreated()->assertJsonPath('data.run_number', 2);
        $this->assertNotSame($run->json('data.snapshot_hash'), $second->json('data.snapshot_hash'));
        $this->assertSame('001/'.now()->format('Ym').'/'.$this->ulpA->code, $run->json('data.document_number'));
        $this->assertSame('002/'.now()->format('Ym').'/'.$this->ulpA->code, $second->json('data.document_number'));   // the next stored run takes the next number
        $id = $run->json('data.id');
        $this->as($this->teknik)->getJson($url)->assertOk()->assertJsonCount(2, 'data');
        $this->as($this->teknik)->getJson("/api/kkf-runs/{$id}")->assertOk()->assertJsonPath('data.sources.tariff_row_ulp_specific', true)->assertJsonPath('data.inputs.connection_fee', 12000);
        $this->as($this->vendor)->getJson("/api/kkf-runs/{$id}")->assertForbidden();
        $this->as($this->managerB)->getJson("/api/kkf-runs/{$id}")->assertNotFound();               // another ULP
        try {
            DB::transaction(fn () => DB::table('kkf_runs')->where('id', $id)->update(['feasible' => false]));
            $this->fail('a stored KKF run must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    #[Test]
    public function a_kkf_run_refuses_missing_sources_and_incomplete_applications_instead_of_guessing(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $url = "/api/applications/{$app}/kkf-runs";
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => 12000, 'sar_package' => 'Prabayar (Prepaid) Satu Arah']);
        $this->kkfSources();
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1])->assertStatus(409);           // no RAB run yet
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1])->assertOk();
        DB::table('applications')->where('id', $app)->update(['new_power_value' => 34]);                                       // no tariff row for 34000 VA
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1])->assertStatus(409);
        DB::table('applications')->where('id', $app)->update(['new_power_value' => 33, 'delta_power_kva' => null]);
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1])->assertStatus(409);
        DB::table('applications')->where('id', $app)->update(['delta_power_kva' => 16.5]);
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1, 'date' => '2024-06-01'])->assertStatus(409);   // before any set/book is valid
        $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1, 'rab_run_id' => (string) Str::uuid()])->assertStatus(409);
    }

    #[Test]
    public function the_connection_fee_is_the_synced_total_cost_minus_the_ujl_only_for_a_postpaid_meter_read_from_paket_sar(): void
    {
        $this->appType = 'PD';
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $set = fn (array $v) => DB::table('applications')->where('id', $app)->update($v);
        $set(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => null, 'sar_package' => 'Prabayar (Prepaid) Satu Arah']);
        $this->kkfSources();
        $url = "/api/applications/{$app}/kkf-runs";
        $dry = fn (array $extra = []) => $this->as($this->perencanaan)->postJson($url, ['dry_run' => 1] + $extra);

        $dry()->assertStatus(409);                                                                           // no synced total cost
        $set(['total_cost' => 8000000]);
        $pre = $dry()->assertOk();
        $this->assertEquals(8000000, $pre->json('data.inputs.connection_fee'));                              // prepaid: no UJL deduction
        $this->assertSame('PRABAYAR', $pre->json('data.sources.meter_payment'));

        $set(['sar_package' => 'Pascabayar']);
        $dry()->assertStatus(409);                                                                           // PD to postpaid: the previous meter mode is needed
        $dry(['previous_meter_payment' => 'X'])->assertUnprocessable();
        $same = $dry(['previous_meter_payment' => 'PASCABAYAR'])->assertOk();                                // postpaid -> postpaid: delta 16.5 kVA
        $this->assertEquals(2722500, $same->json('data.sources.ujl_total'));                                 // 165 Rp/VA x 16.500 VA
        $this->assertEquals(5277500, $same->json('data.inputs.connection_fee'));
        $this->assertSame('DELTA', $same->json('data.sources.ujl_basis'));
        $zero = $dry(['previous_meter_payment' => 'PRABAYAR'])->assertOk();                                  // prepaid -> postpaid: from zero to 33 kVA
        $this->assertEquals(5445000, $zero->json('data.sources.ujl_total'));
        $this->assertEquals(2555000, $zero->json('data.inputs.connection_fee'));
        $this->assertSame('FROM_ZERO', $zero->json('data.sources.ujl_basis'));
        $set(['total_cost' => 2000000]);                                                                     // below the UJL
        $dry()->assertStatus(409);
        $set(['sar_package' => 'Paket lain', 'total_cost' => 8000000]);
        $dry()->assertStatus(409);                                                                           // PAKET_SAR not recognised: never guessed
        $set(['sar_package' => null]);
        $dry()->assertStatus(409);
    }

    #[Test]
    public function a_new_connection_to_a_postpaid_meter_counts_the_ujl_from_zero_to_the_new_power(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 33, 'total_cost' => 8000000, 'sar_package' => 'Pascabayar']);
        $this->kkfSources();
        $r = $this->as($this->perencanaan)->postJson("/api/applications/{$app}/kkf-runs", ['dry_run' => 1])->assertOk();
        $this->assertEquals(5445000, $r->json('data.sources.ujl_total'));                                  // 165 Rp/VA x 33.000 VA
        $this->assertEquals(2555000, $r->json('data.inputs.connection_fee'));
        $this->assertSame('NEW_CONNECTION', $r->json('data.sources.ujl_basis'));
    }

    #[Test]
    public function the_rab_counts_pln_mdu_material_at_its_mdu_value_next_to_vendor_material_and_services_and_warns_when_a_value_is_missing(): void
    {
        $p = $this->approvedPackageWithPbpd();
        // KHS 2 is PLN-supplied WITH an MDU value; KHS 3 and 4 are bought by the vendor; KHS 1 is priced
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, 200000, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $r = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs", ['dry_run' => 1])->assertOk();
        $lines = collect($r->json('data.lines'))->where('category', 'ITEM');
        $pln = $lines->where('material_status', 'PLN')->filter(fn ($l) => $l['qty_material'] > 0);
        $this->assertGreaterThan(0, $pln->count());
        foreach ($pln as $l) {
            $this->assertEquals($l['qty_material'] * 200000, $l['material_cost']);                              // PLN/MDU material is valued, no longer 0
            $this->assertEquals(200000, $l['material_price']);
        }
        $priced = $lines->where('material_status', 'PRICED')->sum('material_cost');
        $this->assertGreaterThan(0, $priced);
        foreach ($r->json('data.groups') as $g) {
            $plnShare = $g['material_pln'];
            $this->assertEquals($lines->where('group', array_search($g, $r->json('data.groups')))->where('material_status', 'PLN')->sum('material_cost'), $plnShare);
            $this->assertEqualsWithDelta($g['material'] + $g['service'] + $g['commissioning'] + $g['k3l'] + $g['insurance'], $g['subtotal'], 1e-6);   // material_pln is inside material, never added again
        }
        $this->assertEquals($pln->sum('material_cost') + $priced, collect($r->json('data.groups'))->sum('material'));
    }

    #[Test]
    public function a_pln_material_without_an_mdu_value_is_counted_zero_and_reported_never_silently(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $w = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs", ['dry_run' => 1])->assertOk();
        $this->assertContains('NO_PLN_VALUE', collect($w->json('data.warnings'))->pluck('code')->all());
        $this->assertEquals(0, collect($w->json('data.groups'))->sum('material_pln'));
    }

    #[Test]
    public function the_kkf_preview_shows_the_connection_fee_after_the_ujl_and_what_still_blocks_the_run(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $set = fn (array $v) => DB::table('applications')->where('id', $app)->update($v);
        $set(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 33, 'total_cost' => 8000000, 'sar_package' => 'Pascabayar']);
        $this->kkfSources();
        $url = "/api/applications/{$app}/kkf-preview";

        $this->as($this->vendor)->getJson($url)->assertForbidden();
        $pre = $this->as($this->perencanaan)->getJson($url)->assertOk()->json('data');
        $this->assertEquals([8000000.0, 5445000.0, 2555000.0], [$pre['total_cost'], $pre['ujl_total'], $pre['connection_fee']]);   // postpaid: the BP is the EIS total minus the UJL
        $this->assertSame(['PASCABAYAR', 'NEW_CONNECTION'], [$pre['meter_mode'], $pre['ujl_basis']]);
        $this->assertFalse($pre['ready']);                                                                    // an approved MTO but no RAB run yet
        $this->assertStringContainsString('Jalankan RAB', implode(' ', $pre['blockers']));
        $this->assertSame('APPROVED', $pre['mto_package']['status']);

        $set(['sar_package' => 'Prabayar (Prepaid) Satu Arah']);
        $this->assertEquals(8000000.0, $this->as($this->perencanaan)->getJson($url)->json('data.connection_fee'));   // prepaid: no deduction
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $ready = $this->as($this->perencanaan)->getJson($url)->json('data');
        $this->assertTrue($ready['ready']);
        $this->assertSame([], $ready['blockers']);
        $this->assertSame(1, $ready['rab_run']['run_number']);
    }

    #[Test]
    public function the_kkf_preview_of_a_power_change_to_a_postpaid_meter_asks_for_the_previous_meter_mode(): void
    {
        $this->appType = 'PD';
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => 8000000, 'sar_package' => 'Pascabayar']);
        $this->kkfSources();
        $url = "/api/applications/{$app}/kkf-preview";
        $need = $this->as($this->perencanaan)->getJson($url)->assertOk()->json('data');
        $this->assertTrue($need['needs_previous_meter']);                                                     // the UJL basis depends on the previous meter
        $this->assertNull($need['connection_fee']);
        $this->assertEquals(5277500.0, $this->as($this->perencanaan)->getJson($url.'?previous_meter_payment=PASCABAYAR')->json('data.connection_fee'));   // delta 16.5 kVA x 165
        $this->assertEquals(2555000.0, $this->as($this->perencanaan)->getJson($url.'?previous_meter_payment=PRABAYAR')->json('data.connection_fee'));    // from zero to 33 kVA
        $this->as($this->perencanaan)->getJson($url.'?previous_meter_payment=X')->assertUnprocessable();
    }

    #[Test]
    public function the_output_documents_are_built_from_the_stored_runs_with_the_real_signers_volumes_and_terbilang(): void
    {
        config(['distriva.document.rekap_rows.PBPD_53_197.volume_rows' => [8]]);                            // the test BOM keeps its volume row at 8
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $rab = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $runId = $rab->json('data.id');
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => 12000, 'sar_package' => 'Prabayar (Prepaid) Satu Arah', 'service_address' => 'JL UJI NO. 1']);
        $this->kkfSources();
        $kkfId = $this->as($this->perencanaan)->postJson("/api/applications/{$app}/kkf-runs", ['esthetic_fee' => 500])->assertCreated()->json('data.id');

        $rekap = $this->as($this->teknik)->getJson("/api/rab-runs/{$runId}/documents/rekap")->assertOk()->json('data');
        $this->assertSame('RAB PERMOHONAN PB/PD', $rekap['title']);
        $this->assertCount(10, $rekap['sections'][0]['rows']);                                              // every REKAP row in workbook order
        $row = collect($rekap['sections'][0]['rows'])->firstWhere(1, 'Pemasangan APP Pengukuran Tak Langsung (53 s/d 197 kVA)');
        $this->assertEquals(5, $row[3]);                                                                    // volume = H of BOM row 10 (workbook 53-197!H10)
        $this->assertEquals($rab->json('data.groups.PBPD_53_197.total'), $row[11]);
        $this->assertEquals($rab->json('data.grand_total'), $rekap['grand_total']);
        $this->assertEquals($rab->json('data.grand_total'), $rekap['sections'][0]['footer'][11]);
        $this->assertSame(Terbilang::rupiah($rab->json('data.grand_total')), $rekap['terbilang']);
        $this->assertSame('tujuh puluh tujuh ribu empat ratus rupiah', $rekap['terbilang']);
        $this->assertSame($this->manager->name, $rekap['signatures'][0]['name']);                           // MANAGER ULP = who approved the MTO
        $this->assertSame($this->teknik->name, $rekap['signatures'][1]['name']);                            // SPV TEKNIK = who verified it
        $this->assertStringStartsWith(mb_convert_case(trim(preg_replace('/^ULP\s+/i', '', $this->ulpA->name)), MB_CASE_TITLE).', ', $rekap['place_date']);
        $this->assertSame($rab->json('data.snapshot_hash'), $rekap['source']['snapshot_hash']);

        $rinci = $this->as($this->teknik)->getJson("/api/rab-runs/{$runId}/documents/rinci")->assertOk()->json('data');
        $this->assertSame(count($rab->json('data.lines')), array_sum(array_map(fn ($s) => count($s['rows']), $rinci['sections'])));

        $kkf = $this->as($this->teknik)->getJson("/api/kkf-runs/{$kkfId}/documents/kkf")->assertOk()->json('data');
        $titles = array_column($kkf['sections'], 'heading');
        $this->assertContains('4. DATA PERHITUNGAN', $titles);
        $this->assertSame(26, count(collect($kkf['sections'])->firstWhere('heading', 'ARUS KAS (Rp)')['rows']));      // years 0..25
        $this->assertContains($kkf['conclusion'], ['LAYAK', 'TIDAK LAYAK']);
        $this->assertMatchesRegularExpression('#^001/'.now()->format('Ym').'/'.preg_quote($this->ulpA->code, '#').'$#', $kkf['document_number']);   // sequence/yyyymm/unit code
        $hpe = $this->as($this->teknik)->getJson("/api/kkf-runs/{$kkfId}/documents/hpe")->assertOk()->json('data');
        $line = $hpe['sections'][0]['rows'][0];
        $this->assertEquals(12000, $line[4]);                                                               // BP
        $this->assertEquals($rab->json('data.grand_total'), $line[5]);                                      // RAB
        $this->assertEqualsWithDelta(12000 / $rab->json('data.grand_total'), $line[6], 1e-9);

        $file = $this->as($this->teknik)->get("/api/rab-runs/{$runId}/documents/rekap?format=xlsx");
        $file->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $tmp = tempnam(sys_get_temp_dir(), 'rekap').'.xlsx';
        file_put_contents($tmp, $file->getContent());
        $sheet = IOFactory::load($tmp)->getActiveSheet();
        @unlink($tmp);
        $this->assertContains('JUMLAH', array_column($sheet->toArray(), 1));
        $this->assertContains('Tujuh puluh tujuh ribu empat ratus rupiah', array_column($sheet->toArray(), 2));

        $pdf = $this->as($this->teknik)->get("/api/rab-runs/{$runId}/documents/rekap?format=pdf");
        $pdf->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringStartsWith('%PDF', $pdf->getContent());
        $this->as($this->teknik)->getJson("/api/rab-runs/{$runId}/documents/xyz")->assertNotFound();
        $this->as($this->teknik)->getJson("/api/rab-runs/{$runId}/documents/rekap?format=docx")->assertStatus(422);
        $this->as($this->vendor)->getJson("/api/rab-runs/{$runId}/documents/rekap")->assertForbidden();
        $this->as($this->managerB)->getJson("/api/kkf-runs/{$kkfId}/documents/kkf")->assertNotFound();      // another ULP
    }

    #[Test]
    public function a_kontrak_rinci_with_pole_lines_adds_pole_stock_and_plotting_draws_it_down_until_the_erp_stock_carries_it(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $url = "/api/applications/{$app}/allocations";
        $tm = (string) DB::table('mto_lines')->where('package_id', $p)->where('material', '>', 0)->orderBy('khs_code')->value('khs_item_id');
        $tr = (string) DB::table('khs_items')->where('id', '<>', $tm)->orderBy('code')->value('id');
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD-UP3', 'name' => 'Gudang UP3', 'organizational_unit_id' => $this->ulpA->parent_id, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);

        $mk = ['kr_number' => 'KR-LINES', 'lines' => [['khs_item_id' => $tm, 'pole_type' => 'TM', 'quantity' => 6], ['khs_item_id' => $tr, 'pole_type' => 'TR', 'quantity' => 3]]];
        $this->as($konstruksi)->postJson('/api/master-data/pole-contracts', $mk)->assertForbidden();
        $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-BAD', 'lines' => [['khs_item_id' => $tm, 'pole_type' => 'TM', 'quantity' => 1], ['khs_item_id' => $tm, 'pole_type' => 'TM', 'quantity' => 1]]])->assertStatus(409);   // same material twice
        $kr = $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', $mk)->assertCreated()->json('data.id');
        $row = $this->as($this->perencanaan)->getJson("/api/master-data/pole-contracts/{$kr}")->assertOk()->json('data');
        $this->assertSame([6, 3], [$row['tm']['total'], $row['tr']['total']]);                              // totals are the sums of the lines
        $this->assertCount(2, $row['lines']);
        $stock = fn () => collect($this->as($this->perencanaan)->getJson('/api/master-data/stock-position?warehouse_ids[]='.$wh)->assertOk()->json('data'));
        $codeTm = (string) DB::table('khs_items')->where('id', $tm)->value('code');
        $this->assertEquals(6.0, $stock()->firstWhere('khs_code', $codeTm)['kr_supply']);                    // the KR adds the poles as supply

        $id = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');
        $put = fn (array $po) => $this->as($this->perencanaan)->putJson("/api/allocations/{$id}/poles", ['poles' => $po]);
        $put([['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 1]])->assertStatus(409);       // a KR with lines needs the pole material
        $put([['pole_contract_id' => $kr, 'pole_type' => 'TR', 'quantity' => 1, 'khs_item_id' => $tm]])->assertStatus(409);   // wrong type for that material
        $put([['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 7, 'khs_item_id' => $tm]])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$id}/confirm", ['part' => 'poles'])->assertStatus(409);   // 7 > 6
        $put([['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 4, 'khs_item_id' => $tm, 'warehouse_id' => $wh]])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$id}/confirm", ['part' => 'poles'])->assertOk();

        $shown = $this->as($this->perencanaan)->getJson("/api/allocations/{$id}")->assertOk()->json('data');
        $this->assertSame([$tm, 'GD-UP3'], [$shown['poles'][0]['khs_item_id'], $shown['poles'][0]['warehouse_code']]);
        $line = collect($this->as($this->perencanaan)->getJson("/api/master-data/pole-contracts/{$kr}")->json('data.lines'))->firstWhere('khs_item_id', $tm);
        $this->assertSame([6, 4, 2, false], [$line['total'], $line['allocated'], $line['remaining'], $line['in_erp_stock']]);   // plotting draws the KR line down
        $this->assertEquals(2.0, $stock()->firstWhere('khs_code', $codeTm)['kr_supply']);
        $this->as($this->perencanaan)->putJson("/api/master-data/pole-contracts/{$kr}", ['reason' => 'Koreksi', 'lines' => [['khs_item_id' => $tm, 'pole_type' => 'TM', 'quantity' => 3], ['khs_item_id' => $tr, 'pole_type' => 'TR', 'quantity' => 3]]])->assertStatus(409);   // below the 4 plotted
        $this->as($this->perencanaan)->putJson("/api/master-data/pole-contracts/{$kr}", ['reason' => 'Addendum', 'lines' => [['khs_item_id' => $tm, 'pole_type' => 'TM', 'quantity' => 9], ['khs_item_id' => $tr, 'pole_type' => 'TR', 'quantity' => 3]]])->assertOk();
        $this->assertEquals(5.0, $stock()->firstWhere('khs_code', $codeTm)['kr_supply']);

        // once an ERP snapshot dated after the KR holds the material, the ERP position is the truth: the KR is no longer extra supply (no double counting)
        $snap = (string) Str::uuid();
        DB::table('stock_snapshots')->insert(['id' => $snap, 'warehouse_id' => $wh, 'as_of' => now(config('distriva.business_timezone'))->addDay()->toDateString(), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now()]);
        DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => $tm, 'on_hand' => 50]);
        $line = collect($this->as($this->perencanaan)->getJson("/api/master-data/pole-contracts/{$kr}")->json('data.lines'))->firstWhere('khs_item_id', $tm);
        $this->assertTrue($line['in_erp_stock']);
        $this->assertEquals(0.0, collect($this->as($this->perencanaan)->getJson('/api/master-data/stock-position?warehouse_ids[]='.$wh.'&date='.now(config('distriva.business_timezone'))->addDay()->toDateString())->json('data'))->firstWhere('khs_code', $codeTm)['kr_supply']);
    }

    #[Test]
    public function material_suggestions_fill_full_where_stock_covers_else_zero_and_only_sr_app_one_phase_chooses_its_source(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $url = "/api/applications/{$app}/allocations";
        $lines = DB::table('mto_lines')->where('package_id', $p)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")->orderBy('khs_code')->get()->unique('khs_item_id')->values()->take(3);   // distinct materials
        $this->assertCount(3, $lines);
        [$a, $b, $c] = [$lines[0], $lines[1], $lines[2]];
        // a fourth material that the vendor supplies: add one frozen-MTO line for an item that is not in the package yet
        $other = (object) ['id' => (string) Str::uuid(), 'code' => 'VND-TEST', 'name' => 'Material vendor uji'];
        DB::table('khs_items')->insert(['id' => $other->id, 'code' => $other->code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::unprepared('ALTER TABLE mto_lines DISABLE TRIGGER USER');
        DB::table('mto_lines')->insert(['id' => (string) Str::uuid(), 'package_id' => $p, 'group_code' => $a->group_code, 'bom_header_id' => $a->bom_header_id, 'sequence' => 9100, 'khs_item_id' => $other->id, 'khs_code' => $other->code, 'khs_name' => $other->name, 'unit_text' => 'bh', 'material' => 4, 'install' => 0, 'remove' => 0, 'return' => 0]);
        DB::unprepared('ALTER TABLE mto_lines ENABLE TRIGGER USER');
        $d = (object) ['khs_item_id' => $other->id, 'khs_code' => $other->code];
        $mkWh = function (string $code, string $unit): string {
            $id = (string) Str::uuid();
            DB::table('warehouses')->insert(['id' => $id, 'code' => $code, 'name' => $code, 'organizational_unit_id' => $unit, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

            return $id;
        };
        $ulp = $mkWh('GD-ULP', $this->ulpA->id);
        $up3 = $mkWh('GD-UP3', $this->ulpA->parent_id);
        $stock = function (string $wh, array $lines) {
            DB::table('stock_snapshots')->insert(['id' => $snap = (string) Str::uuid(), 'warehouse_id' => $wh, 'as_of' => now()->subDay()->toDateString(), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now()]);
            foreach ($lines as $khs => $qty) {
                DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => $khs, 'on_hand' => $qty]);
            }
        };
        $needOf = fn ($l) => (float) DB::table('mto_lines')->where('package_id', $p)->where('khs_item_id', $l->khs_item_id)->sum('material');
        $stock($ulp, [$a->khs_item_id => $needOf($a), $c->khs_item_id => $needOf($c) - 0.5]);                // A covered at the ULP; C short at the ULP
        $stock($up3, [$b->khs_item_id => $needOf($b) + 3]);                                                   // B only at the UP3

        // who supplies: PLN material comes from a warehouse, material priced in the RAB is the vendor's (SPK)
        $this->priceBook([(string) $a->khs_code => ['PLN', null, 10, 1, 1], (string) $b->khs_code => ['PLN', null, 10, 1, 1], (string) $c->khs_code => ['PLN', null, 10, 1, 1], (string) $d->khs_code => ['PRICED', 5, null, 1, 1]]);

        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $id = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');

        $rows = collect($this->as($konstruksi)->getJson("/api/allocations/{$id}/material-suggestions")->assertOk()->json('data.rows'))->keyBy('khs_code');
        $this->assertEquals($needOf($a), $rows[$a->khs_code]['suggestion']['quantity']);
        $this->assertSame($ulp, $rows[$a->khs_code]['suggestion']['warehouse_id']);                          // ULP first, full
        $this->assertEquals($needOf($b), $rows[$b->khs_code]['suggestion']['quantity']);
        $this->assertSame($up3, $rows[$b->khs_code]['suggestion']['warehouse_id']);                          // not at the ULP -> the UP3 covers it
        $this->assertEquals(0.0, $rows[$c->khs_code]['suggestion']['quantity']);                             // short everywhere -> zero, never partial
        $this->assertFalse($rows[$c->khs_code]['suggestion']['covered']);
        $this->assertFalse($rows[$a->khs_code]['source_choice']);
        $this->assertSame('PLN', $rows[$a->khs_code]['supplier']);
        $this->assertSame('VENDOR', $rows[$d->khs_code]['supplier']);                                         // priced in the RAB = the vendor supplies it
        $this->assertNull($rows[$d->khs_code]['suggestion']);                                                 // nothing to take from a warehouse
        $this->assertSame([], $rows[$d->khs_code]['candidates']);
        $this->as($konstruksi)->putJson("/api/allocations/{$id}/materials", ['materials' => [['khs_code' => (string) $d->khs_code, 'warehouse_id' => $ulp, 'quantity' => 1]]])->assertStatus(409);
        $this->assertCount(2, $rows[$a->khs_code]['candidates']);                                             // the ULP and the UP3 warehouse

        DB::unprepared('ALTER TABLE mto_lines DISABLE TRIGGER USER');   // frozen lines: relabel one group only to exercise the SR APP rule
        DB::table('mto_lines')->where('id', $a->id)->update(['group_code' => 'SR1PH', 'sequence' => 9000]);
        DB::unprepared('ALTER TABLE mto_lines ENABLE TRIGGER USER');
        $again = collect($this->as($konstruksi)->getJson("/api/allocations/{$id}/material-suggestions")->json('data.rows'))->keyBy('khs_code');
        $this->assertTrue($again[$a->khs_code]['source_choice']);                                             // SR APP 1 phase: the user picks UP3 or ULP
        $this->assertFalse($again[$b->khs_code]['source_choice']);

        // a zero row means "not allocated": accepted, nothing stored
        $this->as($konstruksi)->putJson("/api/allocations/{$id}/materials", ['materials' => [['khs_code' => (string) $c->khs_code, 'warehouse_id' => $ulp, 'quantity' => 0], ['khs_code' => (string) $a->khs_code, 'warehouse_id' => $ulp, 'quantity' => $needOf($a)]]])->assertOk();
        $this->assertSame(1, DB::table('allocation_lines')->where('allocation_id', $id)->count());
        $left = collect($this->as($konstruksi)->getJson("/api/allocations/{$id}/material-suggestions")->json('data.rows'))->keyBy('khs_code');
        $this->assertEquals(0.0, $left[$a->khs_code]['remaining']);                                           // what is already allocated is not suggested again
    }

    #[Test]
    public function rab_and_kkf_are_frozen_once_the_drawing_and_mto_are_approved_in_full(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $pkg = DB::table('mto_packages')->where('id', $p)->first();
        $this->as($this->perencanaan)->getJson("/api/mto/{$p}/rab-runs")->assertOk();
        $dv = fn (array $set) => DB::table('application_drawing_versions')->where('id', $pkg->drawing_version_id)->update($set);   // the database guards the status and stage path
        $dv(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER']);
        $dv(['status' => 'UNDER_REVIEW', 'stage' => 'UP3_REVIEW']);
        $dv(['stage' => 'ASMAN']);
        $dv(['status' => 'APPROVED', 'stage' => null]);

        $r = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs", []);
        $r->assertStatus(409);
        $this->assertStringContainsString('dikunci', (string) $r->json('message'));
        $k = $this->as($this->perencanaan)->postJson("/api/applications/{$pkg->application_id}/kkf-runs", []);
        $this->assertContains($k->getStatusCode(), [409, 422]);
    }

    #[Test]
    public function an_allocation_has_a_materials_part_by_konstruksi_and_a_poles_part_by_perencanaan_each_checked_when_confirmed(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $url = "/api/applications/{$app}/allocations";
        $line = DB::table('mto_lines')->where('package_id', $p)->where('material', '>', 0)->orderBy('khs_code')->first();
        $need = (float) DB::table('mto_lines')->where('package_id', $p)->where('khs_item_id', $line->khs_item_id)->sum('material');
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD-UP3', 'name' => 'Gudang UP3', 'organizational_unit_id' => $this->ulpA->parent_id, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $kr = (string) Str::uuid();
        DB::table('pole_contracts')->insert(['id' => $kr, 'kr_number' => 'KR-001', 'qty_tm' => 10, 'qty_tr' => 5, 'status' => 'ACTIVE', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);

        $this->as($this->vendor)->postJson($url, [])->assertForbidden();
        $this->as($this->retail)->postJson($url, [])->assertForbidden();
        $this->as($this->managerB)->postJson($url, [])->assertForbidden();                                  // another unit
        $id = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');                 // UP3 roles act on the child ULP application
        $this->as($this->perencanaan)->postJson($url, [])->assertStatus(409);                                // Perencanaan may open one too (authorized; one is already running) but only fills the poles part
        $this->as($konstruksi)->postJson($url, [])->assertStatus(409);                                      // one running allocation per application

        $mats = fn (array $m, ?User $by = null) => $this->as($by ?? $konstruksi)->putJson("/api/allocations/{$id}/materials", ['materials' => $m]);
        $poles = fn (array $po, ?User $by = null) => $this->as($by ?? $this->perencanaan)->putJson("/api/allocations/{$id}/poles", ['poles' => $po]);
        $mats([], $this->perencanaan)->assertForbidden();                                                   // poles are Perencanaan's, materials are Konstruksi's
        $poles([], $konstruksi)->assertForbidden();
        $mats([['khs_code' => '99999', 'warehouse_id' => $wh, 'quantity' => 1]])->assertStatus(409);        // not in the approved MTO
        $mats([['khs_code' => (string) $line->khs_code, 'warehouse_id' => $wh, 'quantity' => $need + 1]])->assertStatus(409);   // above the MTO need
        $poles([['pole_contract_id' => $kr, 'pole_type' => 'XX', 'quantity' => 1]])->assertUnprocessable();
        $mats([['khs_code' => (string) $line->khs_code, 'warehouse_id' => $wh, 'quantity' => $need]])->assertOk();
        $this->as($konstruksi)->postJson("/api/allocations/{$id}/confirm", ['part' => 'materials'])->assertStatus(409);   // no stock yet
        $this->as($konstruksi)->postJson("/api/allocations/{$id}/confirm", ['part' => 'poles'])->assertForbidden();       // only Perencanaan confirms the poles part

        DB::table('stock_snapshots')->insert(['id' => $snap = (string) Str::uuid(), 'warehouse_id' => $wh, 'as_of' => now()->subDay()->toDateString(), 'created_by' => $konstruksi->getKey(), 'created_at' => now()]);
        DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => $line->khs_item_id, 'on_hand' => $need + 5, 'reserved' => 1, 'incoming_confirmed' => 0, 'safety_stock' => 0]);
        $this->as($konstruksi)->postJson("/api/allocations/{$id}/confirm", ['part' => 'materials'])->assertOk();
        $this->assertSame('DRAFT', DB::table('allocations')->where('id', $id)->value('status'));              // the poles part is still open
        $this->assertTrue(DB::table('user_notifications')->where('user_id', $this->perencanaan->getKey())->where('title', 'like', '%menunggu konfirmasi tiang%')->exists());   // the other half is asked
        $pos = $this->as($konstruksi)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}")->assertOk()->json('data.0');
        $this->assertEquals($need, $pos['allocated_after']);                                                // a confirmed materials part reserves stock at once
        $mats([])->assertStatus(409);                                                                       // the confirmed part is frozen
        try {
            DB::transaction(fn () => DB::table('allocation_lines')->where('allocation_id', $id)->update(['quantity' => 1]));
            $this->fail('the lines of a confirmed part must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $poles([['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 11]])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$id}/confirm", ['part' => 'poles'])->assertStatus(409);   // 11 > the 10 TM poles of the KR
        $poles([['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 4], ['pole_contract_id' => $kr, 'pole_type' => 'TR', 'quantity' => 2]])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$id}/confirm", ['part' => 'poles'])->assertOk();
        $this->assertSame('CONFIRMED', DB::table('allocations')->where('id', $id)->value('status'));          // both parts confirmed
        $this->assertTrue(DB::table('user_notifications')->where('user_id', $konstruksi->getKey())->where('title', 'like', '%Alokasi permohonan%lengkap%')->exists());   // the WO team may start
        $this->assertTrue(DB::table('user_notifications')->where('user_id', $this->perencanaan->getKey())->where('title', 'like', '%alokasi dapat dibuat%')->exists());   // the approved MTO started it

        $shown = $this->as($this->teknik)->getJson("/api/allocations/{$id}")->assertOk()->json('data');
        $this->assertSame('KR-001', $shown['poles'][0]['kr_number']);                                       // the pole allocation carries the KR number
        $this->assertNotNull($shown['materials_confirmed_at']);
        $this->assertNotNull($shown['poles_confirmed_at']);
        $this->as($this->managerB)->getJson("/api/allocations/{$id}")->assertNotFound();
        $krs = $this->as($this->perencanaan)->getJson('/api/master-data/pole-contracts')->assertOk()->json('data');
        $this->assertSame(6, $krs[0]['tm']['remaining']);
        $this->assertSame(3, $krs[0]['tr']['remaining']);
        $pos = $this->as($konstruksi)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}")->json('data.0');
        $this->assertEquals($need + 5 - 1 - $need, $pos['available']);

        $addition = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');   // a confirmed allocation does not block a top-up (alokasi tambahan)
        $this->as($konstruksi)->postJson($url, [])->assertStatus(409);                              // ...but only one draft at a time
        $this->as($this->teknik)->postJson("/api/allocations/{$id}/cancel", ['reason' => 'x'])->assertForbidden();
        $this->as($konstruksi)->postJson("/api/allocations/{$id}/cancel", ['reason' => 'Gambar berubah'])->assertOk();
        $krs = $this->as($this->perencanaan)->getJson('/api/master-data/pole-contracts')->json('data');
        $this->assertSame(10, $krs[0]['tm']['remaining']);                                                  // cancelling returns the poles
        $v2 = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');                 // the materials role opens the next version
        $this->assertSame('CANCELLED', DB::table('allocations')->where('id', $addition)->value('status'));   // cancelling the base takes its top-up with it
        $this->assertSame(3, (int) DB::table('allocations')->where('id', $v2)->value('version_number'));
    }

    #[Test]
    public function material_arriving_later_is_allocated_as_a_top_up_beside_the_confirmed_base_allocation(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $url = "/api/applications/{$app}/allocations";
        $line = DB::table('mto_lines')->where('package_id', $p)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")->orderBy('khs_code')->first();
        $need = (float) DB::table('mto_lines')->where('package_id', $p)->where('khs_item_id', $line->khs_item_id)->sum('material');
        $half = $need / 2;
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD-UP3', 'name' => 'Gudang UP3', 'organizational_unit_id' => $this->ulpA->parent_id, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('stock_snapshots')->insert(['id' => $snap = (string) Str::uuid(), 'warehouse_id' => $wh, 'as_of' => now()->subDay()->toDateString(), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now()]);
        DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => $line->khs_item_id, 'on_hand' => $need + 5, 'reserved' => 0, 'incoming_confirmed' => 0, 'safety_stock' => 0]);
        $kr = (string) Str::uuid();
        DB::table('pole_contracts')->insert(['id' => $kr, 'kr_number' => 'KR-TOP', 'qty_tm' => 10, 'qty_tr' => 5, 'status' => 'ACTIVE', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);

        $base = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/allocations/{$base}/materials", ['materials' => [['khs_code' => (string) $line->khs_code, 'warehouse_id' => $wh, 'quantity' => $half]]])->assertOk();
        $this->as($this->perencanaan)->putJson("/api/allocations/{$base}/poles", ['poles' => [['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 1]]])->assertOk();
        $this->as($konstruksi)->postJson("/api/allocations/{$base}/confirm", ['part' => 'materials'])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$base}/confirm", ['part' => 'poles'])->assertOk();
        $this->assertSame('CONFIRMED', DB::table('allocations')->where('id', $base)->value('status'));

        // the rest arrives: a top-up is opened without cancelling the base
        $add = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');
        $this->assertSame($base, DB::table('allocations')->where('id', $add)->value('parent_allocation_id'));
        $this->assertSame('CONFIRMED', DB::table('allocations')->where('id', $base)->value('status'));
        $this->as($konstruksi)->postJson($url, [])->assertStatus(409);                                      // one running top-up at a time
        $this->assertTrue($this->as($this->teknik)->getJson("/api/allocations/{$add}")->assertOk()->json('data.is_addition'));
        $row = collect($this->as($konstruksi)->getJson("/api/allocations/{$add}/material-suggestions")->assertOk()->json('data.rows'))->firstWhere('khs_code', (string) $line->khs_code);
        $this->assertEquals($half, $row['allocated']);                                                      // the base counts as already allocated
        $this->assertEquals($half, $row['remaining']);
        $this->as($konstruksi)->putJson("/api/allocations/{$add}/materials", ['materials' => [['khs_code' => (string) $line->khs_code, 'warehouse_id' => $wh, 'quantity' => $half + 1]]])->assertStatus(409);   // above what is left of the need
        $this->as($konstruksi)->putJson("/api/allocations/{$add}/materials", ['materials' => [['khs_code' => (string) $line->khs_code, 'warehouse_id' => $wh, 'quantity' => $half]]])->assertOk();
        $this->as($konstruksi)->postJson("/api/allocations/{$add}/confirm", ['part' => 'materials'])->assertOk();
        $this->as($this->perencanaan)->postJson("/api/allocations/{$add}/confirm", ['part' => 'poles'])->assertOk();   // no extra poles needed
        $this->assertSame('CONFIRMED', DB::table('allocations')->where('id', $add)->value('status'));
        $pos = $this->as($konstruksi)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}")->assertOk()->json('data.0');
        $this->assertEquals($need, $pos['allocated_after']);                                                // base + top-up both reserve stock

        // cancelling the base takes its top-ups with it, then a fresh base can start
        $this->as($konstruksi)->postJson("/api/allocations/{$base}/cancel", ['reason' => 'Gambar berubah'])->assertOk();
        $this->assertSame('CANCELLED', DB::table('allocations')->where('id', $add)->value('status'));
        $fresh = $this->as($konstruksi)->postJson($url, [])->assertCreated()->json('data.id');
        $this->assertNull(DB::table('allocations')->where('id', $fresh)->value('parent_allocation_id'));
    }

    #[Test]
    public function a_vendor_company_carries_a_full_profile_that_can_be_created_and_edited_by_the_managers_only(): void
    {
        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $profile = ['npwp' => '01.234.567.8-901.000', 'address' => 'Jl. Merdeka 1', 'city' => 'Malang', 'phone' => '0341-123456', 'email' => 'info@abc.co.id', 'pic_name' => 'Budi', 'pic_phone' => '0812345678',
            'sbu_number' => 'SBU-77', 'sbu_valid_until' => '2027-12-31', 'contract_number' => 'SPK-1', 'contract_valid_from' => '2026-01-01', 'contract_valid_until' => '2026-12-31', 'bank_name' => 'BNI', 'bank_account_number' => '123', 'notes' => ' ', 'website' => ''];
        $this->as($this->vendor)->postJson('/api/master-data/vendors', ['code' => 'PT-ABC', 'name' => 'PT ABC'] + $profile)->assertForbidden();
        $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-X', 'name' => 'PT X', 'npwp' => '123'])->assertUnprocessable();                       // NPWP must be 15/16 digits
        $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-X', 'name' => 'PT X', 'email' => 'bukan-email'])->assertUnprocessable();
        $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-X', 'name' => 'PT X', 'contract_valid_from' => '2026-05-01', 'contract_valid_until' => '2026-01-01'])->assertUnprocessable();
        $withAccount = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'pt-akun', 'name' => 'PT Akun', 'account' => ['name' => 'Admin PT Akun', 'email' => 'Admin@PT-Akun.test', 'phone' => '081234567890']])->assertCreated()->json('data');
        $this->assertSame('PENDING_ACTIVATION', $withAccount['account']['account_status']);                       // the invitation lets the administration person activate the account
        $acc = User::query()->where('email', 'admin@pt-akun.test')->firstOrFail();
        $this->assertTrue(DB::table('user_role_assignments as a')->join('roles as r', 'r.id', '=', 'a.role_id')->where('a.user_id', $acc->getKey())->where('r.name', 'VENDOR')->where('a.is_active', true)->exists());
        $this->assertSame($withAccount['id'], DB::table('vendor_accounts')->where('user_id', $acc->getKey())->value('vendor_company_id'));   // linked at creation
        $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-DUP', 'name' => 'PT Dup', 'account' => ['name' => 'Dup', 'email' => 'admin@pt-akun.test']])->assertUnprocessable();   // email already used: nothing is created
        $this->assertDatabaseMissing('vendor_companies', ['code' => 'PT-DUP']);
        $plain = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-LATE', 'name' => 'PT Late'])->assertCreated()->json('data.id');
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$plain}/accounts", ['account' => ['name' => 'Admin Late', 'email' => 'admin@pt-akun.test']])->assertUnprocessable();   // email already used
        $late = $this->as($konstruksi)->postJson("/api/master-data/vendors/{$plain}/accounts", ['account' => ['name' => 'Admin Late', 'email' => 'Late@PT.test']])->assertCreated()->json('data');   // an account added to an existing vendor
        $this->assertSame('PENDING_ACTIVATION', $late['account_status']);
        $this->assertSame($plain, DB::table('vendor_accounts')->where('user_id', $late['user_id'])->value('vendor_company_id'));
        $this->as($this->vendor)->postJson("/api/master-data/vendors/{$plain}/accounts", ['account' => ['name' => 'X', 'email' => 'x@pt.test']])->assertForbidden();
        $id = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'pt-abc', 'name' => 'PT ABC'] + $profile)->assertCreated()->json('data.id');
        $row = collect($this->as($konstruksi)->getJson('/api/master-data/vendors')->assertOk()->json('data'))->firstWhere('id', $id);
        $this->assertSame('Malang', $row['profile']['city']);
        $this->assertSame('SPK-1', $row['profile']['contract_number']);
        $this->assertNull($row['profile']['notes']);                                                          // blank strings are stored as null
        $this->assertNull($row['profile']['website']);

        $this->as($this->vendor)->putJson("/api/master-data/vendors/{$id}", ['name' => 'PT ABC Baru'])->assertForbidden();
        $this->as($konstruksi)->putJson("/api/master-data/vendors/{$id}", ['name' => 'PT ABC Baru', 'city' => 'Surabaya', 'pic_name' => 'Sari'])->assertOk();
        $row = collect($this->as($konstruksi)->getJson('/api/master-data/vendors')->json('data'))->firstWhere('id', $id);
        $this->assertSame('PT ABC Baru', $row['name']);
        $this->assertSame('Surabaya', $row['profile']['city']);
        $this->assertSame('PT-ABC', $row['code']);                                                            // the code never changes
        $this->assertSame('Jl. Merdeka 1', $row['profile']['address']);                                       // a field not sent is left alone
        $this->as($konstruksi)->putJson('/api/master-data/vendors/'.Str::uuid(), ['name' => 'x'])->assertNotFound();
    }

    #[Test]
    public function a_pole_work_order_runs_from_a_letter_through_the_pole_vendor_progress_and_a_pole_bastp(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $kr = (string) Str::uuid();
        DB::table('pole_contracts')->insert(['id' => $kr, 'kr_number' => 'KR-WO', 'qty_tm' => 10, 'qty_tr' => 5, 'status' => 'ACTIVE', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $alloc = $this->as($this->perencanaan)->postJson("/api/applications/{$app}/allocations", [])->assertCreated()->json('data.id');     // Perencanaan opens the allocation and fills the poles
        $this->as($this->perencanaan)->putJson("/api/allocations/{$alloc}/poles", ['poles' => [['pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 4], ['pole_contract_id' => $kr, 'pole_type' => 'TR', 'quantity' => 2]]])->assertOk();
        $cand = fn (User $u) => $this->as($u)->getJson('/api/pole-work-orders/candidates');
        $this->assertCount(0, $cand($this->perencanaan)->assertOk()->json('data'));                          // the poles part is not confirmed yet
        $this->as($this->perencanaan)->postJson("/api/allocations/{$alloc}/confirm", ['part' => 'poles'])->assertOk();
        $lines = $cand($this->perencanaan)->assertOk()->json('data');
        $this->assertCount(2, $lines);
        $ids = array_column($lines, 'allocation_pole_line_id');
        $agendaRow = fn (User $u) => collect($this->as($u)->getJson('/api/work-orders/by-agenda')->assertOk()->json('data'))->firstWhere('application_id', $app);
        $before = $agendaRow($this->perencanaan);
        $this->assertSame(6, $before['poles_creatable_quantity']);                                           // the agenda lists the poles that may still be given a letter
        $this->assertSame([], $before['poles']);

        $konstruksi = $this->makeUser();
        $this->assign($konstruksi, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $asman = $this->makeUser();
        $this->assign($asman, Role::query()->where('name', 'ASMAN_PERENCANAAN')->firstOrFail(), $this->ulpA->parent);
        $mk = fn (string $code, string $scope) => (string) tap(Str::uuid(), fn ($id) => DB::table('vendor_companies')->insert(['id' => $id, 'code' => $code, 'name' => 'PT '.$code, 'status' => 'ACTIVE', 'work_scope' => $scope, 'created_by' => $this->admin->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $poleVendor = $mk('TIANG-1', 'TIANG');
        $netVendor = $mk('JARINGAN-1', 'JARINGAN');
        DB::table('vendor_accounts')->insert(['id' => (string) Str::uuid(), 'user_id' => $this->vendor->getKey(), 'vendor_company_id' => $poleVendor, 'is_active' => true, 'created_by' => $this->admin->getKey(), 'created_at' => now(), 'updated_at' => now()]);

        $body = fn (array $o = []) => $o + ['letter_number' => 'AMS/TIANG/001', 'letter_date' => now()->toDateString(), 'vendor_company_id' => $poleVendor, 'line_ids' => $ids];
        $this->as($konstruksi)->postJson('/api/pole-work-orders', $body())->assertForbidden();               // only Perencanaan creates
        $this->as($this->vendor)->postJson('/api/pole-work-orders', $body())->assertForbidden();
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['vendor_company_id' => $netVendor]))->assertStatus(409);   // a network-only vendor cannot take a pole WO
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['line_ids' => [(string) Str::uuid()]]))->assertStatus(404);
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['line_meta' => [$ids[0] => ['condition' => 'RUSAK']]]))->assertUnprocessable();   // an unknown pole condition
        $wo = $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['line_meta' => [$ids[0] => ['condition' => 'BEKAS', 'note' => 'pakai tiang bekas Handal'], $ids[1] => ['condition' => 'RELOKASI', 'note' => 'limpahan dari Madiun']]]))->assertCreated()->json('data.id');
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['letter_number' => 'AMS/TIANG/002']))->assertStatus(409);   // the lines are already on a letter
        $this->assertCount(0, $cand($this->perencanaan)->json('data'));
        $this->as($this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/letter", ['file' => UploadedFile::fake()->create('surat.pdf', 20, 'application/pdf')])->assertCreated();
        $this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}")->assertNotFound();                  // a draft is invisible to the vendor
        $this->as($this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/issue", [])->assertOk();
        $this->assertCount(1, $this->as($this->vendor)->getJson('/api/pole-work-orders')->assertOk()->json('data'));
        foreach ([$this->perencanaan, $this->vendor] as $u) {                                                // the issued letter sits on its agenda for the planner and for its own vendor
            $row = $agendaRow($u);
            $this->assertCount(1, $row['poles']);
            $this->assertSame(['AMS/TIANG/001', 'ISSUED', 6, 0], [$row['poles'][0]['letter_number'], $row['poles'][0]['status'], $row['poles'][0]['quantity'], $row['poles'][0]['revision_number']]);
            $this->assertSame(0, $row['poles_creatable_quantity']);
            $this->assertNull($row['network']);
            $this->assertEquals(0.0, $row['poles'][0]['progress_percent']);                                   // no verified progress yet
        }
        $this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}/letter")->assertOk();
        $meta = collect($this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}")->json('data.lines'))->pluck('origin_note', 'pole_condition')->all();
        $this->assertEquals(['BEKAS' => 'pakai tiang bekas Handal', 'RELOKASI' => 'limpahan dari Madiun'], $meta);   // the per-line condition and origin survive the issue
        $this->as($this->managerB)->getJson("/api/pole-work-orders/{$wo}")->assertNotFound();               // another UP3

        $show = $this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}")->assertOk()->json('data');
        $this->assertSame('ISSUED', $show['status']);
        $this->assertSame(6, array_sum(array_column($show['lines'], 'quantity')));

        // revision (amandemen): same letter number, only the lines sent to the vendor change
        $amend = fn (array $o, ?User $by = null) => $this->as($by ?? $this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/amend", $o);
        $amend(['reason' => 'x', 'line_ids' => $ids], $this->vendor)->assertForbidden();
        $amend(['reason' => 'x', 'line_ids' => $ids], $konstruksi)->assertForbidden();
        $amend(['line_ids' => $ids])->assertUnprocessable();                                                 // the reason is required
        $amend(['reason' => 'tidak berubah', 'line_ids' => $ids])->assertStatus(409);                        // nothing changed
        $amend(['reason' => 'ganti vendor', 'line_ids' => [(string) Str::uuid()]])->assertStatus(404);
        $amend(['reason' => 'Lokasi kedua dicoret', 'line_ids' => [$ids[0]]])->assertOk()->assertJsonPath('data.revision_number', 1);
        $this->assertCount(1, $this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}")->json('data.lines'));
        $amend(['reason' => 'Lokasi kedua dimasukkan lagi', 'line_ids' => $ids, 'line_meta' => [$ids[1] => ['condition' => 'BEKAS', 'note' => 'tiang bekas Handal']]])->assertOk()->assertJsonPath('data.revision_number', 2);
        $this->assertSame('AMS/TIANG/001', DB::table('pole_work_orders')->where('id', $wo)->value('letter_number'));   // the letter number never changes
        $rev = $this->as($this->vendor)->getJson("/api/pole-work-orders/{$wo}")->json('data');
        $this->assertSame(2, $rev['revision_number']);
        $this->assertCount(2, $rev['revisions']);
        $this->assertSame([1, 0, 0], [$rev['revisions'][1]['added'], $rev['revisions'][1]['removed'], $rev['revisions'][1]['changed']]);   // the re-added line counts as added
        $this->assertSame([0, 1, 0], [$rev['revisions'][0]['added'], $rev['revisions'][0]['removed'], $rev['revisions'][0]['changed']]);
        $this->assertTrue($this->noteTo($this->vendor, '%WO Tiang AMS/TIANG/001 direvisi (revisi 2)%'));
        $show = $rev;
        $progress = fn (string $line, float $pct, string $key, ?User $by = null) => $this->as($by ?? $this->vendor)->postJson("/api/pole-work-orders/{$wo}/progress", ['line_id' => $line, 'cumulative_percent' => $pct, 'submission_key' => $key, 'work_date' => now()->toDateString()]);
        $progress($show['lines'][0]['id'], 50, 'k1', $konstruksi)->assertForbidden();                        // not the vendor
        $progress($show['lines'][0]['id'], 50, 'k0', $this->perencanaan)->assertForbidden();                 // Perencanaan verifies, it does not report on the manufacturer's behalf
        $pid = $progress($show['lines'][0]['id'], 50, 'k1')->assertCreated()->json('data.id');
        $progress($show['lines'][0]['id'], 50, 'k1')->assertOk();                                            // idempotent replay
        $this->as($this->vendor)->postJson("/api/pole-wo-progress/{$pid}/decision", ['decision' => 'VERIFIED'])->assertForbidden();   // the vendor cannot verify
        $this->as($this->perencanaan)->postJson("/api/pole-wo-progress/{$pid}/decision", ['decision' => 'VERIFIED'])->assertOk();
        $this->assertSame('IN_PROGRESS', DB::table('pole_work_orders')->where('id', $wo)->value('status'));
        $amend(['reason' => 'coret lokasi yang sudah ada progres', 'line_ids' => [$show['lines'][1]['allocation_pole_line_id']]])->assertStatus(409);   // a location with progress cannot be dropped
        $this->as($this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/bastp", ['bastp_number' => 'BASTP-1', 'bastp_date' => now()->toDateString()])->assertStatus(409);   // not every location is at 100 %
        foreach ($show['lines'] as $i => $l) {
            $pid = $progress($l['id'], 100, 'k-done-'.$i)->assertCreated()->json('data.id');
            $this->as($this->perencanaan)->postJson("/api/pole-wo-progress/{$pid}/decision", ['decision' => 'VERIFIED'])->assertOk();
        }
        $b = $this->as($this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/bastp", ['bastp_number' => 'BASTP-1', 'bastp_date' => now()->toDateString()])->assertCreated()->json('data.id');
        $this->as($this->perencanaan)->postJson("/api/pole-wo-bastp/{$b}/decision", ['decision' => 'CLOSE'])->assertForbidden();   // only Asman Perencanaan closes
        $this->as($asman)->postJson("/api/pole-wo-bastp/{$b}/decision", ['decision' => 'RETURN'])->assertStatus(409);                 // a return needs a reason
        $this->as($asman)->postJson("/api/pole-wo-bastp/{$b}/decision", ['decision' => 'CLOSE'])->assertOk();
        $this->assertSame('COMPLETED', DB::table('pole_work_orders')->where('id', $wo)->value('status'));
        $this->as($this->perencanaan)->postJson("/api/pole-work-orders/{$wo}/cancel", ['reason' => 'x'])->assertStatus(409);   // a completed WO is final
        $this->assertCount(0, $cand($this->perencanaan)->json('data'));                                      // completed lines are not offered again

        $note = fn (User $u, string $like) => DB::table('user_notifications')->where('user_id', $u->getKey())->where('title', 'like', $like)->exists();
        $this->assertTrue($note($this->vendor, '%WO Tiang AMS/TIANG/001 diterbitkan untuk Anda%'));            // the vendor hears the issue
        $this->assertTrue($note($this->perencanaan, '%Progres WO Tiang AMS/TIANG/001 menunggu verifikasi%'));   // the verifier is asked
        $this->assertTrue($note($this->vendor, '%Progres WO Tiang AMS/TIANG/001 terverifikasi%'));              // the reporter hears the verdict
        $this->assertTrue($note($asman, '%BASTP tiang WO AMS/TIANG/001 menunggu penutupan%'));                  // the closer is asked
        $this->assertTrue($note($this->vendor, '%WO Tiang AMS/TIANG/001 selesai%'));                            // everyone involved hears the completion
    }

    #[Test]
    public function a_kontrak_rinci_has_a_vendor_and_may_run_into_work_debt_and_the_pole_wo_follows_the_kr_vendor(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $mkVendor = fn (string $code, string $scope) => (string) tap(Str::uuid(), fn ($id) => DB::table('vendor_companies')->insert(['id' => $id, 'code' => $code, 'name' => 'PT '.$code, 'status' => 'ACTIVE', 'work_scope' => $scope, 'created_by' => $this->admin->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $v1 = $mkVendor('T-ONE', 'TIANG');
        $v2 = $mkVendor('T-TWO', 'TIANG');
        $net = $mkVendor('J-NET', 'JARINGAN');
        $otherUp3 = (string) $this->ulpB->parent_id;
        $krBody = fn (string $kr, int $tm, int $tr, array $o = []) => ['kr_number' => $kr, 'qty_tm' => $tm, 'qty_tr' => $tr] + $o;
        $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', $krBody('KR-N', 1, 1, ['vendor_company_id' => $net]))->assertStatus(409);     // a network-only vendor cannot own a pole KR
        $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', $krBody('KR-N', 1, 1, ['up3_unit_id' => (string) $this->ulpA->getKey()]))->assertStatus(409);   // the owner must be an UP3
        $kr1 = $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', $krBody('KR-D1', 2, 5, ['vendor_company_id' => $v1, 'up3_unit_id' => $otherUp3]))->assertCreated()->json('data.id');
        $kr2 = $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', $krBody('KR-D2', 5, 5, ['vendor_company_id' => $v2]))->assertCreated()->json('data.id');

        $alloc = $this->as($this->perencanaan)->postJson("/api/applications/{$app}/allocations", [])->assertCreated()->json('data.id');
        $this->as($this->perencanaan)->putJson("/api/allocations/{$alloc}/poles", ['poles' => [['pole_contract_id' => $kr1, 'pole_type' => 'TM', 'quantity' => 3], ['pole_contract_id' => $kr2, 'pole_type' => 'TR', 'quantity' => 1]]])->assertOk();
        $debts = $this->as($this->perencanaan)->getJson("/api/allocations/{$alloc}")->assertOk()->json('data.pole_debts');
        $this->assertCount(1, $debts);                                                                      // 3 TM against a balance of 2
        $this->assertSame(['kr_number' => 'KR-D1', 'pole_type' => 'TM', 'quantity' => 3, 'remaining' => 2, 'over' => 1], $debts[0]);
        $this->as($this->perencanaan)->postJson("/api/allocations/{$alloc}/confirm", ['part' => 'poles'])->assertStatus(409);                       // a debt must be accepted explicitly
        $this->as($this->perencanaan)->postJson("/api/allocations/{$alloc}/confirm", ['part' => 'poles', 'accept_debt' => true])->assertOk();
        $row = collect($this->as($this->perencanaan)->getJson('/api/master-data/pole-contracts')->json('data'))->firstWhere('id', $kr1);
        $this->assertSame(-1, $row['tm']['remaining']);                                                       // the balance goes negative: "utang kerja"
        $this->assertTrue($row['in_debt']);
        $this->assertSame('PT T-ONE', $row['vendor_name']);
        $this->assertSame(1, $this->as($this->perencanaan)->getJson("/api/allocations/{$alloc}")->json('data.pole_debts.0.over'));   // the confirmed allocation keeps showing the debt it carries

        $cand = collect($this->as($this->perencanaan)->getJson('/api/pole-work-orders/candidates')->assertOk()->json('data'));
        $this->assertCount(2, $cand);
        $c1 = $cand->firstWhere('kr_number', 'KR-D1');
        $this->assertSame('PT T-ONE', $c1['kr_vendor_name']);
        $this->assertTrue($c1['from_other_up3']);                                                             // a KR of another UP3: "limpahan"
        $this->assertFalse($cand->firstWhere('kr_number', 'KR-D2')['from_other_up3']);                       // no owner recorded
        $ids = $cand->pluck('allocation_pole_line_id')->all();
        $one = [$c1['allocation_pole_line_id']];
        $body = fn (array $o = []) => $o + ['letter_number' => 'AMS/KR/001', 'letter_date' => now()->toDateString(), 'line_ids' => $one];
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['letter_number' => 'AMS/KR/X', 'line_ids' => $ids]))->assertStatus(409);        // two KRs, two vendors: one letter cannot mix them
        $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body(['vendor_company_id' => $v2]))->assertStatus(409);                                  // the given vendor must match the KR's
        $wo = $this->as($this->perencanaan)->postJson('/api/pole-work-orders', $body())->assertCreated()->json('data.id');                                       // no vendor given: it follows the KR
        $this->assertSame($v1, DB::table('pole_work_orders')->where('id', $wo)->value('vendor_company_id'));
    }

    #[Test]
    public function the_rkm_work_demand_comes_from_linked_approved_mto_packages_once_and_is_not_counted_again_when_already_allocated(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $up3 = (string) $this->ulpA->parent_id;
        $plan = fn (string $start) => $this->as($this->perencanaan)->postJson('/api/rkm/plans', ['up3_unit_id' => $up3, 'period_type' => 'MONTH', 'period_start' => $start])->assertCreated()->json('data.version_id');
        $v1 = $plan('2026-11-01');
        $prop1 = (string) DB::table('rkm_proposals')->where('version_id', $v1)->value('id');                      // this UP3 has one ULP: ulpA
        $this->as($this->vendor)->putJson("/api/rkm/proposals/{$prop1}/packages", ['package_ids' => [$p]])->assertForbidden();
        $this->as($this->teknik)->putJson("/api/rkm/proposals/{$prop1}/packages", ['package_ids' => [(string) Str::uuid()]])->assertStatus(409);   // unknown package
        $this->as($this->teknik)->putJson("/api/rkm/proposals/{$prop1}/packages", ['package_ids' => [$p]])->assertOk();

        $line = DB::table('mto_lines')->where('package_id', $p)->where('material', '>', 0)->orderBy('khs_code')->first();
        $need = (float) DB::table('mto_lines')->where('package_id', $p)->where('khs_item_id', $line->khs_item_id)->sum('material');
        $this->assertEquals($need, (float) DB::table('rkm_lines')->where('proposal_id', $prop1)->where('khs_item_id', $line->khs_item_id)->value('qty_work'));
        $this->as($this->teknik)->putJson("/api/rkm/proposals/{$prop1}/lines", ['lines' => [['khs_code' => (string) $line->khs_code, 'qty_pipeline' => 3]]])->assertOk();   // pipeline added, work stays
        $this->assertEquals($need, (float) DB::table('rkm_lines')->where('proposal_id', $prop1)->where('khs_item_id', $line->khs_item_id)->value('qty_work'));

        $v2 = $plan('2026-12-01');                                                                                 // the same package cannot be in a second live RKM
        $prop2 = (string) DB::table('rkm_proposals')->where('version_id', $v2)->value('id');
        $this->as($this->teknik)->putJson("/api/rkm/proposals/{$prop2}/packages", ['package_ids' => [$p]])->assertStatus(409);

        $req = fn () => collect($this->as($this->perencanaan)->getJson("/api/rkm/versions/{$v1}/requirements")->assertOk()->json('data.rows'))->firstWhere('khs_code', (string) $line->khs_code);
        $this->assertEquals($need + 3, $req()['gross_demand']);
        // a confirmed allocation of 2 units for this very work already left the available stock: gross demand drops by it (no double counting)
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD', 'name' => 'Gudang', 'organizational_unit_id' => $up3, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $alloc = (string) Str::uuid();
        DB::table('allocations')->insert(['id' => $alloc, 'application_id' => $app, 'mto_package_id' => $p, 'version_number' => 1, 'status' => 'DRAFT', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('allocation_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $alloc, 'khs_item_id' => $line->khs_item_id, 'warehouse_id' => $wh, 'quantity' => 2]);
        DB::table('allocations')->where('id', $alloc)->update(['materials_confirmed_by' => $this->perencanaan->getKey(), 'materials_confirmed_at' => now(), 'poles_confirmed_by' => $this->perencanaan->getKey(), 'poles_confirmed_at' => now(), 'status' => 'CONFIRMED', 'confirmed_by' => $this->perencanaan->getKey(), 'confirmed_at' => now()]);
        $r = $req();
        $this->assertEquals(2, $r['already_allocated']);
        $this->assertEquals($need + 3 - 2, $r['gross_demand']);
    }

    /** @return array{0:string,1:User,2:User,3:string} application id, KONSTRUKSI_UP3, ASMAN_KONSTRUKSI, vendor company id */
    private function noteTo(User $u, string $like): bool
    {
        return DB::table('user_notifications')->where('user_id', $u->getKey())->where('title', 'like', $like)->exists();
    }

    private function woFixture(): array
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $app = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        $mk = function (string $role): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $this->ulpA->parent);

            return $u;
        };
        $konstruksi = $mk('KONSTRUKSI_UP3');
        $asman = $mk('ASMAN_KONSTRUKSI');
        $company = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'pt-abc', 'name' => 'PT ABC'])->assertCreated()->json('data.id');
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$company}/accounts", ['user_id' => $this->vendor->getKey()])->assertCreated();

        return [$app, $konstruksi, $asman, $company];
    }

    #[Test]
    public function a_work_order_runs_from_draft_to_completed_with_the_vendor_chosen_by_konstruksi_issued_by_asman_and_verified_progress(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $this->as($this->vendor)->postJson("/api/master-data/vendors/{$company}/accounts", ['user_id' => $this->vendor->getKey()])->assertForbidden();   // only the managers link accounts
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$company}/accounts", ['user_id' => $this->vendor->getKey()])->assertStatus(409);   // one account, one company
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$company}/accounts", ['user_id' => $this->teknik->getKey()])->assertStatus(409);    // not a VENDOR
        $url = "/api/applications/{$app}/work-orders";

        $this->as($this->vendor)->postJson($url)->assertForbidden();
        $this->as($this->teknik)->postJson($url)->assertForbidden();
        $this->as($asman)->postJson($url)->assertForbidden();                                                  // ASMAN approves, KONSTRUKSI_UP3 creates
        $wo = $this->as($konstruksi)->postJson($url)->assertCreated()->json('data.id');
        $this->as($konstruksi)->postJson($url)->assertStatus(409);                                              // one live WO per application
        $shown = $this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->assertOk()->json('data');
        $this->assertSame('DRAFT', $shown['status']);
        $this->assertNotEmpty($shown['tasks']);
        $this->assertNotEmpty($shown['materials']);                                                              // from the approved MTO
        $this->assertIsArray($shown['material_warning']);                                                        // an unallocated PLN material only warns, it never blocks the WO
        $this->assertNotEmpty($shown['material_warning']);                                                       // nothing is allocated in this fixture
        $this->assertSame(['khs_code', 'khs_name', 'unit_text', 'need', 'allocated', 'remaining'], array_keys($shown['material_warning'][0]));
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertStatus(409);                   // no vendor yet
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'note' => 'Vendor kontrak payung'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertStatus(409);                   // no target date yet
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/target-date", ['target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertForbidden();   // KONSTRUKSI_UP3 cannot issue
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'RETURN'])->assertStatus(409);        // a reason is required
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'RETURN', 'reason' => 'Lengkapi catatan vendor'])->assertOk();
        $this->assertSame('DRAFT', DB::table('work_orders')->where('id', $wo)->value('status'));
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($this->vendor)->getJson("/api/work-orders/{$wo}")->assertNotFound();                          // not issued yet: the vendor sees nothing
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();   // WO and vendor approved in one decision
        $this->as($asman)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company])->assertForbidden();
        $this->assertSame('ISSUED', DB::table('work_orders')->where('id', $wo)->value('status'));

        $vendorView = $this->as($this->vendor)->getJson("/api/work-orders/{$wo}")->assertOk()->json('data');
        $this->assertNull($vendorView['tasks'][0]['amount']);                                                    // the vendor does not see the RAB amounts
        $this->assertSame([], $vendorView['events']);
        $this->as($this->vendor)->getJson('/api/work-orders')->assertOk()->assertJsonCount(1, 'data');
        $row = $this->as($konstruksi)->getJson('/api/work-orders')->assertOk()->json('data.0');
        $this->assertSame($vendorView['vendor_name'], $row['vendor_name']);
        $this->assertNotEmpty($row['vendor_name']);
        $this->assertNotEmpty($row['application_number']);
        $this->assertNotNull($row['issued_at']);
        $this->assertSame(0, $row['pending_progress']);
        $this->assertNotNull($row['progress_percent']);
        $this->assertSame($row['application_number'], $vendorView['application_number']);
        $agenda = fn (User $u) => collect($this->as($u)->getJson('/api/work-orders/by-agenda')->assertOk()->json('data'));
        $mine = $agenda($konstruksi)->firstWhere('application_number', $row['application_number']);
        $this->assertSame([$wo, 'ISSUED', 1], [$mine['network']['id'], $mine['network']['status'], $mine['network']['version_number']]);
        $this->assertFalse($mine['network_creatable']);                                                      // it already has a running WO
        $this->assertSame(['PENDING', false, 1], [$mine['material_request']['status'], $mine['material_request']['needs_followup'], $mine['material_request']['count']]);   // the outbox request made at the issue
        $byApp = $this->as($konstruksi)->getJson('/api/material-requests?application_id='.$mine['application_id'])->assertOk()->json('data');
        $this->assertSame([$mine['material_request']['id']], array_column($byApp, 'id'));
        $this->assertSame([], $this->as($konstruksi)->getJson('/api/material-requests?application_id='.(string) Str::uuid())->assertOk()->json('data'));
        $this->assertNotEmpty($vendorView['materials']);
        foreach ($vendorView['materials'] as $m) {                                                           // materials read by name and unit, not only by KHS code
            $this->assertNotEmpty($m['khs_name']);
            $this->assertNotEmpty($m['unit']);
        }
        $one = $this->as($konstruksi)->getJson('/api/work-orders/by-agenda?application_id='.$mine['application_id'])->assertOk()->json('data');
        $this->assertSame([$mine['application_id']], array_column($one, 'application_id'));                 // the dedicated page loads one agenda only
        $this->assertSame(1, $agenda($this->vendor)->count());                                               // a vendor sees only the agenda of its own issued WO
        $this->assertFalse($agenda($this->vendor)->first()['network_creatable']);
        $this->assertNull($agenda($this->vendor)->first()['material_request']);                              // the outbox is internal: the vendor never sees it
        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'VENDOR')->firstOrFail(), $this->ulpA);
        $co2 = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-XYZ', 'name' => 'PT XYZ'])->json('data.id');
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$co2}/accounts", ['user_id' => $other->getKey()])->assertCreated();
        $this->as($other)->getJson("/api/work-orders/{$wo}")->assertNotFound();                                  // another company
        $this->as($other)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $shown['tasks'][0]['id'], 'submission_key' => 'x', 'cumulative_percent' => 10])->assertNotFound();
        $this->as($this->managerB)->getJson("/api/work-orders/{$wo}")->assertNotFound();                         // another ULP

        $t = $shown['tasks'][0]['id'];
        $progress = fn (string $task, string $key, float $pct, ?User $by = null) => $this->as($by ?? $this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $task, 'submission_key' => $key, 'cumulative_percent' => $pct]);
        $progress($t, 'kx', 40, $this->perencanaan)->assertForbidden();                                          // only the Pelaksana account reports; Konstruksi verifies
        $first = $progress($t, 'k1', 40)->assertCreated()->json('data.id');
        $progress($t, 'k1', 40)->assertOk()->assertJsonPath('replayed', true);                                   // idempotent
        $progress($t, 'k1', 50)->assertStatus(409);                                                              // same key, other content
        $progress($t, 'k2', 45)->assertStatus(409);                                                              // one pending submission per task
        $this->assertSame('IN_PROGRESS', DB::table('work_orders')->where('id', $wo)->value('status'));
        $this->as($this->vendor)->postJson("/api/work-progress/{$first}/decision", ['decision' => 'VERIFIED'])->assertForbidden();   // vendors never verify
        $this->as($konstruksi)->postJson("/api/work-progress/{$first}/decision", ['decision' => 'RETURNED'])->assertStatus(409);       // a reason is required
        $this->as($konstruksi)->postJson("/api/work-progress/{$first}/decision", ['decision' => 'VERIFIED'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-progress/{$first}/decision", ['decision' => 'VERIFIED'])->assertStatus(409);        // already decided
        $this->assertEquals(40, collect($this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.tasks'))->firstWhere('id', $t)['verified_percent']);
        $progress($t, 'k3', 30)->assertStatus(409);                                                              // cumulative cannot go below the verified 40 %
        $progress($t, 'k4', 60, $konstruksi)->assertForbidden();                                                 // internal users never submit progress
        $own = $progress($t, 'k4', 60)->assertCreated()->json('data.id');
        try {
            DB::transaction(fn () => DB::table('wo_progress')->where('id', $own)->update(['decided_by' => $this->vendor->getKey(), 'status' => 'VERIFIED']));
            $this->fail('the database must refuse a verifier equal to the submitter');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->as($this->teknik)->postJson("/api/work-progress/{$own}/decision", ['decision' => 'VERIFIED'])->assertForbidden();         // TEKNIK has no verify key
        $verifier2 = $this->makeUser();
        $this->assign($verifier2, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $this->as($verifier2)->postJson("/api/work-progress/{$own}/decision", ['decision' => 'VERIFIED'])->assertOk();

        $this->as($asman)->postJson("/api/work-orders/{$wo}/complete")->assertStatus(409);                       // tasks not at 100 %
        foreach ($shown['tasks'] as $i => $task) {
            $id = $progress($task['id'], "done-{$i}", 100)->assertCreated()->json('data.id');
            $this->as($verifier2)->postJson("/api/work-progress/{$id}/decision", ['decision' => 'VERIFIED'])->assertOk();
        }
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/complete")->assertForbidden();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/complete")->assertStatus(409);                       // the WO is completed by the closing of the BASTP, never directly
        $bastp = $this->bastpReadyToClose($wo, $konstruksi);                                                      // vendor submits, MANAGER_ULP accepts, KONSTRUKSI_UP3 signs
        $this->as($asman)->postJson("/api/bastp/{$bastp}/close", ['password' => 'secret-password'])->assertStatus(409);   // all work verified, but the customer is not yet at the EIS status PEREMAJAAN
        $this->assertSame('IN_PROGRESS', DB::table('work_orders')->where('id', $wo)->value('status'));
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'external_system' => 'EIS_AP2T', 'external_status_code' => 'PEREMAJAAN', 'external_status_name' => 'Peremajaan', 'received_at' => now()]);
        $this->as($asman)->postJson("/api/bastp/{$bastp}/close", ['password' => 'secret-password'])->assertOk();   // ASMAN_KONSTRUKSI closes = completes the WO
        $this->assertSame('COMPLETED', DB::table('work_orders')->where('id', $wo)->value('status'));
        $this->assertSame('COMPLETED', DB::table('applications')->where('id', $app)->value('current_status'));   // the BASTP closing also completes the application
        $this->assertNotNull(DB::table('applications')->where('id', $app)->value('completed_at'));
        $this->assertSame('COMPLETED', DB::table('application_status_histories')->where('application_id', $app)->orderByDesc('seq')->value('to_status'));
        $progress($t, 'late', 100)->assertStatus(409);                                                           // completed: no more progress
        $this->as($konstruksi)->postJson($url)->assertStatus(409);                                               // and no second WO
        try {
            DB::transaction(fn () => DB::table('work_orders')->where('id', $wo)->update(['cancel_reason' => 'x']));
            $this->fail('a completed work order is final');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $events = array_column($this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.events'), 'event_type');
        $this->assertContains('ISSUED', $events);
        $this->assertContains('COMPLETED', $events);
    }

    #[Test]
    public function an_amendment_is_a_new_version_that_carries_the_verified_progress_and_supersedes_the_old_one_when_issued_and_a_cancel_is_final(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $url = "/api/applications/{$app}/work-orders";
        $wo = $this->as($konstruksi)->postJson($url)->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/amend", ['reason' => 'x'])->assertStatus(409);                   // only issued WOs are amended
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $t = $this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.tasks.0.id');
        $pid = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $t, 'submission_key' => 'a', 'cumulative_percent' => 70])->assertCreated()->json('data.id');
        $this->as($konstruksi)->postJson("/api/work-progress/{$pid}/decision", ['decision' => 'VERIFIED'])->assertOk();
        $pending = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $t, 'submission_key' => 'b', 'cumulative_percent' => 80])->assertCreated()->json('data.id');

        $this->as($asman)->postJson("/api/work-orders/{$wo}/amend", ['reason' => 'x'])->assertForbidden();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/amend", [])->assertUnprocessable();
        $v2 = $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/amend", ['reason' => 'Penambahan tiang'])->assertCreated()->json('data.id');
        $this->assertSame('2027-01-31', DB::table('work_orders')->where('id', $v2)->value('target_date'));                       // the target date is copied to the new version
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/amend", ['reason' => 'lagi'])->assertStatus(409);               // one version in preparation
        $this->assertSame('IN_PROGRESS', DB::table('work_orders')->where('id', $wo)->value('status'));                             // the old one keeps running meanwhile
        $this->assertEquals(70, (float) DB::table('wo_tasks')->where('work_order_id', $v2)->where('group_code', DB::table('wo_tasks')->where('id', $t)->value('group_code'))->value('baseline_percent'));
        $this->as($this->vendor)->getJson("/api/work-orders/{$v2}")->assertNotFound();                                           // a draft version is invisible to the vendor
        $this->as($konstruksi)->postJson("/api/work-orders/{$v2}/submit")->assertOk();                                           // the vendor is copied from the old version
        $this->as($asman)->postJson("/api/work-orders/{$v2}/decision", ['decision' => 'ISSUE'])->assertOk();
        $this->assertSame('SUPERSEDED', DB::table('work_orders')->where('id', $wo)->value('status'));
        $this->assertSame('RETURNED', DB::table('wo_progress')->where('id', $pending)->value('status'));                           // the pending submission is returned automatically
        $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $t, 'submission_key' => 'c', 'cumulative_percent' => 90])->assertStatus(409);   // the superseded version takes no progress
        $this->assertSame(2, (int) DB::table('work_orders')->where('id', $v2)->value('version_number'));

        $this->as($konstruksi)->postJson("/api/work-orders/{$v2}/cancel", ['reason' => 'Batal'])->assertForbidden();               // ASMAN cancels
        $this->as($asman)->postJson("/api/work-orders/{$v2}/cancel", [])->assertUnprocessable();
        $this->as($asman)->postJson("/api/work-orders/{$v2}/cancel", ['reason' => 'Permohonan dibatalkan pelanggan'])->assertOk();
        $this->assertSame('CANCELLED', DB::table('work_orders')->where('id', $v2)->value('status'));
        $this->as($asman)->postJson("/api/work-orders/{$v2}/cancel", ['reason' => 'lagi'])->assertStatus(409);
        $v3 = $this->as($konstruksi)->postJson($url)->assertCreated()->json('data.id');                                           // a new WO may start after a cancellation
        $this->assertSame(3, (int) DB::table('work_orders')->where('id', $v3)->value('version_number'));
    }

    /** The WO of the fixture driven to ISSUED and every task verified at 100 %. @return array{0:string,1:string,2:User,3:User,4:User} wo, application, konstruksi, asman, second KONSTRUKSI_UP3 */
    private function woAtFullProgress(): array
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $verifier = $this->makeUser();
        $this->assign($verifier, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        foreach ($this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.tasks') as $i => $t) {
            $id = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $t['id'], 'submission_key' => "p{$i}", 'cumulative_percent' => 100])->assertCreated()->json('data.id');
            $this->as($verifier)->postJson("/api/work-progress/{$id}/decision", ['decision' => 'VERIFIED'])->assertOk();
        }

        return [$wo, $app, $konstruksi, $asman, $verifier];
    }

    /** A BASTP created, filled, submitted by the vendor, accepted by MANAGER_ULP and signed by KONSTRUKSI_UP3 (only the closing is left). */
    private function bastpReadyToClose(string $wo, User $konstruksi): string
    {
        $b = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertCreated()->json('data.id');
        $this->fillBastp($b);
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertOk();
        $this->as($this->manager)->postJson("/api/bastp/{$b}/accept", ['password' => 'secret-password'])->assertOk();
        $this->as($konstruksi)->postJson("/api/bastp/{$b}/sign", ['password' => 'secret-password'])->assertOk();

        return $b;
    }

    private function fillBastp(string $b): void
    {
        $shown = $this->as($this->vendor)->getJson("/api/bastp/{$b}")->assertOk()->json('data');
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/materials", ['materials' => array_map(fn ($m) => ['khs_code' => $m['khs_code'], 'installed_qty' => $m['planned_qty']], $shown['materials']), 'notes' => 'Terpasang sesuai rencana'])->assertOk();
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/meters", ['meters' => [['customer_idpel' => '514531561929', 'meter_number' => 'MTR-0001'], ['customer_idpel' => '514531561930', 'meter_number' => 'MTR-0002']]])->assertOk();
        foreach ($this->as($this->vendor)->getJson("/api/bastp/{$b}")->json('data.meters') as $m) {
            $this->as($this->vendor)->post("/api/bastp/{$b}/meters/{$m['id']}/photos", ['file' => $this->png('meter.png')], ['Accept' => 'application/json'])->assertCreated();
        }
    }

    #[Test]
    public function a_bastp_is_a_precondition_of_the_wo_completion_with_the_annex_meters_electronic_signatures_and_the_owner_numbering(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertStatus(409);                    // no progress yet: nothing to hand over
        $tasks = $this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.tasks');
        $first = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $tasks[0]['id'], 'submission_key' => 'a', 'cumulative_percent' => 50])->assertCreated()->json('data.id');
        $verifier = $this->makeUser();
        $this->assign($verifier, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $this->as($verifier)->postJson("/api/work-progress/{$first}/decision", ['decision' => 'VERIFIED'])->assertOk();
        $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertStatus(409);                    // tasks are not at 100 % yet
        foreach ($tasks as $i => $t) {
            $id = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $t['id'], 'submission_key' => "done{$i}", 'cumulative_percent' => 100])->assertCreated()->json('data.id');
            $this->as($verifier)->postJson("/api/work-progress/{$id}/decision", ['decision' => 'VERIFIED'])->assertOk();
        }

        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'VENDOR')->firstOrFail(), $this->ulpA);
        $co2 = $this->as($konstruksi)->postJson('/api/master-data/vendors', ['code' => 'PT-LAIN', 'name' => 'PT Lain'])->json('data.id');
        $this->as($konstruksi)->postJson("/api/master-data/vendors/{$co2}/accounts", ['user_id' => $other->getKey()])->assertCreated();
        $this->as($other)->postJson("/api/work-orders/{$wo}/bastp")->assertNotFound();                           // another company's vendor
        $this->as($asman)->postJson("/api/work-orders/{$wo}/bastp")->assertForbidden();                           // ASMAN does not prepare
        $b = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertCreated()->json('data.id');
        $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertStatus(409);                    // one live BASTP per WO
        $this->as($this->managerB)->getJson("/api/bastp/{$b}")->assertNotFound();

        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertStatus(409);   // annex and meters missing
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/meters", ['meters' => [['customer_idpel' => '1', 'meter_number' => 'M1'], ['customer_idpel' => '2', 'meter_number' => 'M1']]])->assertStatus(409);   // duplicate meter number
        $this->fillBastp($b);
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'salah'])->assertForbidden();                // the signature needs the signer's own password
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", [])->assertUnprocessable();
        $this->as($this->manager)->postJson("/api/bastp/{$b}/accept", ['password' => 'secret-password'])->assertStatus(409);     // not submitted yet
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertOk();
        $row = DB::table('bastps')->where('id', $b)->first();
        $this->assertMatchesRegularExpression('#^00001/BASTP/\d{2}-\d{2}/'.preg_quote($this->ulpA->code, '#').'/'.now()->year.'$#', $row->bastp_number);   // owner format
        $this->assertSame('SUBMITTED', $row->status);
        $hash = $row->content_hash;
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/materials", ['materials' => []])->assertStatus(409);                 // frozen after the signature
        try {
            DB::transaction(fn () => DB::table('bastps')->where('id', $b)->update(['content_hash' => str_repeat('a', 64), 'status' => 'ACCEPTED']));
            $this->fail('the signed content must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->as($konstruksi)->postJson("/api/bastp/{$b}/sign", ['password' => 'secret-password'])->assertStatus(409);        // MANAGER_ULP accepts first
        $this->as($this->teknik)->postJson("/api/bastp/{$b}/accept", ['password' => 'secret-password'])->assertForbidden();
        $this->as($this->manager)->postJson("/api/bastp/{$b}/return", [])->assertUnprocessable();
        $this->as($this->manager)->postJson("/api/bastp/{$b}/return", ['reason' => 'Foto meter 2 kurang jelas'])->assertOk();   // a return reopens the draft in a new round
        $row = DB::table('bastps')->where('id', $b)->first();
        $this->assertSame('DRAFT', $row->status);
        $this->assertSame(2, (int) $row->round);
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/materials", ['materials' => [], 'notes' => 'Foto diganti'])->assertOk();
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertOk();
        $this->assertSame($row->bastp_number, DB::table('bastps')->where('id', $b)->value('bastp_number'));                       // the number never changes
        $this->as($this->manager)->postJson("/api/bastp/{$b}/accept", ['password' => 'secret-password'])->assertOk();
        $this->as($konstruksi)->postJson("/api/bastp/{$b}/sign", ['password' => 'secret-password'])->assertOk();

        $this->as($this->teknik)->postJson("/api/bastp/{$b}/close", ['password' => 'secret-password'])->assertForbidden();
        $this->as($asman)->postJson("/api/bastp/{$b}/close", ['password' => 'secret-password'])->assertStatus(409);             // the customer is not at PEREMAJAAN yet: nothing closes
        $this->assertSame('KONSTRUKSI_SIGNED', DB::table('bastps')->where('id', $b)->value('status'));
        $this->assertSame(0, DB::table('bastp_signatures')->where('bastp_id', $b)->where('step', 'ASMAN_KONSTRUKSI')->count());   // the refused closing left no signature behind
        $this->assertSame('IN_PROGRESS', DB::table('work_orders')->where('id', $wo)->value('status'));
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'external_system' => 'EIS_AP2T', 'external_status_code' => 'PEREMAJAAN', 'external_status_name' => 'Peremajaan', 'received_at' => now()]);
        $this->as($asman)->postJson("/api/bastp/{$b}/close", ['password' => 'secret-password'])->assertOk();
        $this->assertSame('COMPLETED', DB::table('work_orders')->where('id', $wo)->value('status'));
        $this->assertSame('CLOSED', DB::table('bastps')->where('id', $b)->value('status'));
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/return", ['reason' => 'x'])->assertStatus(409);                      // closed is final

        $shown = $this->as($this->vendor)->getJson("/api/bastp/{$b}")->assertOk()->json('data');
        $this->assertCount(2, $shown['meters']);
        $this->assertCount(1, $shown['meters'][0]['photo_document_ids']);
        $round2 = collect($shown['signatures'])->where('round', 2);
        $this->assertSame(['SUBMIT', 'ULP_MANAGER', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI'], $round2->pluck('step')->all());
        $this->assertSame(1, collect($shown['signatures'])->where('round', 1)->count());                                          // the first round's signature stays as history
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $round2->first()['signature']);
        $this->assertNotSame($hash, $shown['content_hash']);                                                                      // round 2 froze different content
        $doc = $this->as($asman)->getJson("/api/bastp/{$b}/document")->assertOk()->json('data');
        $this->assertSame($shown['bastp_number'], $doc['document_number']);
        $this->assertSame(4, count($doc['signatures']));
        $this->assertTrue($doc['signatures'][0]['electronic']);
        $this->as($asman)->get("/api/bastp/{$b}/document?format=xlsx")->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $this->as($this->vendor)->getJson("/api/bastp/{$b}/document?format=docx")->assertStatus(422);
    }

    #[Test]
    public function cancelling_the_wo_cancels_its_live_bastp(): void
    {
        [$wo, , $konstruksi, $asman] = $this->woAtFullProgress();
        $b = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertCreated()->json('data.id');
        $this->as($asman)->postJson("/api/work-orders/{$wo}/cancel", ['reason' => 'Permohonan dibatalkan'])->assertOk();
        $this->assertSame('CANCELLED', DB::table('bastps')->where('id', $b)->value('status'));
        $this->as($this->vendor)->putJson("/api/bastp/{$b}/materials", ['materials' => []])->assertStatus(409);
    }

    /** An APPROVED application of a customer with the given NEW power (kVA); tariff R1, EIS total cost and a prepaid SAR package are set for the KKF. */
    private function extraApplication(string $name, float $kva, ?OrganizationalUnit $unit = null, string $idpel = '', ?User $by = null): string
    {
        $unit ??= $this->ulpA;
        $by ??= $this->retail;
        $app = $this->as($by)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $unit->getKey(),
            'customer' => ['name' => $name, 'idpel' => $idpel ?: null], 'new_power_value' => $kva, 'new_power_unit' => 'kVA'])->assertCreated()->json('data.id');
        $this->as($by)->postJson("/api/applications/{$app}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        DB::table('applications')->where('id', $app)->update(['new_tariff_code' => 'R1', 'delta_power_kva' => $kva, 'total_cost' => 20000, 'sar_package' => 'Prabayar (Prepaid) Satu Arah']);

        return $app;
    }

    #[Test]
    public function a_proposal_picks_3_phase_customers_from_a_searchable_table_and_the_work_runs_through_the_representative(): void
    {
        $a1 = $this->extraApplication('PT Maju Jaya', 33, null, '511111111111');
        $a2 = $this->extraApplication('CV Berkah Sentosa', 41.5, null, '522222222222');
        $a3 = $this->extraApplication('Ibu Siti', 0.9);                                                    // 900 VA: any power is selectable for a proposal
        $retailB = $this->makeUser();
        $this->assign($retailB, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->ulpB);
        $a4 = $this->extraApplication('PT Lain ULP', 33, $this->ulpB, '', $retailB);                      // another ULP
        $sel = fn (string $q = '', ?User $by = null) => $this->as($by ?? $this->retail)->getJson('/api/proposals/selectable?q='.urlencode($q))->assertOk();

        $this->as($this->vendor)->getJson('/api/proposals/selectable')->assertForbidden();
        $names = array_column($sel()->json('data'), 'customer_name');
        $this->assertEqualsCanonicalizing(['PT Maju Jaya', 'CV Berkah Sentosa', 'Ibu Siti'], $names);    // every power and tariff, only this ULP
        $this->assertSame(6600, $sel()->json('min_power_va'));
        $this->assertSame(['PT Maju Jaya'], array_column($sel('maju')->json('data'), 'customer_name'));     // search by name
        $this->assertSame(['CV Berkah Sentosa'], array_column($sel('522222')->json('data'), 'customer_name'));   // search by IDPEL

        $this->as($this->vendor)->postJson('/api/proposals', ['application_ids' => [$a1]])->assertForbidden();
        $this->as($this->retail)->postJson('/api/proposals', [])->assertUnprocessable();
        $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$a1, $a4]])->assertStatus(409);       // another ULP is refused
        $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$a1, $a4]])->assertStatus(409);       // one proposal, one ULP
        $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$a4]])->assertNotFound();             // outside the actor's unit
        $id = $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$a1, $a2], 'title' => 'Perluasan Jombang'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$a2]])->assertStatus(409);            // already in a live proposal
        $this->assertSame(['Ibu Siti'], array_column($sel()->json('data'), 'customer_name'));                                // members leave the selectable table

        $shown = $this->as($this->teknik)->getJson("/api/proposals/{$id}")->assertOk()->json('data');
        $this->assertMatchesRegularExpression('#^00001/USULAN-PBPD/\d{2}-\d{2}/'.preg_quote($this->ulpA->code, '#').'/'.now()->year.'$#', $shown['proposal_number']);   // owner format
        $this->assertSame($a1, $shown['representative_application_id']);
        $this->assertCount(2, $shown['members']);
        $this->assertTrue($shown['members'][0]['is_representative']);
        $this->as($this->managerB)->getJson("/api/proposals/{$id}")->assertNotFound();

        // the PB/PD page lists manual applications, the proposals' representatives and the EIS applications that are 3-phase (>= 6600 VA); a smaller imported one stays stored but is not listed there
        config(['distriva.eis_min_power_va' => 6600]);                                                                       // the listing filter follows the configured minimum (default 0 = every power since 2026-11-13)
        $imported = $this->extraApplication('PT Dari EIS', 33);
        $imported1p = $this->extraApplication('Pak Budi', 0.9);
        DB::table('applications')->whereIn('id', [$imported, $imported1p])->update(['source_type' => 'BOT_DAFTUNG']);
        $listed = fn (string $query) => collect($this->as($this->retail)->getJson('/api/applications?per_page=100'.$query)->assertOk()->json('data'))->pluck('id')->all();
        $page = $listed('&listing=pbpd');
        $this->assertContains($a1, $page);
        $this->assertContains($a3, $page);                                                                                 // a manual 1-phase application stays listed
        $this->assertContains($imported, $page);                                                                           // 33 kVA from EIS: 3-phase, listed
        $this->assertNotContains($imported1p, $page);                                                                      // 0.9 kVA from EIS: stored, not listed
        $all = $listed('');
        $this->assertContains($imported, $all);                                                                            // nothing is deleted or hidden elsewhere
        $this->assertContains($imported1p, $all);
        $row = collect($this->as($this->retail)->getJson('/api/applications?listing=pbpd&per_page=100')->json('data'))->firstWhere('id', $a1);
        $this->assertSame($shown['proposal_number'], $row['proposal_number']);
        $this->assertSame('MANUAL', $row['source_type']);
        $this->as($this->retail)->getJson('/api/applications?listing=xyz')->assertUnprocessable();

        // the pipeline runs through the representative only
        $this->as($this->teknik)->postJson("/api/applications/{$a2}/surveys", [])->assertStatus(409);
        $this->as($this->teknik)->postJson("/api/applications/{$a1}/surveys", [])->assertCreated();
        $a5 = $this->extraApplication('PT Tambahan', 66);
        $this->as($this->retail)->postJson("/api/proposals/{$id}/members", ['application_ids' => [$a5]])->assertUnprocessable();   // a reason is required
        $this->as($this->retail)->postJson("/api/proposals/{$id}/members", ['application_ids' => [$a5], 'reason' => 'Pelanggan baru satu jalur'])->assertOk();
        $this->as($this->retail)->postJson("/api/proposals/{$id}/members/{$a1}/remove", ['reason' => 'x'])->assertStatus(409);     // the representative stays
        $this->as($this->retail)->postJson("/api/proposals/{$id}/members/{$a5}/remove", ['reason' => 'Salah pilih'])->assertOk();
        $this->assertSame(2, DB::table('proposal_applications')->where('proposal_id', $id)->whereNull('released_at')->count());
        $this->assertSame(['CREATED', 'MEMBER_ADDED', 'MEMBER_REMOVED'], DB::table('proposal_events')->where('proposal_id', $id)->orderBy('occurred_at')->pluck('event_type')->all());
        $this->assertContains($a5, array_column($sel()->json('data'), 'id'));                                              // a released customer is selectable again
        $this->as($this->retail)->postJson("/api/proposals/{$id}/cancel", ['reason' => 'Dibatalkan'])->assertOk();
        $this->assertSame([], DB::table('proposal_applications')->where('proposal_id', $id)->whereNull('released_at')->pluck('id')->all());
        $this->as($this->retail)->postJson("/api/proposals/{$id}/cancel", ['reason' => 'lagi'])->assertStatus(409);
    }

    #[Test]
    public function one_kkf_run_covers_all_the_customers_of_a_proposal_with_power_weighted_averages_and_summed_connection_fees(): void
    {
        $p = $this->approvedPackageWithPbpd();
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);
        $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs")->assertCreated();
        $rep = (string) DB::table('mto_packages')->where('id', $p)->value('application_id');
        DB::table('applications')->where('id', $rep)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA', 'delta_power_kva' => 16.5, 'total_cost' => 12000, 'sar_package' => 'Prabayar (Prepaid) Satu Arah']);
        $a2 = $this->extraApplication('CV Berkah Sentosa', 41.5);
        DB::table('applications')->where('id', $a2)->update(['delta_power_kva' => 20, 'total_cost' => 20000]);
        $this->kkfSources(true, true, [['power_va' => 41500, 'price' => 1200, 'jam' => 90]]);

        $prop = $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$rep, $a2]])->assertCreated()->json('data.id');
        $this->as($this->perencanaan)->postJson("/api/applications/{$rep}/kkf-runs", ['dry_run' => 1])->assertStatus(409);        // a member is calculated through its proposal
        $this->as($this->vendor)->postJson("/api/proposals/{$prop}/kkf-runs", [])->assertForbidden();
        $dry = $this->as($this->perencanaan)->postJson("/api/proposals/{$prop}/kkf-runs", ['dry_run' => 1])->assertOk()->assertJsonPath('stored', false);
        $in = $dry->json('data.inputs');
        $this->assertEquals(36.5, $in['power_kva']);                                                                            // 16.5 + 20 kVA
        $this->assertEquals(32000, $in['connection_fee']);                                                                      // 12.000 + 20.000 (prepaid: no UJL deduction)
        $energyBase = 16.5 * 117 + 20 * 90;
        $this->assertEqualsWithDelta($energyBase / 36.5, $in['jam_nyala'], 1e-9);                                               // power-weighted jam nyala
        $this->assertEqualsWithDelta((16.5 * 117 * 1444.7 + 20 * 90 * 1200) / $energyBase, $in['avg_price'], 1e-9);              // energy-weighted price
        $expectedEnergy = (16.5 / 1000 * 117 + 20 / 1000 * 90) * 12;                                                            // MWh per year = the sum of the customers'
        $this->assertEqualsWithDelta($expectedEnergy, $dry->json('data.result.years.1.energy_sold_mwh'), 1e-9);
        $this->assertCount(2, $dry->json('data.sources.members'));
        $this->assertSame($prop, $dry->json('data.sources.proposal_id'));

        $run = $this->as($this->perencanaan)->postJson("/api/proposals/{$prop}/kkf-runs", [])->assertCreated();
        $this->assertSame($dry->json('data.snapshot_hash'), $run->json('data.snapshot_hash'));
        $this->assertSame($prop, DB::table('kkf_runs')->where('id', $run->json('data.id'))->value('proposal_id'));
        $this->as($this->teknik)->getJson("/api/proposals/{$prop}/kkf-runs")->assertOk()->assertJsonCount(1, 'data');
        $doc = $this->as($this->teknik)->getJson('/api/kkf-runs/'.$run->json('data.id').'/documents/kkf')->assertOk()->json('data');
        $this->assertContains('PELANGGAN DALAM USULAN', array_column($doc['sections'], 'heading'));
        $this->assertStringContainsString('CV Berkah Sentosa', collect($doc['sections'][0]['pairs'])->firstWhere(0, 'Nama')[1]);

        $this->as($this->perencanaan)->postJson("/api/proposals/{$prop}/kkf-runs", ['dry_run' => 1, 'members' => [['application_id' => (string) Str::uuid()]]])->assertStatus(409);   // not a member
        DB::table('applications')->where('id', $a2)->update(['total_cost' => null]);
        $this->as($this->perencanaan)->postJson("/api/proposals/{$prop}/kkf-runs", ['dry_run' => 1])->assertStatus(409);        // a member without synced total cost blocks the whole KKF
    }

    #[Test]
    public function a_proposal_wo_is_completed_only_when_every_customer_has_reached_peremajaan(): void
    {
        [$wo, $rep, $konstruksi, $asman] = $this->woAtFullProgress();
        DB::table('applications')->where('id', $rep)->update(['new_tariff_code' => 'R1', 'new_power_value' => 33, 'new_power_unit' => 'kVA']);
        $a2 = $this->extraApplication('CV Berkah Sentosa', 41.5);
        $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$rep, $a2]])->assertCreated();
        $bastp = $this->bastpReadyToClose($wo, $konstruksi);
        $peremajaan = fn (string $app) => DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'external_system' => 'EIS_AP2T', 'external_status_code' => 'PEREMAJAAN', 'external_status_name' => 'Peremajaan', 'received_at' => now()]);
        $peremajaan($rep);
        $r = $this->as($asman)->postJson("/api/bastp/{$bastp}/close", ['password' => 'secret-password'])->assertStatus(409);
        $this->assertStringContainsString((string) DB::table('applications')->where('id', $a2)->value('application_number'), $r->json('message'));   // names the customer still missing
        $this->assertSame('IN_PROGRESS', DB::table('work_orders')->where('id', $wo)->value('status'));
        $peremajaan($a2);
        $this->as($asman)->postJson("/api/bastp/{$bastp}/close", ['password' => 'secret-password'])->assertOk();
        $this->assertSame('COMPLETED', DB::table('work_orders')->where('id', $wo)->value('status'));
    }

    #[Test]
    public function the_planning_access_endpoint_tells_each_role_its_stage_5_to_8_capabilities_and_the_vendor_portal(): void
    {
        [$app, $konstruksi, $asman] = $this->woFixture();
        $can = fn (User $u) => $this->as($u)->getJson('/api/planning/access')->assertOk()->json('can');
        $perencanaan = $can($this->perencanaan);
        $this->assertTrue($perencanaan['rab.run']);
        $this->assertTrue($perencanaan['allocations.poles']);
        $this->assertFalse($perencanaan['allocations.manage']);                       // materials are the Konstruksi/Gudang part
        $this->assertFalse($perencanaan['vendor.portal']);
        $kons = $can($konstruksi);
        $this->assertTrue($kons['allocations.manage']);
        $this->assertTrue($kons['wo.create']);
        $this->assertTrue($kons['rkm.validate_konstruksi']);
        $this->assertFalse($kons['wo.issue']);                                        // ASMAN issues
        $this->assertTrue($can($asman)['wo.issue']);
        $this->assertTrue($can($asman)['bastp.close']);
        $teknik = $can($this->teknik);
        $this->assertTrue($teknik['rkm.prepare']);
        $this->assertTrue($teknik['proposals.manage']);
        $this->assertFalse($teknik['rab.run']);
        $vendor = $can($this->vendor);
        $this->assertTrue($vendor['vendor.portal']);                                  // the linked vendor account of the fixture
        $this->assertNotContains(true, array_values(array_diff_key($vendor, ['vendor.portal' => 1])));   // and no key at all
        $this->assertFalse($can($this->retail)['vendor.portal']);
        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->getJson('/api/planning/access')->assertUnauthorized();
    }

    #[Test]
    public function the_critical_stock_report_uses_the_latest_snapshot_the_monthly_usage_as_minimum_and_the_arrivals_of_the_month(): void
    {
        [$app, $konstruksi] = $this->woFixture();
        $line = $this->plnLine($app);
        $a = $line->khs_item_id;
        $b = (string) Str::uuid();
        DB::table('khs_items')->insert(['id' => $b, 'code' => 'ZZ-B', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD-CS', 'name' => 'Gd Kritis', 'organizational_unit_id' => $this->ulpA->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $snapshot = function (string $asOf, array $lines) use ($wh, $konstruksi) {
            $sid = (string) Str::uuid();
            DB::table('stock_snapshots')->insert(['id' => $sid, 'warehouse_id' => $wh, 'as_of' => $asOf, 'materials_total' => count($lines), 'materials_mapped' => count($lines), 'created_by' => $konstruksi->getKey(), 'created_at' => now()]);
            foreach ($lines as $khs => [$onHand, $incoming]) {
                DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $sid, 'khs_item_id' => $khs, 'on_hand' => $onHand, 'reserved' => 0, 'incoming_confirmed' => $incoming, 'safety_stock' => 0]);
            }
        };
        $today = now(config('distriva.business_timezone'))->toDateString();
        $snapshot(now(config('distriva.business_timezone'))->subDays(40)->toDateString(), [$a => [1000, 0]]);   // an old snapshot is not summed in
        $snapshot($today, [$a => [4, 0], $b => [4, 10]]);
        $pkg = (string) DB::table('mto_packages')->where('application_id', $app)->value('id');
        $alloc = (string) Str::uuid();
        DB::table('allocations')->insert(['id' => $alloc, 'application_id' => $app, 'mto_package_id' => $pkg, 'version_number' => 1, 'status' => 'DRAFT', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ([$a, $b] as $khs) {
            DB::table('allocation_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $alloc, 'khs_item_id' => $khs, 'warehouse_id' => $wh, 'quantity' => 18]);   // 18 in 3 months = 6 a month
        }
        DB::table('allocations')->where('id', $alloc)->update(['materials_confirmed_by' => $konstruksi->getKey(), 'materials_confirmed_at' => now()->subDays(20)]);
        // KHS B was also handed over (TUG 7): 30 in the window = 10 a month, which replaces the allocation as its usage
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $mr = (string) Str::uuid();
        DB::table('material_requests')->insert(['id' => $mr, 'work_order_id' => $wo, 'application_id' => $app, 'idempotency_key' => 'k-'.$mr, 'payload' => '{}', 'payload_hash' => 'h', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $sh = (string) Str::uuid();
        DB::table('material_request_shipments')->insert(['id' => $sh, 'material_request_id' => $mr, 'application_id' => $app, 'sequence' => 1, 'reference' => 'TUG7-1', 'sent_by' => $konstruksi->getKey(), 'sent_at' => now()->subDays(5)]);
        DB::table('material_request_shipment_lines')->insert(['id' => (string) Str::uuid(), 'shipment_id' => $sh, 'khs_item_id' => $b, 'khs_code' => 'ZZ-B', 'khs_name' => 'B', 'unit_text' => 'BTG', 'warehouse_id' => $wh, 'quantity' => 30]);
        DB::table('khs_item_versions')->where('khs_item_id', $a)->exists() || DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $a, 'version_number' => 1, 'name' => 'Material A', 'unit_text' => 'BTG', 'status' => 'ACTIVE', 'valid_from' => '2026-01-01', 'created_at' => now(), 'updated_at' => now()]);

        $rows = collect($this->as($konstruksi)->getJson('/api/reports/critical-stock')->assertOk()->json('data.rows'))->keyBy('khs_id');
        $this->assertEquals(6, $rows[$a]['monthly_usage']);                             // no handover: the allocation
        $this->assertEquals(10, $rows[$b]['monthly_usage']);                            // handed over: the shipments
        $this->assertEquals(4, $rows[$a]['on_hand']);                                   // latest snapshot only
        $this->assertSame('CRITICAL', $rows[$a]['stock_status']);                       // 4 < 6 and nothing arriving
        $this->assertEquals(2, $rows[$a]['shortage']);
        $this->assertSame('WARNING', $rows[$b]['stock_status']);                         // 4 < 6 now, but 4 + 10 arriving covers the minimum
        $this->assertEquals(14, $rows[$b]['projected']);
        $this->assertSame('CRITICAL', $this->as($konstruksi)->getJson('/api/reports/critical-stock')->json('data.rows.0.stock_status'));   // critical first

        // real issues mirrored from MIMS: they count first, and a TUG 7 shipment whose reference is a mirrored reservation is the same issue (not counted twice)
        foreach ([[$a, '90000001'], [$b, '90000002']] as [$khs, $sku]) {
            DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $khs, 'material_no' => $sku, 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        }
        $mirror = fn (string $reservation, string $sku, float $qty) => DB::table('mims_issue_lines')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh, 'reservation_no' => $reservation, 'material_no' => $sku, 'quantity' => $qty]);
        foreach (['TUG7-1', 'RES-2'] as $res) {
            DB::table('mims_issue_documents')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh, 'material_document' => 'MD-'.$res, 'reservation_no' => $res, 'issued_on' => now()->subDays(3)->toDateString(), 'fetched_at' => now()]);
        }
        $mirror('TUG7-1', '90000002', 45);   // the same issue as the TUG 7 shipment of 30: 45 counts, not 75
        $mirror('RES-2', '90000001', 12);
        $rows = collect($this->as($konstruksi)->getJson('/api/reports/critical-stock')->assertOk()->json('data.rows'))->keyBy('khs_id');
        $this->assertEquals(4, $rows[$a]['monthly_usage']);                             // 12 issued per MIMS in 3 months
        $this->assertEquals(15, $rows[$b]['monthly_usage']);                            // 45, once
    }

    #[Test]
    public function the_vendor_report_scores_completion_quality_and_reporting_discipline_within_the_period_and_scope(): void
    {
        [$app, $konstruksi, , $company] = $this->woFixture();
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        DB::table('work_orders')->where('id', $wo)->update(['vendor_company_id' => $company, 'status' => 'ISSUED', 'issued_by' => $konstruksi->getKey(), 'issued_at' => now()->subDays(10)]);   // running for 10 days without any report

        $row = fn (string $q = '') => collect($this->as($konstruksi)->getJson("/api/reports/vendor-performance{$q}")->assertOk()->json('data'))->firstWhere('vendor_id', $company);
        $r = $row();
        $this->assertSame(1, $r['total_wo']);
        $this->assertSame(1, $r['in_progress_wo']);
        $this->assertSame(1, $r['stale_wo']);                                                                    // no report for more than 7 days
        $this->assertEquals(31, $r['score']);                                                                    // default weights 40/20/25/15: only quality (25 of 80 in use) counts, no target yet
        $this->assertNull($r['on_time_rate']);
        $this->assertSame('PERLU_PEMBINAAN', $r['rating']);
        $this->assertSame(0, $row('?from='.now()->addDay()->toDateString())['total_wo']);                         // outside the period
        $this->assertNull($row('?from='.now()->addDay()->toDateString())['score']);

        // the target date: set by Konstruksi, a change after issue needs a reason and is kept in the history
        $this->as($this->vendor)->putJson("/api/work-orders/{$wo}/target-date", ['target_date' => '2026-11-01'])->assertForbidden();
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/target-date", ['target_date' => 'besok'])->assertUnprocessable();
        $past = now(config('distriva.business_timezone'))->subDays(3)->toDateString();
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/target-date", ['target_date' => $past])->assertOk();            // none before: no reason needed
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/target-date", ['target_date' => $past])->assertStatus(409);       // a change of a running WO needs a reason
        $this->assertSame($past, $this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.target_date'));
        $r = $row();
        $this->assertSame(1, $r['overdue_wo']);                                                                  // running past the target
        $this->assertEquals(0, $r['on_time_rate']);
        $this->assertEquals(3, $r['avg_delay_days']);
        $this->assertEquals(25, $r['score']);                                                                    // timeliness 0 now counts: 25 / 100

        // the administrator sets the parameters: weights must total 100, the good limit above the fair one
        $url = '/api/reports/settings';
        $body = fn (array $v = [], array $st = []) => ['stock' => $st + ['usage_months' => 6, 'warning_factor' => 2], 'vendor' => $v + ['weight_completion' => 10, 'weight_timeliness' => 10, 'weight_quality' => 70, 'weight_discipline' => 10, 'stale_days' => 14, 'good_min' => 90, 'fair_min' => 50]];
        $this->assertFalse($this->as($konstruksi)->getJson($url)->assertOk()->json('data.can_edit'));
        $this->as($konstruksi)->putJson($url, $body())->assertForbidden();
        $this->as($this->admin)->putJson($url, $body(['weight_quality' => 60]))->assertStatus(409);
        $this->as($this->admin)->putJson($url, $body(['good_min' => 40]))->assertStatus(409);
        $this->as($this->admin)->putJson($url, $body(['stale_days' => 0]))->assertUnprocessable();
        $this->as($this->admin)->putJson($url, $body())->assertOk();
        $this->assertSame(6, $this->as($konstruksi)->getJson($url)->json('data.stock.usage_months'));
        $r = $row();
        $this->assertEquals(80, $r['score']);                                                                    // quality 70 + discipline 10 (no longer stale) of 100
        $this->assertSame(0, $r['stale_wo']);                                                                    // 10 days without a report is within 14
        $this->assertSame('CUKUP', $r['rating']);
        $this->as($this->vendor)->getJson('/api/reports/vendor-performance')->assertForbidden();
    }

    #[Test]
    public function an_issued_work_order_puts_its_material_need_in_the_outbox_with_skus_warehouse_and_poles_and_it_can_be_exported_and_marked_sent(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $line = $this->plnLine($app);
        DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $line->khs_item_id, 'material_no' => '3110025', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->ulpA->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $kr = (string) Str::uuid();
        DB::table('pole_contracts')->insert(['id' => $kr, 'kr_number' => 'KR-777', 'qty_tm' => 10, 'qty_tr' => 5, 'status' => 'ACTIVE', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $pkg = (string) DB::table('mto_packages')->where('application_id', $app)->value('id');
        $alloc = (string) Str::uuid();
        DB::table('allocations')->insert(['id' => $alloc, 'application_id' => $app, 'mto_package_id' => $pkg, 'version_number' => 1, 'status' => 'DRAFT', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('allocation_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $alloc, 'khs_item_id' => $line->khs_item_id, 'warehouse_id' => $wh, 'quantity' => 2]);
        DB::table('allocation_pole_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $alloc, 'pole_contract_id' => $kr, 'pole_type' => 'TM', 'quantity' => 3]);
        DB::table('allocations')->where('id', $alloc)->update(['materials_confirmed_by' => $konstruksi->getKey(), 'materials_confirmed_at' => now(), 'poles_confirmed_by' => $this->perencanaan->getKey(), 'poles_confirmed_at' => now(), 'status' => 'CONFIRMED', 'confirmed_by' => $this->perencanaan->getKey(), 'confirmed_at' => now()]);

        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->assertSame(0, DB::table('material_requests')->count());                                              // nothing before the WO is issued
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $this->assertSame(1, DB::table('material_requests')->count());                                              // the outbox entry is created with the issue
        $id = (string) DB::table('material_requests')->value('id');

        $this->as($this->vendor)->getJson('/api/material-requests')->assertForbidden();
        $this->as($this->managerB)->getJson("/api/material-requests/{$id}")->assertNotFound();
        $list = $this->as($konstruksi)->getJson('/api/material-requests?status=PENDING')->assertOk()->json('data');
        $this->assertCount(1, $list);
        $shown = $this->as($konstruksi)->getJson("/api/material-requests/{$id}")->assertOk()->json('data');
        $this->assertSame('PENDING', $shown['status']);
        $this->assertSame(DB::table('work_orders')->where('id', $wo)->value('wo_number'), $shown['idempotency_key']);
        $m = collect($shown['payload']['materials'])->firstWhere('khs_code', (string) $line->khs_code);
        $this->assertSame(['3110025'], $m['skus']);                                                                  // the KHS item's ERP material number
        $this->assertEquals(2, $m['allocation'][0]['quantity']);                                                     // the frozen payload keeps what was allocated at the issue
        $this->assertSame('2810', $m['allocation'][0]['stor_loc']);
        $this->assertSame('PLN', $m['supplier']);
        $this->assertEquals([['kr_number' => 'KR-777', 'pole_type' => 'TM', 'quantity' => 3]], $shown['payload']['poles']);

        // the live position carries PLN material only: vendor-supplied material is counted, not listed
        $pos = $shown['position'];
        $codes = collect($pos['materials'])->pluck('khs_code')->all();
        $vendorCodes = collect($shown['payload']['materials'])->where('supplier', 'VENDOR')->reject(fn ($x) => str_starts_with(strtolower((string) $x['name']), 'tiang beton'))->pluck('khs_code')->all();   // poles go by the pole allocation
        $this->assertNotEmpty($vendorCodes);
        $this->assertSame([], array_values(array_intersect($vendorCodes, $codes)));
        $this->assertSame(count($vendorCodes), $pos['vendor_count']);
        $row = collect($pos['materials'])->firstWhere('khs_code', (string) $line->khs_code);
        $this->assertEquals(min($this->needOf($app, $line->khs_item_id), 2.0), $row['ready']);                         // allocated and not sent yet
        $this->assertSame('NONE', $pos['fulfilment']);
        $this->assertTrue($pos['ready_to_send']);
        $this->assertNotContains((string) $line->khs_code, $shown['unmapped_khs']);                                  // the item with an ERP number is not reported
        $this->assertSame(collect($pos['materials'])->filter(fn ($x) => empty($x['skus']))->pluck('khs_code')->values()->all(), array_values($shown['unmapped_khs']));   // the PLN rest is

        $this->as($this->teknik)->get("/api/material-requests/{$id}/export")->assertForbidden();                      // exporting is the Konstruksi/Gudang action
        $this->as($konstruksi)->get("/api/material-requests/{$id}/export?format=pdf")->assertStatus(422);
        $csv = $this->as($konstruksi)->get("/api/material-requests/{$id}/export?format=csv")->assertOk();
        $this->assertStringContainsString('no_material_erp', $csv->getContent());
        $this->assertStringContainsString('penyedia', $csv->getContent());
        $this->assertStringContainsString('penyerahan_ke', $csv->getContent());
        $fileCodes = array_filter(array_column(array_slice(array_map('str_getcsv', array_filter(explode("\n", $csv->getContent()))), 1), 2));   // the kode_khs column
        $this->assertSame([], array_values(array_intersect($vendorCodes, $fileCodes)));                              // vendor-supplied material is not handed to the material application
        $this->assertSame([(string) $line->khs_code], array_values(array_unique($fileCodes)));                       // only what is allocated
        $this->assertStringContainsString('3110025', $csv->getContent());
        $this->assertStringContainsString('KR-777', $csv->getContent());
        $this->as($konstruksi)->get("/api/material-requests/{$id}/export?format=xlsx")->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $this->assertSame('EXPORTED', DB::table('material_requests')->where('id', $id)->value('status'));
        $this->assertSame(1, DB::table('material_request_events')->where('material_request_id', $id)->where('event_type', 'EXPORTED')->count());   // only the first export is an event
        $this->as($konstruksi)->postJson("/api/material-requests/{$id}/mark-sent", [])->assertUnprocessable();
        $sent = $this->as($konstruksi)->postJson("/api/material-requests/{$id}/mark-sent", ['reference' => 'NODIN-MIMS-123'])->assertOk()->json('data');
        $this->assertSame(1, $sent['sequence']);
        $this->as($konstruksi)->postJson("/api/material-requests/{$id}/cancel", ['reason' => 'x'])->assertStatus(409);        // sent: cannot be cancelled
        try {
            DB::transaction(fn () => DB::table('material_requests')->where('id', $id)->update(['payload' => '{}']));
            $this->fail('the frozen payload must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        // the WO is cancelled after the request was sent: flagged for follow-up, not cancelled
        $this->as($asman)->postJson("/api/work-orders/{$wo}/cancel", ['reason' => 'Permohonan dibatalkan'])->assertOk();
        $row = DB::table('material_requests')->where('id', $id)->first();
        $this->assertSame('SENT', $row->status);
        $this->assertTrue((bool) $row->needs_followup);
        $this->as($konstruksi)->getJson('/api/material-requests?followup=1')->assertOk()->assertJsonCount(1, 'data');
    }

    /** A PLN-supplied material (not a pole) of the approved MTO of the application. */
    private function plnLine(string $app, float $minNeed = 0.0): object
    {
        $pkg = (string) DB::table('mto_packages')->where('application_id', $app)->where('status', 'APPROVED')->orderByDesc('created_at')->value('id');
        $lines = DB::table('mto_lines')->where('package_id', $pkg)->where('material', '>', 0)->whereRaw("khs_name not ilike 'Tiang Beton%'")->orderBy('khs_code')->get()->unique('khs_item_id');
        $supplier = MaterialSupplier::of($pkg, $lines->pluck('khs_item_id')->all());

        return $lines->first(fn ($l) => ($supplier[$l->khs_item_id] ?? null) === 'PLN' && $this->needOf($app, $l->khs_item_id) >= $minNeed) ?? $this->fail('the fixture has no PLN material of that size');
    }

    private function needOf(string $app, string $khsItemId): float
    {
        $pkg = (string) DB::table('mto_packages')->where('application_id', $app)->where('status', 'APPROVED')->orderByDesc('created_at')->value('id');

        return (float) DB::table('mto_lines')->where('package_id', $pkg)->where('khs_item_id', $khsItemId)->sum('material');
    }

    #[Test]
    public function the_outbox_ships_in_stages_only_the_allocated_pln_material_and_follows_the_latest_mto(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $line = $this->plnLine($app, 2.0);
        $need = $this->needOf($app, $line->khs_item_id);
        $firstQty = $need - 1.0;                                                                                     // one short: the rest arrives later
        DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $line->khs_item_id, 'material_no' => '3110099', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2811', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->ulpA->getKey(), 'plant' => '5118', 'stor_loc' => '2811', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $pkg = (string) DB::table('mto_packages')->where('application_id', $app)->value('id');
        $confirm = fn (string $alloc) => DB::table('allocations')->where('id', $alloc)->update(['materials_confirmed_by' => $konstruksi->getKey(), 'materials_confirmed_at' => now(), 'poles_confirmed_by' => $this->perencanaan->getKey(), 'poles_confirmed_at' => now(), 'status' => 'CONFIRMED', 'confirmed_by' => $this->perencanaan->getKey(), 'confirmed_at' => now()]);
        $allocate = function (int $version, float $qty, ?string $parent) use ($app, $pkg, $konstruksi, $line, $wh, $confirm): string {
            $alloc = (string) Str::uuid();
            DB::table('allocations')->insert(['id' => $alloc, 'application_id' => $app, 'mto_package_id' => $pkg, 'version_number' => $version, 'parent_allocation_id' => $parent, 'status' => 'DRAFT', 'created_by' => $konstruksi->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            DB::table('allocation_lines')->insert(['id' => (string) Str::uuid(), 'allocation_id' => $alloc, 'khs_item_id' => $line->khs_item_id, 'warehouse_id' => $wh, 'quantity' => $qty]);
            $confirm($alloc);

            return $alloc;
        };
        $base = $allocate(1, $firstQty, null);

        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $id = (string) DB::table('material_requests')->value('id');
        $position = fn () => $this->as($konstruksi)->getJson("/api/material-requests/{$id}")->assertOk()->json('data.position');
        $item = fn (array $p) => collect($p['materials'])->firstWhere('khs_code', (string) $line->khs_code);

        // 1. only PLN material, and what is allocated is ready; the rest waits
        $p = $position();
        $this->assertSame('NONE', $p['fulfilment']);
        $this->assertTrue($p['ready_to_send']);
        $this->assertEquals([$need, $firstQty, 0.0, $firstQty, 1.0], [$item($p)['need'], $item($p)['allocated'], $item($p)['shipped'], $item($p)['ready'], $item($p)['waiting']]);
        $this->assertSame('READY', $item($p)['status']);
        $this->assertSame(['ready_to_send' => true, 'fulfilment' => 'NONE'], ['ready_to_send' => (bool) DB::table('material_requests')->where('id', $id)->value('ready_to_send'), 'fulfilment' => DB::table('material_requests')->where('id', $id)->value('fulfilment')]);   // the stored summary is current

        // 2. the first shipment sends exactly the allocated quantity, under its own reference
        $first = $this->as($konstruksi)->postJson("/api/material-requests/{$id}/mark-sent", ['reference' => 'ND-1'])->assertOk()->json('data');
        $this->assertEquals(['sequence' => 1, 'lines' => 1, 'quantity' => $firstQty], $first);
        $p = $position();
        $this->assertSame('PARTIAL', $p['fulfilment']);
        $this->assertFalse($p['ready_to_send']);
        $this->assertEquals([$firstQty, 0.0, 1.0], [$item($p)['shipped'], $item($p)['ready'], $item($p)['waiting']]);
        $this->assertSame('WAITING', $item($p)['status']);
        $this->as($konstruksi)->postJson("/api/material-requests/{$id}/mark-sent", ['reference' => 'ND-X'])->assertStatus(409);   // nothing new to send
        $this->as($konstruksi)->get("/api/material-requests/{$id}/export?format=csv")->assertStatus(409);

        // 3. the rest arrives as a top-up: the SAME request (same WO number) shows it ready again
        $allocate(2, 1.0, $base);
        MaterialOutbox::refresh($app);
        $this->assertSame(1, DB::table('material_requests')->count());
        $this->assertTrue((bool) DB::table('material_requests')->where('id', $id)->value('ready_to_send'));
        $this->assertSame('SENT', DB::table('material_requests')->where('id', $id)->value('status'));
        $this->assertTrue($this->as($konstruksi)->getJson('/api/material-requests?application_id='.$app)->json('data.0.ready_to_send'));
        $this->assertTrue($this->as($konstruksi)->getJson('/api/work-orders/by-agenda?application_id='.$app)->json('data.0.material_request.ready_to_send'));
        $csv = $this->as($konstruksi)->get("/api/material-requests/{$id}/export?format=csv")->assertOk()->getContent();
        $data = array_slice(array_map('str_getcsv', array_filter(explode("\n", $csv))), 1);
        $this->assertCount(1, $data);
        $this->assertEquals([1.0, 2], [(float) $data[0][10], (int) $data[0][14]]);                                   // only the missing quantity, as shipment 2 (jumlah_alokasi, penyerahan_ke)
        $second = $this->as($konstruksi)->postJson("/api/material-requests/{$id}/mark-sent", ['reference' => 'ND-2'])->assertOk()->json('data');
        $this->assertEquals(['sequence' => 2, 'lines' => 1, 'quantity' => 1.0], $second);
        $shown = $this->as($konstruksi)->getJson("/api/material-requests/{$id}")->json('data');
        $this->assertSame('COMPLETE', $shown['position']['fulfilment']);
        $this->assertSame(['ND-1', 'ND-2'], array_column($shown['shipments'], 'reference'));                         // each shipment keeps its own reference
        $this->assertEquals([$firstQty, 1.0], [$shown['shipments'][0]['lines'][0]['quantity'], $shown['shipments'][1]['lines'][0]['quantity']]);
        $this->assertNotEmpty($shown['handover_form']['wo_number']);   // the data of the TUG 7 handover form travels with the request
        $this->assertNotEmpty($shown['handover_form']['application_number']);
        $this->assertArrayHasKey('skus', $shown['shipments'][0]['lines'][0]);
        $this->assertNotEmpty($shown['shipments'][0]['lines'][0]['plant']);
        $this->assertSame('ND-2', $shown['external_reference']);
        $this->assertFalse((bool) DB::table('material_requests')->where('id', $id)->value('ready_to_send'));
        $this->assertSame('COMPLETE', DB::table('material_requests')->where('id', $id)->value('fulfilment'));
        $this->assertSame(2, DB::table('material_request_events')->where('material_request_id', $id)->where('event_type', 'SENT')->count());

        // shipments are append-only
        try {
            DB::transaction(fn () => DB::table('material_request_shipments')->update(['reference' => 'x']));
            $this->fail('shipments must be append-only');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        // 4. method B: the need follows the latest approved MTO without amending the WO — less need than was sent is flagged
        $this->assertSame($pkg, $shown['position']['package_id']);
        $newPkg = (string) Str::uuid();
        $copy = (array) DB::table('mto_packages')->where('id', $pkg)->first();
        $dv = (array) DB::table('application_drawing_versions')->where('id', $copy['drawing_version_id'])->first();   // a revised MTO belongs to a new drawing version
        $newDv = (string) Str::uuid();
        DB::table('application_drawing_versions')->insert(array_merge($dv, ['id' => $newDv, 'status' => 'SUPERSEDED', 'stage' => null, 'superseded_at' => now(), 'version_number' => ((int) DB::table('application_drawing_versions')->where('drawing_id', $dv['drawing_id'])->max('version_number')) + 1]));
        DB::table('mto_packages')->insert(array_merge($copy, ['id' => $newPkg, 'drawing_version_id' => $newDv, 'package_number' => $copy['package_number'].'-R2', 'status' => 'DRAFT', 'valid_on' => null, 'snapshot_hash' => null, 'verified_by' => null, 'verified_at' => null, 'approved_by' => null, 'approved_at' => null, 'created_at' => now()->addMinute(), 'updated_at' => now()->addMinute()]));
        foreach (DB::table('mto_lines')->where('package_id', $pkg)->get() as $l) {
            $row = (array) $l;
            $row['id'] = (string) Str::uuid();
            $row['package_id'] = $newPkg;
            if ($l->khs_item_id === $line->khs_item_id) {
                $row['material'] = (float) $l->material / max(1.0, $need) * ($need - 1.0);
            }
            DB::table('mto_lines')->insert($row);
        }
        DB::table('mto_packages')->where('id', $newPkg)->update(['status' => 'VERIFIED', 'valid_on' => $copy['valid_on'], 'snapshot_hash' => $copy['snapshot_hash'], 'verified_by' => $copy['verified_by'], 'verified_at' => $copy['verified_at']]);
        DB::table('mto_packages')->where('id', $newPkg)->update(['status' => 'APPROVED', 'approved_by' => $copy['approved_by'], 'approved_at' => now()]);
        MaterialOutbox::refresh($app);
        $p = $position();
        $this->assertSame($newPkg, $p['package_id']);
        $this->assertTrue($p['oversent']);
        $this->assertEquals(1.0, $item($p)['oversent']);
        $this->assertSame('OVERSENT', $item($p)['status']);
        $this->assertTrue($this->as($konstruksi)->getJson('/api/work-orders/by-agenda?application_id='.$app)->json('data.0.material_request.needs_followup'));
        $this->assertSame($wo, DB::table('material_requests')->where('id', $id)->value('work_order_id'));              // the WO itself was not amended
        $this->assertSame(1, (int) DB::table('work_orders')->where('application_id', $app)->count());
    }

    #[Test]
    public function a_superseded_or_cancelled_wo_closes_its_unsent_material_request_and_the_new_version_gets_its_own(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $v2 = $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/amend", ['reason' => 'Penambahan'])->assertCreated()->json('data.id');
        $this->as($konstruksi)->postJson("/api/work-orders/{$v2}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$v2}/decision", ['decision' => 'ISSUE'])->assertOk();
        $this->assertSame(['SUPERSEDED', 'PENDING'], DB::table('material_requests')->orderBy('created_at')->orderBy('idempotency_key')->pluck('status')->all());
        $this->assertSame(2, DB::table('material_requests')->count());                                              // one per WO version, each with its own idempotency key
        $this->as($asman)->postJson("/api/work-orders/{$v2}/cancel", ['reason' => 'Batal'])->assertOk();
        $this->assertSame(['SUPERSEDED', 'CANCELLED'], DB::table('material_requests')->orderBy('created_at')->orderBy('idempotency_key')->pluck('status')->all());
    }

    #[Test]
    public function the_dashboard_and_pipeline_reports_count_the_stored_records_within_the_callers_scope(): void
    {
        [$wo, $app, $konstruksi, $asman] = $this->woAtFullProgress();
        $this->as($this->vendor)->getJson('/api/reports/overview')->assertForbidden();
        $o = $this->as($this->teknik)->getJson('/api/reports/overview')->assertOk()->json('data');
        $this->assertSame(1, $o['applications']['total']);
        $this->assertSame(1, $o['applications']['by_type']['PB']);
        $this->assertSame(1, $o['applications']['by_source']['MANUAL']);
        $this->assertSame(1, $o['mto']['by_status']['APPROVED']);
        $this->assertSame(1, $o['rab']['applications_with_run']);
        $this->assertGreaterThan(0, $o['rab']['total_value']);
        $this->assertSame(1, $o['work_orders']['by_status']['IN_PROGRESS']);
        $this->assertSame(1, $o['material_requests']['by_status']['PENDING']);
        $p = $this->as($this->perencanaan)->getJson('/api/reports/pipeline')->assertOk()->json('data');              // a UP3 role sees its child ULPs
        $row = collect($p)->firstWhere('unit_code', $this->ulpA->code);
        $this->assertSame([1, 1, 1, 1, 1, 0, 1, 0, 0], [$row['applications'], $row['with_survey'], $row['mto_approved'], $row['rab_run'], $row['wo_issued'], $row['wo_completed'], $row['wo_issued'], $row['bastp_closed'], $row['kkf_run']]);
        $this->assertNull(collect($p)->firstWhere('unit_code', $this->ulpB->code));                                      // another UP3's ULP is outside the scope
        $this->assertSame(0, $this->as($this->managerB)->getJson('/api/reports/overview')->assertOk()->json('data.applications.total'));
        $this->as($this->teknik)->getJson('/api/reports/overview?unit_id='.$this->ulpB->getKey())->assertNotFound();
        $this->assertSame(0, $this->as($this->teknik)->getJson('/api/reports/overview?from=2999-01-01')->assertOk()->json('data.applications.total'));   // the date filter
        $this->as($this->teknik)->getJson('/api/reports/overview?from=2026-02-01&to=2026-01-01')->assertUnprocessable();
        $this->as($this->teknik)->get('/api/reports/overview?format=xlsx')->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $this->as($this->perencanaan)->get('/api/reports/pipeline?format=xlsx')->assertOk();
    }

    #[Test]
    public function the_sr1ph_group_is_priced_like_any_other_group_and_stays_out_of_a_3_phase_job_until_its_bom_is_approved(): void
    {
        $khs = DB::table('khs_items')->pluck('id', 'code')->mapWithKeys(fn ($id, $c) => [(int) $c => $id])->all();
        $this->bom('SR1PH', [[9, 3, ['I' => '+{PARAM:SR1:SDES2}']], [10, 1, ['H' => '+{PARAM:SR1:SDES2}*2']]], $khs, [['name' => 'SR1:SDES2', 'cell' => 'AC51', 'default' => 0, 'group' => 'SR1PH']]);
        $p = $this->approvedPackageWithPbpd(['SR1:SDES2' => 2]);
        $this->priceBook([1 => ['PRICED', 1000, 50000, 100, 40], 2 => ['PLN', null, null, 200, 80], 3 => ['PRICED', 5000, null, 300, 0], 4 => ['PRICED', 10, null, 50, 5]]);

        $r = $this->as($this->perencanaan)->postJson("/api/mto/{$p}/rab-runs", ['dry_run' => 1])->assertOk();
        $this->assertNotNull($r->json('data.groups.SR1PH'), 'the SR1PH group has its own RAB group');
        $lines = collect($r->json('data.lines'))->where('group', 'SR1PH');
        $this->assertEquals(2, $lines->firstWhere('khs_code', '3')['qty_install']);          // Jasa Kegiatan: 2 customers
        $this->assertEquals(4, $lines->firstWhere('khs_code', '1')['qty_material']);         // 2 customers x 2
        $this->assertEquals(collect($r->json('data.groups'))->sum('total'), $r->json('data.grand_total'));
        $this->assertArrayNotHasKey('sr1', $r->json('data'));                                  // no separate SR1 schedule any more
    }

    private function writeXlsx(array $cells): string
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet()->setTitle('GAMBAR');
        foreach ($cells as $ref => $value) {
            $sheet->setCellValue($ref, $value);
        }
        $path = tempnam(sys_get_temp_dir(), 'gx');
        (new Xlsx($book))->save($path);

        return $path;
    }

    // ---- in-app notifications (docs/62 §44) -------------------------------------------------------------------------------

    #[Test]
    public function verifying_an_mto_asks_the_manager_of_that_ulp_and_the_decision_tells_the_verifier(): void
    {
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        [$p] = $this->filled();
        $others = [$this->managerB, $this->teknik, $this->teknik2, $this->perencanaan];
        $before = array_map(fn ($u) => $inbox($u)->count(), $others);                          // fixture noise (drawing assignment) is not under test
        $managerBefore = $inbox($this->manager)->count();
        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->assertSame($managerBefore + 1, $inbox($this->manager)->count());
        $asked = $inbox($this->manager)->first(fn ($n) => str_contains($n->title, 'menunggu persetujuan'));
        $this->assertNotNull($asked);
        $this->assertSame("/mto/{$p}", $asked->link);
        foreach ($others as $i => $other) {
            $this->assertSame($before[$i], $inbox($other)->count());                            // other ULP, the verifier himself, not an approver
        }

        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'REJECTED', 'notes' => 'Jumlah tiang belum sesuai gambar'])->assertOk();
        $back = $inbox($this->teknik)->first(fn ($n) => str_contains($n->title, 'dikembalikan'));
        $this->assertNotNull($back);
        $this->assertStringContainsString('Jumlah tiang belum sesuai gambar', $back->body);

        $this->as($this->teknik)->postJson("/api/mto/{$p}/verify")->assertOk();
        $this->as($this->manager)->postJson("/api/mto/{$p}/decision", ['decision' => 'APPROVED'])->assertOk();
        $this->assertNotNull($inbox($this->teknik)->first(fn ($n) => str_contains($n->title, 'disetujui') && $n->level === 'success'));
    }

    #[Test]
    public function the_work_order_flow_asks_the_asman_then_tells_konstruksi_the_vendor_and_the_verifiers(): void
    {
        [$app, $konstruksi, $asman, $company] = $this->woFixture();
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        $titled = fn (User $u, string $needle) => $inbox($u)->first(fn ($n) => str_contains($n->title, $needle));
        $wo = $this->as($konstruksi)->postJson("/api/applications/{$app}/work-orders")->assertCreated()->json('data.id');
        $this->as($konstruksi)->putJson("/api/work-orders/{$wo}/vendor", ['vendor_company_id' => $company, 'target_date' => '2027-01-31'])->assertOk();
        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->assertNotNull($titled($asman, 'menunggu persetujuan penerbitan'));
        $this->assertNull($titled($konstruksi, 'menunggu persetujuan penerbitan'));            // the actor
        $this->assertCount(0, $inbox($this->managerB));

        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'RETURN', 'reason' => 'Lengkapi catatan vendor'])->assertOk();
        $back = $titled($konstruksi, 'dikembalikan');
        $this->assertNotNull($back);
        $this->assertStringContainsString('Lengkapi catatan vendor', $back->body);

        $this->as($konstruksi)->postJson("/api/work-orders/{$wo}/submit")->assertOk();
        $this->as($asman)->postJson("/api/work-orders/{$wo}/decision", ['decision' => 'ISSUE'])->assertOk();
        $this->assertNotNull($titled($konstruksi, 'diterbitkan'));
        $this->assertNotNull($titled($this->vendor, 'diterbitkan untuk Anda'));                // the vendor's own account
        $this->assertNotNull($titled($konstruksi, 'Permintaan material'));                      // a new outbox item to send
        $this->assertCount(0, $inbox($this->managerB));

        $verifier = $this->makeUser();
        $this->assign($verifier, Role::query()->where('name', 'KONSTRUKSI_UP3')->firstOrFail(), $this->ulpA->parent);
        $task = $this->as($konstruksi)->getJson("/api/work-orders/{$wo}")->json('data.tasks.0.id');
        $id = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/progress", ['task_id' => $task, 'submission_key' => 'n1', 'cumulative_percent' => 40])->assertCreated()->json('data.id');
        $this->assertNotNull($titled($konstruksi, 'menunggu verifikasi'));
        $this->assertNotNull($titled($verifier, 'menunggu verifikasi'));
        $this->assertNull($titled($this->vendor, 'menunggu verifikasi'));
        $this->as($verifier)->postJson("/api/work-progress/{$id}/decision", ['decision' => 'RETURNED', 'reason' => 'Foto belum ada'])->assertOk();
        $ret = $titled($this->vendor, 'dikembalikan');
        $this->assertNotNull($ret);
        $this->assertStringContainsString('Foto belum ada', $ret->body);
    }

    #[Test]
    public function the_bastp_signature_chain_asks_each_next_holder_and_tells_the_vendor_on_return_and_closing(): void
    {
        [$wo, $app, $konstruksi, $asman] = $this->woAtFullProgress();
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        $titled = fn (User $u, string $needle) => $inbox($u)->first(fn ($n) => str_contains($n->title, $needle));
        $b = $this->as($this->vendor)->postJson("/api/work-orders/{$wo}/bastp")->assertCreated()->json('data.id');
        $this->fillBastp($b);
        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertOk();
        $this->assertNotNull($titled($this->manager, 'menunggu tanda tangan'));               // MANAGER_ULP accepts next
        $this->assertNull($titled($this->vendor, 'menunggu tanda tangan'));
        $this->assertCount(0, $inbox($this->managerB));

        $this->as($this->manager)->postJson("/api/bastp/{$b}/return", ['reason' => 'Nomor meter tertukar'])->assertOk();
        $ret = $titled($this->vendor, 'dikembalikan');
        $this->assertNotNull($ret);
        $this->assertStringContainsString('Nomor meter tertukar', $ret->body);

        $this->as($this->vendor)->postJson("/api/bastp/{$b}/submit", ['password' => 'secret-password'])->assertOk();
        $this->as($this->manager)->postJson("/api/bastp/{$b}/accept", ['password' => 'secret-password'])->assertOk();
        $this->assertNotNull($titled($konstruksi, 'menunggu tanda tangan'));                  // KONSTRUKSI_UP3 signs next
        $this->as($konstruksi)->postJson("/api/bastp/{$b}/sign", ['password' => 'secret-password'])->assertOk();
        $this->assertNotNull($titled($asman, 'menunggu tanda tangan'));                       // ASMAN_KONSTRUKSI closes last
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'external_system' => 'EIS_AP2T', 'external_status_code' => 'PEREMAJAAN', 'external_status_name' => 'Peremajaan', 'received_at' => now()]);
        $this->as($asman)->postJson("/api/bastp/{$b}/close", ['password' => 'secret-password'])->assertOk();
        $this->assertNotNull($titled($this->vendor, 'WO selesai'));
        $this->assertNotNull($titled($this->manager, 'WO selesai'));
        $this->assertNull($titled($asman, 'WO selesai'));                                     // the closer is the actor
    }
}
