<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class MasterDataBomTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $up3 = $this->makeUnit('UP3');
        $mk = function (string $role) use ($up3): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $up3);

            return $u;
        };
        $this->engineer = $mk('ASMAN_JARINGAN');
        $this->manager = $mk('MANAGER_UP3');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** @return array<string,mixed> */
    private function golden(): array
    {
        return json_decode((string) file_get_contents('compress.zlib://'.__DIR__.'/../fixtures/golden_bom_import.json.gz'), true, 512, JSON_THROW_ON_ERROR);
    }

    private function upload(array $doc, array $fields = [], ?User $by = null, bool $raw = false)
    {
        $body = $raw ? 'not json' : json_encode($doc);

        return $this->as($by ?? $this->engineer)->post('/api/master-data/bom/import', array_merge(['file' => UploadedFile::fake()->createWithContent('bom.json', $body), 'valid_from' => '2026-01-01'], $fields), ['Accept' => 'application/json']);
    }

    /** Approved KHS items and approved construction types (valid from 2025-01-01) for everything the docs use. */
    private function catalogue(array $docs): void
    {
        $by = $this->engineer->getKey();
        $codes = [];
        $types = [];
        foreach ($docs as $doc) {
            foreach ($doc['lines'] as $l) {
                if ($l['khs_code'] !== null) {
                    $codes[(string) $l['khs_code']] = true;
                }
                foreach ($l['khs_codes'] ?? [] as $c) {
                    $codes[(string) $c] = true;
                }
            }
            foreach ($doc['inputs'] as $in) {
                $types[$in['group']][$in['label']] = true;
            }
        }
        foreach (array_keys($codes) as $code) {
            $id = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $id, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => "KHS {$code}", 'unit_text' => 'B', 'valid_from' => '2025-01-01',
                'status' => 'APPROVED', 'created_by' => $by, 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        foreach ($types as $group => $labels) {
            $n = 0;
            foreach (array_keys($labels) as $label) {
                $id = (string) Str::uuid();
                DB::table('construction_types')->insert(['id' => $id, 'group_code' => $group, 'code' => sprintf('%s-%02d', $group, ++$n), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
                DB::table('construction_type_versions')->insert(['id' => (string) Str::uuid(), 'construction_type_id' => $id, 'version_number' => 1, 'name' => $label, 'valid_from' => '2025-01-01',
                    'status' => 'APPROVED', 'created_by' => $by, 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            }
        }
    }

    private function approve(string $id, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/bom/versions/approve', ['version_ids' => [$id], 'reason' => 'Sesuai workbook']);
    }

    /** A tiny BOM with the same shapes as the workbook: GAMBAR quantity, derived row, subtotal range, empty-cell test. */
    private function tiny(): array
    {
        return ['group' => 'SUTM', 'source' => 'unit test',
            'inputs' => [['cell' => 'U6', 'group' => 'SUTM', 'label' => 'A3C 150', 'kind' => 'PSG'], ['cell' => 'V6', 'group' => 'SUTM', 'label' => 'A3C 150', 'kind' => 'BKR']],
            'lines' => [
                ['sequence' => 9, 'khs_code' => 1, 'description' => 'Tiang', 'H' => '+I9', 'I' => 'TRUNC((GAMBAR!U6*1.02*3)/1)*1', 'J' => '+GAMBAR!V6', 'K' => '+J9'],
                ['sequence' => 10, 'khs_code' => 2, 'description' => 'Konduktor', 'I' => 'TRUNC((I9*1.01)/1)*1', 'H' => '+I10'],
                ['sequence' => 11, 'khs_code' => null, 'description' => 'Subtotal', 'I' => 'SUM(I9:I10)', 'H' => 'IF(B12="",0,I11)'],
                ['sequence' => 12, 'khs_code' => null, 'description' => 'Konstan', 'I' => '5'],
            ]];
    }

    // ---- authorization -----------------------------------------------------------------

    #[Test]
    public function the_bom_keys_follow_the_same_split_as_khs_and_sys_admin_holds_both(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['ASMAN_JARINGAN', 'PERENCANAAN', 'SYS_ADMIN'], $holders('bom.manage'));
        $this->assertSame(['MANAGER_UP3', 'SYS_ADMIN'], $holders('bom.approve'));
    }

    #[Test]
    public function endpoints_answer_403_without_the_grant_before_any_validation(): void
    {
        foreach ([$this->viewer, $this->vendor] as $u) {
            $this->as($u)->post('/api/master-data/bom/import', [], ['Accept' => 'application/json'])->assertForbidden();
            $this->as($u)->postJson('/api/master-data/bom/versions/approve', [])->assertForbidden();
        }
        $this->as($this->viewer)->getJson('/api/master-data/bom')->assertOk();
        $this->as($this->vendor)->getJson('/api/master-data/bom')->assertForbidden();
        $this->as($this->engineer)->postJson('/api/master-data/bom/versions/approve', [])->assertForbidden(); // manage != approve
    }

    // ---- import ---------------------------------------------------------------------------

    #[Test]
    public function import_translates_gambar_cells_to_variables_and_creates_one_draft(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);

        $this->upload($doc, ['dry_run' => 1])->assertOk()->assertJsonPath('data.accepted_lines', 4)->assertJsonPath('data.created', false);
        $this->assertSame(0, DB::table('bom_headers')->count());

        $res = $this->upload($doc)->assertCreated()->assertJsonPath('data.accepted_lines', 4)->assertJsonPath('data.with_khs', 2);
        $h = DB::table('bom_headers')->first();
        $this->assertSame(['DRAFT', 'SUTM', 1], [$h->status, $h->group_code, $h->version_number]);
        $this->assertSame($this->engineer->getKey(), $h->created_by);

        $line = DB::table('bom_lines')->where('sequence', 9)->first();
        $this->assertStringContainsString('PSG:SUTM-01', $line->formulas);          // GAMBAR!U6 became a variable
        $this->assertStringNotContainsString('GAMBAR', $line->formulas);
        $this->assertSame('TRUNC((GAMBAR!U6*1.02*3)/1)*1', json_decode($line->source_formulas, true)['I']); // original text kept for review
        $this->assertNotNull($res->json('data.id'));
        $this->assertSame(1, DB::table('bom_events')->where('event_type', 'CREATED')->count());

        $this->upload($doc)->assertStatus(409);                                   // one draft per group
    }

    #[Test]
    public function import_refuses_everything_when_any_line_cannot_be_translated_and_never_guesses(): void
    {
        $doc = $this->tiny();
        $doc['lines'][] = ['sequence' => 13, 'khs_code' => 999999, 'I' => 'GAMBAR!Z50', 'H' => 'INDIRECT("A1")'];
        $doc['lines'][] = ['sequence' => 14, 'khs_code' => null, 'I' => 'Foo!A1+C9+SUM(GAMBAR!U6:U7)'];
        $doc['lines'][] = ['sequence' => 15, 'khs_code' => null];
        $doc['lines'][] = ['sequence' => 16, 'khs_code' => null, 'I' => 'SUM(GAMBAR!Z50,1)'];   // an unknown cell INSIDE a function call is still caught
        $this->catalogue([$this->tiny()]);

        $dry = $this->upload($doc, ['dry_run' => 1])->assertOk();
        $rows = collect($dry->json('problems'))->keyBy('row');
        $this->assertSame(4, $dry->json('data.rejected_lines'));
        $this->assertArrayHasKey(16, $rows->all());
        $text = json_encode($rows->all());
        $this->assertStringContainsString('kode KHS 999999 tidak ada', $text);
        $this->assertStringContainsString('Z50', $text);
        $this->assertStringContainsString('Fungsi tidak diizinkan', $text);
        $this->assertStringContainsString('sheet Foo', $text);
        $this->assertStringContainsString('kolom C', $text);
        $this->assertStringContainsString('tanpa rumus dan tanpa kode KHS', $text);

        $this->upload($doc)->assertStatus(409);
        $this->assertSame(0, DB::table('bom_headers')->count());
    }

    #[Test]
    public function import_validates_the_request_and_the_file(): void
    {
        $this->upload($this->tiny(), ['valid_from' => 'bukan-tanggal'])->assertUnprocessable();
        $this->upload([], [], null, true)->assertUnprocessable();                       // not JSON
        $bad = $this->tiny();
        $bad['group'] = 'PBPD';
        $this->upload($bad)->assertStatus(409);                                         // group outside the seven
        $this->upload($this->tiny(), [], $this->manager)->assertForbidden();           // manager has no bom.manage
    }

    // ---- approval -----------------------------------------------------------------------

    #[Test]
    public function approval_by_another_user_makes_the_version_immutable_and_closes_the_previous_one(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);
        $this->upload($doc)->assertCreated();
        $v1 = (string) DB::table('bom_headers')->value('id');

        $this->approve($v1, $this->engineer)->assertForbidden();                           // no bom.approve
        $this->approve($v1)->assertOk()->assertJsonPath('data.approved', 1);
        $this->assertSame('APPROVED', DB::table('bom_headers')->where('id', $v1)->value('status'));

        // approved content cannot change, lines cannot be added/removed (database triggers)
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('bom_headers')->where('id', $v1)->update(['name' => 'x']));
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('bom_lines')->where('bom_header_id', $v1)->delete());
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('bom_lines')->where('bom_header_id', $v1)->update(['description' => 'x']));
        $this->as($this->engineer)->patchJson("/api/master-data/bom/{$v1}", ['name' => 'x', 'reason' => 'x'])->assertStatus(409);

        // version 2 starts later: v1 is closed the day before
        $this->upload($doc, ['valid_from' => '2027-01-01'])->assertCreated();
        $v2 = (string) DB::table('bom_headers')->where('version_number', 2)->value('id');
        $this->approve($v2)->assertOk()->assertJsonPath('data.auto_closed', 1);
        $this->assertSame('2026-12-31', substr((string) DB::table('bom_headers')->where('id', $v1)->value('valid_until'), 0, 10));

        $this->as($this->manager)->postJson("/api/master-data/bom/{$v2}/retire", ['reason' => 'usang'])->assertOk()->assertJsonPath('data.status', 'INACTIVE');
    }

    #[Test]
    public function the_creator_cannot_approve_their_own_draft_not_even_with_both_roles_and_the_database_agrees(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);
        $dual = $this->makeUser();
        $this->assign($dual, Role::query()->where('name', 'ASMAN_JARINGAN')->firstOrFail(), $this->makeUnit('UP3'));
        $this->assign($dual, Role::query()->where('name', 'MANAGER_UP3')->firstOrFail(), $this->makeUnit('UP3'));
        $this->upload($doc, [], $dual)->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');

        $this->approve($id, $dual)->assertForbidden();
        $this->assertSame('DRAFT', DB::table('bom_headers')->where('id', $id)->value('status'));
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('bom_headers')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $dual->getKey(), 'approved_at' => now()]));
    }

    #[Test]
    public function approval_is_refused_when_the_khs_or_the_construction_is_not_approved_on_the_start_date_or_formulas_cycle(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);

        // start date before the KHS/constructions were approved (valid from 2025-01-01)
        $this->upload($doc, ['valid_from' => '2024-06-01'])->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');
        $this->approve($id)->assertStatus(409);
        $this->as($this->engineer)->patchJson("/api/master-data/bom/{$id}", ['valid_from' => '2026-01-01', 'reason' => 'koreksi'])->assertOk();
        $this->approve($id)->assertOk();

        // a cycle (I9 -> I10 -> I9) is detected at approval
        $cyc = $this->tiny();
        $cyc['lines'][0]['I'] = '+I10';
        $this->upload($cyc, ['valid_from' => '2027-01-01'])->assertCreated();
        $id2 = (string) DB::table('bom_headers')->where('status', 'DRAFT')->value('id');
        $this->approve($id2)->assertStatus(409);
        $this->assertStringContainsString('Rumus BOM bersiklus', (string) $this->approve($id2)->json('message'));
    }

    private function assertDatabaseTriggerBlocks(callable $fn): void
    {
        try {
            DB::transaction($fn);
            $this->fail('The database accepted a change that must be blocked.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    // ---- calculation -----------------------------------------------------------------

    #[Test]
    public function calculation_applies_trunc_on_the_aggregate_and_follows_row_references(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);
        $this->upload($doc)->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');

        $calc = fn (array $in) => collect($this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => $in])->assertOk()->json('data.lines'))->keyBy('sequence');

        $a = $calc([['code' => 'SUTM-01', 'psg' => 10, 'bkr' => 2]]);
        $this->assertEquals(30, $a[9]['install']);          // TRUNC(10*1.02*3) = TRUNC(30.6)
        $this->assertEquals(2, $a[9]['remove']);
        $this->assertEquals(2, $a[9]['return']);
        $this->assertEquals(30, $a[9]['material']);
        $this->assertEquals(30, $a[10]['install']);         // TRUNC(30*1.01) = TRUNC(30.3)
        $this->assertEquals(60, $a[11]['install']);         // SUM(I9:I10)
        $this->assertEquals(0, $a[11]['material']);         // B12 is empty -> IF(B12="",0,...) = 0
        $this->assertEquals(5, $a[12]['install']);          // constant

        $b = $calc([['code' => 'SUTM-01', 'psg' => 1]]);    // TRUNC(3.06) = 3: rounding is on the line, not per unit
        $this->assertEquals(3, $b[9]['install']);
        $this->assertEquals(0, $b[9]['remove']);
        $this->assertEquals(0, $calc([['code' => 'SUTM-01']])[9]['install']);
    }

    #[Test]
    public function calculation_rejects_unknown_constructions_and_bad_numbers_and_never_stores_anything(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);
        $this->upload($doc)->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');
        $before = [DB::table('bom_lines')->count(), DB::table('bom_events')->count()];

        $this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'GTT_UMUM-01', 'psg' => 1]]])->assertUnprocessable();
        $this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'SUTM-01', 'psg' => -1]]])->assertUnprocessable();
        $this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => []])->assertUnprocessable();
        $this->as($this->vendor)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'SUTM-01']]])->assertForbidden();
        $this->as($this->viewer)->postJson('/api/master-data/bom/'.Str::uuid().'/calculate', ['inputs' => [['code' => 'SUTM-01']]])->assertNotFound();
        $this->assertSame($before, [DB::table('bom_lines')->count(), DB::table('bom_events')->count()]);
    }

    #[Test]
    public function listing_detail_and_lines_expose_the_version_and_the_workbook_formulas(): void
    {
        $doc = $this->tiny();
        $this->catalogue([$doc]);
        $this->upload($doc)->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');

        $list = $this->as($this->viewer)->getJson('/api/master-data/bom?group=SUTM')->assertOk();
        $this->assertSame([$id, 4], [$list->json('data.0.id'), $list->json('data.0.lines_count')]);
        $this->as($this->viewer)->getJson('/api/master-data/bom?status=APPROVED')->assertOk()->assertJsonCount(0, 'data');
        $this->as($this->viewer)->getJson('/api/master-data/bom?group=PBPD')->assertUnprocessable();
        $this->as($this->viewer)->getJson("/api/master-data/bom/{$id}")->assertOk()->assertJsonPath('data.events.0.event_type', 'CREATED');
        $lines = $this->as($this->viewer)->getJson("/api/master-data/bom/{$id}/lines")->assertOk()->assertJsonPath('meta.total', 4)->json('data');
        $this->assertSame('TRUNC((GAMBAR!U6*1.02*3)/1)*1', $lines[0]['formulas']['I']);
    }

    // ---- declared parameters (inputs from the drawing page, e.g. commissioning-test volume) ----------

    /** @return array<string,mixed> */
    private function withParam(): array
    {
        $doc = $this->tiny();
        $doc['params'] = [['cell' => 'U5', 'name' => 'COMMISSIONING:SUTM', 'default' => 2, 'description' => 'Volume commissioning test']];
        $doc['lines'][] = ['sequence' => 13, 'khs_code' => 2, 'description' => 'Commissioning test', 'H' => '+GAMBAR!U5'];

        return $doc;
    }

    #[Test]
    public function a_declared_parameter_becomes_a_param_variable_and_an_undeclared_stray_cell_is_still_refused(): void
    {
        $doc = $this->withParam();
        $this->catalogue([$doc]);

        $this->upload($doc)->assertCreated()->assertJsonPath('data.parameters', 1);
        $h = DB::table('bom_headers')->first();
        $this->assertSame('COMMISSIONING:SUTM', json_decode($h->parameters, true)[0]['name']);
        $this->assertStringContainsString('PARAM:COMMISSIONING:SUTM', DB::table('bom_lines')->where('sequence', 13)->value('formulas'));
    }

    #[Test]
    public function parameters_are_validated_and_never_inferred(): void
    {
        $this->catalogue([$this->withParam()]);

        $undeclared = $this->withParam();
        unset($undeclared['params']);
        $this->upload($undeclared, ['dry_run' => 1])->assertOk()->assertJsonPath('data.rejected_lines', 1);

        foreach ([
            [['cell' => 'U6', 'name' => 'X']],                                       // collides with a construction quantity cell
            [['cell' => 'U5', 'name' => 'A'], ['cell' => 'U5', 'name' => 'B']],       // same cell twice
            [['cell' => 'U5', 'name' => 'bad name!']],
            [['cell' => 'U5', 'name' => 'A', 'default' => -1]],
            [['cell' => 'nope', 'name' => 'A']],
        ] as $params) {
            $doc = $this->withParam();
            $doc['params'] = $params;
            $dry = $this->upload($doc, ['dry_run' => 1])->assertOk();
            $this->assertGreaterThan(0, $dry->json('data.rejected_lines'), json_encode($params));
        }
    }

    #[Test]
    public function calculation_uses_the_default_or_the_given_parameter_and_rejects_undeclared_ones(): void
    {
        $doc = $this->withParam();
        $this->catalogue([$doc]);
        $this->upload($doc)->assertCreated();
        $id = (string) DB::table('bom_headers')->value('id');
        $this->approve($id)->assertOk();                      // PARAM-only variables do not need an approved construction

        $row = fn (array $extra) => collect($this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'SUTM-01', 'psg' => 10]]] + $extra)->assertOk()->json('data.lines'))->firstWhere('sequence', 13)['material'];
        $this->assertEquals(2, $row([]));                                         // default declared in the version
        $this->assertEquals(7, $row(['params' => ['COMMISSIONING:SUTM' => 7]]));  // value from the drawing page
        $this->assertEquals(0, $row(['params' => ['COMMISSIONING:SUTM' => 0]]));
        $this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'SUTM-01']], 'params' => ['LAIN' => 1]])->assertUnprocessable();
        $this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => [['code' => 'SUTM-01']], 'params' => ['COMMISSIONING:SUTM' => -5]])->assertUnprocessable();
        $this->as($this->viewer)->getJson("/api/master-data/bom/{$id}")->assertOk()->assertJsonPath('data.parameters.0.name', 'COMMISSIONING:SUTM');

        // the declared parameters are part of the approved content (database trigger)
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('bom_headers')->where('id', $id)->update(['parameters' => '[]']));
    }

    // ---- end-to-end golden test on the real workbook --------------------------------------

    #[Test]
    public function every_line_of_the_seven_real_boms_is_reproduced_through_import_approval_and_calculation(): void
    {
        $docs = $this->golden();
        $this->assertCount(7, $docs);
        $this->catalogue(array_values($docs));

        $checked = 0;
        $mismatch = [];
        foreach ($docs as $group => $doc) {
            $dry = $this->upload($doc, ['dry_run' => 1])->assertOk();
            $this->assertSame([], $dry->json('problems'), $group.': '.json_encode(array_slice($dry->json('problems'), 0, 3)));
            $this->upload($doc)->assertCreated();
            $id = (string) DB::table('bom_headers')->where('group_code', $group)->value('id');
            $this->approve($id)->assertOk();

            // construction code per (label); inputs = the numbers stored in GAMBAR
            $codes = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->where('t.group_code', $group)->pluck('t.code', 'v.name')->all();
            $inputs = [];
            foreach ($doc['inputs'] as $in) {
                $v = (float) ($doc['input_values'][$in['cell']] ?? 0);
                $inputs[$codes[$in['label']]][strtolower($in['kind'])] = $v;
            }
            $payload = [];
            foreach ($inputs as $code => $q) {
                $payload[] = ['code' => $code, 'psg' => $q['psg'] ?? 0, 'bkr' => $q['bkr'] ?? 0];
            }
            $res = collect($this->as($this->viewer)->postJson("/api/master-data/bom/{$id}/calculate", ['inputs' => $payload])->assertOk()->json('data.lines'))->keyBy('sequence');
            $this->assertCount(count($doc['lines']), $res, $group);

            foreach ($doc['lines'] as $line) {
                foreach (['H' => 'material', 'I' => 'install', 'J' => 'remove', 'K' => 'return'] as $col => $field) {
                    $exp = (float) ($line['expected'][$col] ?? 0);
                    $got = (float) $res[$line['sequence']][$field];
                    $checked++;
                    if (abs($got - $exp) > 1e-9) {
                        $mismatch[] = "{$group} row {$line['sequence']} {$col}: got {$got} expected {$exp}";
                    }
                }
            }
        }

        $this->assertGreaterThan(5000, $checked);
        $this->assertSame([], $mismatch, count($mismatch)." of {$checked} values differ:\n".implode("\n", array_slice($mismatch, 0, 15)));
    }

    // ---- PBPD (pasang baru / perubahan daya): text parameters, constants and column-B formulas ----

    /** @return array<string,mixed> */
    private function goldenPbpd(): array
    {
        return json_decode((string) file_get_contents('compress.zlib://'.__DIR__.'/../fixtures/golden_pbpd.json.gz'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** Imports + approves both PBPD sheets; returns group => header id. */
    private function pbpdApproved(): array
    {
        $docs = $this->goldenPbpd();
        $this->catalogue(array_values($docs));
        $ids = [];
        foreach ($docs as $group => $doc) {
            $this->upload($doc, ['dry_run' => 1])->assertOk()->assertJsonPath('problems', []);
            $this->upload($doc)->assertCreated();
            $ids[$group] = (string) DB::table('bom_headers')->where('group_code', $group)->value('id');
            $this->approve($ids[$group])->assertOk();
        }

        return $ids;
    }

    #[Test]
    public function both_pbpd_sheets_reproduce_the_workbook_values_with_the_stored_drawing_state(): void
    {
        $docs = $this->goldenPbpd();
        $ids = $this->pbpdApproved();
        $checked = 0;
        $mismatch = [];
        foreach ($docs as $group => $doc) {
            $res = collect($this->as($this->viewer)->postJson("/api/master-data/bom/{$ids[$group]}/calculate", [])->assertOk()->json('data.lines'))->keyBy('sequence');
            foreach ($doc['lines'] as $line) {
                foreach (['H' => 'material', 'I' => 'install', 'J' => 'remove', 'K' => 'return'] as $col => $field) {
                    $checked++;
                    $exp = (float) ($line['expected'][$col] ?? 0);
                    $got = (float) $res[$line['sequence']][$field];
                    if (abs($got - $exp) > 1e-9) {
                        $mismatch[] = "{$group} row {$line['sequence']} {$col}: got {$got} expected {$exp}";
                    }
                }
            }
        }
        $this->assertGreaterThan(100, $checked);
        $this->assertSame([], $mismatch, implode("\n", array_slice($mismatch, 0, 15)));
    }

    #[Test]
    public function pbpd_choice_changes_active_khs_codes_and_job_type_blanks_rows(): void
    {
        $ids = $this->pbpdApproved();
        $calc = fn (string $g, array $params) => collect($this->as($this->viewer)->postJson("/api/master-data/bom/{$ids[$g]}/calculate", ['params' => $params])->assertOk()->json('data.lines'))->keyBy('sequence');
        $base = ['PBPD:RENTANG_1' => '23 kVA', 'PBPD:PSG_1' => 2, 'PBPD:BKR_1' => 0, 'PBPD:RENTANG_2' => '', 'PBPD:PSG_2' => 0, 'PBPD:BKR_2' => 0,
            'PBPD:RENTANG_3' => '', 'PBPD:PSG_3' => 0, 'PBPD:BKR_3' => 0, 'PBPD:RENTANG_4' => '', 'PBPD:PSG_4' => 0, 'PBPD:BKR_4' => 0,
            'PBPD:RENTANG_5' => '', 'PBPD:PSG_5' => 0, 'PBPD:BKR_5' => 0, 'PBPD:RENTANG_6' => '', 'PBPD:PSG_6' => 0, 'PBPD:BKR_6' => 0, 'PBPD:JENIS' => 'PBPD'];
        $pb = $calc('PBPD_6_41', $base);
        $this->assertSame('66', $pb[11]['khs_code']);     // 23 kVA -> KHS 66 active, 250 (33-41,5 kVA) not
        $this->assertNull($pb[12]['khs_code']);
        $this->assertEquals(2.0, $pb[14]['install']);   // KHS 233 row counts the units
        $pd = $calc('PBPD_6_41', array_merge($base, ['PBPD:JENIS' => 'PD 6,6-23 KVA']));
        $this->assertEquals(0.0, $pd[11]['remove']);
        $this->assertEquals(0.0, $pd[16]['install']);
        $big = $calc('PBPD_53_197', array_merge($base, ['PBPD:RENTANG_1' => '105 kVA']));
        $this->assertSame('205', $big[13]['khs_code']);
        $this->assertNull($big[14]['khs_code']);
    }

    #[Test]
    public function a_text_parameter_outside_its_options_is_refused(): void
    {
        $ids = $this->pbpdApproved();
        $this->as($this->viewer)->postJson("/api/master-data/bom/{$ids['PBPD_6_41']}/calculate", ['params' => ['PBPD:RENTANG_1' => '999 kVA']])->assertStatus(422);
    }
}
