<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class MasterDataConstructionTest extends PostgresTestCase
{
    private User $engineer;

    private User $planner;

    private User $manager;

    private User $dual;

    private User $viewer;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);

        $up3 = $this->makeUnit('UP3');
        $mk = function (string ...$roles) use ($up3): User {
            $u = $this->makeUser();
            foreach ($roles as $r) {
                $this->assign($u, Role::query()->where('name', $r)->firstOrFail(), $up3);
            }

            return $u;
        };
        $this->engineer = $mk('ENGINEERING');
        $this->planner = $mk('PERENCANAAN');
        $this->manager = $mk('UP3_MANAGER');
        $this->dual = $mk('ENGINEERING', 'UP3_MANAGER');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
    }

    /** @param bool $mfa SYS_ADMIN tokens are MFA-verified by default; pass false for a freshly logged-in token. */
    private function as(User $u, bool $mfa = true): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        if ($mfa) {
            $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();
        }

        return $this->withToken($token->plainTextToken);
    }

    private function upload(string $uri, string $csv, array $fields = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->post($uri, array_merge(['file' => UploadedFile::fake()->createWithContent('f.csv', $csv)], $fields), ['Accept' => 'application/json']);
    }

    private function types(string $csv, array $fields = [], ?User $by = null)
    {
        return $this->upload('/api/master-data/construction-types/import', $csv, array_merge(['valid_from' => '2026-01-01'], $fields), $by);
    }

    private function maps(string $csv, array $fields = [], ?User $by = null)
    {
        return $this->upload('/api/master-data/construction-types/mappings/import', $csv, $fields, $by);
    }

    private function approve(array $ids, ?User $by = null, string $reason = 'Sesuai gambar konstruksi')
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/construction-types/versions/approve', ['version_ids' => $ids, 'reason' => $reason]);
    }

    /** KHS items 1..$n imported by the engineer and approved by the manager, valid from 2026-01-01. */
    private function approvedKhs(int $n = 5): void
    {
        $lines = ['code,name,unit'];
        for ($i = 1; $i <= $n; $i++) {
            $lines[] = "{$i},Material KHS {$i},B";
        }
        $this->upload('/api/master-data/khs/import', implode("\n", $lines), ['valid_from' => '2026-01-01'])->assertCreated();
        $ids = DB::table('khs_item_versions')->where('status', 'DRAFT')->pluck('id')->all();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => $ids, 'reason' => 'ok'])->assertOk();
    }

    private function typeVersion(string $code, int $n = 1): string
    {
        return (string) DB::table('construction_type_versions as v')->join('construction_types as t', 't.id', '=', 'v.construction_type_id')->where('t.code', $code)->where('v.version_number', $n)->value('v.id');
    }

    private const TYPES = "group,label,source_reference\nSUTM,A3C 150,GAMBAR!T6\nSUTM,A3C-S 70,GAMBAR!T7\nGTT_UMUM,TM 1,GAMBAR!Z7\nGTT_KHUSUS,TM 1,GAMBAR!Z26\n";

    /** types imported (drafts), 5 approved KHS items, mappings imported for SUTM-01 */
    private function draftWithMappings(): void
    {
        $this->approvedKhs();
        $this->types(self::TYPES)->assertCreated();
        $this->maps("group,label,khs_code,relation,source_reference\nSUTM,A3C 150,1,DIRECT,SUTM!B12\nSUTM,A3C 150,2,SHARED,SUTM!B13\nSUTM,A3C-S 70,3,DIRECT,SUTM!B14\n")->assertCreated();
    }

    // ---- authorization -------------------------------------------------------------------

    #[Test]
    public function the_construction_keys_follow_the_same_split_as_khs(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'], $holders('construction_types.manage'));
        $this->assertSame(['SYS_ADMIN', 'UP3_MANAGER'], $holders('construction_types.approve'));
    }

    #[Test]
    public function managers_import_approvers_approve_viewers_read_and_everyone_else_gets_403_before_validation(): void
    {
        $this->types(self::TYPES)->assertCreated();
        $id = $this->typeVersion('SUTM-01');

        $this->types('', [], $this->manager)->assertForbidden();
        $this->maps('', [], $this->manager)->assertForbidden();
        $this->approve([$id], $this->engineer)->assertForbidden();
        $this->approve([], $this->viewer)->assertForbidden();
        $this->types('', [], $this->viewer)->assertForbidden();
        $this->as($this->viewer)->getJson('/api/master-data/construction-types')->assertOk();
        $this->as($this->vendor)->getJson('/api/master-data/construction-types')->assertForbidden();
        $this->as($this->engineer)->postJson("/api/master-data/construction-types/versions/{$id}/retire", ['reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->patchJson("/api/master-data/construction-types/versions/{$id}", ['name' => 'x', 'reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->deleteJson("/api/master-data/construction-types/versions/{$id}/mappings/1", ['reason' => 'x'])->assertForbidden();
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/master-data/construction-types')->assertUnauthorized();
    }

    // ---- types ---------------------------------------------------------------------------

    #[Test]
    public function a_dry_run_assigns_codes_in_file_order_and_writes_nothing(): void
    {
        $res = $this->types(self::TYPES, ['dry_run' => true])->assertOk();

        $this->assertSame(['SUTM-01', 'SUTM-02', 'GTT_UMUM-01', 'GTT_KHUSUS-01'], array_column($res->json('rows'), 'code'));
        $this->assertSame([4, 0], [$res->json('data.new_types'), $res->json('data.rejected')]);
        $this->assertSame(0, DB::table('construction_types')->count());
    }

    #[Test]
    public function importing_creates_types_with_stable_codes_draft_versions_provenance_and_events(): void
    {
        $this->types(self::TYPES, ['source_reference' => 'MASTER RAB & KKF.xlsx / GAMBAR'])->assertCreated();

        $this->assertSame(4, DB::table('construction_types')->count());
        $this->assertSame(['SUTM', null], [DB::table('construction_types')->where('code', 'SUTM-01')->value('group_code'), DB::table('construction_types')->where('code', 'SUTM-01')->value('external_code')]);
        $v = DB::table('construction_type_versions')->where('id', $this->typeVersion('SUTM-01'))->first();
        $this->assertSame(['DRAFT', 1, 'A3C 150', 'GAMBAR!T6', '2026-01-01', $this->engineer->getKey()], [$v->status, $v->version_number, $v->name, $v->source_reference, $v->valid_from, $v->created_by]);
        $this->assertSame(4, DB::table('construction_version_events')->where('event_type', 'CREATED')->count());
    }

    #[Test]
    public function the_same_label_in_two_groups_is_two_different_types(): void
    {
        $this->types(self::TYPES)->assertCreated();
        $codes = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->where('v.name', 'TM 1')->orderBy('t.code')->pluck('t.code')->all();
        $this->assertSame(['GTT_KHUSUS-01', 'GTT_UMUM-01'], $codes);
    }

    #[Test]
    public function codes_continue_per_group_and_an_explicit_official_code_is_honoured(): void
    {
        $this->types(self::TYPES)->assertCreated();
        $res = $this->types("group,label,code\nSUTM,Baru,\nSUTM,Resmi,SUTM-RESMI-7\nMVTIC,MVTIC 150,\n", ['dry_run' => true])->assertOk();
        $this->assertSame(['SUTM-03', 'SUTM-RESMI-7', 'MVTIC-01'], array_column($res->json('rows'), 'code'));
    }

    #[Test]
    public function more_than_99_types_widen_the_sequence_to_three_digits(): void
    {
        $lines = ['group,label'];
        for ($i = 1; $i <= 101; $i++) {
            $lines[] = "SUTM,Tipe {$i}";
        }
        $codes = array_column($this->types(implode("\n", $lines), ['dry_run' => true])->json('rows'), 'code');
        $this->assertSame(['SUTM-01', 'SUTM-99', 'SUTM-100', 'SUTM-101'], [$codes[0], $codes[98], $codes[99], $codes[100]]);
    }

    #[Test]
    public function out_of_scope_groups_bad_values_and_duplicates_are_rejected(): void
    {
        $this->types(self::TYPES)->assertCreated();
        $csv = "group,label,code\nPBPD,450-5500 VA,\nSKTR,SKTR 4x70,\nSUTM,,\nSUTM,Dobel,\nSUTM,dobel,\nMVTIC,Kode jelek,bad code\nMVTIC,Pakai kode,GTT_UMUM-01\n";
        $rows = collect($this->types($csv, ['dry_run' => true])->assertOk()->json('rows'));

        $this->assertSame(array_fill(0, 7, 'REJECT'), $rows->pluck('action')->all());
        $this->assertStringContainsString('tidak termasuk cakupan', $rows[0]['messages'][0]);
        $this->assertStringContainsString('SKTR', $rows[1]['messages'][0]); // legacy sheets are out of scope
        $this->assertContains('Kelompok + label muncul lebih dari sekali dalam berkas.', $rows[3]['messages']);
        $this->assertStringContainsString('kelompok tidak dapat diubah', $rows[6]['messages'][0]);
        $this->assertSame(4, DB::table('construction_types')->count());
    }

    #[Test]
    public function a_new_explicit_code_cannot_duplicate_the_label_of_an_existing_type(): void
    {
        $this->types(self::TYPES)->assertCreated();
        $row = $this->types("group,label,code\nSUTM,A3C 150,SUTM-OFFICIAL\n", ['dry_run' => true])->json('rows.0');
        $this->assertSame('REJECT', $row['action']);
        $this->assertStringContainsString('SUTM-01', $row['messages'][0]);
    }

    #[Test]
    public function reimporting_is_unchanged_a_pending_draft_blocks_and_a_changed_description_makes_a_new_version(): void
    {
        $this->approvedKhs();
        $this->types(self::TYPES)->assertCreated();
        $this->maps("group,label,khs_code\nSUTM,A3C 150,1\n")->assertCreated();

        $pending = $this->types(self::TYPES, ['dry_run' => true])->json('rows');
        $this->assertSame(['REJECT'], array_unique(array_column($pending, 'action'))); // drafts are still pending
        $this->assertStringContainsString('draf versi 1', $pending[0]['messages'][0]);

        $this->approve([$this->typeVersion('SUTM-01')])->assertOk();
        $same = $this->types("group,label\nSUTM,A3C 150\n", ['dry_run' => true, 'valid_from' => '2026-07-01'])->json('rows.0');
        $this->assertSame(['UNCHANGED', 'SUTM-01'], [$same['action'], $same['code']]);

        $changed = $this->types("group,label,description\nSUTM,A3C 150,Saluran udara 20 kV\n", ['valid_from' => '2026-07-01'])->assertCreated();
        $this->assertSame(1, $changed->json('data.new_versions'));
        $this->assertSame('Saluran udara 20 kV', DB::table('construction_type_versions')->where('id', $this->typeVersion('SUTM-01', 2))->value('description'));
    }

    // ---- mappings ------------------------------------------------------------------------

    #[Test]
    public function mappings_attach_to_the_draft_by_group_and_label_or_by_code_with_sequence_and_an_event(): void
    {
        $this->approvedKhs();
        $this->types(self::TYPES)->assertCreated();
        $res = $this->maps("group,label,code,khs_code,relation,note,source_reference\nSUTM,A3C 150,,2,SHARED,dibagi,SUTM!B13\n,,SUTM-01,1,,,SUTM!B12\nSUTM,A3C-S 70,,3,,,\n")->assertCreated();

        $this->assertSame([3, 0], [$res->json('data.inserted'), $res->json('data.rejected')]);
        $rows = DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('m.construction_type_version_id', $this->typeVersion('SUTM-01'))->orderBy('m.sequence')->get(['i.code', 'm.sequence', 'm.relation', 'm.note', 'm.source_reference']);
        $this->assertSame([['2', 1, 'SHARED', 'dibagi', 'SUTM!B13'], ['1', 2, 'DIRECT', null, 'SUTM!B12']], $rows->map(fn ($r) => [$r->code, $r->sequence, $r->relation, $r->note, $r->source_reference])->all());
        $this->assertDatabaseHas('construction_version_events', ['construction_type_version_id' => $this->typeVersion('SUTM-01'), 'event_type' => 'MAPPINGS_CHANGED']);
    }

    #[Test]
    public function unknown_khs_codes_unknown_types_non_draft_targets_bad_relations_and_duplicates_are_rejected(): void
    {
        $this->approvedKhs();
        $this->types(self::TYPES)->assertCreated();
        $this->maps("group,label,khs_code\nSUTM,A3C-S 70,3\n")->assertCreated();
        $this->approve([$this->typeVersion('SUTM-02')])->assertOk(); // SUTM-02 is now approved: no draft left

        $csv = "group,label,khs_code,relation\nSUTM,A3C 150,999,\nSUTM,Tidak Ada,1,\nSUTM,A3C-S 70,1,\nSUTM,A3C 150,1,CAMPUR\nSUTM,A3C 150,2,\nSUTM,A3C 150,2,\nSUTM,A3C 150,,\n";
        $rows = collect($this->maps($csv, ['dry_run' => true])->assertOk()->json('rows'));

        $this->assertSame(array_fill(0, 7, 'REJECT'), $rows->pluck('action')->all());
        $this->assertStringContainsString('tidak ada di katalog (tidak diganti dengan kode yang mirip)', $rows[0]['messages'][0]);
        $this->assertStringContainsString('tidak ditemukan', $rows[1]['messages'][0]);
        $this->assertStringContainsString('Tidak ada versi DRAFT', $rows[2]['messages'][0]);
        $this->assertStringContainsString('tidak valid', $rows[3]['messages'][0]);
        $this->assertContains('Pasangan jenis konstruksi + kode KHS muncul lebih dari sekali dalam berkas.', $rows[4]['messages']);
        $this->assertContains('Kode KHS kosong.', $rows[6]['messages']);
    }

    #[Test]
    public function reimporting_mappings_updates_changes_and_leaves_the_rest_alone(): void
    {
        $this->draftWithMappings();
        $res = $this->maps("group,label,khs_code,relation,note\nSUTM,A3C 150,1,DIRECT,\nSUTM,A3C 150,2,DIRECT,sekarang langsung\nSUTM,A3C 150,4,DIRECT,baru\n")->assertCreated();

        $this->assertSame([1, 1, 1], [$res->json('data.inserted'), $res->json('data.updated'), $res->json('data.unchanged')]);
        $this->assertSame('SUTM!B13', DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('i.code', '2')->where('m.construction_type_version_id', $this->typeVersion('SUTM-01'))->value('m.source_reference')); // absent column: provenance kept
        $m = DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('i.code', '2')->where('m.construction_type_version_id', $this->typeVersion('SUTM-01'))->first();
        $this->assertSame(['DIRECT', 'sekarang langsung'], [$m->relation, $m->note]);
        $this->assertSame(3, DB::table('construction_khs_mappings')->where('construction_type_version_id', $this->typeVersion('SUTM-01'))->count());
    }

    #[Test]
    public function a_mapping_can_be_removed_from_a_draft_with_a_reason_and_not_from_an_approved_version(): void
    {
        $this->draftWithMappings();
        $id = $this->typeVersion('SUTM-01');

        $this->as($this->engineer)->deleteJson("/api/master-data/construction-types/versions/{$id}/mappings/2", [])->assertUnprocessable();
        $this->as($this->engineer)->deleteJson("/api/master-data/construction-types/versions/{$id}/mappings/2", ['reason' => 'Salah baris'])->assertOk();
        $this->as($this->engineer)->deleteJson("/api/master-data/construction-types/versions/{$id}/mappings/2", ['reason' => 'x'])->assertNotFound();
        $this->assertSame(1, DB::table('construction_khs_mappings')->where('construction_type_version_id', $id)->count());

        $this->approve([$id])->assertOk();
        $this->as($this->engineer)->deleteJson("/api/master-data/construction-types/versions/{$id}/mappings/1", ['reason' => 'x'])->assertStatus(409);
    }

    // ---- approval, immutability, versioning ----------------------------------------------

    #[Test]
    public function approval_needs_a_different_user_at_least_one_mapping_and_approved_khs_codes(): void
    {
        $this->approvedKhs(3);
        $this->types(self::TYPES, [], $this->dual)->assertCreated();
        $a = $this->typeVersion('SUTM-01');
        $b = $this->typeVersion('SUTM-02');

        $this->approve([$a])->assertStatus(409)->assertJsonPath('message', 'Versi 1 dari A3C 150 belum memiliki pemetaan KHS; tidak dapat disetujui.');

        $this->maps("group,label,khs_code\nSUTM,A3C 150,1\n", [], $this->dual)->assertCreated();
        $this->approve([$a], $this->dual)->assertForbidden()->assertJsonPath('message', 'Pembuat versi tidak dapat menyetujui versinya sendiri.');
        $this->assertDbRejects(fn () => DB::table('construction_type_versions')->where('id', $a)->update(['status' => 'APPROVED', 'approved_by' => $this->dual->getKey(), 'approved_at' => now()]));
        $this->approve([$a])->assertOk()->assertJsonPath('data.approved', 1);
        $this->assertSame('APPROVED', DB::table('construction_type_versions')->where('id', $a)->value('status'));

        // a KHS item without an approved version valid on the start date blocks approval
        DB::table('khs_items')->insert(['id' => $kid = (string) Str::uuid(), 'code' => '900', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $kid, 'version_number' => 1, 'name' => 'Draf KHS', 'unit_text' => 'B', 'valid_from' => '2026-01-01', 'status' => 'DRAFT', 'created_by' => $this->engineer->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $this->maps("group,label,khs_code\nSUTM,A3C-S 70,900\n", [], $this->dual)->assertCreated();
        $this->approve([$b])->assertStatus(409);
        $this->assertStringContainsString('900', $this->approve([$b])->json('message'));
    }

    #[Test]
    public function approval_is_all_or_nothing_and_validates_input(): void
    {
        $this->draftWithMappings();
        $a = $this->typeVersion('SUTM-01');
        $noMap = $this->typeVersion('GTT_UMUM-01');

        $this->approve([$a, $noMap])->assertStatus(409);
        $this->assertSame('DRAFT', DB::table('construction_type_versions')->where('id', $a)->value('status'));
        $this->approve([$a, (string) fake()->uuid()])->assertStatus(409);
        foreach ([[], ['bukan-uuid'], [$a, $a]] as $ids) {
            $this->as($this->manager)->postJson('/api/master-data/construction-types/versions/approve', ['version_ids' => $ids, 'reason' => 'x'])->assertUnprocessable();
        }
        $this->as($this->manager)->postJson('/api/master-data/construction-types/versions/approve', ['version_ids' => [$a]])->assertUnprocessable()->assertJsonValidationErrors('reason');
    }

    #[Test]
    public function a_newer_approved_version_closes_the_previous_one_and_a_non_forward_start_is_refused(): void
    {
        $this->approvedKhs();
        $this->types("group,label\nSUTM,A3C 150\n")->assertCreated();
        $this->maps("group,label,khs_code\nSUTM,A3C 150,1\n")->assertCreated();
        $this->approve([$this->typeVersion('SUTM-01')])->assertOk();

        $this->types("group,label,description\nSUTM,A3C 150,Rev\n", ['valid_from' => '2026-01-01'])->assertCreated(); // same start as v1
        $this->maps("group,label,khs_code\nSUTM,A3C 150,1\n")->assertCreated();
        $this->approve([$this->typeVersion('SUTM-01', 2)])->assertStatus(409);

        $this->as($this->engineer)->patchJson('/api/master-data/construction-types/versions/'.$this->typeVersion('SUTM-01', 2), ['valid_from' => '2026-07-01', 'reason' => 'Berlaku Juli'])->assertOk();
        $this->approve([$this->typeVersion('SUTM-01', 2)])->assertOk()->assertJsonPath('data.auto_closed', 1);
        $old = DB::table('construction_type_versions')->where('id', $this->typeVersion('SUTM-01', 1))->first();
        $this->assertSame(['APPROVED', '2026-06-30'], [$old->status, $old->valid_until]);
    }

    #[Test]
    public function approved_versions_and_their_mappings_are_immutable_in_the_database(): void
    {
        $this->draftWithMappings();
        $id = $this->typeVersion('SUTM-01');
        $this->approve([$id])->assertOk();
        $mappingId = DB::table('construction_khs_mappings')->where('construction_type_version_id', $id)->value('id');
        $khsId = DB::table('khs_items')->where('code', '5')->value('id');

        foreach (['name' => 'X', 'description' => 'x', 'reference_symbol' => 'x', 'valid_from' => '2025-01-01', 'source_reference' => 'x'] as $col => $val) {
            $this->assertDbRejects(fn () => DB::table('construction_type_versions')->where('id', $id)->update([$col => $val]), $col);
        }
        $this->assertDbRejects(fn () => DB::table('construction_type_versions')->where('id', $id)->update(['status' => 'DRAFT']));
        $this->assertDbRejects(fn () => DB::table('construction_type_versions')->where('id', $id)->delete());
        $this->assertDbRejects(fn () => DB::table('construction_khs_mappings')->where('id', $mappingId)->update(['note' => 'x']));
        $this->assertDbRejects(fn () => DB::table('construction_khs_mappings')->where('id', $mappingId)->delete());
        $this->assertDbRejects(fn () => DB::table('construction_khs_mappings')->insert(['id' => (string) Str::uuid(), 'construction_type_version_id' => $id, 'khs_item_id' => $khsId, 'sequence' => 9, 'relation' => 'DIRECT', 'created_at' => now(), 'updated_at' => now()]));
        DB::table('construction_type_versions')->where('id', $id)->update(['status' => 'INACTIVE']);
        $this->assertDbRejects(fn () => DB::table('construction_type_versions')->where('id', $id)->update(['status' => 'APPROVED']));
    }

    #[Test]
    public function database_constraints_keep_mappings_unique_overlaps_out_and_events_append_only(): void
    {
        $this->draftWithMappings();
        $id = $this->typeVersion('SUTM-01');
        $khsId = DB::table('khs_items')->where('code', '1')->value('id');

        $this->assertDbRejects(fn () => DB::table('construction_khs_mappings')->insert(['id' => (string) Str::uuid(), 'construction_type_version_id' => $id, 'khs_item_id' => $khsId, 'sequence' => 9, 'relation' => 'DIRECT', 'created_at' => now(), 'updated_at' => now()])); // pair unique
        $this->assertDbRejects(fn () => DB::table('construction_khs_mappings')->where('construction_type_version_id', $id)->limit(1)->update(['relation' => 'OTHER']));

        $this->approve([$id])->assertOk();
        $typeId = DB::table('construction_types')->where('code', 'SUTM-01')->value('id');
        $this->assertDbRejects(fn () => DB::table('construction_type_versions')->insert([
            'id' => (string) Str::uuid(), 'construction_type_id' => $typeId, 'version_number' => 2, 'name' => 'x', 'valid_from' => '2026-06-01', 'status' => 'APPROVED',
            'created_by' => $this->engineer->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ])); // overlaps the open-ended approved v1

        $eventId = DB::table('construction_version_events')->value('id');
        $this->assertDbRejects(fn () => DB::table('construction_version_events')->where('id', $eventId)->update(['reason' => 'x']));
        $this->assertDbRejects(fn () => DB::table('construction_version_events')->where('id', $eventId)->delete());
        $this->assertDbRejects(fn () => DB::statement('TRUNCATE construction_version_events'));
    }

    #[Test]
    public function a_draft_can_be_corrected_and_an_approved_version_can_be_retired_by_the_manager_only(): void
    {
        $this->draftWithMappings();
        $id = $this->typeVersion('SUTM-01');

        $this->as($this->engineer)->patchJson("/api/master-data/construction-types/versions/{$id}", ['name' => 'A3C 150 mm2'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->as($this->engineer)->patchJson("/api/master-data/construction-types/versions/{$id}", ['name' => 'A3C 150 mm2', 'reason' => 'Lengkapi'])->assertOk()->assertJsonPath('data.name', 'A3C 150 mm2');
        $this->as($this->engineer)->patchJson("/api/master-data/construction-types/versions/{$id}", ['name' => 'A3C 150 mm2', 'reason' => 'x'])->assertStatus(409);

        $this->approve([$id])->assertOk();
        $this->as($this->engineer)->patchJson("/api/master-data/construction-types/versions/{$id}", ['name' => 'Lagi', 'reason' => 'x'])->assertStatus(409);
        $this->as($this->engineer)->postJson("/api/master-data/construction-types/versions/{$id}/retire", ['reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->postJson("/api/master-data/construction-types/versions/{$id}/retire", [])->assertUnprocessable();
        $this->as($this->manager)->postJson("/api/master-data/construction-types/versions/{$id}/retire", ['reason' => 'Dihentikan'])->assertOk()->assertJsonPath('data.status', 'INACTIVE');
        $this->as($this->manager)->postJson("/api/master-data/construction-types/versions/{$id}/retire", ['reason' => 'x'])->assertStatus(409);
    }

    // ---- reading -------------------------------------------------------------------------

    #[Test]
    public function the_list_orders_by_group_then_code_filters_searches_and_shows_current_and_draft_with_counts(): void
    {
        $this->draftWithMappings();
        $this->approve([$this->typeVersion('SUTM-01')])->assertOk();

        $all = $this->as($this->viewer)->getJson('/api/master-data/construction-types')->assertOk();
        $this->assertSame(['SUTM-01', 'SUTM-02', 'GTT_UMUM-01', 'GTT_KHUSUS-01'], array_column($all->json('data'), 'code')); // group order of the scope, not alphabetical
        $first = $all->json('data.0');
        $this->assertSame(['A3C 150', 2, 1], [$first['current']['name'], $first['current']['mappings_count'], $first['current']['version_number']]);
        $this->assertNull($first['draft']);
        $this->assertSame('A3C-S 70', $all->json('data.1.draft.name'));

        $this->as($this->viewer)->getJson('/api/master-data/construction-types?group=GTT_UMUM')->assertJsonPath('meta.total', 1);
        $this->as($this->viewer)->getJson('/api/master-data/construction-types?group=PBPD')->assertUnprocessable();
        $this->as($this->viewer)->getJson('/api/master-data/construction-types?search=a3c-s')->assertJsonPath('data.0.code', 'SUTM-02');
        $this->as($this->viewer)->getJson('/api/master-data/construction-types?search=SUTM-01')->assertJsonPath('meta.total', 1);
        $this->as($this->viewer)->getJson('/api/master-data/construction-types?search=%25')->assertJsonPath('meta.total', 0);
        $this->assertSame(['SUTM-02', 'GTT_UMUM-01', 'GTT_KHUSUS-01'], array_column($this->as($this->viewer)->getJson('/api/master-data/construction-types?has_draft=1')->json('data'), 'code'));
        $page = $this->as($this->viewer)->getJson('/api/master-data/construction-types?per_page=3')->json();
        $this->assertSame([3, 4, 2], [count($page['data']), $page['meta']['total'], $page['meta']['last_page']]);
    }

    #[Test]
    public function a_type_shows_its_versions_with_events_and_the_mapping_list_resolves_khs_names_and_units(): void
    {
        $this->draftWithMappings();
        $typeId = DB::table('construction_types')->where('code', 'SUTM-01')->value('id');
        $versionId = $this->typeVersion('SUTM-01');

        $show = $this->as($this->viewer)->getJson("/api/master-data/construction-types/{$typeId}")->assertOk();
        $this->assertSame(['SUTM-01', 'DRAFT', 2], [$show->json('data.code'), $show->json('data.versions.0.status'), $show->json('data.versions.0.mappings_count')]);
        $this->assertSame(['CREATED', 'MAPPINGS_CHANGED'], array_column($show->json('data.versions.0.events'), 'event_type'));

        $list = $this->as($this->viewer)->getJson("/api/master-data/construction-types/versions/{$versionId}/mappings")->assertOk();
        $this->assertSame([['1', 'Material KHS 1', 'B', 'DIRECT', true], ['2', 'Material KHS 2', 'B', 'SHARED', true]], array_map(fn ($m) => [$m['khs_code'], $m['khs_name'], $m['khs_unit'], $m['relation'], $m['khs_approved']], $list->json('data')));

        $this->as($this->viewer)->getJson('/api/master-data/construction-types/'.fake()->uuid())->assertNotFound();
        $this->as($this->viewer)->getJson('/api/master-data/construction-types/versions/'.fake()->uuid().'/mappings')->assertNotFound();
    }

    #[Test]
    public function unusable_files_are_refused_and_nothing_is_written(): void
    {
        $this->types("label\nSatu\n")->assertStatus(409)->assertJsonPath('message', "Kolom wajib 'group' tidak ditemukan pada baris judul.");
        $this->types("group,label\n")->assertStatus(409);
        $this->types(self::TYPES, ['valid_from' => '01-01-2026'])->assertUnprocessable()->assertJsonValidationErrors('valid_from');
        $this->maps("group,label\nSUTM,A\n")->assertStatus(409)->assertJsonPath('message', "Kolom wajib 'khs_code' tidak ditemukan pada baris judul.");
        $this->assertSame(0, DB::table('construction_types')->count());
    }

    #[Test]
    public function a_present_but_empty_cell_clears_the_note_while_an_absent_column_does_not(): void
    {
        $this->draftWithMappings();
        $this->maps("group,label,khs_code,note\nSUTM,A3C 150,1,catatan awal\n")->assertCreated();
        $note = fn () => DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('i.code', '1')->where('m.construction_type_version_id', $this->typeVersion('SUTM-01'))->value('m.note');
        $this->assertSame('catatan awal', $note());

        $this->maps("group,label,khs_code\nSUTM,A3C 150,1\n")->assertCreated();   // no note column
        $this->assertSame('catatan awal', $note());
        $this->maps("group,label,khs_code,note\nSUTM,A3C 150,1,\n")->assertCreated(); // empty note cell
        $this->assertNull($note());
    }
}
