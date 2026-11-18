<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\Bom\BomService;
use App\Services\Master\MasterExcelImportService;
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
        $this->assertSame(['PETUNJUK', 'INFO', 'KHS', 'STANDAR_KONSTRUKSI', 'GAMBAR', 'SUTM', '_PETA'], $ss->getSheetNames());
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
        $sheet = $zip->getFromName('xl/worksheets/sheet6.xml');
        $tampered = preg_replace('/(<c r="I11"[^>]*><f>[^<]*<\/f><v>)[^<]*(<\/v>)/', '${1}99999${2}', $sheet, 1, $n);
        $this->assertSame(1, $n);
        $zip->addFromString('xl/worksheets/sheet6.xml', $tampered);
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
}
