<?php

namespace Tests\Feature;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Documents\DocumentService;
use App\Services\Kkf\KkfService;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\PlanningPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class SurveysTest extends PostgresTestCase
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
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(SurveyPermissionSeeder::class);
        $this->seed(PlanningPermissionSeeder::class);                                                       // proposals.manage: Teknik ULP makes the usulan

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

    /** An application of ULP A in the given status (created by NIAGA_RETAIL; the agenda makes it APPROVED). */
    private function application(string $status = 'APPROVED'): string
    {
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Siti '.Str::random(4), 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        if ($status !== 'DRAFT') {
            $this->as($this->retail)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => 'AG'.Str::random(8)])->assertCreated();
            if ($status !== 'APPROVED') {
                DB::table('applications')->where('id', $id)->update(['current_status' => $status]);
            }
        }

        return $id;
    }

    private function assignSurvey(string $app, ?User $surveyor = null, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson("/api/applications/{$app}/surveys", ['assigned_to' => ($surveyor ?? $this->teknik)->getKey()]);
    }

    private function png(string $name = 'foto.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, (string) base64_decode(self::PNG));
    }

    /** @return array{0:string,1:string} survey id, open version id */
    private function startedSurvey(string $status = 'APPROVED'): array
    {
        $app = $this->application($status);
        $r = $this->assignSurvey($app)->assertCreated();

        return [$r->json('data.id'), $r->json('data.versions.0.id'), $app];
    }

    private function fill(string $survey, string $version, ?User $by = null, array $over = [])
    {
        return $this->as($by ?? $this->teknik)->patchJson("/api/surveys/{$survey}/versions/{$version}", array_merge([
            'survey_date' => '2026-11-05', 'findings' => 'Tiang JTR berjarak 40 m dari lokasi', 'technical_recommendation' => 'Sambung dari tiang T-12', 'requires_drawing' => false,
            'requires_network_extension' => true, 'requires_feasibility_study' => false, 'latitude' => -7.5461, 'longitude' => 112.2331, 'network_distance_m' => 40, 'sr_length_m' => 20, 'network_type' => 'JTR',
            'transformer_capacity_kva' => 100, 'network_condition' => 'Baik', 'measurements' => [['name' => 'Tegangan ujung', 'value' => '218', 'unit' => 'V']],
        ], $over));
    }

    private function ready(string $survey, string $version): void
    {
        $this->fill($survey, $version)->assertOk();
        $this->as($this->teknik)->post("/api/surveys/{$survey}/versions/{$version}/documents", ['file' => $this->png(), 'title' => 'Foto lokasi'], ['Accept' => 'application/json'])->assertCreated();
    }

    private function submitted(): array
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->ready($s, $v);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();

        return [$s, $v, $app];
    }

    private function decide(string $survey, string $version, User $by, string $step, string $decision = 'APPROVED', ?string $notes = null)
    {
        return $this->as($by)->postJson("/api/surveys/{$survey}/versions/{$version}/decisions", array_filter(['step' => $step, 'decision' => $decision, 'notes' => $notes], fn ($x) => $x !== null));
    }

    private function vstatus(string $version): string
    {
        return (string) DB::table('application_survey_versions')->where('id', $version)->value('status');
    }

    /** @return array{0:string,1:?string} status, stage */
    private function vstage(string $version): array
    {
        $v = DB::table('application_survey_versions')->where('id', $version)->first();

        return [$v->status, $v->stage];
    }

    // ---- grants -------------------------------------------------------------------------------------

    #[Test]
    public function the_survey_keys_are_granted_to_the_owner_decided_roles_only(): void
    {
        $holders = fn (string $key) => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', $key)->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('surveys.assign'));
        $this->assertSame(['SYS_ADMIN', 'TEKNIK'], $holders('surveys.execute'));
        $this->assertSame(['MANAGER_ULP', 'SYS_ADMIN'], $holders('surveys.approve_ulp'));
        $this->assertSame(['PERENCANAAN', 'SYS_ADMIN'], $holders('surveys.review_perencanaan'));
        $this->assertSame(['KONSTRUKSI', 'SYS_ADMIN'], $holders('surveys.review_konstruksi'));
        $this->assertSame(['ASMAN_PERENCANAAN', 'SYS_ADMIN'], $holders('surveys.approve_asman_perencanaan'));
        $this->assertSame(['ASMAN_KONSTRUKSI', 'SYS_ADMIN'], $holders('surveys.approve_asman_konstruksi'));
        $this->assertSame(['MANAGER_UP3', 'SYS_ADMIN'], $holders('surveys.approve_up3_manager'));
        $this->assertNotContains('VENDOR', $holders('surveys.view'));
        $this->assertSame(9, DB::table('permissions')->where('name', 'like', 'surveys.%')->count());
        $this->seed(SurveyPermissionSeeder::class);                                                       // idempotent
        $this->assertSame(9, DB::table('permissions')->where('name', 'like', 'surveys.%')->count());
    }

    // ---- assignment -----------------------------------------------------------------------------------

    #[Test]
    public function the_manager_assigns_a_teknik_surveyor_of_the_ulp_and_a_first_draft_version_starts(): void
    {
        $app = $this->application();
        $r = $this->assignSurvey($app)->assertCreated();
        $this->assertSame('ACTIVE', $r->json('data.status'));
        $this->assertSame(['DRAFT', 1], [$r->json('data.versions.0.status'), $r->json('data.versions.0.version_number')]);
        $this->assertSame($this->teknik->getKey(), $r->json('data.surveyor.id'));
        $this->assertStringStartsWith('SRV-PBPD-', $r->json('data.survey_number'));
        $this->assertStringEndsWith('-1', $r->json('data.survey_number'));
        $this->assertSame(1, DB::table('application_surveys')->count());

        $this->assignSurvey($app, $this->teknik2)->assertStatus(409);                                      // one ACTIVE survey per application
    }

    #[Test]
    public function only_the_manager_of_the_ulp_assigns_and_only_a_teknik_of_that_ulp_can_be_the_surveyor(): void
    {
        $app = $this->application();
        foreach ([$this->retail, $this->teknik, $this->perencanaan, $this->up3Manager, $this->vendor] as $u) {
            $this->assignSurvey($app, $this->teknik, $u)->assertForbidden();
        }
        $this->as($this->vendor)->postJson("/api/applications/{$app}/surveys", [])->assertForbidden();           // grant before validation
        $this->as($this->manager)->postJson("/api/applications/{$app}/surveys", [])->assertForbidden();                // the manager does not survey: naming a surveyor (assigned_to) is the manager's action
        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpB);
        $this->assignSurvey($app, $this->teknik, $other)->assertNotFound();                                       // manager of another ULP: hidden

        $this->assignSurvey($app, $this->retail)->assertStatus(409);                                               // not a TEKNIK
        $this->assignSurvey($app, $this->teknikB)->assertStatus(409);                                              // TEKNIK of another ULP
        $this->as($this->manager)->postJson("/api/applications/{$app}/surveys", ['assigned_to' => (string) Str::uuid()])->assertStatus(409);
        $this->assertSame(0, DB::table('application_surveys')->count());
    }

    #[Test]
    public function a_survey_needs_an_application_that_is_approved_paid_or_pk_printed(): void
    {
        foreach (['DRAFT', 'CONNECTION_DONE', 'CANCELLED'] as $status) {
            $app = $this->application($status === 'DRAFT' ? 'DRAFT' : 'APPROVED');
            if ($status !== 'DRAFT') {
                DB::table('applications')->where('id', $app)->update(['current_status' => $status]);
            }
            $this->assignSurvey($app)->assertStatus(409);
        }
        foreach (['APPROVED', 'PAID', 'PK_PRINTED'] as $status) {
            $this->assignSurvey($this->application($status))->assertCreated();
        }
    }

    #[Test]
    public function the_assignable_surveyors_are_the_active_teknik_users_of_the_ulp(): void
    {
        $app = $this->application();
        $list = $this->as($this->manager)->getJson("/api/applications/{$app}/surveys/surveyors")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([$this->teknik->getKey(), $this->teknik2->getKey()], array_column($list, 'id'));
        $this->as($this->teknik)->getJson("/api/applications/{$app}/surveys/surveyors")->assertForbidden();
    }

    #[Test]
    public function the_manager_can_reassign_while_the_version_is_a_draft_and_can_cancel_then_a_new_survey_follows(): void
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->as($this->manager)->postJson("/api/surveys/{$s}/reassign", ['assigned_to' => $this->teknik2->getKey()])->assertOk()->assertJsonPath('data.surveyor.id', $this->teknik2->getKey());
        $this->assertSame($this->teknik2->getKey(), DB::table('application_survey_versions')->where('id', $v)->value('surveyor_id'));
        $this->fill($s, $v)->assertOk();                                                                           // role-based (owner 7 Nov 2026): any TEKNIK of the ULP may work on the draft
        $this->fill($s, $v, $this->teknik2)->assertOk();

        $this->as($this->manager)->postJson("/api/surveys/{$s}/cancel", [])->assertUnprocessable();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/cancel", ['reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->postJson("/api/surveys/{$s}/cancel", ['reason' => 'Jadwal diganti'])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->fill($s, $v, $this->teknik2)->assertStatus(409);

        $second = $this->assignSurvey($app)->assertCreated();                                                      // several surveys, one after another
        $this->assertSame(2, $second->json('data.sequence_number'));
        $this->assertStringEndsWith('-2', $second->json('data.survey_number'));
    }

    // ---- surveyor work -------------------------------------------------------------------------------------

    #[Test]
    public function only_the_assigned_surveyor_fills_the_draft_and_the_content_is_validated(): void
    {
        [$s, $v] = $this->startedSurvey();
        $this->fill($s, $v, $this->teknik2)->assertOk();                                                           // role-based: another TEKNIK of the ULP may work on any customer's survey
        $this->assertSame($this->teknik2->getKey(), DB::table('application_survey_versions')->where('id', $v)->value('surveyor_id'));   // and becomes the recorded surveyor
        $this->fill($s, $v, $this->manager)->assertForbidden();
        $this->fill($s, $v, $this->vendor)->assertForbidden();
        foreach ([['latitude' => 91], ['longitude' => -181], ['network_distance_m' => -1], ['survey_date' => '05/11/2026'], ['transformer_capacity_kva' => -5], ['measurements' => [['name' => 'x']]]] as $bad) {
            $this->fill($s, $v, null, $bad)->assertUnprocessable();
        }
        $ok = $this->fill($s, $v)->assertOk();
        $this->assertSame(['JTR', 40, -7.5461], [$ok->json('data.versions.0.network_type'), $ok->json('data.versions.0.network_distance_m'), $ok->json('data.versions.0.latitude')]);
        $this->assertSame('Tegangan ujung', $ok->json('data.versions.0.measurements.0.name'));
        $this->as($this->teknik)->patchJson("/api/surveys/{$s}/versions/{$v}", [])->assertStatus(409);               // nothing to change
    }

    #[Test]
    public function submit_needs_the_complete_result_and_at_least_one_photo_then_freezes_the_content(): void
    {
        [$s, $v] = $this->startedSurvey();
        $r = $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertStatus(409);
        foreach (['kebutuhan gambar', 'kebutuhan perluasan jaringan', 'kebutuhan studi kelayakan', 'panjang SR', 'jarak bangunan', 'foto/dokumen'] as $m) {
            $this->assertStringContainsString($m, $r->json('message'));
        }
        $this->assertSame(now(config('distriva.business_timezone'))->toDateString(), (string) DB::table('application_survey_versions')->where('id', $v)->value('survey_date'));      // the survey date follows the running day
        $this->fill($s, $v)->assertOk();
        $this->assertStringContainsString('foto/dokumen', $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertStatus(409)->json('message'));
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => $this->png()], ['Accept' => 'application/json'])->assertCreated();

        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk()->assertJsonPath('data.versions.0.status', 'SUBMITTED')->assertJsonPath('data.versions.0.stage', 'ULP_MANAGER');
        $this->fill($s, $v)->assertStatus(409);                                                                    // frozen
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertStatus(409);
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['findings' => 'diubah']));
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => $this->png()], ['Accept' => 'application/json'])->assertStatus(409);
    }

    #[Test]
    public function submit_can_carry_the_form_content_so_unsaved_fields_are_not_lost(): void
    {
        [$s, $v] = $this->startedSurvey();
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => $this->png()], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertStatus(409);               // nothing saved yet
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit", ['findings' => 'x', 'latitude' => 999])->assertUnprocessable();   // content is validated like a draft save
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit", ['survey_date' => '2026-11-06', 'findings' => 'Pembebanan 80%', 'technical_recommendation' => 'Uprating trafo',
            'requires_drawing' => true, 'requires_network_extension' => true, 'requires_feasibility_study' => true, 'sr_length_m' => 25, 'network_distance_m' => 38, 'measurements' => [['name' => 'Beban', 'value' => '179', 'unit' => 'A']]])
            ->assertOk()->assertJsonPath('data.versions.0.status', 'SUBMITTED');
        $this->assertSame('Pembebanan 80%', DB::table('application_survey_versions')->where('id', $v)->value('findings'));
    }

    // ---- the approval chain -----------------------------------------------------------------------------------

    // ---- survey of "no extension", the KKO of the survey and the KKF gate (owner 2026-11-14, docs/82) ---------------------------------

    private function kko(string $app, array $over = []): string
    {
        $id = (string) Str::uuid();
        DB::table('application_kko')->insert(array_merge(['id' => $id, 'application_id' => $app, 'substation_code' => 'HD0001', 'transformer_capacity_kva' => 200, 'measured_load_kva' => 100, 'dedicated_transformer' => false,
            'added_power_kva' => 10, 'load_factor' => 0.8, 'loading_before_pct' => 50, 'loading_after_pct' => 54, 'class_before' => 'NORMAL', 'class_after' => 'NORMAL', 'voltage_low' => false,
            'recorded_by' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()], $over));

        return $id;
    }

    /** A survey of the given kind, filled and with its document, not yet submitted. @return array{0:string,1:string,2:string} */
    private function draftOf(array $content): array
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->fill($s, $v, null, $content)->assertOk();
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$v}/documents", ['file' => $this->png(), 'title' => 'Foto lokasi'], ['Accept' => 'application/json'])->assertCreated();

        return [$s, $v, $app];
    }

    private function submit(string $s, string $v)
    {
        return $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit");
    }

    #[Test]
    public function a_survey_of_no_extension_is_accepted_by_the_ulp_manager_alone_and_the_customer_is_ready_to_install(): void
    {
        [$s, $v, $app] = $this->draftOf(['requires_network_extension' => false]);
        $this->submit($s, $v)->assertOk();
        $this->as($this->manager)->getJson("/api/surveys/{$s}")->assertJsonPath('data.versions.0.short_chain', true)->assertJsonPath('data.versions.0.outcome', 'NO_EXTENSION');
        $this->assertFalse($this->as($this->retail)->getJson("/api/applications/{$app}")->json('data.survey.ready_to_install'));

        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk()->assertJsonPath('result.survey_status', 'ACCEPTED')->assertJsonPath('result.stage', null);
        $this->assertSame('ACCEPTED', $this->vstatus($v));
        $this->decide($s, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertStatus(409);                           // nothing is left to review
        $d = $this->as($this->retail)->getJson("/api/applications/{$app}")->assertOk()->json('data.survey');
        $this->assertSame(['NO_EXTENSION', 'ACCEPTED', true], [$d['outcome'], $d['status'], $d['ready_to_install']]);
        $this->assertStringStartsWith('SRV-', $d['survey_number']);
        $row = $this->as($this->retail)->getJson('/api/applications?search='.urlencode((string) DB::table('applications')->where('id', $app)->value('application_number')))->json('data.0');
        $this->assertSame(['NO_EXTENSION', 'ACCEPTED', true], [$row['survey_outcome'], $row['survey_status'], $row['ready_to_install']]);
        $ready = fn () => collect($this->as($this->retail)->getJson('/api/applications?ready_to_install=1&per_page=100')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$app], $ready());                                                                                 // only this one: the extension survey below is not ready
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CONNECTION_IN_PROGRESS']);              // what follows is up to the EIS import
        $this->assertSame([], $ready());
        $this->assertFalse($this->as($this->retail)->getJson("/api/applications/{$app}")->json('data.survey.ready_to_install'));

        // owner 2026-11-16: a survey that extends the network is accepted by the ULP manager alone as well; it is just not ready to install
        [$s2, $v2, $app2] = $this->draftOf(['requires_network_extension' => true]);
        $this->submit($s2, $v2)->assertOk();
        $this->decide($s2, $v2, $this->manager, 'ULP_MANAGER')->assertOk()->assertJsonPath('result.survey_status', 'ACCEPTED')->assertJsonPath('result.stage', null);
        $this->assertSame('ACCEPTED', $this->vstatus($v2));
        $this->assertFalse($this->as($this->retail)->getJson("/api/applications/{$app2}")->json('data.survey.ready_to_install'));
    }

    #[Test]
    public function no_extension_cannot_be_combined_with_a_drawing_or_a_feasibility_study_and_the_database_agrees(): void
    {
        [$s, $v] = $this->draftOf(['requires_network_extension' => false, 'requires_drawing' => true]);
        $this->submit($s, $v)->assertStatus(409)->assertJsonFragment(['message' => 'Survei tanpa perluasan jaringan: kebutuhan gambar dan studi kelayakan harus "tidak" (tidak ada JTR/JTM/trafo yang ditambah).']);
        $this->fill($s, $v, null, ['requires_network_extension' => false, 'requires_drawing' => false, 'requires_feasibility_study' => true])->assertOk();
        $this->submit($s, $v)->assertStatus(409);
        $this->fill($s, $v, null, ['requires_network_extension' => false, 'requires_drawing' => false, 'requires_feasibility_study' => false])->assertOk();
        $this->submit($s, $v)->assertOk();

        // SUBMITTED -> ACCEPTED is the manager's decision now; going back to DRAFT is never allowed
        [$s2, $v2] = $this->draftOf(['requires_network_extension' => true]);
        $this->submit($s2, $v2)->assertOk();
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v2)->update(['status' => 'DRAFT', 'stage' => null]));
    }

    #[Test]
    public function the_kko_must_be_recorded_before_the_survey_is_submitted_and_a_risky_kko_needs_a_reason_for_no_extension(): void
    {
        config(['distriva.survey_requires_kko' => true]);
        [$s, $v, $app] = $this->draftOf(['requires_network_extension' => true]);
        $this->submit($s, $v)->assertStatus(409)->assertJsonFragment(['message' => 'KKO belum dicatat: pilih gardu dan catat hasil KKO pada survei sebelum mengajukan.']);
        $kko = $this->kko($app);
        $this->submit($s, $v)->assertOk();
        $this->assertSame($kko, DB::table('application_survey_versions')->where('id', $v)->value('kko_id'));
        $snap = json_decode((string) DB::table('application_survey_versions')->where('id', $v)->value('kko_snapshot'), true);
        $this->assertEquals(['HD0001', 200, 54], [$snap['substation_code'], $snap['transformer_capacity_kva'], $snap['loading_after_pct']]);
        DB::table('application_kko')->where('id', $kko)->update(['loading_after_pct' => 99]);                                // the KKO is re-recorded later: the survey keeps what it judged
        $this->assertEquals(54, json_decode((string) DB::table('application_survey_versions')->where('id', $v)->value('kko_snapshot'), true)['loading_after_pct']);
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['kko_snapshot' => json_encode(['x' => 1])]));      // frozen with the rest

        // no extension against an overloaded trafo / a low voltage / a TIDAK LAYAK decision
        foreach ([['class_after' => 'OVERBLAST'], ['voltage_low' => true], ['decision' => 'TIDAK_LAYAK', 'decision_notes' => 'Trafo penuh', 'decided_by' => $this->teknik->getKey(), 'decided_at' => now()]] as $risk) {
            [$s2, $v2, $app2] = $this->draftOf(['requires_network_extension' => false]);
            $this->kko($app2, $risk);
            $this->submit($s2, $v2)->assertStatus(409)->assertJsonPath('message', fn (string $m) => str_contains($m, 'tanpa perluasan') && str_contains($m, 'alasan tertulis'));
            $this->fill($s2, $v2, null, ['requires_network_extension' => false, 'no_extension_reason' => 'Trafo diganti PLN di luar DISTRIVA'])->assertOk();
            $this->submit($s2, $v2)->assertOk();
            $this->as($this->manager)->getJson("/api/surveys/{$s2}")->assertJsonPath('data.versions.0.no_extension_reason', 'Trafo diganti PLN di luar DISTRIVA');
        }
        // a safe KKO needs no reason
        [$s3, $v3, $app3] = $this->draftOf(['requires_network_extension' => false]);
        $this->kko($app3);
        $this->submit($s3, $v3)->assertOk();
    }

    #[Test]
    public function a_collective_survey_request_has_no_usulan_number_until_the_survey_needs_an_extension(): void
    {
        $a1 = $this->application();
        $a2 = $this->application();
        $a3 = $this->application('DRAFT');
        $this->as($this->manager)->postJson('/api/proposals', ['application_ids' => [$a1, $a2], 'start_survey' => true])->assertForbidden();         // the manager does not survey
        $this->as($this->teknik)->postJson('/api/proposals', ['application_ids' => [$a3], 'start_survey' => true])->assertStatus(409);               // a survey needs APPROVED / PAID / PK_PRINTED
        $r = $this->as($this->teknik)->postJson('/api/proposals', ['application_ids' => [$a1, $a2], 'start_survey' => true])->assertCreated();
        $s = $r->json('data.survey_id');
        $p = DB::table('proposals')->where('id', $r->json('data.id'))->first();
        $this->assertNull($p->proposal_number);
        $this->assertNull($p->issued_at);
        $this->assertStringStartsWith('SRV-', (string) $r->json('data.survey_number'));
        $this->assertDbRejects(fn () => DB::table('proposals')->where('id', $p->id)->update(['representative_application_id' => $a2]));

        // the drawer of a member: not issued yet, the survey speaks for the whole group
        $d = $this->as($this->retail)->getJson("/api/applications/{$a2}")->assertOk();
        $d->assertJsonPath('data.proposal.issued', false)->assertJsonPath('data.proposal.is_representative', false)->assertJsonPath('data.proposal.members_count', 2);
        $this->assertSame($r->json('data.survey_number'), $d->json('data.survey.survey_number'));
        $list = $this->as($this->manager)->getJson('/api/surveys?kind=COLLECTIVE')->assertOk();
        $this->assertSame([$s], collect($list->json('data'))->pluck('id')->all());
        $list->assertJsonPath('data.0.outcome', 'PENDING')->assertJsonPath('data.0.members_count', 2)->assertJsonPath('data.0.proposal.issued', false);
        $this->assertEqualsCanonicalizing([$a2, $list->json('data.0.application.id')], array_column($list->json('data.0.members'), 'application_id'));          // every member application, so the page can show each customer without leaving it
        $this->assertSame([], $this->as($this->manager)->getJson('/api/surveys?kind=INDIVIDUAL')->json('data.0.members') ?? []);
        $this->assertSame([], $this->as($this->manager)->getJson('/api/surveys?kind=INDIVIDUAL')->json('data'));

        $version = DB::table('application_survey_versions')->where('survey_id', $s)->value('id');
        $this->ready($s, $version);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$version}/submit")->assertOk();
        foreach (['ULP_MANAGER' => $this->manager] as $step => $who) {
            $res = $this->decide($s, $version, $who, $step)->assertOk();
        }
        $res->assertJsonPath('result.survey_status', 'ACCEPTED');
        $this->assertNull(DB::table('proposals')->where('id', $p->id)->value('proposal_number'));                                                   // owner 2026-11-16: accepting the survey does not make the usulan
        $this->as($this->retail)->getJson("/api/applications/{$a2}")->assertJsonPath('data.proposal.issued', false)->assertJsonPath('data.survey.outcome', 'EXTENSION');
        $this->as($this->vendor)->postJson('/api/proposals/issue', ['application_id' => $a1])->assertForbidden();
        $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $a2])->assertStatus(409);                                   // a member: the usulan is made through the representative
        $made = $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $a1])->assertCreated();                            // Teknik ULP makes the usulan
        $p = DB::table('proposals')->where('id', $p->id)->first();
        $this->assertSame($made->json('data.proposal_number'), $p->proposal_number);
        $this->assertSame($p->id, $made->json('data.id'));
        $this->assertMatchesRegularExpression('#^\\d{5}/USULAN-PBPD/#', $p->proposal_number);
        $this->assertNotNull($p->issued_at);
        $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $a1])->assertStatus(409);                                   // once
        $this->as($this->retail)->getJson("/api/applications/{$a2}")->assertJsonPath('data.proposal.issued', true)->assertJsonPath('data.survey.outcome', 'EXTENSION');
        $this->as($this->manager)->getJson('/api/surveys?outcome=EXTENSION')->assertJsonPath('data.0.proposal.proposal_number', $p->proposal_number);
        $this->assertDbRejects(fn () => DB::table('proposals')->where('id', $p->id)->update(['proposal_number' => '00099/X']));                    // the number never changes again
    }

    #[Test]
    public function the_proposal_detail_carries_the_cancel_block_reason_and_the_stored_kkf_run_count(): void
    {
        $a1 = $this->application();
        $a2 = $this->application();
        $r = $this->as($this->teknik)->postJson('/api/proposals', ['application_ids' => [$a1, $a2], 'start_survey' => true])->assertCreated();
        $id = $r->json('data.id');
        $d = $this->as($this->teknik)->getJson("/api/proposals/{$id}")->assertOk()->json('data');
        $this->assertNull($d['cancel_blocked_reason']);
        $this->assertSame(0, $d['kkf_runs_count']);
    }

    #[Test]
    public function a_collective_survey_without_extension_makes_every_member_ready_to_install(): void
    {
        $a1 = $this->application();
        $a2 = $this->application();
        $r = $this->as($this->teknik)->postJson('/api/proposals', ['application_ids' => [$a1, $a2], 'start_survey' => true])->assertCreated();
        $s = $r->json('data.survey_id');
        $version = DB::table('application_survey_versions')->where('survey_id', $s)->value('id');
        $this->fill($s, $version, null, ['requires_network_extension' => false])->assertOk();
        $this->as($this->teknik)->post("/api/surveys/{$s}/versions/{$version}/documents", ['file' => $this->png(), 'title' => 'Foto'], ['Accept' => 'application/json'])->assertCreated();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$version}/submit")->assertOk();
        $res = $this->decide($s, $version, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertNotNull($res->json('result.proposal_closed'));
        $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $a1])->assertStatus(409);                                  // no extension: no usulan can be made
        $this->assertNull(DB::table('proposals')->where('id', $r->json('data.id'))->value('proposal_number'));                                    // no extension: no usulan number is ever issued
        foreach ([$a1, $a2] as $a) {
            $d = $this->as($this->retail)->getJson("/api/applications/{$a}")->json('data');
            $this->assertSame(['NO_EXTENSION', true], [$d['survey']['outcome'], $d['survey']['ready_to_install']]);
            $this->assertNull($d['proposal']);
        }
        $this->assertEqualsCanonicalizing([$a1, $a2], collect($this->as($this->retail)->getJson('/api/applications?ready_to_install=1&per_page=100')->json('data'))->pluck('id')->all());
        $this->as($this->manager)->getJson('/api/surveys?outcome=NO_EXTENSION')->assertJsonPath('data.0.members_count', 2);
    }

    #[Test]
    public function an_individual_survey_that_needs_an_extension_gets_its_one_customer_usulan_when_teknik_makes_it(): void
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->assertNull($this->as($this->retail)->getJson("/api/applications/{$app}")->json('data.proposal'));
        $this->ready($s, $v);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();
        foreach (['ULP_MANAGER' => $this->manager] as $step => $who) {
            $this->decide($s, $v, $who, $step)->assertOk();
        }
        $this->assertNull($this->as($this->retail)->getJson("/api/applications/{$app}")->json('data.proposal'));                                    // accepted, but no usulan yet
        $this->as($this->teknik)->postJson('/api/proposals/issue', ['application_id' => $app])->assertCreated();
        $d = $this->as($this->retail)->getJson("/api/applications/{$app}")->json('data');
        $this->assertTrue($d['proposal']['issued']);
        $this->assertTrue($d['proposal']['is_representative']);
        $this->assertSame(1, $d['proposal']['members_count']);
        $this->assertSame('EXTENSION', $d['survey']['outcome']);
        $this->as($this->manager)->getJson('/api/surveys?kind=INDIVIDUAL')->assertJsonPath('data.0.id', $s)->assertJsonPath('data.0.proposal.issued', true);
    }

    #[Test]
    public function the_survey_list_follows_the_unit_scope_and_filters_by_search_and_status(): void
    {
        [$s, , $app] = $this->startedSurvey();
        $number = (string) DB::table('applications')->where('id', $app)->value('application_number');
        $this->as($this->manager)->getJson('/api/surveys?q='.urlencode($number))->assertOk()->assertJsonPath('data.0.id', $s)->assertJsonPath('data.0.kind', 'INDIVIDUAL')->assertJsonPath('data.0.outcome', 'PENDING');
        $this->assertSame([], $this->as($this->manager)->getJson('/api/surveys?status=ACCEPTED')->json('data'));
        $this->assertSame([], $this->as($this->teknikB)->getJson('/api/surveys')->assertOk()->json('data'));                                  // another ULP sees nothing
        $this->as($this->vendor)->getJson('/api/surveys')->assertForbidden();
    }

    #[Test]
    public function drawing_files_are_named_by_the_system_after_the_agenda_and_the_customer(): void
    {
        [$s, $v, $app] = $this->startedSurvey();
        DB::table('customers')->where('id', DB::table('applications')->where('id', $app)->value('customer_id'))->update(['name' => 'CV.JAYA BERKAH FOODS 2']);
        DB::table('application_external_references')->where('application_id', $app)->where('reference_type', 'AGENDA')->update(['reference_number' => '514539912610278772']);
        $doc = app(DocumentService::class);
        $dv = (string) Str::uuid();
        $this->assertSame('GBR_514539912610278772_CV.JAYA BERKAH FOODS 2', $doc->drawingTitle($app, 'MAIN', $dv));
        $this->assertSame('GBR_514539912610278772_CV.JAYA BERKAH FOODS 2 - Lampiran 1', $doc->drawingTitle($app, 'ATTACHMENT', $dv));
        DB::table('application_external_references')->where('application_id', $app)->delete();
        $this->assertSame('GBR_CV.JAYA BERKAH FOODS 2', $doc->drawingTitle($app, 'MAIN', $dv));
    }

    #[Test]
    public function kkf_is_not_issued_for_a_survey_accepted_as_no_extension(): void
    {
        [$s, $v, $app] = $this->draftOf(['requires_network_extension' => false]);
        $this->submit($s, $v)->assertOk();
        KkfService::assertExtensionApplies($app);                                                       // not accepted yet: no gate
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $number = (string) DB::table('application_surveys')->where('id', $s)->value('survey_number');
        try {
            KkfService::assertExtensionApplies($app);
            $this->fail('KKF must be refused for a no-extension survey.');
        } catch (AssignmentRuleViolation $e) {
            $this->assertSame("Survei {$number} menyatakan tanpa perluasan jaringan: KKF tidak diterbitkan.", $e->getMessage());
        }
        $this->assertContains("Survei {$number} menyatakan tanpa perluasan jaringan: KKF tidak diterbitkan.", app(KkfService::class)->preview($app)['blockers']);

        // an accepted survey that extends the network leaves KKF open
        [$s2, $v2, $app2] = $this->draftOf(['requires_network_extension' => true]);
        $this->submit($s2, $v2)->assertOk();
        DB::table('application_survey_versions')->where('id', $v2)->update(['status' => 'UNDER_REVIEW', 'stage' => 'UP3_REVIEW']);
        DB::table('application_survey_versions')->where('id', $v2)->update(['status' => 'ACCEPTED', 'stage' => null, 'accepted_at' => now()]);
        DB::table('application_surveys')->where('id', $s2)->update(['status' => 'ACCEPTED']);
        KkfService::assertExtensionApplies($app2);
        $this->assertTrue(true);
    }

    #[Test]
    public function the_ulp_manager_alone_accepts_the_survey(): void
    {
        [$s, $v] = $this->submitted();
        $this->assertSame(['SUBMITTED', 'ULP_MANAGER'], $this->vstage($v));
        $done = $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();                                  // owner 2026-11-16: the survey chain ends at the ULP manager
        $this->assertSame(['ACCEPTED', 'ACCEPTED', null], [$done->json('result.version_status'), $done->json('result.survey_status'), $done->json('result.stage')]);
        $this->assertSame('ACCEPTED', DB::table('application_surveys')->where('id', $s)->value('status'));
        $this->assertNotNull(DB::table('application_survey_versions')->where('id', $v)->value('accepted_at'));
        $d = collect($done->json('data.versions.0.decisions'));
        $this->assertSame(['ULP_MANAGER'], $d->pluck('step')->all());
        $this->assertSame(['MANAGER_ULP'], $d->pluck('decided_role')->all());
        foreach ([[$this->perencanaan, 'REVIEW_PERENCANAAN'], [$this->asmanPer, 'ASMAN_PERENCANAAN']] as [$u, $step]) {
            $this->decide($s, $v, $u, $step)->assertStatus(409);                                                     // no later step exists any more
        }
    }

    #[Test]
    public function a_step_can_only_be_decided_in_its_turn_once_and_by_the_right_role_in_the_right_unit(): void
    {
        [$s, $v] = $this->submitted();
        $this->decide($s, $v, $this->up3Manager, 'UP3_MANAGER')->assertUnprocessable();                              // the UP3 manager does not decide surveys
        $this->decide($s, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertStatus(409);                          // not the step of this stage any more
        $this->decide($s, $v, $this->perencanaan, 'ULP_MANAGER')->assertForbidden();                                 // wrong role for the step
        $this->decide($s, $v, $this->retail, 'ULP_MANAGER')->assertForbidden();
        $this->decide($s, $v, $this->vendor, 'ULP_MANAGER')->assertForbidden();
        $other = $this->makeUser();
        $this->assign($other, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpB);
        $this->decide($s, $v, $other, 'ULP_MANAGER')->assertNotFound();                                              // manager of another ULP
        $this->decide($s, $v, $this->manager, 'NOT_A_STEP')->assertUnprocessable();

        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertStatus(409);                                     // already decided / no longer pending
        $this->decide($s, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertStatus(409);
    }

    #[Test]
    public function one_user_decides_only_once_per_version_and_the_surveyor_never_decides(): void
    {
        [$s, $v] = $this->submitted();
        // the surveyor holding a manager role as well still cannot decide on their own version
        [$s2, $v2, $app2] = $this->startedSurvey();
        $mt = $this->makeUser();
        $this->assign($mt, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA);
        $this->assign($mt, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->ulpA);
        $this->as($this->manager)->postJson("/api/surveys/{$s2}/reassign", ['assigned_to' => $mt->getKey()])->assertOk();
        $this->as($mt)->patchJson("/api/surveys/{$s2}/versions/{$v2}", ['findings' => 'x', 'survey_date' => '2026-11-05', 'technical_recommendation' => 'y', 'requires_drawing' => false, 'requires_network_extension' => true, 'requires_feasibility_study' => false, 'sr_length_m' => 10, 'network_distance_m' => 20])->assertOk();
        $this->as($mt)->post("/api/surveys/{$s2}/versions/{$v2}/documents", ['file' => $this->png()], ['Accept' => 'application/json'])->assertCreated();
        $this->as($mt)->postJson("/api/surveys/{$s2}/versions/{$v2}/submit")->assertOk();
        $this->decide($s2, $v2, $mt, 'ULP_MANAGER')->assertForbidden();
        $this->assertDbRejects(fn () => DB::table('application_survey_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $v2, 'step' => 'ULP_MANAGER', 'decision' => 'APPROVED', 'decided_by' => $mt->getKey(), 'decided_role' => 'MANAGER_ULP', 'decided_at' => now()]));
    }

    #[Test]
    public function a_rejection_returns_the_version_and_the_process_restarts_at_the_surveyor(): void
    {
        [$s, $v] = $this->submitted();
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER', 'REJECTED')->assertStatus(409);                          // a reason is mandatory
        $r = $this->decide($s, $v, $this->manager, 'ULP_MANAGER', 'REJECTED', 'Jarak jaringan perlu diukur ulang')->assertOk();
        $this->assertSame('RETURNED', $r->json('result.version_status'));
        $this->assertNotNull($r->json('result.new_version_id'));
        $this->assertSame('ACTIVE', DB::table('application_surveys')->where('id', $s)->value('status'));

        $old = DB::table('application_survey_versions')->where('id', $v)->first();
        $this->assertSame(['RETURNED', 'ULP_MANAGER', 'Jarak jaringan perlu diukur ulang', $this->manager->getKey()], [$old->status, $old->returned_at_step, $old->return_reason, $old->returned_by]);
        $new = DB::table('application_survey_versions')->where('id', $r->json('result.new_version_id'))->first();
        $this->assertSame(['DRAFT', 2, $this->teknik->getKey()], [$new->status, $new->version_number, $new->surveyor_id]);
        $this->assertSame($old->findings, $new->findings);                                                             // starts from the returned content
        $this->assertSame(1, DB::table('application_survey_decisions')->where('version_id', $v)->count());            // the old decision is kept
        $this->assertSame(0, DB::table('application_survey_decisions')->where('version_id', $new->id)->count());     // the new round starts from zero
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['findings' => 'x']));

        // second round: the surveyor corrects, the manager decides again on the new version
        $this->fill($s, $new->id, null, ['network_distance_m' => 55])->assertOk();
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$new->id}/submit")->assertOk();
        $this->decide($s, $new->id, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertSame(['ACCEPTED', 'ACCEPTED'], [$this->vstatus($new->id), DB::table('application_surveys')->where('id', $s)->value('status')]);
        $this->assertSame(55.0, (float) DB::table('application_survey_versions')->where('id', $new->id)->value('network_distance_m'));
    }

    #[Test]
    public function the_ulp_manager_can_reject_and_the_old_version_is_closed(): void
    {
        [$s, $v] = $this->submitted();
        $r = $this->decide($s, $v, $this->manager, 'ULP_MANAGER', 'REJECTED', 'Foto kurang jelas')->assertOk();
        $this->assertSame('RETURNED', $r->json('result.version_status'));
        $this->decide($s, $v, $this->perencanaan, 'REVIEW_PERENCANAAN')->assertStatus(409);                         // the old version is closed
    }

    #[Test]
    public function an_application_that_is_no_longer_open_blocks_the_work(): void
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->ready($s, $v);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'CANCELLED']);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertStatus(409);
        $this->fill($s, $v)->assertStatus(409);
        DB::table('applications')->where('id', $app)->update(['current_status' => 'PAID']);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();                  // PAID is still open
        DB::table('applications')->where('id', $app)->update(['current_status' => 'REFUNDED']);
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertStatus(409);
    }

    // ---- visibility -----------------------------------------------------------------------------------------------

    #[Test]
    public function reading_follows_the_application_scope_and_the_detail_tells_the_actor_what_it_may_do(): void
    {
        [$s, $v, $app] = $this->submitted();
        foreach ([$this->retail, $this->manager, $this->teknik, $this->perencanaan, $this->up3Manager, $this->sysAdmin] as $u) {
            $this->as($u)->getJson("/api/surveys/{$s}")->assertOk();
            $this->as($u)->getJson("/api/applications/{$app}/surveys")->assertOk()->assertJsonPath('data.0.id', $s);
        }
        foreach ([$this->teknikB, $this->up3ManagerB] as $u) {
            $this->as($u)->getJson("/api/surveys/{$s}")->assertNotFound();
            $this->as($u)->getJson("/api/applications/{$app}/surveys")->assertNotFound();
        }
        $this->as($this->vendor)->getJson("/api/surveys/{$s}")->assertForbidden();

        $can = fn (User $u) => $this->as($u)->getJson("/api/surveys/{$s}")->assertOk()->json('data.can');
        $this->assertSame(['ULP_MANAGER'], $can($this->manager)['decide']);
        $this->assertTrue($can($this->manager)['assign']);
        $this->assertSame([], $can($this->up3Manager)['decide']);                                                     // not its turn
        $this->assertSame([], $can($this->teknik)['decide']);
        $this->assertFalse($can($this->teknik)['execute']);                                                           // submitted: nothing left to edit
        $this->assertSame([], $can($this->retail)['decide']);
        $this->assertSame([], $can($this->perencanaan)['decide']);                                                    // UP3 no longer holds a survey step
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertSame([], $can($this->manager)['decide']);                                                        // already decided

        $caps = $this->as($this->teknik)->getJson('/api/surveys/access')->assertOk()->json('can');
        $this->assertTrue($caps['surveys.execute']);
        $this->assertFalse($caps['surveys.assign']);
    }

    #[Test]
    public function sys_admin_holds_every_step_but_still_decides_once_per_version_and_needs_mfa(): void
    {
        [$s, $v] = $this->submitted();
        $this->decide($s, $v, $this->sysAdmin, 'ULP_MANAGER')->assertOk();
        $this->decide($s, $v, $this->sysAdmin, 'REVIEW_PERENCANAAN')->assertStatus(409);                          // the manager step ended the chain
        $this->app['auth']->forgetGuards();
        $this->withToken($this->sysAdmin->createToken('t')->plainTextToken)->getJson("/api/surveys/{$s}")->assertForbidden();   // unverified MFA token
    }

    #[Test]
    public function the_database_enforces_the_one_active_survey_and_one_open_version_rules(): void
    {
        [$s, $v, $app] = $this->startedSurvey();
        $this->assertDbRejects(fn () => DB::table('application_surveys')->insert(['id' => (string) Str::uuid(), 'application_id' => $app, 'sequence_number' => 9, 'survey_number' => 'X-9', 'status' => 'ACTIVE',
            'assigned_to' => $this->teknik->getKey(), 'assigned_by' => $this->manager->getKey(), 'created_by' => $this->manager->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->insert(['id' => (string) Str::uuid(), 'survey_id' => $s, 'version_number' => 7, 'status' => 'DRAFT', 'surveyor_id' => $this->teknik->getKey(), 'created_at' => now(), 'updated_at' => now()]));
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['status' => 'ACCEPTED']));        // no shortcut to ACCEPTED
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['status' => 'SUBMITTED']));       // SUBMITTED needs its stage
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['status' => 'SUBMITTED', 'stage' => 'UP3_MANAGER']));
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->delete());
        $this->assertDbRejects(fn () => DB::table('application_survey_versions')->where('id', $v)->update(['latitude' => 120]));
    }

    #[Test]
    public function decisions_are_append_only(): void
    {
        [$s, $v] = $this->submitted();
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();
        $this->assertDbRejects(fn () => DB::table('application_survey_decisions')->update(['notes' => 'diubah']));
        $this->assertDbRejects(fn () => DB::table('application_survey_decisions')->delete());
        $this->assertDbRejects(fn () => DB::table('application_survey_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $v, 'step' => 'REVIEW_PERENCANAAN', 'decision' => 'REJECTED', 'decided_by' => $this->perencanaan->getKey(),
            'decided_role' => 'PERENCANAAN', 'notes' => '  ', 'decided_at' => now()]));                                                       // a rejection needs a reason (CHECK)
    }

    // ---- in-app notifications (docs/62 §44): who must act next hears about it, only inside the unit of the case --------

    /** @return list<string> titles of the user's notifications, oldest first */
    private function inbox(User $u): array
    {
        return DB::table('user_notifications')->where('user_id', $u->getKey())->orderBy('created_at')->pluck('title')->all();
    }

    #[Test]
    public function the_survey_chain_notifies_exactly_the_next_holders_of_the_unit_and_never_the_actor(): void
    {
        [$s, $v] = $this->startedSurvey();
        $this->assertCount(1, $this->inbox($this->teknik));                      // assigned to him
        $this->assertStringContainsString('ditugaskan', $this->inbox($this->teknik)[0]);
        $this->assertSame([], $this->inbox($this->manager));                     // the assigner is the actor

        $this->ready($s, $v);
        $this->as($this->teknik)->postJson("/api/surveys/{$s}/versions/{$v}/submit")->assertOk();
        $this->assertCount(1, $this->inbox($this->manager));                     // ULP manager of THIS ulp
        $this->assertStringContainsString('menunggu keputusan', $this->inbox($this->manager)[0]);
        foreach ([$this->teknikB, $this->up3ManagerB, $this->perencanaan, $this->up3Manager] as $other) {
            $this->assertSame([], $this->inbox($other));                         // other ULP / not their turn yet
        }

        $this->decide($s, $v, $this->manager, 'ULP_MANAGER')->assertOk();        // owner 2026-11-16: accepted at once
        $this->assertSame([], $this->inbox($this->perencanaan));                 // no UP3 step any more
        $this->assertSame([], $this->inbox($this->konstruksi));
        $this->assertSame([], $this->inbox($this->asmanPer));
        $this->assertSame([], $this->inbox($this->up3Manager));
        $this->assertSame([], $this->inbox($this->up3ManagerB));
        $this->assertTrue(collect($this->inbox($this->teknik))->contains(fn ($t) => str_contains($t, 'diterima')));
    }

    #[Test]
    public function a_rejected_survey_tells_the_surveyor_the_reason_and_a_new_application_tells_the_survey_people_of_its_ulp_only(): void
    {
        [$s, $v] = $this->submitted();
        $this->decide($s, $v, $this->manager, 'ULP_MANAGER', 'REJECTED', 'Foto lokasi tidak jelas')->assertOk();
        $last = DB::table('user_notifications')->where('user_id', $this->teknik->getKey())->where('title', 'like', '%dikembalikan%')->first();
        $this->assertNotNull($last);
        $this->assertStringContainsString('dikembalikan', $last->title);
        $this->assertStringContainsString('Foto lokasi tidak jelas', $last->body);
        $this->assertSame('warning', $last->level);
        $this->assertSame("/survei/{$s}", $last->link);

        $before = [$this->manager, $this->teknik, $this->teknikB];
        $counts = array_map(fn ($u) => count($this->inbox($u)), $before);
        $id = $this->as($this->retail)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA->getKey(),
            'customer' => ['name' => 'Budi', 'phone' => '081234567891'], 'service_address' => 'Jl. B', 'new_power_value' => 6600, 'new_power_unit' => 'VA'])->assertCreated()->json('data.id');
        $this->as($this->retail)->postJson("/api/applications/{$id}/submit")->assertSuccessful();
        $this->assertSame($counts[0] + 1, count($this->inbox($this->manager)));
        $this->assertSame($counts[1] + 1, count($this->inbox($this->teknik)));
        $this->assertSame($counts[2], count($this->inbox($this->teknikB)));            // the other ULP hears nothing
        $this->assertSame([], $this->inbox($this->retail));                            // not the actor
    }
}
