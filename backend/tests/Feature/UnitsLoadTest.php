<?php

namespace Tests\Feature;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Services\EisReports\Ap2tTagsusSync;
use App\Services\Sync\SyncScope;
use App\Services\Sync\SyncUnitCodes;
use Database\Seeders\ApplicationPermissionSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class UnitsLoadTest extends PostgresTestCase
{
    private string $file;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ApplicationPermissionSeeder::class);
        $up3 = $this->makeUnit('UP3');
        $up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        foreach (['51452' => 'ULP Mojokerto', '51455' => 'ULP Ploso'] as $code => $name) {
            $this->makeUnit('ULP', $up3)->forceFill(['code' => $code, 'name' => $name])->save();
        }
        $this->file = tempnam(sys_get_temp_dir(), 'unit');
        $block = fn (string $key, array $rows) => json_encode(['error' => [['error' => '1']], $key => $rows], JSON_PRETTY_PRINT);
        $ap = fn (string $code, string $name) => ['UNITAP' => $code, 'NAMA' => $name, 'SATUAN' => 'UP3', 'ALAMAT' => 'JL. UJI', 'MANAGER' => 'ORANG RAHASIA'];
        $ulp = fn (string $code, string $name, string $parent) => ['UNITUP' => $code, 'UNITAP' => $parent, 'NAMA' => $name, 'SATUAN' => 'ULP', 'ALAMAT' => ''];
        file_put_contents($this->file, implode("\n", [
            $block('lUnitAp', [$ap('51MJK', 'MOJOKERTO'), $ap('51SBU', 'SURABAYA UTARA'), ['UNITAP' => 'SEMUA', 'NAMA' => 'SEMUA', 'SATUAN' => '']]),
            $block('lUnitUp', [$ulp('51452', 'MOJOKERTO UTARA', '51MJK'), $ulp('51455', 'PLOSO ', '51MJK')]),
            $block('lUnitUp', [$ulp('51101', 'PERAK', '51SBU'), $ulp('51102', 'PLOSO', '51SBU'), $ulp('51103', 'TANDES', '51SBU'), ['UNITUP' => 'SEMUA', 'NAMA' => 'SEMUA', 'SATUAN' => '']]),
        ]).$block('lUnitUp', [])."\n\n\nKODE UNIT APKT\ndata unit apkt\n".json_encode([['id' => 149, 'nama' => 'UP3 MOJOKERTO'], ['id' => 157, 'nama' => 'UP3 SURABAYA UTARA'], ['id' => 51101, 'nama' => 'ULP PERAK']], JSON_PRETTY_PRINT)."\n\nKODE UNIT MIMMS\n");      // seperti berkas asli
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        parent::tearDown();
    }

    #[Test]
    public function only_missing_units_are_added_and_a_dry_run_writes_nothing(): void
    {
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
        $default = SyncScope::defaultUp3();
        SyncScope::settings('eis_sync_settings', $default);      // seperti server yang sudah dimigrasi

        $this->artisan('distriva:units-load', ['file' => $this->file])->expectsOutputToContain('Akan ditambah: 1 UP3, 3 ULP.')->assertSuccessful();
        $this->artisan('distriva:units-load', ['file' => $this->file, '--apply' => true])->assertFailed();      // tanpa pelaku
        $this->assertSame(3, OrganizationalUnit::query()->count());

        $this->artisan('distriva:units-load', ['file' => $this->file, '--apply' => true, '--by' => $admin->email])
            ->expectsOutputToContain('51452 sudah ada sebagai "ULP Mojokerto"')->assertSuccessful();

        $this->assertSame(['ULP Perak', 'ULP Ploso (Surabaya Utara)', 'ULP Tandes'], OrganizationalUnit::query()->whereIn('code', ['51101', '51102', '51103'])->orderBy('code')->pluck('name')->all());
        $this->assertSame('ULP Mojokerto', OrganizationalUnit::query()->where('code', '51452')->value('name'));
        $this->assertSame(OrganizationalUnit::query()->where('code', '51SBU')->value('id'), OrganizationalUnit::query()->where('code', '51101')->value('parent_id'));
        $this->assertStringNotContainsString('RAHASIA', (string) json_encode(DB::table('organizational_units')->get()));
        $this->assertSame([149, 157], OrganizationalUnit::query()->whereIn('code', ['51MJK', '51SBU'])->orderBy('code')->pluck('apkt_id')->all());     // juga untuk UP3 yang sudah ada
        $this->assertSame($default, SyncScope::defaultUp3());     // UP3 utama tidak berpindah ke UP3 yang ULP-nya lebih banyak (setelah dimiliki pengaturan)
        $this->artisan('distriva:units-load', ['file' => $this->file, '--apply' => true, '--by' => $admin->email])->expectsOutputToContain('Akan ditambah: 0 UP3, 0 ULP.')->assertSuccessful();
    }

    #[Test]
    public function apkt_and_ap2t_use_the_codes_of_the_up3_that_syncs_never_those_of_the_main_up3(): void
    {
        $mojokerto = OrganizationalUnit::query()->where('code', '51MJK')->firstOrFail();
        SyncScope::settings('eis_sync_settings', $mojokerto->getKey());
        $other = $this->makeUnit('UP3');
        $other->forceFill(['code' => '51MLG', 'name' => 'UP3 Malang'])->save();
        config(['distriva.apkt.id_up3' => 149, 'distriva.ap2t.unitap' => '51MJK']);

        $this->assertSame(149, SyncUnitCodes::apkt($mojokerto->getKey())['id']);
        $this->assertSame(['51MJK', '51MLG', null, '51MLG'], [SyncUnitCodes::ap2t($mojokerto->getKey()), SyncUnitCodes::ap2t($other->getKey()), SyncUnitCodes::otherUp3Code($mojokerto->getKey()), SyncUnitCodes::otherUp3Code($other->getKey())]);
        try {
            SyncUnitCodes::apkt($other->getKey());
            $this->fail('UP3 tanpa id APKT harus ditolak.');
        } catch (AssignmentRuleViolation $e) {
            $this->assertStringContainsString('Id APKT untuk UP3 Malang belum diisi', $e->getMessage());
        }
        DB::table('organizational_units')->where('id', $other->getKey())->update(['apkt_id' => 148]);
        $this->assertSame(['id' => 148, 'name' => 'UP3 MALANG'], SyncUnitCodes::apkt($other->getKey()));

        Http::fake(['*' => Http::response('x', 500)]);
        try {
            app(Ap2tTagsusSync::class)->download('51401', '2026-10', 'realisasi', SyncUnitCodes::ap2t($other->getKey()));
        } catch (\Throwable) {
        }
        Http::assertSent(fn ($request) => str_contains($request->url(), 'unitap=51MLG') && str_contains($request->url(), 'unitup=51401'));
    }

    #[Test]
    public function the_main_up3_stays_with_the_owner_of_the_sync_settings(): void
    {
        $mojokerto = OrganizationalUnit::query()->where('code', '51MJK')->firstOrFail();
        SyncScope::settings('eis_sync_settings', $mojokerto->getKey());
        $bigger = $this->makeUnit('UP3');
        foreach (range(1, 4) as $_) {
            $this->makeUnit('ULP', $bigger);
        }

        $this->assertSame($mojokerto->getKey(), SyncScope::defaultUp3());
    }
}
