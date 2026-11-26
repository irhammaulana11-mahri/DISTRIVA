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
        app(NkoDefinitionImportService::class)->import($this->workbook(), 'nko.xlsx');
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

    private function upload(string $path, ?User $user = null)
    {
        return $this->as($user ?? $this->planner)->post('/api/nko/definition-uploads', ['file' => new UploadedFile($path, 'nko-rev.xlsx', null, null, true), 'note' => 'Revisi kontrak'], ['Accept' => 'application/json']);
    }

    private function activeSets(): array
    {
        return DB::table('kpi_definition_sets')->where('status', 'AKTIF')->orderBy('unit_level')->pluck('version', 'unit_level')->all();
    }

    #[Test]
    public function definisi_baru_aktif_hanya_setelah_disetujui_orang_lain(): void
    {
        $id = $this->upload($this->workbook(saidiWeight: 8, saidiName: 'SAIDI Distribusi'))->assertCreated()->json('data.id');
        $this->assertSame(['ULP' => 1, 'UP3' => 1], $this->activeSets());                                     // unggahan belum mengubah definisi

        $changes = array_column($this->as($this->planner)->getJson("/api/nko/definition-uploads/{$id}")->assertOk()->json('data.changes'), null, 'level');
        $this->assertSame(['saidi-distribusi'], array_column($changes['ULP']['added'], 'code'));
        $this->assertTrue($changes['ULP']['added'][0]['needs_realization']);
        $this->assertFalse($changes['ULP']['added'][0]['has_rule']);
        $this->assertSame(['saidi'], array_column($changes['ULP']['removed'], 'code'));
        $this->assertTrue($changes['ULP']['removed'][0]['has_rule']);
        $this->assertSame('saidi-distribusi', $changes['ULP']['possible_renames'][0]['to_code']);
        $this->assertSame([], $changes['ULP']['changed']);

        $this->upload($this->workbook(saidiWeight: 9))->assertStatus(409);                                    // satu yang menunggu per tahun
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
        $id = $this->upload($this->workbook(saidiWeight: 8))->assertCreated()->json('data.id');
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

        $id = $this->upload($this->workbook(saidiWeight: 8))->assertCreated()->json('data.id');
        $ulp = array_column($this->as($this->planner)->getJson("/api/nko/definition-uploads/{$id}")->json('data.changes'), null, 'level')['ULP'];

        $this->assertSame(['weight'], array_keys($ulp['changed'][0]['fields']));
        $this->assertFalse($ulp['total_rule_changed']);
    }

    #[Test]
    public function ditolak_wajib_beralasan_dan_berkasnya_dihapus(): void
    {
        $id = $this->upload($this->workbook(saidiWeight: 8))->assertCreated()->json('data.id');
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
        $id = $this->upload($this->workbook(saidiWeight: 8))->assertCreated()->json('data.id');
        app(NkoDefinitionImportService::class)->import($this->workbook(saidiWeight: 9), 'lain.xlsx');          // impor lewat server di antara unggah dan putusan

        $this->as($this->asman)->postJson("/api/nko/definition-uploads/{$id}/decision", ['decision' => 'approve'])->assertStatus(409);
        $this->assertSame(['ULP' => 2, 'UP3' => 2], $this->activeSets());
    }

    #[Test]
    public function berkas_yang_sama_berkas_rusak_dan_peran_ulp_ditolak(): void
    {
        $this->upload($this->workbook())->assertStatus(422);
        $broken = tempnam(sys_get_temp_dir(), 'nko').'.xlsx';
        file_put_contents($broken, 'bukan workbook');
        $this->upload($broken)->assertStatus(422);
        $this->upload($this->workbook(saidiWeight: 8), $this->actor('MANAGER_ULP', $this->ulp))->assertForbidden();
        $this->assertSame(0, DB::table('kpi_definition_uploads')->count());
    }
}
