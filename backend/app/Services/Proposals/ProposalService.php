<?php

namespace App\Services\Proposals;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Drawings\DrawingService;
use App\Services\Inventory\SrReservationService;
use App\Services\Surveys\SurveyService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Usulan (docs/62 §37): one work proposal with several 3-phase customers (new power >= 6600 VA) of ONE ULP, chosen from a searchable table. The first customer is the REPRESENTATIVE
 * application: survey, drawing, MTO, RAB, allocation, WO and BASTP keep running through it; the KKF is calculated once for all members. Members can be changed until a WO is issued.
 * Callers authorize the actor on the ULP first.
 */
class ProposalService
{
    public const MIN_VA = 6600;

    private const OPEN_APPLICATION = ['SUBMITTED', 'APPROVED', 'PAID', 'PK_PRINTED'];

    /** Applications selectable as customers: this ULP, any power or tariff, status mohon/disetujui/bayar/cetak PK, not in a live proposal, searchable by name / IDPEL / application number. @param list<string> $unitIds */
    public function selectable(array $unitIds, ?string $search, int $perPage = 20, bool $forSurvey = false): LengthAwarePaginator
    {
        $q = DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->leftJoin('customer_external_references as r', fn ($j) => $j->on('r.customer_id', '=', 'c.id')->where('r.reference_type', 'IDPEL'))
            ->whereIn('a.organizational_unit_id', $unitIds)->whereIn('a.current_status', self::OPEN_APPLICATION)
            ->whereNotExists(fn ($s) => $s->from('proposal_applications as pa')->whereColumn('pa.application_id', 'a.id')->whereNull('pa.released_at'))
            ->when($forSurvey, fn ($w) => $w->whereIn('a.current_status', ['APPROVED', 'PAID', 'PK_PRINTED'])->whereNotExists(fn ($s) => $s->from('application_surveys as sv')->whereColumn('sv.application_id', 'a.id')->where('sv.status', '!=', 'CANCELLED')))
            ->orderBy('a.application_number')
            ->select('a.id', 'a.application_number', 'a.application_type', 'a.new_tariff_code', 'a.new_power_value', 'a.new_power_unit', 'a.service_address', 'c.name as customer_name', 'r.reference_value as idpel', 'u.code as ulp_code', 'u.name as ulp_name');
        if ($search !== null && trim($search) !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($search)).'%';
            $q->where(fn ($w) => $w->where('c.name', 'ilike', $term)->orWhere('a.application_number', 'ilike', $term)->orWhere('r.reference_value', 'ilike', $term)->orWhere('a.service_address', 'ilike', $term));
        }

        return $q->paginate($perPage);
    }

    /**
     * @param  list<string>  $applicationIds  the first becomes the representative
     * @param  bool  $forSurvey  a collective SURVEY request (owner 2026-11-15): no usulan number yet, it is issued when the survey is accepted as "needs extension"; only applications a survey can start on
     */
    public function create(array $applicationIds, ?string $title, User $actor, bool $forSurvey = false): string
    {
        $ids = array_values(array_unique($applicationIds));
        if ($ids === []) {
            throw new AssignmentRuleViolation('Pilih minimal satu pelanggan untuk usulan.');
        }
        try {
            return DB::transaction(function () use ($ids, $title, $actor, $forSurvey): string {
                $apps = $this->eligible($ids, true, $forSurvey);
                $unit = $apps->first()->organizational_unit_id;
                $id = (string) Str::uuid();
                DB::table('proposals')->insert(['id' => $id, 'proposal_number' => $forSurvey ? null : $this->number((string) $unit), 'issued_at' => $forSurvey ? null : now(), 'ulp_unit_id' => $unit, 'representative_application_id' => $ids[0], 'title' => $title, 'status' => 'OPEN',
                    'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                foreach ($ids as $a) {
                    DB::table('proposal_applications')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $id, 'application_id' => $a, 'added_by' => $actor->getKey(), 'added_at' => now()]);
                }
                $this->event($id, 'CREATED', $actor, null, ['application_ids' => $ids, 'for_survey' => $forSurvey]);

                return $id;
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Salah satu pelanggan sudah termuat pada usulan lain.', 0, $e) : $e;
        }
    }

    /** @param list<string> $applicationIds */
    public function addMembers(string $proposalId, array $applicationIds, string $reason, User $actor): void
    {
        try {
            DB::transaction(function () use ($proposalId, $applicationIds, $reason, $actor): void {
                $p = $this->open($proposalId);
                $ids = array_values(array_unique($applicationIds));
                $apps = $this->eligible($ids);
                if ($apps->contains(fn ($a) => $a->organizational_unit_id !== $p->ulp_unit_id)) {
                    throw new AssignmentRuleViolation('Semua pelanggan dalam satu usulan harus berasal dari ULP yang sama.');
                }
                foreach ($ids as $a) {
                    DB::table('proposal_applications')->updateOrInsert(['proposal_id' => $proposalId, 'application_id' => $a], ['id' => (string) Str::uuid(), 'added_by' => $actor->getKey(), 'added_at' => now(), 'released_at' => null]);
                }
                $this->event($proposalId, 'MEMBER_ADDED', $actor, $reason, ['application_ids' => $ids]);
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Salah satu pelanggan sudah termuat pada usulan lain.', 0, $e) : $e;
        }
    }

    public function removeMember(string $proposalId, string $applicationId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($proposalId, $applicationId, $reason, $actor): void {
            $p = $this->open($proposalId);
            if ($p->representative_application_id === $applicationId) {
                throw new AssignmentRuleViolation('Pelanggan utama (perwakilan) usulan tidak dapat dikeluarkan; batalkan usulan bila perlu.');
            }
            $n = DB::table('proposal_applications')->where('proposal_id', $proposalId)->where('application_id', $applicationId)->whereNull('released_at')->update(['released_at' => now()]);
            if ($n === 0) {
                throw new AssignmentRuleViolation('Pelanggan ini bukan anggota usulan.');
            }
            $this->event($proposalId, 'MEMBER_REMOVED', $actor, $reason, ['application_id' => $applicationId]);
        });
    }

    /**
     * Cancelling a proposal also cancels the survey of its representative that is still running (owner 8 Nov 2026) and returns the drawing riding it; a survey already ACCEPTED stays as history.
     *
     * @return array{survey_id:string, stage:?string, unit:string, number:string}|null the survey that was cancelled, for the notification
     */
    public function cancel(string $proposalId, string $reason, User $actor): ?array
    {
        return DB::transaction(function () use ($proposalId, $reason, $actor): ?array {
            $p = $this->open($proposalId);
            $rep = $p->representative_application_id;
            if (DB::table('applications')->where('id', $rep)->exists() && DB::table('work_orders')->where('application_id', $rep)->whereIn('status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED'])->exists()) {
                throw new AssignmentRuleViolation('Usulan yang WO-nya sudah diterbitkan tidak dapat dibatalkan; batalkan WO terlebih dahulu.');
            }
            DB::table('proposal_applications')->where('proposal_id', $proposalId)->whereNull('released_at')->update(['released_at' => now()]);
            DB::table('proposals')->where('id', $proposalId)->update(['status' => 'CANCELLED', 'cancel_reason' => trim($reason), 'updated_at' => now()]);
            $this->event($proposalId, 'CANCELLED', $actor, $reason, null);

            $survey = DB::table('application_surveys')->where('application_id', $rep)->where('status', 'ACTIVE')->lockForUpdate()->first();
            if ($survey === null) {
                return null;
            }
            $v = DB::table('application_survey_versions')->where('survey_id', $survey->id)->whereIn('status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'])->first();
            DB::table('application_surveys')->where('id', $survey->id)->update(['status' => 'CANCELLED', 'cancel_reason' => 'Usulan dibatalkan: '.trim($reason), 'updated_at' => now()]);
            if ($v !== null) {
                app(DrawingService::class)->returnWithSurvey($v->id, 'PROPOSAL_CANCELLED', 'Usulan dibatalkan: '.trim($reason), $actor, false);
            }
            $app = DB::table('applications')->where('id', $rep)->first(['organizational_unit_id']);

            return ['survey_id' => $survey->id, 'stage' => $v?->stage, 'unit' => (string) $app->organizational_unit_id, 'number' => $survey->survey_number];
        });
    }

    /**
     * The representative's survey was ACCEPTED with "perluasan jaringan = tidak" (owner 8 Nov 2026): the OPEN proposal closes as COMPLETED_NO_EXTENSION, every member is released and
     * continues as an ordinary application. Runs inside the survey decision's transaction. Returns the proposal number, or null when the application leads no open proposal.
     */
    public function completeWithoutExtension(string $representativeApplicationId, User $actor): ?string
    {
        $p = DB::table('proposals')->where('representative_application_id', $representativeApplicationId)->where('status', 'OPEN')->lockForUpdate()->first();
        if ($p === null) {
            return null;
        }
        $members = DB::table('proposal_applications')->where('proposal_id', $p->id)->whereNull('released_at')->pluck('application_id')->all();
        DB::table('proposal_applications')->where('proposal_id', $p->id)->whereNull('released_at')->update(['released_at' => now()]);
        DB::table('proposals')->where('id', $p->id)->update(['status' => 'COMPLETED_NO_EXTENSION', 'updated_at' => now()]);
        $this->event($p->id, 'COMPLETED_NO_EXTENSION', $actor, 'Hasil survey perwakilan: tidak memerlukan perluasan jaringan.', ['application_ids' => $members]);

        return $p->proposal_number ?? 'survei kolektif';          // a collective survey request never had a number
    }

    /**
     * Teknik ULP creates the usulan once the survey was accepted by the ULP manager with "needs network extension" (owner 2026-11-16: the usulan is made after the survey, not by it).
     * A collective survey request becomes the usulan (it gets its number); an individual survey gets a one-customer usulan. @return array{id:string, proposal_number:string}
     */
    public function issueFromSurvey(string $applicationId, User $actor): array
    {
        return DB::transaction(function () use ($applicationId, $actor): array {
            DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            self::assertNotNonRepresentativeMember($applicationId);
            $survey = SurveyService::latestOutcome($applicationId);
            if ($survey === null || $survey['status'] !== 'ACCEPTED' || $survey['outcome'] !== 'EXTENSION') {
                throw new AssignmentRuleViolation('Usulan hanya dapat dibuat dari survey yang sudah disetujui Manager ULP dengan hasil memerlukan perluasan jaringan.');
            }
            $live = self::liveFor($applicationId);
            if ($live !== null && $live->proposal_number !== null) {
                throw new AssignmentRuleViolation("Usulan {$live->proposal_number} sudah dibuat untuk permohonan ini.");
            }
            $number = $this->issueForSurvey($applicationId, $actor) ?? throw new AssignmentRuleViolation('Usulan tidak dapat dibuat untuk permohonan ini.');

            return ['id' => (string) self::liveFor($applicationId)->id, 'proposal_number' => $number];
        });
    }

    /**
     * Issues the number of the open proposal led by the application (or creates the one-customer proposal) (owner 2026-11-15): the usulan is issued. A collective survey request already is a proposal without a number: it gets its number now. An individual survey has no proposal yet:
     * a one-customer proposal is created for it with its number. Runs inside the survey decision's transaction. Returns the usulan number, or null when it was issued before.
     */
    public function issueForSurvey(string $representativeApplicationId, User $actor): ?string
    {
        $p = DB::table('proposals')->where('representative_application_id', $representativeApplicationId)->where('status', 'OPEN')->lockForUpdate()->first();
        if ($p !== null) {
            if ($p->proposal_number !== null) {
                return null;
            }
            $number = $this->number((string) $p->ulp_unit_id);
            DB::table('proposals')->where('id', $p->id)->update(['proposal_number' => $number, 'issued_at' => now(), 'updated_at' => now()]);
            $this->event($p->id, 'ISSUED', $actor, 'Hasil survei: memerlukan perluasan jaringan.', ['proposal_number' => $number]);

            return $number;
        }
        $app = DB::table('applications')->where('id', $representativeApplicationId)->first(['organizational_unit_id']);
        if ($app === null || self::liveFor($representativeApplicationId) !== null) {
            return null;
        }
        $id = (string) Str::uuid();
        $number = $this->number((string) $app->organizational_unit_id);
        DB::table('proposals')->insert(['id' => $id, 'proposal_number' => $number, 'issued_at' => now(), 'ulp_unit_id' => $app->organizational_unit_id, 'representative_application_id' => $representativeApplicationId, 'title' => null,
            'status' => 'OPEN', 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('proposal_applications')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $id, 'application_id' => $representativeApplicationId, 'added_by' => $actor->getKey(), 'added_at' => now()]);
        $this->event($id, 'CREATED', $actor, 'Dibuat otomatis dari hasil survei perorangan yang memerlukan perluasan jaringan.', ['application_ids' => [$representativeApplicationId], 'for_survey' => false]);

        return $number;
    }

    /**
     * The application whose survey speaks for this one: the representative of the proposal it is a live member of, or of the proposal that closed as "no extension" with it as member; otherwise the application itself.
     * SQL twin: ApplicationController::SURVEY_OWNER_SQL.
     */
    public static function surveyOwnerId(string $applicationId): string
    {
        $rep = DB::table('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->where('pa.application_id', $applicationId)
            ->where(fn ($w) => $w->where(fn ($x) => $x->whereNull('pa.released_at')->where('p.status', 'OPEN'))->orWhere('p.status', 'COMPLETED_NO_EXTENSION'))
            ->orderByDesc('pa.added_at')->value('p.representative_application_id');

        return $rep ?? $applicationId;
    }

    /** The OPEN proposal an application currently belongs to (as representative or member), or null. */
    public static function liveFor(string $applicationId): ?object
    {
        return DB::table('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->where('pa.application_id', $applicationId)->whereNull('pa.released_at')->where('p.status', 'OPEN')
            ->first(['p.id', 'p.proposal_number', 'p.representative_application_id']);
    }

    /** Refuses to start a pipeline step on a MEMBER that is not the representative: the work runs through the representative. */
    public static function assertNotNonRepresentativeMember(string $applicationId): void
    {
        $p = self::liveFor($applicationId);
        if ($p !== null && $p->representative_application_id !== $applicationId) {
            throw new AssignmentRuleViolation("Pelanggan ini bagian dari usulan {$p->proposal_number}; survey, gambar, MTO, RAB, WO dan BASTP dikerjakan lewat pelanggan utama usulan.");
        }
    }

    /** @return list<string> application ids of the live members (representative first) */
    public static function memberIds(string $proposalId): array
    {
        $p = DB::table('proposals')->where('id', $proposalId)->first();
        $ids = DB::table('proposal_applications')->where('proposal_id', $proposalId)->whereNull('released_at')->orderBy('added_at')->pluck('application_id')->all();
        usort($ids, fn ($a, $b) => ($b === $p->representative_application_id) <=> ($a === $p->representative_application_id));

        return $ids;
    }

    /** All the applications whose customers belong to the work of an application (itself or its proposal's members). @return list<string> */
    public static function scopeOf(string $applicationId): array
    {
        $p = self::liveFor($applicationId);

        return $p !== null && $p->representative_application_id === $applicationId ? self::memberIds($p->id) : [$applicationId];
    }

    /** @param list<string> $ids @return \Illuminate\Support\Collection<int,object> */
    private function eligible(array $ids, bool $firstMaySurvey = false, bool $surveyOpen = false)
    {
        $apps = DB::table('applications')->whereIn('id', $ids)->get();
        if ($apps->count() !== count($ids)) {
            throw new AssignmentRuleViolation('Sebagian permohonan tidak ditemukan.');
        }
        if ($apps->pluck('organizational_unit_id')->unique()->count() > 1) {
            throw new AssignmentRuleViolation('Semua pelanggan dalam satu usulan harus berasal dari ULP yang sama.');
        }
        foreach ($apps as $a) {
            if ($surveyOpen && ! SrReservationService::openForWork($a, ['APPROVED', 'PAID', 'PK_PRINTED'])) {
                throw new AssignmentRuleViolation("Permohonan {$a->application_number} berstatus {$a->current_status}; survei hanya dapat dimulai pada status APPROVED, PAID, atau PK_PRINTED.");
            }
            if (! SrReservationService::openForWork($a, self::OPEN_APPLICATION)) {
                throw new AssignmentRuleViolation("Permohonan {$a->application_number} berstatus {$a->current_status}; usulan hanya memuat permohonan SUBMITTED (mohon), APPROVED, PAID, atau PK_PRINTED.");
            }
            if (DB::table('application_surveys')->where('application_id', $a->id)->exists() && ! ($firstMaySurvey && $a->id === $ids[0])) {
                throw new AssignmentRuleViolation("Permohonan {$a->application_number} sudah memiliki survey sendiri; tidak dapat digabung ke usulan.");
            }
        }

        return $apps;
    }

    private function open(string $id): object
    {
        $p = DB::table('proposals')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($p->status !== 'OPEN') {
            throw new AssignmentRuleViolation('Usulan sudah dibatalkan.');
        }
        if (DB::table('work_orders')->where('application_id', $p->representative_application_id)->whereIn('status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED'])->exists()) {
            throw new AssignmentRuleViolation('WO usulan ini sudah diterbitkan; anggota tidak dapat diubah.');
        }

        return $p;
    }

    /** `{sequence}/USULAN-PBPD/{dd-mm}/{unit code}/{year}` (owner 7 Nov 2026), e.g. 00001/USULAN-PBPD/07-11/51543/2026; the sequence runs per ULP per year. */
    private function number(string $unitId): string
    {
        $d = CarbonImmutable::now(config('distriva.business_timezone'));
        DB::table('proposal_number_sequences')->insertOrIgnore(['organizational_unit_id' => $unitId, 'year' => $d->year, 'last_number' => 0]);
        $row = DB::table('proposal_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->lockForUpdate()->first();
        DB::table('proposal_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->update(['last_number' => $row->last_number + 1]);

        return strtr((string) config('distriva.document.proposal_number_format'), ['{seq}' => str_pad((string) ($row->last_number + 1), 5, '0', STR_PAD_LEFT), '{dm}' => $d->format('d-m'),
            '{unit}' => (string) DB::table('organizational_units')->where('id', $unitId)->value('code'), '{year}' => (string) $d->year]);
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $id, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('proposal_events')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
