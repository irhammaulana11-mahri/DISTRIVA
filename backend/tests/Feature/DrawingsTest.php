<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\DrawingPermissionSeeder;
use Database\Seeders\MtoPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class DrawingsTest extends PostgresTestCase
{
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private OrganizationalUnit $upA;

    private OrganizationalUnit $ulpA;

    private OrganizationalUnit $upB;

    private OrganizationalUnit $ulpB;

    private User $retail;

    private User $manager;

    private User $teknik;

    private User $teknik2;

    private User $teknikB;

    private User $perencanaan;

    private User $konstruksi;

    private User $asmanPer;

    private User $asmanNiaga;

    private User $asmanKon;

    private User $up3Manager;

    private User $up3ManagerB;

    private User $vendor;

    private User $sysAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        foreach ([ApplicationPermissionSeeder::class, SurveyPermissionSeeder::class, DrawingPermissionSeeder::class, MtoPermissionSeeder::class, PlanningPermissionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
        $this->upA = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $this->upA);
        $this->upB = $this->makeUnit('UP3');
        $this->ulpB = $this->makeUnit('ULP', $this->upB);
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retail = $mk('NIAGA_RETAIL', $this->ulpA);
        $this->manager = $mk('MANAGER_ULP', $this->ulpA);
        $this->teknik = $mk('TEKNIK', $this->ulpA);
        $this->teknik2 = $mk('TEKNIK', $this->ulpA);
        $this->teknikB = $mk('TEKNIK', $this->ulpB);
        $this->perencanaan = $mk('PERENCANAAN', $this->upA);
        $this->konstruksi = $mk('KONSTRUKSI', $this->upA);
        $this->asmanPer = $mk('ASMAN_PERENCANAAN', $this->upA);
        $this->asmanNiaga = $mk('ASMAN_NIAGA', $this->upA);
        $this->asmanKon = $mk('ASMAN_KONSTRUKSI', $this->upA);
        $this->up3Manager = $mk('MANAGER_UP3', $this->upA);
        $this->up3ManagerB = $mk('MANAGER_UP3', $this->upB);
        $this->vendor = $mk('VENDOR', $this->ulpA);
        $this->sysAdmin = $mk('SYS_ADMIN', null);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function png(string $name = 'denah.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, (string) base64_decode(self::PNG));
    }

    /** An APPROVED application of ULP A with an ACCEPTED survey that says a drawing is (not) needed. */
    private function application(?bool $requiresDrawing = true, string $status = 'APPROVED'): string
    {
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4)], 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
        if ($status !== 'APPROVED') {
            DB::table('applications')->where('id', $id)->update(['current_status' => $status]);
        }
        if ($requiresDrawing !== null) {
            $sid = (string) Str::uuid();
            DB::table('application_surveys')->insert(['id' => $sid, 'application_id' => $id, 'sequence_number' => 1, 'survey_number' => 'SRV-'.Str::random(6), 'status' => 'ACCEPTED', 'assigned_to' => $this->teknik->getKey(),
                'assigned_by' => $this->manager->getKey(), 'created_by' => $this->manager->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            DB::table('application_survey_versions')->insert(['id' => (string) Str::uuid(), 'survey_id' => $sid, 'version_number' => 1, 'status' => 'ACCEPTED', 'surveyor_id' => $this->teknik->getKey(),
                'requires_drawing' => $requiresDrawing, 'accepted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            if ($requiresDrawing) {                                       // owner 2026-11-16: the drawing belongs to the usulan Teknik ULP made after the survey
                $pid = (string) Str::uuid();
                DB::table('proposals')->insert(['id' => $pid, 'proposal_number' => '9'.Str::random(4).'/USULAN-PBPD/T', 'issued_at' => now(), 'ulp_unit_id' => $this->ulpA->getKey(), 'representative_application_id' => $id, 'status' => 'OPEN',
                    'created_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                DB::table('proposal_applications')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $pid, 'application_id' => $id, 'added_by' => $this->teknik->getKey(), 'added_at' => now()]);
            }
        }

        return $id;
    }

    private function assignDrawing(string $app, ?User $author = null, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson("/api/applications/{$app}/drawing", ['assigned_to' => ($author ?? $this->teknik)->getKey()]);
    }

    /** @return array{0:string,1:string,2:string} drawing id, open version id, application id */
    private function started(): array
    {
        $app = $this->application();
        $r = $this->assignDrawing($app)->assertCreated();

        return [$r->json('data.id'), $r->json('data.versions.0.id'), $app];
    }

    private function fillAndAttach(string $drawing, string $version, ?User $by = null): void
    {
        $this->as($by ?? $this->teknik)->patchJson("/api/drawings/{$drawing}/versions/{$version}", ['title' => 'SLD dan denah JTR', 'description' => 'Sambungan baru 900 VA', 'notes' => 'Skala 1:500'])->assertOk();
        $this->as($by ?? $this->teknik)->post("/api/drawings/{$drawing}/versions/{$version}/documents", ['file' => $this->png(), 'role' => 'MAIN', 'title' => 'Gambar utama'], ['Accept' => 'application/json'])->assertCreated();
        $this->as($by ?? $this->teknik)->post("/api/drawings/{$drawing}/versions/{$version}/documents", ['file' => $this->png('lampiran.png'), 'role' => 'ATTACHMENT'], ['Accept' => 'application/json'])->assertCreated();
        if (! DB::table('mto_packages')->where('drawing_version_id', $version)->exists()) {
            $this->seedApprovedMto($version);
        }
    }

    /** @return array{0:string,1:string,2:string} */
    private function submitted(): array
    {
        [$d, $v, $app] = $this->started();
        $this->fillAndAttach($d, $v);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();

        return [$d, $v, $app];
    }

    /** Drawing and MTO are submitted together and decided together (owner 2026-11-11): a submit needs the MTO package; seed one directly (VERIFIED, as submit leaves it). */
    private function seedApprovedMto(string $version, string $status = 'VERIFIED'): void
    {
        $app = DB::table('application_drawing_versions as v')->join('application_drawings as d', 'd.id', '=', 'v.drawing_id')->where('v.id', $version)->value('d.application_id');
        DB::table('mto_packages')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'drawing_version_id' => $version, 'package_number' => 'MTO-T-'.Str::random(8), 'status' => $status, 'valid_on' => '2026-11-06',
            'params' => '{}', 'snapshot_hash' => str_repeat('a', 64), 'created_by' => $this->teknik->getKey(), 'verified_by' => $this->teknik->getKey(), 'verified_at' => now(), 'approved_by' => $status === 'APPROVED' ? $this->manager->getKey() : null,
            'approved_at' => $status === 'APPROVED' ? now() : null, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function decide(string $drawing, string $version, User $by, string $step, string $decision = 'APPROVED', ?string $notes = null)
    {
        if ($step === 'ULP_MANAGER' && $decision === 'APPROVED' && ! DB::table('mto_packages')->where('drawing_version_id', $version)->exists()) {
            $this->seedApprovedMto($version);
        }

        return $this->as($by)->postJson("/api/drawings/{$drawing}/versions/{$version}/decisions", array_filter(['step' => $step, 'decision' => $decision, 'notes' => $notes], fn ($x) => $x !== null));
    }

    /** @return array{0:string,1:?string} */
    private function vs(string $version): array
    {
        $v = DB::table('application_drawing_versions')->where('id', $version)->first();

        return [$v->status, $v->stage];
    }

    private function approveUpToReview(string $d, string $v): void
    {
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
    }

    /** The normal chain from SUBMITTED to APPROVED: manager, both UP3 reviews, both Asman. */
    private function completeNormalChain(string $d, string $v): void
    {
        foreach ([[$this->manager, 'ULP_MANAGER'], [$this->perencanaan, 'REVIEW_PERENCANAAN'], [$this->konstruksi, 'REVIEW_KONSTRUKSI'], [$this->asmanPer, 'ASMAN_PERENCANAAN'], [$this->asmanKon, 'ASMAN_KONSTRUKSI']] as [$u, $step]) {
            $this->decide($d, $v, $u, $step)->assertOk();
        }
    }

    // ---- the drawing belongs to the usulan made after the survey (owner 2026-11-16) -------------------------------------------------

    #[Test]
    public function the_survey_stops_at_the_ulp_manager_and_the_drawing_is_made_for_the_usulan_that_teknik_creates_afterwards(): void
    {
        $app = $this->application(null);                                                                              // no survey yet
        $sv = $this->as($this->manager)->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        [$s, $sver] = [$sv->json('data.id'), $sv->json('data.versions.0.id')];

        $this->assignDrawing($app)->assertStatus(409);                                                                // the survey has not said a drawing is needed yet
        $this->as($this->teknik)->patchJson("/api/surveys/{$s}/versions/{$sver}", ['survey_date' => '2026-11-06', 'findings' => 'Perlu perluasan', 'technical_recommendation' => 'Tarik JTR',
            'requires_drawing' => true, 'requires_network_extension' => true, 'requires_feasibility_study' => false, 'sr_length_m' => 20, 'network_distance_m' => 60])->assertOk();
        $this->assignDrawing($app)->assertStatus(409);                                                                // not accepted yet: no drawing
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$sver}/documents", ['file' => $this->png('foto.png'), 'title' => 'Foto lokasi'], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$sver}/submit")->assertOk();
        $this->as($this->manager)->postJson("/api/surveys/{$s}/versions/{$sver}/decisions", ['step' => 'ULP_MANAGER', 'decision' => 'APPROVED'])->assertOk()->assertJsonPath('result.survey_status', 'ACCEPTED');   // no drawing needed to pass
        $this->assignDrawing($app)->assertStatus(409);                                                                // accepted, but the usulan is not made yet

        $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $app])->assertCreated();
        $d = $this->assignDrawing($app)->assertCreated();                                                             // now the usulan's drawing
        [$drawing, $dver] = [$d->json('data.id'), $d->json('data.versions.0.id')];
        $this->fillAndAttach($drawing, $dver);
        $this->as($this->teknik)->postJson("/api/drawings/{$drawing}/versions/{$dver}/submit")->assertOk();
        $this->assertNull(DB::table('application_drawing_versions')->where('id', $dver)->value('survey_version_id'));   // it never rides a survey
        $this->assertSame(['SUBMITTED', 'ULP_MANAGER'], $this->vs($dver));
        $this->decide($drawing, $dver, $this->manager, 'ULP_MANAGER')->assertOk();                                      // MULP, then up to UP3
        $this->assertSame(['UNDER_REVIEW', 'UP3_REVIEW'], $this->vs($dver));
        $this->decide($drawing, $dver, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
        $this->decide($drawing, $dver, $this->konstruksi, 'REVIEW_KONSTRUKSI')->assertOk();
        $this->assertSame(['UNDER_REVIEW', 'ASMAN'], $this->vs($dver));
        $this->decide($drawing, $dver, $this->asmanPer, 'ASMAN_PERENCANAAN')->assertOk();
        $this->decide($drawing, $dver, $this->asmanKon, 'ASMAN_KONSTRUKSI')->assertOk();
        $this->assertSame(['APPROVED', null], $this->vs($dver));
    }

    #[Test]
    public function cancelling_the_proposal_cancels_the_running_survey_but_keeps_an_accepted_survey(): void
    {
        $app = $this->application(null);
        $sv = $this->as($this->manager)->postJson("/api/applications/{$app}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        [$s, $sver] = [$sv->json('data.id'), $sv->json('data.versions.0.id')];
        $this->as($this->teknik)->patchJson("/api/surveys/{$s}/versions/{$sver}", ['survey_date' => '2026-11-06', 'findings' => 'x', 'technical_recommendation' => 'y', 'requires_drawing' => true,
            'requires_network_extension' => true, 'requires_feasibility_study' => false, 'sr_length_m' => 20, 'network_distance_m' => 60])->assertOk();
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$sver}/documents", ['file' => $this->png('foto.png')], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$sver}/submit")->assertOk();                  // the survey now waits for the ULP manager

        $pid = $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$app]])->assertCreated()->json('data.id');
        $before = DB::table('user_notifications')->where('user_id', $this->manager->getKey())->count();
        $this->as($this->retail)->postJson("/api/proposals/{$pid}/cancel", ['reason' => 'Pelanggan mundur'])->assertOk();
        $this->assertSame(['CANCELLED', 'Usulan dibatalkan: Pelanggan mundur'], [DB::table('application_surveys')->where('id', $s)->value('status'), DB::table('application_surveys')->where('id', $s)->value('cancel_reason')]);
        $this->as($this->manager)->postJson("/api/surveys/{$s}/versions/{$sver}/decisions", ['step' => 'ULP_MANAGER', 'decision' => 'APPROVED'])->assertStatus(409);   // nothing left to decide
        $this->assertSame($before + 1, DB::table('user_notifications')->where('user_id', $this->manager->getKey())->count());   // the waiting manager is told
        $this->assertTrue(DB::table('user_notifications')->where('user_id', $this->manager->getKey())->where('title', 'like', '%dibatalkan%')->exists());

        // an ACCEPTED survey is history and is left alone
        $app2 = $this->application(true);
        $sid = DB::table('application_surveys')->where('application_id', $app2)->value('id');
        $pid2 = DB::table('proposals')->where('representative_application_id', $app2)->value('id');
        $this->as($this->retail)->postJson("/api/proposals/{$pid2}/cancel", ['reason' => 'Batal'])->assertOk();
        $this->assertSame('ACCEPTED', DB::table('application_surveys')->where('id', $sid)->value('status'));
    }

    #[Test]
    public function a_survey_accepted_without_network_extension_closes_the_proposal_and_frees_its_members_as_ordinary_applications(): void
    {
        $leader = $this->application(null);
        $member = $this->application(null);
        $pid = $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$leader, $member]])->assertCreated()->json('data.id');
        $sv = $this->as($this->manager)->postJson("/api/applications/{$leader}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        [$s, $v] = [$sv->json('data.id'), $sv->json('data.versions.0.id')];
        $this->as($this->teknik)->patchJson("/api/surveys/{$s}/versions/{$v}", ['survey_date' => '2026-11-06', 'findings' => 'Cukup dari SR', 'technical_recommendation' => 'Sambung SR',
            'requires_drawing' => false, 'requires_network_extension' => false, 'requires_feasibility_study' => false, 'sr_length_m' => 10, 'network_distance_m' => 20])->assertOk();
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => $this->png('foto.png')], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();
        $this->assertSame('OPEN', DB::table('proposals')->where('id', $pid)->value('status'));                         // still open until the survey is accepted
        // owner 2026-11-14: "no extension" is accepted by the ULP manager alone
        $this->as($this->manager)->postJson("/api/surveys/{$s}/versions/{$v}/decisions", ['step' => 'ULP_MANAGER', 'decision' => 'APPROVED'])->assertOk()->assertJsonPath('result.survey_status', 'ACCEPTED');

        $this->assertSame('COMPLETED_NO_EXTENSION', DB::table('proposals')->where('id', $pid)->value('status'));
        $this->assertSame(0, DB::table('proposal_applications')->where('proposal_id', $pid)->whereNull('released_at')->count());     // everybody is released
        $this->assertTrue(DB::table('proposal_events')->where('proposal_id', $pid)->where('event_type', 'COMPLETED_NO_EXTENSION')->exists());
        $this->assertDbRejects(fn () => DB::table('proposals')->where('id', $pid)->update(['status' => 'OPEN']));             // a closed proposal is final
        $this->as($this->retail)->postJson("/api/proposals/{$pid}/cancel", ['reason' => 'x'])->assertStatus(409);
        $this->assertNull($this->as($this->retail)->getJson("/api/applications/{$member}")->assertOk()->json('data.proposal'));      // the member is an ordinary application again
        $this->as($this->manager)->postJson("/api/applications/{$member}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();    // and can be surveyed on its own

        // an accepted survey that DOES need an extension leaves the proposal open
        $l2 = $this->application(null);
        $pid2 = $this->as($this->retail)->postJson('/api/proposals', ['application_ids' => [$l2]])->assertCreated()->json('data.id');
        $sv2 = $this->as($this->manager)->postJson("/api/applications/{$l2}/surveys", ['assigned_to' => $this->teknik->getKey()])->assertCreated();
        DB::table('application_survey_versions')->where('id', $sv2->json('data.versions.0.id'))->update(['requires_network_extension' => true]);
        $this->assertSame('OPEN', DB::table('proposals')->where('id', $pid2)->value('status'));
    }

    // ---- grants ----------------------------------------------------------------------------------

    #[Test]
    public function the_drawing_keys_are_granted_to_the_owner_decided_roles_only(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('drawings.assign'));
        $this->assertSame(['SYS_ADMIN', 'TEKNIK'], $holders('drawings.execute'));
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('drawings.approve_ulp'));
        $this->assertSame(['PERENCANAAN', 'SYS_ADMIN'], $holders('drawings.review_perencanaan'));
        $this->assertSame(['KONSTRUKSI', 'SYS_ADMIN'], $holders('drawings.review_konstruksi'));
        $this->assertSame(['ASMAN_PERENCANAAN', 'SYS_ADMIN'], $holders('drawings.approve_asman_perencanaan'));
        $this->assertSame(['ASMAN_NIAGA', 'SYS_ADMIN'], $holders('drawings.approve_asman_niaga'));
        $this->assertSame(['ASMAN_KONSTRUKSI', 'SYS_ADMIN'], $holders('drawings.approve_asman_konstruksi'));
        $this->assertSame(['MANAGER_UP3', 'SYS_ADMIN'], $holders('drawings.approve_up3_manager'));
        $this->assertSame(['KONSTRUKSI', 'MANAGER_ULP', 'PERENCANAAN', 'SYS_ADMIN'], $holders('drawings.escalate'));
        $this->assertNotContains('VENDOR', $holders('drawings.view'));
        $this->assertSame(11, DB::table('permissions')->where('name', 'like', 'drawings.%')->count());
        $this->seed(DrawingPermissionSeeder::class);
        $this->assertSame(11, DB::table('permissions')->where('name', 'like', 'drawings.%')->count());
    }

    // ---- start conditions --------------------------------------------------------------------------

    #[Test]
    public function a_package_starts_only_after_an_accepted_survey_that_requires_a_drawing(): void
    {
        $this->assignDrawing($this->application(null))->assertStatus(409);                                         // no survey yet
        $r = $this->assignDrawing($this->application(false))->assertStatus(409);                                  // accepted survey: drawing not needed -> stage skipped
        $this->assertStringContainsString('dilewati', $r->json('message'));
        $app = $this->application(true);
        DB::table('application_surveys')->where('application_id', $app)->update(['status' => 'CANCELLED']);
        DB::table('application_survey_versions')->whereIn('survey_id', DB::table('application_surveys')->where('application_id', $app)->pluck('id'))->update(['accepted_at' => null]);
        $ok = $this->assignDrawing($this->application(true))->assertCreated();
        $this->assertSame(['DRAFT', 1], [$ok->json('data.versions.0.status'), $ok->json('data.versions.0.version_number')]);
        $this->assertStringStartsWith('GBR-PBPD-', $ok->json('data.drawing_number'));
        $this->assertTrue($ok->json('data.can.assign'));
    }

    #[Test]
    public function the_application_must_be_open_there_is_one_package_and_the_author_is_a_teknik_of_the_ulp(): void
    {
        foreach (['DRAFT', 'CONNECTION_DONE', 'CANCELLED'] as $status) {
            $app = $this->application(true);
            DB::table('applications')->where('id', $app)->update(['current_status' => $status]);
            $this->assignDrawing($app)->assertStatus(409);
        }
        $app = $this->application(true);
        foreach ([$this->retail, $this->teknik, $this->perencanaan, $this->up3Manager, $this->vendor] as $u) {
            $this->assignDrawing($app, $this->teknik, $u)->assertForbidden();
        }
        $this->as($this->vendor)->postJson("/api/applications/{$app}/drawing", [])->assertForbidden();               // grant before validation
        $this->as($this->manager)->postJson("/api/applications/{$app}/drawing", [])->assertForbidden();                // the manager does not prepare drawings: naming an author (assigned_to) is the manager's action
        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpB);
        $this->assignDrawing($app, $this->teknik, $other)->assertNotFound();
        $this->assignDrawing($app, $this->retail)->assertStatus(409);
        $this->assignDrawing($app, $this->teknikB)->assertStatus(409);
        $this->assertSame(0, DB::table('application_drawings')->count());

        $this->assignDrawing($app, $this->teknik2)->assertCreated();                                               // the author may be another TEKNIK than the surveyor
        $this->assignDrawing($app)->assertStatus(409);                                                             // one package per application
        $list = $this->as($this->manager)->getJson("/api/applications/{$app}/drawing/authors")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([$this->teknik->getKey(), $this->teknik2->getKey()], array_column($list, 'id'));
        $this->as($this->teknik)->getJson("/api/applications/{$app}/drawing/authors")->assertForbidden();
    }

    // ---- author work ----------------------------------------------------------------------------------

    #[Test]
    public function only_the_author_fills_the_draft_uploads_one_main_file_plus_attachments_and_submits(): void
    {
        [$d, $v] = $this->started();
        $edit = fn (User $u) => $this->as($u)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => 'x']);
        $this->as($this->teknik2)->patchJson("/api/drawings/{$d}/versions/{$v}", ['notes' => 'catatan teknik lain'])->assertOk();                  // role-based (owner 7 Nov 2026): any TEKNIK of the ULP may work on the draft
        $this->assertSame($this->teknik2->getKey(), DB::table('application_drawing_versions')->where('id', $v)->value('author_id'));          // and becomes its recorded author
        $edit($this->manager)->assertForbidden();
        $edit($this->vendor)->assertForbidden();
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", [])->assertStatus(409);
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => str_repeat('x', 201)])->assertUnprocessable();

        $r = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertStatus(409);
        $this->assertStringContainsString('judul gambar', $r->json('message'));
        $this->assertStringContainsString('berkas gambar utama', $r->json('message'));

        $this->fillAndAttach($d, $v);
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png('lain.png'), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertStatus(409);   // one MAIN only
        $this->as($this->teknik2)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'ATTACHMENT'], ['Accept' => 'application/json'])->assertForbidden();
        $this->as($this->vendor)->post("/api/drawings/{$d}/versions/{$v}/documents", [], ['Accept' => 'application/json'])->assertForbidden();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'BOGUS'], ['Accept' => 'application/json'])->assertUnprocessable();

        $sub = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();
        $this->assertSame(['SUBMITTED', 'ULP_MANAGER'], [$sub->json('data.versions.0.status'), $sub->json('data.versions.0.stage')]);
        $this->assertSame(['MAIN', 'ATTACHMENT'], array_column($sub->json('data.versions.0.documents'), 'file_role'));
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => 'baru'])->assertStatus(409);               // frozen
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'ATTACHMENT'], ['Accept' => 'application/json'])->assertStatus(409);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertStatus(409);
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['title' => 'diubah']));
    }

    #[Test]
    public function a_drawing_is_submitted_together_with_its_mto_so_a_missing_mto_package_blocks_it(): void
    {
        [$d, $v] = $this->started();
        $this->as($this->teknik)->patchJson("/api/drawings/{$d}/versions/{$v}", ['title' => 'SLD'])->assertOk();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
        $r = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertStatus(409);
        $this->assertStringContainsString('paket MTO', $r->json('message'));
        $this->assertSame('DRAFT', $this->vs($v)[0]);
    }

    #[Test]
    public function the_drawing_title_follows_the_main_file_name_and_a_blank_title_never_blocks_the_submit(): void
    {
        [$d, $v] = $this->started();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png(), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
        $main = DB::table('application_documents')->where('drawing_version_id', $v)->where('file_role', 'MAIN')->value('title');
        $this->assertStringStartsWith('GBR_', $main);
        $this->assertSame($main, DB::table('application_drawing_versions')->where('id', $v)->value('title'));      // filled by the upload
        DB::table('application_drawing_versions')->where('id', $v)->update(['title' => null]);
        $this->seedApprovedMto($v);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();                  // the main file's title fills the gap
        $this->assertSame($main, DB::table('application_drawing_versions')->where('id', $v)->value('title'));
    }

    #[Test]
    public function files_of_a_draft_can_be_removed_and_replaced_but_not_after_submission(): void
    {
        [$d, $v] = $this->started();
        $this->fillAndAttach($d, $v);
        $main = DB::table('application_documents')->where('drawing_version_id', $v)->where('file_role', 'MAIN')->value('id');
        $this->as($this->teknik2)->postJson("/api/documents/{$main}/remove")->assertForbidden();
        $this->as($this->teknik)->postJson("/api/documents/{$main}/remove")->assertOk();
        $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => $this->png('baru.png'), 'role' => 'MAIN'], ['Accept' => 'application/json'])->assertCreated();
        $this->assertSame(1, DB::table('application_documents')->where('drawing_version_id', $v)->where('file_role', 'MAIN')->where('status', 'ACTIVE')->count());
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();
        $att = DB::table('application_documents')->where('drawing_version_id', $v)->where('file_role', 'ATTACHMENT')->value('id');
        $this->as($this->teknik)->postJson("/api/documents/{$att}/remove")->assertStatus(409);
    }

    // ---- the normal chain ---------------------------------------------------------------------------------

    #[Test]
    public function the_normal_chain_needs_the_manager_both_up3_reviews_and_both_asman_before_the_drawing_is_approved(): void
    {
        [$d, $v] = $this->submitted();
        $this->assertSame(['SUBMITTED', 'ULP_MANAGER'], $this->vs($v));
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk()->assertJsonPath('result.stage', 'UP3_REVIEW');
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk()->assertJsonPath('result.stage', 'UP3_REVIEW');      // one of two
        $this->assertSame(['UNDER_REVIEW', 'UP3_REVIEW'], $this->vs($v));
        $r = $this->decide($d, $v, $this->konstruksi, 'REVIEW_KONSTRUKSI')->assertOk();
        $this->assertSame(['UNDER_REVIEW', 'ASMAN'], [$r->json('result.version_status'), $r->json('result.stage')]);                    // the reviews alone do NOT approve

        $this->decide($d, $v, $this->asmanNiaga, 'ASMAN_NIAGA')->assertStatus(409);                                                       // ASMAN_NIAGA exists only in the extended chain
        $this->decide($d, $v, $this->up3Manager, 'UP3_MANAGER')->assertStatus(409);                                                       // and so does the UP3 manager stage
        $this->decide($d, $v, $this->asmanPer, 'ASMAN_PERENCANAAN')->assertOk()->assertJsonPath('result.stage', 'ASMAN');                 // one of two
        $this->assertSame(['UNDER_REVIEW', 'ASMAN'], $this->vs($v));
        $done = $this->decide($d, $v, $this->asmanKon, 'ASMAN_KONSTRUKSI')->assertOk();
        $this->assertSame(['APPROVED', null], [$done->json('result.version_status'), $done->json('result.stage')]);
        $this->assertNotNull(DB::table('application_drawing_versions')->where('id', $v)->value('approved_at'));
        $this->assertSame(['MANAGER_ULP', 'PERENCANAAN', 'KONSTRUKSI', 'ASMAN_PERENCANAAN', 'ASMAN_KONSTRUKSI'], collect($done->json('data.versions.0.decisions'))->pluck('decided_role')->all());
        $this->assertSame(['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN'], $done->json('data.versions.0.required_steps'));
    }

    #[Test]
    public function if_only_one_of_the_two_asman_approves_the_drawing_goes_back_to_the_teknik_author(): void
    {
        [$d, $v] = $this->submitted();
        foreach ([[$this->manager, 'ULP_MANAGER'], [$this->perencanaan, 'REVIEW_PERENCANAAN'], [$this->konstruksi, 'REVIEW_KONSTRUKSI'], [$this->asmanPer, 'ASMAN_PERENCANAAN']] as [$u, $step]) {
            $this->decide($d, $v, $u, $step)->assertOk();
        }
        $r = $this->decide($d, $v, $this->asmanKon, 'ASMAN_KONSTRUKSI', 'REJECTED', 'Spesifikasi tiang tidak sesuai standar konstruksi')->assertOk();
        $this->assertSame('RETURNED', $r->json('result.version_status'));
        $new = DB::table('application_drawing_versions')->where('id', $r->json('result.new_version_id'))->first();
        $this->assertSame(['DRAFT', $this->teknik->getKey()], [$new->status, $new->author_id]);
        $this->assertSame('RETURNED', $this->vs($v)[0]);
        $this->assertNotSame('APPROVED', DB::table('application_drawing_versions')->where('drawing_id', $d)->orderByDesc('version_number')->value('status'));
    }

    #[Test]
    public function a_step_is_decided_in_its_turn_once_and_by_the_right_role_in_the_right_unit(): void
    {
        [$d, $v] = $this->submitted();
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertStatus(409);
        $this->decide($d, $v, $this->perencanaan, 'ULP_MANAGER')->assertForbidden();
        $this->decide($d, $v, $this->retail, 'ULP_MANAGER')->assertForbidden();
        $this->decide($d, $v, $this->vendor, 'ULP_MANAGER')->assertForbidden();
        $otherManager = $this->makeUser();
        $this->assign($otherManager, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpB);
        $this->decide($d, $v, $otherManager, 'ULP_MANAGER')->assertNotFound();
        $this->decide($d, $v, $this->manager, 'NOT_A_STEP')->assertUnprocessable();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertStatus(409);
        $b = $this->makeUser();
        $this->assign($b, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->upB);
        $this->decide($d, $v, $b, 'REVIEW_PERENCANAAN')->assertNotFound();
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
    }

    #[Test]
    public function the_author_never_decides_and_one_user_decides_only_once_per_version(): void
    {
        [$d, $v] = $this->submitted();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $dual = $this->makeUser();
        $this->assign($dual, Role::query()->where('name', 'PERENCANAAN')->firstOrFail(), $this->upA);
        $this->assign($dual, Role::query()->where('name', 'KONSTRUKSI')->firstOrFail(), $this->upA);
        $this->decide($d, $v, $dual, 'REVIEW_PERENCANAAN')->assertOk();
        $this->decide($d, $v, $dual, 'REVIEW_KONSTRUKSI')->assertForbidden();

        [$d2, $v2] = $this->started();
        $mt = $this->makeUser();
        $this->assign($mt, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA);
        $this->assign($mt, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);
        $this->as($this->manager)->postJson("/api/drawings/{$d2}/reassign", ['assigned_to' => $mt->getKey()])->assertOk();
        $this->fillAndAttach($d2, $v2, $mt);
        $this->as($mt)->postJson("/api/drawings/{$d2}/versions/{$v2}/submit")->assertOk();
        $this->decide($d2, $v2, $mt, 'ULP_MANAGER')->assertForbidden();
        $this->assertDbRejects(fn () => DB::table('application_drawing_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $v2, 'step' => 'ULP_MANAGER', 'decision' => 'APPROVED', 'decided_by' => $mt->getKey(), 'decided_role' => 'MANAGER_ULP', 'decided_at' => now()]));
    }

    // ---- the extended chain ---------------------------------------------------------------------------------------

    #[Test]
    public function when_the_feasibility_is_not_met_or_pbp_exceeds_5_years_asman_niaga_and_the_up3_manager_must_also_approve(): void
    {
        [$d, $v] = $this->submitted();
        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", [])->assertUnprocessable();                                 // a reason is required
        $e = $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'PBP 7 tahun'])->assertOk();
        $this->assertTrue($e->json('data.versions.0.extended_approval'));
        $this->assertSame(['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN', 'UP3_MANAGER'], $e->json('data.versions.0.required_steps'));
        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'lagi'])->assertStatus(409);                    // once

        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
        $r = $this->decide($d, $v, $this->konstruksi, 'REVIEW_KONSTRUKSI')->assertOk();
        $this->assertSame(['UNDER_REVIEW', 'ASMAN'], [$r->json('result.version_status'), $r->json('result.stage')]);                                // does NOT end here

        $this->decide($d, $v, $this->up3Manager, 'UP3_MANAGER')->assertStatus(409);                                                                   // not its turn
        $this->decide($d, $v, $this->asmanPer, 'ASMAN_PERENCANAAN')->assertOk()->assertJsonPath('result.stage', 'ASMAN');
        $this->decide($d, $v, $this->asmanNiaga, 'ASMAN_NIAGA')->assertOk()->assertJsonPath('result.stage', 'ASMAN');                                // two of three
        $this->assertSame(['UNDER_REVIEW', 'ASMAN'], $this->vs($v));
        $this->decide($d, $v, $this->asmanKon, 'ASMAN_KONSTRUKSI')->assertOk()->assertJsonPath('result.stage', 'UP3_MANAGER');
        $done = $this->decide($d, $v, $this->up3Manager, 'UP3_MANAGER')->assertOk();
        $this->assertSame(['APPROVED', null], [$done->json('result.version_status'), $done->json('result.stage')]);
        $this->assertSame(['MANAGER_ULP', 'PERENCANAAN', 'KONSTRUKSI', 'ASMAN_PERENCANAAN', 'ASMAN_NIAGA', 'ASMAN_KONSTRUKSI', 'MANAGER_UP3'], collect($done->json('data.versions.0.decisions'))->pluck('decided_role')->all());
    }

    #[Test]
    public function the_requirement_can_be_raised_during_the_up3_review_by_the_reviewers_but_never_lowered_or_raised_elsewhere(): void
    {
        [$d, $v] = $this->submitted();
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();                         // the author cannot
        $this->as($this->retail)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();
        $this->as($this->asmanPer)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();
        $this->as($this->perencanaan)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();                    // the reviewers act only during the UP3 review
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();                         // and the ULP manager only at the ULP stage
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
        $this->as($this->konstruksi)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'Kajian tidak layak'])->assertOk();             // raised while the review is open
        $this->decide($d, $v, $this->konstruksi, 'REVIEW_KONSTRUKSI')->assertOk()->assertJsonPath('result.stage', 'ASMAN');
        $this->as($this->perencanaan)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'x'])->assertForbidden();                    // the review is over (stage ASMAN)
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['extended_approval' => false]));             // never lowered

        [$d2, $v2] = $this->started();
        $this->as($this->manager)->postJson("/api/drawings/{$d2}/versions/{$v2}/escalate", ['reason' => 'x'])->assertForbidden();                       // still DRAFT: nobody may raise it
    }

    #[Test]
    public function the_database_refuses_to_end_the_chain_early_and_the_up3_manager_stage_exists_only_when_extended(): void
    {
        [$d, $v] = $this->submitted();
        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'PBP > 5 tahun'])->assertOk();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['status' => 'APPROVED', 'stage' => null]));                 // UP3_REVIEW -> APPROVED: never directly
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['stage' => 'UP3_MANAGER']));                                 // stages only move one step
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['extended_reason' => null, 'extended_set_by' => null]));    // the requirement keeps its reason and setter

        // normal chain: no UP3 manager stage, and the Asman stage cannot be skipped
        [$d2, $v2] = $this->submitted();
        $this->decide($d2, $v2, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->decide($d2, $v2, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
        $this->decide($d2, $v2, $this->konstruksi, 'REVIEW_KONSTRUKSI')->assertOk();
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v2)->update(['stage' => 'UP3_MANAGER']));                                 // only when extended
        $this->assertDbRejects(function () use ($v2): void {
            DB::table('application_drawing_versions')->where('id', $v2)->update(['extended_approval' => true]);                                                          // not allowed during the Asman stage
        });
    }

    // ---- rejection and revision ------------------------------------------------------------------------------------------

    #[Test]
    public function a_rejection_at_any_step_returns_the_version_and_the_chain_restarts_on_a_new_version(): void
    {
        [$d, $v] = $this->submitted();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->decide($d, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertOk();
        $this->decide($d, $v, $this->konstruksi, 'REVIEW_KONSTRUKSI', 'REJECTED')->assertStatus(409);                                                  // a reason is mandatory
        $r = $this->decide($d, $v, $this->konstruksi, 'REVIEW_KONSTRUKSI', 'REJECTED', 'Jarak antar tiang melebihi standar')->assertOk();
        $this->assertSame(['RETURNED', null], [$r->json('result.version_status'), $r->json('result.stage')]);
        $new = DB::table('application_drawing_versions')->where('id', $r->json('result.new_version_id'))->first();
        $old = DB::table('application_drawing_versions')->where('id', $v)->first();
        $this->assertSame(['DRAFT', 2, $this->teknik->getKey(), $old->title], [$new->status, $new->version_number, $new->author_id, $new->title]);
        $this->assertSame(['RETURNED', 'REVIEW_KONSTRUKSI', 'Jarak antar tiang melebihi standar'], [$old->status, $old->returned_at_step, $old->return_reason]);
        $this->assertSame(0, DB::table('application_documents')->where('drawing_version_id', $new->id)->count());                                       // the author uploads the corrected files
        $this->assertSame(2, DB::table('application_drawing_decisions')->where('version_id', $v)->count() - 1);                                         // old decisions kept (3 incl. the rejection)
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['title' => 'x']));

        $this->fillAndAttach($d, $new->id);                                                                                                           // second round: the whole chain again
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$new->id}/submit")->assertOk();
        $this->completeNormalChain($d, $new->id);
        $this->assertSame(['APPROVED', null], $this->vs($new->id));
    }

    #[Test]
    public function a_rejection_in_the_asman_stage_or_by_the_manager_also_returns_the_version(): void
    {
        [$d, $v] = $this->submitted();
        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions/{$v}/escalate", ['reason' => 'PBP 8 tahun'])->assertOk();
        foreach ([[$this->manager, 'ULP_MANAGER'], [$this->perencanaan, 'REVIEW_PERENCANAAN'], [$this->konstruksi, 'REVIEW_KONSTRUKSI'], [$this->asmanPer, 'ASMAN_PERENCANAAN']] as [$u, $step]) {
            $this->decide($d, $v, $u, $step)->assertOk();
        }
        $r = $this->decide($d, $v, $this->asmanNiaga, 'ASMAN_NIAGA', 'REJECTED', 'Justifikasi PBP belum cukup')->assertOk();
        $this->assertSame('RETURNED', $r->json('result.version_status'));
        $this->decide($d, $v, $this->asmanKon, 'ASMAN_KONSTRUKSI')->assertStatus(409);                                                                  // the old version is closed
        $newExtended = DB::table('application_drawing_versions')->where('id', $r->json('result.new_version_id'))->value('extended_approval');
        $this->assertFalse((bool) $newExtended);                                                                                                         // each version is judged afresh (stage 5 sets it from its KKF)

        [$d2, $v2] = $this->submitted();
        $this->decide($d2, $v2, $this->manager, 'ULP_MANAGER', 'REJECTED', 'Gambar tidak terbaca')->assertOk()->assertJsonPath('result.version_status', 'RETURNED');
    }

    #[Test]
    public function an_approved_drawing_stays_current_until_a_newer_version_is_approved_then_it_is_superseded(): void
    {
        [$d, $v] = $this->submitted();
        $this->completeNormalChain($d, $v);
        $this->assertSame(['APPROVED', null], $this->vs($v));

        $this->as($this->manager)->postJson("/api/drawings/{$d}/versions")->assertForbidden();
        $rev = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions")->assertCreated();
        $v2 = $rev->json('data.versions.1.id');
        $this->assertSame(['DRAFT', 2], [$rev->json('data.versions.1.status'), $rev->json('data.versions.1.version_number')]);
        $this->assertSame(['APPROVED', null], $this->vs($v));                                                                                          // v1 is still the current approved version
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions")->assertStatus(409);                                                          // one open version at a time

        $this->fillAndAttach($d, $v2);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v2}/submit")->assertOk();
        $this->assertSame(['APPROVED', null], $this->vs($v));
        foreach ([[$this->manager, 'ULP_MANAGER'], [$this->perencanaan, 'REVIEW_PERENCANAAN'], [$this->konstruksi, 'REVIEW_KONSTRUKSI'], [$this->asmanPer, 'ASMAN_PERENCANAAN']] as [$u, $step]) {
            $this->decide($d, $v2, $u, $step)->assertOk();
        }
        $this->assertSame(['APPROVED', null], $this->vs($v));                                                                                          // not replaced before the new one is approved
        $done = $this->decide($d, $v2, $this->asmanKon, 'ASMAN_KONSTRUKSI')->assertOk();
        $this->assertSame($v, $done->json('result.superseded_version_id'));
        $this->assertSame(['SUPERSEDED', null], $this->vs($v));
        $this->assertSame(['APPROVED', null], $this->vs($v2));
        $this->assertNotNull(DB::table('application_drawing_versions')->where('id', $v)->value('superseded_at'));
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['status' => 'APPROVED']));              // SUPERSEDED is final
    }

    #[Test]
    public function a_new_version_must_pass_the_whole_chain_and_the_previous_approval_is_not_inherited(): void
    {
        [$d, $v] = $this->submitted();
        $this->completeNormalChain($d, $v);
        $v2 = $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions")->assertCreated()->json('data.versions.1.id');
        $this->assertSame(0, DB::table('application_drawing_decisions')->where('version_id', $v2)->count());
        $this->assertSame(0, DB::table('application_documents')->where('drawing_version_id', $v2)->count());
        $this->decide($d, $v2, $this->manager, 'ULP_MANAGER')->assertStatus(409);                                                                       // still a draft
    }

    #[Test]
    public function an_application_that_is_no_longer_open_blocks_the_work(): void
    {
        [$d, $v, $app] = $this->started();
        $this->fillAndAttach($d, $v);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CANCELLED']);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertStatus(409);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'PAID']);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();
        DB::table('applications')->where('id', $app)->update(['current_status' => 'REFUNDED']);
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertStatus(409);
    }

    // ---- visibility and hints -----------------------------------------------------------------------------------------

    #[Test]
    public function reading_follows_the_application_scope_and_the_detail_tells_the_actor_what_it_may_do(): void
    {
        [$d, $v, $app] = $this->submitted();
        foreach ([$this->retail, $this->manager, $this->teknik, $this->perencanaan, $this->up3Manager, $this->sysAdmin] as $u) {
            $this->as($u)->getJson("/api/drawings/{$d}")->assertOk();
            $this->as($u)->getJson("/api/applications/{$app}/drawing")->assertOk()->assertJsonPath('data.id', $d);
        }
        foreach ([$this->teknikB, $this->up3ManagerB] as $u) {
            $this->as($u)->getJson("/api/drawings/{$d}")->assertNotFound();
            $this->as($u)->getJson("/api/applications/{$app}/drawing")->assertNotFound();
        }
        $this->as($this->vendor)->getJson("/api/drawings/{$d}")->assertForbidden();
        $empty = $this->application();
        $this->as($this->manager)->getJson("/api/applications/{$empty}/drawing")->assertOk()->assertJsonPath('data', null);

        $can = fn (User $u) => $this->as($u)->getJson("/api/drawings/{$d}")->assertOk()->json('data.can');
        $this->assertSame(['ULP_MANAGER'], $can($this->manager)['decide']);
        $this->assertTrue($can($this->manager)['escalate']);
        $this->assertSame([], $can($this->up3Manager)['decide']);
        $this->assertSame([], $can($this->teknik)['decide']);
        $this->assertFalse($can($this->teknik)['execute']);
        $this->assertFalse($can($this->perencanaan)['escalate']);                                                                                        // not at the ULP stage
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertSame(['REVIEW_PERENCANAAN'], $can($this->perencanaan)['decide']);
        $this->assertTrue($can($this->perencanaan)['escalate']);
        $this->assertFalse($can($this->manager)['escalate']);
        $this->assertSame([], $can($this->manager)['decide']);
        $this->as($this->teknik)->getJson('/api/drawings/access')->assertOk()->assertJsonPath('can', fn ($c) => $c['drawings.execute'] === true && $c['drawings.assign'] === false);
    }

    // ---- database integrity ------------------------------------------------------------------------------------------------

    #[Test]
    public function the_database_keeps_one_package_one_open_version_one_main_file_and_append_only_decisions(): void
    {
        [$d, $v, $app] = $this->started();
        $this->assertDbRejects(fn () => DB::table('application_drawings')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'drawing_number' => 'X-1', 'assigned_to' => $this->teknik->getKey(),
            'assigned_by' => $this->manager->getKey(), 'basis_survey_version_id' => DB::table('application_survey_versions')->value('id'), 'created_by' => $this->manager->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->insert(['id' => (string) Str::uuid(), 'drawing_id' => $d, 'version_number' => 9, 'status' => 'DRAFT', 'author_id' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['status' => 'APPROVED']));
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->update(['status' => 'SUBMITTED']));                   // needs its stage
        $this->assertDbRejects(fn () => DB::table('application_drawing_versions')->where('id', $v)->delete());

        $this->fillAndAttach($d, $v);
        $this->assertDbRejects(fn () => DB::table('application_documents')->where('drawing_version_id', $v)->where('file_role', 'ATTACHMENT')->update(['file_role' => 'MAIN']));  // second MAIN
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$v}/submit")->assertOk();
        $this->decide($d, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertDbRejects(fn () => DB::table('application_drawing_decisions')->update(['notes' => 'diubah']));
        $this->assertDbRejects(fn () => DB::table('application_drawing_decisions')->delete());
        $this->assertDbRejects(fn () => DB::table('application_drawing_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $v, 'step' => 'REVIEW_PERENCANAAN', 'decision' => 'REJECTED', 'decided_by' => $this->perencanaan->getKey(),
            'decided_role' => 'PERENCANAAN', 'notes' => '  ', 'decided_at' => now()]));                                                                                        // a rejection needs a reason
    }

    // ---- file formats of the drawing category -------------------------------------------------------------------------------

    /** @param array<string,string> $entries */
    private function zip(array $entries): string
    {
        $path = tempnam(sys_get_temp_dir(), 'z');
        $z = new \ZipArchive;
        $z->open($path, \ZipArchive::OVERWRITE);
        foreach ($entries as $name => $body) {
            $z->addFromString($name, $body);
        }
        $z->close();
        $bytes = (string) file_get_contents($path);
        unlink($path);

        return $bytes;
    }

    private function sheet(string $writer): string
    {
        $ss = new Spreadsheet;
        $ss->getActiveSheet()->setCellValue('A1', 'BOM sementara');
        $path = tempnam(sys_get_temp_dir(), 'x');
        IOFactory::createWriter($ss, $writer)->save($path);
        $bytes = (string) file_get_contents($path);
        unlink($path);

        return $bytes;
    }

    #[Test]
    public function drawing_formats_are_accepted_by_content_signature_and_disguised_or_macro_files_are_refused(): void
    {
        [$d, $v] = $this->started();
        $up = fn (string $name, string $bytes, string $role = 'ATTACHMENT') => $this->as($this->teknik)->post("/api/drawings/{$d}/versions/{$v}/documents", ['file' => UploadedFile::fake()->createWithContent($name, $bytes), 'role' => $role], ['Accept' => 'application/json']);

        $ok = [
            ['pdf', "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"], ['xlsx', $this->sheet('Xlsx')], ['xls', $this->sheet('Xls')], ['dwg', 'AC1032'.str_repeat("\0", 200)],
            ['dxf', "  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n"], ['docx', $this->zip(['[Content_Types].xml' => '<Types/>', 'word/document.xml' => '<w:document/>'])],
        ];
        foreach ($ok as [$ext, $bytes]) {
            $up("gambar.{$ext}", $bytes)->assertCreated();
        }
        $this->assertSame(['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'image/vnd.dwg', 'image/vnd.dxf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            DB::table('application_document_versions')->orderBy('uploaded_at')->pluck('mime_type')->all());

        $up('palsu.dwg', 'XXXXXX'.str_repeat('a', 100))->assertStatus(409);                                                                              // not an AutoCAD signature
        $up('palsu.dxf', 'hello world')->assertStatus(409);
        $up('png-jadi-dwg.dwg', (string) base64_decode(self::PNG))->assertStatus(409);
        $up('xlsx-jadi-docx.docx', $this->sheet('Xlsx'))->assertStatus(409);                                                                              // wrong main part
        $up('docx-jadi-xlsx.xlsx', $this->zip(['[Content_Types].xml' => '<Types/>', 'word/document.xml' => '<w:document/>']))->assertStatus(409);
        $up('makro.xlsx', $this->zip(['[Content_Types].xml' => '<Types/>', 'xl/workbook.xml' => '<workbook/>', 'xl/vbaProject.bin' => 'MACRO']))->assertStatus(409);   // macro project
        $up('zip-biasa.xlsx', $this->zip(['readme.txt' => 'bukan office']))->assertStatus(409);
        $up('xls-jadi-doc.doc', $this->sheet('Xls'))->assertStatus(409);                                                                                  // an Excel file named .doc
        $up('skrip.exe', 'MZ'.str_repeat("\0", 64))->assertStatus(409);
        $up('catatan.txt', 'halo')->assertStatus(409);
        $up('besar.pdf', '%PDF-1.4 '.str_repeat('x', 51 * 1024 * 1024))->assertStatus(409);                                                               // over 50 MB
        $this->assertSame(6, DB::table('application_documents')->count());
    }

    // ---- in-app notifications (docs/62 §44) -------------------------------------------------------------------------------

    #[Test]
    public function the_drawing_chain_notifies_the_next_holders_the_author_on_return_and_the_mto_team_on_approval(): void
    {
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();
        [$d, $v] = $this->submitted();
        $this->assertCount(1, $inbox($this->manager));                                          // the ULP manager decides first
        $this->assertStringContainsString('menunggu keputusan', $inbox($this->manager)[0]->title);
        $this->assertCount(0, $inbox($this->teknikB));                                          // another ULP hears nothing
        $this->assertCount(0, $inbox($this->perencanaan));

        $this->decide($d, $v, $this->manager, 'ULP_MANAGER', 'REJECTED', 'Skala gambar tidak terbaca')->assertOk();
        $back = $inbox($this->teknik)->first(fn ($n) => str_contains($n->title, 'dikembalikan'));
        $this->assertNotNull($back);
        $this->assertStringContainsString('Skala gambar tidak terbaca', $back->body);

        $new = (string) DB::table('application_drawing_versions')->where('drawing_id', $d)->where('status', 'DRAFT')->value('id');
        $this->fillAndAttach($d, $new);
        $this->as($this->teknik)->postJson("/api/drawings/{$d}/versions/{$new}/submit")->assertOk();
        $this->completeNormalChain($d, $new);
        $this->assertNotNull($inbox($this->teknik)->first(fn ($n) => str_contains($n->title, 'disetujui')));
        $this->assertNotNull($inbox($this->teknik2)->first(fn ($n) => $n->tag === 'MTO'));      // TEKNIK of the ULP can now build the MTO
        $this->assertCount(0, $inbox($this->teknikB));
    }
}
