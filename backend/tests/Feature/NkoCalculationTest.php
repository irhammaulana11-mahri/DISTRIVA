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

    private function difiWeighted(OrganizationalUnit $unit, string $period, float $jamXPlg, float $padam, float $pelanggan, float $kwh): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => 'DIFI', 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "DIFI-{$unit->code}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => json_encode(['pelanggan' => $pelanggan]), 'line_count' => 1, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => 1, 'label' => 'TOTAL KELOMPOK Distribusi', 'values' => json_encode(['jam_x_plg' => $jamXPlg, 'jml_plg_padam' => $padam, 'kwh_tak_tersalurkan' => $kwh])]);
    }

    #[Test]
    public function realisasi_up3_dari_ulp_di_bawahnya_menjumlah_atau_menimbang_pelanggan_dan_kosong_bila_satu_ulp_belum_lengkap(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        // SAIDI dan SAIFI UP3 per bulan = rata-rata tertimbang pelanggan, lalu dijumlahkan; ENS dijumlahkan
        $this->difiWeighted($this->ulpA, '2026-01-01', 10, 100, 1000, 2000);                                   // ULP A: SAIDI 0,6, SAIFI 0,1
        $this->difiWeighted($this->ulpB, '2026-01-01', 60, 600, 3000, 4000);                                   // ULP B: SAIDI 1,2, SAIFI 0,2
        $jan = $resolver->systemValues($this->up3->id, 2026, 1);
        $this->assertEqualsWithDelta((10 * 60 + 60 * 60) / 4000, $jan['saidi'], 1e-9);                          // 1,05 menit, bukan rata-rata sederhana 0,9
        $this->assertEqualsWithDelta(700 / 4000, $jan['saifi'], 1e-9);
        $this->assertEqualsWithDelta(6.0, $jan['ens'], 1e-9);
        $this->difiWeighted($this->ulpA, '2026-02-01', 20, 100, 1000, 1000);
        $this->assertArrayNotHasKey('saidi', $resolver->systemValues($this->up3->id, 2026, 2));                  // ULP B belum punya Februari: tidak dijumlah sebagian
        $this->difiWeighted($this->ulpB, '2026-02-01', 30, 300, 3000, 1000);
        $this->assertEqualsWithDelta(1.05 + (20 * 60 + 30 * 60) / 4000, $resolver->systemValues($this->up3->id, 2026, 2)['saidi'], 1e-9);

        // penambahan pelanggan dan daya: jumlah ULP (selisih terhadap Desember tahun lalu)
        $this->report309($this->ulpA, '2025-12-01', 100, 1_000_000);
        $this->report309($this->ulpA, '2026-01-01', 110, 3_000_000);
        $this->assertArrayNotHasKey('penambahan-pelanggan', $resolver->systemValues($this->up3->id, 2026, 1));    // ULP B belum punya 309
        $this->report309($this->ulpB, '2025-12-01', 200, 5_000_000);
        $this->report309($this->ulpB, '2026-01-01', 230, 6_000_000);
        $up3 = $resolver->systemValues($this->up3->id, 2026, 1);
        $this->assertEquals([40.0, 3.0], [$up3['penambahan-pelanggan'], $up3['daya-tersambung']]);               // 10 + 30 pelanggan; 2 + 1 MVA

        // hasil UP3 dibawa ke perhitungan NKO tingkat UP3 sebagai nilai sistem
        $this->assertSame('SISTEM', $resolver->resolve($this->up3->id, 2026, 1)['penambahan-pelanggan']['source']);
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

    #[Test]
    public function ringkasan_kekurangan_melaporkan_indikator_kosong_sesuai_cakupan_peran_dan_tidak_menandai_penjualan_yang_cocok_baseline(): void
    {
        $this->baseline($this->ulpA, 2026, 1, 40000000);
        foreach (['2026-01-01' => 48000000] as $period => $kwh) {
            $this->report309($this->ulpA, $period, 1, 1);
            DB::table('eis_report_lines')->join('eis_report_files', 'eis_report_files.id', '=', 'eis_report_lines.file_id')
                ->where('eis_report_files.period', $period)->where('eis_report_lines.label', 'JUMLAH')->update(['values' => json_encode(['pelanggan' => 1, 'daya_va' => 1, 'kwh_jumlah' => $kwh])]);
        }

        $all = $this->as($this->planner)->getJson('/api/nko/gaps?year=2026&month=1&up3_id='.$this->up3->id)->assertOk()->json('data');
        $this->assertCount(3, $all['units']);
        $jombang = collect($all['units'])->firstWhere('unit_id', $this->ulpA->id);
        $status = collect($jombang['items'])->pluck('status', 'code');
        $this->assertArrayNotHasKey('penjualan-tenaga-listrik', $status->all());   // 309 + baseline lengkap dan rumus sudah cocok workbook: bukan kekurangan
        $this->assertSame('KOSONG', $status['saidi']);
        $this->assertSame(0, $jombang['unvalidated_count']);
        $this->assertSame($jombang['empty_count'] + $jombang['unvalidated_count'], count($jombang['items']));
        $this->assertGreaterThan($jombang['empty_count'], collect($all['units'])->firstWhere('unit_id', $this->ulpB->id)['empty_count']);

        $own = $this->as($this->viewer)->getJson('/api/nko/gaps?year=2026&month=1')->assertOk()->json('data.units');
        $this->assertEqualsCanonicalizing([$this->ulpA->id, $this->up3->id], array_column($own, 'unit_id'));   // ULP sendiri dan UP3 induknya, tanpa ULP lain
        $this->as($this->viewer)->getJson('/api/nko/gaps?year=2026&month=1&up3_id='.$this->ulpB->id)->assertNotFound();
    }

    #[Test]
    public function menyimpan_ulang_masukan_yang_tidak_berubah_tidak_menimpa_pengisi_dan_waktu(): void
    {
        $this->input($this->ulpA, ['penjualan-tenaga-listrik' => 2.5]);
        $before = DB::table('kpi_manual_inputs')->where('definition_code', 'penjualan-tenaga-listrik')->first();
        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->up3);
        $this->travel(1)->hour();

        $r = $this->as($other)->putJson('/api/nko/inputs', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1,
            'items' => [['code' => 'penjualan-tenaga-listrik', 'value' => 2.5, 'note' => 'Alasan uji'], ['code' => 'saidi', 'value' => null]]])->assertOk();

        $this->assertSame(0, $r->json('changed'));
        $after = DB::table('kpi_manual_inputs')->where('definition_code', 'penjualan-tenaga-listrik')->first();
        $this->assertSame($before->entered_by, $after->entered_by);
        $this->assertSame($before->updated_at, $after->updated_at);
        $this->as($other)->putJson('/api/nko/inputs', ['unit_id' => $this->ulpA->id, 'year' => 2026, 'month' => 1,
            'items' => [['code' => 'penjualan-tenaga-listrik', 'value' => 3, 'note' => 'Alasan uji']]])->assertOk()->assertJsonPath('changed', 1);
        $this->assertSame($other->id, DB::table('kpi_manual_inputs')->where('definition_code', 'penjualan-tenaga-listrik')->value('entered_by'));
    }

    #[Test]
    public function gangguan_nko_dari_apkt_response_time_tanpa_clear_temper_tertimbang_wo_dan_rating_negatif_tanpa_marking(): void
    {
        $rpt = fn (string $period, bool $withClearTemper, float $total, int $n) => ['id' => (string) Str::uuid(), 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'clear_temper' => $withClearTemper, 'rpt_total' => $total, 'rpt_count' => $n,
            'rct_total' => 0, 'rct_count' => $n, 'created_at' => now(), 'updated_at' => now()];
        $neg = fn (string $period, string $jenis, int $marking, int $nonMarking) => ['id' => (string) Str::uuid(), 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'jenis' => $jenis, 'wo_total' => 100,
            'total_anomali_marking' => $marking, 'total_anomali_non_marking' => $nonMarking, 'created_at' => now(), 'updated_at' => now()];
        // Januari: tanpa clear temper 200 menit dari 10 WO; Februari: 600 menit dari 20 WO; varian dengan clear temper tidak dipakai
        DB::table('apkt_rpt_rct_records')->insert([$rpt('2026-01-01', false, 200, 10), $rpt('2026-02-01', false, 600, 20), $rpt('2026-01-01', true, 9999, 99), $rpt('2026-02-01', true, 9999, 99)]);
        DB::table('apkt_anomali_gangguan_records')->insert([$neg('2026-01-01', 'NEGATIF', 4, 2), $neg('2026-02-01', 'NEGATIF', 1, 3), $neg('2026-01-01', 'BERULANG', 9, 9)]);
        $resolver = app(NkoRealizationResolver::class);

        $r = $resolver->resolve($this->ulpA->id, 2026, 2);

        $this->assertEqualsWithDelta(800 / 30, $r['response-time-atas-gangguan-diluar-clear-tamper']['value'], 1e-9);        // jumlah total durasi / jumlah WO, Januari sampai Februari
        $this->assertEqualsWithDelta(5.0, $r['feedback-rating-negatif-pada-pln-mobile-gangguan']['value'], 1e-9);             // non marking rating negatif: 2 + 3
        $this->assertEqualsWithDelta(20.0, $resolver->resolve($this->ulpA->id, 2026, 1)['response-time-atas-gangguan-diluar-clear-tamper']['value'], 1e-9);
        $march = $resolver->resolve($this->ulpA->id, 2026, 3);
        $this->assertArrayNotHasKey('response-time-atas-gangguan-diluar-clear-tamper', $march);                              // Maret belum ada: semua bulan harus ada
        $this->assertArrayNotHasKey('feedback-rating-negatif-pada-pln-mobile-gangguan', $march);
    }

    #[Test]
    public function susut_dihitung_dari_kwh_beli_emin_pssd_manual_dan_kwh_jual_total_309(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        $aux = fn (string $code, float $v) => DB::table('kpi_manual_inputs')->insert(['id' => (string) Str::uuid(), 'definition_code' => $code, 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-01-01', 'value' => $v, 'created_at' => now(), 'updated_at' => now()]);
        $aux('kwh-beli', 1000000);
        $aux('e-min', 50000);
        $aux('pssd', 30000);
        $this->assertArrayNotHasKey('susut-distribusi-tanpa-e-min', $resolver->resolve($this->ulpA->id, 2026, 1));   // laporan 309 belum ada

        $this->report309($this->ulpA, '2026-01-01', 1, 1);   // kWh jual JUMLAH diisi pada baris di bawah
        DB::table('eis_report_lines')->where('label', 'JUMLAH')->update(['values' => json_encode(['pelanggan' => 1, 'daya_va' => 1, 'kwh_jumlah' => 870000])]);

        $r = $resolver->resolve($this->ulpA->id, 2026, 1)['susut-distribusi-tanpa-e-min'];
        $this->assertEqualsWithDelta((920000 - 870000) / 920000 * 100, $r['value'], 1e-9);   // (beli - emin - pssd - jual) / (beli - emin - pssd)
        $this->assertSame('SISTEM', $r['source']);
        $this->assertContains('susut-distribusi-tanpa-e-min', NkoRealizationResolver::UNVALIDATED_CODES);
    }

    /** Baseline adjustment (BA) Penjualan TL satu ULP satu bulan (kWh). */
    private function baseline(OrganizationalUnit $unit, int $year, int $month, float $kwh): void
    {
        DB::table('kpi_baselines')->insert(['definition_code' => 'penjualan-tenaga-listrik', 'organizational_unit_id' => $unit->id, 'year' => $year, 'month' => $month, 'value' => $kwh, 'created_at' => now(), 'updated_at' => now()]);
    }

    #[Test]
    public function penambahan_penjualan_adalah_jumlah_kwh_jual_dikurangi_baseline_adjustment_bulanan_seperti_workbook(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        $jual = function (OrganizationalUnit $unit, string $period, float $kwh) {
            $this->report309($unit, $period, 1, 1);
            DB::table('eis_report_lines')->join('eis_report_files', 'eis_report_files.id', '=', 'eis_report_lines.file_id')->where('eis_report_files.organizational_unit_id', $unit->id)
                ->where('eis_report_files.period', $period)->where('eis_report_lines.label', 'JUMLAH')->update(['values' => json_encode(['pelanggan' => 1, 'daya_va' => 1, 'kwh_jumlah' => $kwh])]);
        };
        $jual($this->ulpA, '2026-01-01', 48000000);
        $this->assertArrayNotHasKey('penjualan-tenaga-listrik', $resolver->resolve($this->ulpA->id, 2026, 1));   // baseline Januari belum ada

        $this->baseline($this->ulpA, 2026, 1, 50000000);
        $jan = $resolver->resolve($this->ulpA->id, 2026, 1)['penjualan-tenaga-listrik'];
        $this->assertEqualsWithDelta(-2.0, $jan['value'], 1e-9);   // GWh: kWh jual di bawah baseline
        $this->assertSame('SISTEM', $jan['source']);
        $this->assertSame('NEGATIF', $jan['flag']);   // hanya ditandai, nilai tidak diubah

        $jual($this->ulpA, '2026-02-01', 44000000);
        $this->assertArrayNotHasKey('penjualan-tenaga-listrik', $resolver->resolve($this->ulpA->id, 2026, 2));   // baseline Februari belum ada: kosong, bukan jumlah sebagian
        $this->baseline($this->ulpA, 2026, 2, 41000000);
        $this->assertEqualsWithDelta(1.0, $resolver->resolve($this->ulpA->id, 2026, 2)['penjualan-tenaga-listrik']['value'], 1e-9);   // (48-50) + (44-41), kumulatif
        $this->assertNull($resolver->resolve($this->ulpA->id, 2026, 2)['penjualan-tenaga-listrik']['flag']);
        $this->assertNotContains('penjualan-tenaga-listrik', NkoRealizationResolver::UNVALIDATED_CODES);   // rumus cocok workbook (10 ULP Januari sampai September 2026)

        foreach ([1 => [47000000, 46000000], 2 => [45000000, 43000000]] as $month => [$kwh, $ba]) {
            $period = sprintf('2026-%02d-01', $month);
            $jual($this->ulpB, $period, $kwh);
            $this->baseline($this->ulpB, 2026, $month, $ba);
        }
        $this->assertEqualsWithDelta(1.0 + 3.0, $resolver->resolve($this->up3->id, 2026, 2)['penjualan-tenaga-listrik']['value'], 1e-9);   // UP3 = jumlah ULP: 1,0 + (1+2) = 4,0
    }

    #[Test]
    public function pelunasan_prabayar_dari_selisih_piutang_bulan_lalu_dan_bulan_ini_ditambah_prr_manual(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        $piutang = function (string $period, float $baru, float $berjalan, float $tunggakan) {
            $id = (string) Str::uuid();
            DB::table('eis_report_files')->insert(['id' => $id, 'family' => 'PIUTANGLPB_EIS', 'unit_code' => $this->ulpA->code, 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'original_name' => 'P.xls',
                'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => '{}', 'line_count' => 4, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (['BARU' => $baru, 'BERJALAN' => $berjalan, 'TUNGGAKAN' => $tunggakan] as $i => $v) {
                DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => count(DB::table('eis_report_lines')->where('file_id', $id)->get()) + 1, 'label' => $i, 'values' => json_encode(['rptag' => $v])]);
            }
            DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => 9, 'label' => 'NO REGISTER Total', 'values' => json_encode(['rptag' => 999999999])]);   // baris total tidak ikut
        };
        $piutang('2025-12-01', 10e6, 20e6, 30e6);   // 60 juta
        $this->assertArrayNotHasKey('pencapaian-pelunasan-prr-ex-prr-dan-piutang-prabayar', $resolver->resolve($this->ulpA->id, 2026, 1));   // Januari belum ada

        $piutang('2026-01-01', 5e6, 15e6, 25e6);    // berjalan+tunggakan 40 juta: lunas 60-40 = 20
        $this->assertEqualsWithDelta(20.0, $resolver->resolve($this->ulpA->id, 2026, 1)[NkoRealizationResolver::PELUNASAN_CODE]['value'], 1e-9);

        $piutang('2026-02-01', 0, 20e6, 30e6);      // lalu 45 juta, kini 50 juta: negatif dihitung 0
        $this->assertEqualsWithDelta(20.0, $resolver->resolve($this->ulpA->id, 2026, 2)[NkoRealizationResolver::PELUNASAN_CODE]['value'], 1e-9);

        DB::table('kpi_manual_inputs')->insert(['id' => (string) Str::uuid(), 'definition_code' => 'prr-lunas', 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-02-01', 'value' => 7.5, 'created_at' => now(), 'updated_at' => now()]);
        $this->assertEqualsWithDelta(27.5, $resolver->resolve($this->ulpA->id, 2026, 2)[NkoRealizationResolver::PELUNASAN_CODE]['value'], 1e-9);
    }

    #[Test]
    public function pelunasan_menambah_prr_dan_ex_prr_dari_ap2t_selama_semua_bulan_ada_dan_masukan_manual_diutamakan(): void
    {
        $resolver = app(NkoRealizationResolver::class);
        $piutang = function (string $period, float $berjalan) {
            $id = (string) Str::uuid();
            DB::table('eis_report_files')->insert(['id' => $id, 'family' => 'PIUTANGLPB_EIS', 'unit_code' => $this->ulpA->code, 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'original_name' => 'P.xls',
                'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => '{}', 'line_count' => 1, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => 1, 'label' => 'BERJALAN', 'values' => json_encode(['rptag' => $berjalan])]);
        };
        $ragu = function (string $family, string $period, array $rp) {
            $id = (string) Str::uuid();
            DB::table('eis_report_files')->insert(['id' => $id, 'family' => $family, 'unit_code' => $this->ulpA->code, 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'original_name' => "{$family}.xls",
                'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => '{}', 'line_count' => count($rp), 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            foreach ($rp as $i => $v) {
                DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => $i + 1, 'label' => '20260'.($i + 1), 'values' => json_encode(['rp_prr' => $v])]);
            }
        };
        $piutang('2025-12-01', 60e6);
        $piutang('2026-01-01', 40e6);                                                                            // prabayar bulan Januari: lunas 20 juta
        $piutang('2026-02-01', 40e6);                                                                            // Februari: 0
        $code = NkoRealizationResolver::PELUNASAN_CODE;
        $ragu('PRR', '2026-01-01', [2_000_000, 1_000_000]);                                                      // PRR Januari 3 juta
        $this->assertEqualsWithDelta(23.0, $resolver->systemValues($this->ulpA->id, 2026, 1)[$code], 1e-9);
        $ragu('EXPRR', '2026-01-01', [4_000_000]);
        $this->assertEqualsWithDelta(27.0, $resolver->systemValues($this->ulpA->id, 2026, 1)[$code], 1e-9);      // + Ex-PRR 4 juta

        $this->assertEqualsWithDelta(20.0, $resolver->systemValues($this->ulpA->id, 2026, 2)[$code], 1e-9);       // Februari belum punya laporan PRR dan Ex-PRR: komponen itu tidak dihitung (bukan sebagian), hanya prabayar
        $ragu('PRR', '2026-02-01', []);                                                                           // laporan tanpa baris = nol, bulan lengkap
        $ragu('EXPRR', '2026-02-01', [1_000_000]);
        $this->assertEqualsWithDelta(20.0 + 3.0 + 5.0, $resolver->systemValues($this->ulpA->id, 2026, 2)[$code], 1e-9);

        DB::table('kpi_manual_inputs')->insert(['id' => (string) Str::uuid(), 'definition_code' => 'prr-lunas', 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-02-01', 'value' => 10.0, 'created_at' => now(), 'updated_at' => now()]);
        $this->assertEqualsWithDelta(20.0 + 10.0 + 5.0, $resolver->systemValues($this->ulpA->id, 2026, 2)[$code], 1e-9);   // manual PRR menggantikan PRR AP2T, Ex-PRR tetap dari AP2T
    }

    private function difi(OrganizationalUnit $unit, string $period, float $saidi, float $saifi, float $kwh): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => 'DIFI', 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "DIFI-{$unit->code}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => json_encode(['saidi_menit' => $saidi, 'saifi_kali' => $saifi]), 'line_count' => 1, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => 1, 'label' => 'TOTAL KELOMPOK Distribusi', 'values' => json_encode(['kwh_tak_tersalurkan' => $kwh])]);
    }
}
