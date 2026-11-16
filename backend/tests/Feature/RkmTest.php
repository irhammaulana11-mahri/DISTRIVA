<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\PlanningPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class RkmTest extends PostgresTestCase
{
    private $up3;

    private $ulp1;

    private $ulp2;

    private User $perencanaan;

    private User $konstruksi;

    private User $manager;

    private User $teknik1;

    private User $teknik2;

    private User $mgr1;

    private User $mgr2;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanningPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulp1 = $this->makeUnit('ULP', $this->up3);
        $this->ulp2 = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role, $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->perencanaan = $mk('PERENCANAAN', $this->up3);
        $this->konstruksi = $mk('KONSTRUKSI', $this->up3);
        $this->manager = $mk('MANAGER_UP3', $this->up3);
        $this->teknik1 = $mk('TEKNIK', $this->ulp1);
        $this->teknik2 = $mk('TEKNIK', $this->ulp2);
        $this->mgr1 = $mk('MANAGER_ULP', $this->ulp1);
        $this->mgr2 = $mk('MANAGER_ULP', $this->ulp2);
        $this->vendor = $mk('VENDOR', $this->ulp1);
        foreach ([1, 2] as $code) {
            DB::table('khs_items')->insert(['id' => (string) Str::uuid(), 'code' => (string) $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    /** @return array{version:string, p1:string, p2:string} */
    private function plan(): array
    {
        $r = $this->as($this->perencanaan)->postJson('/api/rkm/plans', ['up3_unit_id' => $this->up3->getKey(), 'period_type' => 'QUARTER', 'period_start' => '2026-10-01'])->assertCreated();
        $v = $r->json('data.version_id');
        $p = DB::table('rkm_proposals')->where('version_id', $v)->pluck('id', 'ulp_unit_id');

        return ['version' => $v, 'p1' => $p[$this->ulp1->getKey()], 'p2' => $p[$this->ulp2->getKey()]];
    }

    private function fill(array $x): void
    {
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => [['khs_code' => '1', 'qty_pipeline' => 30, 'qty_forecast' => 10], ['khs_code' => '2', 'qty_pipeline' => 7]]])->assertOk();
        $this->as($this->teknik2)->putJson("/api/rkm/proposals/{$x['p2']}/lines", ['lines' => [['khs_code' => '1', 'qty_pipeline' => 20]]])->assertOk();
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertOk();
        $this->as($this->mgr2)->postJson("/api/rkm/proposals/{$x['p2']}/submit")->assertOk();
    }

    private function decide(string $v, string $step, string $decision, User $by, ?string $notes = null)
    {
        return $this->as($by)->postJson("/api/rkm/versions/{$v}/decision", ['step' => $step, 'decision' => $decision, 'notes' => $notes]);
    }

    #[Test]
    public function plans_follow_the_period_rules_and_each_roles_keys(): void
    {
        $body = ['up3_unit_id' => $this->up3->getKey(), 'period_type' => 'QUARTER', 'period_start' => '2026-10-01'];
        $this->as($this->vendor)->postJson('/api/rkm/plans', $body)->assertForbidden();
        $this->as($this->teknik1)->postJson('/api/rkm/plans', $body)->assertForbidden();
        $this->as($this->perencanaan)->postJson('/api/rkm/plans', ['period_start' => '2026-11-01'] + $body)->assertStatus(409);           // a quarter starts in Jan/Apr/Jul/Oct
        $this->as($this->perencanaan)->postJson('/api/rkm/plans', ['period_type' => 'DECADE'] + $body)->assertUnprocessable();
        $this->as($this->perencanaan)->postJson('/api/rkm/plans', ['up3_unit_id' => $this->ulp1->getKey()] + $body)->assertNotFound();    // UP3 only: the grant is not held on a ULP
        $x = $this->plan();
        $this->as($this->perencanaan)->postJson('/api/rkm/plans', $body)->assertStatus(409);                                                  // one plan per UP3 per period
        $this->assertSame(2, DB::table('rkm_proposals')->where('version_id', $x['version'])->count());                                         // one proposal per active ULP
        $this->assertSame('2026-12-31', substr((string) DB::table('rkm_plans')->value('period_end'), 0, 10));
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p2']}/lines", ['lines' => []])->assertNotFound();                          // another ULP's proposal
        $this->as($this->mgr1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => []])->assertForbidden();                             // MANAGER_ULP submits, TEKNIK prepares
        $this->as($this->teknik1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertForbidden();
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => [['khs_code' => '99']]])->assertStatus(409);
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertStatus(409);                                            // nothing to submit yet
    }

    #[Test]
    public function the_full_flow_validation_by_both_units_the_final_decision_the_frozen_snapshot_and_the_net_requirement(): void
    {
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD', 'name' => 'Gudang', 'organizational_unit_id' => $this->up3->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $snap = (string) Str::uuid();
        DB::table('stock_snapshots')->insert(['id' => $snap, 'warehouse_id' => $wh, 'as_of' => now()->subDay()->toDateString(), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now()]);
        DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => DB::table('khs_items')->where('code', '1')->value('id'), 'on_hand' => 50, 'reserved' => 10, 'incoming_confirmed' => 5, 'safety_stock' => 8]);
        $x = $this->plan();
        $v = $x['version'];

        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertStatus(409);          // proposals not submitted
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => [['khs_code' => '1', 'qty_pipeline' => 30, 'qty_forecast' => 10], ['khs_code' => '2', 'qty_pipeline' => 7]]])->assertOk();
        $this->as($this->teknik2)->putJson("/api/rkm/proposals/{$x['p2']}/lines", ['lines' => [['khs_code' => '1', 'qty_pipeline' => 20]]])->assertOk();
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertStatus(409);          // ULP 2 still open
        $this->as($this->mgr2)->postJson("/api/rkm/proposals/{$x['p2']}/submit")->assertOk();
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => []])->assertStatus(409);   // submitted = locked
        $this->as($this->vendor)->postJson("/api/rkm/versions/{$v}/start-validation")->assertForbidden();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertOk();

        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/adjust", ['proposal_id' => $x['p2'], 'khs_code' => '1', 'quantity' => 25])->assertUnprocessable();   // a reason is required
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/adjust", ['proposal_id' => $x['p2'], 'khs_code' => '1', 'quantity' => 25, 'reason' => 'Sesuai realisasi triwulan lalu'])->assertOk();
        $this->assertEquals(20, DB::table('rkm_adjustments')->value('before_qty'));

        $this->decide($v, 'APPROVE_UP3_MANAGER', 'APPROVED', $this->manager)->assertStatus(409);                          // validations first
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->konstruksi)->assertForbidden();                      // the right role per step
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->perencanaan)->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/adjust", ['proposal_id' => $x['p2'], 'khs_code' => '1', 'quantity' => 26, 'reason' => 'x'])->assertStatus(409);   // a decision exists: the version is fixed
        $this->decide($v, 'VALIDATE_KONSTRUKSI', 'APPROVED', $this->konstruksi)->assertOk();
        $this->decide($v, 'APPROVE_UP3_MANAGER', 'APPROVED', $this->manager)->assertOk();

        $show = $this->as($this->manager)->getJson("/api/rkm/versions/{$v}")->assertOk()->json('data');
        $this->assertSame('APPROVED', $show['status']);
        $this->assertCount(3, $show['decisions']);
        $this->assertNotNull($show['snapshot_hash']);
        $req = $this->as($this->manager)->getJson("/api/rkm/versions/{$v}/requirements")->assertOk();
        $this->assertTrue($req->json('frozen'));
        $rows = collect($req->json('data.rows'))->keyBy('khs_code');
        $this->assertEquals(65, $rows['1']['gross_demand']);                       // 30 + 10 (ULP 1) + 25 (ULP 2, adjusted from 20)
        $this->assertEquals(28, $rows['1']['net_requirement']);                    // max(0, 65 + 8 safety - (50 - 10) available - 5 incoming)
        $this->assertEquals(5, $rows['1']['planner_adjustment']);
        $this->assertEquals(7, $rows['2']['net_requirement']);                     // no stock at all
        try {
            DB::transaction(fn () => DB::table('rkm_versions')->where('id', $v)->update(['snapshot' => '{}']));
            $this->fail('the approval snapshot must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->as($this->teknik1)->getJson("/api/rkm/versions/{$v}/requirements")->assertNotFound();                      // UP3 consolidation: UP3 readers only
        $own = $this->as($this->teknik1)->getJson("/api/rkm/versions/{$v}")->assertOk()->json('data');
        $this->assertCount(1, $own['proposals']);                                                                         // a ULP sees its own proposal only
        $this->assertSame([], $own['decisions']);
        $this->as($this->vendor)->getJson("/api/rkm/versions/{$v}")->assertForbidden();

        // amendment: a new version copied from the approved one; approving it supersedes the previous
        $plan = (string) DB::table('rkm_plans')->value('id');
        $this->as($this->teknik1)->postJson("/api/rkm/plans/{$plan}/amend", ['reason' => 'x'])->assertForbidden();
        $this->as($this->perencanaan)->postJson("/api/rkm/plans/{$plan}/amend", [])->assertUnprocessable();
        $v2 = $this->as($this->perencanaan)->postJson("/api/rkm/plans/{$plan}/amend", ['reason' => 'Penambahan kebutuhan gardu'])->assertCreated()->json('data.version_id');
        $this->as($this->perencanaan)->postJson("/api/rkm/plans/{$plan}/amend", ['reason' => 'lagi'])->assertStatus(409);   // one open version
        $this->assertSame(2, (int) DB::table('rkm_versions')->where('id', $v2)->value('version_number'));
        $this->assertSame(3, DB::table('rkm_lines')->whereIn('proposal_id', DB::table('rkm_proposals')->where('version_id', $v2)->select('id'))->count());
        $p2 = DB::table('rkm_proposals')->where('version_id', $v2)->pluck('id', 'ulp_unit_id');
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$p2[$this->ulp1->getKey()]}/submit")->assertOk();
        $this->as($this->mgr2)->postJson("/api/rkm/proposals/{$p2[$this->ulp2->getKey()]}/submit")->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v2}/start-validation")->assertOk();
        $this->decide($v2, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->perencanaan)->assertOk();
        $this->decide($v2, 'VALIDATE_KONSTRUKSI', 'APPROVED', $this->konstruksi)->assertOk();
        $this->decide($v2, 'APPROVE_UP3_MANAGER', 'APPROVED', $this->manager)->assertOk();
        $this->assertSame('SUPERSEDED', DB::table('rkm_versions')->where('id', $v)->value('status'));
        $this->assertSame('APPROVED', DB::table('rkm_versions')->where('id', $v2)->value('status'));
    }

    #[Test]
    public function a_return_reopens_the_proposals_in_a_new_round_a_rejection_is_final_and_one_user_decides_once(): void
    {
        $x = $this->plan();
        $v = $x['version'];
        $this->fill($x);
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/adjust", ['proposal_id' => $x['p2'], 'khs_code' => '1', 'quantity' => 5, 'reason' => 'Terlalu besar'])->assertOk();
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'RETURNED', $this->perencanaan)->assertStatus(409);                  // a reason is required
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'RETURNED', $this->perencanaan, 'Mohon rinci kebutuhan forecast')->assertOk();
        $row = DB::table('rkm_versions')->where('id', $v)->first();
        $this->assertSame('COLLECTING', $row->status);
        $this->assertSame(2, (int) $row->round);
        $this->assertSame(['DRAFT', 'DRAFT'], DB::table('rkm_proposals')->where('version_id', $v)->pluck('status')->all());
        $this->assertSame('Mohon rinci kebutuhan forecast', DB::table('rkm_proposals')->where('id', $x['p1'])->value('return_reason'));
        $this->assertNull(DB::table('rkm_lines')->whereIn('proposal_id', [$x['p1'], $x['p2']])->whereNotNull('qty_validated')->value('qty_validated'));   // adjustments are redone
        $this->as($this->teknik1)->putJson("/api/rkm/proposals/{$x['p1']}/lines", ['lines' => [['khs_code' => '1', 'qty_pipeline' => 12]]])->assertOk();          // editable again
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertOk();
        $this->as($this->mgr2)->postJson("/api/rkm/proposals/{$x['p2']}/submit")->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertOk();
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->perencanaan)->assertOk();                          // round 2 starts clean
        $this->decide($v, 'VALIDATE_KONSTRUKSI', 'REJECTED', $this->perencanaan, 'Tidak sesuai')->assertStatus(403);      // wrong role for the step
        $this->decide($v, 'VALIDATE_KONSTRUKSI', 'REJECTED', $this->konstruksi, 'Tidak sesuai anggaran')->assertOk();
        $this->assertSame('REJECTED', DB::table('rkm_versions')->where('id', $v)->value('status'));
        $this->as($this->mgr1)->postJson("/api/rkm/proposals/{$x['p1']}/submit")->assertStatus(409);
        $this->as($this->perencanaan)->postJson('/api/rkm/plans/'.DB::table('rkm_plans')->value('id').'/amend', ['reason' => 'x'])->assertStatus(409);   // only an approved RKM is amended
        $this->assertSame(['VALIDATE_KONSTRUKSI', 'VALIDATE_PERENCANAAN', 'VALIDATE_PERENCANAAN'], DB::table('rkm_decisions')->orderBy('step')->pluck('step')->all());
    }

    #[Test]
    public function the_rkm_reports_show_the_proposals_per_ulp_the_validation_effect_and_the_critical_materials(): void
    {
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => 'GD', 'name' => 'Gudang', 'organizational_unit_id' => $this->up3->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $snap = (string) Str::uuid();
        DB::table('stock_snapshots')->insert(['id' => $snap, 'warehouse_id' => $wh, 'as_of' => now()->subDay()->toDateString(), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now()]);
        DB::table('stock_snapshot_lines')->insert(['id' => (string) Str::uuid(), 'snapshot_id' => $snap, 'khs_item_id' => DB::table('khs_items')->where('code', '1')->value('id'), 'on_hand' => 50, 'reserved' => 10, 'incoming_confirmed' => 5, 'safety_stock' => 8]);
        $x = $this->plan();
        $v = $x['version'];
        $this->fill($x);
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertOk();
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/adjust", ['proposal_id' => $x['p2'], 'khs_code' => '1', 'quantity' => 25, 'reason' => 'Sesuai realisasi'])->assertOk();
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->perencanaan)->assertOk();
        $this->decide($v, 'VALIDATE_KONSTRUKSI', 'APPROVED', $this->konstruksi)->assertOk();
        $this->decide($v, 'APPROVE_UP3_MANAGER', 'APPROVED', $this->manager)->assertOk();
        $report = fn (string $type, string $q = '', ?User $by = null) => $this->as($by ?? $this->manager)->getJson("/api/rkm/versions/{$v}/reports/{$type}{$q}");

        $this->as($this->vendor)->getJson("/api/rkm/versions/{$v}/reports/per-ulp")->assertForbidden();
        $report('per-ulp', '', $this->teknik1)->assertNotFound();                                                       // UP3-level readers only
        $report('nonsense')->assertNotFound();
        $perUlp = $report('per-ulp')->assertOk()->json('data');
        $this->assertSame('RKM PER ULP', $perUlp['title']);
        $this->assertCount(3, $perUlp['sections'][0]['rows']);                                                          // ULP1: KHS 1 and 2; ULP2: KHS 1
        $row = collect($perUlp['sections'][0]['rows'])->first(fn ($r) => $r[0] === $this->ulp2->code && $r[1] === '1');
        $this->assertEquals([20, 20, 25], [$row[3], $row[5], $row[6]]);                                                  // pipeline 20, proposed 20, after validation 25
        $cmp = collect($report('comparison')->assertOk()->json('data.sections.0.rows'))->keyBy(0);
        $this->assertEquals([60, 65, 5, 0, 65, 28], [$cmp['1'][1], $cmp['1'][2], $cmp['1'][3], $cmp['1'][4], $cmp['1'][5], $cmp['1'][6]]);   // proposed 60, validated 65, +5, gross 65, net 28
        $critical = $report('critical')->assertOk()->json('data.sections.0.rows');
        $this->assertSame(['1', '2'], array_column($critical, 0));                                                      // KHS 1 first (net 28), then KHS 2 (net 7, no stock)
        $this->assertEquals(28, $critical[0][5]);
        $this->as($this->manager)->get("/api/rkm/versions/{$v}/reports/comparison?format=xlsx")->assertOk()->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    // ---- in-app notifications (docs/62 §44) -------------------------------------------------------------------------------

    #[Test]
    public function the_rkm_flow_tells_the_up3_validators_then_the_manager_then_the_submitters(): void
    {
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        $x = $this->plan();
        $v = $x['version'];
        $this->fill($x);                                                                        // two ULP submissions
        $this->assertCount(2, $inbox($this->perencanaan)->filter(fn ($n) => str_contains($n->title, 'diajukan')));
        $this->assertCount(2, $inbox($this->konstruksi)->filter(fn ($n) => str_contains($n->title, 'diajukan')));
        $this->assertCount(0, $inbox($this->manager));
        $this->assertCount(0, $inbox($this->teknik1));

        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$v}/start-validation")->assertOk();
        $this->decide($v, 'VALIDATE_PERENCANAAN', 'APPROVED', $this->perencanaan)->assertOk();
        $this->assertCount(0, $inbox($this->manager));                                          // one validation is not enough
        $this->decide($v, 'VALIDATE_KONSTRUKSI', 'APPROVED', $this->konstruksi)->assertOk();
        $this->assertCount(1, $inbox($this->manager));
        $this->assertStringContainsString('persetujuan akhir', $inbox($this->manager)[0]->title);

        $this->decide($v, 'APPROVE_UP3_MANAGER', 'APPROVED', $this->manager)->assertOk();
        foreach ([$this->mgr1, $this->mgr2, $this->perencanaan] as $owner) {
            $this->assertNotNull($inbox($owner)->first(fn ($n) => str_contains($n->title, 'disetujui') && $n->level === 'success'));
        }
        $this->assertCount(1, $inbox($this->manager));                                          // the approver is not told about their own act
    }

    #[Test]
    public function a_returned_rkm_version_tells_the_submitters_the_reason(): void
    {
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        $x = $this->plan();
        $this->fill($x);
        $this->as($this->perencanaan)->postJson("/api/rkm/versions/{$x['version']}/start-validation")->assertOk();
        $this->decide($x['version'], 'VALIDATE_PERENCANAAN', 'RETURNED', $this->perencanaan, 'Kuantitas KHS 1 perlu dirinci')->assertOk();
        $back = $inbox($this->mgr1)->first(fn ($n) => str_contains($n->title, 'dikembalikan'));
        $this->assertNotNull($back);
        $this->assertStringContainsString('Kuantitas KHS 1 perlu dirinci', $back->body);
        $this->assertNotNull($inbox($this->mgr2)->first(fn ($n) => str_contains($n->title, 'dikembalikan')));
    }
}
