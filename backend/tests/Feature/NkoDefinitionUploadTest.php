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
        app(NkoDefinitionImportService::class)->import($this->book(), 'nko.xlsx');
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
        $this->upload($this->book())->assertStatus(422);
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
        $errors = array_column($this->check($path)['tabs'], null, 'sheet')['ULP JOMBANG']['errors'];

        $this->assertSame('jumlah bobot kelompok 28, harus 100.', $errors[0]);
        $this->assertStringContainsString('1 sel target berisi rumus tanpa nilai tersimpan', $errors[1]);
        $this->assertSame('target bulanan (kolom M sampai X) kosong untuk item berbobot: SAIDI.', $errors[2]);
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
        $this->as($this->planner)->get('/api/nko/definition-template?year=2020')->assertNotFound();
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

    private function viewerOf(): User
    {
        return $this->actor('MANAGER_ULP', $this->ulp);
    }
}
