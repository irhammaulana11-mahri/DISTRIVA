<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Bom\BomService;
use App\Services\Kkf\TariffBookService;
use App\Services\Master\MasterExcelImportService;
use App\Services\Prices\PriceBookService;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;
use ZipArchive;

/**
 * Excel master from the screen: the workbook is read by the extractors (here replaced by tiny scripts that write fixed files, since the real workbook is not part of the repository),
 * compared with the APPROVED data, and only the differences are applied, as DRAFT. Approved data and manual corrections stay untouched; permissions are per dataset.
 */
class MasterExcelImportTest extends PostgresTestCase
{
    private string $tools;

    private User $engineer;

    private User $manager;

    private User $viewer;

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    private OrganizationalUnit $otherUlp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $this->otherUlp = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $this->up3);

            return $u;
        };
        $this->engineer = $mk('ASMAN_JARINGAN');
        $this->manager = $mk('MANAGER_UP3');
        $this->viewer = $mk('TEKNIK');
        $this->tools = sys_get_temp_dir().'/mx-tools-'.uniqid();
        File::ensureDirectoryExists($this->tools);
        $map = $this->tools.'/map.csv';
        file_put_contents($map, "kode_lama,kode_baru,asal\n1,JTMR1,X\n2,JTMR2,X\n");
        config(['distriva.master_excel.tools' => $this->tools, 'distriva.master_excel.code_map' => $map, 'distriva.master_excel.detach' => false]);
        $this->fakeExtractors();
        $this->seedApprovedData();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tools);
        File::deleteDirectory(storage_path('app/master-excel'));
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function fakeExtractors(): void
    {
        $w = fn (string $name, string $body) => file_put_contents($this->tools.'/'.$name, "import sys, json, os\n".$body);
        $w('extract_khs_csv.py', "open(sys.argv[2],'w').write('code,name,unit,category\\n1,A,M,\\n2,B,M,\\n99,Item baru,M,\\n')\n");
        $w('extract_price_csv.py', "open(sys.argv[2],'w').write('kode,nama,status_material,harga_material,nilai_asuransi,z1_pasang,z1_bongkar\\n1,A,HARGA,500,,110,60\\n2,B,PLN,,9,200,100\\n99,Item baru,HARGA,5,,1,1\\n')\n");
        $w('extract_bom_json.py', "doc={'group':'SUTM','source':'x','inputs':[],'lines':[{'sequence':1,'khs_code':'1','description':'a','H':'3','I':'0','J':'0','K':'0','source':'SUTM!B11'}]}\njson.dump(doc, open(os.path.join(sys.argv[2],'bom_SUTM.json'),'w'))\n");
        $w('extract_tariff_csv.py', "ulp = sys.argv[sys.argv.index('--ulp')+1] if '--ulp' in sys.argv else ''\nopen(sys.argv[2],'w').write('tarif,daya_va,harga_rata2,jam_nyala,ujl,ulp\\nB1,450,535,140,80,'+ulp+'\\n')\n");
    }

    private function approve(string $table, string $id): void
    {
        DB::table($table)->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
    }

    private function csv(string $content): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'mx');
        file_put_contents($p, $content);

        return new UploadedFile($p, 'x.csv', 'text/csv', null, true);
    }

    private function seedApprovedData(): void
    {
        foreach (['JTMR1', 'JTMR2'] as $code) {
            DB::table('khs_items')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        $price = $this->csv("kode,nama,status_material,harga_material,nilai_asuransi,z1_pasang,z1_bongkar\nJTMR1,A,HARGA,400,,100,50\nJTMR2,B,PLN,,7,200,100\n");
        $book = $this->app->make(PriceBookService::class);
        $id = $book->import($price, 'Buku harga lama', 'KONTRAK-1', '2026-01-01', 'uji', false, $this->engineer)['summary']['id'];
        $book->setZone($id, $this->up3->getKey(), 1, 'uji zona', $this->engineer);
        $this->approve('price_books', $id);
        $doc = ['group' => 'SUTM', 'source' => 'x', 'inputs' => [], 'lines' => [['sequence' => 1, 'khs_code' => 'JTMR1', 'description' => 'a', 'H' => '2', 'I' => '0', 'J' => '0', 'K' => '0', 'source' => 'SUTM!B11']]];
        $this->app->make(BomService::class)->import($doc, '2026-01-01', null, false, $this->engineer);
        $this->approve('bom_headers', (string) DB::table('bom_headers')->where('group_code', 'SUTM')->value('id'));
        $tariff = $this->csv("tarif,daya_va,harga_rata2,jam_nyala,ujl,ulp\nB1,450,535,137,80,{$this->ulp->code}\nB1,900,630,149,80,{$this->ulp->code}\n");
        $tid = $this->app->make(TariffBookService::class)->import($tariff, 'Buku tarif lama', '2026-01-01', 'uji', false, $this->engineer)['summary']['tariff_book_id'];
        $this->approve('tariff_books', $tid);
    }

    private function workbook(): UploadedFile
    {
        $p = sys_get_temp_dir().'/mx-'.uniqid().'.xlsx';
        $z = new ZipArchive;
        $z->open($p, ZipArchive::CREATE);
        $z->addFromString('[Content_Types].xml', '<Types/>');
        $z->addFromString('xl/workbook.xml', '<workbook><sheets/></workbook>');
        $z->addFromString('xl/padding.bin', random_bytes(2000));
        $z->close();

        return new UploadedFile($p, 'MASTER RAB & KKF.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    }

    #[Test]
    public function a_workbook_is_checked_against_the_approved_data_and_only_the_differences_become_drafts(): void
    {
        $up = $this->as($this->engineer)->post('/api/master-data/excel-imports', ['file' => $this->workbook(), 'kind' => 'RAB_KKF'], ['Accept' => 'application/json'])->assertStatus(202)->json('data');
        $this->assertSame('PROCESSING', $up['status']);
        app(MasterExcelImportService::class)->process($up['id']);

        $r = $this->as($this->engineer)->getJson("/api/master-data/excel-imports/{$up['id']}")->assertOk()->json('data');
        $this->assertSame('READY', $r['status'], (string) $r['message']);
        $this->assertSame(['CHANGED', 1], [$r['report']['bom']['groups'][0]['status'], $r['report']['bom']['groups'][0]['changed']]);        // H: 2 -> 3
        $p = $r['report']['price'];
        $this->assertSame(['CHANGED', 1, 1, 1], [$p['status'], $p['changed_rows'], $p['unchanged_rows'], $p['new_codes']['count']]);          // code 99 is new: reported, not guessed
        $this->assertSame(1, $r['report']['new_khs']['count']);
        $this->assertEquals([1, 7, 9], [$p['mdu_differences']['count'], $p['mdu_differences']['items'][0]['current'], $p['mdu_differences']['items'][0]['excel']]);   // MDU 7 -> 9: reported only

        $this->as($this->engineer)->postJson("/api/master-data/excel-imports/{$up['id']}/apply", ['dataset' => 'PRICE', 'valid_from' => '2026-12-01', 'name' => 'Buku harga baru'])->assertCreated();
        $book = DB::table('price_books')->where('name', 'Buku harga baru')->first();
        $this->assertSame(['DRAFT', 'KONTRAK-1'], [$book->status, $book->contract_reference]);
        $rows = DB::table('price_book_items as p')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')->where('p.price_book_id', $book->id)->get(['i.code', 'p.material_status', 'p.material_price', 'p.insured_value'])->keyBy('code');
        $this->assertSame([500.0, 'PLN', 7.0], [(float) $rows['JTMR1']->material_price, $rows['JTMR2']->material_status, (float) $rows['JTMR2']->insured_value]);   // changed price applied; PLN status and MDU value kept
        $this->assertSame(1, DB::table('price_book_zones')->where('price_book_id', $book->id)->count());                                    // the zone of the UP3 follows the replaced book
        $this->assertSame(1, DB::table('price_books')->where('status', 'APPROVED')->count());                                              // nothing approved or overwritten

        $this->as($this->engineer)->postJson("/api/master-data/excel-imports/{$up['id']}/apply", ['dataset' => 'BOM', 'valid_from' => '2026-12-01'])->assertCreated();
        $this->assertSame(['DRAFT', 2], [DB::table('bom_headers')->where('group_code', 'SUTM')->orderByDesc('version_number')->value('status'), (int) DB::table('bom_headers')->where('group_code', 'SUTM')->max('version_number')]);

        $this->as($this->engineer)->postJson("/api/master-data/excel-imports/{$up['id']}/apply", ['dataset' => 'PRICE', 'valid_from' => '2026-12-01', 'name' => 'Lagi'])->assertStatus(409);   // once per dataset
    }

    #[Test]
    public function a_tariff_workbook_replaces_only_the_rows_of_its_ulp_and_flags_a_wrong_unit(): void
    {
        $up = $this->as($this->engineer)->post('/api/master-data/excel-imports', ['file' => $this->workbook(), 'kind' => 'TARIF', 'ulp_code' => $this->ulp->code], ['Accept' => 'application/json'])->assertStatus(202)->json('data');
        app(MasterExcelImportService::class)->process($up['id']);
        $t = $this->as($this->engineer)->getJson("/api/master-data/excel-imports/{$up['id']}")->json('data.report.tariff');
        $this->assertSame(['CHANGED', 1, 0, 1], [$t['status'], $t['changed_rows'], $t['added_rows'], $t['unchanged_rows'] + 0 === 0 ? 1 : 0]);   // jam nyala 137 -> 140; the 900 VA row is not in the Excel
        $cov = collect($this->as($this->engineer)->getJson('/api/master-data/excel-imports')->json('tariff_coverage'))->keyBy('code');
        $this->assertSame([2, 0], [$cov[$this->ulp->code]['rows'], $cov[$this->otherUlp->code]['rows']]);                                   // which ULPs have jam nyala and UJL, and which still wait
        $after = collect($t['coverage_after'])->keyBy('code');
        $this->assertSame([2, 0], [$after[$this->ulp->code]['rows'], $after[$this->otherUlp->code]['rows']]);
        $this->assertSame([], $t['warnings']);
        $this->as($this->engineer)->postJson("/api/master-data/excel-imports/{$up['id']}/apply", ['dataset' => 'TARIFF', 'valid_from' => '2026-12-01', 'name' => 'Buku tarif baru'])->assertCreated();
        $id = DB::table('tariff_books')->where('name', 'Buku tarif baru')->value('id');
        $rows = DB::table('tariff_book_rows')->where('tariff_book_id', $id)->orderBy('power_va')->get(['power_va', 'jam_nyala']);
        $this->assertSame([[450, 140.0], [900, 149.0]], $rows->map(fn ($r) => [(int) $r->power_va, (float) $r->jam_nyala])->all());       // the row that is not in the Excel is kept
        $this->assertSame('DRAFT', DB::table('tariff_books')->where('id', $id)->value('status'));

        $general = $this->as($this->engineer)->post('/api/master-data/excel-imports', ['file' => $this->workbook(), 'kind' => 'TARIF'], ['Accept' => 'application/json'])->assertStatus(202)->json('data');
        app(MasterExcelImportService::class)->process($general['id']);
        $w = $this->as($this->engineer)->getJson("/api/master-data/excel-imports/{$general['id']}")->json('data.report.tariff.warnings');
        $this->assertCount(1, $w);                                                                                                      // no ULP chosen while the book has per-ULP rows: warned
    }

    #[Test]
    public function files_and_people_that_do_not_qualify_are_refused(): void
    {
        $this->as($this->viewer)->getJson('/api/master-data/excel-imports')->assertForbidden();
        $this->as($this->manager)->post('/api/master-data/excel-imports', ['file' => $this->workbook(), 'kind' => 'RAB_KKF'], ['Accept' => 'application/json'])->assertForbidden();   // approves, but may not prepare
        $notExcel = UploadedFile::fake()->createWithContent('MASTER.xlsx', str_repeat('bukan zip', 300));
        $this->as($this->engineer)->post('/api/master-data/excel-imports', ['file' => $notExcel, 'kind' => 'RAB_KKF'], ['Accept' => 'application/json'])->assertStatus(409);
        $macro = sys_get_temp_dir().'/mx-macro-'.uniqid().'.xlsx';
        $z = new ZipArchive;
        $z->open($macro, ZipArchive::CREATE);
        $z->addFromString('xl/workbook.xml', '<workbook/>');
        $z->addFromString('xl/vbaProject.bin', random_bytes(2000));
        $z->close();
        $this->as($this->engineer)->post('/api/master-data/excel-imports', ['file' => new UploadedFile($macro, 'MASTER.xlsx', null, null, true), 'kind' => 'RAB_KKF'], ['Accept' => 'application/json'])->assertStatus(409);
        $this->assertSame(0, DB::table('master_excel_imports')->count());
    }
}
