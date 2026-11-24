<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoRealizationResolver;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\Concerns\BuildsNkoWorkbook;
use Tests\PostgresTestCase;

class NkoCalculationTest extends PostgresTestCase
{
    use BuildsNkoWorkbook;

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $ulpB;

    private User $planner;

    private User $viewer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(NkoPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpA->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $this->ulpB->forceFill(['code' => '51454', 'name' => 'ULP Ngoro'])->save();
        $this->planner = $this->makeUser();
        $this->assign($this->planner, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->up3);
        $this->viewer = $this->makeUser();
        $this->assign($this->viewer, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);

        app(NkoDefinitionImportService::class)->import($this->workbook(['UP3 MOJOKERTO', 'ULP JOMBANG', 'ULP NGORO']), 'nko.xlsx');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** @param array<string, float> $values */
    private function input(OrganizationalUnit $unit, array $values, int $month = 1): void
    {
        $this->as($this->planner)->putJson('/api/nko/inputs', ['unit_id' => $unit->id, 'year' => 2026, 'month' => $month,
            'items' => array_map(fn ($c, $v) => ['code' => $c, 'value' => $v, 'note' => 'Alasan uji'], array_keys($values), $values)])->assertOk();
    }

    #[Test]
    public function menghitung_pencapaian_nilai_total_dan_nko_dengan_aturan_workbook(): void
    {
        $this->input($this->ulpA, ['saidi' => 1.85, 'penjualan-tenaga-listrik' => 2.0]);

        $r = $this->as($this->planner)->postJson('/api/nko/calculate', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1])->assertOk()->json('data.0');

        $this->assertTrue($r['ok']);
        $this->assertSame(0, $r['missing_count']);
        // SAIDI polaritas 1: 2 - 1.85/3.7 = 1.5 dibatasi 1.1 => 110, nilai 6 x 1.1; penjualan: rasio 0.8 => 0.6 + 0.8 x 0.4 = 0.92 => nilai 14 x 0.92
        $this->assertEqualsWithDelta(6.6 + 12.88, $r['total_nilai'], 1e-9);
        $this->assertEqualsWithDelta((6.6 + 12.88) / (100 - 6) * 100, $r['nko'], 1e-9);

        $detail = $this->as($this->viewer)->getJson("/api/nko/snapshots/{$r['snapshot_id']}")->assertOk()->json('data');
        $byCode = array_column($detail['values'], null, 'code');
        $this->assertEqualsWithDelta(110.0, $byCode['saidi']['pencapaian'], 1e-9);
        $this->assertSame('MANUAL', $byCode['saidi']['source']);
        $this->assertEqualsWithDelta(3.7, $byCode['saidi']['target'], 1e-9);
        $this->assertEqualsWithDelta(92.0, $byCode['penjualan-tenaga-listrik']['pencapaian'], 1e-9);
        $this->assertEqualsWithDelta(12.88, $byCode['penjualan-tenaga-listrik']['nilai'], 1e-9);
    }

    #[Test]
    public function indikator_tanpa_realisasi_dilaporkan_kurang_dan_tidak_diberi_nilai(): void
    {
        $this->input($this->ulpA, ['penjualan-tenaga-listrik' => 2.5]);

        $r = $this->as($this->planner)->postJson('/api/nko/calculate', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1])->assertOk()->json('data.0');

        $this->assertSame(1, $r['missing_count']);
        $this->assertEqualsWithDelta(14.0, $r['total_nilai'], 1e-9);   // hanya penjualan; SAIDI kosong tidak dihitung penuh
        $detail = $this->as($this->planner)->getJson("/api/nko/snapshots/{$r['snapshot_id']}")->json('data');
        $this->assertSame('saidi', $detail['missing'][0]['code']);
        $this->assertFalse($detail['complete']);
    }

    #[Test]
    public function target_nol_pada_polaritas_kecil_dengan_realisasi_nol_bernilai_penuh(): void
    {
        $this->input($this->ulpA, ['saidi' => 0, 'penjualan-tenaga-listrik' => 2.5]);
        DB::table('kpi_targets')->whereIn('definition_id', DB::table('kpi_definitions')->where('code', 'saidi')->pluck('id'))->where('organizational_unit_id', $this->ulpA->id)->update(['target_value' => 0]);

        $r = $this->as($this->planner)->postJson('/api/nko/calculate', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1])->json('data.0');

        $detail = $this->as($this->planner)->getJson("/api/nko/snapshots/{$r['snapshot_id']}")->json('data');
        $this->assertEqualsWithDelta(100.0, array_column($detail['values'], null, 'code')['saidi']['pencapaian'], 1e-9);
    }

    #[Test]
    public function hitung_ulang_menggantikan_snapshot_berlaku_dan_peringkat_antar_ulp_satu_up3(): void
    {
        $this->input($this->ulpA, ['saidi' => 1.85, 'penjualan-tenaga-listrik' => 2.0]);
        $this->input($this->ulpB, ['saidi' => 3.0, 'penjualan-tenaga-listrik' => 2.5]);

        $res = $this->as($this->planner)->postJson('/api/nko/calculate', ['up3_id' => $this->up3->id, 'year' => 2026, 'month' => 1])->assertOk()->json('data');
        $this->assertCount(3, $res);   // UP3 + dua ULP

        $rank = $this->as($this->planner)->getJson("/api/nko/ranking?year=2026&month=1&up3_id={$this->up3->id}")->assertOk()->json('data');
        // Ngoro: penjualan 100% (14) + SAIDI melampaui target (6,6) = 20,6; Jombang: 12,88 + 6,6 = 19,48
        $this->assertSame(['ULP Ngoro', 'ULP Jombang'], array_column($rank['ulp'], 'unit_name'));
        $this->assertSame([1, 2], array_column($rank['ulp'], 'rank'));
        $this->assertSame('UP3 Mojokerto', $rank['up3']['unit_name']);
        // manajer ULP hanya melihat ULP-nya sendiri (dan UP3 induknya), bukan ULP lain
        $seen = $this->as($this->viewer)->getJson("/api/nko/ranking?year=2026&month=1&up3_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame(['ULP Jombang'], array_column($seen['ulp'], 'unit_name'));
        $this->assertSame(2, $seen['ulp'][0]['rank']);
        $own = $this->as($this->viewer)->getJson('/api/nko/snapshots?year=2026&month=1')->assertOk()->json('data');
        $this->assertSame(['UP3 Mojokerto', 'ULP Jombang'], array_column($own, 'unit_name'));

        $this->as($this->planner)->postJson('/api/nko/calculate', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1])->assertOk();
        $this->assertSame(1, DB::table('kpi_snapshots')->where('organizational_unit_id', $this->ulpA->id)->where('is_current', true)->count());
        $this->assertSame(2, DB::table('kpi_snapshots')->where('organizational_unit_id', $this->ulpA->id)->count());
    }

    #[Test]
    public function peran_viewer_boleh_membaca_tetapi_tidak_menghitung_atau_mengisi(): void
    {
        $this->as($this->viewer)->postJson('/api/nko/calculate', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1])->assertForbidden();
        $this->as($this->viewer)->putJson('/api/nko/inputs', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1, 'items' => [['code' => 'saidi', 'value' => 1]]])->assertForbidden();
        $this->as($this->viewer)->getJson("/api/nko/inputs?unit_id={$this->ulpA->id}&year=2026&month=1")->assertOk();
        $this->as($this->viewer)->getJson('/api/nko/definitions?year=2026&level=ULP')->assertOk()->assertJsonPath('data.set.level', 'ULP');
        $this->as($this->viewer)->getJson("/api/nko/inputs?unit_id={$this->ulpB->id}&year=2026&month=1")->assertNotFound();   // di luar cakupan ULP-nya
    }

    #[Test]
    public function masukan_hanya_untuk_indikator_yang_dapat_diisi_dan_nilai_kosong_menghapus(): void
    {
        $this->as($this->planner)->putJson('/api/nko/inputs', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1, 'items' => [['code' => 'tidak-ada', 'value' => 1]]])->assertStatus(422);

        $this->input($this->ulpA, ['saidi' => 2.0]);
        $this->assertSame(1, DB::table('kpi_manual_inputs')->count());
        $this->as($this->planner)->putJson('/api/nko/inputs', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1, 'items' => [['code' => 'saidi', 'value' => null]]])->assertOk();
        $this->assertSame(0, DB::table('kpi_manual_inputs')->count());

        $items = $this->as($this->planner)->getJson("/api/nko/inputs?unit_id={$this->ulpA->id}&year=2026&month=1")->json('data.items');
        $this->assertSame(['penjualan-tenaga-listrik', 'saidi'], array_column($items, 'code'));
        $this->assertTrue(array_column($items, null, 'code')['saidi']['system_source']);
    }

    #[Test]
    public function realisasi_dari_difi_hanya_dipakai_bila_semua_bulan_sampai_bulan_berjalan_tersedia(): void
    {
        $this->difi($this->ulpA, '2026-01-01', 2.0, 0.1, 3000);
        $resolver = app(NkoRealizationResolver::class);

        $jan = $resolver->resolve($this->ulpA->id, 2026, 1);
        $this->assertEqualsWithDelta(2.0, $jan['saidi']['value'], 1e-9);
        $this->assertSame('SISTEM', $jan['saidi']['source']);
        $this->assertEqualsWithDelta(3.0, $jan['ens']['value'], 1e-9);   // kWh menjadi MWh
        $this->assertSame([], $resolver->resolve($this->ulpA->id, 2026, 2));   // Februari belum ada: tidak dikira

        $this->difi($this->ulpA, '2026-02-01', 1.5, 0.2, 1000);
        $feb = $resolver->resolve($this->ulpA->id, 2026, 2);
        $this->assertEqualsWithDelta(3.5, $feb['saidi']['value'], 1e-9);   // kumulatif
        $this->assertEqualsWithDelta(0.3, $feb['saifi']['value'], 1e-9);
        $this->assertEqualsWithDelta(4.0, $feb['ens']['value'], 1e-9);

        $this->input($this->ulpA, ['saidi' => 9.0]);   // masukan manual menimpa sumber sistem (Januari)
        $over = $resolver->resolve($this->ulpA->id, 2026, 1);
        $this->assertSame('MANUAL', $over['saidi']['source']);
        $this->assertEqualsWithDelta(9.0, $over['saidi']['value'], 1e-9);
        $this->assertEqualsWithDelta(2.0, $over['saidi']['system'], 1e-9);
    }

    #[Test]
    public function penambahan_pelanggan_dan_daya_dari_laporan_309_adalah_selisih_terhadap_desember_tahun_lalu(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        $this->report309($this->ulpA, '2026-03-01', 1409 + 100000, 6.0419e6 + 295000000);
        $this->assertArrayNotHasKey('penambahan-pelanggan', $resolver->resolve($this->ulpA->id, 2026, 3));   // posisi Desember belum ada

        $this->report309($this->ulpA, '2025-12-01', 100000, 295000000);
        $r = $resolver->resolve($this->ulpA->id, 2026, 3);
        $this->assertEqualsWithDelta(1409.0, $r['penambahan-pelanggan']['value'], 1e-9);
        $this->assertEqualsWithDelta(6.0419, $r['daya-tersambung']['value'], 1e-6);   // VA menjadi MVA
        $this->assertSame('SISTEM', $r['daya-tersambung']['source']);
    }

    private function report309(OrganizationalUnit $unit, string $period, float $pelanggan, float $dayaVa): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => '309', 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "309-{$unit->code}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => '{}', 'line_count' => 2, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('eis_report_lines')->insert([
            ['file_id' => $id, 'line_no' => 1, 'label' => 'JUMLAH S', 'values' => json_encode(['pelanggan' => 1, 'daya_va' => 1])],
            ['file_id' => $id, 'line_no' => 2, 'label' => 'JUMLAH', 'values' => json_encode(['pelanggan' => $pelanggan, 'daya_va' => $dayaVa])],
        ]);
    }

    #[Test]
    public function koreksi_atas_nilai_otomatis_wajib_beralasan_dan_menyimpan_nilai_sistem_tanpa_mengubah_data_sumber(): void
    {
        $this->difi($this->ulpA, '2026-01-01', 2.0, 0.1, 3000);
        $body = fn (array $item) => ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1, 'items' => [$item]];

        $this->as($this->planner)->putJson('/api/nko/inputs', $body(['code' => 'saidi', 'value' => 9.0]))->assertStatus(422);   // tanpa alasan
        $this->as($this->planner)->putJson('/api/nko/inputs', $body(['code' => 'saidi', 'value' => 9.0, 'note' => 'Koreksi gangguan GI']))->assertOk();

        $row = DB::table('kpi_manual_inputs')->first();
        $this->assertSame('Koreksi gangguan GI', $row->note);
        $this->assertEqualsWithDelta(2.0, $row->system_value, 1e-9);   // nilai sistem asli terekam
        $this->assertEqualsWithDelta(2.0, (float) json_decode(DB::table('eis_report_files')->where('family', 'DIFI')->value('summary'), true)['saidi_menit'], 1e-9);   // data sumber utuh

        $items = array_column($this->as($this->planner)->getJson("/api/nko/inputs?unit_id={$this->ulpA->id}&year=2026&month=1")->json('data.items'), null, 'code');
        $this->assertSame('MANUAL', $items['saidi']['source']);
        $this->assertEqualsWithDelta(2.0, $items['saidi']['system'], 1e-9);
        $this->assertTrue($items['saidi']['system_validated']);
    }

    #[Test]
    public function gangguan_penyulang_dari_data_gangguan_dimuat_otomatis_dan_ditandai_belum_tervalidasi(): void
    {
        $event = fn (string $at, string $type) => DB::table('outage_events')->insert(['id' => (string) Str::uuid(), 'source_key' => (string) Str::uuid(), 'row_hash' => 'h', 'sheet_gid' => 1, 'gi_name' => 'GI', 'device_group' => 'PMT', 'feeder_name' => 'PENYULANG', 'occurred_at' => $at, 'organizational_unit_id' => $this->ulpA->id, 'outage_type' => $type, 'created_at' => now(), 'updated_at' => now()]);
        $event('2026-01-10 03:00:00+00', 'PERMANEN');
        $event('2026-02-05 03:00:00+00', 'TEMPORER');
        $event('2025-12-30 03:00:00+00', 'PERMANEN');   // tahun lalu: tidak dihitung

        $resolver = app(NkoRealizationResolver::class);
        $this->assertEqualsWithDelta(1.0, $resolver->resolve($this->ulpA->id, 2026, 1)['gangguan-tm']['value'], 1e-9);
        $this->assertEqualsWithDelta(2.0, $resolver->resolve($this->ulpA->id, 2026, 2)['gangguan-tm']['value'], 1e-9);
        $this->assertContains('gangguan-tm', NkoRealizationResolver::UNVALIDATED_CODES);
    }

    private function difi(OrganizationalUnit $unit, string $period, float $saidi, float $saifi, float $kwh): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => 'DIFI', 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "DIFI-{$unit->code}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => json_encode(['saidi_menit' => $saidi, 'saifi_kali' => $saifi]), 'line_count' => 1, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => 1, 'label' => 'TOTAL KELOMPOK Distribusi', 'values' => json_encode(['kwh_tak_tersalurkan' => $kwh])]);
    }
}
