<?php

namespace App\Services\Drawings;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Inventory\SrReservationService;
use App\Services\Mto\MtoService;
use App\Services\Proposals\ProposalService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Technical drawing package (stage 3; owner decisions 2026-11-06, docs/62 §10). Writes only; the controller authorizes the actor first.
 * One package per application, many versions. Status cycle DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED (RETURNED / SUPERSEDED), `stage` tells
 * where the approval is: ULP_MANAGER -> UP3_REVIEW (PERENCANAAN + KONSTRUKSI_UP3) -> ASMAN (ASMAN_PERENCANAAN + ASMAN_KONSTRUKSI) -> APPROVED;
 * with extended_approval the ASMAN stage also needs ASMAN_NIAGA (3 of 3) and is followed by UP3_MANAGER.
 * A rejection returns the version and starts a new DRAFT for the same author (the whole chain restarts). An APPROVED version stays current until a
 * newer version is APPROVED; then it becomes SUPERSEDED. The author never decides; a user decides once per version (also database constraints).
 */
class DrawingService
{
    private const OPEN_APPLICATION = ['APPROVED', 'PAID', 'PK_PRINTED'];

    /** @return string drawing id */
    public function create(string $applicationId, ?string $authorId, User $actor): string
    {
        $authorId ??= $actor->getKey();                    // owner 7 Nov 2026: role-based, any TEKNIK of the ULP prepares the drawing of any customer of the ULP
        try {
            return DB::transaction(function () use ($applicationId, $authorId, $actor): string {
                $app = DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
                ProposalService::assertNotNonRepresentativeMember($applicationId);
                if (! SrReservationService::openForWork($app, self::OPEN_APPLICATION)) {
                    throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; gambar hanya dapat dibuat pada status APPROVED, PAID, atau PK_PRINTED.");
                }
                if (DB::table('application_drawings')->where('application_id', $applicationId)->exists()) {
                    throw new AssignmentRuleViolation('Permohonan ini sudah memiliki paket gambar; buat versi baru pada paket itu.');
                }
                $basis = $this->basisSurvey($applicationId);
                $this->requireAuthor($authorId, $app->organizational_unit_id);

                $id = (string) Str::uuid();
                DB::table('application_drawings')->insert(['id' => $id, 'application_id' => $applicationId, 'drawing_number' => "GBR-{$app->application_number}", 'assigned_to' => $authorId, 'assigned_by' => $actor->getKey(),
                    'basis_survey_version_id' => $basis, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                $this->newVersion($id, 1, $authorId, null);

                return $id;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** The manager may give the package to another TEKNIK while the open version is a DRAFT. */
    public function reassign(string $drawingId, string $authorId, User $actor): void
    {
        DB::transaction(function () use ($drawingId, $authorId): void {
            $d = $this->lockDrawing($drawingId);
            $open = $this->openVersion($drawingId);
            if ($open->status !== 'DRAFT') {
                throw new AssignmentRuleViolation('Penyusun hanya dapat diganti saat versi terbuka masih DRAFT.');
            }
            $app = DB::table('applications')->where('id', $d->application_id)->first();
            $this->requireAuthor($authorId, $app->organizational_unit_id);
            DB::table('application_drawings')->where('id', $drawingId)->update(['assigned_to' => $authorId, 'updated_at' => now()]);
            DB::table('application_drawing_versions')->where('id', $open->id)->update(['author_id' => $authorId, 'updated_at' => now()]);
        });
    }

    /** A revision of an APPROVED (or any settled) package: allowed only when no version is open. Starts empty of files; the author uploads the changed ones. */
    public function revise(string $drawingId, User $actor): string
    {
        try {
            return DB::transaction(function () use ($drawingId, $actor): string {
                $d = $this->lockDrawing($drawingId);
                $this->requireApplicationOpen($d);
                if (DB::table('application_drawing_versions')->where('drawing_id', $drawingId)->whereIn('status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'])->exists()) {
                    throw new AssignmentRuleViolation('Masih ada versi yang terbuka; selesaikan atau tunggu keputusannya.');
                }
                $last = DB::table('application_drawing_versions')->where('drawing_id', $drawingId)->orderByDesc('version_number')->first();
                $id = (string) Str::uuid();
                $this->newVersion($drawingId, $last->version_number + 1, $actor->getKey(), $last, $id);   // role-based: the TEKNIK who opens the new version is its author

                return $id;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** @param array{title?:?string, description?:?string, notes?:?string} $data */
    public function updateDraft(string $drawingId, string $versionId, array $data, User $actor): void
    {
        DB::transaction(function () use ($drawingId, $versionId, $data, $actor): void {
            $d = $this->lockDrawing($drawingId);
            $v = $this->version($drawingId, $versionId);
            $this->requireAuthorOf($v, $actor);
            $this->requireDraft($v);
            $this->requireApplicationOpen($d);
            $changes = array_intersect_key($data, array_flip(['title', 'description', 'notes']));
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }
            DB::table('application_drawing_versions')->where('id', $versionId)->update($changes + ['updated_at' => now()]);
        });
    }

    public function submit(string $drawingId, string $versionId, User $actor): void
    {
        DB::transaction(function () use ($drawingId, $versionId, $actor): void {
            $d = $this->lockDrawing($drawingId);
            $v = $this->version($drawingId, $versionId);
            $this->requireAuthorOf($v, $actor);
            $this->requireDraft($v, 'diajukan');
            $this->requireApplicationOpen($d);
            $missing = [];
            if (blank($v->title)) {
                // fall back to the main file's title instead of refusing a drawing whose main file is already named by the standard
                $fromFile = DB::table('application_documents')->where('drawing_version_id', $versionId)->where('file_role', 'MAIN')->where('status', 'ACTIVE')->value('title');
                if (filled($fromFile)) {
                    DB::table('application_drawing_versions')->where('id', $versionId)->update(['title' => $fromFile, 'updated_at' => now()]);
                } else {
                    $missing[] = 'judul gambar';
                }
            }
            if (! DB::table('application_documents')->where('drawing_version_id', $versionId)->where('file_role', 'MAIN')->where('status', 'ACTIVE')->exists()) {
                $missing[] = 'berkas gambar utama';
            }
            $mto = DB::table('mto_packages')->where('drawing_version_id', $versionId)->first();
            if ($mto === null) {
                $missing[] = 'paket MTO';
            }
            if ($missing !== []) {
                throw new AssignmentRuleViolation('Paket gambar belum lengkap; lengkapi: '.implode(', ', $missing).'.');
            }
            // gambar dan MTO diajukan dalam satu proses: MTO ikut diverifikasi (snapshot dikunci) lalu menunggu keputusan Manager ULP bersama gambar
            if ($mto->status === 'DRAFT') {
                app(MtoService::class)->verify($mto->id, $actor);
            }
            DB::table('application_drawing_versions')->where('id', $versionId)->update(['status' => 'SUBMITTED', 'stage' => 'ULP_MANAGER', 'survey_version_id' => null, 'submitted_at' => now(), 'updated_at' => now()]);
        });
    }

    /**
     * Raises the extended-approval requirement (feasibility "tidak layak" or PBP > 5 years). Only while SUBMITTED or in UP3 review; never lowered.
     * Stage 5 (RAB/KKF) will set it from the KKF result.
     */
    public function escalate(string $drawingId, string $versionId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($drawingId, $versionId, $reason, $actor): void {
            $d = $this->lockDrawing($drawingId);
            $v = $this->version($drawingId, $versionId);
            $this->requireApplicationOpen($d);
            if ($v->extended_approval) {
                throw new AssignmentRuleViolation('Persetujuan diperluas sudah diwajibkan pada versi ini.');
            }
            if (! ($v->status === 'SUBMITTED' || ($v->status === 'UNDER_REVIEW' && $v->stage === 'UP3_REVIEW'))) {
                throw new AssignmentRuleViolation('Persetujuan diperluas hanya dapat diwajibkan saat versi SUBMITTED atau dalam review UP3.');
            }
            DB::table('application_drawing_versions')->where('id', $versionId)->update(['extended_approval' => true, 'extended_reason' => trim($reason), 'extended_set_by' => $actor->getKey(), 'updated_at' => now()]);
        });
    }

    /**
     * @return array{version_status:string, stage:?string, new_version_id:?string, superseded_version_id:?string}
     */
    public function decide(string $drawingId, string $versionId, string $step, string $decision, ?string $notes, string $role, User $actor): array
    {
        $cfg = config("distriva_permissions.drawing_steps.{$step}") ?? throw new AssignmentRuleViolation('Langkah persetujuan tidak dikenal.');
        if ($decision === 'REJECTED' && blank($notes)) {
            throw new AssignmentRuleViolation('Penolakan wajib disertai alasan.');
        }
        try {
            return DB::transaction(function () use ($drawingId, $versionId, $step, $decision, $notes, $role, $actor, $cfg): array {
                $d = $this->lockDrawing($drawingId);
                $v = DB::table('application_drawing_versions')->where('id', $versionId)->where('drawing_id', $drawingId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
                $this->requireApplicationOpen($d);
                if ($v->survey_version_id !== null) {
                    throw new AssignmentRuleViolation('Gambar ini diajukan bersama survey (satu paket, satu rantai persetujuan); putuskan pada survey, gambar mengikuti keputusannya.');
                }
                if ($v->stage !== $cfg['stage']) {
                    throw new AssignmentRuleViolation("Versi berstatus {$v->status}".($v->stage ? " (tahap {$v->stage})" : '')."; langkah {$step} hanya dapat diputuskan pada tahap {$cfg['stage']}.");
                }
                if ($v->author_id === $actor->getKey()) {
                    throw new AdministrationDenied('Penyusun tidak boleh memutuskan gambar miliknya sendiri.', 403);
                }
                $mtoPackage = null;
                if ($step === 'ULP_MANAGER' && $decision === 'APPROVED') {
                    $mtoPackage = DB::table('mto_packages')->where('drawing_version_id', $versionId)->first();
                    if ($mtoPackage === null || ! in_array($mtoPackage->status, ['VERIFIED', 'APPROVED'], true)) {
                        throw new AssignmentRuleViolation('MTO versi gambar ini belum diverifikasi Teknik ULP; gambar dan MTO diajukan bersama dan disetujui Manager ULP dalam satu keputusan.');
                    }
                }
                if (($cfg['only_extended'] ?? false) && ! $v->extended_approval) {
                    throw new AssignmentRuleViolation("Langkah {$step} hanya ada pada persetujuan diperluas (kajian tidak layak atau PBP > 5 tahun).");
                }
                if (DB::table('application_drawing_decisions')->where('version_id', $versionId)->where('step', $step)->exists()) {
                    throw new AssignmentRuleViolation("Langkah {$step} sudah diputuskan pada versi ini.");
                }
                if (DB::table('application_drawing_decisions')->where('version_id', $versionId)->where('decided_by', $actor->getKey())->exists()) {
                    throw new AdministrationDenied('Satu pengguna hanya dapat memutuskan satu langkah pada satu versi gambar.', 403);
                }
                DB::table('application_drawing_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $versionId, 'step' => $step, 'decision' => $decision, 'decided_by' => $actor->getKey(),
                    'decided_role' => $role, 'notes' => $notes === null ? null : trim($notes), 'decided_at' => now()]);

                if ($mtoPackage !== null && $mtoPackage->status === 'VERIFIED') {
                    app(MtoService::class)->approveWithDrawing($mtoPackage->id, $actor, $notes);
                }

                if ($decision === 'REJECTED') {
                    DB::table('application_drawing_versions')->where('id', $versionId)->update(['status' => 'RETURNED', 'stage' => null, 'returned_at' => now(), 'returned_at_step' => $step, 'returned_by' => $actor->getKey(),
                        'return_reason' => trim((string) $notes), 'updated_at' => now()]);
                    $new = (string) Str::uuid();
                    $this->newVersion($drawingId, $v->version_number + 1, $d->assigned_to, $v, $new);

                    return ['version_status' => 'RETURNED', 'stage' => null, 'new_version_id' => $new, 'superseded_version_id' => null];
                }

                $group = $v->extended_approval && isset($cfg['group_extended']) ? $cfg['group_extended'] : $cfg['group'];
                $approved = DB::table('application_drawing_decisions')->where('version_id', $versionId)->where('decision', 'APPROVED')->whereIn('step', $group)->count();
                if ($approved < count($group)) {
                    return ['version_status' => $v->status, 'stage' => $v->stage, 'new_version_id' => null, 'superseded_version_id' => null];
                }
                $next = $v->extended_approval && isset($cfg['next_extended']) ? $cfg['next_extended'] : $cfg['next'];
                $superseded = null;
                if ($next['status'] === 'APPROVED') {
                    // the previously approved version (if any) is replaced only now that the new one is approved
                    $old = DB::table('application_drawing_versions')->where('drawing_id', $drawingId)->where('status', 'APPROVED')->where('id', '<>', $versionId)->first();
                    if ($old !== null) {
                        DB::table('application_drawing_versions')->where('id', $old->id)->update(['status' => 'SUPERSEDED', 'superseded_at' => now(), 'updated_at' => now()]);
                        $superseded = $old->id;
                    }
                }
                $update = ['status' => $next['status'], 'stage' => $next['stage'], 'updated_at' => now()];
                if ($next['status'] === 'APPROVED') {
                    $update['approved_at'] = now();
                }
                DB::table('application_drawing_versions')->where('id', $versionId)->update($update);

                return ['version_status' => $next['status'], 'stage' => $next['stage'], 'new_version_id' => null, 'superseded_version_id' => $superseded];
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    // ------------------------------------------------------------------------------------------------------

    private function newVersion(string $drawingId, int $number, string $authorId, ?object $copyFrom, ?string $id = null): void
    {
        $row = ['id' => $id ?? (string) Str::uuid(), 'drawing_id' => $drawingId, 'version_number' => $number, 'status' => 'DRAFT', 'author_id' => $authorId, 'created_at' => now(), 'updated_at' => now()];
        if ($copyFrom !== null) {
            $row['title'] = $copyFrom->title;
            $row['description'] = $copyFrom->description;
            $row['notes'] = $copyFrom->notes;
        }
        DB::table('application_drawing_versions')->insert($row);
    }

    private function lockDrawing(string $id): object
    {
        return DB::table('application_drawings')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function openVersion(string $drawingId): object
    {
        return DB::table('application_drawing_versions')->where('drawing_id', $drawingId)->whereIn('status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'])->first() ?? throw new AssignmentRuleViolation('Paket gambar tidak memiliki versi terbuka.');
    }

    private function version(string $drawingId, string $versionId): object
    {
        return DB::table('application_drawing_versions')->where('id', $versionId)->where('drawing_id', $drawingId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function requireDraft(object $v, string $verb = 'diubah'): void
    {
        if ($v->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Versi berstatus {$v->status}; hanya DRAFT yang dapat {$verb}.");
        }
    }

    /** Role-based (owner 7 Nov 2026): any TEKNIK of the ULP (the controller checked `drawings.execute` on the unit) works on a DRAFT; the version records who last worked on it as its author, and the deciders must differ from that user. */
    private function requireAuthorOf(object $v, User $actor): void
    {
        if ($v->status === 'DRAFT' && $v->author_id !== $actor->getKey()) {
            DB::table('application_drawing_versions')->where('id', $v->id)->update(['author_id' => $actor->getKey(), 'updated_at' => now()]);
            $v->author_id = $actor->getKey();
        }
    }

    private function requireApplicationOpen(object $drawing): void
    {
        $status = DB::table('applications')->where('id', $drawing->application_id)->value('current_status');
        if (! in_array($status, self::OPEN_APPLICATION, true)) {
            throw new AssignmentRuleViolation("Permohonan berstatus {$status}; paket gambar tidak dapat dilanjutkan.");
        }
    }

    /**
     * Owner 2026-11-16: the SLD / CAD drawing belongs to the USULAN, not to the survey. The survey stops at the ULP manager; when it was accepted with "needs a drawing" (and an extension), Teknik ULP creates the usulan
     * and only then the drawing package of that usulan is made (-> ULP manager -> UP3 review -> Asman ...).
     */
    private function basisSurvey(string $applicationId): string
    {
        $v = $this->latestSurveyVersion($applicationId);
        if ($v === null || $v->status !== 'ACCEPTED') {
            throw new AssignmentRuleViolation('Gambar usulan hanya dapat dibuat setelah survey permohonan ini disetujui Manager ULP.');
        }
        if (! $v->requires_drawing) {
            throw new AssignmentRuleViolation('Hasil survey menyatakan gambar teknik tidak diperlukan; tahap gambar dilewati.');
        }
        $p = ProposalService::liveFor($applicationId);
        if ($p === null || $p->proposal_number === null) {
            throw new AssignmentRuleViolation('Gambar dibuat untuk usulan: Teknik ULP membuat usulan terlebih dahulu dari survey yang disetujui.');
        }

        return $v->id;
    }

    private function latestSurveyVersion(string $applicationId): ?object
    {
        return DB::table('application_survey_versions as sv')->join('application_surveys as s', 's.id', '=', 'sv.survey_id')->where('s.application_id', $applicationId)->where('s.status', '<>', 'CANCELLED')
            ->whereIn('sv.status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED'])->orderByDesc('sv.version_number')->first(['sv.id', 'sv.status', 'sv.requires_drawing']);
    }

    /** Called by the survey chain when a step rejects: the riding drawing is returned with the same reason and its author starts a new draft. */
    public function returnWithSurvey(string $surveyVersionId, string $step, string $reason, User $actor, bool $startNewDraft = true): void
    {
        $dv = DB::table('application_drawing_versions')->where('survey_version_id', $surveyVersionId)->whereIn('status', ['SUBMITTED', 'UNDER_REVIEW'])->lockForUpdate()->first();
        if ($dv === null) {
            return;
        }
        DB::table('application_drawing_versions')->where('id', $dv->id)->update(['status' => 'RETURNED', 'stage' => null, 'returned_at' => now(), 'returned_at_step' => $step, 'returned_by' => $actor->getKey(),
            'return_reason' => $reason, 'updated_at' => now()]);
        if ($startNewDraft) {
            $d = DB::table('application_drawings')->where('id', $dv->drawing_id)->first();
            $this->newVersion($dv->drawing_id, $dv->version_number + 1, $d->assigned_to, $dv);
        }
    }

    /** The author must be an ACTIVE account with an effective TEKNIK assignment on exactly the application's ULP. */
    private function requireAuthor(string $userId, string $unitId): void
    {
        $today = now(config('distriva.business_timezone'))->toDateString();
        $ok = DB::table('users as u')->join('user_role_assignments as a', 'a.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'a.role_id')
            ->where('u.id', $userId)->where('u.account_status', 'ACTIVE')->where('r.name', 'TEKNIK')->where('a.organizational_unit_id', $unitId)->where('a.is_active', true)
            ->whereDate('a.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('a.valid_until')->orWhereDate('a.valid_until', '>=', $today))->exists();
        if (! $ok) {
            throw new AssignmentRuleViolation('Penyusun harus akun aktif dengan role TEKNIK pada ULP permohonan ini.');
        }
    }

    private function translate(QueryException $e): \Throwable
    {
        return match ($e->getCode()) {
            '23505' => new AssignmentRuleViolation('Data bentrok dengan paket/versi/keputusan yang sudah ada.', 0, $e),
            '23514', 'P0001' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas gambar.', 0, $e),
            default => $e,
        };
    }
}
