<?php

namespace Tests\Feature;

use App\Models\Material;
use App\Models\MaterialCategory;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Spatie\Permission\PermissionRegistrar;
use Tests\PostgresTestCase;

class MasterDataMaterialsTest extends PostgresTestCase
{
    private User $engineer;

    private User $planner;

    private User $viewer;

    private User $vendor;

    private User $sysAdmin;

    private User $unitAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);

        $up3 = $this->makeUnit('UP3');
        $mk = function (string $role, bool $global = false) use ($up3): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $global ? null : $up3);

            return $u;
        };
        $this->engineer = $mk('ASMAN_JARINGAN');
        $this->planner = $mk('PERENCANAAN');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
        $this->unitAdmin = $mk('ADMIN');
        $this->sysAdmin = $mk('SYS_ADMIN', true);
    }

    /** @param bool $mfa SYS_ADMIN tokens are MFA-verified by default; pass false for a freshly logged-in token. */
    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    private function csv(string $content, string $name = 'materials.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $content);
    }

    private function stage(string $csv, ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->post('/api/master-data/materials/imports', ['file' => $this->csv($csv)], ['Accept' => 'application/json']);
    }

    private function confirm(string $batch, array $body = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->postJson("/api/master-data/materials/imports/{$batch}/confirm", $body);
    }

    private const FIRST = "code,name,unit,spec,category_code\nKWH-001,KWH Meter 1 Fasa,Unit,Class 1,KWH_METER\nMCB-001,MCB 1P 10A,Buah,,MCB_1_PHASE\nKBL-001,Kabel NYY,Meter,,\n";

    // ---- seeder / authorization ------------------------------------------------------

    #[Test]
    public function the_seeder_creates_only_the_master_data_keys_and_grants_and_the_nine_categories_and_is_idempotent(): void
    {
        $this->seed(MasterDataPermissionSeeder::class);

        $this->assertSame(21, DB::table('permissions')->count());
        $this->assertSame(62, DB::table('role_has_permissions')->count()); // 12 view (11 + SYS_ADMIN) + 10 manage keys x 3 + 4 stock/pole/vendor keys x 2 + 6 approve keys x 2
        $this->assertSame(9, MaterialCategory::query()->count());
        foreach (['ADMIN', 'VENDOR'] as $name) {
            $this->assertSame(0, Role::query()->where('name', $name)->firstOrFail()->permissions()->count(), $name);
        }
        $this->assertSame(['ASMAN_JARINGAN', 'PERENCANAAN', 'SYS_ADMIN'], DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', 'materials.import')->orderBy('r.name')->pluck('r.name')->all());
    }

    #[Test]
    public function capabilities_follow_the_grants_and_central_data_is_closed_to_vendor_and_unit_admin(): void
    {
        $eng = $this->as($this->engineer)->getJson('/api/master-data/access')->assertOk()->json('can');
        $this->assertSame(['khs.approve', 'construction_types.approve', 'bom.approve', 'prices.approve', 'kkf_params.approve', 'tariffs.approve', 'stock.import', 'warehouses.manage', 'poles.manage', 'vendors.manage'], array_keys(array_filter($eng, fn ($v) => $v === false))); // managers may do everything except approve

        $view = $this->as($this->viewer)->getJson('/api/master-data/access')->assertOk()->json('can');
        $this->assertTrue($view['master_data.view']);
        $this->assertFalse($view['materials.import']);

        foreach ([$this->vendor, $this->unitAdmin] as $u) {
            $this->assertNotContains(true, $this->as($u)->getJson('/api/master-data/access')->assertOk()->json('can'));
        }
        // SYS_ADMIN holds the full role (owner decision 2026-11-06) — but only on an MFA-verified token.
        $this->assertNotContains(false, $this->as($this->sysAdmin)->getJson('/api/master-data/access')->assertOk()->json('can'));
        $this->as($this->sysAdmin, false)->getJson('/api/master-data/access')->assertForbidden();
    }

    #[Test]
    public function every_endpoint_is_403_without_the_grant_before_any_validation(): void
    {
        foreach ([$this->vendor, $this->unitAdmin] as $u) {
            $this->as($u)->getJson('/api/master-data/materials')->assertForbidden();
            $this->as($u)->getJson('/api/master-data/categories')->assertForbidden();
            $this->as($u)->getJson('/api/master-data/units')->assertForbidden();
            $this->as($u)->postJson('/api/master-data/categories', [])->assertForbidden();
            $this->as($u)->postJson('/api/master-data/units', [])->assertForbidden();
            $this->as($u)->post('/api/master-data/materials/imports', [], ['Accept' => 'application/json'])->assertForbidden();
        }
        // A viewer reads but cannot write or import; the answer does not depend on the body.
        $this->as($this->viewer)->getJson('/api/master-data/materials')->assertOk();
        $this->as($this->viewer)->postJson('/api/master-data/categories', [])->assertForbidden();
        $this->as($this->viewer)->post('/api/master-data/materials/imports', [], ['Accept' => 'application/json'])->assertForbidden();
        $this->as($this->viewer)->getJson('/api/master-data/materials/imports')->assertForbidden();
        $this->flushHeaders(); // drop the token left by the previous as()
        $this->app['auth']->forgetGuards(); // and the user cached by the previous request
        $this->getJson('/api/master-data/materials')->assertUnauthorized();
    }

    #[Test]
    public function an_expired_assignment_or_a_suspended_account_loses_access(): void
    {
        DB::table('user_role_assignments')->where('user_id', $this->engineer->getKey())->update(['valid_until' => '2026-01-02']);
        $this->as($this->engineer)->getJson('/api/master-data/materials')->assertForbidden();

        $token = $this->planner->createToken('t')->plainTextToken;
        $this->planner->forceFill(['account_status' => 'SUSPENDED'])->save();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/master-data/materials')->assertForbidden();
    }

    #[Test]
    public function a_role_without_a_grant_gets_nothing_even_if_it_has_the_right_name(): void
    {
        DB::table('role_has_permissions')->where('role_id', Role::query()->where('name', 'PERENCANAAN')->value('id'))->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $this->as($this->planner)->getJson('/api/master-data/materials')->assertForbidden();
    }

    // ---- categories and units --------------------------------------------------------

    #[Test]
    public function categories_and_units_can_be_listed_created_and_updated_by_managers_only(): void
    {
        $this->as($this->viewer)->getJson('/api/master-data/categories')->assertOk()->assertJsonCount(9, 'data');

        $id = $this->as($this->engineer)->postJson('/api/master-data/categories', ['code' => 'ISOLATOR', 'name' => 'Isolator'])->assertCreated()->json('data.id');
        $this->as($this->engineer)->postJson('/api/master-data/categories', ['code' => 'ISOLATOR', 'name' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->as($this->engineer)->postJson('/api/master-data/categories', ['code' => 'huruf kecil', 'name' => 'x'])->assertUnprocessable();
        $this->as($this->planner)->patchJson("/api/master-data/categories/{$id}", ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);

        $uid = $this->as($this->engineer)->postJson('/api/master-data/units', ['code' => 'M', 'name' => 'Meter', 'symbol' => 'm'])->assertCreated()->json('data.id');
        $this->as($this->engineer)->postJson('/api/master-data/units', ['code' => 'M', 'name' => 'Meter', 'symbol' => 'm'])->assertUnprocessable();
        $this->as($this->engineer)->patchJson("/api/master-data/units/{$uid}", ['name' => 'Meter lari'])->assertOk()->assertJsonPath('data.name', 'Meter lari');
        $this->as($this->engineer)->patchJson('/api/master-data/units/'.fake()->uuid(), ['name' => 'x'])->assertNotFound();
        $this->as($this->viewer)->patchJson("/api/master-data/units/{$uid}", ['name' => 'x'])->assertForbidden();
    }

    // ---- import: staging, preview, confirm -------------------------------------------

    #[Test]
    public function staging_classifies_rows_validates_them_and_creates_no_material_yet(): void
    {
        $csv = "code,name,unit,spec,category_code\n"
            ."KWH-001,KWH Meter,Unit,Class 1,KWH_METER\n"   // insert
            ."DUP-1,Satu,Buah,,\n"                         // duplicate code (both rejected)
            ."DUP-1,Dua,Buah,,\n"
            .",Tanpa kode,Buah,,\n"                        // empty code
            ."NAM-1,,Buah,,\n"                             // empty name
            ."UNT-1,Tanpa satuan,,,\n"                     // empty unit
            ."CAT-1,Kategori asing,Buah,,TIDAK_ADA\n";     // unknown category -> warning only

        $res = $this->stage($csv)->assertCreated();

        $this->assertEquals(['total_rows' => 7, 'inserted' => 2, 'updated' => 0, 'unchanged' => 0, 'rejected' => 5, 'unit_changes' => 0, 'status' => 'STAGED'], collect($res->json('data'))->only(['total_rows', 'inserted', 'updated', 'unchanged', 'rejected', 'unit_changes', 'status'])->all());
        $this->assertSame(0, Material::query()->count()); // nothing is applied before confirmation

        $rows = $this->as($this->engineer)->getJson('/api/master-data/materials/imports/'.$res->json('data.id'))->assertOk()->json('rows');
        $byCode = collect($rows)->keyBy(fn ($r) => $r['code'] ?? 'row'.$r['row']);
        $this->assertSame('INSERT', $byCode['KWH-001']['action']);
        $this->assertSame('REJECT', $byCode['DUP-1']['action']);
        $this->assertContains('Kode material muncul lebih dari sekali dalam berkas.', $byCode['DUP-1']['messages']);
        $this->assertSame('REJECT', $byCode['row5']['action']);
        $this->assertSame('INSERT', $byCode['CAT-1']['action']);
        $this->assertStringContainsString('tidak dikenal', $byCode['CAT-1']['messages'][0]);
        $this->assertSame(2, collect($rows)->where('code', 'DUP-1')->count()); // both occurrences rejected
    }

    #[Test]
    public function the_preview_can_be_filtered_by_action_and_paginated(): void
    {
        $batch = $this->stage(self::FIRST."X,,Buah,,\n")->json('data.id');
        $res = $this->as($this->engineer)->getJson("/api/master-data/materials/imports/{$batch}?action=REJECT&per_page=1")->assertOk();
        $this->assertSame(1, $res->json('meta.total'));
        $this->as($this->engineer)->getJson("/api/master-data/materials/imports/{$batch}?action=BOGUS")->assertUnprocessable();
        $this->as($this->engineer)->getJson('/api/master-data/materials/imports/'.fake()->uuid())->assertNotFound();
    }

    #[Test]
    public function confirming_creates_materials_logs_every_insert_and_cannot_be_repeated(): void
    {
        $batch = $this->stage(self::FIRST)->json('data.id');
        $res = $this->confirm($batch)->assertOk();

        $this->assertSame('CONFIRMED', $res->json('data.status'));
        $this->assertSame(3, $res->json('data.inserted'));
        $this->assertSame(3, Material::query()->count());
        $m = Material::query()->where('code', 'KWH-001')->firstOrFail();
        $this->assertSame(['KWH Meter 1 Fasa', 'Unit', 'Class 1', 'ERP_MATERIAL', true], [$m->name, $m->unit, $m->spec, $m->source_system, $m->is_active]);
        $this->assertSame('KWH_METER', $m->category->code);
        $this->assertNull(Material::query()->where('code', 'KBL-001')->value('category_id')); // unmapped, never guessed
        $this->assertSame(3, DB::table('material_change_logs')->where('change_type', 'INSERTED')->where('batch_id', $batch)->count());
        $this->assertDatabaseHas('material_sync_logs', ['id' => $batch, 'status' => 'CONFIRMED', 'confirmed_by' => $this->engineer->getKey(), 'staged_by' => $this->engineer->getKey()]);

        $this->confirm($batch)->assertStatus(409);
        $this->as($this->engineer)->postJson("/api/master-data/materials/imports/{$batch}/cancel")->assertStatus(409);
        $this->assertSame(3, Material::query()->count());
    }

    #[Test]
    public function a_second_user_can_confirm_and_rejected_rows_are_never_applied(): void
    {
        $batch = $this->stage(self::FIRST."BAD,,Buah,,\n")->json('data.id');
        $this->confirm($batch, [], $this->planner)->assertOk()->assertJsonPath('data.rejected', 1);

        $this->assertDatabaseMissing('materials', ['code' => 'BAD']);
        $this->assertDatabaseHas('material_sync_logs', ['id' => $batch, 'staged_by' => $this->engineer->getKey(), 'confirmed_by' => $this->planner->getKey()]);
    }

    #[Test]
    public function cancelling_discards_the_batch_without_touching_the_master(): void
    {
        $batch = $this->stage(self::FIRST)->json('data.id');
        $this->as($this->engineer)->postJson("/api/master-data/materials/imports/{$batch}/cancel")->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->assertSame(0, Material::query()->count());
        $this->confirm($batch)->assertStatus(409);
    }

    #[Test]
    public function a_reimport_updates_changed_rows_leaves_unchanged_ones_and_never_deactivates_missing_materials(): void
    {
        $this->confirm($this->stage(self::FIRST)->json('data.id'));
        $logsBefore = DB::table('material_change_logs')->count();

        // KWH-001 renamed; MCB-001 identical; KBL-001 absent from the file.
        $second = "code,name,unit,spec,category_code\nKWH-001,KWH Meter 1 Fasa 5(60)A,Unit,Class 1,KWH_METER\nMCB-001,MCB 1P 10A,Buah,,MCB_1_PHASE\n";
        $batch = $this->stage($second)->assertCreated()->json('data');
        $this->assertSame([1, 1, 0], [$batch['updated'], $batch['unchanged'], $batch['rejected']]);

        $this->confirm($batch['id'])->assertOk()->assertJsonPath('data.updated', 1);

        $this->assertSame('KWH Meter 1 Fasa 5(60)A', Material::query()->where('code', 'KWH-001')->value('name'));
        $this->assertTrue((bool) Material::query()->where('code', 'KBL-001')->value('is_active')); // not deactivated
        $log = DB::table('material_change_logs')->where('change_type', 'UPDATED')->first();
        $this->assertSame(['name' => 'KWH Meter 1 Fasa'], json_decode($log->before_values, true));
        $this->assertSame(['name' => 'KWH Meter 1 Fasa 5(60)A'], json_decode($log->after_values, true));
        $this->assertSame($logsBefore + 1, DB::table('material_change_logs')->count()); // unchanged rows write nothing
    }

    #[Test]
    public function a_unit_change_is_flagged_and_needs_explicit_approval_to_be_applied(): void
    {
        $this->confirm($this->stage(self::FIRST)->json('data.id'));

        $batch = $this->stage("code,name,unit\nKBL-001,Kabel NYY,Kg\n")->json('data');
        $this->assertSame(1, $batch['unit_changes']);
        $rows = $this->as($this->engineer)->getJson("/api/master-data/materials/imports/{$batch['id']}")->json('rows');
        $this->assertTrue($rows[0]['unit_change']);
        $this->assertStringContainsString("'Meter' menjadi 'Kg'", $rows[0]['messages'][0]);

        $this->confirm($batch['id'])->assertStatus(409);
        $this->assertSame('Meter', Material::query()->where('code', 'KBL-001')->value('unit')); // untouched

        $this->confirm($batch['id'], ['approve_unit_changes' => true])->assertOk();
        $this->assertSame('Kg', Material::query()->where('code', 'KBL-001')->value('unit'));
        $this->assertDatabaseHas('material_sync_logs', ['id' => $batch['id'], 'status' => 'CONFIRMED']);
    }

    #[Test]
    public function a_file_without_a_spec_column_leaves_specs_alone_but_an_empty_cell_clears_it(): void
    {
        $this->confirm($this->stage(self::FIRST)->json('data.id'));
        $this->assertSame('Class 1', Material::query()->where('code', 'KWH-001')->value('spec'));

        $b1 = $this->stage("code,name,unit\nKWH-001,KWH Meter 1 Fasa baru,Unit\n")->json('data');
        $this->assertSame(1, $b1['updated']);
        $this->confirm($b1['id']);
        $this->assertSame('Class 1', Material::query()->where('code', 'KWH-001')->value('spec')); // no spec column -> untouched

        $b2 = $this->stage("code,name,unit,spec\nKWH-001,KWH Meter 1 Fasa baru,Unit,\n")->json('data');
        $this->assertSame(1, $b2['updated']); // the empty cell is a real change from "Class 1"
        $this->confirm($b2['id']);
        $this->assertNull(Material::query()->where('code', 'KWH-001')->value('spec'));
    }

    #[Test]
    public function an_omitted_category_never_clears_the_mapping_but_a_known_one_remaps_it(): void
    {
        $this->confirm($this->stage(self::FIRST)->json('data.id'));

        $this->confirm($this->stage("code,name,unit\nKWH-001,KWH Meter 1 Fasa,Unit\n")->json('data.id'));
        $this->assertSame('KWH_METER', Material::query()->where('code', 'KWH-001')->firstOrFail()->category->code);

        $b = $this->stage("code,name,unit,category_code\nKWH-001,KWH Meter 1 Fasa,Unit,TRAFO\n")->json('data');
        $this->assertSame(1, $b['updated']);
        $this->confirm($b['id']);
        $this->assertSame('TRAFO', Material::query()->where('code', 'KWH-001')->firstOrFail()->category->code);
    }

    #[Test]
    public function semicolon_files_bom_indonesian_headers_and_quoted_cells_are_understood(): void
    {
        $csv = "\xEF\xBB\xBFkode;nama;satuan;spesifikasi;kategori\nSKU-9;\"Kabel; 2x10 \"\"mm\"\"\";Meter;\"Tembaga, rapat\";PENGHANTAR\n";
        $batch = $this->stage($csv)->assertCreated()->json('data');
        $this->assertSame(1, $batch['inserted']);
        $this->confirm($batch['id'])->assertOk();

        $m = Material::query()->where('code', 'SKU-9')->firstOrFail();
        $this->assertSame(['Kabel; 2x10 "mm"', 'Meter', 'Tembaga, rapat', 'PENGHANTAR'], [$m->name, $m->unit, $m->spec, $m->category->code]);
    }

    #[Test]
    public function codes_and_values_are_trimmed_and_never_case_folded_or_invented(): void
    {
        $this->confirm($this->stage("code,name,unit\n  sku-lower  ,  Nama Spasi  ,  Buah  \n")->json('data.id'));
        $m = Material::query()->firstOrFail();
        $this->assertSame(['sku-lower', 'Nama Spasi', 'Buah'], [$m->code, $m->name, $m->unit]);

        // "SKU-LOWER" is a different code: it is NOT matched to the existing record.
        $this->assertSame(1, $this->stage("code,name,unit\nSKU-LOWER,Lain,Buah\n")->json('data.inserted'));
    }

    #[Test]
    public function unusable_files_are_refused_with_a_clear_message_and_nothing_is_staged(): void
    {
        $count = fn () => DB::table('material_sync_logs')->count();

        $this->stage("name,unit\nSatu,Buah\n")->assertStatus(409)->assertJsonPath('message', "Kolom wajib 'code' tidak ditemukan pada baris judul.");
        $this->stage("code,name,unit\n")->assertStatus(409)->assertJsonPath('message', 'Berkas tidak memuat baris data.');
        $this->stage('')->assertStatus(409);
        $this->stage("code,name,unit\nA,\xE9\xE8,Buah\n")->assertStatus(409); // not UTF-8
        config(['distriva_permissions.master_data_import.max_rows' => 2]);
        $this->stage("code,name,unit\nA,a,u\nB,b,u\nC,c,u\n")->assertStatus(409)->assertJsonPath('message', 'Berkas melebihi batas 2 baris.');
        $this->as($this->engineer)->post('/api/master-data/materials/imports', ['file' => UploadedFile::fake()->createWithContent('x.exe', "code,name,unit\nA,a,u\n")], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->as($this->engineer)->post('/api/master-data/materials/imports', [], ['Accept' => 'application/json'])->assertUnprocessable();

        $this->assertSame(0, $count());
    }

    #[Test]
    public function a_code_created_by_another_batch_after_staging_aborts_the_confirmation_atomically(): void
    {
        $first = $this->stage("code,name,unit\nA-1,Satu,Buah\nB-1,Dua,Buah\n")->json('data.id');
        $second = $this->stage("code,name,unit\nB-1,Dua,Buah\n")->json('data.id');
        $this->confirm($second)->assertOk();

        $this->confirm($first)->assertStatus(409);

        $this->assertDatabaseMissing('materials', ['code' => 'A-1']); // all-or-nothing
        $this->assertDatabaseHas('material_sync_logs', ['id' => $first, 'status' => 'STAGED']);
    }

    // ---- materials: read and the few manual changes ----------------------------------

    private function loaded(): void
    {
        $this->confirm($this->stage(self::FIRST)->json('data.id'));
    }

    #[Test]
    public function the_list_searches_filters_paginates_and_escapes_wildcards(): void
    {
        $this->loaded();

        $this->as($this->viewer)->getJson('/api/master-data/materials?search=kabel')->assertOk()->assertJsonPath('meta.total', 1);
        $this->as($this->viewer)->getJson('/api/master-data/materials?search=MCB')->assertJsonPath('data.0.code', 'MCB-001');
        $this->as($this->viewer)->getJson('/api/master-data/materials?search=%25')->assertJsonPath('meta.total', 0);
        $this->as($this->viewer)->getJson('/api/master-data/materials?unmapped=1')->assertJsonPath('meta.total', 1);
        $cat = MaterialCategory::query()->where('code', 'KWH_METER')->value('id');
        $this->as($this->viewer)->getJson("/api/master-data/materials?category_id={$cat}")->assertJsonPath('data.0.code', 'KWH-001');
        $page = $this->as($this->viewer)->getJson('/api/master-data/materials?per_page=2')->json();
        $this->assertSame([2, 3, 2], [count($page['data']), $page['meta']['total'], $page['meta']['last_page']]);
        $this->assertSame(100, $this->as($this->viewer)->getJson('/api/master-data/materials?per_page=100000')->json('meta.per_page'));
    }

    #[Test]
    public function a_material_shows_its_change_history_and_there_is_no_way_to_create_one_by_hand(): void
    {
        $this->loaded();
        $id = Material::query()->where('code', 'KWH-001')->value('id');

        $show = $this->as($this->viewer)->getJson("/api/master-data/materials/{$id}")->assertOk();
        $this->assertSame('INSERTED', $show->json('data.change_logs.0.change_type'));
        $this->assertSame('KWH_METER', $show->json('data.category.code'));
        $this->as($this->viewer)->getJson('/api/master-data/materials/'.fake()->uuid())->assertNotFound();

        $this->as($this->engineer)->postJson('/api/master-data/materials', ['code' => 'NEW-1', 'name' => 'x', 'unit' => 'u'])->assertStatus(405);
        $this->assertDatabaseMissing('materials', ['code' => 'NEW-1']);
    }

    #[Test]
    public function only_the_category_mapping_and_the_active_flag_can_be_changed_by_hand_with_a_reason_and_a_log(): void
    {
        $this->loaded();
        $id = Material::query()->where('code', 'KBL-001')->value('id');
        $cat = MaterialCategory::query()->where('code', 'PENGHANTAR')->value('id');

        $this->as($this->viewer)->patchJson("/api/master-data/materials/{$id}", ['category_id' => $cat, 'reason' => 'x'])->assertForbidden();
        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$id}", ['category_id' => $cat])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$id}", ['reason' => 'x'])->assertUnprocessable();

        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$id}", [
            'category_id' => $cat, 'reason' => 'Dipetakan ke penghantar', 'code' => 'HACK', 'name' => 'HACK', 'unit' => 'HACK',
        ])->assertOk()->assertJsonPath('data.category.code', 'PENGHANTAR');

        $m = Material::query()->find($id);
        $this->assertSame(['KBL-001', 'Kabel NYY', 'Meter'], [$m->code, $m->name, $m->unit]); // ERP fields are not writable
        $log = DB::table('material_change_logs')->where('change_type', 'CATEGORY_MAPPED')->first();
        $this->assertSame([$this->engineer->getKey(), 'Dipetakan ke penghantar'], [$log->actor_user_id, $log->reason]);

        $this->as($this->planner)->patchJson("/api/master-data/materials/{$id}", ['is_active' => false, 'reason' => 'Tidak dipakai'])->assertOk()->assertJsonPath('data.is_active', false);
        $this->as($this->planner)->patchJson("/api/master-data/materials/{$id}", ['is_active' => true, 'reason' => 'Dipakai lagi'])->assertOk();
        $this->assertSame(['DEACTIVATED', 'ACTIVATED'], DB::table('material_change_logs')->whereIn('change_type', ['DEACTIVATED', 'ACTIVATED'])->orderBy('changed_at')->pluck('change_type')->all());
    }

    #[Test]
    public function an_inactive_or_unknown_category_cannot_be_assigned(): void
    {
        $this->loaded();
        $id = Material::query()->where('code', 'KBL-001')->value('id');
        $cat = MaterialCategory::query()->where('code', 'TRAFO')->firstOrFail();
        $cat->update(['is_active' => false]);

        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$id}", ['category_id' => $cat->getKey(), 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$id}", ['category_id' => (string) fake()->uuid(), 'reason' => 'x'])->assertUnprocessable();
    }

    // ---- database --------------------------------------------------------------------

    #[Test]
    public function the_change_log_is_append_only_and_codes_are_unique_and_clean_at_the_database_level(): void
    {
        $this->loaded();
        $logId = DB::table('material_change_logs')->value('id');

        $this->assertDbRejects(fn () => DB::table('material_change_logs')->where('id', $logId)->update(['reason' => 'x']));
        $this->assertDbRejects(fn () => DB::table('material_change_logs')->where('id', $logId)->delete());
        $this->assertDbRejects(fn () => DB::statement('TRUNCATE material_change_logs'));

        $row = fn (string $code) => fn () => DB::table('materials')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'name' => 'n', 'unit' => 'u', 'created_at' => now(), 'updated_at' => now()]);
        $this->assertDbRejects($row('KWH-001'));  // duplicate ERP code
        $this->assertDbRejects($row(' padded ')); // not trimmed
        $this->assertDbRejects($row(''));
        $this->assertDbRejects(fn () => DB::table('material_sync_logs')->where('id', DB::table('material_sync_logs')->value('id'))->update(['status' => 'WEIRD']));
    }

    #[Test]
    public function material_files_with_multi_line_quoted_cells_are_read_as_whole_records(): void
    {
        $csv = "code,name,unit,spec\nSKU-1,\"Nama\nbaris dua\",Buah,\"Spesifikasi\nlengkap\"\nSKU-2,Biasa,Buah,\n";
        $res = $this->stage($csv)->assertCreated();

        $this->assertSame([2, 0], [$res->json('data.total_rows'), $res->json('data.rejected')]);
        $this->confirm($res->json('data.id'))->assertOk();
        $this->assertSame("Nama\nbaris dua", Material::query()->where('code', 'SKU-1')->value('name')); // ERP text is kept as is
    }
}
