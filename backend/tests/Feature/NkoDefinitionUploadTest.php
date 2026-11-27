<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoDefinitionImportService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PHPUnit\Framework\Attributes\Test;
use Tests\Concerns\BuildsNkoWorkbook;
use Tests\PostgresTestCase;

class NkoDefinitionUploadTest extends PostgresTestCase
{
    use BuildsNkoWorkbook;

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    private User $planner;

    private User $asman;

    /** workbook yang dimuat setUp; xlsx yang dibangun ulang memuat cap waktu, jadi "berkas yang sama" harus berkas ini */
    private string $loaded;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake((string) config('distriva.documents_disk', 'documents'));
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(NkoPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $this->ulp->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
        $this->planner = $this->actor('PERENCANAAN', $this->up3);
        $this->asman = $this->actor('ASMAN_PERENCANAAN', $this->up3);
        $this->loaded = $this->book();
        app(NkoDefinitionImportService::class)->import($this->loaded, 'nko.xlsx');
    }

    /** workbook uji yang lolos pemeriksaan unggah (bobot kelompok 100) */
    private function book(array $tabs = ['UP3 MOJOKERTO', 'ULP JOMBANG'], float $saidiWeight = 6, string $saidiName = 'SAIDI'): string
    {
        return $this->workbook($tabs, $saidiWeight, saidiName: $saidiName, reliabilityWeight: 86);
    }

    private function actor(string $role, OrganizationalUnit $unit): User
    {
        $user = $this->makeUser();
        $this->assign($user, Role::query()->where('name', $role)->firstOrFail(), $unit);

        return $user;
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function upload(string $path, ?User $user = null, int $year = 2026, string $endpoint = '/api/nko/definition-uploads')
    {
        return $this->as($user ?? $this->planner)->post($endpoint, ['file' => new UploadedFile($path, 'nko-rev.xlsx', null, null, true), 'year' => $year, 'note' => 'Revisi kontrak'], ['Accept' => 'application/json']);
    }

    private function check(string $path, int $year = 2026): array
    {
        return $this->upload($path, null, $year, '/api/nko/definition-uploads/check')->assertOk()->json('data');
    }

    /** @param  array<string, array<string, mixed>>  $cells  tab => sel => nilai (null mengosongkan) */
    private function edited(string $path, array $cells): string
    {
        $book = IOFactory::load($path);
        foreach ($cells as $tab => $values) {
            foreach ($values as $cell => $value) {
                $book->getSheetByName($tab)->setCellValue($cell, $value);
            }
        }
        $this->save($book, $path);

        return $path;
    }

    private function activeSets(): array
    {
        return DB::table('kpi_definition_sets')->where('status', 'AKTIF')->orderBy('unit_level')->pluck('version', 'unit_level')->all();
    }

    #[Test]
    public function definisi_baru_aktif_hanya_setelah_disetujui_orang_lain(): void
    {
        $id = $this->upload($this->book(saidiWeight: 8, saidiName: 'SAIDI Distribusi'))->assertCreated()->json('data.id');
        $this->assertSame(['ULP' => 1, 'UP3' => 1], $this->activeSets());                                     // unggahan belum mengubah definisi

        $changes = array_column($this->as($this->planner)->getJson("/api/nko/definition-uploads/{$id}")->assertOk()->json('data.changes'), null, 'level');
        $this->assertSame(['saidi-distribusi'], array_column($changes['ULP']['added'], 'code'));
        $this->assertTrue($changes['ULP']['added'][0]['needs_realization']);
        $this->assertFalse($changes['ULP']['added'][0]['has_rule']);
        $this->assertSame(['saidi'], array_column($changes['ULP']['removed'], 'code'));
        $this->assertTrue($changes['ULP']['removed'][0]['has_rule']);
        $this->assertSame('saidi-distribusi', $changes['ULP']['possible_renames'][0]['to_code']);
        $this->assertSame([], $changes['ULP']['changed']);

        $this->upload($this->book(saidiWeight: 9))->assertStatus(409);                                    // satu yang menunggu per tahun
        $this->as($this->planner)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertForbidden();

        $result = $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk()->json('data');
        $this->assertSame(['ULP' => 2, 'UP3' => 2], $this->activeSets());
        $this->assertContains('saidi-distribusi', array_column($result['mapping']['unmapped'], 'code'));
        $this->assertSame(['DIGANTIKAN', 'DIGANTIKAN'], array_column($result['sets'], 'status'));
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertStatus(409);
        $versions = $this->as($this->planner)->getJson('/api/nko/definition-sets?year=2026')->assertOk()->json('data');
        $this->assertSame([[2, 'AKTIF'], [1, 'ARSIP']], array_map(fn (array $v) => [$v['version'], $v['status']], array_values(array_filter($versions, fn (array $v) => $v['unit_level'] === 'ULP'))));
    }

    #[Test]
    public function perubahan_bobot_dilaporkan_per_item(): void
    {
        $id = $this->upload($this->book(saidiWeight: 8))->assertCreated()->json('data.id');
        $ulp = array_column($this->as($this->planner)->getJson("/api/nko/definition-uploads/{$id}")->json('data.changes'), null, 'level')['ULP'];

        $this->assertSame([], $ulp['added']);
        $this->assertSame(['saidi'], array_column($ulp['changed'], 'code'));
        $this->assertEquals(['weight' => ['from' => 6, 'to' => 8]], $ulp['changed'][0]['fields']);
        $this->assertSame([], $ulp['targets_changed']);
    }

    #[Test]
    public function beda_spasi_pada_rumus_tidak_dilaporkan_sebagai_perubahan(): void
    {
        $set = DB::table('kpi_definition_sets')->where('unit_level', 'ULP')->value('id');
        $row = DB::table('kpi_definitions')->where('set_id', $set)->where('code', 'saidi')->first();
        $rules = json_decode($row->rules, true);
        $rules['pencapaian'] = str_replace(',', ', ', $rules['pencapaian']);
        DB::table('kpi_definitions')->where('id', $row->id)->update(['rules' => json_encode($rules)]);

        $id = $this->upload($this->book(saidiWeight: 8))->assertCreated()->json('data.id');
        $ulp = array_column($this->as($this->planner)->getJson("/api/nko/definition-uploads/{$id}")->json('data.changes'), null, 'level')['ULP'];

        $this->assertSame(['weight'], array_keys($ulp['changed'][0]['fields']));
        $this->assertFalse($ulp['total_rule_changed']);
    }

    #[Test]
    public function ditolak_wajib_beralasan_dan_berkasnya_dihapus(): void
    {
        $id = $this->upload($this->book(saidiWeight: 8))->assertCreated()->json('data.id');
        $key = DB::table('kpi_definition_uploads')->where('id', $id)->value('file_key');
        $disk = Storage::disk((string) config('distriva.documents_disk', 'documents'));
        $disk->assertExists($key);

        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'reject'])->assertStatus(422);
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'reject', 'note' => 'Berkas salah'])->assertOk();

        $disk->assertMissing($key);
        $this->assertSame(['ULP' => 1, 'UP3' => 1], $this->activeSets());
    }

    #[Test]
    public function persetujuan_ditolak_bila_definisi_aktif_sudah_berubah(): void
    {
        $id = $this->upload($this->book(saidiWeight: 8))->assertCreated()->json('data.id');
        app(NkoDefinitionImportService::class)->import($this->book(saidiWeight: 9), 'lain.xlsx');          // impor lewat server di antara unggah dan putusan

        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertStatus(409);
        $this->assertSame(['ULP' => 2, 'UP3' => 2], $this->activeSets());
    }

    #[Test]
    public function berkas_yang_sama_berkas_rusak_dan_peran_ulp_ditolak(): void
    {
        $this->upload($this->loaded)->assertStatus(422);
        $broken = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        file_put_contents($broken, 'bukan workbook');
        $this->upload($broken)->assertStatus(422);
        $this->upload($this->book(saidiWeight: 8), $this->actor('MANAGER_ULP', $this->ulp))->assertForbidden();
        $this->assertSame(0, DB::table('kpi_definition_uploads')->count());
    }

    #[Test]
    public function pemeriksaan_melaporkan_per_tab_dan_unggahan_yang_tidak_lolos_ditolak_beserta_rinciannya(): void
    {
        $path = $this->book(['ULP JOMBANG', 'ULP ANTAH', 'ULP']);
        $report = $this->check($path, 2025);

        $this->assertFalse($report['can_upload']);
        $this->assertSame(2026, $report['year_found']);
        $this->assertContains('Berkas berisi definisi tahun 2026 (sel H9), bukan 2025.', $report['errors']);
        $tabs = array_column($report['tabs'], null, 'sheet');
        $this->assertSame('DILEWATI', $tabs['ULP']['status']);
        $this->assertStringContainsString('nama tab harus', $tabs['ULP']['reason']);

        $report = $this->check($path);
        $tabs = array_column($report['tabs'], null, 'sheet');
        $this->assertTrue($tabs['ULP JOMBANG']['unit_found']);
        $this->assertSame([], $tabs['ULP JOMBANG']['errors']);
        $this->assertFalse($tabs['ULP ANTAH']['unit_found']);
        $this->assertStringContainsString('tidak ada di master unit', $tabs['ULP ANTAH']['errors'][0]);
        $this->assertSame(['Tab ULP ANTAH: '.$tabs['ULP ANTAH']['errors'][0]], $report['errors']);

        $refused = $this->upload($path)->assertStatus(422);
        $this->assertStringStartsWith('Workbook belum dapat diunggah:', $refused->json('message'));
        $this->assertFalse($refused->json('data.can_upload'));
        $this->assertSame(0, DB::table('kpi_definition_uploads')->count());
    }

    #[Test]
    public function bobot_target_kosong_dan_rumus_target_tanpa_nilai_menghentikan_unggahan(): void
    {
        $path = $this->edited($this->book(['ULP JOMBANG']), ['ULP JOMBANG' => ['F12' => 14, 'M13' => null, 'N13' => null, 'M11' => "='[2]TARGET'!A1"]]);
        $tab = array_column($this->check($path)['tabs'], null, 'sheet')['ULP JOMBANG'];
        $errors = $tab['errors'];

        $this->assertSame('jumlah bobot kelompok 28, harus 100.', $errors[0]);
        $this->assertStringContainsString('1 sel target berisi rumus tanpa nilai tersimpan', $errors[1]);
        // SAIDI sudah punya target di versi aktif, jadi disalin; tanpa versi aktif diwajibkan (lihat template tahun baru)
        $this->assertCount(2, $errors);
        $this->assertContains('target kosong di workbook; diambil dari versi aktif: SAIDI.', $tab['warnings']);
    }

    #[Test]
    public function polaritas_tertulis_diterima(): void
    {
        $path = $this->edited($this->book(), ['ULP JOMBANG' => ['C11' => 'Positif', 'C13' => 'Negatif'], 'UP3 MOJOKERTO' => ['C11' => 'Positif', 'C13' => 'Negatif']]);
        $report = $this->check($path);

        $this->assertTrue($report['can_upload']);
        $this->assertStringContainsString('2 polaritas tertulis dibaca sebagai angka', implode(' ', array_column($report['tabs'], null, 'sheet')['ULP JOMBANG']['warnings']));
        $this->assertSame('DIGANTIKAN', $report['changes'][0]['status']);
        $this->assertSame([], $report['changes'][1]['changed']);                                                // Positif = 3, Negatif = 1: definisi sama
    }

    #[Test]
    public function template_diunggah_tanpa_diubah_menghasilkan_definisi_yang_sama(): void
    {
        $response = $this->as($this->planner)->get('/api/nko/definition-template?year=2026')->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        rename($response->baseResponse->getFile()->getPathname(), $path);
        $this->as($this->viewerOf())->get('/api/nko/definition-template?year=2026')->assertForbidden();

        $report = $this->check($path);
        $this->assertTrue($report['can_upload'], json_encode($report['errors']));
        $this->assertSame(['PETUNJUK', 'UP3 MOJOKERTO', 'ULP JOMBANG'], array_column($report['tabs'], 'sheet'));
        foreach ($report['changes'] as $level) {
            $this->assertSame([[], [], [], false, []], [$level['added'], $level['removed'], $level['changed'], $level['total_rule_changed'], $level['targets_changed']]);
        }

        $id = $this->upload($path)->assertCreated()->json('data.id');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk();
        $saidi = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('s.status', 'AKTIF')->where('s.unit_level', 'ULP')->where('d.code', 'saidi')->first(['d.id', 'd.source_sheet', 'd.scoring_rule', 'd.polarity']);
        $this->assertSame(['SAIDI', 'STANDARD', 1], [$saidi->source_sheet, $saidi->scoring_rule, (int) $saidi->polarity]);
        $this->assertSame(7.0, (float) DB::table('kpi_targets')->where('definition_id', $saidi->id)->where('period', '2026-02-01')->value('target_value'));
    }

    #[Test]
    public function template_tahun_baru_tanpa_target_dan_wajib_diisi(): void
    {
        $response = $this->as($this->planner)->get('/api/nko/definition-template?year=2027')->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        rename($response->baseResponse->getFile()->getPathname(), $path);

        $report = $this->check($path, 2027);
        $this->assertSame(2027, $report['year_found']);
        $this->assertStringContainsString('target bulanan (kolom M sampai X) kosong untuk item berbobot', implode(' ', $report['errors']));
        $this->as($this->planner)->get('/api/nko/definition-template?year=2020')->assertNotFound()->assertJsonPath('message', fn (string $m) => str_contains($m, 'tahun 2020') && str_contains($m, 'tersedia untuk tahun 2026'));
    }

    #[Test]
    public function penyetuju_diperingatkan_bila_unit_hilang_dari_workbook(): void
    {
        $ngoro = $this->makeUnit('ULP', $this->up3);
        $ngoro->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
        app(NkoDefinitionImportService::class)->import($this->book(['UP3 MOJOKERTO', 'ULP JOMBANG', 'ULP NGORO']), 'tiga.xlsx');

        $ulp = array_column($this->check($this->book(['UP3 MOJOKERTO', 'ULP JOMBANG'], saidiWeight: 8))['changes'], null, 'level')['ULP'];

        $this->assertStringContainsString('Unit ULP Ngoro punya target di versi 2026 v2 tetapi tidak ada di workbook', $ulp['alerts'][0]);
    }

    #[Test]
    public function ganti_nama_dengan_kode_tetap_bukan_item_baru_dan_targetnya_tetap(): void
    {
        $response = $this->as($this->planner)->get('/api/nko/definition-template?year=2026')->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        rename($response->baseResponse->getFile()->getPathname(), $path);
        $this->edited($path, ['UP3 MOJOKERTO' => ['B13' => 'a. Durasi Padam Rata-rata'], 'ULP JOMBANG' => ['B13' => 'a. Durasi Padam Rata-rata']]);

        $ulp = array_column($this->check($path)['changes'], null, 'level')['ULP'];
        $this->assertSame([[], [], []], [$ulp['added'], $ulp['removed'], $ulp['possible_renames']]);
        $this->assertSame(['saidi' => ['name']], array_map('array_keys', array_column($ulp['changed'], 'fields', 'code')));

        $id = $this->upload($path)->assertCreated()->json('data.id');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk();
        $saidi = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('s.status', 'AKTIF')->where('s.unit_level', 'ULP')->where('d.code', 'saidi')->first(['d.id', 'd.name']);
        $this->assertSame('Durasi Padam Rata-rata', $saidi->name);
        $this->assertSame(7.0, (float) DB::table('kpi_targets')->where('definition_id', $saidi->id)->where('period', '2026-02-01')->value('target_value'));
    }

    #[Test]
    public function kode_tidak_sah_ganda_atau_tidak_seragam_menghentikan_unggahan(): void
    {
        $ngoro = $this->makeUnit('ULP', $this->up3);
        $ngoro->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
        $tabs = ['UP3 MOJOKERTO', 'ULP JOMBANG', 'ULP NGORO'];

        $errors = fn (array $cells) => implode(' ', $this->check($this->edited($this->book($tabs), ['ULP JOMBANG' => ['J9' => 'KODE'] + $cells]))['errors']);

        $this->assertStringContainsString('baris 11: KODE "penjualan tl" tidak sah', $errors(['J11' => 'Penjualan TL']));
        $this->assertStringContainsString('KODE "saidi" dipakai di baris 11 dan 13', $errors(['J11' => 'saidi', 'J13' => 'saidi']));
        $this->assertStringContainsString('Tab ULP harus seragam: ULP NGORO tidak memiliki kolom KODE', $errors(['J13' => 'saidi']));
    }

    #[Test]
    public function kode_yang_tidak_dikenal_diperingatkan_sebagai_item_baru(): void
    {

        $report = $this->check($this->edited($this->book(), ['UP3 MOJOKERTO' => ['J9' => 'KODE', 'J13' => 'saidi-typo']]));
        $up3 = array_column($report['changes'], null, 'level')['UP3'];

        $this->assertTrue($report['can_upload']);
        $this->assertSame(['saidi-typo'], array_column($up3['added'], 'code'));
        $this->assertStringContainsString('KODE saidi-typo (SAIDI) tidak ada di versi 2026 v1; dianggap item baru', implode(' ', $up3['alerts']));
    }

    private function targetTemplate(string $level = 'ULP'): string
    {
        $response = $this->as($this->planner)->get("/api/nko/target-template?year=2026&level={$level}")->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        rename($response->baseResponse->getFile()->getPathname(), $path);

        return $path;
    }

    private function saidiTarget(int $month): ?float
    {
        $value = DB::table('kpi_targets as t')->join('kpi_definitions as d', 'd.id', '=', 't.definition_id')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')
            ->where('s.status', 'AKTIF')->where('s.unit_level', 'ULP')->where('d.code', 'saidi')->where('t.period', sprintf('2026-%02d-01', $month))->value('t.target_value');

        return $value === null ? null : (float) $value;
    }

    #[Test]
    public function target_diubah_lewat_template_target_dan_berlaku_setelah_disetujui(): void
    {
        $path = $this->targetTemplate();
        $this->assertSame(['Target di berkas sama dengan yang berlaku; tidak ada yang berubah.'], $this->upload($path, endpoint: '/api/nko/target-uploads/check')->assertOk()->json('data.errors'));

        // baris 7 = SAIDI, kolom F = Februari, G = Maret
        $this->edited($path, ['ULP JOMBANG' => ['F7' => 9, 'G7' => 11]]);
        $report = $this->upload($path, endpoint: '/api/nko/target-uploads/check')->assertOk()->json('data');
        $this->assertTrue($report['can_upload'], json_encode($report['errors']));
        $this->assertSame(['saidi', 2], [$report['changes'][0]['items'][0]['code'], $report['changes'][0]['cells']]);
        $this->assertSame(['from' => 7, 'to' => 9], $report['changes'][0]['items'][0]['months']['2']);

        $id = $this->upload($path, endpoint: '/api/nko/target-uploads')->assertCreated()->json('data.id');
        $this->assertSame(7.0, $this->saidiTarget(2));
        $this->as($this->planner)->getJson('/api/nko/definition-uploads')->assertOk()->assertJsonCount(0, 'data');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertNotFound();
        $this->upload($this->book(saidiWeight: 8))->assertStatus(409);

        $this->as($this->asman)->postJson("/api/nko/target-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk()->assertJsonPath('data.cells', 2);
        $this->assertSame([9.0, 11.0], [$this->saidiTarget(2), $this->saidiTarget(3)]);
        $this->assertSame(['UP3' => 1, 'ULP' => 1], array_reverse($this->activeSets()));
    }

    #[Test]
    public function workbook_target_yang_salah_menghentikan_unggahan(): void
    {
        $errors = fn (array $cells, int $year = 2026) => implode(' ', $this->upload($this->edited($this->targetTemplate(), ['ULP JOMBANG' => $cells]), year: $year, endpoint: '/api/nko/target-uploads/check')->assertOk()->json('data.errors'));

        $this->assertStringContainsString('KODE tidak ada di definisi aktif: saidi-x (baris 7)', $errors(['A7' => 'saidi-x']));
        $this->assertStringContainsString('sel bukan angka atau rentang ("95 - 105"): F7', $errors(['F7' => '9,5']));
        $this->assertStringContainsString('semua target item berbobot dikosongkan: SAIDI', $errors(['E7' => null, 'F7' => null]));
        $this->assertStringContainsString('tahun 2026 (sel A2), bukan 2027', $errors([], 2027));
        $this->assertStringContainsString('Sel A4 harus berisi "KODE"', implode(' ', $this->upload($this->book(), endpoint: '/api/nko/target-uploads/check')->assertOk()->json('data.errors')));
        $this->as($this->viewerOf())->get('/api/nko/target-template?year=2026&level=ULP')->assertForbidden();
        $this->as($this->planner)->get('/api/nko/target-template?year=2027&level=ULP')->assertNotFound();
    }

    #[Test]
    public function target_versi_aktif_disalin_bila_workbook_definisi_tidak_mengisinya(): void
    {
        $empty = ['M13' => null, 'N13' => null];
        $path = $this->edited($this->book(saidiWeight: 8), ['UP3 MOJOKERTO' => $empty, 'ULP JOMBANG' => $empty]);

        $report = $this->check($path);
        $this->assertStringContainsString('diambil dari versi aktif: SAIDI', implode(' ', $report['tabs'][1]['warnings']), json_encode($report['errors']));
        $this->assertSame([], $report['changes'][1]['targets_changed']);

        $id = $this->upload($path)->assertCreated()->json('data.id');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk();
        $this->assertSame(2, $this->activeSets()['ULP']);
        $this->assertSame(7.0, $this->saidiTarget(2));
    }

    private function definitionTemplate(): string
    {
        $response = $this->as($this->planner)->get('/api/nko/definition-template?year=2026&format=definisi')->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        rename($response->baseResponse->getFile()->getPathname(), $path);

        return $path;
    }

    /** definisi v2 dengan ULP Ngoro yang rumus nilai SAIDI-nya berbeda dari tab acuan */
    private function importWithUnitRule(): void
    {
        $ngoro = $this->makeUnit('ULP', $this->up3);
        $ngoro->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
        $path = $this->edited($this->book(['UP3 MOJOKERTO', 'ULP JOMBANG', 'ULP NGORO']), ['ULP NGORO' => ['AC13' => '=IF(AB13<=0,0,F13)']]);
        app(NkoDefinitionImportService::class)->import($path, 'dengan-aturan-unit.xlsx');
    }

    /** @return array{targets: int, unit_rules: int, references: int} milik versi aktif ULP */
    private function ulpData(): array
    {
        $count = fn (string $table) => DB::table("{$table} as x")->join('kpi_definitions as d', 'd.id', '=', 'x.definition_id')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')
            ->where('s.status', 'AKTIF')->where('s.unit_level', 'ULP')->count();

        return ['targets' => $count('kpi_targets'), 'unit_rules' => $count('kpi_unit_rules'), 'references' => $count('kpi_reference_values')];
    }

    #[Test]
    public function template_definisi_saja_mempertahankan_target_dan_aturan_khusus_unit(): void
    {
        $this->importWithUnitRule();
        $before = $this->ulpData();
        $this->assertSame(1, $before['unit_rules']);

        $path = $this->edited($this->definitionTemplate(), ['DEFINISI ULP' => ['F13' => 8, 'F12' => 86]]);
        $report = $this->check($path);
        $this->assertTrue($report['can_upload'], json_encode($report['errors']));
        $this->assertSame(['PETUNJUK', 'DEFINISI UP3', 'DEFINISI ULP'], array_column($report['tabs'], 'sheet'));
        $ulp = array_column($report['changes'], null, 'level')['ULP'];
        $this->assertSame(['saidi' => ['weight']], array_map('array_keys', array_column($ulp['changed'], 'fields', 'code')));
        $this->assertSame([[], [], []], [$ulp['added'], $ulp['targets_changed'], $ulp['alerts']]);

        $id = $this->upload($path)->assertCreated()->json('data.id');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk();
        $this->assertSame($before, $this->ulpData());
        $this->assertSame(7.0, $this->saidiTarget(2));
    }

    #[Test]
    public function aturan_khusus_unit_tidak_dibawa_bila_rumus_dasar_berubah_dan_baris_baru_menggeser_rujukan(): void
    {
        $this->importWithUnitRule();

        $changed = $this->edited($this->definitionTemplate(), ['DEFINISI ULP' => ['AC13' => '=AB13/100*F13']]);
        $alerts = implode(' ', array_column($this->check($changed)['changes'], null, 'level')['ULP']['alerts']);
        $this->assertStringContainsString('Rumus dasar "SAIDI" berubah, sehingga aturan khusus unit tidak dibawa untuk ULP Ngoro.', $alerts);

        // sisipkan baris di atas SAIDI lewat pustaka, yang menggeser rujukan seperti Excel
        $shifted = $this->definitionTemplate();
        $book = IOFactory::load($shifted);
        $book->getSheetByName('DEFINISI ULP')->insertNewRowBefore(13);
        $this->save($book, $shifted);
        $id = $this->upload($shifted)->assertCreated()->json('data.id');
        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertOk();
        $rule = json_decode(DB::table('kpi_unit_rules as r')->join('kpi_definitions as d', 'd.id', '=', 'r.definition_id')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')
            ->where('s.status', 'AKTIF')->value('r.rules'), true);
        $this->assertSame('=IF(AB14<=0,0,F14)', $rule['nilai']);
    }

    #[Test]
    public function tab_definisi_tidak_boleh_memuat_target_atau_digabung_dengan_tab_unit(): void
    {
        $filled = $this->edited($this->definitionTemplate(), ['DEFINISI ULP' => ['M13' => 5]]);
        $this->assertStringContainsString('tab DEFINISI tidak memuat target', implode(' ', $this->check($filled)['errors']));

        $mixed = $this->definitionTemplate();
        $book = IOFactory::load($mixed);
        $copy = clone $book->getSheetByName('DEFINISI ULP');
        $copy->setTitle('ULP JOMBANG');
        $book->addSheet($copy);
        $this->save($book, $mixed);
        $this->assertStringContainsString('Tab "DEFINISI ULP" tidak boleh digabung dengan tab unit ULP', implode(' ', $this->check($mixed)['errors']));
    }

    private function viewerOf(): User
    {
        return $this->actor('MANAGER_ULP', $this->ulp);
    }
}
