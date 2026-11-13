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

class MasterDataKhsTest extends PostgresTestCase
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
        $this->dual = $mk('ENGINEERING', 'UP3_MANAGER'); // may create AND approve — but never the same version
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

    private function csv(string $content): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('khs.csv', $content);
    }

    private function import(string $csv, array $fields = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->post('/api/master-data/khs/import', array_merge(['file' => $this->csv($csv), 'valid_from' => '2026-01-01'], $fields), ['Accept' => 'application/json']);
    }

    private function approve(array $ids, ?User $by = null, string $reason = 'Sesuai SK KHS')
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => $ids, 'reason' => $reason]);
    }

    private function versionId(string $code, int $n = 1): string
    {
        return (string) DB::table('khs_item_versions as v')->join('khs_items as i', 'i.id', '=', 'v.khs_item_id')->where('i.code', $code)->where('v.version_number', $n)->value('v.id');
    }

    private const BASE = "code,name,unit\n1,Tiang Beton 11 m,B\n2,Kabel Twisted 3x70,M\n10,Isolator Tumpu,S\n";

    /** Import BASE and approve everything (manager approves, engineer created). */
    private function approvedBase(): void
    {
        $this->import(self::BASE)->assertCreated();
        $this->approve([$this->versionId('1'), $this->versionId('2'), $this->versionId('10')])->assertOk();
    }

    // ---- seeder / authorization ------------------------------------------------------

    #[Test]
    public function khs_keys_are_granted_to_the_managers_and_approval_only_to_up3_manager(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['ENGINEERING', 'PERENCANAAN', 'SYS_ADMIN'], $holders('khs.manage'));
        $this->assertSame(['SYS_ADMIN', 'UP3_MANAGER'], $holders('khs.approve'));
    }

    #[Test]
    public function permissions_are_separated_creators_cannot_approve_approvers_cannot_import_viewers_only_read(): void
    {
        $this->import(self::BASE)->assertCreated();
        $id = $this->versionId('1');

        $this->as($this->manager)->post('/api/master-data/khs/import', [], ['Accept' => 'application/json'])->assertForbidden();
        $this->approve([$id], $this->engineer)->assertForbidden();
        $this->approve([$id], $this->planner)->assertForbidden();
        $this->approve([], $this->viewer)->assertForbidden(); // grant is checked before validation
        $this->as($this->viewer)->post('/api/master-data/khs/import', [], ['Accept' => 'application/json'])->assertForbidden();
        $this->as($this->viewer)->getJson('/api/master-data/khs')->assertOk();
        $this->as($this->vendor)->getJson('/api/master-data/khs')->assertForbidden();
        $this->as($this->engineer)->postJson("/api/master-data/khs/versions/{$id}/retire", ['reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->patchJson("/api/master-data/khs/versions/{$id}", ['name' => 'x', 'reason' => 'x'])->assertForbidden();
        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/master-data/khs')->assertUnauthorized();
    }

    // ---- import ----------------------------------------------------------------------

    #[Test]
    public function a_dry_run_reports_everything_and_writes_nothing(): void
    {
        $res = $this->import(self::BASE."2,Kabel Lain,M\n,Tanpa kode,M\n", ['dry_run' => true])->assertOk();

        $this->assertEquals(['dry_run' => true, 'total' => 5, 'new_items' => 2, 'new_versions' => 0, 'unchanged' => 0, 'rejected' => 3, 'unit_changes' => 0], $res->json('data'));
        $this->assertSame(0, DB::table('khs_items')->count());
        $this->assertSame(0, DB::table('khs_item_versions')->count());
    }

    #[Test]
    public function importing_creates_items_and_draft_versions_only_with_provenance_and_events(): void
    {
        $res = $this->import(self::BASE, ['source_reference' => 'MASTER RAB & KKF.xlsx / KHS'])->assertCreated();

        $this->assertSame([3, 0, 0, 0], [$res->json('data.new_items'), $res->json('data.new_versions'), $res->json('data.unchanged'), $res->json('data.rejected')]);
        $v = DB::table('khs_item_versions')->where('id', $this->versionId('1'))->first();
        $this->assertSame(['DRAFT', 1, 'Tiang Beton 11 m', 'B', '2026-01-01', 'MASTER RAB & KKF.xlsx / KHS', $this->engineer->getKey(), null], [$v->status, $v->version_number, $v->name, $v->unit_text, $v->valid_from, $v->source_reference, $v->created_by, $v->approved_by]);
        $this->assertNull($v->unit_id); // the unit is not guessed from the workbook's abbreviation
        $this->assertSame(3, DB::table('khs_version_events')->where('event_type', 'CREATED')->count());
    }

    #[Test]
    public function rows_are_validated_duplicates_and_bad_codes_are_rejected_and_codes_are_never_normalised(): void
    {
        $csv = "code,name,unit\n7,A,B\n7,B,B\n,Tanpa kode,B\n8,,B\n9,Tanpa satuan,\nBAD CODE,x,B\n 11 ,Dengan spasi,B\n";
        $rows = collect($this->import($csv, ['dry_run' => true])->assertOk()->json('rows'));

        $this->assertSame(['REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'REJECT', 'NEW_ITEM'], $rows->pluck('action')->all());
        $this->assertContains('Kode KHS muncul lebih dari sekali dalam berkas.', $rows[0]['messages']);
        $this->assertSame('11', $rows[6]['code']); // trimmed, never case-folded or zero-padded
    }

    #[Test]
    public function reimporting_classifies_unchanged_new_versions_and_pending_drafts(): void
    {
        $this->approvedBase();

        // 1 identical, 2 renamed (new version), 10 absent from the file (untouched), 3 brand new.
        $res = $this->import("code,name,unit\n1,Tiang Beton 11 m,B\n2,Kabel Twisted 3x95,M\n3,Baru,B\n", ['valid_from' => '2026-07-01'])->assertCreated();
        $this->assertSame([1, 1, 1, 0], [$res->json('data.new_items'), $res->json('data.new_versions'), $res->json('data.unchanged'), $res->json('data.rejected')]);
        $this->assertSame(2, DB::table('khs_item_versions as v')->join('khs_items as i', 'i.id', '=', 'v.khs_item_id')->where('i.code', '2')->count());
        $this->assertSame('DRAFT', DB::table('khs_item_versions')->where('id', $this->versionId('2', 2))->value('status'));

        // A second import for code 2 while its draft is pending is refused, not stacked.
        $again = $this->import("code,name,unit\n2,Kabel Twisted 3x120,M\n", ['dry_run' => true])->json('rows.0');
        $this->assertSame('REJECT', $again['action']);
        $this->assertStringContainsString('draf versi 2', $again['messages'][0]);
    }

    #[Test]
    public function a_unit_change_needs_explicit_acceptance(): void
    {
        $this->approvedBase();
        $csv = "code,name,unit\n2,Kabel Twisted 3x70,Ls\n";

        $dry = $this->import($csv, ['dry_run' => true])->json();
        $this->assertSame(1, $dry['data']['unit_changes']);
        $this->assertTrue($dry['rows'][0]['unit_change']);
        $this->import($csv, ['valid_from' => '2026-07-01'])->assertStatus(409);
        $this->assertSame(1, DB::table('khs_item_versions')->where('khs_item_id', DB::table('khs_items')->where('code', '2')->value('id'))->count());

        $this->import($csv, ['valid_from' => '2026-07-01', 'accept_unit_changes' => true])->assertCreated();
        $this->assertSame('Ls', DB::table('khs_item_versions')->where('id', $this->versionId('2', 2))->value('unit_text'));
    }

    #[Test]
    public function a_column_missing_from_the_file_carries_the_previous_value_forward(): void
    {
        $this->import("code,name,unit,description,category\n5,Satu,B,Uraian panjang,MDU\n")->assertCreated();
        $this->approve([$this->versionId('5')]);

        $this->import("code,name,unit\n5,Satu (rev),B\n", ['valid_from' => '2026-07-01'])->assertCreated();
        $v2 = DB::table('khs_item_versions')->where('id', $this->versionId('5', 2))->first();
        $this->assertSame(['Satu (rev)', 'Uraian panjang', 'MDU'], [$v2->name, $v2->description, $v2->category]);
    }

    #[Test]
    public function the_workbook_style_header_and_a_full_size_catalogue_import_quickly(): void
    {
        $lines = ['KODE;URAIAN;SATUAN;SUMBER'];
        for ($i = 1; $i <= 518; $i++) {
            $lines[] = "{$i};\"Uraian KHS {$i}, lengkap\";".['B', 'S', 'M', 'M3', 'Ls', 'Loks'][$i % 6].';'.['', 'MDU', 'DPT', 'PLN'][$i % 4];
        }
        $start = microtime(true);
        $res = $this->import(implode("\n", $lines))->assertCreated();

        $this->assertSame([518, 518, 0], [$res->json('data.total'), $res->json('data.new_items'), $res->json('data.rejected')]);
        $this->assertSame(518, DB::table('khs_item_versions')->where('status', 'DRAFT')->count());
        $this->assertLessThan(15, microtime(true) - $start);
    }

    #[Test]
    public function unusable_files_and_parameters_are_refused(): void
    {
        $this->import("name,unit\nA,B\n")->assertStatus(409)->assertJsonPath('message', "Kolom wajib 'code' tidak ditemukan pada baris judul.");
        $this->import("code,name,unit\n")->assertStatus(409);
        $this->import(self::BASE, ['valid_from' => '01-01-2026'])->assertUnprocessable()->assertJsonValidationErrors('valid_from');
        $this->as($this->engineer)->post('/api/master-data/khs/import', ['valid_from' => '2026-01-01'], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->assertSame(0, DB::table('khs_items')->count());
    }

    // ---- approval, separation of duties, versioning ---------------------------------

    #[Test]
    public function the_manager_approves_drafts_in_bulk_and_the_current_version_becomes_visible(): void
    {
        $this->import(self::BASE)->assertCreated();
        $this->approve([$this->versionId('1'), $this->versionId('2'), $this->versionId('10')])->assertOk()->assertJsonPath('data.approved', 3);

        $v = DB::table('khs_item_versions')->where('id', $this->versionId('1'))->first();
        $this->assertSame(['APPROVED', $this->manager->getKey()], [$v->status, $v->approved_by]);
        $this->assertNotNull($v->approved_at);
        $this->assertSame(3, DB::table('khs_version_events')->where('event_type', 'APPROVED')->where('actor_user_id', $this->manager->getKey())->count());

        $list = $this->as($this->viewer)->getJson('/api/master-data/khs')->assertOk();
        $this->assertSame(['1', '2', '10'], array_column($list->json('data'), 'code')); // natural order, not "1,10,2"
        $this->assertSame('Tiang Beton 11 m', $list->json('data.0.current.name'));
        $this->assertFalse($list->json('data.0.has_draft'));
    }

    #[Test]
    public function nobody_approves_a_version_they_created_in_the_api_or_in_the_database(): void
    {
        $this->import(self::BASE, [], $this->dual)->assertCreated();
        $id = $this->versionId('1');

        $this->approve([$id], $this->dual)->assertForbidden()->assertJsonPath('message', 'Pembuat versi tidak dapat menyetujui versinya sendiri.');
        $this->assertSame('DRAFT', DB::table('khs_item_versions')->where('id', $id)->value('status'));

        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $this->dual->getKey(), 'approved_at' => now()]));
        $this->approve([$id], $this->manager)->assertOk(); // someone else can
    }

    #[Test]
    public function approval_is_all_or_nothing_and_validates_its_input(): void
    {
        $this->import(self::BASE)->assertCreated();
        $a = $this->versionId('1');
        $this->approve([$a])->assertOk();

        $b = $this->versionId('2');
        $this->approve([$b, $a])->assertStatus(409); // $a is already APPROVED -> nothing is approved
        $this->assertSame('DRAFT', DB::table('khs_item_versions')->where('id', $b)->value('status'));
        $this->approve([$b, (string) fake()->uuid()])->assertStatus(409);

        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => [], 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => ['bukan-uuid'], 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => [$b, $b], 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => [$b]])->assertUnprocessable()->assertJsonValidationErrors('reason');
    }

    #[Test]
    public function a_newer_approved_version_closes_the_previous_one_the_day_before_and_both_are_traceable(): void
    {
        $this->approvedBase();
        $this->import("code,name,unit\n2,Kabel Twisted 3x95,M\n", ['valid_from' => '2026-07-01'])->assertCreated();

        $this->approve([$this->versionId('2', 2)])->assertOk()->assertJsonPath('data.auto_closed', 1);

        $old = DB::table('khs_item_versions')->where('id', $this->versionId('2', 1))->first();
        $this->assertSame(['APPROVED', '2026-06-30'], [$old->status, $old->valid_until]);
        $this->assertDatabaseHas('khs_version_events', ['khs_item_version_id' => $old->id, 'event_type' => 'AUTO_CLOSED']);

        $show = $this->as($this->viewer)->getJson('/api/master-data/khs/'.DB::table('khs_items')->where('code', '2')->value('id'))->assertOk();
        $this->assertSame([2, 1], array_column($show->json('data.versions'), 'version_number'));
        $this->assertSame(['CREATED', 'APPROVED', 'AUTO_CLOSED'], array_column($show->json('data.versions.1.events'), 'event_type'));
        $this->assertSame('Kabel Twisted 3x70', $show->json('data.versions.1.name')); // history keeps what was valid then
    }

    #[Test]
    public function a_version_that_does_not_start_after_the_active_one_is_refused(): void
    {
        $this->approvedBase();
        $this->import("code,name,unit\n2,Lebih lama,M\n", ['valid_from' => '2026-01-01'])->assertCreated(); // same start as v1

        $this->approve([$this->versionId('2', 2)])->assertStatus(409);
        $this->assertSame('DRAFT', DB::table('khs_item_versions')->where('id', $this->versionId('2', 2))->value('status'));
    }

    #[Test]
    public function approved_versions_are_immutable_and_their_status_only_moves_forward_at_the_database_level(): void
    {
        $this->approvedBase();
        $id = $this->versionId('1');

        foreach (['name' => 'Diubah', 'description' => 'x', 'unit_text' => 'M', 'category' => 'X', 'valid_from' => '2025-01-01', 'source_reference' => 'x'] as $col => $val) {
            $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->update([$col => $val]), $col);
        }
        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->update(['status' => 'DRAFT']));
        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->update(['approved_by' => $this->engineer->getKey()]));
        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->delete());

        DB::table('khs_item_versions')->where('id', $id)->update(['status' => 'INACTIVE']); // forward is allowed
        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $id)->update(['status' => 'APPROVED']));
    }

    #[Test]
    public function two_approved_versions_of_one_item_cannot_overlap_and_the_event_log_is_append_only(): void
    {
        $this->approvedBase();
        $itemId = DB::table('khs_items')->where('code', '1')->value('id');
        $row = fn (int $n, string $from, ?string $until) => fn () => DB::table('khs_item_versions')->insert([
            'id' => (string) Str::uuid(), 'khs_item_id' => $itemId, 'version_number' => $n, 'name' => 'x', 'unit_text' => 'B',
            'valid_from' => $from, 'valid_until' => $until, 'status' => 'APPROVED', 'created_by' => $this->engineer->getKey(),
            'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->assertDbRejects($row(2, '2026-06-01', null));          // overlaps v1 (open-ended)
        $this->assertDbRejects($row(3, '2025-01-01', '2026-01-01'));  // touches v1's first day
        $this->assertDbRejects(fn () => DB::table('khs_item_versions')->where('id', $this->versionId('1'))->update(['status' => 'APPROVED', 'valid_until' => '2025-12-31']));

        $eventId = DB::table('khs_version_events')->value('id');
        $this->assertDbRejects(fn () => DB::table('khs_version_events')->where('id', $eventId)->update(['reason' => 'x']));
        $this->assertDbRejects(fn () => DB::table('khs_version_events')->where('id', $eventId)->delete());
        $this->assertDbRejects(fn () => DB::statement('TRUNCATE khs_version_events'));
    }

    // ---- drafts and retirement -------------------------------------------------------

    #[Test]
    public function a_draft_can_be_corrected_with_a_reason_but_an_approved_version_cannot(): void
    {
        $this->import(self::BASE)->assertCreated();
        $id = $this->versionId('1');

        $this->as($this->planner)->patchJson("/api/master-data/khs/versions/{$id}", ['name' => 'Tiang Beton 12 m'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->as($this->planner)->patchJson("/api/master-data/khs/versions/{$id}", ['name' => 'Tiang Beton 12 m', 'reason' => 'Salah ketik'])->assertOk()->assertJsonPath('data.name', 'Tiang Beton 12 m');
        $this->as($this->planner)->patchJson("/api/master-data/khs/versions/{$id}", ['name' => 'Tiang Beton 12 m', 'reason' => 'x'])->assertStatus(409); // no change
        $e = DB::table('khs_version_events')->where('event_type', 'DRAFT_UPDATED')->first();
        $this->assertEquals(['before' => ['name' => 'Tiang Beton 11 m'], 'after' => ['name' => 'Tiang Beton 12 m']], json_decode($e->details, true)); // jsonb does not keep key order

        $this->approve([$id])->assertOk();
        $this->as($this->planner)->patchJson("/api/master-data/khs/versions/{$id}", ['name' => 'Lagi', 'reason' => 'x'])->assertStatus(409);
        $this->as($this->planner)->patchJson('/api/master-data/khs/versions/'.fake()->uuid(), ['name' => 'x', 'reason' => 'x'])->assertNotFound();
    }

    #[Test]
    public function retiring_an_approved_version_deactivates_it_with_a_reason_and_only_the_manager_may(): void
    {
        $this->approvedBase();
        $id = $this->versionId('1');

        $this->as($this->manager)->postJson("/api/master-data/khs/versions/{$id}/retire", [])->assertUnprocessable();
        $res = $this->as($this->manager)->postJson("/api/master-data/khs/versions/{$id}/retire", ['reason' => 'Kode dihapus dari KHS'])->assertOk();
        $this->assertSame('INACTIVE', $res->json('data.status'));
        $this->assertNotNull($res->json('data.valid_until'));
        $this->assertDatabaseHas('khs_version_events', ['khs_item_version_id' => $id, 'event_type' => 'RETIRED', 'reason' => 'Kode dihapus dari KHS']);

        $this->as($this->manager)->postJson("/api/master-data/khs/versions/{$id}/retire", ['reason' => 'x'])->assertStatus(409); // already inactive
        $this->import("code,name,unit\n99,Draf,B\n")->assertCreated();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/'.$this->versionId('99').'/retire', ['reason' => 'x'])->assertStatus(409); // a draft is not retired
        $this->assertNull($this->as($this->viewer)->getJson('/api/master-data/khs?search=Tiang')->json('data.0.current')); // no longer current
    }

    // ---- reading ---------------------------------------------------------------------

    #[Test]
    public function the_list_searches_by_code_or_name_filters_pending_drafts_and_paginates(): void
    {
        $this->approvedBase();
        $this->import("code,name,unit\n2,Kabel Twisted 3x95,M\n", ['valid_from' => '2026-07-01'])->assertCreated();

        $this->as($this->viewer)->getJson('/api/master-data/khs?search=isolator')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.code', '10');
        $this->as($this->viewer)->getJson('/api/master-data/khs?search=10')->assertJsonPath('data.0.code', '10');
        $this->as($this->viewer)->getJson('/api/master-data/khs?search=%25')->assertJsonPath('meta.total', 0);
        $pending = $this->as($this->viewer)->getJson('/api/master-data/khs?has_draft=1')->assertOk();
        $this->assertSame(['2'], array_column($pending->json('data'), 'code'));
        $this->assertTrue($pending->json('data.0.has_draft'));
        $this->assertSame($this->versionId('2', 2), $pending->json('data.0.draft.id')); // approvable without opening the item
        $this->assertSame([2, $this->engineer->getKey()], [$pending->json('data.0.draft.version_number'), $pending->json('data.0.draft.created_by')]);
        $this->assertNull($this->as($this->viewer)->getJson('/api/master-data/khs?search=Isolator')->json('data.0.draft'));
        $this->assertSame(2, $pending->json('data.0.versions_count'));

        $page = $this->as($this->viewer)->getJson('/api/master-data/khs?per_page=2')->json();
        $this->assertSame([2, 3, 2], [count($page['data']), $page['meta']['total'], $page['meta']['last_page']]);
        $this->as($this->viewer)->getJson('/api/master-data/khs/'.fake()->uuid())->assertNotFound();
    }

    #[Test]
    public function a_future_dated_version_is_not_current_yet(): void
    {
        $this->import("code,name,unit\n5,Masa depan,B\n", ['valid_from' => '2099-01-01'])->assertCreated();
        $this->approve([$this->versionId('5')])->assertOk();

        $this->assertNull($this->as($this->viewer)->getJson('/api/master-data/khs?search=Masa')->json('data.0.current'));
    }

    #[Test]
    public function quoted_cells_may_span_lines_and_untidy_whitespace_in_names_becomes_single_spaces(): void
    {
        // Real data: KHS 186/187 contain a line break inside the name; many names have runs of spaces.
        $csv = "code,name,unit,category\n186,\"Kubikel (1 LBS Incoming minimal rating arus\n1250 A ) > 20 MVA\",S,MDU\n153,\"Galian  &   pengurugan\t kembali\",M3,\n187,Normal,B,\n";
        $res = $this->import($csv)->assertCreated();

        $this->assertSame([3, 0], [$res->json('data.new_items'), $res->json('data.rejected')]); // 3 records, not 4 physical lines
        $this->assertSame('Kubikel (1 LBS Incoming minimal rating arus 1250 A ) > 20 MVA', DB::table('khs_item_versions')->where('id', $this->versionId('186'))->value('name'));
        $this->assertSame('Galian & pengurugan kembali', DB::table('khs_item_versions')->where('id', $this->versionId('153'))->value('name'));

        // Re-importing the same untidy file is "unchanged": the rule is applied on both sides.
        $this->approve([$this->versionId('186'), $this->versionId('153'), $this->versionId('187')])->assertOk();
        $this->assertSame(3, $this->import($csv, ['dry_run' => true])->json('data.unchanged'));
    }

    #[Test]
    public function record_numbers_count_blank_lines_and_the_header_is_record_one(): void
    {
        $rows = $this->import("code,name,unit\n1,Satu,B\n\n2,,B\n", ['dry_run' => true])->json('rows');
        $this->assertSame([2, 4], array_column($rows, 'row'));
    }
}
