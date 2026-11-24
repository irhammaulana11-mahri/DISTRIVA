<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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
        $this->assertEqualsWithDelta(-20.0, $s['yoy_pct'], 1e-9);
        $this->assertEquals(290, $s['ytd']);   // kumulatif memakai bulan yang ada; ULP B Februari kosong dilaporkan pada kelengkapan
        $this->assertEquals(300, $s['ytd_previous_year']);
        $this->assertSame('Rumah tangga', $d['breakdown']['rows'][0]['key']);
        $this->assertEqualsWithDelta(75.0, $d['breakdown']['rows'][0]['share_pct'], 1e-9);
        $this->assertSame(['ULP A', 'ULP B'], array_column($d['comparison'], 'unit_name'));
        $this->assertSame([['unit_id' => $this->ulpB->id, 'unit_name' => 'ULP B', 'months' => ['2026-02']]], $d['coverage']['missing']);
        $this->assertSame('perhatian', $d['insights'][0]['level']);
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
}
