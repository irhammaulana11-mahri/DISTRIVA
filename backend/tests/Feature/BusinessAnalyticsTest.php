<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoRealizationResolver;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class BusinessAnalyticsTest extends PostgresTestCase
{
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

    /** Laporan DIFI satu bulan: ringkasan (SAIDI menit, SAIFI) dan baris TOTAL KELOMPOK Distribusi (jumlah gangguan, ENS kWh). */
    private function difi(OrganizationalUnit $unit, string $period, float $saidi, float $saifi, int $count, float $ensKwh): void
    {
        $this->report($unit, 'DIFI', $period, [['TOTAL KELOMPOK Distribusi', ['jumlah_gangguan' => $count, 'kwh_tak_tersalurkan' => $ensKwh]]], ['pelanggan' => 150, 'saidi_menit' => $saidi, 'saifi_kali' => $saifi]);
    }

    #[Test]
    public function saidi_saifi_ens_dan_gangguan_dibandingkan_dengan_data_gangguan_tersinkron_secara_kumulatif(): void
    {
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $f2 = $this->feederOf($this->ulpA, 'F2');
        $this->feederCustomers($f1, $this->ulpA, 100);
        $this->feederCustomers($f2, $this->ulpA, 50);
        $this->outage($f1, $this->ulpA, '2026-01-10', 'PERMANEN', 60, 500);
        $this->outage($f2, $this->ulpA, '2026-01-12', 'PERMANEN', 30, 200);
        $this->outage($f1, $this->ulpA, '2026-02-03', 'TEMPORER', 10, 100);
        foreach ([['2026-01-01', 40, 0.8, 2, 600], ['2026-02-01', 7, 0.7, 1, 100], ['2026-03-01', 0, 0, 0, 0]] as [$period, $saidi, $saifi, $count, $ens]) {
            $this->difi($this->ulpA, $period, $saidi, $saifi, $count, $ens);
        }
        $url = fn (string $code) => "/api/pengusahaan/metrics/{$code}?unit_id={$this->ulpA->id}&from=2026-01&to=2026-03";

        $d = $this->as($this->planner)->getJson($url('saidi-saifi'))->assertOk()->json('data');
        $this->assertSame(['kind' => 'OUTAGES', 'endpoint' => '/outages/forecast'], $d['forecast']);
        $hitung = collect($d['companions']['series'])->keyBy('key');
        $this->assertEqualsWithDelta(50.0, $hitung['saidi_hitung']['values'][0], 1e-6);                  // (100*60 + 50*30) / 150
        $this->assertEqualsWithDelta(1000 / 150, $hitung['saidi_hitung']['values'][1], 1e-6);
        $this->assertEqualsWithDelta(0.0, $hitung['saidi_hitung']['values'][2], 1e-9);                   // bulan tanpa gangguan = 0, bukan kosong
        $this->assertSame(['saidi', 'saifi'], array_column($d['reconciliations'], 'key'));
        $this->assertSame('saidi', $d['reconciliation']['key']);
        $saidi = $d['reconciliations'][0]['ytd'];
        $this->assertEqualsWithDelta(47.0, $saidi['official_net'], 1e-9);                                 // jumlah nilai bulanan DIFI
        $this->assertEqualsWithDelta(50 + 1000 / 150, $saidi['companion'], 1e-6);
        $this->assertSame([1, 1], [$saidi['units_compared'], $saidi['units_expected']]);
        $this->assertSame('info', collect($d['insights'])->last()['level']);                              // 56,7 lawan 47: dalam kewajaran

        $ens = $this->as($this->planner)->getJson($url('ens'))->assertOk()->json('data');
        $this->assertEqualsWithDelta(0.7, $ens['reconciliation']['ytd']['official_net'], 1e-9);          // MWh
        $this->assertEqualsWithDelta(0.8, $ens['reconciliation']['ytd']['companion'], 1e-9);

        $g = $this->as($this->planner)->getJson($url('gangguan'))->assertOk()->json('data');
        $this->assertEquals([3.0, 3.0, 0.0], [$g['reconciliation']['ytd']['official_net'], $g['reconciliation']['ytd']['companion'], $g['reconciliation']['ytd']['difference']]);   // bulan tanpa gangguan tetap dihitung (nol)
        $this->assertSame('Jumlah gangguan Laporan DIFI', $g['reconciliation']['companion_name']);

        $rpt = $this->as($this->planner)->getJson($url('rpt-rct-gangguan'))->assertOk()->json('data');
        $this->assertNull($rpt['reconciliations']);                                                       // laporan pengaduan, bukan gangguan penyulang
    }

    #[Test]
    public function selisih_besar_antara_laporan_resmi_dan_data_gangguan_menjadi_catatan_perhatian(): void
    {
        $f1 = $this->feederOf($this->ulpA, 'F1');
        $this->feederCustomers($f1, $this->ulpA, 100);
        $this->outage($f1, $this->ulpA, '2026-01-10', 'PERMANEN', 60, 1000);          // data tersinkron: 1 MWh
        $this->difi($this->ulpA, '2026-01-01', 10, 0.1, 1, 100);                      // laporan resmi: 0,1 MWh

        $d = $this->as($this->planner)->getJson("/api/pengusahaan/metrics/ens?unit_id={$this->ulpA->id}&from=2026-01&to=2026-01")->assertOk()->json('data');

        $last = collect($d['insights'])->last();
        $this->assertSame('perhatian', $last['level']);
        $this->assertStringContainsString('1000% dari angka resmi', $last['text']);
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
    public function waktu_respons_gangguan_tertimbang_jumlah_kejadian_tanpa_baris_total(): void
    {
        $this->report($this->ulpA, 'GGNALL', '2026-03-01', [['POSKO A', ['total' => 10, 'response_rata_menit' => 20, 'recovery_rata_menit' => 60, 'response_dalam_sla' => 8, 'response_lewat_sla' => 2]],
            ['Total', ['total' => 10, 'response_rata_menit' => 20, 'recovery_rata_menit' => 60, 'response_dalam_sla' => 8, 'response_lewat_sla' => 2]]]);
        $this->report($this->ulpB, 'GGNALL', '2026-03-01', [['POSKO B', ['total' => 30, 'response_rata_menit' => 40, 'recovery_rata_menit' => 100, 'response_dalam_sla' => 15, 'response_lewat_sla' => 15]]]);

        $s = collect($this->as($this->planner)->getJson("/api/pengusahaan/metrics/rpt-rct-gangguan?unit_id={$this->up3->id}&from=2026-03&to=2026-03")->assertOk()->json('data.summary'))->keyBy('key');

        $this->assertEqualsWithDelta(35.0, $s['rpt']['latest'], 1e-9);   // (20x10 + 40x30) / 40
        $this->assertEqualsWithDelta(90.0, $s['rct']['latest'], 1e-9);
        $this->assertEquals(40, $s['jumlah']['latest']);
        $this->assertEqualsWithDelta(57.5, $s['rpt_sla']['latest'], 1e-9);
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
