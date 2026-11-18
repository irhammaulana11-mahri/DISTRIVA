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
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;
use ZipArchive;

/**
 * MASTER DISTRIVA.xlsx (docs/85): downloaded from the approved BOM, edited by the parent unit, uploaded again. An unchanged workbook is a no-change; a changed one becomes a DRAFT only after the numbers Excel stored
 * equal what the engine calculates for the same drawing inputs; layout mistakes are reported by cell.
 */
class MasterWorkbookTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    private string $dir;

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
        config(['distriva.master_excel.detach' => false]);
        $this->dir = sys_get_temp_dir().'/mw-'.uniqid();
        File::ensureDirectoryExists($this->dir);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->dir);
        File::deleteDirectory(storage_path('app/master-excel'));
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** @return array<string,mixed> */
    private function tiny(): array
    {
        return ['group' => 'SUTM', 'source' => 'unit test',
            'inputs' => [['cell' => 'U6', 'group' => 'SUTM', 'label' => 'A3C 150', 'kind' => 'PSG'], ['cell' => 'V6', 'group' => 'SUTM', 'label' => 'A3C 150', 'kind' => 'BKR']],
            'lines' => [
                ['sequence' => 10, 'khs_code' => 'JTMR1', 'description' => 'Tiang', 'H' => '+I10', 'I' => 'TRUNC((GAMBAR!U6*1.02*3)/1)*1', 'J' => '+GAMBAR!V6', 'K' => '+J10'],
                ['sequence' => 11, 'khs_code' => 'JTMR2', 'description' => 'Konduktor', 'I' => 'TRUNC((I10*1.01)/1)*1', 'H' => '+I11'],
                ['sequence' => 12, 'khs_code' => null, 'description' => 'Subtotal', 'I' => 'SUM(I10:I11)', 'H' => 'IF(B13="",0,I12)'],
                ['sequence' => 13, 'khs_code' => null, 'description' => 'Konstan', 'I' => '5'],
            ]];
    }

    /** One approved SUTM BOM (and the catalogue it needs), imported the way the screen does it, so the drawing-sheet layout is kept with it. */
    private function approvedBom(): void
    {
        foreach (['JTMR1', 'JTMR2'] as $code) {
            $id = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $id, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => "KHS {$code}", 'unit_text' => 'B', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
                'created_by' => $this->engineer->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        $type = (string) Str::uuid();
        DB::table('construction_types')->insert(['id' => $type, 'group_code' => 'SUTM', 'code' => 'SUTM-01', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('construction_type_versions')->insert(['id' => (string) Str::uuid(), 'construction_type_id' => $type, 'version_number' => 1, 'name' => 'A3C 150', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $this->engineer->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $id = app(BomService::class)->import($this->tiny(), '2026-01-01', 'unit test', false, $this->engineer)['summary']['id'];
        DB::table('bom_headers')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
    }

    private function download(): string
    {
        $res = $this->as($this->engineer)->get('/api/master-data/excel-imports/template');
        $res->assertOk();
        $path = $this->dir.'/template-'.uniqid().'.xlsx';
        File::put($path, $res->baseResponse->getFile()->getContent());

        return $path;
    }

    /** @return array<string,mixed> the report of the checked upload */
    private function upload(string $path, ?User $by = null): array
    {
        $up = $this->as($by ?? $this->engineer)->post('/api/master-data/excel-imports', ['file' => new UploadedFile($path, 'MASTER-DISTRIVA.xlsx', null, null, true), 'kind' => 'DISTRIVA'], ['Accept' => 'application/json'])->assertStatus(202)->json('data');
        app(MasterExcelImportService::class)->process($up['id']);

        return $this->as($this->engineer)->getJson('/api/master-data/excel-imports/'.$up['id'])->assertOk()->json('data');
    }

    /** Edits the downloaded workbook the way the parent unit would, then lets PhpSpreadsheet calculate (standing in for Excel). */
    private function edit(string $path, callable $change, bool $calculate = true): string
    {
        $reader = IOFactory::createReader('Xlsx');
        $reader->setReadDataOnly(false);
        $ss = $reader->load($path);
        $change($ss);
        $out = $this->dir.'/edited-'.uniqid().'.xlsx';
        $writer = new Xlsx($ss);
        $writer->setPreCalculateFormulas($calculate);
        $writer->save($out);

        return $out;
    }

    #[Test]
    public function the_template_is_built_from_the_approved_bom_and_only_for_those_who_manage_it(): void
    {
        $this->as($this->engineer)->get('/api/master-data/excel-imports/template')->assertStatus(409);       // nothing approved yet
        $this->approvedBom();
        $this->as($this->viewer)->get('/api/master-data/excel-imports/template')->assertForbidden();
        $path = $this->download();
        $ss = IOFactory::load($path);
        $this->assertSame(['PETUNJUK', 'INFO', 'KHS', 'STANDAR_KONSTRUKSI', 'HARGA', 'TARIF', 'GAMBAR', 'SUTM', '_PETA'], $ss->getSheetNames());
        $this->assertSame('=TRUNC((GAMBAR!U6*1.02*3)/1)*1', $ss->getSheetByName('SUTM')->getCell('I10')->getValue());    // the stored formula text, with the workbook's own cell references
        $this->assertSame('JTMR1', $ss->getSheetByName('SUTM')->getCell('B10')->getValue());
        $this->assertSame('A3C 150', $ss->getSheetByName('GAMBAR')->getCell('T6')->getValue());                          // label beside the PSG cell
    }

    #[Test]
    public function an_unchanged_workbook_is_a_no_change_whose_numbers_match_the_engine(): void
    {
        $this->approvedBom();
        $edited = $this->edit($this->download(), function ($ss) {
            $ss->getSheetByName('GAMBAR')->setCellValue('U6', 4)->setCellValue('V6', 2);                                     // real drawing inputs, not zeros
        });
        $report = $this->upload($edited)['report'];
        $this->assertFalse($report['blocked']);
        $g = $report['bom']['groups'][0];
        $this->assertSame(['SUTM', 'UNCHANGED'], [$g['group'], $g['status']]);
        $this->assertGreaterThan(5, $g['parity']['checked']);
        $this->assertSame(0, $g['parity']['mismatch_count']);
    }

    #[Test]
    public function a_changed_formula_becomes_a_draft_with_the_basis_recorded_and_never_touches_the_approved_version(): void
    {
        $this->approvedBom();
        $edited = $this->edit($this->download(), function ($ss) {
            $ss->getSheetByName('SUTM')->setCellValue('I11', '=TRUNC((I10*1.05)/1)*1');
            $ss->getSheetByName('GAMBAR')->setCellValue('U6', 4)->setCellValue('V6', 2);
            $ss->getSheetByName('INFO')->setCellValueExplicit('B5', '2026-12-01', 's')->setCellValueExplicit('B6', 'Surat 123/XYZ tanggal 1 Des 2026', 's');
        });
        $up = $this->upload($edited);
        $g = $up['report']['bom']['groups'][0];
        $this->assertSame(['CHANGED', 1, 0], [$g['status'], $g['changed'], $g['parity']['mismatch_count']]);
        $this->assertSame('2026-12-01', $up['report']['meta']['valid_from']);

        $this->as($this->engineer)->postJson('/api/master-data/excel-imports/'.$up['id'].'/apply', ['dataset' => 'BOM', 'valid_from' => '2026-12-01'])->assertCreated();
        $draft = DB::table('bom_headers')->where('group_code', 'SUTM')->where('status', 'DRAFT')->first();
        $this->assertNotNull($draft);
        $this->assertStringContainsString('Surat 123/XYZ', (string) $draft->source_reference);
        $this->assertSame(1, DB::table('bom_headers')->where('group_code', 'SUTM')->where('status', 'APPROVED')->count());
        $this->assertSame('TRUNC((I10*1.01)/1)*1', json_decode((string) DB::table('bom_lines as l')->join('bom_headers as h', 'h.id', '=', 'l.bom_header_id')->where('h.status', 'APPROVED')->where('l.sequence', 11)->value('l.source_formulas'), true)['I']);
        $this->assertSame(1, DB::table('bom_input_maps')->where('bom_header_id', $draft->id)->count());                    // the layout travels with the new version
    }

    #[Test]
    public function a_stored_excel_result_that_differs_from_the_engine_blocks_the_group(): void
    {
        $this->approvedBom();
        $edited = $this->edit($this->download(), function ($ss) {
            $ss->getSheetByName('SUTM')->setCellValue('I11', '=TRUNC((I10*1.05)/1)*1');
            $ss->getSheetByName('GAMBAR')->setCellValue('U6', 4);
        });
        $zip = new ZipArchive;
        $zip->open($edited);
        $n = array_search('SUTM', IOFactory::load($edited)->getSheetNames(), true) + 1;                                  // the sheet file of SUTM follows the sheet order
        $sheet = $zip->getFromName("xl/worksheets/sheet{$n}.xml");
        $tampered = preg_replace('/(<c r="I11"[^>]*><f>[^<]*<\/f><v>)[^<]*(<\/v>)/', '${1}99999${2}', $sheet, 1, $count);
        $this->assertSame(1, $count);
        $zip->addFromString("xl/worksheets/sheet{$n}.xml", $tampered);
        $zip->close();

        $g = $this->upload($edited)['report']['bom']['groups'][0];
        $this->assertSame('BLOCKED', $g['status']);
        $this->assertGreaterThan(0, $g['parity']['mismatch_count']);
        $this->assertSame('SUTM!I11', $g['parity']['mismatches'][0]['cell']);
        $this->assertStringContainsString('berbeda', implode(' ', $g['problems']));
    }

    #[Test]
    public function layout_mistakes_are_reported_by_cell_and_nothing_is_compared(): void
    {
        $this->approvedBom();
        $path = $this->download();

        $wrongTemplate = $this->edit($path, fn ($ss) => $ss->getSheetByName('INFO')->setCellValueExplicit('B3', '0', 's'));
        $r = $this->upload($wrongTemplate)['report'];
        $this->assertTrue($r['blocked']);
        $this->assertStringContainsString('Versi template', $r['layout_problems'][0]);

        $text = $this->edit($path, fn ($ss) => $ss->getSheetByName('SUTM')->setCellValue('J10', 'banyak'));
        $this->assertStringContainsString('SUTM!J10', $this->upload($text)['report']['layout_problems'][0]);

        $shifted = $this->edit($path, fn ($ss) => $ss->getSheetByName('SUTM')->setCellValue('A11', 99));
        $this->assertStringContainsString('SUTM!A11', $this->upload($shifted)['report']['layout_problems'][0]);

        $badDate = $this->edit($path, fn ($ss) => $ss->getSheetByName('INFO')->setCellValueExplicit('B5', 'besok', 's'));
        $this->assertStringContainsString('Berlaku sejak', $this->upload($badDate)['report']['layout_problems'][0]);

        $notAWorkbook = $this->dir.'/x.xlsx';
        File::copy($path, $notAWorkbook);
        $this->assertSame([], $this->upload($notAWorkbook)['report']['layout_problems']);                                      // control: the untouched file passes
    }

    #[Test]
    public function an_unknown_khs_code_in_the_workbook_blocks_the_group_with_the_cell(): void
    {
        $this->approvedBom();
        $edited = $this->edit($this->download(), fn ($ss) => $ss->getSheetByName('SUTM')->setCellValueExplicit('B10', 'TIDAKADA', 's'));
        $g = $this->upload($edited)['report']['bom']['groups'][0];
        $this->assertSame('BLOCKED', $g['status']);
        $this->assertStringContainsString('TIDAKADA', implode(' ', $g['problems']));
    }

    private function csv(string $content): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'mw');
        file_put_contents($p, $content);

        return new UploadedFile($p, 'x.csv', 'text/csv', null, true);
    }

    /** An approved price book and tariff book next to the BOM, the way the screen imports them. */
    private function approvedBooks(): void
    {
        $this->approvedBom();
        $up3 = DB::table('organizational_units')->where('unit_type', 'UP3')->first();
        $ulp = $this->makeUnit('ULP', OrganizationalUnit::query()->findOrFail($up3->id));
        $books = app(PriceBookService::class);
        $id = $books->import($this->csv("kode,nama,status_material,harga_material,nilai_asuransi,z1_pasang,z1_bongkar\nJTMR1,A,HARGA,400,,100,50\nJTMR2,B,PLN,,7,200,100\n"), 'Buku harga lama', 'KONTRAK-1', '2026-01-01', 'uji', false, $this->engineer)['summary']['id'];
        $books->setZone($id, (string) $up3->id, 1, 'uji zona', $this->engineer);
        DB::table('price_books')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
        $tid = app(TariffBookService::class)->import($this->csv("tarif,daya_va,harga_rata2,jam_nyala,ujl,ulp\nB1,450,535,137,80,{$ulp->code}\nB1,900,630,149,80,\n"), 'Buku tarif lama', '2026-01-01', 'uji', false, $this->engineer)['summary']['tariff_book_id'];
        DB::table('tariff_books')->where('id', $tid)->update(['status' => 'APPROVED', 'approved_by' => $this->manager->getKey(), 'approved_at' => now()]);
    }

    #[Test]
    public function the_template_carries_the_approved_price_and_tariff_books_and_an_unchanged_upload_changes_nothing(): void
    {
        $this->approvedBooks();
        $ss = IOFactory::load($this->download());
        $h = $ss->getSheetByName('HARGA');
        $this->assertSame(['KODE KHS', 'NAMA', 'STATUS MATERIAL', 'HARGA MATERIAL', 'NILAI ASURANSI', 'ZONA 1 PASANG', 'ZONA 1 BONGKAR'], array_map(fn ($c) => $h->getCell([$c, 4])->getValue(), range(1, 7)));
        $this->assertEquals(['JTMR1', 'HARGA', 400, 100, 50], [$h->getCell('A5')->getValue(), $h->getCell('C5')->getValue(), $h->getCell('D5')->getValue(), $h->getCell('F5')->getValue(), $h->getCell('G5')->getValue()]);
        $this->assertSame('PLN', $h->getCell('C6')->getValue());
        $t = $ss->getSheetByName('TARIF');
        $this->assertEquals(['B1', 450, 535, 137, 80], [$t->getCell('A5')->getValue(), $t->getCell('B5')->getValue(), $t->getCell('C5')->getValue(), $t->getCell('D5')->getValue(), $t->getCell('E5')->getValue()]);

        $report = $this->upload($this->edit($this->download(), fn ($s) => null))['report'];
        $this->assertSame(['UNCHANGED', 'UNCHANGED'], [$report['price']['status'], $report['tariff']['status']]);
        $this->assertSame(2, $report['tariff']['excel_rows']);
    }

    #[Test]
    public function changed_prices_and_tariffs_become_drafts_that_keep_what_was_not_touched(): void
    {
        $this->approvedBooks();
        $edited = $this->edit($this->download(), function ($ss) {
            $ss->getSheetByName('HARGA')->setCellValue('D5', 450)->setCellValue('F5', 120);        // material price and install price of zone 1
            $ss->getSheetByName('TARIF')->setCellValue('D5', 140)->setCellValue('E6', 85);          // jam nyala of the ULP row and UJL of the general row
            $ss->getSheetByName('INFO')->setCellValueExplicit('B5', '2026-12-01', 's');
        });
        $up = $this->upload($edited);
        $this->assertSame(['CHANGED', 1], [$up['report']['price']['status'], $up['report']['price']['changed_rows']]);
        $this->assertSame(['CHANGED', 2], [$up['report']['tariff']['status'], $up['report']['tariff']['changed_rows']]);

        $apply = fn (array $body) => $this->as($this->engineer)->postJson('/api/master-data/excel-imports/'.$up['id'].'/apply', $body + ['valid_from' => '2026-12-01'])->assertCreated();
        $apply(['dataset' => 'PRICE', 'name' => 'Buku harga baru']);
        $apply(['dataset' => 'TARIFF', 'name' => 'Buku tarif baru']);

        $pb = DB::table('price_books')->where('name', 'Buku harga baru')->first();
        $this->assertSame('DRAFT', $pb->status);
        $items = DB::table('price_book_items as p')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')->where('p.price_book_id', $pb->id)->get(['i.code', 'p.material_status', 'p.material_price', 'p.insured_value', 'p.id'])->keyBy('code');
        $this->assertSame([450.0, 'PRICED'], [(float) $items['JTMR1']->material_price, $items['JTMR1']->material_status]);
        $this->assertSame(['PLN', 7.0], [$items['JTMR2']->material_status, (float) $items['JTMR2']->insured_value]);                  // status and insured value are kept
        $this->assertSame(120.0, (float) DB::table('price_book_service_prices')->where('price_book_item_id', $items['JTMR1']->id)->value('install_price'));

        $tb = DB::table('tariff_books')->where('name', 'Buku tarif baru')->first();
        $rows = DB::table('tariff_book_rows')->where('tariff_book_id', $tb->id)->orderBy('power_va')->get(['power_va', 'jam_nyala', 'ujl', 'ulp_unit_id']);
        $this->assertSame([[450, 140.0, 80.0], [900, 149.0, 85.0]], $rows->map(fn ($r) => [(int) $r->power_va, (float) $r->jam_nyala, (float) $r->ujl])->all());
        $this->assertNull($rows[1]->ulp_unit_id);                                                                                    // the general row stays general
        $this->assertSame(1, DB::table('price_books')->where('status', 'APPROVED')->count());
    }

    #[Test]
    public function price_and_tariff_mistakes_are_reported_by_cell(): void
    {
        $this->approvedBooks();
        $path = $this->download();

        $text = $this->edit($path, fn ($ss) => $ss->getSheetByName('HARGA')->setCellValue('D5', 'mahal'));
        $this->assertStringContainsString('HARGA!D5', $this->upload($text)['report']['layout_problems'][0]);

        $negative = $this->edit($path, fn ($ss) => $ss->getSheetByName('TARIF')->setCellValue('C5', -1));
        $this->assertStringContainsString('TARIF!C5', $this->upload($negative)['report']['layout_problems'][0]);

        $unknownUlp = $this->edit($path, fn ($ss) => $ss->getSheetByName('TARIF')->setCellValueExplicit('F6', '99999', 's'));
        $r = $this->upload($unknownUlp)['report'];
        $this->assertTrue($r['blocked']);
        $this->assertStringContainsString('99999', implode(' ', $r['layout_problems']));

        $head = $this->edit($path, fn ($ss) => $ss->getSheetByName('HARGA')->setCellValueExplicit('D4', 'HARGA', 's'));
        $this->assertStringContainsString('HARGA!D4', $this->upload($head)['report']['layout_problems'][0]);
    }
}
