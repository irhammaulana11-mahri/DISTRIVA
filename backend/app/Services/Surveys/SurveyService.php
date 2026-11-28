<?php

namespace App\Services\Surveys;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Drawings\DrawingService;
use App\Services\Inventory\SrReservationService;
use App\Services\Proposals\ProposalService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Survey workflow (stage 2; owner decisions 2026-11-06, docs/62 §8). Writes only; the controller authorizes the actor first.
 * A survey is worked in versions; per version the chain is
 *   DRAFT (surveyor TEKNIK) -> SUBMITTED/ULP_MANAGER (MANAGER_ULP) -> UNDER_REVIEW/UP3_REVIEW (PERENCANAAN + KONSTRUKSI_UP3, both)
 *   -> UNDER_REVIEW/ASMAN (ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI, both) -> ACCEPTED (owner 8 Nov 2026: Manager UP3 no longer decides surveys; the PBP-based extra approval belongs to the RAB/KKF step). A drawing submitted with the survey rides the same chain.
 * Owner 2026-11-14 (docs/82): a survey of "no extension" (no JTR/JTM/transformer addition: requires_network_extension = no, no drawing, no feasibility study) is accepted by the ULP manager alone and the customer is then ready to be
 * installed (statuses afterwards follow the EIS import); every survey needs its KKO recorded first; "no extension" against a KKO that shows an overload above 100 % after the new load, a low voltage or a TIDAK LAYAK decision needs a written reason.
 * A rejection at any step RETURNS the version (kept, frozen) and starts a new DRAFT version for the same surveyor: the process restarts.
 * The surveyor never decides; a user decides at most once per version (service check + database constraints).
 */
class SurveyService
{
    /** Application statuses in which a survey may be started / worked (docs/62 §8 point 4). */
    private const OPEN_APPLICATION = ['APPROVED', 'PAID', 'PK_PRINTED'];

    private const CONTENT = ['survey_date', 'findings', 'technical_recommendation', 'requires_drawing', 'requires_network_extension', 'requires_feasibility_study', 'latitude', 'longitude',
        'network_distance_m', 'sr_length_m', 'network_type', 'transformer_capacity_kva', 'network_condition', 'notes', 'measurements', 'no_extension_reason'];

    /** @return string survey id */
    public function assign(string $applicationId, ?string $surveyorId, ?string $scheduledAt, User $actor): string
    {
        $surveyorId ??= $actor->getKey();                  // owner 7 Nov 2026: role-based, any TEKNIK of the ULP surveys any customer of the ULP; the manager may still name one
        try {
            return DB::transaction(function () use ($applicationId, $surveyorId, $scheduledAt, $actor): string {
                $app = DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
                ProposalService::assertNotNonRepresentativeMember($applicationId);
                if (! SrReservationService::openForWork($app, self::OPEN_APPLICATION)) {
                    throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; survey hanya dapat dibuat pada status APPROVED, PAID, atau PK_PRINTED.");
                }
                if (DB::table('application_surveys')->where('application_id', $applicationId)->where('status', 'ACTIVE')->exists()) {
                    throw new AssignmentRuleViolation('Permohonan ini sudah memiliki survey yang aktif.');
                }
                $this->requireSurveyor($surveyorId, $app->organizational_unit_id);

                $seq = ((int) DB::table('application_surveys')->where('application_id', $applicationId)->max('sequence_number')) + 1;
                $id = (string) Str::uuid();
                DB::table('application_surveys')->insert(['id' => $id, 'application_id' => $applicationId, 'sequence_number' => $seq, 'survey_number' => "SRV-{$app->application_number}-{$seq}", 'status' => 'ACTIVE',
                    'assigned_to' => $surveyorId, 'assigned_by' => $actor->getKey(), 'scheduled_at' => $scheduledAt, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                $this->newVersion($id, 1, $surveyorId, null);

                return $id;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** While the open version is still a DRAFT the manager may give the survey to another TEKNIK user of the ULP. */
    public function reassign(string $surveyId, string $surveyorId, User $actor): void
    {
        DB::transaction(function () use ($surveyId, $surveyorId): void {
            $survey = $this->lockSurvey($surveyId);
            $version = $this->openVersion($surveyId);
            if ($version->status !== 'DRAFT') {
                throw new AssignmentRuleViolation('Surveyor hanya dapat diganti saat versi masih DRAFT.');
            }
            $app = DB::table('applications')->where('id', $survey->application_id)->first();
            $this->requireSurveyor($surveyorId, $app->organizational_unit_id);
            DB::table('application_surveys')->where('id', $surveyId)->update(['assigned_to' => $surveyorId, 'updated_at' => now()]);
            DB::table('application_survey_versions')->where('id', $version->id)->update(['surveyor_id' => $surveyorId, 'updated_at' => now()]);
        });
    }

    public function cancel(string $surveyId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($surveyId, $reason): void {
            $survey = $this->lockSurvey($surveyId);
            DB::table('application_surveys')->where('id', $survey->id)->update(['status' => 'CANCELLED', 'cancel_reason' => trim($reason), 'updated_at' => now()]);
        });
    }

    /** @param array<string,mixed> $data validated content fields */
    public function updateDraft(string $surveyId, string $versionId, array $data, User $actor): void
    {
        DB::transaction(function () use ($surveyId, $versionId, $data, $actor): void {
            $survey = $this->lockSurvey($surveyId);
            $v = $this->version($surveyId, $versionId);
            $this->requireSurveyorOf($v, $actor);
            $this->requireDraft($v);
            $this->requireApplicationOpen($survey);
            $changes = array_intersect_key($data, array_flip(self::CONTENT));
            if (isset($changes['measurements'])) {
                $changes['measurements'] = json_encode(array_values($changes['measurements']));
            }
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }
            DB::table('application_survey_versions')->where('id', $versionId)->update($changes + ['updated_at' => now()]);
        });
    }

    /** @param array<string,mixed> $content optional form content saved in the same transaction before the completeness check */
    public function submit(string $surveyId, string $versionId, User $actor, array $content = []): void
    {
        DB::transaction(function () use ($surveyId, $versionId, $actor, $content): void {
            $survey = $this->lockSurvey($surveyId);
            $v = $this->version($surveyId, $versionId);
            $this->requireSurveyorOf($v, $actor);
            $this->requireDraft($v, 'diajukan');
            $this->requireApplicationOpen($survey);
            $changes = array_intersect_key($content, array_flip(self::CONTENT));
            if ($changes !== []) {
                if (isset($changes['measurements'])) {
                    $changes['measurements'] = json_encode(array_values($changes['measurements']));
                }
                DB::table('application_survey_versions')->where('id', $versionId)->update($changes + ['updated_at' => now()]);
                $v = $this->version($surveyId, $versionId);
            }
            $missing = [];
            foreach (['survey_date' => 'tanggal survey'] as $col => $label) {          // owner 2026-11-16: findings and technical recommendation are no longer asked; the date is automatic
                if (blank($v->{$col})) {
                    $missing[] = $label;
                }
            }
            foreach (['requires_drawing' => 'kebutuhan gambar', 'requires_network_extension' => 'kebutuhan perluasan jaringan', 'requires_feasibility_study' => 'kebutuhan studi kelayakan'] as $col => $label) {
                if ($v->{$col} === null) {
                    $missing[] = $label;
                }
            }
            if ($v->requires_network_extension === false && ($v->requires_drawing || $v->requires_feasibility_study)) {
                throw new AssignmentRuleViolation('Survei tanpa perluasan jaringan: kebutuhan gambar dan studi kelayakan harus "tidak" (tidak ada JTR/JTM/trafo yang ditambah).');
            }
            foreach (['sr_length_m' => 'panjang SR yang dibutuhkan', 'network_distance_m' => 'jarak bangunan dari tiang eksisting'] as $col => $label) {
                if ($v->{$col} === null) {
                    $missing[] = $label;
                }
            }
            $kko = DB::table('application_kko')->where('application_id', $survey->application_id)->first();
            if ($kko === null && config('distriva.survey_requires_kko')) {
                throw new AssignmentRuleViolation('KKO belum dicatat: pilih gardu dan catat hasil KKO pada survei sebelum mengajukan.');
            }
            if ($v->requires_network_extension === false && $kko !== null && self::kkoRisk($kko) !== [] && blank($v->no_extension_reason)) {
                throw new AssignmentRuleViolation('KKO menunjukkan '.implode(', ', self::kkoRisk($kko)).': penanda "tanpa perluasan" memerlukan alasan tertulis dari surveyor.');
            }
            $docs = DB::table('application_documents as d')->join('application_survey_versions as sv', 'sv.id', '=', 'd.survey_version_id')->where('sv.survey_id', $surveyId)->where('d.status', 'ACTIVE')->count();
            if ($docs === 0) {
                $missing[] = 'minimal satu foto/dokumen pendukung';
            }
            if ($missing !== []) {
                throw new AssignmentRuleViolation('Hasil survey belum lengkap; lengkapi: '.implode(', ', $missing).'.');
            }
            DB::table('application_survey_versions')->where('id', $versionId)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER', 'submitted_at' => now(), 'updated_at' => now(),
                'kko_id' => $kko?->id, 'kko_snapshot' => $kko === null ? null : json_encode(self::kkoSnapshot($kko))]);
        });
    }

    /**
     * One decision on one step. $role is the role that authorised the actor (recorded). A rejection (notes required) returns the version
     * and opens a new DRAFT; when every step of the stage group is APPROVED the version advances.
     *
     * @return array{version_status:string, stage:?string, survey_status:string, new_version_id:?string, proposal_closed?:?string}
     */
    public function decide(string $surveyId, string $versionId, string $step, string $decision, ?string $notes, string $role, User $actor): array
    {
        $cfg = config("distriva_permissions.survey_steps.{$step}") ?? throw new AssignmentRuleViolation('Langkah persetujuan tidak dikenal.');
        if ($decision === 'REJECTED' && blank($notes)) {
            throw new AssignmentRuleViolation('Penolakan wajib disertai alasan.');
        }
        try {
            return DB::transaction(function () use ($surveyId, $versionId, $step, $decision, $notes, $role, $actor, $cfg): array {
                $survey = $this->lockSurvey($surveyId);
                $v = DB::table('application_survey_versions')->where('id', $versionId)->where('survey_id', $surveyId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
                $this->requireApplicationOpen($survey);
                if ($v->stage !== $cfg['stage']) {
                    throw new AssignmentRuleViolation("Versi berstatus {$v->status}".($v->stage ? " (tahap {$v->stage})" : '')."; langkah {$step} hanya dapat diputuskan pada tahap {$cfg['stage']}.");
                }
                if ($v->surveyor_id === $actor->getKey()) {
                    throw new AdministrationDenied('Surveyor tidak boleh memutuskan survey miliknya sendiri.', 403);
                }
                if (DB::table('application_survey_decisions')->where('version_id', $versionId)->where('step', $step)->exists()) {
                    throw new AssignmentRuleViolation("Langkah {$step} sudah diputuskan pada versi ini.");
                }
                if (DB::table('application_survey_decisions')->where('version_id', $versionId)->where('decided_by', $actor->getKey())->exists()) {
                    throw new AdministrationDenied('Satu pengguna hanya dapat memutuskan satu langkah pada satu versi survey.', 403);
                }
                DB::table('application_survey_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $versionId, 'step' => $step, 'decision' => $decision, 'decided_by' => $actor->getKey(),
                    'decided_role' => $role, 'notes' => $notes === null ? null : trim($notes), 'decided_at' => now()]);

                if ($decision === 'REJECTED') {
                    DB::table('application_survey_versions')->where('id', $versionId)->update(['status' => 'RETURNED', 'stage' => null, 'returned_at' => now(), 'returned_at_step' => $step, 'returned_by' => $actor->getKey(),
                        'return_reason' => trim((string) $notes), 'updated_at' => now()]);
                    $new = (string) Str::uuid();
                    $this->newVersion($surveyId, $v->version_number + 1, $survey->assigned_to, $v, $new);
                    app(DrawingService::class)->returnWithSurvey($versionId, $step, trim((string) $notes), $actor);

                    return ['version_status' => 'RETURNED', 'stage' => null, 'survey_status' => 'ACTIVE', 'new_version_id' => $new];
                }

                $approved = DB::table('application_survey_decisions')->where('version_id', $versionId)->where('decision', 'APPROVED')->whereIn('step', $cfg['group'])->count();
                if ($approved >= count($cfg['group'])) {
                    $next = $cfg['next'];
                    $update = ['status' => $next['status'], 'stage' => $next['stage'], 'updated_at' => now()];
                    if ($next['status'] === 'ACCEPTED') {
                        $update['accepted_at'] = now();
                        DB::table('application_surveys')->where('id', $surveyId)->update(['status' => 'ACCEPTED', 'updated_at' => now()]);
                    }
                    DB::table('application_survey_versions')->where('id', $versionId)->update($update);
                    $closed = null;
                    if ($next['status'] === 'ACCEPTED' && $v->requires_network_extension === false) {      // explicitly "no extension needed": the proposal ends, members go on as ordinary applications
                        $closed = app(ProposalService::class)->completeWithoutExtension($survey->application_id, $actor);
                    }

                    return ['version_status' => $next['status'], 'stage' => $next['stage'], 'survey_status' => $next['status'] === 'ACCEPTED' ? 'ACCEPTED' : 'ACTIVE', 'new_version_id' => null, 'proposal_closed' => $closed];
                }

                return ['version_status' => $v->status, 'stage' => $v->stage, 'survey_status' => 'ACTIVE', 'new_version_id' => null];
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    // ------------------------------------------------------------------------------------------------------

    /** "No extension": nothing is added to the network (no drawing, no feasibility study) - the short chain applies. */
    public static function isNoExtension(object $v): bool
    {
        return $v->requires_network_extension === false && ! $v->requires_drawing && ! $v->requires_feasibility_study;
    }

    /** What the KKO shows that argues against "no extension". @return list<string> */
    public static function kkoRisk(object $kko): array
    {
        $risk = [];
        $kko->class_after === 'OVERBLAST' && $risk[] = 'pembebanan trafo di atas 100 % setelah beban baru';
        $kko->voltage_low === true && $risk[] = 'tegangan lokasi rendah';
        $kko->decision === 'TIDAK_LAYAK' && $risk[] = 'keputusan TIDAK LAYAK';

        return $risk;
    }

    /** The key figures of the KKO a survey was submitted with. @return array<string,mixed> */
    public static function kkoSnapshot(object $kko): array
    {
        $f = fn ($v) => $v === null ? null : (float) $v;

        return ['substation_id' => $kko->substation_id ?? null, 'substation_code' => $kko->substation_code, 'transformer_capacity_kva' => $f($kko->transformer_capacity_kva), 'measured_load_kva' => $f($kko->measured_load_kva),
            'measured_at' => $kko->measured_at, 'voltage_location_v' => $f($kko->voltage_location_v), 'dedicated_transformer' => (bool) $kko->dedicated_transformer, 'loading_before_pct' => $f($kko->loading_before_pct),
            'loading_after_pct' => $f($kko->loading_after_pct), 'class_after' => $kko->class_after, 'voltage_low' => $kko->voltage_low, 'decision' => $kko->decision];
    }

    /** The latest survey of an application and what it concluded; null when none. @return array{survey_number:string,status:string,outcome:?string,accepted_at:?string}|null */
    public static function latestOutcome(string $applicationId): ?array
    {
        $r = DB::table('application_surveys as s')->join('application_survey_versions as sv', 'sv.survey_id', '=', 's.id')->where('s.application_id', ProposalService::surveyOwnerId($applicationId))->where('s.status', '!=', 'CANCELLED')
            ->orderByDesc('s.sequence_number')->orderByDesc('sv.version_number')->first(['s.survey_number', 's.status', 'sv.requires_network_extension', 'sv.accepted_at']);

        return $r === null ? null : ['survey_number' => $r->survey_number, 'status' => $r->status, 'outcome' => $r->requires_network_extension === null ? null : ($r->requires_network_extension ? 'EXTENSION' : 'NO_EXTENSION'), 'accepted_at' => $r->accepted_at];
    }

    private function newVersion(string $surveyId, int $number, string $surveyorId, ?object $copyFrom, ?string $id = null): void
    {
        $row = ['id' => $id ?? (string) Str::uuid(), 'survey_id' => $surveyId, 'version_number' => $number, 'status' => 'DRAFT', 'surveyor_id' => $surveyorId, 'created_at' => now(), 'updated_at' => now(),
            'survey_date' => now(config('distriva.business_timezone'))->toDateString()];          // the survey date follows the running day (owner 2026-11-16); the surveyor may change it
        if ($copyFrom !== null) {                     // the surveyor starts again from the returned content
            foreach (self::CONTENT as $col) {
                $row[$col] = $copyFrom->{$col};
            }
        }
        DB::table('application_survey_versions')->insert($row);
    }

    private function lockSurvey(string $id): object
    {
        $s = DB::table('application_surveys')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($s->status !== 'ACTIVE') {
            throw new AssignmentRuleViolation("Survey berstatus {$s->status}; tidak dapat diubah.");
        }

        return $s;
    }

    private function openVersion(string $surveyId): object
    {
        return DB::table('application_survey_versions')->where('survey_id', $surveyId)->whereNotIn('status', ['RETURNED', 'ACCEPTED'])->first() ?? throw new AssignmentRuleViolation('Survey tidak memiliki versi terbuka.');
    }

    private function version(string $surveyId, string $versionId): object
    {
        return DB::table('application_survey_versions')->where('id', $versionId)->where('survey_id', $surveyId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function requireDraft(object $v, string $verb = 'diubah'): void
    {
        if ($v->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Versi berstatus {$v->status}; hanya DRAFT yang dapat {$verb}.");
        }
    }

    /** Role-based (owner 7 Nov 2026): any TEKNIK of the ULP (the controller checked `surveys.execute` on the unit) works on a DRAFT; the version records who last worked on it as its surveyor, and the deciders must differ from that user. */
    private function requireSurveyorOf(object $v, User $actor): void
    {
        if ($v->status === 'DRAFT' && $v->surveyor_id !== $actor->getKey()) {
            DB::table('application_survey_versions')->where('id', $v->id)->update(['surveyor_id' => $actor->getKey(), 'updated_at' => now()]);
            $v->surveyor_id = $actor->getKey();
        }
    }

    private function requireApplicationOpen(object $survey): void
    {
        $status = DB::table('applications')->where('id', $survey->application_id)->value('current_status');
        if (! in_array($status, self::OPEN_APPLICATION, true)) {
            throw new AssignmentRuleViolation("Permohonan berstatus {$status}; survey tidak dapat dilanjutkan (batalkan survey bila perlu).");
        }
    }

    /** The surveyor must be an ACTIVE account with an effective TEKNIK assignment on exactly the application's ULP. */
    private function requireSurveyor(string $userId, string $unitId): void
    {
        $today = now(config('distriva.business_timezone'))->toDateString();
        $ok = DB::table('users as u')->join('user_role_assignments as a', 'a.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'a.role_id')
            ->where('u.id', $userId)->where('u.account_status', 'ACTIVE')->where('r.name', 'TEKNIK')->where('a.organizational_unit_id', $unitId)->where('a.is_active', true)
            ->whereDate('a.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today))->exists();
        if (! $ok) {
            throw new AssignmentRuleViolation('Surveyor harus akun aktif dengan role TEKNIK pada ULP permohonan ini.');
        }
    }

    private function translate(QueryException $e): \Throwable
    {
        return match ($e->getCode()) {
            '23505' => new AssignmentRuleViolation('Data bentrok dengan survey/keputusan yang sudah ada.', 0, $e),
            '23514', 'P0001' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas survey.', 0, $e),
            default => $e,
        };
    }
}
