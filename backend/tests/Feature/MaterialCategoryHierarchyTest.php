<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Two-level material categories (docs/62 §46): the database shape, the API, the material rules and the workbook import. */
class MaterialCategoryHierarchyTest extends PostgresTestCase
{
    private User $engineer;

    private User $planner;

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
        $this->engineer = $mk('ENGINEERING');
        $this->planner = $mk('PERENCANAAN');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function cat(string $code, ?string $parent = null): string
    {
        $id = (string) Str::uuid();
        DB::table('material_categories')->insert(['id' => $id, 'parent_id' => $parent, 'code' => $code, 'name' => "Nama {$code}", 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function material(string $code, ?string $category = null): string
    {
        $id = (string) Str::uuid();
        DB::table('materials')->insert(['id' => $id, 'category_id' => $category, 'code' => $code, 'name' => "Material {$code}", 'unit' => 'BH', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    #[Test]
    public function the_database_allows_only_two_levels_and_keeps_materials_on_leaves(): void
    {
        $parent = $this->cat('K_A');
        $sub = $this->cat('K_A_01', $parent);
        $this->assertDbRejects(fn () => $this->cat('K_A_01_X', $sub));                                       // third level
        $this->assertDbRejects(fn () => DB::table('material_categories')->where('id', $parent)->update(['parent_id' => $parent]));   // own parent
        $other = $this->cat('K_B');
        $this->assertDbRejects(fn () => DB::table('material_categories')->where('id', $parent)->update(['parent_id' => $other]));    // a parent with children cannot become a child
        $this->assertDbRejects(fn () => $this->material('1001', $parent));                                    // material on a parent
        $this->material('1002', $sub);                                                                        // on the leaf: fine
        $this->material('1003', $other);                                                                      // a childless category is a leaf too
        $used = $this->cat('K_C');
        $this->material('1004', $used);
        $this->assertDbRejects(fn () => $this->cat('K_C_01', $used));                                         // a category used directly cannot gain a child
    }

    #[Test]
    public function the_api_lists_the_tree_creates_subcategories_and_refuses_a_third_level(): void
    {
        $api = fn (array $b, ?User $by = null) => $this->as($by ?? $this->engineer)->postJson('/api/master-data/categories', $b);
        $pid = $api(['code' => 'CAT_X', 'name' => 'Kategori X'])->assertCreated()->json('data.id');
        $api(['code' => 'CAT_X_01', 'name' => 'Sub satu', 'parent_id' => $pid])->assertCreated()->assertJsonPath('data.parent_id', $pid);
        $sid = $api(['code' => 'CAT_X_02', 'name' => 'Sub dua', 'parent_id' => $pid])->assertCreated()->json('data.id');
        $api(['code' => 'CAT_X_02_A', 'name' => 'Tingkat tiga', 'parent_id' => $sid])->assertUnprocessable();   // two levels only
        $api(['code' => 'CAT_Y', 'name' => 'x', 'parent_id' => (string) Str::uuid()])->assertUnprocessable();    // unknown parent
        $this->material('2001', $sid);
        $this->material('2002', $sid);
        $used = $this->cat('CAT_Z');
        $this->material('2003', $used);
        $api(['code' => 'CAT_Z_01', 'name' => 'x', 'parent_id' => $used])->assertUnprocessable();                // parent already holds a material

        $list = collect($this->as($this->planner)->getJson('/api/master-data/categories')->assertOk()->json('data'));
        $parent = $list->firstWhere('code', 'CAT_X');
        $this->assertSame([1, 2, 2], [$parent['level'], $parent['children_count'], $parent['materials_count']]);   // rolls up its subcategories
        $sub = $list->firstWhere('code', 'CAT_X_02');
        $this->assertSame([2, 'CAT_X', 0, 2], [$sub['level'], $sub['parent_code'], $sub['children_count'], $sub['materials_count']]);
    }

    #[Test]
    public function a_material_takes_a_subcategory_never_a_parent_and_a_parent_filter_includes_its_subcategories(): void
    {
        $parent = $this->cat('CAT_P');
        $sub = $this->cat('CAT_P_01', $parent);
        $m = $this->material('3001');
        $this->material('3002', $sub);
        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$m}", ['category_id' => $parent, 'reason' => 'uji'])->assertUnprocessable();
        $this->as($this->engineer)->patchJson("/api/master-data/materials/{$m}", ['category_id' => $sub, 'reason' => 'uji'])->assertOk()->assertJsonPath('data.category.code', 'CAT_P_01');
        $codes = collect($this->as($this->planner)->getJson("/api/master-data/materials?category_id={$parent}")->assertOk()->json('data'))->pluck('code')->sort()->values()->all();
        $this->assertSame(['3001', '3002'], $codes);                                                          // asking for the parent returns the subcategories' materials

        $csv = "code,name,unit,category_code\n3003,Material 3003,BH,CAT_P\n3004,Material 3004,BH,CAT_P_01\n";
        $batch = $this->as($this->engineer)->post('/api/master-data/materials/imports', ['file' => UploadedFile::fake()->createWithContent('m.csv', $csv)], ['Accept' => 'application/json'])->assertCreated()->json('data');
        $this->assertStringContainsString('induk', json_encode($this->as($this->engineer)->getJson("/api/master-data/materials/imports/{$batch['id']}")->json(), JSON_UNESCAPED_UNICODE));   // the parent is warned about
        $this->as($this->engineer)->postJson("/api/master-data/materials/imports/{$batch['id']}/confirm")->assertOk();
        $this->assertNull(DB::table('materials')->where('code', '3003')->value('category_id'));              // the parent is not assignable: warned, never guessed
        $this->assertSame($sub, DB::table('materials')->where('code', '3004')->value('category_id'));
    }

    private function workbook(array $rows): string
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet();
        $sheet->setTitle('TEMPLATE IMPORT ERP');
        $sheet->setCellValue([1, 1], 'TEMPLATE IMPORT ERP');
        foreach (['Kode ERP', 'Nama Material ERP', 'Satuan ERP', 'Prefix ERP', 'Kode Kategori', 'Kategori Final', 'Subkategori Final', 'Spesifikasi ERP', 'Status Validasi'] as $i => $h) {
            $sheet->setCellValue([$i + 1, 3], $h);
        }
        foreach ($rows as $r => $row) {
            foreach ([$row[0], 'x', 'BH', 'P', $row[1], $row[2], $row[3], 'x', 'Tervalidasi'] as $i => $v) {
                $sheet->setCellValueExplicit([$i + 1, $r + 4], (string) $v, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
            }
        }
        $path = tempnam(sys_get_temp_dir(), 'cat').'.xlsx';
        (new Xlsx($book))->save($path);

        return $path;
    }

    #[Test]
    public function the_workbook_import_builds_the_tree_maps_every_material_logs_it_and_is_idempotent(): void
    {
        $old = (string) DB::table('material_categories')->where('code', 'KWH_METER')->value('id');       // the seeded flat categories: one nobody uses
        $kept = (string) DB::table('material_categories')->where('code', 'PENGHANTAR')->value('id');
        $this->material('4000', $kept);                         // an old category still in use must stay active
        foreach (['4001', '4002', '4003', '4004'] as $c) {
            $this->material($c);
        }
        $file = $this->workbook([
            ['0000000004001', 'CAT-01', 'Kabel & Penghantar', 'Kabel Kontrol'],
            ['4002', 'CAT-01', 'Kabel & Penghantar', 'Kabel Tanah TM'],
            ['4003', 'CAT-10', 'Material Perlu Verifikasi', 'Perlu review per item'],
            ['4004', 'CAT-05', 'Tiang & Konstruksi Mekanis', 'Tiang Jaringan'],
        ]);
        $args = ['file' => $file, '--override' => ['4003:CAT-05:Grounding & Pembumian']];

        $this->assertSame(0, Artisan::call('distriva:import-material-categories', $args));                       // dry run
        $this->assertSame(0, DB::table('material_change_logs')->count());
        $this->assertSame(0, DB::table('materials')->whereNotNull('category_id')->whereIn('code', ['4001', '4002', '4003', '4004'])->count());
        $this->assertNotSame(0, Artisan::call('distriva:import-material-categories', $args + ['--apply' => true, '--actor' => 'tidak@ada.test']));   // actor must exist

        $this->assertSame(0, Artisan::call('distriva:import-material-categories', $args + ['--apply' => true, '--actor' => $this->engineer->email]));
        $cats = DB::table('material_categories')->whereIn('code', ['CAT_01', 'CAT_05', 'CAT_10'])->pluck('id', 'code');
        $this->assertSame(2, $cats->count());                                                                      // CAT-10 is empty after the override: not created
        $sub = fn (string $code) => DB::table('material_categories')->where('code', $code)->first();
        $this->assertSame($cats['CAT_01'], $sub('CAT_01_01')->parent_id);
        $this->assertSame('Kabel Kontrol', $sub('CAT_01_01')->name);
        $this->assertSame('Kabel Tanah TM', $sub('CAT_01_02')->name);                                              // alphabetical numbering
        $this->assertSame(['Grounding & Pembumian', 'Tiang Jaringan'], DB::table('material_categories')->where('parent_id', $cats['CAT_05'])->orderBy('code')->pluck('name')->all());
        $cat = fn (string $code) => DB::table('material_categories')->where('id', DB::table('materials')->where('code', $code)->value('category_id'))->value('name');
        $this->assertSame('Kabel Kontrol', $cat('4001'));                                                         // leading zeros of the workbook code are ignored
        $this->assertSame('Grounding & Pembumian', $cat('4003'));                                                 // the person's decision beats the workbook
        $this->assertSame(4, DB::table('material_change_logs')->where('change_type', 'CATEGORY_MAPPED')->where('actor_user_id', $this->engineer->getKey())->count());
        $this->assertFalse((bool) DB::table('material_categories')->where('id', $old)->value('is_active'));       // unused old category: deactivated, not deleted
        $this->assertTrue((bool) DB::table('material_categories')->where('id', $kept)->value('is_active'));       // used one stays

        $before = DB::table('material_change_logs')->count();
        $this->assertSame(0, Artisan::call('distriva:import-material-categories', $args + ['--apply' => true, '--actor' => $this->engineer->email]));
        $this->assertSame($before, DB::table('material_change_logs')->count());                                    // nothing changes the second time
        $this->assertNotSame(0, Artisan::call('distriva:import-material-categories', ['file' => $file, '--override' => ['9999:CAT-05:X']]));   // an override for a material that is not in the workbook is refused
        @unlink($file);
    }

    #[Test]
    public function sku_suggestions_know_the_subcategory_can_be_narrowed_to_a_branch_and_hint_where_the_best_match_sits(): void
    {
        $khs = (string) Str::uuid();
        DB::table('khs_items')->insert(['id' => $khs, 'code' => '9001', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $khs, 'version_number' => 1, 'name' => 'Trafo Distribusi 20 kV 100 kVA', 'unit_text' => 'U', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $this->engineer->getKey(), 'approved_by' => $this->planner->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $kat = $this->cat('KAT_T');
        DB::table('material_categories')->where('id', $kat)->update(['name' => 'Transformator, Gardu & Panel']);
        $trafo = $this->cat('KAT_T_01', $kat);
        DB::table('material_categories')->where('id', $trafo)->update(['name' => 'Transformator Distribusi']);
        $cub = $this->cat('KAT_T_02', $kat);
        DB::table('material_categories')->where('id', $cub)->update(['name' => 'Cubicle Tegangan Menengah']);
        foreach ([['7001', 'TRF DIS;D3;20kV/400V;3P;100kVA;YZN5;OD', $trafo], ['7002', 'TRF DIS;D3;20kV/400V;3P;50kVA;YZN5;OD', $trafo], ['7003', 'CUB;N ISO;METERING;20kV;630A;16kA', $cub], ['7004', 'BOX;AMR 100KVA MCCB 3P 160A', null]] as [$code, $name, $cat]) {
            DB::table('materials')->insert(['id' => (string) Str::uuid(), 'category_id' => $cat, 'code' => $code, 'name' => $name, 'unit' => 'U', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        $get = fn (string $q = '', ?User $by = null) => $this->as($by ?? $this->planner)->getJson('/api/master-data/khs-material-map/suggestions?khs_code=9001'.$q);

        $all = $get('&limit=30')->assertOk();
        $this->assertSame('7001', $all->json('data.0.material_no'));                                         // the exact trafo wins: its subcategory names the item (Trafo = Transformator)
        $this->assertSame(['Transformator Distribusi', 'Transformator, Gardu & Panel'], [$all->json('data.0.category.name'), $all->json('data.0.category.parent_name')]);
        $this->assertNull(collect($all->json('data'))->firstWhere('material_no', '7004')['category']);       // uncategorised material: no category, still offered
        $this->assertSame('Transformator Distribusi', $all->json('meta.categories.0.name'));               // the hint: where the best candidate sits

        $branch = $get("&limit=30&category_id={$trafo}")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['7001', '7002'], array_column($branch, 'material_no'));          // the whole subcategory, even the 50 kVA that shares few words
        $parent = $get("&limit=30&category_id={$kat}")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['7001', '7002', '7003'], array_column($parent, 'material_no'));  // a category includes its subcategories, never uncategorised ones

        $get('&category_id='.Str::uuid())->assertUnprocessable();
        $get('&category_id=bukan-uuid')->assertUnprocessable();
        $this->as($this->makeUser())->getJson('/api/master-data/khs-material-map/suggestions?khs_code=9001')->assertForbidden();   // no role, no catalogue
    }
}

