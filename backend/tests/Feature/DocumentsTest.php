<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Documents\DocumentService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class DocumentsTest extends PostgresTestCase
{
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $retail;

    private User $manager;

    private User $teknik;

    private User $teknik2;

    private User $managerB;

    private User $vendor;

    private string $survey;

    private string $version;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(SurveyPermissionSeeder::class);
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
        $this->vendor = $mk('VENDOR', $this->ulpA);

        $app = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti'], 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$app}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG1'])->assertCreated();
        $r = $this->as($this->manager)->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        $this->survey = $r->json('data.id');
        $this->version = $r->json('data.versions.0.id');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function png(string $name = 'foto.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, (string) base64_decode(self::PNG));
    }

    private function upload(UploadedFile $file, ?User $by = null, ?string $version = null)
    {
        return $this->as($by ?? $this->teknik)->post("/api/surveys/{$this->survey}/versions/".($version ?? $this->version).'/documents', ['file' => $file, 'title' => 'Foto tiang'], ['Accept' => 'application/json']);
    }

    #[Test]
    public function a_photo_is_stored_on_the_private_disk_with_hash_size_and_an_opaque_key(): void
    {
        $r = $this->upload($this->png())->assertCreated();
        $this->assertSame(['SURVEY', 1, 'image/png', 'Foto tiang'], [$r->json('data.category'), $r->json('data.version_number'), $r->json('data.mime_type'), $r->json('data.title')]);
        $v = DB::table('application_document_versions')->first();
        $this->assertSame(hash('sha256', (string) base64_decode(self::PNG)), $v->sha256);
        $this->assertSame(strlen((string) base64_decode(self::PNG)), (int) $v->size_bytes);
        $this->assertTrue(Storage::disk('documents')->exists($v->stored_key));
        $this->assertStringNotContainsString('foto', $v->stored_key);                      // the client's name never reaches the path
        $this->assertStringStartsWith('documents/', $v->stored_key);
        $this->assertStringStartsWith('DOC-', $r->json('data.document_code'));
        $this->assertNotContains('stored_key', array_keys($r->json('data')));              // never exposed
        $this->assertSame($v->id, DB::table('application_documents')->value('current_version_id'));
        $this->assertSame('UPLOAD', DB::table('document_access_logs')->value('action'));
    }

    #[Test]
    public function files_are_checked_by_content_extension_and_size_not_by_what_the_client_says(): void
    {
        $this->upload(UploadedFile::fake()->createWithContent('foto.jpg', (string) base64_decode(self::PNG)))->assertStatus(409);                       // PNG bytes named .jpg
        $this->upload(UploadedFile::fake()->createWithContent('virus.jpg', "MZ\x90\x00\x03\x00\x00\x00 executable bytes"))->assertStatus(409);        // executable disguised
        $this->upload(UploadedFile::fake()->createWithContent('catatan.txt', 'halo'))->assertStatus(409);                                              // not an allowed type
        $this->upload(UploadedFile::fake()->createWithContent('gambar.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))->assertStatus(409);
        $this->upload(UploadedFile::fake()->createWithContent('kosong.png', ''))->assertStatus(409);
        $this->upload(UploadedFile::fake()->createWithContent('besar.pdf', '%PDF-1.4 '.str_repeat('x', 10 * 1024 * 1024 + 10)))->assertStatus(409);
        $this->upload(UploadedFile::fake()->createWithContent('laporan.pdf', "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"))->assertCreated();
        $this->assertSame(1, DB::table('application_documents')->count());
        $this->assertCount(1, Storage::disk('documents')->allFiles());                         // rejected uploads leave nothing behind
    }

    #[Test]
    public function only_the_assigned_surveyor_uploads_and_only_while_the_version_is_a_draft(): void
    {
        $this->upload($this->png(), $this->teknik2)->assertForbidden();
        $this->upload($this->png(), $this->manager)->assertForbidden();
        $this->upload($this->png(), $this->retail)->assertForbidden();
        $this->upload($this->png(), $this->vendor)->assertForbidden();
        $this->upload($this->png(), $this->managerB)->assertForbidden();
        $this->as($this->vendor)->post("/api/surveys/{$this->survey}/versions/{$this->version}/documents", [], ['Accept' => 'application/json'])->assertForbidden();           // grant before validation
        $this->as($this->teknik)->post("/api/surveys/{$this->survey}/versions/{$this->version}/documents", [], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->upload($this->png(), $this->teknik, (string) Str::uuid())->assertNotFound();
        $this->assertSame(0, DB::table('application_documents')->count());

        $this->upload($this->png())->assertCreated();
        DB::table('application_survey_versions')->where('id', $this->version)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER']);
        $this->upload($this->png('b.png'))->assertStatus(409);                              // after submit the evidence is part of the frozen submission
    }

    #[Test]
    public function the_number_of_documents_per_version_is_limited(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->upload($this->png("f{$i}.png"))->assertCreated();
        }
        $this->upload($this->png('terlalu-banyak.png'))->assertStatus(409);
        $this->assertSame(30, DB::table('application_documents')->count());
    }

    #[Test]
    public function download_is_authorised_by_the_application_scope_logged_and_served_safely(): void
    {
        $id = $this->upload($this->png())->json('data.id');
        foreach ([$this->retail, $this->manager, $this->teknik, $this->teknik2] as $u) {
            $r = $this->as($u)->get("/api/documents/{$id}/download");
            $r->assertOk();
            $this->assertSame('nosniff', $r->headers->get('X-Content-Type-Options'));
            $this->assertStringContainsString('attachment', (string) $r->headers->get('Content-Disposition'));
            $this->assertStringContainsString('no-store', (string) $r->headers->get('Cache-Control'));
            $this->assertSame('image/png', $r->headers->get('Content-Type'));
        }
        $this->as($this->teknik)->get("/api/documents/{$id}/download?inline=1")->assertOk();
        $this->assertSame(4, DB::table('document_access_logs')->where('action', 'DOWNLOAD')->count());
        $this->assertSame(1, DB::table('document_access_logs')->where('action', 'VIEW')->count());

        $this->as($this->managerB)->get("/api/documents/{$id}/download")->assertNotFound();                  // another ULP: hidden
        $this->as($this->vendor)->get("/api/documents/{$id}/download")->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->getJson("/api/documents/{$id}/download")->assertUnauthorized();
        $this->as($this->teknik)->get('/api/documents/'.Str::uuid().'/download')->assertNotFound();
        $this->as($this->teknik)->getJson("/api/documents/{$id}")->assertOk()->assertJsonMissing(['stored_key']);
    }

    #[Test]
    public function a_spreadsheet_can_be_previewed_as_a_bounded_table_under_the_same_scope_as_download(): void
    {
        $book = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $book->getActiveSheet()->setTitle('RAB')->fromArray([['Uraian', 'Volume'], ['Tiang beton 11m', 3]]);
        $pic = new \PhpOffice\PhpSpreadsheet\Worksheet\Drawing;
        $img = tempnam(sys_get_temp_dir(), 'pn');
        file_put_contents($img, (string) base64_decode(self::PNG));
        $pic->setName('Denah')->setPath($img)->setCoordinates('D2');
        $pic->setWorksheet($book->getActiveSheet());
        $path = tempnam(sys_get_temp_dir(), 'xl').'.xlsx';
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($book))->save($path);
        $file = UploadedFile::fake()->createWithContent('rab.xlsx', (string) file_get_contents($path));
        @unlink($path);
        DB::table('document_categories')->where('code', 'SURVEY')->update(['allowed_extensions' => json_encode(['png', 'xlsx'])]);  // drawings allow xlsx; reuse the survey fixture
        $id = $this->upload($file)->assertCreated()->json('data.id');

        $r = $this->as($this->manager)->getJson("/api/documents/{$id}/preview")->assertOk();
        $this->assertSame('RAB', $r->json('data.sheets.0.name'));
        $this->assertSame([['Uraian', 'Volume', '', ''], ['Tiang beton 11m', '3', '', '']], $r->json('data.sheets.0.rows'));
        $this->assertFalse($r->json('data.sheets.0.truncated'));
        $this->assertCount(1, $r->json('data.sheets.0.images'));
        $this->assertStringStartsWith('data:image/png;base64,', $r->json('data.sheets.0.images.0.src'));
        $this->assertSame(1, DB::table('document_access_logs')->where('action', 'VIEW')->count());

        $this->as($this->managerB)->getJson("/api/documents/{$id}/preview")->assertNotFound();
        $png = $this->upload($this->png())->json('data.id');
        $this->as($this->manager)->getJson("/api/documents/{$png}/preview")->assertStatus(409);
    }

    #[Test]
    public function a_spreadsheet_is_rendered_to_pdf_through_the_converter_cached_and_degrades_when_it_is_missing(): void
    {
        $book = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $book->getActiveSheet()->fromArray([['A', 'B']]);
        $path = tempnam(sys_get_temp_dir(), 'xl').'.xlsx';
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($book))->save($path);
        DB::table('document_categories')->where('code', 'SURVEY')->update(['allowed_extensions' => json_encode(['png', 'xlsx'])]);
        $id = $this->upload(UploadedFile::fake()->createWithContent('g.xlsx', (string) file_get_contents($path)))->assertCreated()->json('data.id');
        @unlink($path);

        config(['distriva.soffice_binary' => '/nonexistent/soffice']);
        $this->as($this->manager)->getJson("/api/documents/{$id}/preview")->assertOk()->assertJsonPath('data.render_available', false);
        $this->as($this->manager)->getJson("/api/documents/{$id}/preview-pdf")->assertStatus(409);

        // A stand-in converter: copies a tiny PDF to --outdir/in.pdf and counts its runs.
        $counter = tempnam(sys_get_temp_dir(), 'cnt');
        $fake = tempnam(sys_get_temp_dir(), 'fk');
        file_put_contents($fake, "#!/bin/sh\nwhile [ \"\$1\" != \"--outdir\" ]; do shift; done\nmkdir -p \"\$2\"; printf '%%PDF-1.4 fake' > \"\$2/in.pdf\"\necho x >> {$counter}\n");
        chmod($fake, 0755);
        config(['distriva.soffice_binary' => $fake]);

        $this->as($this->manager)->getJson("/api/documents/{$id}/preview")->assertJsonPath('data.render_available', true);
        $r = $this->as($this->manager)->get("/api/documents/{$id}/preview-pdf")->assertOk();
        $this->assertSame('application/pdf', $r->headers->get('Content-Type'));
        $this->as($this->manager)->get("/api/documents/{$id}/preview-pdf")->assertOk();
        $this->assertSame(1, substr_count((string) file_get_contents($counter), 'x'));   // second call served from the cache
        $this->as($this->managerB)->get("/api/documents/{$id}/preview-pdf")->assertNotFound();
        @unlink($fake);
        @unlink($counter);
    }

    #[Test]
    public function the_render_copy_gets_a_print_area_and_fits_one_page_while_the_original_is_untouched(): void
    {
        $book = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $book->getActiveSheet()->setTitle('GAMBAR')->fromArray([['a', 'b'], ['c', 'd'], ['e', 'f']]);
        $book->getActiveSheet()->getStyle('Z90')->getFont()->setBold(true);   // styled but empty: must not stretch the print area
        $path = tempnam(sys_get_temp_dir(), 'xl').'.xlsx';
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($book))->save($path);
        $copy = tempnam(sys_get_temp_dir(), 'xc').'.xlsx';
        copy($path, $copy);

        $svc = app(\App\Services\Documents\DocumentService::class);
        $m = new \ReflectionMethod($svc, 'fitSheetsForRender');
        $m->setAccessible(true);
        $m->invoke($svc, $copy);

        $zip = new \ZipArchive;
        $zip->open($copy);
        $this->assertStringContainsString("'GAMBAR'!\$A\$1:\$B\$3", (string) $zip->getFromName('xl/workbook.xml'));
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $this->assertStringContainsString('fitToPage="1"', $sheet);
        $this->assertStringContainsString('fitToWidth="1" fitToHeight="1"', $sheet);
        $zip->close();
        $this->assertSame(md5_file($path), md5_file($path));
        $orig = new \ZipArchive;
        $orig->open($path);
        $this->assertStringNotContainsString('Print_Area', (string) $orig->getFromName('xl/workbook.xml'));
        $orig->close();
        @unlink($path);
        @unlink($copy);
    }

    #[Test]
    public function listing_per_application_and_removal_while_the_version_is_a_draft_keep_the_files_and_the_history(): void
    {
        $a = $this->upload($this->png('a.png'))->json('data.id');
        $b = $this->upload($this->png('b.png'))->json('data.id');
        $appId = DB::table('application_documents')->value('application_id');
        $this->assertCount(2, $this->as($this->manager)->getJson("/api/applications/{$appId}/documents")->assertOk()->json('data'));
        $this->as($this->managerB)->getJson("/api/applications/{$appId}/documents")->assertNotFound();

        $this->as($this->teknik2)->postJson("/api/documents/{$a}/remove")->assertForbidden();
        $this->as($this->teknik)->postJson("/api/documents/{$a}/remove")->assertOk();
        $this->as($this->teknik)->postJson("/api/documents/{$a}/remove")->assertStatus(409);
        $this->assertCount(1, $this->as($this->manager)->getJson("/api/applications/{$appId}/documents")->json('data'));
        $this->as($this->manager)->get("/api/documents/{$a}/download")->assertNotFound();
        $this->assertSame('REMOVED', DB::table('application_documents')->where('id', $a)->value('status'));
        $this->assertSame(2, DB::table('application_document_versions')->count());                                     // nothing deleted
        $this->assertCount(2, Storage::disk('documents')->allFiles());

        DB::table('application_survey_versions')->where('id', $this->version)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER']);
        $this->as($this->teknik)->postJson("/api/documents/{$b}/remove")->assertStatus(409);                            // frozen with the submission
    }

    #[Test]
    public function a_revision_adds_a_version_supersedes_the_old_one_and_never_overwrites(): void
    {
        $id = $this->upload($this->png('a.png'))->json('data.id');
        $doc = DB::table('application_documents')->where('id', $id)->first();
        $service = app(DocumentService::class);
        $n = $service->addVersion($id, UploadedFile::fake()->createWithContent('a2.png', (string) base64_decode(self::PNG)), 'Foto lebih jelas', $this->teknik);
        $this->assertSame(2, $n);

        $versions = DB::table('application_document_versions')->where('document_id', $id)->orderBy('version_number')->get();
        $this->assertSame(['SUPERSEDED', 'UPLOADED'], $versions->pluck('lifecycle_status')->all());
        $this->assertSame($versions[0]->id, $versions[1]->previous_version_id);
        $this->assertNotSame($versions[0]->stored_key, $versions[1]->stored_key);
        $this->assertSame($versions[1]->id, DB::table('application_documents')->where('id', $id)->value('current_version_id'));
        $this->assertTrue(Storage::disk('documents')->exists($versions[0]->stored_key));                                  // the old file is still there
        $this->as($this->manager)->get("/api/documents/{$id}/download?version=1")->assertOk();
        $this->as($this->manager)->get("/api/documents/{$id}/download?version=9")->assertNotFound();
        $this->assertSame($doc->document_code, DB::table('application_documents')->where('id', $id)->value('document_code'));
    }

    #[Test]
    public function the_database_keeps_versions_immutable_the_log_append_only_and_the_pointer_inside_its_document(): void
    {
        $a = $this->upload($this->png('a.png'))->json('data.id');
        $b = $this->upload($this->png('b.png'))->json('data.id');
        $va = DB::table('application_document_versions')->where('document_id', $a)->value('id');
        $vb = DB::table('application_document_versions')->where('document_id', $b)->value('id');

        $this->assertDbRejects(fn () => DB::table('application_document_versions')->where('id', $va)->update(['sha256' => str_repeat('0', 64)]));
        $this->assertDbRejects(fn () => DB::table('application_document_versions')->where('id', $va)->update(['stored_key' => 'documents/other']));
        $this->assertDbRejects(fn () => DB::table('application_document_versions')->where('id', $va)->delete());
        $this->assertDbRejects(fn () => DB::table('application_document_versions')->where('id', $va)->update(['lifecycle_status' => 'DELETED']));
        $this->assertDbRejects(fn () => DB::table('document_access_logs')->update(['action' => 'VIEW']));
        $this->assertDbRejects(fn () => DB::table('document_access_logs')->delete());
        $this->assertDbRejects(function () use ($a, $vb): void {                                                      // a version of ANOTHER document (the FK is deferred: check it now)
            DB::statement('SET CONSTRAINTS application_documents_current_version_fk IMMEDIATE');
            DB::table('application_documents')->where('id', $a)->update(['current_version_id' => $vb]);
        });
        $this->assertDbRejects(fn () => DB::table('application_document_versions')->where('id', $va)->update(['sha256' => 'zz']));
    }

    #[Test]
    public function a_survey_detail_lists_its_documents_per_version(): void
    {
        $this->upload($this->png('a.png'))->assertCreated();
        $d = $this->as($this->manager)->getJson("/api/surveys/{$this->survey}")->assertOk()->json('data.versions.0.documents');
        $this->assertCount(1, $d);
        $this->assertSame(['Foto tiang', 'a.png', 'image/png'], [$d[0]['title'], $d[0]['original_name'], $d[0]['mime_type']]);
        $this->assertArrayNotHasKey('stored_key', $d[0]);
    }

    #[Test]
    public function the_storage_root_must_be_private_and_the_check_command_reports_it(): void
    {
        $this->artisan('distriva:documents-check')->assertSuccessful();

        config(['filesystems.disks.documents.root' => public_path('uploads')]);
        $this->artisan('distriva:documents-check')->assertFailed();
        $this->expectException(\RuntimeException::class);
        app(DocumentService::class)->upload((string) DB::table('applications')->value('id'), 'SURVEY', $this->png(), null, null, $this->teknik);
    }
}
