<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Analytics\CustomerInsights;
use App\Services\Analytics\NontechnicalLoss;
use App\Services\Analytics\TechnicalLossProxy;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoRealizationResolver;
use Carbon\CarbonImmutable;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
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
    public function detail_rpt_rct_membandingkan_ulp_pada_volume_sebanding_dan_mengukur_hubungan_volume_dengan_waktu_tanggap(): void
    {
        $rows = [];
        foreach (range(0, 7) as $i) {
            $m = date('Y-m-01', strtotime("2026-01-01 +{$i} month"));
            $n = 100 + 20 * $i;                                                                                // ULP A: volume naik, RPT rata-rata ikut naik (20 + i menit)
            $rows[] = $this->apktRow($this->ulpA, $m, true, $n * (20 + $i), $n, $n * 40);
            $rows[] = $this->apktRow($this->ulpA, $m, false, $n / 4 * (20 + $i), $n / 4, $n / 4 * 40);
            $rows[] = $this->apktRow($this->ulpB, $m, true, 120 * 15, 120, 120 * 30);                           // ULP B: volume dan RPT datar (15 menit)
            $rows[] = $this->apktRow($this->ulpB, $m, false, 30 * 15, 30, 30 * 30);
        }
        DB::table('apkt_rpt_rct_records')->insert($rows);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from=2026-01&to=2026-08")->assertOk()->json('data.detail');

        $this->assertSame(['response', 'menit', '2026-08', false, 'tanpa_clear_temper'], [$d['kind'], $d['unit'], $d['month'], $d['partial'], $d['basis']]);
        $a = collect($d['ulps'])->firstWhere('unit_id', $this->ulpA->id);
        $b = collect($d['ulps'])->firstWhere('unit_id', $this->ulpB->id);
        $this->assertEquals([240, 27.0, 60, 27.0], [$a['wo'], $a['rpt'], $a['wo_nct'], $a['rpt_nct']]);
        $this->assertEquals(75.0, $a['clear_temper_share_pct']);                                                // 180 dari 240 WO adalah clear temper
        $this->assertSame($this->ulpB->id, $d['ulps'][0]['unit_id']);                                          // tercepat dahulu
        $this->assertEquals([1, 2, 1, 1], [$b['rpt_rank'], $a['rpt_rank'], $a['peer_count'], $b['peer_count']]);
        $this->assertEquals([12.0, -12.0], [$a['rpt_gap_to_peer_best'], $b['rpt_gap_to_peer_best']]);               // RPT tanpa clear temper A 27 lawan B 15
        $this->assertCount(8, $d['history']);
        $this->assertEquals(1.0, $d['volume_effect']['rpt_correlation']);                                      // dalam-ULP: volume dan RPT A naik bersama
        $this->assertSame(1, $d['volume_effect']['ulps'] - 1);                                                  // B datar tidak menambah variasi tetapi ikut dihitung
        $this->assertStringContainsString('memburuk', $d['volume_effect']['reading']);

        // keluhan memakai jam dan tanpa kolom clear temper; menu non-RPT-RCT tanpa blok ini
        DB::table('apkt_rpt_rct_keluhan_records')->insert(['id' => (string) Str::uuid(), 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-08-01', 'rpt_total' => 20, 'rpt_count' => 10, 'rct_total' => 50, 'rct_count' => 10,
            'sync_run_id' => null, 'created_at' => now(), 'updated_at' => now()]);
        $k = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-keluhan?unit_id={$this->up3->id}&from=2026-08&to=2026-08")->assertOk()->json('data.detail');
        $this->assertEquals(['jam', 'semua', 2.0, 5.0], [$k['unit'], $k['basis'], $k['ulps'][0]['rpt'], $k['ulps'][0]['rct']]);
        $this->assertArrayNotHasKey('wo_nct', $k['ulps'][0]);
        $this->assertFalse($k['volume_effect']['available']);
    }

    #[Test]
    public function detail_anomali_menandai_ulp_dengan_kejadian_jarang_melebihi_porsi_wo_dan_merangkum_kanal(): void
    {
        $rows = [];
        foreach (['2026-01-01', '2026-02-01', '2026-03-01'] as $i => $m) {
            $rows[] = $this->anomaliGangguanRow($this->ulpA, $m, 'BERULANG', [300, 600, 0, 100, 1000, $i === 0 ? 1 : 0, 0, 0, 0, $i === 0 ? 1 : 0, 0]);
            $rows[] = $this->anomaliGangguanRow($this->ulpA, $m, 'NEGATIF', [300, 600, 0, 100, 1000, 3, 4, 0, 0, 3, 4]);          // ULP A: tujuh rating negatif per bulan (21)
            $rows[] = $this->anomaliGangguanRow($this->ulpB, $m, 'BERULANG', [300, 600, 0, 100, 1000, 0, 0, 0, 0, 0, 0]);
            $rows[] = $this->anomaliGangguanRow($this->ulpB, $m, 'NEGATIF', [300, 600, 0, 100, 1000, $i === 2 ? 1 : 0, $i === 2 ? 1 : 0, 0, 0, $i === 2 ? 1 : 0, $i === 2 ? 1 : 0]);   // ULP B: dua (2)
        }
        DB::table('apkt_anomali_gangguan_records')->insert($rows);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/anomali-gangguan?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');

        $this->assertSame(['anomaly', 'anomali-gangguan', 2026], [$d['kind'], $d['focus'], $d['year']]);
        $this->assertEquals([6000, 1, 23], [$d['ytd']['wo'], $d['ytd']['berulang'], $d['ytd']['negatif']]);
        $this->assertEqualsWithDelta(23 / 6000 * 10000, $d['ytd']['rate_per_10k_negatif'], 0.01);
        $a = collect($d['ulps'])->firstWhere('unit_id', $this->ulpA->id);
        $b = collect($d['ulps'])->firstWhere('unit_id', $this->ulpB->id);
        $this->assertSame($this->ulpA->id, $d['ulps'][0]['unit_id']);                                          // terbanyak dahulu
        $this->assertEquals([21, 11.5, true, 12], [$a['negatif'], $a['negatif_expected'], $a['negatif_flagged'], $a['negatif_nonmarking']]);
        $this->assertEquals([2, false, false], [$b['negatif'], $b['negatif_flagged'], $a['berulang_flagged']]);  // berulang hanya satu kejadian: di bawah minimum
        $this->assertEquals(50.0, $a['wo_share_pct']);
        $channel = collect($d['channels'])->first(fn ($c) => $c['kind'] === 'negatif' && $c['channel'] === 'PLN Mobile · Non Marking');
        $this->assertSame(13, $channel['count']);                                                              // 4 x 3 bulan (A) + 1 (B)
        $this->assertCount(3, $d['history']);
        $this->assertEquals([2000, 1, 23], [$d['history'][2]['wo'], $d['history'][0]['berulang'] + $d['history'][1]['berulang'] + $d['history'][2]['berulang'], array_sum(array_column($d['history'], 'negatif'))]);

        // keluhan: tanpa kolom NKO tanpa marking; menu non-anomali tanpa blok ini
        $this->assertSame('anomaly', $this->as($this->planner)->getJson("/api/pengusahaan/metrics/anomali-keluhan?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail.kind'));
    }

    #[Test]
    public function detail_p2tl_memuat_corong_tingkat_realisasi_per_ulp_dan_perkiraan_dari_penetapan_dengan_uji_mundur(): void
    {
        $ts = fn (string $label, float $kwh, int $n) => [$label, ['kwh' => $kwh, 'rp_total' => $kwh * 1000, 'jumlah' => $n]];
        $pen = fn (float $kwh) => [['Penetapan P2TL', 'PENETAPAN_P2TL', $kwh, $kwh * 1000]];
        foreach (range(0, 5) as $i) {
            $m = date('Y-m-01', strtotime("2026-01-01 +{$i} month"));
            $penA = 1000 + 200 * $i;                                                                           // ULP A: realisasi 90% penetapan; ULP B: 80% (Juni hanya 600 dari 1.000)
            $penB = 500 + 100 * $i;
            $this->kontrol309($this->ulpA, $m, $pen($penA));
            $this->kontrol309($this->ulpB, $m, $pen($penB));
            $this->report($this->ulpA, 'TAGSUS', $m, [$ts('K2', $penA * 0.9, 2)]);
            $this->report($this->ulpB, 'TAGSUS', $m, [$ts('P3', $i === 5 ? 600 : $penB * 0.8, 1)]);
        }
        $this->report($this->ulpA, 'TAGSUS_BELUM', '2026-06-01', [$ts('K2', 50, 1)]);
        // definisi penetapan lama (sebelum 2026): jauh lebih kecil dari realisasi, tidak boleh masuk rasio
        $this->kontrol309($this->ulpA, '2025-12-01', $pen(10));
        $this->report($this->ulpA, 'TAGSUS', '2025-12-01', [$ts('K2', 900, 2)]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-p2tl?unit_id={$this->up3->id}&from=2026-01&to=2026-06")->assertOk()->json('data.detail');

        $this->assertSame(['p2tl', 2026], [$d['kind'], $d['year']]);
        $jun = collect($d['funnel'])->firstWhere('month', '2026-06');
        $this->assertEquals([3000, 2400, 50, 0.8], [$jun['penetapan_kwh'], $jun['realisasi_kwh'], $jun['belum_kwh'], $jun['ratio']]);
        $this->assertTrue($jun['ratio_consistent']);
        $this->assertFalse(collect($d['funnel'])->firstWhere('month', '2025-12')['ratio_consistent']);          // rasio 90 kali: definisi lama

        $p = $d['projection'];
        $this->assertTrue($p['available']);
        $this->assertEqualsWithDelta(9100 / 10500, $p['ratio'], 0.001);              // rasio kumulatif Januari sampai Mei
        $this->assertEquals([2600, 2400], [$p['expected_realisasi_kwh'], $p['actual_realisasi_kwh']]);
        $this->assertEqualsWithDelta(92.3, $p['achieved_pct'], 0.05);
        $this->assertEquals([2, 0.0], [$p['backtest']['months'], $p['backtest']['model_mape_pct']]);               // rasio tetap: model tepat; cara naif meleset
        $this->assertGreaterThan(0, $p['backtest']['naive_mape_pct']);
        $this->assertFalse($p['reliable']);                                                                      // riwayat uji kurang dari enam bulan
        $this->assertNotNull($p['reliability_note']);

        $rows = collect($d['ulps']['rows']);
        $a = $rows->firstWhere('unit_id', $this->ulpA->id);
        $b = $rows->firstWhere('unit_id', $this->ulpB->id);
        $this->assertEquals([8100, 90.0, 12, 50.0], [$a['realisasi_kwh'], $a['realisasi_rate_pct'], $a['cases'], $a['belum_kwh']]);   // 2025 tidak ikut
        $this->assertEquals([75.6, 1000], [$b['realisasi_rate_pct'], $b['rp_per_kwh']]);
        $this->assertSame($this->ulpA->id, $d['ulps']['rows'][0]['unit_id']);
        $this->assertSame(['K2', 'P3'], array_column($d['violations'], 'key'));
    }

    /** Permohonan biaya penyambungan: lunas sehari setelah dibuat bila $paid, selain itu belum lunas dengan status $status. */
    private function fee(OrganizationalUnit $ulp, string $type, float $cost, string $created, bool $paid = true, string $status = 'CONNECTION_DONE'): void
    {
        $this->connected($ulp, $type, 1, '2020-01-01');                                                         // memastikan templat permohonan ada; baris ini tidak lunas sehingga tidak terhitung
        $id = DB::table('applications')->orderByDesc('created_at')->orderByDesc('id')->where('source_created_at', '2020-01-01 08:00:00')->value('id');
        DB::table('applications')->where('id', $id)->update(['application_type' => $type, 'total_cost' => $cost, 'source_created_at' => $created.' 08:00:00', 'current_status' => $status,
            'paid_at' => $paid ? date('Y-m-d 09:00:00', strtotime($created.' +1 day')) : null]);
    }

    #[Test]
    public function detail_hpl_bp_memisahkan_kasus_besar_mengukur_lama_bayar_antrean_dan_menguji_prakiraan(): void
    {
        foreach (range(0, 7) as $i) {
            $month = date('Y-m', strtotime("2026-01-01 +{$i} month"));
            foreach (range(1, 10) as $k) {
                $this->fee($this->ulpA, $k <= 6 ? 'PB' : 'PD', 1_000_000, "{$month}-1".($k % 9));                  // sepuluh kasus standar Rp 1 juta
            }
            $this->fee($this->ulpA, 'PD', (20 + 10 * $i) * 1_000_000, "{$month}-05");                           // satu kasus besar: 20 juta naik 10 juta per bulan
        }
        foreach ([1, 2, 3] as $k) {
            $this->fee($this->ulpB, 'PB', 2_000_000, "2026-08-2{$k}");
        }
        $this->fee($this->ulpA, 'PB', 5_000_000, now()->subDays(3)->toDateString(), false, 'APPROVED');          // antrean: 0-7 hari
        $this->fee($this->ulpA, 'PB', 2_000_000, now()->subDays(20)->toDateString(), false, 'APPROVED');         // 8-30 hari
        $this->fee($this->ulpA, 'PD', 1_000_000, now()->subDays(100)->toDateString(), false, 'APPROVED');        // kedaluwarsa
        $this->fee($this->ulpA, 'PD', 1_000_000, now()->subDays(200)->toDateString(), false, 'APPROVED');
        $this->fee($this->ulpA, 'PB', 9_000_000, '2026-08-10', true, 'CANCELLED');                              // batal: tidak terhitung

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/hpl-bp?unit_id={$this->up3->id}&from=2026-01&to=2026-08")->assertOk()->json('data.detail');

        $this->assertSame(['connection_fee', 20_000_000], [$d['kind'], $d['big_case_rp']]);
        $aug = collect($d['history'])->firstWhere('month', '2026-08');
        $this->assertEquals([14, 106_000_000, 16_000_000, 90_000_000, 1], [$aug['n'], $aug['rp'], $aug['rp_standard'], $aug['rp_big'], $aug['n_big']]);
        $this->assertEqualsWithDelta(90 / 106 * 100, $aug['big_share_pct'], 0.05);
        $this->assertEqualsWithDelta(12 / 106 * 100, $aug['pb_share_pct'], 0.05);                                // 6 PB standar A (6 juta) + 3 PB ULP B (6 juta)

        $m = $d['month_detail'];
        $this->assertEquals(106_000_000, $m['rp']);
        $this->assertSame([90_000_000, 'PD'], [$m['top'][0]['rp'], $m['top'][0]['type']]);
        $this->assertSame($this->ulpA->id, $m['ulps'][0]['unit_id']);
        $this->assertEquals([100_000_000, 10_000_000, 3, 6_000_000], [$m['ulps'][0]['rp'], $m['ulps'][0]['rp_standard'], $m['ulps'][1]['n'], $m['ulps'][1]['rp']]);

        $resolver = app(NkoRealizationResolver::class);                                                          // NKO: pendapatan biaya penyambungan (Rp miliar, kumulatif Januari sampai bulan) dan jumlahnya di UP3
        $this->assertEqualsWithDelta(0.520, $resolver->systemValues($this->ulpA->id, 2026, 8)['pendapatan-biaya-penyambungan'], 1e-9);
        $this->assertEqualsWithDelta(0.526, $resolver->systemValues($this->up3->id, 2026, 8)['pendapatan-biaya-penyambungan'], 1e-9);

        $this->assertEquals(1.0, $d['lag']['median_days']);                                                      // semua lunas sehari setelah dibuat
        $q = collect($d['queue']['buckets'])->keyBy('key');
        $this->assertEquals([1, 5_000_000, 1, 2_000_000, 2, 2_000_000], [$q['0-7']['n'], $q['0-7']['rp'], $q['8-30']['n'], $q['8-30']['rp'], $q['>30']['n'], $q['>30']['rp']]);
        $this->assertTrue($q['>30']['stale']);
        $this->assertSame([0, 1, 3, 7, 14], array_column($d['queue']['odds_by_age'], 'age_days'));

        $f = $d['forecast'];
        $this->assertTrue($f['available']);
        $this->assertSame(['2026-09', '2026-08'], [$f['month'], $f['based_on']]);
        $this->assertEquals([12_000_000, 60_000_000, 40_000_000, 70_000_000], [$f['standard'], $f['big_median'], $f['big_low'], $f['big_high']]);                // standar: rata-rata Juni sampai Agustus (10 + 10 + 16) juta
        $this->assertSame(2, $f['backtest']['months']);
        $this->assertGreaterThan(0, $f['backtest']['model_mape_pct']);
        $this->assertFalse($f['reliable']);                                                                      // cara naif lebih baik pada riwayat uji pendek ini
    }

    #[Test]
    public function susut_mengestimasi_kwh_beli_dari_susut_kumulatif_nko_dan_kwh_jual_serta_memprakirakan_bulan_sesudahnya(): void
    {
        foreach (['2026-01-01' => 900, '2026-02-01' => 950, '2026-03-01' => 1000, '2026-04-01' => 1000] as $period => $kwh) {
            $this->sales($this->ulpA, $period, $kwh, 0);
        }
        $set = (string) Str::uuid();
        $definition = (string) Str::uuid();
        DB::table('kpi_definition_sets')->insert(['id' => $set, 'year' => 2026, 'unit_level' => 'ULP', 'version' => 1, 'status' => 'AKTIF', 'source_name' => 'uji', 'source_sha256' => str_repeat('a', 64), 'imported_at' => now()]);
        DB::table('kpi_definitions')->insert(['id' => $definition, 'set_id' => $set, 'row_no' => 1, 'sort_order' => 1, 'level' => 1, 'code' => 'susut-distribusi-tanpa-e-min', 'name' => 'Susut Distribusi Tanpa E-min', 'polarity' => 1]);
        foreach (['2026-01-01' => 10.0, '2026-02-01' => 8.0, '2026-03-01' => 9.0] as $period => $cumulative) {                  // realisasi susut kumulatif (%) angka acuan workbook
            DB::table('kpi_reference_values')->insert(['definition_id' => $definition, 'organizational_unit_id' => $this->ulpA->id, 'period' => $period, 'realisasi' => $cumulative]);
        }
        DB::table('kpi_targets')->insert(['definition_id' => $definition, 'organizational_unit_id' => $this->ulpA->id, 'period' => '2026-04-01', 'target_value' => 9.5]);
        $put = fn (array $items) => $this->as($this->planner)->putJson('/api/pengusahaan/inputs', ['unit_id' => $this->ulpA->id, 'items' => $items]);

        // metrik: bulan tanpa masukan memakai beli turunan = selisih (jual kumulatif / (1 - susut kumulatif)); masukan bulanan diutamakan
        $put([['period' => '2026-02', 'code' => 'kwh-beli', 'value' => 1000]])->assertOk();
        $m = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data');
        $beli = collect($m['series'])->keyBy('key')['beli']['values'];
        $this->assertEqualsWithDelta(1000.0, $beli[0], 1e-6);                                                  // Januari: 900 / 0,9 = 1.000
        $this->assertEqualsWithDelta(1000.0, $beli[1], 1e-9);                                                  // Februari: masukan 1.000, bukan turunan 1.010,87
        $this->assertEqualsWithDelta(2850 / 0.91 - 1850 / 0.92, $beli[2], 1e-6);                               // Maret turunan
        $this->assertEqualsWithDelta(10.0, collect($m['series'])->keyBy('key')['susut']['values'][0], 1e-6);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/susut?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->json('data.detail');
        $this->assertSame(['loss_estimate', true], [$d['kind'], $d['has_manual_input']]);
        $this->assertSame(['turunan', 'input', 'turunan', 'prakiraan'], array_column($d['history'], 'basis'));
        $apr = $d['history'][3];
        $this->assertEqualsWithDelta(1000 / 0.91, $apr['beli_net_kwh'], 1.0);                                  // April tanpa realisasi: susut kumulatif terakhir (9%) dipakai sebagai susut bulan itu
        $this->assertEqualsWithDelta(9.0, $apr['susut_pct'], 0.01);
        $bt = $d['backtest'];                                                                                    // Februari dan Maret: beli diprakirakan dari jual dan susut kumulatif bulan sebelumnya
        $this->assertSame(2, $bt['observations']);
        $this->assertEqualsWithDelta((abs(950 / 0.9 - (1850 / 0.92 - 1000)) / (1850 / 0.92 - 1000) + abs(1000 / 0.92 - (2850 / 0.91 - 1850 / 0.92)) / (2850 / 0.91 - 1850 / 0.92)) / 2 * 100, $bt['model_mape_pct'], 0.01);
        $row = $d['ulps'][0];
        $this->assertSame('termasuk_prakiraan', $row['ytd_basis']);
        $susut = 100 + 50 + ((2850 / 0.91 - 1850 / 0.92) - 1000) + (1000 / 0.91 - 1000);
        $beliYtd = 1000 + 1000 + (2850 / 0.91 - 1850 / 0.92) + 1000 / 0.91;
        $this->assertEqualsWithDelta($susut / $beliYtd * 100, $row['ytd_susut_pct'], 0.01);
        $this->assertEqualsWithDelta($row['ytd_susut_pct'] - 9.5, $row['gap_pct_points'], 0.01);
        $this->assertSame([], $d['anomalies']);                                                                  // kurang dari empat bulan turunan
    }

    #[Test]
    public function pengumpul_prakiraan_bmkg_menyimpan_satu_baris_per_ulp_per_hari_dan_gagal_satu_tidak_menghentikan_lainnya(): void
    {
        Cache::flush();
        $this->ulpA->forceFill(['code' => '51450'])->save();                                                    // terpetakan ke BMKG
        $this->ulpB->forceFill(['code' => '51452'])->save();
        $slot = fn (float $tp) => ['local_datetime' => now('Asia/Jakarta')->format('Y-m-d').' 00:00:00', 'analysis_date' => '2026-11-26T00:00:00', 'tp' => $tp, 'weather' => 3, 'ws' => 7.0];
        $tp = 4.5;
        Http::fake(function ($request) use (&$tp, $slot) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);

            return $q['adm4'] === '35.76.03.1002' ? Http::response('galat', 500) : Http::response(['lokasi' => ['desa' => 'Gambiran'], 'data' => [['cuaca' => [[$slot($tp)]]]]]);
        });

        $this->artisan('distriva:weather-collect-forecast')->assertSuccessful();
        $row = DB::table('weather_forecast_snapshots')->first();
        $this->assertSame(1, DB::table('weather_forecast_snapshots')->count());                                  // ULP B gagal, ULP A tersimpan
        $this->assertSame([$this->ulpA->id, '35.17.06.2007', '2026-11-26T00:00:00'], [$row->organizational_unit_id, $row->adm4, $row->analysis_date]);
        $this->assertEquals(4.5, json_decode($row->slots, true)[0]['rain']);

        $tp = 9.0;                                                                                               // ambil ulang di hari yang sama: menimpa, tanpa cache lama
        $this->artisan('distriva:weather-collect-forecast')->assertSuccessful();
        $this->assertSame(1, DB::table('weather_forecast_snapshots')->count());
        $this->assertEquals(9.0, json_decode(DB::table('weather_forecast_snapshots')->value('slots'), true)[0]['rain']);

        $this->travel(1)->day();
        $this->artisan('distriva:weather-collect-forecast')->assertSuccessful();
        $this->assertSame(2, DB::table('weather_forecast_snapshots')->count());                                  // hari baru: riwayat bertambah
    }

    #[Test]
    public function detail_keandalan_memuat_peringatan_dini_bmkg_dengan_penyulang_prioritas_dan_tetap_tampil_bila_sumber_gagal(): void
    {
        Cache::flush();
        $this->ulpA->forceFill(['code' => '51450'])->save();                                                    // ULP Mojoagung: terpetakan ke kode wilayah BMKG
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $f2 = $this->feederOf($this->ulpA, 'F2');
        foreach (['2026-03-10', '2026-03-15', '2026-04-01'] as $d) {                                            // F1: dua dari tiga gangguan pada hari hujan lebat menurut ERA5
            $this->outage($f1, $this->ulpA, $d, 'PERMANEN', 60, 500);
        }
        $this->outage($f2, $this->ulpA, '2026-04-02', 'PERMANEN', 60, 500);                                      // F2: tidak pada hari hujan lebat
        DB::table('substations')->insert(['id' => (string) Str::uuid(), 'code' => 'HD0002', 'organizational_unit_id' => $this->ulpA->id, 'latitude' => -7.5, 'longitude' => 112.4, 'created_at' => now(), 'updated_at' => now()]);
        $url = "/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04";

        $slots = fn (int $offset, float $tp, int $weather) => array_map(fn ($h) => ['local_datetime' => now('Asia/Jakarta')->addDays($offset)->format('Y-m-d').sprintf(' %02d:00:00', $h * 3), 'tp' => $tp, 'weather' => $weather, 'ws' => 12, 'analysis_date' => '2026-11-26T00:00:00'], range(0, 7));
        $down = false;
        Http::fake(function ($request) use (&$down, $slots) {
            if (str_contains($request->url(), 'api.bmkg.go.id')) {
                return $down ? Http::response('galat', 500) : Http::response(['lokasi' => ['desa' => 'Gambiran', 'kecamatan' => 'Mojoagung', 'kotkab' => 'Jombang'], 'data' => [['cuaca' => [$slots(0, 3.5, 3), $slots(1, 0.5, 95), $slots(2, 8.0, 61)]]]]);   // 28 mm, hujan petir, 64 mm
            }
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);
            $days = [];
            for ($t = strtotime($q['start_date']); $t <= strtotime($q['end_date']); $t += 86400) {
                $days[] = date('Y-m-d', $t);
            }

            return Http::response(['daily' => ['time' => $days, 'precipitation_sum' => array_map(fn ($d) => in_array($d, ['2026-03-10', '2026-03-15'], true) ? 30.0 : 1.0, $days)]]);
        });
        $w = $this->as($this->planner)->getJson($url)->assertOk()->json('data.detail.early_warning');

        $this->assertTrue($w['available']);
        $this->assertStringContainsString('BMKG', $w['attribution']);
        $this->assertSame(3, $w['horizon_days']);
        $u = $w['ulps'][0];
        $this->assertSame(['tinggi', '35.17.06.2007', 'Gambiran'], [$u['max_level'], $u['adm4'], $u['location']['desa']]);
        $this->assertEquals([['waspada', 28.0, false, 1.66], ['waspada', 4.0, true, 1.15], ['tinggi', 64.0, false, 1.66]], array_map(fn ($d) => [$d['level'], $d['rain_mm'], $d['thunderstorm'], $d['rate_ratio']], $u['days']));
        $this->assertEquals([8, 12.0], [$u['days'][0]['slots'], $u['days'][0]['max_wind_kmh']]);
        $this->assertCount(1, $w['watchlist']);                                                                  // hanya penyulang yang pernah terganggu pada hari hujan lebat
        $this->assertEquals(['F1', 3, 2, 66.7], [$w['watchlist'][0]['code'], $w['watchlist'][0]['events_3y'], $w['watchlist'][0]['events_on_heavy_rain_days_3y'], $w['watchlist'][0]['heavy_rain_share_pct']]);

        Cache::flush();
        $down = true;
        $this->assertSame([false, 'Prakiraan BMKG tidak dapat dihubungi.'], [$this->as($this->planner)->getJson($url)->assertOk()->json('data.detail.early_warning.available'), $this->as($this->planner)->getJson($url)->json('data.detail.early_warning.reason')]);
    }

    /** Gardu dengan satu pengukuran: [id gardu]. $loading null berarti dihitung dari kVA beban dan kapasitas. */
    private function gardu(OrganizationalUnit $ulp, string $code, float $capacity, ?float $loading, array $currents, string $measuredOn = '2026-08-10', string $ownership = 'PLN', ?float $loadKva = null): void
    {
        $id = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $id, 'code' => $code, 'organizational_unit_id' => $ulp->id, 'ownership' => $ownership, 'capacity_kva' => $capacity, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('substation_readings')->insert(['id' => (string) Str::uuid(), 'substation_id' => $id, 'measured_on' => $measuredOn, 'source' => 'SURVEY', 'loading_pct' => $loading, 'load_kva' => $loadKva, 'capacity_kva' => $capacity,
            'current_r_a' => $currents[0], 'current_s_a' => $currents[1], 'current_t_a' => $currents[2], 'created_at' => now()]);
    }

    #[Test]
    public function susut_memuat_proksi_susut_teknis_dari_pengukuran_gardu_dengan_tanda_data_diragukan_dan_korelasi_antar_ulp(): void
    {
        $this->gardu($this->ulpA, 'GA1', 100, 90, [100, 100, 100]);                                             // beban tinggi, seimbang
        $this->gardu($this->ulpA, 'GA2', 100, 120, [150, 100, 50]);                                             // beban lebih, tidak seimbang (simpangan 33,3%)
        $this->gardu($this->ulpA, 'GA3', 100, 300, [100, 100, 100]);                                            // beban 300%: dibatasi 200% dan ditandai data diragukan
        $this->gardu($this->ulpA, 'GA4', 100, 50, [50, 50, 50], '2026-08-10', 'PELANGGAN');                     // milik pelanggan: tidak ikut
        $this->gardu($this->ulpA, 'GA5', 100, null, [50, 50, 50], '2026-08-10', 'PLN', 50.0);                    // beban dihitung dari kVA beban / kapasitas = 50%
        $this->gardu($this->ulpA, 'GA6', 100, 70, [60, 60, 60], '2024-01-10');                                  // pengukuran terlalu lama (lebih dari 14 bulan): tidak ikut
        $this->gardu($this->ulpB, 'GB1', 100, 40, [40, 40, 40]);

        $d = app(TechnicalLossProxy::class)->detail([$this->ulpA->id, $this->ulpB->id], '2026-09', []);

        $this->assertTrue($d['available']);
        $a = collect($d['ulps'])->firstWhere('unit_id', $this->ulpA->id);
        $b = collect($d['ulps'])->firstWhere('unit_id', $this->ulpB->id);
        $this->assertSame(4, $a['substations']);                                                                 // GA1, GA2, GA3, GA5
        $this->assertEqualsWithDelta((90 + 120 + 200 + 50) / 4, $a['avg_loading_pct'], 0.05);                   // kapasitas sama: rata-rata biasa, GA3 dibatasi 200
        $this->assertEquals([50.0, 75.0], [$a['overload_pct_of_substations'], $a['high_load_pct_of_substations']]);   // beban lebih (di atas 100%): GA2 dan GA3 = 2 dari 4; beban tinggi (di atas 80%): GA1, GA2, GA3 = 3 dari 4
        $index = (0.81 + 1.44 * (1 + 3 * (100 / 300) ** 2) + 4.0 + 0.25) / 4;
        $this->assertEqualsWithDelta($index, $a['loss_index'], 0.001);
        $this->assertEqualsWithDelta(0.16, $b['loss_index'], 1e-9);
        $this->assertSame($this->ulpA->id, $d['ulps'][0]['unit_id']);                                            // indeks terbesar dahulu

        $w = collect($d['watchlist']);
        $this->assertSame('GA3', $w[0]['code']);                                                                 // indeks 4 (dibatasi) paling besar
        $this->assertEquals([300.0, ['beban_lebih', 'data_diragukan']], [$w[0]['loading_pct'], $w[0]['flags']]);
        $ga2 = $w->firstWhere('code', 'GA2');
        $this->assertEqualsWithDelta(33.3, $ga2['unbalance_pct'], 0.05);
        $this->assertSame(['beban_lebih', 'tidak_seimbang'], $ga2['flags']);
        $this->assertSame(['beban_tinggi'], $w->firstWhere('code', 'GA1')['flags']);
        $this->assertNull($w->firstWhere('code', 'GA4'));
        $this->assertNull($w->firstWhere('code', 'GA6'));
        $this->assertFalse($d['correlation']['available']);                                                      // kurang dari enam ULP

        // korelasi peringkat dengan susut: enam ULP, beban naik bersama susut => Spearman 1
        $units = [$this->ulpA->id, $this->ulpB->id];
        $susut = [$this->ulpA->id => 9.0, $this->ulpB->id => 3.0];
        foreach ([60, 70, 80, 90] as $i => $load) {
            $u = $this->makeUnit('ULP', $this->up3);
            $this->gardu($u, "GX{$i}", 100, $load, [$load, $load, $load]);
            $units[] = $u->id;
            $susut[$u->id] = 4.0 + $i;
        }
        $c = app(TechnicalLossProxy::class)->detail($units, '2026-09', $susut)['correlation'];
        $this->assertSame([true, 6], [$c['available'], $c['ulps']]);
        $this->assertGreaterThan(0.7, $c['loss_index']);                                                         // ULP A beban rata-rata tertinggi dan susut 9
    }

    /**
     * Permohonan PB atau PD langsung ke tabel, memakai templat dari `connected()`. Tiap baris: paid (tanggal bayar), done (tanggal sambung atau null), status, kva, type, tariff.
     *
     * @param  list<array<string, mixed>>  $specs
     */
    private function pbApplications(OrganizationalUnit $ulp, array $specs): void
    {
        $this->connected($ulp, 'PB', 1, '2020-01-01');                                                          // memastikan templat ada; baris ini tanpa tanggal bayar dan sambung sehingga tidak terhitung
        $rows = [];
        foreach ($specs as $x) {
            $rows[] = array_merge($this->applicationTemplate, ['id' => (string) Str::uuid(), 'application_number' => 'T-'.Str::random(12), 'application_type' => $x['type'] ?? 'PB', 'organizational_unit_id' => $ulp->id,
                'current_status' => $x['status'] ?? 'CONNECTION_DONE', 'delta_power_kva' => $x['kva'] ?? 0.9, 'new_tariff_code' => $x['tariff'] ?? 'R1', 'source_created_at' => ($x['paid'] ?? $x['done']).' 08:00:00',
                'paid_at' => $x['paid'] ?? null, 'completed_at' => isset($x['done']) ? $x['done'].' 09:00:00' : null, 'created_at' => now(), 'updated_at' => now()]);
        }
        foreach (array_chunk($rows, 150) as $chunk) {
            DB::table('applications')->insert($chunk);
        }
    }

    #[Test]
    public function detail_pelanggan_memuat_rekonsiliasi_lama_sambung_antrean_kecamatan_gardu_dan_perubahan_daya(): void
    {
        $this->customers309($this->ulpA, [['2026-01-01', 1000], ['2026-02-01', 1030], ['2026-03-01', 1055]]);
        $tz = 'Asia/Jakarta';
        $specs = [];
        foreach (range(1, 35) as $i) {
            $specs[] = ['paid' => '2026-02-10', 'done' => '2026-02-11'];                                      // Februari: 35 PB tersambung sehari sesudah bayar
        }
        foreach (range(1, 25) as $i) {
            $specs[] = ['paid' => '2026-03-01', 'done' => '2026-03-09'];                                      // Maret: 25 PB tersambung delapan hari sesudah bayar
        }
        array_push($specs, ['type' => 'PD', 'done' => '2026-03-05', 'kva' => 1.0, 'tariff' => 'R1'], ['type' => 'PD', 'done' => '2026-03-06', 'kva' => 2.0, 'tariff' => 'R1T'], ['type' => 'PD', 'done' => '2026-03-07', 'kva' => -0.5, 'tariff' => 'B1']);
        $today = now($tz);
        array_push($specs, ['paid' => $today->copy()->subDays(3)->toDateString(), 'status' => 'PAID'], ['paid' => $today->copy()->subDays(20)->toDateString(), 'status' => 'PK_PRINTED'],
            ['paid' => $today->copy()->subDays(100)->toDateString(), 'status' => 'PAID'], ['paid' => $today->copy()->subDays(100)->toDateString(), 'status' => 'PK_PRINTED'],
            ['paid' => $today->copy()->subDays(2)->toDateString(), 'done' => $today->copy()->subDay()->toDateString()]);                  // sudah tersambung: bukan antrean
        $this->pbApplications($this->ulpA, $specs);
        $inProposal = DB::table('applications')->where('current_status', 'PK_PRINTED')->orderByDesc('paid_at')->get()->last();                  // yang paling lama: masuk usulan penambahan jaringan
        $proposal = (string) Str::uuid();
        DB::table('proposals')->insert(['id' => $proposal, 'proposal_number' => 'USL-'.Str::random(8), 'ulp_unit_id' => $this->ulpA->id, 'representative_application_id' => $inProposal->id, 'title' => 'Uji', 'status' => 'OPEN', 'created_by' => $this->planner->id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('proposal_applications')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $proposal, 'application_id' => $inProposal->id, 'added_by' => $this->planner->id, 'added_at' => now()]);

        $this->gardu($this->ulpA, 'GC1', 100, 90, [90, 90, 90], '2026-02-10');
        $this->gardu($this->ulpA, 'GC2', 100, 40, [40, 40, 40], '2026-02-10');
        $sub = fn (string $code) => DB::table('substations')->where('code', $code)->value('id');
        $conn = function (string $idpel, string $kecamatan, string $on, ?string $gardu = null, string $status = 'AKTIF') use ($sub) {
            DB::table('customer_connections')->insert(['id' => (string) Str::uuid(), 'idpel' => $idpel, 'organizational_unit_id' => $this->ulpA->id, 'source' => 'DIL', 'kecamatan' => $kecamatan, 'energized_on' => $on, 'status' => $status,
                'substation_id' => $gardu === null ? null : $sub($gardu), 'snapshot_month' => '202603', 'created_at' => now(), 'updated_at' => now()]);
        };
        foreach (['514000000001', '514000000002', '514000000003'] as $idpel) {
            $conn($idpel, 'JOMBANG', '2026-02-10', 'GC1');
        }
        $conn('514000000004', 'JOMBANG', '2025-02-10');                                                          // tahun lalu pada rentang yang sama
        $conn('514000000005', 'DIWEK', '2026-03-02', 'GC2');
        $conn('514000000006', 'DIWEK', '2026-03-03', null, 'BONGKAR');                                           // tidak aktif: tidak terhitung

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');

        $this->assertSame(['customer_growth', 'pelanggan', false], [$d['kind'], $d['focus'], $d['partial']]);
        $rec = collect($d['reconciliation'])->keyBy('month');
        $this->assertEquals([null, 30, 35, 5], [$rec['2026-01']['official'], $rec['2026-02']['official'], $rec['2026-02']['connected'], $rec['2026-02']['residual']]);   // 35 PB lawan tambah 30: 5 berhenti atau koreksi
        $this->assertEquals([25, 25, 0], [$rec['2026-03']['official'], $rec['2026-03']['connected'], $rec['2026-03']['residual']]);
        $daya = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/daya?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail.reconciliation');
        $this->assertEqualsWithDelta(25 * 0.9 + 2.5, collect($daya)->firstWhere('month', '2026-03')['connected'], 0.05);     // daya PB 22,5 kVA ditambah PD neto 2,5 kVA

        $lead = $d['lead_time'];
        $this->assertEquals([60, 1.0, 8.0, 100.0], [$lead['n'], $lead['median_days'], $lead['p90_days'], $lead['within_30_days_pct']]);
        $this->assertSame($this->ulpA->id, $lead['ulps'][0]['unit_id']);

        $q = $d['queue'];
        $this->assertEquals([1, 1, 1, 1], [$q['live_0_7'], $q['live_8_30'], $q['stale'], $q['in_network_proposal']]);   // yang sudah tersambung bukan antrean
        $this->assertEquals(['PAID' => 1, 'PK_PRINTED' => 1], $q['live_by_status']);
        $this->assertNull($d['month_projection']);                                                                // bulan terpilih bukan bulan berjalan

        $this->assertSame(['2026-01-01', '2026-03-31', 4], [$d['areas']['period']['from'], $d['areas']['period']['to'], $d['areas']['added_total']]);
        $this->assertEquals(['JOMBANG', 3, 1, 200.0, 75.0], [$d['areas']['rows'][0]['kecamatan'], $d['areas']['rows'][0]['added'], $d['areas']['rows'][0]['added_prev_year'], $d['areas']['rows'][0]['change_pct'], $d['areas']['rows'][0]['share_pct']]);
        $g = collect($d['gardu']['rows']);
        $this->assertEquals(['GC1', 3, true, 90.0], [$g[0]['code'], $g[0]['added'], $g[0]['capacity_watch'], $g[0]['loading_pct']]);       // tumbuh cepat dan bebannya 90%
        $this->assertSame(['GC2', 1, false], [$g[1]['code'], $g[1]['added'], $g[1]['capacity_watch']]);

        $pd = $d['power_changes'];
        $this->assertEquals([3, 2.5, 3.0], [$pd['total'], $pd['net_kva'], $pd['increase_kva']]);
        $this->assertEquals([['R', 2, 2, 0, 3.0], ['B', 1, 0, 1, -0.5]], array_map(fn ($x) => [$x['group'], $x['count'], $x['up'], $x['down'], $x['net_kva']], $pd['groups']));
    }

    #[Test]
    public function detail_pelanggan_memproyeksikan_akhir_bulan_berjalan_dari_laju_sambung_dengan_uji_mundur(): void
    {
        $now = Carbon::parse('2026-11-26 10:00:00', 'Asia/Jakarta');
        Carbon::setTestNow($now);
        try {
            $specs = [];
            for ($t = strtotime('2026-06-01'); $t <= strtotime('2026-11-26'); $t += 86400) {
                array_push($specs, ['paid' => date('Y-m-d', $t), 'done' => date('Y-m-d', $t)], ['paid' => date('Y-m-d', $t), 'done' => date('Y-m-d', $t)]);        // dua PB tersambung setiap hari
            }
            $this->pbApplications($this->ulpA, $specs);

            $p = app(CustomerInsights::class)->detail('pelanggan', [$this->ulpA->id], '2026-11')['month_projection'];

            $this->assertEquals([26, 30, 52, 60, 62], [$p['day'], $p['days_in_month'], $p['connected_so_far'], $p['projected'], $p['last_month']]);   // 52 dalam 26 hari: 52 / 26 x 30
            $this->assertSame(4, $p['backtest']['months']);                                                         // Juli sampai Oktober (Juni belum punya bulan sebelumnya)
            $this->assertEquals(0.0, $p['backtest']['runrate_mape_pct']);                                           // laju tetap: proyeksi tepat
            $this->assertGreaterThan(0, $p['backtest']['last_month_mape_pct']);                                     // angka bulan lalu meleset karena jumlah hari berbeda
        } finally {
            Carbon::setTestNow();
        }
    }

    #[Test]
    public function detail_piutang_prabayar_memuat_pelunasan_tunggakan_beku_bulan_tidak_wajar_dan_prakiraan_tunggakan(): void
    {
        $line = fn (string $status, float $rp, int $n, string $tariff) => [$status, ['rptag' => $rp, 'jumlah' => $n, 'tarif_lap' => $tariff] + ($status === 'BARU' ? ['rpangsuranbp' => $rp - 2_000_000, 'rpangsuranp2tl' => 1_500_000] : [])];     // BARU: angsuran BP, angsuran P2TL 1,5 juta, sisanya 0,5 juta lainnya
        $jt = 1_000_000;
        foreach (range(0, 13) as $i) {                                                                          // Maret 2025 sampai April 2026
            $period = date('Y-m-01', strtotime("2025-03-01 +{$i} month"));
            $baruA = match ($i) {
                12 => 5,                                                                                          // Maret 2026: piutang baru mendadak hampir nol
                13 => 600,                                                                                        // April 2026: melonjak, didorong ULP A
                default => 100,
            };
            $baruB = match ($i) {
                12 => 3,
                13 => 50,
                default => 50,
            };
            $this->report($this->ulpA, 'PIUTANGLPB_EIS', $period, [$line('BARU', $baruA * $jt, 10, 'R1'), $line('BERJALAN', 20 * $jt, 5, 'R1'), $line('TUNGGAKAN', 500 * $jt, 40, 'R1'), ['NO REGISTER Total', ['rptag' => 9_999_999_999, 'jumlah' => 99]]]);
            $this->report($this->ulpB, 'PIUTANGLPB_EIS', $period, [$line('BARU', $baruB * $jt, 4, 'R1M'), $line('BERJALAN', 10 * $jt, 2, 'R1M'), $line('TUNGGAKAN', 300 * $jt, 20, 'R1M')]);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-prabayar?unit_id={$this->up3->id}&from=2025-03&to=2026-04")->assertOk()->json('data.detail');

        $this->assertSame(['prepaid_receivable', true, '2026-04'], [$d['kind'], $d['available'], $d['month']]);
        $m = collect($d['monthly'])->keyBy('month');
        $this->assertEquals([650 * $jt, 30 * $jt, 800 * $jt, 1480 * $jt], [$m['2026-04']['baru'], $m['2026-04']['berjalan'], $m['2026-04']['tunggakan'], $m['2026-04']['total']]);
        $this->assertEquals([150 * $jt, 8 * $jt], [$m['2026-03']['pelunasan'], $m['2026-04']['pelunasan']]);       // (baru + berjalan + tunggakan bulan lalu) - (berjalan + tunggakan bulan ini)
        $this->assertEqualsWithDelta(150 / 980 * 100, $m['2026-03']['effectiveness_pct'], 0.05);
        $this->assertNull($m['2025-03']['pelunasan']);                                                           // bulan pertama: tanpa bulan sebelumnya
        $this->assertEquals([646 * $jt, 3 * $jt, 1 * $jt], [$m['2026-04']['baru_angsuran_bp'], $m['2026-04']['baru_angsuran_p2tl'], $m['2026-04']['baru_lainnya']]);      // dua ULP: BP = baru - 2 juta tiap ULP, P2TL 1,5 juta tiap ULP, lainnya 0,5 juta tiap ULP

        $f = $d['frozen'];
        $this->assertEquals([800 * $jt, 14, true], [$f['arrears'], $f['stable_months'], $f['frozen']]);           // tunggakan 800 juta tak bergerak 14 bulan
        $this->assertEqualsWithDelta(800 / 1480 * 100, $f['share_of_total_pct'], 0.05);

        $this->assertSame(['2026-04', '2026-03'], array_column($d['anomalies'], 'month'));
        $this->assertEquals(['tinggi', 'rendah'], array_column($d['anomalies'], 'direction'));
        $this->assertEquals([150 * $jt, $this->ulpA->id, 600 * $jt], [$d['anomalies'][0]['median_prev_12m'], $d['anomalies'][0]['top_ulp']['unit_id'], $d['anomalies'][0]['top_ulp']['baru']]);

        $this->assertSame($this->ulpA->id, $d['ulps'][0]['unit_id']);                                            // tunggakan terbesar dahulu
        $this->assertEqualsWithDelta(62.5, $d['ulps'][0]['arrears_share_pct'], 0.05);
        $this->assertEquals(['R1', 500 * $jt, 600 * $jt], [$d['tariffs'][0]['tariff'], $d['tariffs'][0]['tunggakan'], $d['tariffs'][0]['baru']]);

        $fc = $d['forecast'];
        $this->assertEquals(['2026-05', 800 * $jt, 0.0, 0.0, true], [$fc['month'], $fc['arrears'], $fc['backtest']['naive_mape_pct'], $fc['backtest']['mean3_mape_pct'], $fc['reliable']]);
        $this->assertGreaterThanOrEqual(6, $fc['backtest']['months']);

        $this->assertSame(false, $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-prabayar?unit_id={$this->up3->id}&from=2020-01&to=2020-03")->assertOk()->json('data.detail.available'));   // tanpa laporan: tidak tersedia
    }

    #[Test]
    public function sisa_susut_membandingkan_susut_dengan_beban_gardu_menandai_pencilan_dan_menyandingkan_p2tl(): void
    {
        $analyzer = app(NontechnicalLoss::class);
        $row = fn (string $name, float $loading, float $susut, float $p2tlKwh) => ['name' => $name, 'susut' => $susut, 'loading' => $loading, 'jual_kwh' => 1_000_000.0, 'p2tl_kwh' => $p2tlKwh, 'p2tl_cases' => 10.0, 'customers' => 2000.0];

        // susut persis garis lurus terhadap beban (0,5 poin per 1% beban): sisa nol, tanpa tanda; P2TL naik bersama susut
        $linear = [];
        foreach ([40, 45, 50, 55, 60, 65] as $i => $load) {
            $linear["u{$i}"] = $row("ULP {$i}", $load, 0.5 * $load - 15, 1000 * ($i + 1));
        }
        $r = $analyzer->analyze($linear);
        $this->assertTrue($r['available']);
        $this->assertEqualsWithDelta(0.5, $r['fit']['slope_pct_points_per_loading_pct'], 0.001);
        foreach ($r['ulps'] as $u) {
            $this->assertEqualsWithDelta(0.0, $u['residual_pct_points'], 0.01);
        }
        $this->assertEquals(1.0, $r['correlation']['susut_vs_p2tl_pct']);                                       // P2TL dan susut naik bersama antar ULP
        $first = collect($r['ulps'])->firstWhere('unit_name', 'ULP 0');
        $this->assertEquals([0.1, 5.0, 100, 5.0, 40.0], [$first['p2tl_pct_of_sales'], $first['p2tl_cases_per_1000_customers'], $first['p2tl_kwh_per_case'], $first['ytd_susut_pct'], $first['avg_loading_pct']]);

        // satu ULP susutnya empat poin di atas garis: sisa terbesar dan ditandai; yang lain sedikit di bawah garis
        $outlier = $linear;
        $outlier['u5'] = $row('ULP 5', 65, 0.5 * 65 - 15 + 4.0, 6000);
        $r = $analyzer->analyze($outlier);
        $this->assertSame('ULP 5', $r['ulps'][0]['unit_name']);                                                  // sisa terbesar dahulu
        $this->assertSame('di_atas_harapan', $r['ulps'][0]['residual_flag']);
        $this->assertGreaterThan(1.5, $r['ulps'][0]['residual_pct_points']);                                        // empat poin di atas garis, sebagian diserap garis regresi
        $this->assertSame(1, count(array_filter($r['ulps'], fn ($u) => $u['residual_flag'] === 'di_atas_harapan')));
        $this->assertEqualsWithDelta(0.0, array_sum(array_column($r['ulps'], 'residual_pct_points')), 0.05);     // sisa regresi berjumlah nol

        // kurang dari enam ULP, atau ULP tanpa kWh jual: tidak tersedia
        $this->assertFalse($analyzer->analyze(array_slice($linear, 0, 5, true))['available']);
        $noSales = $linear;
        $noSales['u0']['jual_kwh'] = 0.0;
        $this->assertFalse($analyzer->analyze($noSales)['available']);
    }

    #[Test]
    public function detail_keandalan_memuat_konteks_cuaca_bulanan_dan_tetap_tampil_bila_sumber_cuaca_gagal(): void
    {
        Cache::flush();
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $this->outage($f1, $this->ulpA, '2026-03-10', 'PERMANEN', 60, 500);
        $this->outage($f1, $this->ulpA, '2026-03-11', 'PERMANEN', 60, 500);
        $url = "/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03";

        $this->assertSame([false, 'Koordinat gardu ULP belum tersedia.'], $this->weatherOf($url, 'available', 'reason'));   // tanpa koordinat: tidak memanggil sumber luar

        DB::table('substations')->insert(['id' => (string) Str::uuid(), 'code' => 'HD0001', 'organizational_unit_id' => $this->ulpA->id, 'latitude' => -7.5, 'longitude' => 112.4, 'created_at' => now(), 'updated_at' => now()]);
        $days = array_map(fn ($i) => date('Y-m-d', strtotime("2025-04-01 +{$i} day")), range(0, 364));
        $down = false;
        Http::fake(function () use (&$down, $days) {
            return $down ? Http::response('galat', 500) : Http::response(['daily' => ['time' => $days, 'precipitation_sum' => array_map(fn ($d) => in_array($d, ['2026-03-10', '2026-03-11'], true) ? 30.0 : 1.0, $days)]]);
        });
        $w = $this->as($this->planner)->getJson($url)->assertOk()->json('data.detail.weather');

        $this->assertTrue($w['available']);
        $this->assertSame(1, $w['ulp_count']);
        $this->assertCount(12, $w['rows']);
        $mar = collect($w['rows'])->firstWhere('month', '2026-03');
        $this->assertEqualsWithDelta(29 * 1 + 2 * 30, $mar['rain_mm'], 0.05);
        $this->assertEquals([2.0, 31, 2], [$mar['heavy_days'], $mar['days_covered'], $mar['events']]);
        $this->assertStringContainsString('Open-Meteo', $w['attribution']);
        Http::assertSentCount(1);

        $this->as($this->planner)->getJson($url)->assertOk();                                                    // panggilan kedua dari cache
        Http::assertSentCount(1);

        Cache::flush();
        $down = true;
        $this->assertSame([false, 'Sumber cuaca tidak dapat dihubungi.'], $this->weatherOf($url, 'available', 'reason'));  // halaman tetap tampil
        $this->assertSame('reliability', $this->as($this->planner)->getJson($url)->assertOk()->json('data.detail.kind'));
    }

    /** @return list<mixed> */
    private function weatherOf(string $url, string ...$keys): array
    {
        $w = $this->as($this->planner)->getJson($url)->assertOk()->json('data.detail.weather');

        return array_map(fn ($k) => $w[$k], $keys);
    }

    #[Test]
    public function detail_keandalan_memuat_pareto_penyulang_gangguan_berulang_komposisi_dan_skor_risiko_dengan_uji_mundur(): void
    {
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $f2 = $this->feederOf($this->ulpA, 'F2');
        $f3 = $this->feederOf($this->ulpA, 'F3');
        $this->feederCustomers($f1, $this->ulpA, 100);
        $this->feederCustomers($f2, $this->ulpA, 50);
        $this->feederCustomers($f3, $this->ulpA, 10);
        foreach (['2026-03-10', '2026-03-15', '2026-03-20'] as $d) {                                            // F1: tiga gangguan permanen 60 menit dalam 30 hari (berulang)
            $this->outage($f1, $this->ulpA, $d, 'PERMANEN', 60, 500);
        }
        $this->outage($f2, $this->ulpA, '2026-03-12', 'PERMANEN', 30, 200);
        $this->outage($f2, $this->ulpA, '2026-03-25', 'TEMPORER', 10, 0);                                       // F2: dua gangguan, di bawah ambang berulang
        $this->outage($f3, $this->ulpA, '2026-01-05', 'TEMPORER', 2, 0);                                        // di bawah ambang 5 menit: tidak masuk SAIDI
        foreach (range(0, 7) as $i) {                                                                           // riwayat F1 satu gangguan tiap bulan, Juli 2025 sampai Februari 2026
            $this->outage($f1, $this->ulpA, date('Y-m-15', strtotime("2025-07-15 +{$i} month")), 'PERMANEN', 20, 10);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/saidi-saifi?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');

        $this->assertSame(['reliability', '2026-01-01', '2026-03-31'], [$d['kind'], $d['period']['from'], $d['period']['to']]);
        $rows = collect($d['pareto']['rows']);
        $this->assertSame(['F1', 'F2'], $rows->pluck('code')->take(2)->all());                                    // urut kontribusi SAIDI
        $this->assertEqualsWithDelta(100 * 220 / 160, $rows[0]['saidi_contribution'], 1e-9);                      // pelanggan x menit gangguan terhitung (3 x 60 + 2 x 20 pada Januari dan Februari) / pelanggan unit
        $this->assertEqualsWithDelta((100 * 220) / (100 * 220 + 50 * 40) * 100, $rows[0]['saidi_share_pct'], 0.01);
        $this->assertEqualsWithDelta(100.0, $rows[1]['saidi_cumulative_pct'], 0.01);
        $this->assertEquals(0, $rows->firstWhere('code', 'F3')['saidi_contribution'] ?? 0);

        $repeat = $d['repeat'];
        $this->assertSame([3, 30, '2026-03-02', '2026-03-31'], [$repeat['threshold_events'], $repeat['window_days'], $repeat['window_from'], $repeat['window_to']]);
        $this->assertSame(['F1'], array_column($repeat['rows'], 'code'));                                         // F2 hanya dua gangguan
        $this->assertSame([3, 3], [$repeat['rows'][0]['events'], $repeat['rows'][0]['permanent']]);

        $cause = $d['composition']['cause'];
        $this->assertEquals(['ROW', 100], [$cause['rows'][0]['key'], $cause['rows'][0]['events_share_pct']]);
        $this->assertSame('CERAH', $d['composition']['weather']['rows'][0]['key']);

        $risk = $d['risk'];
        $this->assertTrue($risk['available']);
        $this->assertSame(['2026-03', '2026-04', 'ewma_seasonal'], [$risk['as_of_month'], $risk['target_month'], $risk['method']]);
        $this->assertSame('F1', $risk['rows'][0]['code']);                                                        // gangguan paling sering dan paling baru
        $this->assertGreaterThan($risk['rows'][1]['expected_events'], $risk['rows'][0]['expected_events']);
        $this->assertSame(11, $risk['rows'][0]['last_12m_events']);
        $this->assertSame(['model_capture_pct', 'naive_capture_pct', 'random_capture_pct'], array_values(array_filter(array_keys($risk['backtest']), fn ($k) => str_ends_with($k, '_capture_pct'))));
        $this->assertNotEmpty($risk['backtest']['months']);
        $this->assertEqualsWithDelta(100.0, $risk['backtest']['random_capture_pct'], 0.01);                                         // hanya tiga penyulang: sepuluh teratas mencakup semuanya

        // menu keandalan lain memuat blok yang sama; menu non-keandalan tidak
        $this->assertSame('reliability', $this->as($this->planner)->getJson("/api/pengusahaan/metrics/ens?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail.kind'));
        $this->assertSame('customer_growth', $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail.kind'));   // menu lain punya jenis blok sendiri
    }

    #[Test]
    public function skor_risiko_tidak_tersedia_tanpa_data_gangguan_dan_bulan_berjalan_tidak_dipakai_untuk_pelatihan(): void
    {
        $empty = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/gangguan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');
        $this->assertFalse($empty['risk']['available']);
        $this->assertSame([], $empty['pareto']['rows']);
        $this->assertSame([], $empty['repeat']['rows']);

        $f1 = $this->feederOf($this->ulpA, 'F1');
        $this->feederCustomers($f1, $this->ulpA, 10);
        $current = now(config('distriva.business_timezone'))->format('Y-m');
        $last = date('Y-m', strtotime($current.'-01 -1 month'));
        $this->outage($f1, $this->ulpA, $last.'-10', 'PERMANEN', 30, 1);
        $this->outage($f1, $this->ulpA, now(config('distriva.business_timezone'))->format('Y-m-01'), 'PERMANEN', 30, 1);        // bulan berjalan belum lengkap

        $risk = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/gangguan?unit_id={$this->ulpA->id}&from={$last}&to={$current}")->assertOk()->json('data');

        $this->assertTrue($risk['detail']['period']['partial']);
        $this->assertSame([$last, $current], [$risk['detail']['risk']['as_of_month'], $risk['detail']['risk']['target_month']]);   // dilatih sampai bulan lengkap terakhir, sasaran bulan berjalan
    }

    /** Laporan umur tunggakan satu ULP: tiap elemen [jumlah lembar, pelanggan, rupiah]. */
    private function umur(OrganizationalUnit $unit, string $period, array $classes): void
    {
        $this->report($unit, 'UMURPIUTANG', $period, array_map(fn (array $c) => [(string) $c[0], ['kogol' => '0', 'plg' => $c[1], 'lbr' => $c[1] * $c[0], 'gabungan' => $c[2]]], $classes));
    }

    #[Test]
    public function wawasan_umur_tunggakan_menghitung_roll_rate_pelanggan_prakiraan_dan_menandai_keandalannya(): void
    {
        // deret tetap 14 bulan (Oktober 2025 sampai November 2026): kelas 1 bulan 100 pelanggan, 2 bulan 20, 3 bulan 6, lembar 4 (4-6) 3, lembar 8 (7-12) 2, dua ULP dengan angka sama
        foreach (range(0, 13) as $i) {
            $period = date('Y-m-01', strtotime("2025-10-01 +{$i} month"));
            foreach ([$this->ulpA, $this->ulpB] as $unit) {
                $this->umur($unit, $period, [[1, 100, 1000000], [2, 20, 400000], [3, 6, 250000], [4, 3, 3000000], [8, 2, 5000000]]);
            }
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar-umur?unit_id={$this->up3->id}&from=2026-01&to=2026-11")->assertOk()->json('data.detail');

        $this->assertSame(['receivable_aging', true, '2026-11', '2026-12'], [$d['kind'], $d['available'], $d['as_of_month'], $d['target_month']]);
        $this->assertEquals([100 * 2, 20 * 2, 6 * 2, 3 * 2, 2 * 2, 0], array_column($d['snapshot'], 'plg'));                      // dua ULP dijumlahkan
        $this->assertEquals(2 * (1000000 + 400000 + 250000 + 3000000 + 5000000), $d['rp_total']);
        $this->assertEqualsWithDelta((3000000 + 5000000) / (1000000 + 400000 + 250000 + 3000000 + 5000000) * 100, $d['over_3_pct'], 0.01);
        $rows = collect($d['rates']['rows'])->keyBy('key');
        $this->assertSame('plg', $d['rates']['basis']);
        $this->assertEquals(200.0, $rows['1 bulan']['rate']);                                                                    // kelas pertama: tingkat, bukan laju
        $this->assertEqualsWithDelta(20 / 120, $rows['2 bulan']['rate'], 1e-4);                                                  // 40 / (200 + 40)
        $this->assertEqualsWithDelta(6 / 26, $rows['3 bulan']['rate'], 1e-4);
        $this->assertEqualsWithDelta(3 / 9, $rows['4-6 bulan']['rate'], 1e-4);
        $this->assertEqualsWithDelta(2 / 5, $rows['7-12 bulan']['rate'], 1e-4);
        $this->assertEqualsWithDelta(20 / 120, $rows['2 bulan']['rate_last'], 1e-4);
        $this->assertCount(12, $d['history']);

        $f = $d['forecast'];
        $this->assertSame(['pelanggan', 'plg'], [$f['unit'], $f['basis']]);
        $this->assertEquals([200, 40, 12, 6, 4, 0], array_column($f['by_bucket'], 'value'));                                     // deret tetap diprakirakan tetap
        $this->assertEquals(10, $f['over_3_months']);
        $this->assertEquals(0.0, $d['forecast']['over_3_change_pct']);
        $this->assertGreaterThanOrEqual(6, $f['backtest']['months']);
        $this->assertFalse($f['reliable']);                                                                                       // sama dengan cara naif (kesalahan 0 dan 0): tidak lebih baik
        $this->assertSame(['ULP A', 'ULP B'], array_column($d['units'], 'unit_name'));
        $this->assertEqualsWithDelta(8000000 / 9650000 * 100, $d['units'][0]['over_3_pct'], 0.01);

        // tanpa laporan umur tunggakan
        $none = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar?unit_id={$this->up3->id}&from=2026-01&to=2026-11")->assertOk()->json('data.detail');
        $this->assertSame('receivable_aging', $none['kind']);
    }

    #[Test]
    public function wawasan_umur_tunggakan_tidak_tersedia_tanpa_laporan_dan_prakiraan_ditolak_bila_riwayat_pendek(): void
    {
        $this->umur($this->ulpA, '2026-10-01', [[1, 10, 100], [2, 5, 50]]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar-umur?unit_id={$this->ulpA->id}&from=2026-09&to=2026-10")->assertOk()->json('data.detail');
        $this->assertSame('2026-10', $d['as_of_month']);
        $this->assertFalse($d['forecast']['available']);                                                                          // satu bulan: belum ada transisi

        $empty = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/piutang-pascabayar-umur?unit_id={$this->ulpB->id}&from=2026-09&to=2026-10")->assertOk()->json('data.detail');
        $this->assertFalse($empty['available']);
        $this->assertStringContainsString('Belum ada laporan umur tunggakan', $empty['reason']);
    }

    #[Test]
    public function wawasan_pelunasan_prr_membagi_rupiah_menurut_umur_bulan_tagihan_dan_hanya_unit_dalam_cakupan(): void
    {
        $line = fn (string $blth, float $rp) => [$blth, ['rp_prr' => $rp, 'rpptl' => $rp, 'pelanggan' => 1, 'transaksi' => 1]];
        // dibayar Maret 2026: BLTH Maret 2026 (umur 0), Desember 2025 (3), September 2025 (6), Maret 2025 (12), Maret 2024 (24), Januari 2023 (38)
        $this->report($this->ulpA, 'PRR', '2026-03-01', [$line('202603', 100), $line('202512', 200), $line('202509', 300), $line('202503', 400), $line('202403', 500), $line('202301', 600)], ['pelanggan' => 6, 'transaksi' => 6, 'sampai_tanggal' => 20260331]);
        $this->report($this->ulpB, 'PRR', '2026-03-01', [$line('202603', 50)], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);
        $this->report($this->ulpA, 'EXPRR', '2026-03-01', [$line('202601', 70)], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');

        $this->assertSame(['repayment_age', 2], [$d['kind'], $d['files']]);
        $this->assertEquals(2150, $d['rp_total']);
        $rows = collect($d['rows'])->pluck('rp', 'key')->all();
        $this->assertEquals(['0 sampai 3 bulan' => 350, '4 sampai 6 bulan' => 300, '7 sampai 12 bulan' => 400, '13 sampai 24 bulan' => 500, 'lebih dari 24 bulan' => 600], $rows);
        $this->assertEqualsWithDelta(350 / 2150 * 100, $d['rows'][0]['share_pct'], 0.01);
        $this->assertSame(['2026-03'], array_column($d['monthly'], 'month'));

        $ex = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-ex-prr?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');
        $this->assertEquals(70, $ex['rp_total']);
        $this->assertEquals(70, collect($ex['rows'])->firstWhere('key', '0 sampai 3 bulan')['rp']);                              // BLTH Januari dibayar Maret: umur 2
        $viewer = $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');
        $this->assertEquals(2100, $viewer['rp_total']);                                                                           // peran ULP hanya melihat ULP-nya
    }

    #[Test]
    public function wawasan_pelunasan_prr_menghitung_tingkat_pemulihan_dari_saldo_daftar_prr_hanya_bila_semua_unit_lengkap(): void
    {
        $saldo = fn (OrganizationalUnit $u, string $period, array $perYear) => $this->report($u, 'DAFTAR_PRR', $period,
            array_map(fn ($y, $rp) => [(string) $y, ['rp_prr' => $rp, 'baris' => 2]], array_keys($perYear), $perYear), ['pelanggan' => 3, 'baris' => 4, 'lembar' => 9, 'rp_prr' => array_sum($perYear)]);
        $saldo($this->ulpA, '2025-12-01', [2024 => 700, 2025 => 400]);          // 1.100
        $saldo($this->ulpB, '2025-12-01', [2025 => 600]);
        $saldo($this->ulpA, '2026-02-01', [2024 => 600, 2025 => 400]);          // 1.000
        $saldo($this->ulpB, '2026-02-01', [2025 => 500]);
        $saldo($this->ulpA, '2026-03-01', [2024 => 500, 2025 => 400]);          // 900
        $saldo($this->ulpB, '2026-03-01', [2025 => 400]);
        $saldo($this->ulpA, '2026-04-01', [2024 => 450]);                       // April: ULP B belum ditarik, bulan tidak dihitung untuk UP3
        $line = fn (string $blth, float $rp) => [$blth, ['rp_prr' => $rp, 'rpptl' => $rp, 'pelanggan' => 1, 'transaksi' => 1]];
        $this->report($this->ulpA, 'PRR', '2026-03-01', [$line('202601', 100)], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);
        $this->report($this->ulpB, 'PRR', '2026-03-01', [$line('202602', 50)], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260331]);

        $r = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2026-01&to=2026-04")->assertOk()->json('data.detail.recovery');

        $this->assertTrue($r['available']);
        $this->assertSame(['2026-03', 1300.0], [$r['latest_month'], (float) $r['saldo_rp']]);                                      // April tidak lengkap: saldo terakhir yang lengkap adalah Maret
        $months = collect($r['monthly'])->keyBy('month');
        $this->assertSame(['2025-12', '2026-02', '2026-03'], $months->keys()->all());
        $this->assertNull($months['2026-02']['recovery_pct']);                                                                    // Januari tanpa saldo dan Februari tanpa laporan pelunasan
        $this->assertEquals([1500, 150, 10.0], [$months['2026-03']['opening_rp'], $months['2026-03']['repaid_rp'], $months['2026-03']['recovery_pct']]);   // 150 / saldo Februari 1.500
        $this->assertEquals([1700, 150, 8.82], [$r['ytd']['opening_rp'], $r['ytd']['repaid_rp'], $r['ytd']['recovery_pct']]);
        $byYear = collect($r['by_billing_year'])->keyBy('year');
        $this->assertEquals([500, 38.46, 0], [$byYear[2024]['saldo_rp'], $byYear[2024]['share_pct'], $byYear[2024]['repaid_ytd_rp']]);   // saldo 2024 = 500 dari 1.300; belum ada pelunasan BLTH 2024
        $this->assertEquals([800, 0], [$byYear[2025]['saldo_rp'], $byYear[2025]['repaid_ytd_rp']]);

        $own = $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->json('data.detail.recovery');
        $this->assertSame('2026-04', $own['latest_month']);                                                                       // satu ULP: April lengkap
        $this->assertEquals(10.0, collect($own['monthly'])->firstWhere('month', '2026-03')['recovery_pct']);                      // 100 / 1.000

        $empty = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-prr?unit_id={$this->up3->id}&from=2025-11&to=2025-11")->assertOk()->json('data.detail.recovery');   // belum ada saldo sampai November 2025
        $this->assertFalse($empty['available']);
        $ex = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-ex-prr?unit_id={$this->up3->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');
        $this->assertFalse($ex['recovery']['available']);                                                                         // laporan Penghapusan PRR belum ditarik
    }

    #[Test]
    public function wawasan_pelunasan_ex_prr_memperkirakan_saldo_dari_penghapusan_prr_dikurangi_pelunasan_hanya_bulan_yang_lengkap(): void
    {
        $hapus = fn (OrganizationalUnit $u, string $period, int $tahun, float $rp) => $this->report($u, 'HAPUS_PRR', $period, [[(string) $tahun, ['rp_prr' => $rp, 'baris' => 1]]], ['pelanggan' => 2, 'baris' => 1, 'lembar' => 3, 'rp_prr' => $rp]);
        $bayar = fn (OrganizationalUnit $u, string $period, float $rp) => $this->report($u, 'EXPRR', $period, [['202001', ['rp_prr' => $rp, 'rpptl' => $rp, 'pelanggan' => 1, 'transaksi' => 1]]], ['pelanggan' => 1, 'transaksi' => 1, 'sampai_tanggal' => 20260131]);
        $hapus($this->ulpA, '2026-01-01', 2018, 400);
        $hapus($this->ulpB, '2026-01-01', 2019, 600);
        $bayar($this->ulpA, '2026-01-01', 30);
        $bayar($this->ulpB, '2026-01-01', 20);
        $hapus($this->ulpA, '2026-02-01', 2018, 100);                                        // Februari: ULP B belum ditarik, bulan tidak dihitung untuk UP3
        $bayar($this->ulpA, '2026-02-01', 10);

        $r = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelunasan-ex-prr?unit_id={$this->up3->id}&from=2026-01&to=2026-02")->assertOk()->json('data.detail.recovery');

        $this->assertTrue($r['available']);
        $this->assertTrue($r['estimated']);
        $this->assertEquals(['2026-01', '2026-01', 1000, 50, 950, 5.0], [$r['since_month'], $r['latest_month'], $r['cumulative_written_off_rp'], $r['cumulative_repaid_rp'], $r['estimated_balance_rp'], $r['recovery_pct']]);
        $this->assertCount(1, $r['monthly']);
        $this->assertEquals([1000, 50, 950], [$r['monthly'][0]['written_off_rp'], $r['monthly'][0]['repaid_rp'], $r['monthly'][0]['estimated_balance_rp']]);
        $this->assertEquals([400, 600], collect($r['by_billing_year'])->pluck('written_off_rp')->all());

        $own = $this->as($this->viewer)->getJson("/api/pengusahaan/metrics/pelunasan-ex-prr?unit_id={$this->ulpA->id}&from=2026-01&to=2026-02")->assertOk()->json('data.detail.recovery');
        $this->assertEquals([500, 40, 460, 8.0], [$own['cumulative_written_off_rp'], $own['cumulative_repaid_rp'], $own['estimated_balance_rp'], $own['recovery_pct']]);   // satu ULP: Februari ikut
    }

    #[Test]
    public function pendapatan_bp_nko_memakai_penerimaan_dikurangi_restitusi_dari_rekap_bp_hanya_bila_semua_bulan_dan_ulp_lengkap(): void
    {
        $bp = fn (OrganizationalUnit $u, string $period, float $terima, float $restitusi) => $this->report($u, 'BP_REKAP', $period, [['B PENERIMAAN', ['jml' => 1, 'rp_bp' => $terima]], ['G RESTITUSI', ['jml' => 1, 'rp_bp' => $restitusi]]],
            ['penerimaan_rp' => $terima, 'restitusi_rp' => $restitusi, 'kas_rp' => $terima - $restitusi]);
        $bp($this->ulpA, '2026-01-01', 1_000_000_000, 100_000_000);
        $bp($this->ulpA, '2026-02-01', 500_000_000, 0);
        $bp($this->ulpB, '2026-01-01', 300_000_000, 50_000_000);                      // ULP B Februari belum ditarik
        $resolver = app(NkoRealizationResolver::class);
        $code = 'pendapatan-biaya-penyambungan';

        $this->assertEqualsWithDelta(0.9, $resolver->systemValues($this->ulpA->id, 2026, 1)[$code], 1e-9);          // (1.000 - 100) juta
        $this->assertEqualsWithDelta(1.4, $resolver->systemValues($this->ulpA->id, 2026, 2)[$code], 1e-9);          // kumulatif Januari + Februari
        $this->assertEqualsWithDelta(0.9 + 0.25, $resolver->systemValues($this->up3->id, 2026, 1)[$code], 1e-9);   // UP3 = jumlah ULP
        $this->assertArrayNotHasKey($code, $resolver->systemValues($this->up3->id, 2026, 2));                     // satu ULP kosong: kosong, bukan jumlah sebagian
    }

    /** Laporan 309 satu ULP dengan angka per golongan: [pelanggan, kWh, rupiah]. */
    private function groupSales(OrganizationalUnit $unit, string $period, array $groups): void
    {
        $lines = [];
        $total = ['pelanggan' => 0, 'kwh_jumlah' => 0, 'rp_jumlah' => 0, 'daya_va' => 1];
        foreach ($groups as $g => [$plg, $kwh, $rp]) {
            $lines[] = ["JUMLAH {$g}", ['pelanggan' => $plg, 'kwh_jumlah' => $kwh, 'rp_jumlah' => $rp, 'daya_va' => 1]];
            $total['pelanggan'] += $plg;
            $total['kwh_jumlah'] += $kwh;
            $total['rp_jumlah'] += $rp;
        }
        $lines[] = ['JUMLAH', $total];
        $this->report($unit, '309', $period, $lines);
    }

    #[Test]
    public function pemecahan_kwh_jual_dan_pendapatan_tepat_menjumlah_ke_perubahan_dan_hanya_membandingkan_ulp_setara(): void
    {
        // Oktober 2025 lawan Oktober 2026, dua golongan: R (1000 -> 1100 pelanggan, 10 -> 11 kWh/plg, Rp 1.000 -> 1.100/kWh) dan I (100 -> 100 pelanggan, 100 -> 100 kWh/plg, Rp 1.200/kWh tetap)
        foreach ([$this->ulpA, $this->ulpB] as $u) {
            $this->groupSales($u, '2025-10-01', ['R' => [1000, 10000, 10000 * 1000], 'I' => [100, 10000, 10000 * 1200]]);
            $this->groupSales($u, '2026-10-01', ['R' => [1100, 12100, 12100 * 1100], 'I' => [100, 10000, 10000 * 1200]]);
        }
        $this->groupSales($this->ulpA, '2026-09-01', ['R' => [1, 1, 1]]);                                                    // ULP A saja punya September 2026, tanpa pembanding 2025: dilewati pada tahun berjalan

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->up3->id}&from=2026-09&to=2026-10")->assertOk()->json('data.detail');

        $this->assertSame(['sales_decomposition', true, 'kwh-jual', '2026-10', '2025-10'], [$d['kind'], $d['available'], $d['focus'], $d['month']['month'], $d['month']['previous']]);
        $k = $d['month']['kwh'];
        $this->assertEqualsWithDelta(2 * (12100 + 10000 - 20000), $k['change'], 1e-6);
        $this->assertEqualsWithDelta($k['change'], $k['customers'] + $k['mix'] + $k['intensity'] + $k['residual'], 1e-6);   // jumlah efek = perubahan
        $this->assertEqualsWithDelta(0.0, $k['residual'], 1e-6);
        $mean0 = 20000 / 1100;                                                                                                // kWh per pelanggan rata-rata tahun lalu
        $this->assertEqualsWithDelta(2 * (1200 - 1100) * $mean0, $k['customers'], 1e-6);
        $this->assertEqualsWithDelta(2 * 1100 * (11 - 10), $k['intensity'], 1e-6);                                          // hanya R yang berubah konsumsinya: 1 kWh lebih banyak per pelanggan R tahun ini
        $this->assertLessThan(0, $k['mix']);                                                                                  // porsi pelanggan R naik, padahal R berkonsumsi jauh lebih kecil per pelanggan daripada I
        $r = $d['month']['rp'];
        $this->assertEqualsWithDelta($r['change'], $r['volume'] + $r['mix'] + $r['price'] + $r['residual'], 1e-3);
        $this->assertEqualsWithDelta(0.0, $r['residual'], 1e-3);
        $this->assertGreaterThan(0, $r['price']);                                                                            // Rp per kWh golongan R naik 1.000 menjadi 1.100
        $groups = collect($d['month']['groups'])->keyBy('key');
        $this->assertEqualsWithDelta(100.0, $groups['R']['kwh_share_of_change_pct'], 0.1);                                  // seluruh perubahan kWh berasal dari R
        $this->assertSame(0, (int) $groups['I']['kwh_change']);
        $this->assertSame(['2026-10'], $d['ytd']['months']);                                                                // September 2026 tanpa pembanding dilewati
        $this->assertEqualsWithDelta($k['change'], $d['ytd']['kwh']['change'], 1e-6);
        $this->assertEqualsWithDelta($d['ytd']['rp']['change'], $d['ytd']['rp']['volume'] + $d['ytd']['rp']['mix'] + $d['ytd']['rp']['price'], 1e-3);

        $rp = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pendapatan?unit_id={$this->up3->id}&from=2026-09&to=2026-10")->assertOk()->json('data.detail');
        $this->assertSame('pendapatan', $rp['focus']);
        $this->assertSame('customer_growth', $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pelanggan?unit_id={$this->up3->id}&from=2026-09&to=2026-10")->assertOk()->json('data.detail.kind'));   // bukan blok pemecahan penjualan
        $none = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpB->id}&from=2024-01&to=2024-02")->assertOk()->json('data.detail');
        $this->assertFalse($none['available']);
    }

    #[Test]
    public function catatan_pemecahan_menandai_efek_dasar_rendah_dan_pergeseran_golongan(): void
    {
        // 2025: Januari dan Februari berharga rendah (diskon), bulan lain 900/kWh; 2026 semuanya 900/kWh. Golongan I: pelanggan 100 -> 150 tetapi kWh/plg 1000 -> 700
        foreach (range(1, 12) as $m) {
            $price = $m <= 2 ? 500 : 900;
            $this->groupSales($this->ulpA, sprintf('2025-%02d-01', $m), ['R' => [1000, 10000, 10000 * $price], 'I' => [100, 100000, 100000 * $price]]);
        }
        foreach ([1, 2, 3] as $m) {
            $this->groupSales($this->ulpA, sprintf('2026-%02d-01', $m), ['R' => [1000, 10000, 10000 * 900], 'I' => [150, 105000, 105000 * 900]]);
        }

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pendapatan?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03")->assertOk()->json('data.detail');

        $findings = collect($d['findings'])->keyBy('kind');
        $this->assertStringContainsString('2026-01, 2026-02', $findings['base_effect']['text']);
        $this->assertStringContainsString('hanya 500 lawan 900', $findings['base_effect']['text']);
        $this->assertSame('perhatian', $findings['base_effect']['level']);
        $this->assertStringContainsString('Golongan Industri: pelanggan naik 50% (100 menjadi 150) tetapi kWh per pelanggan turun 30% (1.000 menjadi 700 kWh)', $findings['group_shift']['text']);
        $this->assertCount(3, $d['monthly']);
        $this->assertGreaterThan(0, $d['monthly'][0]['rp']['price']);                                                        // Januari 2026 lawan Januari 2025 yang berdiskon

        // tanpa efek dasar rendah dan tanpa pergeseran: tidak ada catatan
        foreach (range(1, 12) as $m) {
            $this->groupSales($this->ulpB, sprintf('2025-%02d-01', $m), ['R' => [1000, 10000, 9000000]]);
        }
        $this->groupSales($this->ulpB, '2026-01-01', ['R' => [1000, 10000, 9000000]]);
        $this->assertSame([], $this->as($this->planner)->getJson("/api/pengusahaan/metrics/pendapatan?unit_id={$this->ulpB->id}&from=2026-01&to=2026-01")->assertOk()->json('data.detail.findings'));
    }

    #[Test]
    public function penanda_idul_fitri_tampil_pada_bulan_dalam_rentang(): void
    {
        $this->sales($this->ulpA, '2026-02-01', 1, 0);
        $this->sales($this->ulpA, '2026-03-01', 1, 0);

        $e = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/kwh-jual?unit_id={$this->ulpA->id}&from=2026-01&to=2026-04")->assertOk()->json('data.events');

        $this->assertSame([['month' => '2026-03', 'kind' => 'idul_fitri', 'label' => 'Idul Fitri']], $e);
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
