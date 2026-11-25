<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoRealizationResolver;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\Concerns\BuildsNkoWorkbook;
use Tests\PostgresTestCase;

class BusinessAnalyticsTest extends PostgresTestCase
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
        $this->ulpA = $this->makeUnit('ULP', $this->up3);
        $this->ulpA->forceFill(['name' => 'ULP A'])->save();
        $this->ulpB = $this->makeUnit('ULP', $this->up3);
        $this->ulpB->forceFill(['name' => 'ULP B'])->save();
        $this->planner = $this->makeUser();
        $this->assign($this->planner, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->up3);
        $this->viewer = $this->makeUser();
        $this->assign($this->viewer, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** @param list<array{0: string, 1: array<string, mixed>}> $lines */
    private function report(OrganizationalUnit $unit, string $family, string $period, array $lines, array $summary = []): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_report_files')->insert(['id' => $id, 'family' => $family, 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $period, 'original_name' => "{$family}.xls",
            'sha256' => hash('sha256', $id), 'size_bytes' => 1, 'status' => 'AKTIF', 'summary' => json_encode($summary), 'line_count' => count($lines), 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ($lines as $i => [$label, $values]) {
            DB::table('eis_report_lines')->insert(['file_id' => $id, 'line_no' => $i + 1, 'label' => $label, 'values' => json_encode($values)]);
        }
    }

    private function sales(OrganizationalUnit $unit, string $period, float $kwhR, float $kwhB): void
    {
        $this->report($unit, '309', $period, [['JUMLAH R', ['kwh_jumlah' => $kwhR]], ['JUMLAH B', ['kwh_jumlah' => $kwhB]], ['JUMLAH', ['kwh_jumlah' => $kwhR + $kwhB, 'pelanggan' => 10, 'daya_va' => 1000, 'rp_jumlah' => 0]]]);
    }

    #[Test]
    public function up3_menggabungkan_ulp_dengan_pembanding_tahun_lalu_kumulatif_rincian_dan_kelengkapan(): void
    {
        foreach (['2025-01-01' => [60, 40], '2025-02-01' => [70, 30], '2026-01-01' => [80, 40], '2026-02-01' => [90, 30]] as $period => [$r, $b]) {
            $this->sales($this->ulpA, $period, $r, $b);
        }
        foreach (['2025-01-01', '2025-02-01', '2026-01-01'] as $period) {   // ULP B belum mengunggah Februari 2026
            $this->sales($this->ulpB, $period, 50, 0);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}&from=2026-01&to=2026-02")->assertOk()->json('data');

        $this->assertSame(['2026-01', '2026-02'], $d['months']);
        $this->assertEquals([170, 120], $d['series'][0]['values']);
        $this->assertEquals([150, 150], $d['series'][0]['previous_year']);
        $s = $d['summary'][0];
        $this->assertEquals(120, $s['latest']);
        $this->assertEqualsWithDelta(20.0, $s['yoy_pct'], 1e-9);   // setara: hanya ULP A (ULP B belum melapor Februari 2026): 120 lawan 100, bukan 120 lawan 150
        $this->assertSame([2, 1], $d['units_reporting']);
        $this->assertSame(2, $d['units_expected']);
        $this->assertEquals(290, $s['ytd']);   // kumulatif memakai bulan yang ada; ULP B Februari kosong dilaporkan pada kelengkapan
        $this->assertEquals(300, $s['ytd_previous_year']);
        $this->assertEqualsWithDelta(20.0, $s['ytd_pct'], 1e-9);   // setara: ULP A 240 lawan 200
        $this->assertSame('Rumah tangga', $d['breakdown']['rows'][0]['key']);
        $this->assertEqualsWithDelta(75.0, $d['breakdown']['rows'][0]['share_pct'], 1e-9);
        $this->assertSame(['ULP A', 'ULP B'], array_column($d['comparison'], 'unit_name'));
        $this->assertSame([['unit_id' => $this->ulpB->id, 'unit_name' => 'ULP B', 'months' => ['2026-02']]], $d['coverage']['missing']);
        $this->assertSame('perhatian', $d['insights'][0]['level']);
        $this->assertStringContainsString('hanya mencakup 1 dari 2 ULP', $d['insights'][0]['text']);
    }

    /** @param list<array{string, int}> $counts [periode, pelanggan] Laporan 309 baris JUMLAH */
    private function customers309(OrganizationalUnit $unit, array $counts): void
    {
        foreach ($counts as [$period, $n]) {
            $this->report($unit, '309', $period, [['JUMLAH', ['kwh_jumlah' => 0, 'pelanggan' => $n, 'daya_va' => 1000, 'rp_jumlah' => 0]]]);
        }
    }

    private ?array $applicationTemplate = null;

    /** Satu permohonan tersambung (status PEREMAJAAN dilihat pada $when), seperti pada tes pertumbuhan pelanggan. */
    private function connected(OrganizationalUnit $ulp, string $type, float $delta, string $when, string $tariff = 'R1T'): void
    {
        if ($this->applicationTemplate === null) {
            $retail = $this->makeUser();
            $this->assign($retail, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $ulp);
            $id = $this->as($retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $ulp->getKey(),
                'customer' => ['name' => 'Siti', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
            $this->applicationTemplate = (array) DB::table('applications')->where('id', $id)->first();
        }
        $id = (string) Str::uuid();
        DB::table('applications')->insert(array_merge($this->applicationTemplate, ['id' => $id, 'application_number' => 'T-'.Str::random(10), 'application_type' => $type, 'transaction_type' => $type === 'PB' ? 'PASANG BARU' : 'PERUBAHAN DAYA',
            'organizational_unit_id' => $ulp->getKey(), 'delta_power_kva' => $delta, 'new_tariff_code' => $tariff, 'current_status' => 'CONNECTION_DONE', 'source_created_at' => $when.' 08:00:00', 'last_external_status_at' => $when.' 09:00:00', 'created_at' => $when.' 08:00:00', 'updated_at' => $when.' 09:00:00']));
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $id, 'external_system' => 'EIS', 'external_status_code' => 'PEREMAJAAN', 'observed_at' => $when.' 09:00:00', 'received_at' => $when.' 09:00:00']);
    }

    #[Test]
    public function metrik_pelanggan_membawa_pendamping_permohonan_dan_rekonsiliasi_kumulatif_pada_ulp_yang_sama(): void
    {
        $this->customers309($this->ulpA, [['2024-12-01', 900], ['2025-03-01', 930], ['2025-12-01', 1000], ['2026-01-01', 1010], ['2026-02-01', 1025], ['2026-03-01', 1040]]);
        $this->connected($this->ulpA, 'PB', 2.2, '2025-02-10');                                                // pembanding tahun lalu
        $this->customers309($this->ulpB, [['2026-01-01', 505], ['2026-02-01', 508], ['2026-03-01', 520]]);   // ULP B tanpa Laporan 309 Desember 2025: tidak ikut rekonsiliasi
        foreach ([['2026-01-05', 3], ['2026-02-05', 4], ['2026-03-05', 5]] as [$when, $n]) {
            for ($i = 0; $i < $n; $i++) {
                $this->connected($this->ulpA, 'PB', 2.2, $when);
            }
        }
        $this->connected($this->ulpB, 'PB', 2.2, '2026-02-10');

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data');

        $pb = collect($d['companions']['series'])->firstWhere('key', 'pb');
        $this->assertEquals([3, 5, 5], $pb['values']);                                  // ULP A dan ULP B digabung untuk UP3
        $this->assertEquals(13, $pb['ytd']);
        $this->assertSame(['kind' => 'CUSTOMERS_ADDED'], $d['forecast']);
        $y = $d['reconciliation']['ytd'];
        $this->assertSame(['2025-12', '2026-03', 1, 2], [$y['base_month'], $y['to_month'], $y['units_compared'], $y['units_expected']]);
        $this->assertEquals(40, $y['official_net']);                                     // 1040 - 1000, hanya ULP A
        $this->assertEquals(12, $y['companion']);                                        // PB ULP A saja (ULP yang sama dengan angka resmi)
        $this->assertEquals(-28, $y['difference']);
        $this->assertEquals(['2024-12', '2025-03', 30, 1, 1], [$y['previous_year']['base_month'], $y['previous_year']['to_month'], $y['previous_year']['official_net'], $y['previous_year']['companion'], $y['previous_year']['units_compared']]);
        $this->assertEqualsWithDelta(100 / 3, $y['official_change_pct'], 1e-9);                               // tambahan bersih 40 lawan 30
        $this->assertEqualsWithDelta(1100.0, $y['companion_change_pct'], 1e-9);                               // PB 12 lawan 1
        $m = collect($d['reconciliation']['monthly'])->keyBy('month');
        $this->assertEquals([10, 3, 1], [$m['2026-01']['official_net'], $m['2026-01']['companion'], $m['2026-01']['units_compared']]);
        $this->assertEquals([18, 5, 2], [$m['2026-02']['official_net'], $m['2026-02']['companion'], $m['2026-02']['units_compared']]);   // per bulan: ULP yang punya 309 bulan itu dan bulan sebelumnya (kedua ULP)
        $this->assertSame('perhatian', collect($d['insights'])->last()['level']);
        $this->assertStringContainsString('melebihi permohonan', collect($d['insights'])->last()['text']);
    }

    #[Test]
    public function metrik_daya_mengonversi_kva_permohonan_ke_mva_dan_metrik_lain_tanpa_pendamping(): void
    {
        foreach (['2025-12-01' => 5_000_000, '2026-03-01' => 5_016_000] as $period => $va) {
            $this->report($this->ulpA, '309', $period, [['JUMLAH', ['kwh_jumlah' => 0, 'pelanggan' => 10, 'daya_va' => $va, 'rp_jumlah' => 0]]]);
        }
        $this->connected($this->ulpA, 'PB', 10, '2026-02-03');
        $this->connected($this->ulpA, 'PB', 10, '2026-03-03');
        $this->connected($this->ulpA, 'PD', -4, '2026-03-04');

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/daya?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data');

        $this->assertSame(['kind' => 'VA_ADDED'], $d['forecast']);
        $this->assertEqualsWithDelta(0.016, $d['reconciliation']['ytd']['companion'], 1e-9);            // (10 + 10 - 4) kVA = 0,016 MVA
        $this->assertSame('MVA', $d['reconciliation']['unit']);
        $pbMva = collect($d['companions']['series'])->firstWhere('key', 'pb_kva');
        $this->assertEqualsWithDelta(0.01, $pbMva['latest'], 1e-9);

        $none = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-keluhan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data');
        $this->assertNull($none['companions']);
        $this->assertNull($none['reconciliation']);
        $this->assertNull($none['reconciliations']);
        $this->assertNull($none['forecast']);
    }

    private int $seq = 0;

    /** $n pelanggan aktif di $feeder pada $ulp (potret DIL), di belakang satu gardu. */
    private function feederCustomers(string $feeder, OrganizationalUnit $ulp, int $n): void
    {
        $sub = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $sub, 'code' => 'G'.Str::random(6), 'name' => 'Gardu '.Str::random(3), 'organizational_unit_id' => $ulp->getKey(), 'feeder_id' => $feeder, 'capacity_kva' => 100, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('customer_connections')->insert(array_map(fn ($i) => ['id' => (string) Str::uuid(), 'idpel' => sprintf('%012d', ++$this->seq), 'organizational_unit_id' => $ulp->getKey(), 'substation_id' => $sub, 'status' => 'AKTIF', 'source' => 'TEST', 'created_at' => now(), 'updated_at' => now()], range(1, $n)));
    }

    private function feederOf(OrganizationalUnit $ulp, string $code): string
    {
        $id = (string) Str::uuid();
        DB::table('distribution_feeders')->insert(['id' => $id, 'code' => $code, 'name' => 'FEEDER '.$code, 'gi_name' => 'GI X', 'owner_unit_id' => $ulp->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function outage(string $feeder, OrganizationalUnit $unit, string $when, string $type, float $minutes, float $ens): void
    {
        DB::table('outage_events')->insert(['id' => (string) Str::uuid(), 'source_key' => Str::random(30), 'row_hash' => Str::random(20), 'occurred_at' => $when.' 08:00:00+07', 'duration_minutes' => $minutes, 'organizational_unit_id' => $unit->getKey(),
            'gi_name' => 'GI X', 'feeder_name' => 'F', 'feeder_id' => $feeder, 'device_group' => 'RECLOSER', 'outage_type' => $type, 'ens_kwh' => $ens, 'category' => 'ROW', 'weather' => 'CERAH', 'created_at' => now(), 'updated_at' => now()]);
    }

    /**
     * Laporan DIFI satu bulan dengan susunan baris aslinya: ringkasan unit (pelanggan 150, SAIDI dan SAIFI total), lalu kelompok Distribusi per sub kelompok (Padam Tidak Terencana, Padam Terencana,
     * Bencana Alam) dengan subtotal fasilitas Gardu Induk dan Penyulang, ditambah padam JTR/sambungan rumah yang bukan tingkat penyulang dan hanya masuk TOTAL KELOMPOK Distribusi.
     *
     * @param  array{0: int, 1: int, 2: float, 3: float}  $feeder  gangguan penyulang: [kejadian, pelanggan padam, jam x pelanggan, kWh]
     * @param  array{0: int, 1: int}  $maintenance  pemeliharaan penyulang: [kejadian, pelanggan padam]
     */
    private function difi(OrganizationalUnit $unit, string $period, float $saidi, float $saifi, array $feeder, array $maintenance = [0, 0]): void
    {
        $row = fn (int $n, int $plg, float $jxp, float $kwh) => ['jumlah_gangguan' => $n, 'jml_plg_padam' => $plg, 'jam_x_plg' => $jxp, 'kwh_tak_tersalurkan' => $kwh];
        $this->report($unit, 'DIFI', $period, [
            ['SUB TOTAL FASILITAS Gardu Induk', $row(0, 0, 0, 0)], ['SUB TOTAL FASILITAS Penyulang', $row(...$feeder)], ['SUB TOTAL FASILITAS JTR', $row(40, 40, 30, 7)],
            ['TOTAL SUB KELOMPOK Padam Tidak Terencana', $row($feeder[0] + 40, $feeder[1] + 40, $feeder[2] + 30, $feeder[3] + 7)],
            ['SUB TOTAL FASILITAS Gardu Induk', $row(0, 0, 0, 0)], ['SUB TOTAL FASILITAS Penyulang', $row($maintenance[0], $maintenance[1], 2, 50)], ['TOTAL SUB KELOMPOK Padam Terencana', $row($maintenance[0], $maintenance[1], 2, 50)],
            ['SUB TOTAL FASILITAS Gardu Induk', $row(0, 0, 0, 0)], ['SUB TOTAL FASILITAS Penyulang', $row(0, 0, 0, 0)], ['TOTAL SUB KELOMPOK Bencana Alam', $row(0, 0, 0, 0)],
            ['TOTAL KELOMPOK Distribusi', $row($feeder[0] + 40 + $maintenance[0], $feeder[1] + 40 + $maintenance[1], $feeder[2] + 32, $feeder[3] + 57)],
            ['SUB TOTAL FASILITAS Penyulang', $row(99, 9999, 999, 999)], ['TOTAL SUB KELOMPOK Kelompok Tidak Terencana (Unplanned)', $row(99, 9999, 999, 999)], ['TOTAL KELOMPOK Transmisi', $row(99, 9999, 999, 999)],   // di luar Distribusi: tidak ikut
        ], ['pelanggan' => 150, 'saidi_menit' => $saidi, 'saifi_kali' => $saifi]);
    }

    #[Test]
    public function gangguan_penyulang_saidi_saifi_dan_ens_dibandingkan_dengan_difi_tingkat_penyulang_bukan_total_distribusi(): void
    {
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $f2 = $this->feederOf($this->ulpA, 'F2');
        $this->feederCustomers($f1, $this->ulpA, 100);
        $this->feederCustomers($f2, $this->ulpA, 50);
        $this->outage($f1, $this->ulpA, '2026-01-10', 'PERMANEN', 60, 500);
        $this->outage($f2, $this->ulpA, '2026-01-12', 'PERMANEN', 30, 200);
        $this->outage($f1, $this->ulpA, '2026-02-03', 'TEMPORER', 10, 100);
        $this->outage($f1, $this->ulpA, '2026-02-04', 'TEMPORER', 2, 0);                          // di bawah ambang 5 menit: gangguan, tetapi tidak dibandingkan dengan DIFI
        // DIFI tingkat penyulang sama dengan spreadsheet: Januari 2 gangguan, 150 pelanggan, 125 jam x pelanggan (= 100 x 1 jam + 50 x 0,5 jam), 600 kWh; Februari 1 gangguan, 100 pelanggan, 16,67 jam x pelanggan
        $this->difi($this->ulpA, '2026-01-01', 80, 3.0, [2, 150, 125, 600], [1, 300]);
        $this->difi($this->ulpA, '2026-02-01', 20, 1.5, [1, 100, 100 / 6, 100]);
        $this->difi($this->ulpA, '2026-03-01', 5, 0.5, [0, 0, 0, 0]);
        $url = fn (string $code, string $to = '2026-03') => "/api/pengusahaan/metrics/{$code}?unit_id={$this->ulpA->id}&from=2026-01&to={$to}";

        $g = $this->as($this->planner)->getJson($url('gangguan'))->assertOk()->json('data');
        $s = collect($g['series'])->keyBy('key');
        $this->assertEquals([[2, 2, 0], [2, 1, 0]], [$s['jumlah']['values'], $s['dihitung']['values']]);     // Februari: 2 gangguan, 1 lebih dari ambang
        $c = collect($g['companions']['series'])->keyBy('key');
        $this->assertEquals([2, 1, 0], $c['difi_gangguan']['values']);                                      // bukan TOTAL KELOMPOK Distribusi (42, 41, 40) dan bukan kelompok Transmisi
        $this->assertEquals([150, 100, 0], $c['difi_pelanggan_gangguan']['values']);
        $this->assertEquals([[1, 0, 0], [300, 0, 0]], [$c['difi_pemeliharaan']['values'], $c['difi_pelanggan_pemeliharaan']['values']]);
        $this->assertSame(['gangguan'], array_column($g['reconciliations'], 'key'));                         // pelanggan padam tidak diperkirakan dari DIL
        $this->assertEquals([3, 3, 0], [$g['reconciliation']['ytd']['official_net'], $g['reconciliation']['ytd']['companion'], $g['reconciliation']['ytd']['difference']]);
        $this->assertSame('info', collect($g['insights'])->last()['level']);

        $d = $this->as($this->planner)->getJson($url('saidi-saifi'))->assertOk()->json('data');
        $t = collect($d['series'])->keyBy('key');
        $this->assertEqualsWithDelta(62.8, $t['saidi']['values'][0], 1e-9);                                 // angka utama = TOTAL KELOMPOK Distribusi (157 jam x pelanggan x 60 / 150), bukan ringkasan total laporan (80)
        $this->assertEqualsWithDelta(50.0, $t['saidi_penyulang']['values'][0], 1e-9);                       // 125 jam x pelanggan x 60 / 150 pelanggan
        $this->assertEqualsWithDelta(1.0, $t['saifi_penyulang']['values'][0], 1e-9);                        // 150 / 150
        $saidi = $d['reconciliations'][0]['ytd'];
        $this->assertEqualsWithDelta(50 + 1000 / 150, $saidi['official_net'], 1e-6);                         // SAIDI gangguan penyulang DIFI ...
        $this->assertEqualsWithDelta(50 + 1000 / 150, $saidi['companion'], 1e-6);                            // ... sama dengan hitungan DISTRIVA dari spreadsheet
        $this->assertSame('SAIDI gangguan penyulang (DIFI)', $d['reconciliations'][0]['official_name']);

        $e = $this->as($this->planner)->getJson($url('ens'))->assertOk()->json('data');
        $this->assertEqualsWithDelta(0.7, $e['reconciliation']['ytd']['official_net'], 1e-9);                // ENS gangguan penyulang DIFI, bukan total distribusi (0,657 + 0,157 + 0,057)
        $this->assertEqualsWithDelta(0.8, $e['reconciliation']['ytd']['companion'], 1e-9);
        $this->assertEqualsWithDelta(0.657, collect($e['series'])->firstWhere('key', 'ens')['values'][0], 1e-9);

        // bulan tanpa laporan DIFI tidak dibandingkan (bukan dianggap nol) dan kumulatif tidak dihitung
        $this->outage($f1, $this->ulpA, '2026-04-02', 'PERMANEN', 40, 50);
        $apr = $this->as($this->planner)->getJson($url('gangguan', '2026-04'))->assertOk()->json('data');
        $this->assertSame([null, null], [$apr['reconciliation']['monthly'][3]['official_net'], $apr['reconciliation']['monthly'][3]['companion']]);
        $this->assertNull($apr['reconciliation']['ytd']);
        $this->assertStringContainsString('belum dapat dihitung', collect($apr['insights'])->last()['text']);
    }

    #[Test]
    public function selisih_besar_antara_laporan_resmi_dan_data_gangguan_menjadi_catatan_perhatian(): void
    {
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $this->feederCustomers($f1, $this->ulpA, 100);
        $this->outage($f1, $this->ulpA, '2026-01-10', 'PERMANEN', 60, 1000);                      // spreadsheet: 1 MWh
        $this->difi($this->ulpA, '2026-01-01', 10, 0.1, [1, 100, 100, 100]);                      // DIFI tingkat penyulang: 0,1 MWh

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/ens?unit_id={$this->ulpA->id}&from=2026-01&to=2026-01")->assertOk()->json('data');

        $last = collect($d['insights'])->last();
        $this->assertSame('perhatian', $last['level']);
        $this->assertStringContainsString('1000% dari angka resmi', $last['text']);
    }

    #[Test]
    public function laporan_difi_bulan_terakhir_tanpa_gangguan_penyulang_padahal_bulan_sebelumnya_ramai_diberi_peringatan(): void
    {
        foreach (['2026-01-01', '2026-02-01', '2026-03-01'] as $p) {
            $this->difi($this->ulpA, $p, 10, 0.1, [4, 100, 100, 100]);
        }
        $this->difi($this->ulpA, '2026-04-01', 1, 0.01, [0, 0, 0, 0], [3, 50]);                  // bulan terbaru: hanya pemeliharaan, tanpa gangguan tidak terencana

        foreach (['saidi-saifi', 'ens', 'gangguan'] as $code) {
            $w = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/{$code}?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->json('data.warnings');
            $this->assertCount(1, $w, $code);
            $this->assertSame('difi_latest_month_incomplete', $w[0]['code']);
            $this->assertSame('2026-04', $w[0]['month']);
            $this->assertEquals(4.0, $w[0]['events_previous_average']);
            $this->assertStringContainsString('Laporan DIFI 2026-04 kemungkinan belum lengkap', $w[0]['message']);
        }
        $h = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi/history?unit_id={$this->ulpA->id}")->assertOk()->json('data.warnings');
        $this->assertSame('2026-04', $h[0]['month']);

        // rentang yang berhenti sebelum bulan terbaru tidak diberi peringatan; metrik non-DIFI tidak pernah
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->assertJsonPath('data.warnings', []);
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->assertJsonPath('data.warnings', []);
    }

    #[Test]
    public function laporan_difi_terbaru_yang_memuat_gangguan_atau_bulan_sebelumnya_sepi_tidak_diberi_peringatan(): void
    {
        foreach (['2026-01-01', '2026-02-01', '2026-03-01'] as $p) {
            $this->difi($this->ulpA, $p, 10, 0.1, [4, 100, 100, 100]);
        }
        $this->difi($this->ulpA, '2026-04-01', 5, 0.05, [2, 40, 40, 40]);                         // ada gangguan: lengkap
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->assertJsonPath('data.warnings', []);

        DB::table('eis_report_files')->where('family', 'DIFI')->delete();
        foreach (['2026-01-01', '2026-02-01', '2026-03-01'] as $p) {
            $this->difi($this->ulpA, $p, 1, 0.01, [1, 10, 10, 10]);                               // sepi (rata-rata 1 per bulan): nol di bulan terbaru wajar
        }
        $this->difi($this->ulpA, '2026-04-01', 1, 0.01, [0, 0, 0, 0]);
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->assertJsonPath('data.warnings', []);
    }

    /** Laporan 309 dengan baris kelompok (JUMLAH R, JUMLAH B) dan JUMLAH: kWh, daya, rupiah. */
    private function groups309(OrganizationalUnit $unit, string $period, array $r, array $b = [0, 0, 0]): void
    {
        $this->report($unit, '309', $period, [['JUMLAH R', ['kwh_jumlah' => $r[0], 'daya_va' => $r[1], 'rp_jumlah' => $r[2]]], ['JUMLAH B', ['kwh_jumlah' => $b[0], 'daya_va' => $b[1], 'rp_jumlah' => $b[2]]],
            ['JUMLAH', ['kwh_jumlah' => $r[0] + $b[0], 'pelanggan' => 10, 'daya_va' => $r[1] + $b[1], 'rp_jumlah' => $r[2] + $b[2]]]]);
    }

    #[Test]
    public function kwh_jual_dan_pendapatan_memperkirakan_sumbangan_pelanggan_baru_dari_kva_pb_dan_kwh_per_kva_aktual(): void
    {
        foreach (['2025-01-01', '2025-02-01'] as $period) {
            $this->groups309($this->ulpA, $period, [1000, 10_000, 1_000_000]);
        }
        foreach (['2026-01-01', '2026-02-01'] as $period) {
            $this->groups309($this->ulpA, $period, [1200, 12_000, 1_200_000], [500, 5_000, 800_000]);            // R: 100 kWh per kVA, Rp 100.000 per kVA
        }
        $this->connected($this->ulpA, 'PB', 2, '2026-01-05');        // kelompok R
        $this->connected($this->ulpA, 'PB', 3, '2026-02-05');
        $this->connected($this->ulpA, 'PB', 4, '2026-02-06', 'Z9X');   // kelompok di luar S R B I P: tidak dihitung
        $this->connected($this->ulpA, 'PB', 1, '2024-01-05');        // di luar jendela 12 bulan
        $url = fn (string $code) => "/api/pengusahaan/metrics/{$code}?unit_id={$this->ulpA->id}&from=2026-02&to=2026-02";

        $d = $this->as($this->planner)->getJson($url('kwh-jual'))->assertOk()->json('data');

        $est = collect($d['companions']['series'])->firstWhere('key', 'est_kwh');
        $this->assertEqualsWithDelta(500.0, $est['values'][0], 1e-6);                                   // Februari: (2 + 3) kVA x 100 kWh per kVA (jendela Mar 2025 sampai Feb 2026)
        $this->assertEqualsWithDelta(700.0, $est['ytd'], 1e-6);                                         // Januari 200 (hanya PB Januari) + Februari 500
        $y = $d['reconciliation']['ytd'];
        $this->assertSame('yoy', $d['reconciliation']['mode']);
        $this->assertEqualsWithDelta(1400.0, $y['official_net'], 1e-6);                                  // (1700 - 1000) per bulan x 2 bulan
        $this->assertEqualsWithDelta(700.0, $y['companion'], 1e-6);
        $this->assertEqualsWithDelta(-700.0, $y['difference'], 1e-6);                                  // perkiraan 700 dikurangi kenaikan resmi 1400
        $this->assertNull($d['forecast']);
        $this->assertSame('info', collect($d['insights'])->last()['level']);
        $this->assertStringContainsString('sekitar 50% dari kenaikan resmi', collect($d['insights'])->last()['text']);

        $p = $this->as($this->planner)->getJson($url('pendapatan'))->assertOk()->json('data');
        $this->assertEqualsWithDelta(500_000.0, collect($p['companions']['series'])->firstWhere('key', 'est_rp')['values'][0], 1e-3);     // 5 kVA x Rp 100.000
        $this->assertSame('Rp', $p['reconciliation']['unit']);
    }

    /** @return list<array{string, int}> $n bulan berurutan dari $first dengan jumlah pelanggan naik $step per bulan dari $start */
    private function growing(string $first, int $n, int $start, int $step): array
    {
        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $out[] = [date('Y-m', strtotime($first.'-01 +'.$i.' month')).'-01', $start + $step * $i];
        }

        return $out;
    }

    #[Test]
    public function prakiraan_memakai_riwayat_lengkap_berurutan_dan_menolak_riwayat_pendek_atau_ulp_yang_belum_lengkap(): void
    {
        $this->customers309($this->ulpA, $this->growing('2024-05', 30, 1000, 10));                        // 2024-05 .. 2026-10, naik 10 per bulan
        $this->customers309($this->ulpB, $this->growing('2025-11', 12, 500, 5));                          // ULP B hanya 12 bulan terakhir

        $a = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/forecast?unit_id={$this->ulpA->id}")->assertOk()->json('data');
        $s = $a['series'][0];
        $this->assertSame(['OK', 30, 'last', '2026-10'], [$a['status'], $s['history_months'], $s['aggregate'], $a['last_month']]);
        $this->assertCount(12, $s['forecast']);
        $this->assertSame('2026-11', $s['forecast'][0]['month']);
        $this->assertGreaterThan(1290, $s['forecast'][0]['p50']);                                        // di atas nilai terakhir 1290 (tren naik) ...
        $this->assertLessThan(1320, $s['forecast'][0]['p50']);                                           // ... dan wajar untuk satu bulan ke depan
        foreach ($s['forecast'] as $f) {
            $this->assertTrue($f['p10'] <= $f['p50'] && $f['p50'] <= $f['p90']);
        }
        $this->assertSame(['year_end', '2026-12'], [$s['period']['kind'], $s['period']['month']]);
        $this->assertEquals(1000 + 10 * 19, $s['period']['previous']);                                    // Desember 2025 = bulan ke-20 dari 2024-05
        $this->assertGreaterThan(0, $s['period']['change_pct']);
        $this->assertSame('baik', $s['insights'][0]['level']);                                            // pelanggan naik: baik (polarity up)
        $this->assertStringContainsString('diprakirakan naik', $s['insights'][0]['text']);
        $this->assertNotNull($s['quality']['gain_vs_naive_pct']);

        $b = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/forecast?unit_id={$this->ulpB->id}")->assertOk()->json('data');
        $this->assertSame(['INSUFFICIENT', 'INSUFFICIENT'], [$b['status'], $b['series'][0]['status']]);
        $this->assertStringContainsString('12 bulan', $b['series'][0]['message']);

        $up3 = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/forecast?unit_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame('INSUFFICIENT', $up3['status']);                                               // hanya bulan ketika semua ULP melapor: 12 bulan
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/tidak-ada/forecast?unit_id={$this->ulpA->id}")->assertNotFound();
    }

    #[Test]
    public function histori_memuat_berkas_kelengkapan_dan_sesi_sinkron_hanya_untuk_yang_berwenang(): void
    {
        $this->customers309($this->ulpA, [['2026-08-01', 10], ['2026-10-01', 12]]);                       // September 2026 tidak masuk
        $this->customers309($this->ulpB, [['2026-10-01', 7]]);
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'PIUTANG', 'options' => json_encode(['from_month' => '2026-10', 'to_month' => '2026-10', 'reports' => ['GOLONGAN']]), 'created_at' => now()]);
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'PERMOHONAN', 'created_at' => now()]);
        $admin = $this->makeUser();                                                                      // Niaga Retail UP3: berwenang atas sinkronisasi EIS
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/history?unit_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame(['309', '2026-10'], [$d['family'], $d['latest_month']]);
        $this->assertCount(3, $d['files']);
        $this->assertSame('AKTIF', $d['files'][0]['status']);
        $this->assertCount(24, $d['months']);
        $cov = collect($d['coverage']['units'])->keyBy('unit_name');
        $this->assertSame(['2026-09'], array_values(array_intersect($cov['ULP A']['missing'], ['2026-08', '2026-09', '2026-10'])));
        $this->assertSame(23, $cov['ULP B']['missing_count']);                                          // ULP B hanya punya Oktober dari 24 bulan
        $this->assertNull($d['syncs']);                                                                  // perencana tidak berwenang atas sinkronisasi EIS

        $piutang = $this->as($admin)->getJson("/api/pengusahaan/metrics/piutang-prabayar/history?unit_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame(['piutang'], array_column($piutang['syncs'], 'kind'));                         // hanya penarikan piutang, bukan permohonan
        $this->assertSame('GOLONGAN', $piutang['syncs'][0]['options']['reports'][0]);
        $pelanggan = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelanggan/history?unit_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame(['permohonan'], array_column($pelanggan['syncs'], 'kind'));
        $kwh = $this->as($admin)->getJson("/api/pengusahaan/metrics/kwh-jual/history?unit_id={$this->up3->id}")->assertOk()->json('data');
        $this->assertSame([], $kwh['syncs']);                                                            // 309 diunggah, tidak ada sesi sinkron
    }

    #[Test]
    public function matriks_kelengkapan_per_tahun_tidak_menghitung_bulan_yang_belum_jatuh_tempo_dan_mencakup_tahun_di_luar_24_bulan(): void
    {
        CarbonImmutable::setTestNow('2026-11-14 10:00:00');
        try {
            // 2026: Januari sampai Oktober kecuali Maret; 2024: hanya Juni (di luar jendela 24 bulan 2024-11 .. 2026-10)
            $this->customers309($this->ulpA, array_merge(
                array_map(fn ($m) => [sprintf('2026-%02d-01', $m), 100 + $m], array_values(array_diff(range(1, 10), [3]))),
                [['2024-06-01', 50]],
            ));
            $get = fn (string $q = '') => $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/history?unit_id={$this->ulpA->id}{$q}")->assertOk()->json('data');

            $y26 = $get('&year=2026');
            $this->assertSame([2026, '2026-10'], [$y26['year'], $y26['expected_until']]);
            $this->assertCount(12, $y26['months']);
            $this->assertSame([true, true, true, true, true, true, true, true, true, true, false, false], $y26['coverage']['due']);
            $u = $y26['coverage']['units'][0];
            $this->assertSame(['2026-03'], $u['missing']);                                                 // November dan Desember belum jatuh tempo: bukan kekurangan
            $this->assertSame(1, $u['missing_count']);
            $this->assertSame([true, true, false, true, true, true, true, true, true, true, false, false], $u['months']);
            $this->assertSame([10, 1], [$y26['coverage']['expected_total'], $y26['coverage']['missing_total']]);

            $y24 = $get('&year=2024');                                                                     // tahun di luar 24 bulan terakhir tetap dihitung dari datanya
            $this->assertTrue($y24['coverage']['units'][0]['months'][5]);                                  // Juni 2024 ada
            $this->assertSame(11, $y24['coverage']['units'][0]['missing_count']);
            $this->assertSame([2026, 2025, 2024], $y24['available_years']);                                // dari tahun laporan tertua sampai tahun bulan terakhir

            $default = $get();                                                                             // tanpa year: 24 bulan terakhir, bentuk lama dengan tanda jatuh tempo
            $this->assertNull($default['year']);
            $this->assertCount(24, $default['months']);
            $this->assertNotContains(false, $default['coverage']['due']);                                  // seluruhnya sampai Oktober 2026
            $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan/history?unit_id={$this->ulpA->id}&year=1999")->assertUnprocessable();
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    #[Test]
    public function unduhan_excel_memuat_lembar_dengan_angka_yang_sama_dengan_layar(): void
    {
        $this->customers309($this->ulpA, [['2025-12-01', 1000], ['2026-01-01', 1010], ['2026-02-01', 1025]]);
        $this->connected($this->ulpA, 'PB', 2.2, '2026-01-05');

        $r = $this->as($this->planner)->get("/api/pengusahaan/metrics/pelanggan/export?unit_id={$this->ulpA->id}&from=2026-01&to=2026-02");
        $r->assertOk()->assertDownload('PENGUSAHAAN-PELANGGAN-2026-01-2026-02.xlsx');
        $book = IOFactory::load($r->baseResponse->getFile()->getPathname());
        $this->assertSame(['Ringkasan', 'Seri', 'Rincian', 'Rekonsiliasi pelanggan', 'Pendamping', 'Catatan'], $book->getSheetNames());   // tanpa prakiraan (riwayat pendek) dan tanpa perbandingan ULP (satu ULP)
        $summary = $book->getSheetByName('Ringkasan');
        $this->assertSame('Pelanggan', $summary->getCell('B1')->getValue());
        $this->assertEquals(1025, $summary->getCell('C8')->getValue());                                 // terakhir
        $series = $book->getSheetByName('Seri');
        $this->assertSame('2026-01', $series->getCell('A2')->getValue());
        $this->assertEquals([1010, 1025], [$series->getCell('C2')->getValue(), $series->getCell('C3')->getValue()]);
        $rec = $book->getSheetByName('Rekonsiliasi pelanggan');
        $this->assertEquals([10, 1], [$rec->getCell('B5')->getValue(), $rec->getCell('C5')->getValue()]);   // Januari: tambahan bersih 10, PB 1
        $this->as($this->viewer)->get("/api/pengusahaan/metrics/pelanggan/export?unit_id={$this->ulpB->id}")->assertNotFound();    // ULP di luar cakupan
    }

    #[Test]
    public function anomali_keluhan_bersumber_apkt_menggabungkan_berulang_dan_rating_negatif_dengan_histori_dan_sesi(): void
    {
        $run = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $run, 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'anomali-keluhan', 'token_encrypted' => 'rahasia']), 'created_at' => now()]);
        $row = fn (string $period, string $jenis, array $v) => ['id' => (string) Str::uuid(), 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'jenis' => $jenis, 'sync_run_id' => $run, 'created_at' => now(), 'updated_at' => now()]
            + array_combine(['wo_cc123', 'wo_pln_mobile', 'wo_loket', 'wo_lainnya', 'wo_total', 'anomali_pln_mobile', 'anomali_cc123', 'total_anomali'], $v);
        // Maret 2026: WO 10+50+0+5 = 65; berulang PLN Mobile 2 + CC123 1; rating negatif PLN Mobile 4 + CC123 2; Februari: hanya berulang
        DB::table('apkt_anomali_keluhan_records')->insert([$row('2026-03-01', 'BERULANG', [10, 50, 0, 5, 65, 2, 1, 3]), $row('2026-03-01', 'NEGATIF', [10, 50, 0, 5, 65, 4, 2, 6]), $row('2026-02-01', 'BERULANG', [10, 50, 0, 5, 65, 0, 0, 0])]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $k = $this->as($admin)->getJson("/api/pengusahaan/metrics/anomali-keluhan?unit_id={$this->ulpA->id}&from=2026-02&to=2026-03")->assertOk()->json('data');
        $s = collect($k['series'])->keyBy('key');
        $this->assertSame('down', $k['metric']['polarity']);
        $this->assertEquals([65, 3, 6], [$s['wo']['values'][1], $s['berulang']['values'][1], $s['negatif']['values'][1]]);
        $this->assertEqualsWithDelta(3 / 65 * 100, $s['berulang_pct']['values'][1], 1e-9);
        $this->assertEqualsWithDelta(6 / 65 * 100, $s['negatif_pct']['values'][1], 1e-9);
        $this->assertEquals(['2026-02'], $k['coverage']['missing'][0]['months']);                        // Februari: rating negatif belum ada, bulan tidak dihitung
        $this->assertEquals(['PLN Mobile' => 50.0, 'CC 123' => 10.0, 'Lainnya' => 5.0, 'Loket' => 0.0], collect($k['breakdown']['rows'])->pluck('value', 'key')->all());
        $this->assertSame('Kanal pengaduan masuk', $k['breakdown']['dimension']);
        $this->assertEquals(['Berulang · PLN Mobile' => 2.0, 'Berulang · CC 123' => 1.0, 'Rating negatif · PLN Mobile' => 4.0, 'Rating negatif · CC 123' => 2.0], collect($k['breakdown_secondary']['rows'])->pluck('value', 'key')->all());
        $this->assertNull($k['matrix']);
        $this->assertArrayNotHasKey('negatif_nonmarking', $s->all());                                    // ukuran NKO hanya untuk gangguan

        $h = $this->as($admin)->getJson("/api/pengusahaan/metrics/anomali-keluhan/history?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data');
        $this->assertSame(['APKT_RPT_RCT'], $h['families']);
        $this->assertCount(2, $h['files']);
        $this->assertSame('APKT – Anomali Penanganan Pengaduan Keluhan (Berulang dan Rating Negatif)', $h['files'][0]['original_name']);
        $this->assertCount(1, $h['syncs']);
        $this->assertStringNotContainsString('rahasia', json_encode($h['syncs']));
    }

    /** Baris penarikan APKT anomali gangguan (urutan kolom APKT: WO CC123, PLN Mobile, loket, lainnya, total; anomali PLN Mobile marking dan non, CC123 marking dan non; total marking dan non). */
    private function anomaliGangguanRow(OrganizationalUnit $unit, string $period, string $jenis, array $v, ?string $run = null): array
    {
        $names = ['wo_cc123', 'wo_pln_mobile', 'wo_loket', 'wo_lainnya', 'wo_total', 'anomali_pln_mobile_marking', 'anomali_pln_mobile_non_marking', 'anomali_cc123_marking', 'anomali_cc123_non_marking', 'total_anomali_marking', 'total_anomali_non_marking'];

        return ['id' => (string) Str::uuid(), 'organizational_unit_id' => $unit->id, 'period' => $period, 'jenis' => $jenis, 'sync_run_id' => $run, 'created_at' => now(), 'updated_at' => now()] + array_combine($names, $v);
    }

    #[Test]
    public function anomali_gangguan_bersumber_apkt_menggabungkan_berulang_dan_rating_negatif_dengan_histori_dan_sesi(): void
    {
        $run = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $run, 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'anomali-gangguan', 'token_encrypted' => 'rahasia']), 'created_at' => now()]);
        // Maret 2026: WO 100 (CC123 20, PLN Mobile 70, loket 0, lainnya 10); berulang marking 3 + non marking 3; negatif marking 5 + non marking 4
        DB::table('apkt_anomali_gangguan_records')->insert([
            $this->anomaliGangguanRow($this->ulpA, '2026-03-01', 'BERULANG', [20, 70, 0, 10, 100, 2, 1, 1, 2, 3, 3], $run),
            $this->anomaliGangguanRow($this->ulpA, '2026-03-01', 'NEGATIF', [20, 70, 0, 10, 100, 3, 2, 2, 2, 5, 4], $run),
            $this->anomaliGangguanRow($this->ulpA, '2026-02-01', 'BERULANG', [20, 70, 0, 10, 100, 0, 0, 0, 0, 0, 0], $run),      // Februari: rating negatif belum ada
        ]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $g = $this->as($admin)->getJson("/api/pengusahaan/metrics/anomali-gangguan?unit_id={$this->ulpA->id}&from=2026-02&to=2026-03")->assertOk()->json('data');
        $s = collect($g['series'])->keyBy('key');
        $this->assertEquals([100, 6, 9, 4], [$s['wo']['values'][1], $s['berulang']['values'][1], $s['negatif']['values'][1], $s['negatif_nonmarking']['values'][1]]);   // non marking = ukuran NKO
        $this->assertEqualsWithDelta(6.0, $s['berulang_pct']['values'][1], 1e-9);
        $this->assertEqualsWithDelta(9.0, $s['negatif_pct']['values'][1], 1e-9);
        $this->assertEquals(['2026-02'], $g['coverage']['missing'][0]['months']);                       // Februari: rating negatif belum ada, bulan tidak dihitung
        $this->assertNull($s['wo']['values'][0]);
        $this->assertEquals(['PLN Mobile' => 70.0, 'CC 123' => 20.0, 'Lainnya' => 10.0, 'Loket' => 0.0], collect($g['breakdown']['rows'])->pluck('value', 'key')->all());
        $this->assertEquals(2.0, collect($g['breakdown_secondary']['rows'])->firstWhere('key', 'Berulang · CC 123 · Non Marking')['value']);
        $this->assertNull($g['matrix']);

        $h = $this->as($admin)->getJson("/api/pengusahaan/metrics/anomali-gangguan/history?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data');
        $this->assertSame(['APKT_RPT_RCT'], $h['families']);
        $this->assertCount(2, $h['files']);                                                              // Februari (1 jenis) dan Maret (2 jenis)
        $this->assertSame('APKT – Anomali Penanganan Pengaduan Gangguan (Berulang dan Rating Negatif)', $h['files'][0]['original_name']);
        $this->assertCount(1, $h['syncs']);
        $this->assertStringNotContainsString('rahasia', json_encode($h['syncs']));
    }

    /** Baris penarikan APKT: clear_temper true = Semua Laporan, false = Tanpa Clear Temper. */
    private function apktRow(OrganizationalUnit $unit, string $period, bool $withClearTemper, float $rpt, int $n, float $rct, ?string $run = null): array
    {
        return ['id' => (string) Str::uuid(), 'organizational_unit_id' => $unit->id, 'period' => $period, 'clear_temper' => $withClearTemper, 'rpt_total' => $rpt, 'rpt_count' => $n,
            'rct_total' => $rct, 'rct_count' => $n, 'sync_run_id' => $run, 'created_at' => now(), 'updated_at' => now()];
    }

    #[Test]
    public function rpt_rct_gangguan_bersumber_apkt_semua_laporan_dengan_pembanding_tanpa_clear_temper_tertimbang_jumlah_wo(): void
    {
        DB::table('apkt_rpt_rct_records')->insert([
            $this->apktRow($this->ulpA, '2026-03-01', true, 200, 10, 600), $this->apktRow($this->ulpA, '2026-03-01', false, 80, 4, 200),
            $this->apktRow($this->ulpB, '2026-03-01', true, 1200, 30, 3000), $this->apktRow($this->ulpB, '2026-03-01', false, 300, 10, 800),
        ]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $s = collect($d['summary'])->keyBy('key');

        $this->assertEqualsWithDelta(35.0, $s['rpt']['latest'], 1e-9);                                   // (200 + 1200) / 40
        $this->assertEqualsWithDelta(90.0, $s['rct']['latest'], 1e-9);
        $this->assertEquals(40, $s['jumlah']['latest']);
        $this->assertEqualsWithDelta(380 / 14, $s['rpt_tanpa_ct']['latest'], 1e-9);                      // pembanding: hanya 14 WO tanpa clear temper
        $this->assertEquals(14, $s['jumlah_tanpa_ct']['latest']);
        $this->assertEqualsWithDelta(26 / 40 * 100, $s['porsi_clear_temper']['latest'], 1e-9);
        $this->assertNull($d['companions']);                                                             // GGNALL tidak lagi dipakai di menu ini
        $this->assertEmpty($d['reconciliations']);
        $this->assertEqualsCanonicalizing(['ULP A', 'ULP B'], array_column($d['comparison'], 'unit_name'));              // semua ULP muncul tanpa laporan GGNALL
    }

    #[Test]
    public function rpt_rct_gangguan_bulan_berjalan_dari_apkt_diberi_peringatan_belum_final(): void
    {
        $current = now(config('distriva.business_timezone'))->format('Y-m');
        $past = date('Y-m', strtotime($current.'-01 -2 month'));
        DB::table('apkt_rpt_rct_records')->insert([$this->apktRow($this->ulpA, $current.'-01', true, 200, 10, 600), $this->apktRow($this->ulpA, $past.'-01', true, 200, 10, 600)]);

        $w = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from={$past}&to={$current}")->assertOk()->json('data.warnings');
        $this->assertSame(['apkt_current_month_partial'], array_column($w, 'code'));
        $this->assertSame([$current, 1], [$w[0]['month'], $w[0]['units_reporting']]);
        $this->assertStringContainsString('belum final', $w[0]['message']);

        $this->assertSame([], $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from={$past}&to={$past}")->assertOk()->json('data.warnings'));   // rentang berhenti sebelum bulan berjalan
        $history = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan/history?unit_id={$this->up3->id}")->assertOk()->json('data.warnings');
        $this->assertSame(['apkt_current_month_partial'], array_column($history, 'code'));
    }

    #[Test]
    public function histori_rpt_rct_gangguan_bersumber_apkt_pada_berkas_kelengkapan_dan_sesi(): void
    {
        $run = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $run, 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'rpt-rct-gangguan', 'from_month' => '2026-03', 'to_month' => '2026-03', 'token_encrypted' => 'rahasia']), 'created_at' => now()]);
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'saidi-saifi']), 'created_at' => now()]);
        DB::table('apkt_rpt_rct_records')->insert([$this->apktRow($this->ulpA, '2026-03-01', true, 10, 1, 20, $run), $this->apktRow($this->ulpA, '2026-03-01', false, 5, 1, 10, $run)]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $d = $this->as($admin)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan/history?unit_id={$this->up3->id}&year=2026")->assertOk()->json('data');

        $this->assertSame(['APKT_RPT_RCT'], $d['families']);
        $this->assertCount(1, $d['files']);
        $this->assertSame(['APKT_RPT_RCT', 'ULP A', '2026-03', 2], [$d['files'][0]['family'], $d['files'][0]['unit_name'], $d['files'][0]['period'], $d['files'][0]['line_count']]);
        $cov = collect($d['coverage']['units'])->keyBy('unit_name');
        $this->assertTrue($cov['ULP A']['months'][2]);
        $this->assertFalse($cov['ULP B']['months'][2]);
        $this->assertCount(1, $d['syncs']);                                                              // hanya penarikan APKT dataset ini
        $this->assertSame('apkt', $d['syncs'][0]['kind']);
        $this->assertArrayNotHasKey('token_encrypted', $d['syncs'][0]['options']);
    }

    #[Test]
    public function histori_saidi_saifi_memuat_penarikan_apkt_saidi_saifi_tanpa_dataset_lain_dan_tanpa_token(): void
    {
        $insert = fn (array $options, string $at) => DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode($options), 'created_at' => $at]);
        $insert(['from_month' => '2026-09', 'to_month' => '2026-09', 'token_encrypted' => 'rahasia'], '2026-11-01 10:00:00');                  // run lama tanpa dataset = SAIDI/SAIFI
        $insert(['dataset' => 'saidi-saifi', 'to_month' => '2026-10', 'token_encrypted' => 'rahasia'], '2026-11-02 10:00:00');
        $insert(['dataset' => 'rpt-rct-gangguan', 'to_month' => '2026-10'], '2026-11-03 10:00:00');
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        foreach (['saidi-saifi', 'ens'] as $code) {
            $syncs = collect($this->as($admin)->getJson("/api/pengusahaan/metrics/{$code}/history?unit_id={$this->up3->id}")->assertOk()->json('data.syncs'))->where('kind', 'apkt')->values();
            $this->assertCount(2, $syncs);
            $this->assertSame('2026-10', $syncs[0]['options']['to_month']);                              // terbaru lebih dulu
            $this->assertStringNotContainsString('rahasia', json_encode($syncs));
        }
        $gangguan = $this->as($admin)->getJson("/api/pengusahaan/metrics/gangguan/history?unit_id={$this->up3->id}")->assertOk()->json('data.syncs');
        $this->assertSame([], array_values(array_filter((array) $gangguan, fn ($s) => $s['kind'] === 'apkt')));   // gangguan penyulang bersumber spreadsheet, bukan APKT
    }

    #[Test]
    public function rpt_rct_keluhan_bersumber_apkt_tertimbang_jumlah_wo_dengan_histori_sesi_dan_peringatan_bulan_berjalan(): void
    {
        $keluhan = fn (OrganizationalUnit $unit, string $period, float $rpt, int $n, float $rct, ?string $run = null) => ['id' => (string) Str::uuid(), 'organizational_unit_id' => $unit->id, 'period' => $period, 'rpt_total' => $rpt, 'rpt_count' => $n,
            'rct_total' => $rct, 'rct_count' => $n, 'sync_run_id' => $run, 'created_at' => now(), 'updated_at' => now()];
        $run = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $run, 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'rpt-rct-keluhan', 'token_encrypted' => 'rahasia']), 'created_at' => now()]);
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'APKT', 'options' => json_encode(['dataset' => 'rpt-rct-gangguan']), 'created_at' => now()]);
        $current = now(config('distriva.business_timezone'))->format('Y-m');
        DB::table('apkt_rpt_rct_keluhan_records')->insert([$keluhan($this->ulpA, '2026-03-01', 25, 100, 150, $run), $keluhan($this->ulpB, '2026-03-01', 158, 300, 2131, $run), $keluhan($this->ulpA, $current.'-01', 5, 10, 20, $run)]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $d = $this->as($admin)->getJson("/api/pengusahaan/metrics/rpt-rct-keluhan?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $s = collect($d['summary'])->keyBy('key');
        $this->assertEqualsWithDelta(183 / 400, $s['rpt']['latest'], 1e-9);                         // (25 + 158) / 400 WO
        $this->assertEqualsWithDelta(2281 / 400, $s['rct']['latest'], 1e-9);
        $this->assertEquals(400, $s['jumlah']['latest']);
        $this->assertEqualsWithDelta(['jam', 'jam', 'kali'], array_column($d['series'], 'unit'), 0);
        $this->assertEqualsCanonicalizing(['ULP A', 'ULP B'], array_column($d['comparison'], 'unit_name'));

        $h = $this->as($admin)->getJson("/api/pengusahaan/metrics/rpt-rct-keluhan/history?unit_id={$this->up3->id}&year=2026")->assertOk()->json('data');
        $this->assertSame(['APKT_RPT_RCT'], $h['families']);
        $this->assertSame('APKT – Jumlah dan Durasi RPT RCT Keluhan', $h['files'][0]['original_name']);
        $this->assertTrue(collect($h['coverage']['units'])->keyBy('unit_name')['ULP B']['months'][2]);
        $this->assertCount(1, $h['syncs']);                                                          // hanya penarikan dataset keluhan
        $this->assertStringNotContainsString('rahasia', json_encode($h['syncs']));
        $this->assertSame(['apkt_current_month_partial'], array_column($h['warnings'], 'code'));
        $this->assertStringContainsString('RPT/RCT keluhan', $h['warnings'][0]['message']);
    }

    #[Test]
    public function histori_kwh_p2tl_memuat_sesi_penarikan_ap2t(): void
    {
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'AP2T', 'options' => json_encode(['dataset' => 'tagsus', 'from_month' => '2026-10', 'to_month' => '2026-10']), 'created_at' => now()]);
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'PIUTANG', 'created_at' => now()]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $syncs = $this->as($admin)->getJson("/api/pengusahaan/metrics/kwh-p2tl/history?unit_id={$this->up3->id}")->assertOk()->json('data.syncs');

        $this->assertSame(['ap2t'], array_column($syncs, 'kind'));                                       // hanya penarikan AP2T, bukan piutang
        $this->assertSame('tagsus', $syncs[0]['options']['dataset']);
    }

    #[Test]
    public function kwh_p2tl_menampilkan_belum_realisasi_sebagai_pendamping_potret_tanpa_mengubah_angka_utama(): void
    {
        $ts = fn (string $label, float $kwh, float $rp, int $n) => [$label, ['kwh' => $kwh, 'rp_total' => $rp, 'jumlah' => $n]];
        $this->report($this->ulpA, 'TAGSUS', '2026-03-01', [$ts('K2', 100, 1000, 2), $ts('P3', 50, 500, 1)]);
        $this->report($this->ulpA, 'TAGSUS', '2026-04-01', [$ts('K2', 10, 100, 1)]);
        $this->report($this->ulpB, 'TAGSUS', '2026-03-01', [$ts('K2', 20, 200, 1)]);
        $this->report($this->ulpA, 'TAGSUS_BELUM', '2026-03-01', [$ts('K2', 30, 300, 1)]);                  // Maret: satu penetapan ULP A masih belum terealisasi
        $this->report($this->ulpB, 'TAGSUS_BELUM', '2026-03-01', [$ts('P2', 5, 50, 2)]);
        $this->report($this->ulpA, 'TAGSUS_BELUM', '2026-04-01', []);                                         // April: laporan sah tanpa baris = nol belum realisasi

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-p2tl?unit_id={$this->up3->id}&from=2026-02&to=2026-05")->assertOk()->json('data');

        $main = collect($d['series'])->keyBy('key');
        $this->assertEquals([null, 170.0, 10.0, null], $main['kwh']['values']);                              // angka utama tetap dari laporan realisasi, tidak tercampur belum realisasi
        $c = collect($d['companions']['series'])->keyBy('key');
        $this->assertSame(['kwh_penetapan', 'rp_penetapan', 'kwh_belum', 'rp_belum', 'jumlah_belum'], array_keys($c->all()));
        $this->assertEquals([null, null, null, null], $c['kwh_penetapan']['values']);                       // tanpa kontrol 309 seri penetapan kosong, belum realisasi tetap terisi
        $this->assertEquals([null, 35.0, 0.0, null], $c['kwh_belum']['values']);                            // Februari dan Mei tanpa laporan = null, April = 0
        $this->assertEquals([null, 350.0, 0.0, null], $c['rp_belum']['values']);
        $this->assertEquals(3.0, $c['jumlah_belum']['values'][1]);
        $this->assertSame([], $d['reconciliations'] ?? []);
        $this->assertStringContainsString('potret per tanggal tarik', $d['companions']['source']);
    }

    /** Kontrol 309 EIS satu ULP: komponen (label berindentasi, sumber, kWh, Rp); baris tanpa sumber adalah judul atau subtotal. */
    private function kontrol309(OrganizationalUnit $unit, string $period, array $rows): void
    {
        $lines = array_map(fn (array $r) => [trim($r[0]), array_filter(['sumber_laporan' => $r[1], 'jmlkwh' => $r[2], 'rpptl' => $r[3], 'indent' => strlen($r[0]) - strlen(ltrim($r[0])) ?: null], fn ($v) => $v !== null)], $rows);      // seperti parser: label dipangkas, indentasi disimpan
        $this->report($unit, '309EIS', $period, $lines);
    }

    #[Test]
    public function kwh_jual_dan_pendapatan_memuat_rincian_komponen_penjualan_dari_kontrol_309_yang_berjumlah_sama_dengan_309(): void
    {
        $this->report($this->ulpA, '309', '2026-03-01', [['JUMLAH', ['kwh_jumlah' => 1090, 'rp_jumlah' => 11900, 'pelanggan' => 10, 'daya_va' => 1000]]]);
        $this->report($this->ulpB, '309', '2026-03-01', [['JUMLAH', ['kwh_jumlah' => 500, 'rp_jumlah' => 5000, 'pelanggan' => 5, 'daya_va' => 500]]]);
        $this->kontrol309($this->ulpA, '2026-03-01', [['TUL III-07 (11)', 'T_307NEW', 1000, 10000], ['PENAMBAHAN', null, null, null], ['        Penetapan TS P2TL', 'PENETAPAN_P2TL', 100, 2000], ['                DP / Tunai P2TL', 'P2TL_TUNAI', 100, 2000],
            ['SUB TOTAL 1 ( + )', null, 1100, 12000], ['PENGURANGAN', null, null, null], ['        Pembatalan Rekening (MEMO4)', 'DKRPLAMA', 10, 100], ['SUB TOTAL 2 ( - )', null, 10, 100], ['RUMUS (SUBTOTAL 1-2)', null, 1090, 11900],
            ['CATATAN LPB', null, null, null], ['        PRA BAYAR (Pembelian Token PPOB)', 'PRABAYAR_PPOB', 5000, 50000]]);
        $this->kontrol309($this->ulpB, '2026-03-01', [['TUL III-07 (11)', 'T_307NEW', 500, 5000]]);

        $kwh = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $rows = collect($kwh['breakdown_secondary']['rows'])->pluck('value', 'key')->all();
        $this->assertSame('Komponen penjualan', $kwh['breakdown_secondary']['dimension']);
        $this->assertEquals(['TUL III-07 (11)' => 1500.0, 'Penetapan TS P2TL' => 100.0, 'Pembatalan Rekening (MEMO4)' => -10.0], $rows);      // rincian tunai dan catatan LPB tidak ikut; pengurangan bernilai negatif
        $this->assertEquals(1590.0, array_sum($rows));                                                                                         // sama dengan total kWh jual 309 (1090 + 500)
        $this->assertEquals(1590, collect($kwh['series'])->firstWhere('key', 'kwh')['values'][0]);
        $this->assertNull($kwh['matrix']);
        $this->assertSame('Kelompok tarif', $kwh['breakdown']['dimension']);                                                                   // rincian per kelompok tarif tetap ada

        $rp = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pendapatan?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $this->assertEquals(['TUL III-07 (11)' => 15000.0, 'Penetapan TS P2TL' => 2000.0, 'Pembatalan Rekening (MEMO4)' => -100.0], collect($rp['breakdown_secondary']['rows'])->pluck('value', 'key')->all());

        // bulan tanpa kontrol 309: metrik tetap jalan, tanpa rincian komponen
        $this->report($this->ulpA, '309', '2026-04-01', [['JUMLAH', ['kwh_jumlah' => 7, 'rp_jumlah' => 70, 'pelanggan' => 1, 'daya_va' => 1]]]);
        $april = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2026-03&to=2026-04")->assertOk()->json('data');
        $this->assertSame([], $april['breakdown_secondary']['rows']);
    }

    #[Test]
    public function kwh_p2tl_memuat_penetapan_ts_p2tl_dari_kontrol_309_di_samping_belum_realisasi(): void
    {
        $ts = fn (string $label, float $kwh, float $rp, int $n) => [$label, ['kwh' => $kwh, 'rp_total' => $rp, 'jumlah' => $n]];
        $this->report($this->ulpA, 'TAGSUS', '2026-03-01', [$ts('K2', 100, 1000, 2)]);
        $this->report($this->ulpA, 'TAGSUS', '2026-04-01', [$ts('K2', 10, 100, 1)]);
        $this->kontrol309($this->ulpA, '2026-03-01', [['TUL III-07 (11)', 'T_307NEW', 1000, 10000], ['PENAMBAHAN', null, null, null], ['        Penetapan TS P2TL', 'PENETAPAN_P2TL', 120, 2400], ['SUB TOTAL 2 ( - )', null, 0, 0]]);
        $this->report($this->ulpA, 'TAGSUS_BELUM', '2026-04-01', [$ts('K2', 4, 40, 1)]);                    // April: hanya belum realisasi, tanpa kontrol 309

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-p2tl?unit_id={$this->ulpA->id}&from=2026-03&to=2026-05")->assertOk()->json('data');

        $c = collect($d['companions']['series'])->keyBy('key');
        $this->assertSame(['kwh_penetapan', 'rp_penetapan', 'kwh_belum', 'rp_belum', 'jumlah_belum'], array_keys($c->all()));
        $this->assertEquals([120.0, null, null], $c['kwh_penetapan']['values']);                             // Maret ada kontrol 309; April dan Mei tidak
        $this->assertEquals([2400.0, null, null], $c['rp_penetapan']['values']);
        $this->assertEquals([null, 4.0, null], $c['kwh_belum']['values']);                                   // belum realisasi hanya April: tiap seri null sendiri-sendiri
        $this->assertEquals([100.0, 10.0, null], collect($d['series'])->firstWhere('key', 'kwh')['values']);  // angka utama tidak berubah
    }

    /** Laporan pelunasan PRR atau ex-PRR satu ULP: baris per BLTH (label), ringkasan berkas berisi pelanggan, transaksi, dan tanggal akhir rentang bayar. */
    private function pelunasan(OrganizationalUnit $unit, string $family, string $period, array $byBlth, array $summary): void
    {
        $this->report($unit, $family, $period, array_map(fn (string $blth, array $v) => [$blth, $v], array_keys($byBlth), $byBlth), $summary);
    }

    #[Test]
    public function pelunasan_prr_dan_ex_prr_menjumlahkan_komponen_dan_bulan_tagihan_antar_ulp_dengan_sesi_dan_peringatan_bulan_berjalan(): void
    {
        $current = now(config('distriva.business_timezone'))->format('Y-m');
        $today = (int) now(config('distriva.business_timezone'))->format('Ymd');
        $run = fn (array $reports) => DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'OK', 'kind' => 'AP2T', 'options' => json_encode(['dataset' => 'tagsus', 'reports' => $reports]), 'created_at' => now()]);
        $run(['pelunasan_prr']);
        $run(['realisasi']);
        $this->pelunasan($this->ulpA, 'PRR', '2026-03-01', ['202601' => ['rpptl' => 1000, 'rp_trafo' => 0, 'rp_sewakap' => 0, 'rp_tagsus' => 200, 'rp_bk' => 50, 'rp_prr' => 1250, 'pelanggan' => 3, 'transaksi' => 3],
            '202602' => ['rpptl' => 500, 'rp_bk' => 10, 'rp_prr' => 510, 'pelanggan' => 1, 'transaksi' => 1]], ['pelanggan' => 3, 'transaksi' => 4, 'sampai_tanggal' => 20260331]);
        $this->pelunasan($this->ulpB, 'PRR', '2026-03-01', ['202601' => ['rpptl' => 100, 'rp_prr' => 100, 'pelanggan' => 1, 'transaksi' => 1]], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);
        foreach (['2026-01-01', '2026-02-01'] as $quiet) {
            $this->pelunasan($this->ulpA, 'PRR', $quiet, [], ['pelanggan' => 0, 'transaksi' => 0, 'sampai_tanggal' => 20260131]);      // Januari dan Februari tanpa pelunasan: kumulatif tetap dapat dihitung
        }
        $this->pelunasan($this->ulpA, 'PRR', '2026-04-01', [], ['pelanggan' => 0, 'transaksi' => 0, 'sampai_tanggal' => 20260430]);                      // April: tidak ada pelunasan = nol
        $this->pelunasan($this->ulpA, 'PRR', $current.'-01', ['202610' => ['rpptl' => 70, 'rp_prr' => 70, 'pelanggan' => 1, 'transaksi' => 1]], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => $today]);
        $this->pelunasan($this->ulpA, 'EXPRR', '2026-03-01', ['202512' => ['rpptl' => 40, 'rp_prr' => 40, 'pelanggan' => 1, 'transaksi' => 1]], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->up3);

        $d = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2026-03&to=2026-04")->assertOk()->json('data');

        $s = collect($d['series'])->keyBy('key');
        $this->assertSame('up', $d['metric']['polarity']);
        $this->assertEquals([1860.0, 0.0], $s['rp']['values']);                                              // Maret 1250 + 510 + 100; April tanpa pelunasan = 0
        $this->assertEquals([4.0, 0.0], $s['pelanggan']['values']);                                           // 3 + 1 pelanggan (ULP berbeda)
        $this->assertEquals([5.0, 0.0], $s['transaksi']['values']);
        $this->assertEquals(1860.0, collect($d['summary'])->firstWhere('key', 'rp')['ytd']);                  // kumulatif = jumlah bulanan
        $march = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $this->assertSame('Komponen pelunasan', $march['breakdown']['dimension']);
        $this->assertEquals(['Pemakaian listrik (RPPTL)' => 1600.0, 'Tagihan susulan (TS)' => 200.0, 'Biaya keterlambatan (BK)' => 60.0], collect($march['breakdown']['rows'])->pluck('value', 'key')->all());
        $this->assertSame('Bulan tagihan (BLTH)', $march['breakdown_secondary']['dimension']);
        $this->assertEquals(['2026-01' => 1350.0, '2026-02' => 510.0], collect($march['breakdown_secondary']['rows'])->pluck('value', 'key')->all());
        $this->assertNull($march['matrix']);

        $ex = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelunasan-ex-prr?unit_id={$this->ulpA->id}&from=2026-03&to=2026-03")->assertOk()->json('data');
        $this->assertEquals([40.0], collect($ex['series'])->firstWhere('key', 'rp')['values']);

        $h = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelunasan-prr/history?unit_id={$this->up3->id}&year=2026")->assertOk()->json('data');
        $this->assertSame('PRR', $h['family']);
        $this->assertCount(1, $h['syncs']);                                                                    // hanya penarikan yang memuat laporan PRR
        $partial = $this->as($admin)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2026-03&to={$current}")->assertOk()->json('data.warnings');
        $this->assertSame(['ap2t_current_month_partial'], array_column($partial, 'code'));
        $this->assertSame([$current, 1], [$partial[0]['month'], $partial[0]['units_reporting']]);
        $this->assertStringContainsString('pelunasan PRR', $partial[0]['message']);
        $this->assertSame([], $d['warnings']);                                                                 // rentang berhenti sebelum bulan berjalan
        foreach (['pelunasan-prr', 'pelunasan-ex-prr'] as $code) {                                           // prakiraan dan unduhan Excel generik tidak error untuk metrik baru
            $this->as($admin)->getJson("/api/pengusahaan/metrics/{$code}/forecast?unit_id={$this->up3->id}")->assertOk();
            $this->as($admin)->get("/api/pengusahaan/metrics/{$code}/export?unit_id={$this->up3->id}")->assertOk();
        }
    }

    #[Test]
    public function kartu_target_memakai_target_realisasi_dan_rumus_pencapaian_nko_serta_menghitung_sisa_per_bulan(): void
    {
        $this->up3->forceFill(['name' => 'UP3 Mojokerto'])->save();
        app(NkoDefinitionImportService::class)->import($this->workbook(['UP3 MOJOKERTO', 'ULP A']), 'nko.xlsx');     // SAIDI (polaritas 1) target kumulatif Jan 3,7 Feb 7,0; penjualan (polaritas 3) Jan 2,5 Feb 5,1; aturan pencapaian workbook uji hanya untuk Januari
        $saidi = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('d.code', 'saidi')->where('s.unit_level', 'ULP')->value('d.id');
        DB::table('kpi_targets')->insert(['definition_id' => $saidi, 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-12-01', 'target_value' => 40.0]);
        DB::table('kpi_manual_inputs')->insert(['id' => (string) Str::uuid(), 'definition_code' => 'saidi', 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-01-01', 'value' => 4.07, 'note' => 'Uji', 'created_at' => now(), 'updated_at' => now()]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2025-12&to=2026-01")->assertOk()->json('data');

        $this->assertCount(1, $d['targets']);                                                                  // SAIFI belum punya definisi pada workbook uji
        $t = $d['targets'][0];
        $this->assertSame(['saidi', 'saidi', 'down', '2026-01', 'MANUAL', 'tertinggal'], [$t['definition_code'], $t['series_key'], $t['polarity'], $t['month'], $t['realisasi_source'], $t['status']]);
        $this->assertEqualsWithDelta(3.7, $t['target'], 1e-9);
        $this->assertEqualsWithDelta(4.07, $t['realisasi'], 1e-9);
        $this->assertEqualsWithDelta(90.0, $t['pencapaian_pct'], 1e-6);                                       // rumus NKO polaritas 1: (2 - 4,07/3,7) x 100
        $this->assertEqualsWithDelta((40 - 4.07) / 11, $t['remaining_per_month'], 1e-9);                      // sisa anggaran per bulan sampai Desember
        $this->assertEqualsWithDelta(4.07, $t['current_per_month'], 1e-9);
        $this->assertSame('kritis', $d['diagnosis'][0]['level']);
        $this->assertStringContainsString('pencapaian 90,00%', $d['diagnosis'][0]['text']);
        $this->assertStringContainsString('Sisa anggaran sampai akhir tahun rata-rata 3,27 per bulan', $d['diagnosis'][0]['text']);

        // target ada tetapi realisasi belum tersedia
        $kwh = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2025-12&to=2026-01")->assertOk()->json('data');
        $this->assertSame('penjualan-tenaga-listrik', $kwh['targets'][0]['definition_code']);
        $this->assertNull($kwh['targets'][0]['pencapaian_pct']);
        $this->assertStringContainsString('realisasi belum tersedia', $kwh['diagnosis'][0]['text']);
        // metrik tanpa indikator NKO
        $this->assertSame([], $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar-umur?unit_id={$this->ulpA->id}&from=2026-01&to=2026-02")->assertOk()->json('data.targets'));
    }

    #[Test]
    public function sumbangan_ulp_memecah_perubahan_up3_dan_diagnosis_menyebut_penyumbang_terbesar(): void
    {
        foreach ([[$this->ulpA, '2025-03-01', 100], [$this->ulpA, '2026-02-01', 150], [$this->ulpA, '2026-03-01', 160], [$this->ulpB, '2025-03-01', 50], [$this->ulpB, '2026-02-01', 45], [$this->ulpB, '2026-03-01', 40]] as [$unit, $period, $kwh]) {
            $this->sales($unit, $period, $kwh, 0);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}&from=2026-02&to=2026-03")->assertOk()->json('data');

        $yoy = $d['contribution']['bases']['yoy'];
        $this->assertSame(['kwh', '2025-03', 2], [$d['contribution']['series_key'], $yoy['from'], $yoy['units_compared']]);
        $this->assertEqualsWithDelta(50.0, $yoy['total'], 1e-9);                                               // (160 - 100) + (40 - 50)
        $this->assertSame(['ULP A', 'ULP B'], array_column($yoy['units'], 'unit_name'));                       // urut sumbangan terbesar (nilai mutlak)
        $this->assertEqualsWithDelta(120.0, $yoy['units'][0]['share_pct'], 1e-9);
        $this->assertEqualsWithDelta(-20.0, $yoy['units'][1]['share_pct'], 1e-9);
        $this->assertEqualsWithDelta(5.0, $d['contribution']['bases']['mom']['total'], 1e-9);                 // (160 - 150) + (40 - 45)
        $text = collect($d['diagnosis'])->firstWhere('kind', 'contribution')['text'];
        $this->assertStringContainsString('berubah +50,00 kWh (2 ULP setara); penyumbang terbesar ULP A (+60,00, 120% dari perubahan)', $text);

        // seri utama berupa rata-rata atau rasio tidak dipecah per ULP
        $this->assertNull($this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-keluhan?unit_id={$this->up3->id}&from=2026-02&to=2026-03")->assertOk()->json('data.contribution'));
        // satu ULP: tidak ada sumbangan
        $this->assertNull($this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2026-02&to=2026-03")->assertOk()->json('data.contribution'));
    }

    #[Test]
    public function diagnosis_menandai_angka_bulan_terakhir_yang_jauh_dari_kebiasaan_unitnya(): void
    {
        for ($i = 24; $i >= 1; $i--) {
            $this->sales($this->ulpA, date('Y-m-01', strtotime("2026-03-01 -{$i} month")), 100 + $i % 3, 0);   // 24 bulan stabil sekitar 100-102
        }
        $this->sales($this->ulpA, '2026-03-01', 300, 0);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2025-04&to=2026-03")->assertOk()->json('data');

        $anomaly = collect($d['diagnosis'])->firstWhere('kind', 'anomaly');
        $this->assertSame('perhatian', $anomaly['level']);
        $this->assertStringContainsString('kwh jual Maret 2026 = 300 kWh, jauh di atas kebiasaan 24 bulan terakhir (median 101', $anomaly['text']);
        $this->assertLessThanOrEqual(3, count($d['diagnosis']));
    }

    #[Test]
    public function diagnosis_menandai_satu_bulan_yang_menyumbang_separuh_atau_lebih_kumulatif_tahun_berjalan(): void
    {
        foreach ([10, 11, 9, 10, 12, 250] as $i => $kwh) {
            $this->sales($this->ulpA, sprintf('2026-%02d-01', $i + 1), $kwh, 0);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2026-01&to=2026-06")->assertOk()->json('data');

        $dominance = collect($d['diagnosis'])->firstWhere('kind', 'dominance');
        $this->assertSame('perhatian', $dominance['level']);
        $this->assertStringContainsString('Juni 2026 menyumbang 82,78% dari kumulatif 2026 (250 dari 302 kWh)', $dominance['text']);

        // sebaran wajar: tidak ada penanda
        foreach ([10, 11, 9, 10, 12, 13] as $i => $kwh) {
            DB::table('eis_report_files')->where('organizational_unit_id', $this->ulpA->id)->where('period', sprintf('2026-%02d-01', $i + 1))->delete();
            $this->sales($this->ulpA, sprintf('2026-%02d-01', $i + 1), $kwh, 0);
        }
        $this->assertNull(collect($this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2026-01&to=2026-06")->assertOk()->json('data.diagnosis'))->firstWhere('kind', 'dominance'));
    }

    #[Test]
    public function cadangan_realisasi_dari_metrik_menandai_sumbernya_dan_nko_tetap_diutamakan(): void
    {
        $this->up3->forceFill(['name' => 'UP3 Mojokerto'])->save();
        app(NkoDefinitionImportService::class)->import($this->workbook(['UP3 MOJOKERTO', 'ULP A']), 'nko.xlsx');
        $report = fn (string $period, float $saidiMenit) => $this->report($this->ulpA, 'DIFI', $period, [['TOTAL KELOMPOK Distribusi', ['jumlah_gangguan' => 1]]], ['saidi_menit' => $saidiMenit, 'saidi_jam' => $saidiMenit / 60, 'saifi_kali' => 0.1, 'pelanggan' => 1000]);
        $report('2026-01-01', 4.07);

        $t = collect($this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2025-12&to=2026-01")->assertOk()->json('data.targets'))->firstWhere('definition_code', 'saidi');

        $this->assertSame('SISTEM', $t['realisasi_source']);                                                   // NKO punya realisasi sistem: dipakai, bukan cadangan
        $up3 = collect($this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->up3->id}&from=2025-12&to=2026-01")->assertOk()->json('data'));
        $this->assertSame('METRIK', $up3['targets'][0]['realisasi_source']);                                    // UP3 belum punya perhitungan NKO: cadangan dari data menu
        $this->assertNull($up3['targets'][0]['validated']);
        $this->assertStringContainsString('Realisasi diambil dari data menu ini', $up3['diagnosis'][0]['text']);
    }

    #[Test]
    public function saidi_dan_saifi_sesuai_kewenangan_hanya_kelompok_distribusi_pembangkit_dan_transmisi_tidak_ikut(): void
    {
        $row = fn (float $jxp, int $plg) => ['jumlah_gangguan' => 1, 'jml_plg_padam' => $plg, 'jam_x_plg' => $jxp, 'kwh_tak_tersalurkan' => 10];
        // Juni 2026 seperti ULP Jombang: Distribusi 1,9 menit; padam terencana pembangkit memadamkan hampir semua pelanggan sehingga total laporan 183,8 menit
        $this->report($this->ulpA, 'DIFI', '2026-06-01', [['TOTAL KELOMPOK Distribusi', $row(6000, 3000)], ['TOTAL KELOMPOK Pembangkit', $row(580000, 188000)], ['TOTAL KESELURUHAN', $row(586000, 191000)]],
            ['pelanggan' => 190000, 'saidi_menit' => 185.05, 'saifi_kali' => 1.005, 'saidi_jam' => 3.0842]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-06&to=2026-06")->assertOk()->json('data');
        $s = collect($d['series'])->keyBy('key');
        $this->assertEqualsWithDelta(6000 * 60 / 190000, $s['saidi']['values'][0], 1e-9);                      // 1,89 menit/plg
        $this->assertEqualsWithDelta(3000 / 190000, $s['saifi']['values'][0], 1e-9);

        $this->report($this->ulpA, 'DIFI', '2026-01-01', [['TOTAL KELOMPOK Distribusi', $row(3800, 1900)], ['TOTAL KESELURUHAN', $row(3800, 1900)]], ['pelanggan' => 190000, 'saidi_menit' => 1.2, 'saifi_kali' => 0.01]);
        $nko = app(NkoRealizationResolver::class)->systemValues($this->ulpA->id, 2026, 1);
        $this->assertEqualsWithDelta(3800 * 60 / 190000, $nko['saidi'], 1e-9);                                  // NKO memakai angka yang sama: kelompok Distribusi
        $this->assertEqualsWithDelta(1900 / 190000, $nko['saifi'], 1e-9);

        // laporan tanpa jam x pelanggan pada baris Distribusi (tata letak lama) memakai ringkasan total sebagai cadangan
        $this->report($this->ulpB, 'DIFI', '2026-01-01', [['TOTAL KELOMPOK Distribusi', ['jumlah_gangguan' => 1, 'kwh_tak_tersalurkan' => 10]]], ['pelanggan' => 1000, 'saidi_menit' => 7.5, 'saifi_kali' => 0.2]);
        $this->assertEqualsWithDelta(7.5, app(NkoRealizationResolver::class)->systemValues($this->ulpB->id, 2026, 1)['saidi'], 1e-9);
    }

    #[Test]
    public function peran_ulp_hanya_melihat_ulp_sendiri(): void
    {
        $this->sales($this->ulpB, '2026-01-01', 1, 1);

        $units = $this->as($this->viewer)->getJson('/api/pengusahaan/metrics')->assertOk()->json('data.units');
        $this->assertSame([$this->ulpA->id], array_column($units, 'id'));
        $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpB->id}")->assertNotFound();
        $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}")->assertNotFound();
        $this->as($this->planner)->getJson("/api/pengusahaan/metrics/tidak-ada?unit_id={$this->up3->id}")->assertNotFound();
        $this->assertCount(3, $this->as($this->planner)->getJson('/api/pengusahaan/metrics')->json('data.units'));
    }

    #[Test]
    public function susut_dari_masukan_bulanan_kwh_beli_dan_kwh_jual_309_bulanan_dan_kumulatif(): void
    {
        $this->sales($this->ulpA, '2026-01-01', 900, 0);
        $this->sales($this->ulpA, '2026-02-01', 950, 0);
        $put = fn (array $items) => $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => $items]);
        $put([['period' => '2026-01', 'code' => 'kwh-beli', 'value' => 1000], ['period' => '2026-01', 'code' => 'e-min', 'value' => 20], ['period' => '2026-01', 'code' => 'pssd', 'value' => 30],
            ['period' => '2026-02', 'code' => 'kwh-beli', 'value' => 1000]])->assertOk()->assertJsonPath('changed', 4);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-01&to=2026-02")->assertOk()->json('data');
        $this->assertEqualsWithDelta(50 / 950 * 100, $d['series'][0]['values'][0], 1e-9);   // (1000 - 20 - 30 - 900) / 950
        $this->assertEqualsWithDelta(5.0, $d['series'][0]['values'][1], 1e-9);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $d['summary'][0]['ytd'], 1e-9);   // kumulatif = jumlah susut / jumlah beli bersih

        $nko = app(NkoRealizationResolver::class)->systemValues($this->ulpA->id, 2026, 2);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $nko['susut-distribusi-tanpa-e-min'], 1e-9);   // NKO memakai masukan bulanan yang sama

        $grid = $this->as($this->planner)->getJson("/api/pengusahaan/inputs?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data');
        $this->assertEquals(1000, $grid['months'][0]['inputs']['kwh-beli']['value']);
        $this->assertNull($grid['months'][2]['inputs']['kwh-beli']);
        $this->assertEqualsWithDelta(100 / 1950 * 100, $grid['months'][1]['susut_kumulatif_pct'], 1e-9);
        $this->assertTrue($grid['can_edit']);

        $put([['period' => '2026-02', 'code' => 'kwh-beli', 'value' => 1000]])->assertOk()->assertJsonPath('changed', 0);
        $put([['period' => '2026-02', 'code' => 'kwh-beli', 'value' => null]])->assertOk()->assertJsonPath('changed', 1);
        $this->assertNull($this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-02&to=2026-02")->json('data.series.0.values.0'));
    }

    #[Test]
    public function masukan_bulanan_hanya_untuk_pengisi_berwenang_pada_ulp(): void
    {
        $item = [['period' => '2026-01', 'code' => 'kwh-beli', 'value' => 1]];
        $this->as($this->viewer)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => $item])->assertForbidden();
        $this->assertFalse($this->as($this->viewer)->getJson("/api/pengusahaan/inputs?unit_id={$this->ulpA->id}&year=2026")->assertOk()->json('data.can_edit'));
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->up3->id, 'items' => $item])->assertNotFound();   // masukan hanya per ULP
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => [['period' => '2026-01', 'code' => 'kwh-jual', 'value' => 1]]])->assertStatus(422);
        $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => [['period' => '2026-01', 'code' => 'kwh-beli', 'value' => -5]]])->assertStatus(422);
    }

    #[Test]
    public function templat_excel_diisi_lalu_diimpor_dan_ditolak_seluruhnya_bila_ada_baris_salah(): void
    {
        $other = $this->makeUnit('UP3');
        $foreign = $this->makeUnit('ULP', $other);
        $download = $this->as($this->planner)->get("/api/pengusahaan/inputs/template?year=2026&unit_id={$this->up3->id}")->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'kb').'.xlsx';
        file_put_contents($path, $download->streamedContent());
        $book = IOFactory::load($path);
        $ws = $book->getActiveSheet();
        $this->assertSame(['KODE ULP', 'NAMA ULP', 'BULAN', 'KWH BELI', 'PSSD', 'E-MIN', 'CATATAN'], $ws->rangeToArray('A1:G1')[0]);
        $this->assertSame(25, $ws->getHighestRow());   // 2 ULP x 12 bulan + judul
        $ws->setCellValue('D2', 1000);   // baris ULP pertama, Januari 2026
        $ws->setCellValue('E2', 30);
        $ws->setCellValueExplicit('D3', '1.200.000,5', 's');   // teks format Indonesia
        (new Xlsx($book))->save($path);
        $upload = fn () => new UploadedFile($path, 'kwh.xlsx', null, null, true);

        $r = $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertOk()->json('data');
        $this->assertSame(['rows' => 3, 'changed' => 3, 'unchanged' => 0], $r);
        $first = $ws->getCell('A2')->getValue();
        $unitId = DB::table('organizational_units')->where('code', $first)->value('id');
        $this->assertEquals(1000, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-01-01'])->value('value'));
        $this->assertEquals(1200000.5, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-02-01'])->value('value'));
        $this->assertEquals(30, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'pssd', 'period' => '2026-01-01'])->value('value'));
        $this->assertSame(0, $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->json('data.changed'));

        $ws->setCellValue('D2', 5000);
        $ws->setCellValueExplicit('A26', (string) $foreign->code, 's');
        $ws->setCellValue('C26', '2026-01');
        $ws->setCellValue('D26', 10);
        (new Xlsx($book))->save($path);
        $this->as($this->planner)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertStatus(422)->assertJsonFragment(['message' => "Impor dibatalkan, perbaiki baris berikut: Baris 26: {$foreign->name} di luar kewenangan Anda."]);
        $this->assertEquals(1000, DB::table('business_monthly_inputs')->where(['organizational_unit_id' => $unitId, 'code' => 'kwh-beli', 'period' => '2026-01-01'])->value('value'));   // tidak ada yang tersimpan

        $this->as($this->viewer)->post('/api/pengusahaan/inputs/import', ['file' => $upload()])->assertForbidden();
        $this->as($this->viewer)->get('/api/pengusahaan/inputs/template?year=2026')->assertForbidden();
    }

    #[Test]
    public function tunggakan_pascabayar_per_umur_dan_kogol_dengan_matriks(): void
    {
        $row = fn (int $lembar, int $kogol, int $plg, float $rp) => [(string) $lembar, ['label' => $lembar, 'kogol' => (string) $kogol, 'plg' => $plg, 'lbr' => $lembar * $plg, 'gabungan' => $rp]];
        $this->report($this->ulpA, 'UMURPIUTANG', '2026-10-01', [$row(1, 0, 9, 200), $row(2, 0, 5, 100), $row(7, 1, 2, 600), $row(15, 2, 1, 100)]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar-umur?unit_id={$this->ulpA->id}&from=2026-10&to=2026-10")->assertOk()->json('data');

        $s = collect($d['summary'])->keyBy('key');
        $this->assertEquals(1000, $s['rp']['latest']);
        $this->assertEquals(17, $s['pelanggan']['latest']);
        $this->assertEqualsWithDelta((9 + 10 + 14 + 15) / 17, $s['umur_rata']['latest'], 1e-9);   // lembar per pelanggan
        $this->assertEqualsWithDelta(70.0, $s['lebih_3_bulan']['latest'], 1e-9);
        $this->assertSame(['1 bulan', '2 bulan', '3 bulan', '4-6 bulan', '7-12 bulan', '> 12 bulan'], array_column($d['breakdown']['rows'], 'key'));   // urutan umur tetap
        $this->assertEquals([200, 100, 0, 0, 600, 100], array_column($d['breakdown']['rows'], 'value'));
        $this->assertSame(['Kogol 0', 'Kogol 1', 'Kogol 2'], $d['matrix']['rows']);
        $this->assertEquals([0, 0, 0, 0, 600, 0], $d['matrix']['values'][1]);
        $this->assertContains('Porsi terbesar umur tunggakan: 7-12 bulan (60.0%).', array_column($d['insights'], 'text'));
    }
}
