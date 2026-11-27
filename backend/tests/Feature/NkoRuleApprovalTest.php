<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Nko\NkoDefinitionImportService;
use App\Services\Nko\NkoRealizationResolver;
use App\Services\Nko\NkoRealizationRules;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\NkoPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\Concerns\BuildsNkoWorkbook;
use Tests\PostgresTestCase;

class NkoRuleApprovalTest extends PostgresTestCase
{
    use BuildsNkoWorkbook;

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    private User $planner;

    private User $asman;

    private User $viewer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(NkoPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->up3->forceFill(['code' => '51MJK', 'name' => 'UP3 Mojokerto'])->save();
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $this->ulp->forceFill(['code' => '51453', 'name' => 'ULP Jombang'])->save();
        $this->planner = $this->actor('PERENCANAAN', $this->up3);
        $this->asman = $this->actor('ASMAN_PERENCANAAN', $this->up3);
        $this->viewer = $this->actor('MANAGER_ULP', $this->ulp);
        app(NkoDefinitionImportService::class)->import($this->workbook(['UP3 MOJOKERTO', 'ULP JOMBANG']), 'nko.xlsx');
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

    private function payload(array $override = []): array
    {
        return $override + ['definition_code' => 'saidi', 'mode' => 'SISTEM', 'formula' => 'menit_padam / 10', 'inputs' => [['code' => 'menit_padam', 'name' => 'Menit padam', 'unit_label' => 'menit']],
            'effective_from' => '2026-01', 'is_validated' => true, 'reason' => 'Cara hitung baru'];
    }

    private function manual(string $code, int $month, float $value): void
    {
        DB::table('kpi_manual_inputs')->insert(['id' => (string) Str::uuid7(), 'definition_code' => $code, 'organizational_unit_id' => $this->ulp->id, 'period' => sprintf('2026-%02d-01', $month), 'value' => $value, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function items(int $month): array
    {
        return array_column($this->as($this->planner)->getJson("/api/nko/inputs?unit_id={$this->ulp->id}&year=2026&month={$month}")->assertOk()->json('data.items'), null, 'code');
    }

    #[Test]
    public function aturan_baru_berlaku_hanya_setelah_disetujui_asman_dan_hanya_mulai_bulannya(): void
    {
        $id = $this->as($this->planner)->postJson('/api/nko/rule-proposals', $this->payload())->assertCreated()->json('data.id');
        $this->assertSame('saidi_menit', app(NkoRealizationRules::class)->forPeriod(2026, 1)['saidi']->formula);                 // belum disetujui
        $this->as($this->planner)->postJson('/api/nko/rule-proposals', $this->payload())->assertStatus(409);                       // masih menunggu
        $this->as($this->planner)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertForbidden();
        $this->as($this->viewer)->postJson('/api/nko/rule-proposals', $this->payload(['effective_from' => '2026-03']))->assertForbidden();
        $this->as($this->actor('PERENCANAAN', $this->ulp))->postJson('/api/nko/rule-proposals', $this->payload(['effective_from' => '2026-03']))->assertForbidden();   // peran tingkat ULP

        $this->as($this->asman)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertOk()->assertJsonPath('data.status', 'DISETUJUI');
        $this->as($this->asman)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertStatus(409);

        $gaps = fn () => array_column(array_column($this->as($this->planner)->getJson('/api/nko/gaps?year=2026&month=1')->assertOk()->json('data.units'), null, 'unit_id')[$this->ulp->id]['items'], 'status', 'code');
        $this->assertSame('KOSONG', $gaps()['saidi']);                                                                           // mode SISTEM yang kosong tetap dilaporkan
        $this->manual('menit_padam', 1, 40);
        $this->manual('saidi', 1, 99);                                                                                              // mode SISTEM: masukan manual diabaikan
        $this->assertSame('saidi_menit', app(NkoRealizationRules::class)->forPeriod(2025, 12)['saidi']->formula);       // sebelum bulan berlaku
        $resolved = app(NkoRealizationResolver::class)->resolve($this->ulp->id, 2026, 1);
        $this->assertSame('SISTEM', $resolved['saidi']['source']);
        $this->assertEqualsWithDelta(4.0, $resolved['saidi']['value'], 1e-9);

        $items = $this->items(1);
        $this->assertSame('SISTEM', $items['saidi']['mode']);
        $this->assertFalse($items['saidi']['editable']);
        $this->assertTrue($items['menit_padam']['editable']);
        $this->as($this->planner)->putJson('/api/nko/inputs', ['unit_id' => $this->ulp->id, 'year' => 2026, 'month' => 1, 'items' => [['code' => 'saidi', 'value' => 1, 'note' => 'x']]])->assertStatus(422);

        $snapshot = $this->as($this->planner)->postJson('/api/nko/calculate', ['unit_id' => $this->ulp->id, 'year' => 2026, 'month' => 1])->assertOk()->json('data.0.snapshot_id');
        $values = array_column($this->as($this->planner)->getJson("/api/nko/snapshots/{$snapshot}")->json('data.values'), null, 'code');
        $this->assertSame('menit_padam / 10', $values['saidi']['formula']);

        $list = $this->as($this->viewer)->getJson('/api/nko/rule-proposals?status=DISETUJUI')->assertOk()->json('data');
        $this->assertSame('SAIDI', $list[0]['definition_name']);
        $this->assertSame($this->asman->id, $list[0]['decided_by']['id']);
    }

    #[Test]
    public function pengusul_tidak_boleh_memutus_sendiri_dan_penolakan_butuh_alasan(): void
    {
        $this->assign($this->planner, Role::query()->where('name', 'ASMAN_PERENCANAAN')->firstOrFail(), $this->up3);
        $id = $this->as($this->planner)->postJson('/api/nko/rule-proposals', $this->payload())->assertCreated()->json('data.id');
        $this->as($this->planner)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertStatus(409);
        $this->as($this->asman)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'reject'])->assertStatus(422);
        $this->as($this->asman)->deleteJson("/api/nko/rule-proposals/{$id}")->assertForbidden();                                   // asman bukan pengusul
        $this->as($this->asman)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'reject', 'note' => 'Belum cocok'])->assertOk()->assertJsonPath('data.status', 'DITOLAK');
        $this->assertSame(0, DB::table('kpi_realization_rules')->where('formula', 'menit_padam / 10')->count());

        $second = $this->as($this->planner)->postJson('/api/nko/rule-proposals', $this->payload())->assertCreated()->json('data.id');
        $this->as($this->planner)->deleteJson("/api/nko/rule-proposals/{$second}")->assertOk();
        $this->assertSame('DIBATALKAN', DB::table('kpi_rule_proposals')->where('id', $second)->value('status'));
    }

    #[Test]
    public function sys_admin_boleh_menyetujui_usulannya_sendiri(): void
    {
        $admin = $this->makeUser();
        $this->assign($admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);     // SYS_ADMIN tidak terikat unit
        $id = $this->as($admin)->postJson('/api/nko/rule-proposals', $this->payload())->assertCreated()->json('data.id');

        $this->as($admin)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertOk()->assertJsonPath('data.status', 'DISETUJUI');
    }

    #[Test]
    public function usulan_yang_tidak_sah_ditolak(): void
    {
        $bad = [
            ['formula' => 'system(1)'], ['formula' => 'besaran_asing + 1', 'inputs' => []], ['formula' => ''], ['formula' => 'saidi_menit', 'inputs' => [['code' => 'tidak_dipakai', 'name' => 'X']]],
            ['formula' => 'saidi + 1', 'inputs' => [['code' => 'saidi', 'name' => 'X']]], ['formula' => 'kwh_jual', 'inputs' => [['code' => 'kwh_jual', 'name' => 'X']]], ['definition_code' => 'tidak-ada'],
            ['mode' => 'OTOMATIS'], ['mode' => 'MANUAL'], ['replaces_code' => 'saidi'], ['replaces_code' => 'tidak-ada'],
        ];
        foreach ($bad as $override) {
            $this->as($this->planner)->postJson('/api/nko/rule-proposals', $this->payload($override))->assertStatus(422);
        }
        $this->assertSame(0, DB::table('kpi_rule_proposals')->count());
    }

    #[Test]
    public function mode_manual_mematikan_sumber_otomatis_dan_item_berganti_nama_mengikuti_penggantinya(): void
    {
        $approve = function (array $payload) {
            $id = $this->as($this->planner)->postJson('/api/nko/rule-proposals', $payload)->assertCreated()->json('data.id');

            return $this->as($this->asman)->postJson("/api/nko/rule-proposals/{$id}/decision", ['decision' => 'approve'])->assertOk()->json('data');
        };
        $approve($this->payload(['mode' => 'MANUAL', 'formula' => null, 'inputs' => []]));
        $items = $this->items(1);
        $this->assertSame('MANUAL', $items['saidi']['mode']);
        $this->assertFalse($items['saidi']['system_source']);
        $this->assertTrue($items['saidi']['editable']);

        $this->manual('saidi', 3, 7);
        app(NkoDefinitionImportService::class)->import($this->workbook(['UP3 MOJOKERTO', 'ULP JOMBANG'], saidiName: 'SAIDI Distribusi'), 'nko-rev.xlsx');
        $result = $approve($this->payload(['definition_code' => 'saidi-distribusi', 'mode' => 'SISTEM_BOLEH_KOREKSI', 'formula' => 'saidi_menit', 'inputs' => [], 'effective_from' => '2026-03', 'replaces_code' => 'saidi']));
        $this->assertSame(1, $result['copied_inputs']);
        $this->assertEqualsWithDelta(7.0, (float) DB::table('kpi_manual_inputs')->where('definition_code', 'saidi-distribusi')->value('value'), 1e-9);
        $this->assertSame(1, DB::table('kpi_manual_inputs')->where('definition_code', 'saidi')->count());                          // disalin, bukan dipindah

        $rules = app(NkoRealizationRules::class);
        $this->assertSame('saidi-distribusi', $rules->successor('saidi', 2026, 3));
        $this->assertNull($rules->successor('saidi', 2026, 2));
        $mapping = $this->as($this->viewer)->getJson('/api/nko/rules/mapping?year=2026')->assertOk()->json('data');
        $this->assertNotContains('saidi', array_column($mapping['orphaned'], 'code'));
    }

    #[Test]
    public function daftar_aturan_katalog_dan_pratinjau(): void
    {
        $rules = array_column($this->as($this->viewer)->getJson('/api/nko/rules?year=2026&month=1')->assertOk()->json('data.items'), null, 'definition_code');
        $this->assertSame('saidi_menit', $rules['saidi']['formula']);
        $this->assertSame(['UP3', 'ULP'], $rules['saidi']['levels']);

        $catalog = $this->as($this->viewer)->getJson('/api/nko/rules/catalog')->assertOk()->json('data');
        $this->assertContains('kwh_jual', array_column($catalog['quantities'], 'name'));
        $this->assertContains('atau', array_column($catalog['functions'], 'name'));

        $this->manual('menit_padam', 1, 40);
        $definition = DB::table('kpi_definitions as d')->join('kpi_definition_sets as s', 's.id', '=', 'd.set_id')->where('s.unit_level', 'ULP')->where('s.status', 'AKTIF')->where('d.code', 'saidi')->value('d.id');
        DB::table('kpi_reference_values')->updateOrInsert(['definition_id' => $definition, 'organizational_unit_id' => $this->ulp->id, 'period' => '2026-01-01'], ['realisasi' => 4.01]);
        $preview = $this->as($this->viewer)->postJson('/api/nko/rules/preview', ['definition_code' => 'saidi', 'formula' => 'menit_padam / 10', 'inputs' => [['code' => 'menit_padam', 'name' => 'Menit padam']], 'year' => 2026, 'to_month' => 1])->assertOk()->json('data');
        $rows = array_column($preview['rows'], null, 'unit_type');       // ULP sendiri dan UP3 induknya
        $this->assertTrue($rows['ULP']['matches']);
        $this->assertNull($rows['UP3']['matches']);                      // tidak ada angka acuan UP3
        $this->assertSame(1, $preview['summary']['matched']);
        $this->as($this->viewer)->postJson('/api/nko/rules/preview', ['definition_code' => 'saidi', 'formula' => 'asing + 1', 'year' => 2026])->assertStatus(422);
        $this->assertSame(0, DB::table('kpi_rule_proposals')->count());

        $this->assertTrue($this->as($this->planner)->getJson('/api/planning/access')->json('can')['nko.rules.propose']);
        $this->assertFalse($this->as($this->planner)->getJson('/api/planning/access')->json('can')['nko.rules.approve']);
    }
}
