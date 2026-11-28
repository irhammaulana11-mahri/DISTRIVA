<?php

namespace App\Services\Tasks;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Inventory\AllocationService;
use App\Services\Inventory\SrReservationService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Service SLA of network extension (owner, Nov 2026): 4 working days (MTO without extension: only APP / SR), 14 (LV poles only), 24 (MV line / transformer), 100 (cubicle), from the payment date. The category follows the construction
 * groups of the application's MTO (a proposal member uses the representative's MTO; the longest SLA wins); the days come from `sla_configurations` (kind SERVICE). Nothing is stored per application
 * except the explanations of a delay: status and deadline are always computed. An application not yet paid has not started the clock; a paid one without a known payment date falls back to the date its
 * status turned Bayar and then to its request date (`start_basis` says which).
 *
 * Statuses: NOT_STARTED, ON_TRACK, DUE_SOON, OVERDUE (still running past the deadline), MET, MET_LATE (finished after the deadline).
 */
class ServiceSlaService
{
    private const PAID_STATUSES = ['PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE', 'COMPLETED'];

    private const FINISHED = ['CONNECTION_DONE', 'COMPLETED'];

    public function __construct(private readonly BusinessCalendar $calendar, private readonly AllocationService $allocations) {}

    /**
     * @param  list<string>  $applicationIds
     * @return array<string,array<string,mixed>> by application id; applications without a service SLA (no extension category, cancelled, draft) are left out
     */
    public function compute(array $applicationIds, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $out = [];
        // in parts: one IN list holds at most 65535 bind parameters
        foreach (array_chunk($applicationIds, 5000) as $part) {
            $out += $this->computePart($part, $now);
        }

        return $out;
    }

    /**
     * Narrows a query on applications to the ones that can have a service SLA: an MTO of their own or of their proposal's representative, or a 1-phase direct install. A list over a whole
     * scope starts from these instead of loading the connected history.
     */
    public static function candidates(Builder $query, string $alias = 'a'): Builder
    {
        return $query->where(fn (Builder $any) => $any
            ->whereExists(fn (Builder $mto) => $mto->from('mto_packages as m')->whereColumn('m.application_id', "{$alias}.id"))
            ->orWhereExists(fn (Builder $mto) => $mto->from('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->join('mto_packages as m', 'm.application_id', '=', 'p.representative_application_id')
                ->whereColumn('pa.application_id', "{$alias}.id")->whereNull('pa.released_at')->where('p.status', 'OPEN'))
            ->orWhere(fn (Builder $direct) => self::whereDirectInstall($direct, $alias)));
    }

    /** 1 phasa installed without survey (docs/95): running ones, and finished ones paid from `sla_since`. */
    private static function whereDirectInstall(Builder $query, string $alias): Builder
    {
        return $query->whereIn("{$alias}.current_status", self::PAID_STATUSES)->whereRaw(SrReservationService::directInstallSql($alias))
            ->where(fn (Builder $q) => $q->whereNotIn("{$alias}.current_status", self::FINISHED)
                ->orWhereRaw("coalesce({$alias}.paid_at, {$alias}.source_created_at, {$alias}.created_at) >= ?", [(string) config('distriva.sr_reservation.sla_since')]));
    }

    /**
     * @param  list<string>  $applicationIds
     * @return array<string,array<string,mixed>>
     */
    private function computePart(array $applicationIds, CarbonImmutable $now): array
    {
        $apps = DB::table('applications')->whereIn('id', $applicationIds)->whereNotIn('current_status', ['DRAFT', 'SUBMITTED', 'CANCELLED', 'REFUNDED'])
            ->get(['id', 'organizational_unit_id', 'current_status', 'paid_at', 'source_created_at', 'created_at', 'completed_at'])->keyBy('id');
        if ($apps->isEmpty()) {
            return [];
        }
        $ids = $apps->keys()->all();
        $owner = DB::table('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->whereIn('pa.application_id', $ids)->whereNull('pa.released_at')->where('p.status', 'OPEN')
            ->pluck('p.representative_application_id', 'pa.application_id')->all();
        $categories = $this->categories(array_values(array_unique(array_map(fn ($id) => $owner[$id] ?? $id, $ids))));
        $sla = DB::table('sla_configurations')->where('kind', 'SERVICE')->get()->keyBy('task_type');
        $direct = $this->directInstalls($ids);
        $bayar = DB::table('application_external_status_histories')->whereIn('application_id', $ids)->whereIn(DB::raw('upper(external_status_code)'), ['BAYAR', 'SUDAH BAYAR'])->whereNotNull('observed_at')
            ->groupBy('application_id')->selectRaw('application_id, min(observed_at) as at')->pluck('at', 'application_id')->all();
        $done = DB::table('application_external_status_histories')->whereIn('application_id', $ids)->whereRaw("upper(external_status_code) = 'PEREMAJAAN'")->whereNotNull('observed_at')
            ->groupBy('application_id')->selectRaw('application_id, min(observed_at) as at')->pluck('at', 'application_id')->all();

        $out = [];
        foreach ($apps as $id => $a) {
            $category = $categories[$owner[$id] ?? $id] ?? (isset($direct[$id]) ? 'LAYANAN_TANPA_PERLUASAN' : null);
            $cfg = $category === null ? null : $sla->get($category);
            if ($cfg === null || ! $cfg->is_active || $cfg->working_days === null) {
                continue;
            }
            $finished = in_array($a->current_status, self::FINISHED, true) ? ($done[$id] ?? $a->completed_at ?? $a->created_at) : null;
            if (! in_array($a->current_status, self::PAID_STATUSES, true)) {
                $out[$id] = $this->row($id, $a, $category, $cfg, null, null, null, 'NOT_STARTED', null, null);

                continue;
            }
            [$start, $basis] = match (true) {
                $a->paid_at !== null => [$a->paid_at, 'PAID'],
                isset($bayar[$id]) => [$bayar[$id], 'STATUS_BAYAR'],
                default => [$a->source_created_at ?? $a->created_at, 'REQUESTED'],
            };
            $due = $this->calendar->dueAt(CarbonImmutable::parse($start, config('distriva.business_timezone')), (int) $cfg->working_days);
            $end = $finished === null ? $now : CarbonImmutable::parse($finished);
            $late = $end->gt($due);
            $status = $finished !== null ? ($late ? 'MET_LATE' : 'MET') : ($late ? 'OVERDUE'
                : ($this->calendar->workingDaysLeft($due, $now) <= (int) config('distriva.tasks.due_soon_days') ? 'DUE_SOON' : 'ON_TRACK'));
            $out[$id] = $this->row($id, $a, $category, $cfg, CarbonImmutable::parse($start, config('distriva.business_timezone')), $basis, $due, $status,
                $finished === null ? null : CarbonImmutable::parse($finished), $late ? $this->calendar->workingDaysBetween($due, $end) : 0);
            // overdue notices skip the backlog that was already late when the rule came in
            $out[$id]['announce'] = ! isset($direct[$id]) || isset($categories[$owner[$id] ?? $id]) || CarbonImmutable::parse($start)->toDateString() >= (string) config('distriva.sr_reservation.sla_since');
        }

        return $out;
    }

    /**
     * 1-phase applications installed without survey (docs/95): only APP / SR, so the service SLA without extension unless an MTO says otherwise.
     *
     * @param  list<string>  $ids
     * @return array<string,true>
     */
    private function directInstalls(array $ids): array
    {
        return self::whereDirectInstall(DB::table('applications as a')->whereIn('a.id', $ids), 'a')->pluck('a.id')->mapWithKeys(fn (string $id): array => [$id => true])->all();
    }

    /** Detail of one application: the computed row plus the material shortfall (while it runs) and the explanations. @return array<string,mixed>|null */
    public function detail(string $applicationId): ?array
    {
        $row = $this->compute([$applicationId])[$applicationId] ?? null;
        if ($row === null) {
            return null;
        }
        $owner = DB::table('proposal_applications as pa')->join('proposals as p', 'p.id', '=', 'pa.proposal_id')->where('pa.application_id', $applicationId)->whereNull('pa.released_at')->where('p.status', 'OPEN')->value('p.representative_application_id') ?? $applicationId;
        $hasApprovedMto = DB::table('mto_packages')->where('application_id', $owner)->where('status', 'APPROVED')->exists();
        $row['materials'] = [
            'known' => $hasApprovedMto,
            'shortfall' => in_array($row['status'], ['OVERDUE', 'DUE_SOON'], true) && $hasApprovedMto ? $this->allocations->shortfall($owner) : [],
        ];
        $row['materials']['complete'] = $hasApprovedMto ? $this->allocations->shortfall($owner) === [] : null;
        $row['notes'] = DB::table('application_sla_notes as n')->join('users as u', 'u.id', '=', 'n.created_by')->where('n.application_id', $applicationId)->orderByDesc('n.created_at')->limit(20)
            ->get(['n.id', 'n.note', 'n.created_at', 'u.name as author'])->all();

        return $row;
    }

    public function addNote(string $applicationId, string $note, User $actor): void
    {
        if (trim($note) === '') {
            throw new AssignmentRuleViolation('Keterangan wajib diisi.');
        }
        if (($this->compute([$applicationId])[$applicationId] ?? null) === null) {
            throw new AssignmentRuleViolation('Permohonan ini tidak memiliki SLA layanan.');
        }
        DB::table('application_sla_notes')->insert(['id' => (string) Str::uuid(), 'application_id' => $applicationId, 'note' => trim($note), 'created_by' => $actor->getKey(), 'created_at' => now()]);
    }

    /**
     * @param  list<string>  $ownerIds
     * @return array<string,string> owner application id => category with the longest SLA
     */
    private function categories(array $ownerIds): array
    {
        $packages = DB::table('mto_packages')->whereIn('application_id', $ownerIds)->orderBy('created_at')->get(['id', 'application_id', 'status']);
        $chosen = [];
        foreach ($packages as $p) {                                                // the latest approved package, else the latest one
            $cur = $chosen[$p->application_id] ?? null;
            if ($cur === null || $p->status === 'APPROVED' || $cur->status !== 'APPROVED') {
                $chosen[$p->application_id] = $p;
            }
        }
        $groups = DB::table('mto_items')->whereIn('package_id', array_map(fn ($p) => $p->id, $chosen))->where('psg', '>', 0)->get(['package_id', 'group_code'])->groupBy('package_id');
        $days = DB::table('sla_configurations')->where('kind', 'SERVICE')->pluck('working_days', 'task_type')->all();
        $map = (array) config('distriva.service_sla.groups');
        $out = [];
        foreach ($chosen as $owner => $p) {
            foreach (($groups[$p->id] ?? collect())->pluck('group_code')->unique() as $g) {
                $cat = $map[$g] ?? null;
                if ($cat !== null && (! isset($out[$owner]) || (int) ($days[$cat] ?? 0) > (int) ($days[$out[$owner]] ?? 0))) {
                    $out[$owner] = $cat;
                }
            }
        }
        foreach ($chosen as $owner => $p) {                                        // an MTO without any extension group (only APP / SR): the shortest service SLA
            isset($out[$owner]) || $out[$owner] = 'LAYANAN_TANPA_PERLUASAN';
        }

        return $out;
    }

    /** @return array<string,mixed> */
    private function row(string $id, object $a, string $category, object $cfg, ?CarbonImmutable $start, ?string $basis, ?CarbonImmutable $due, string $status, ?CarbonImmutable $finished, ?int $lateDays): array
    {
        return ['application_id' => $id, 'unit_id' => $a->organizational_unit_id, 'application_status' => $a->current_status, 'category' => $category, 'category_label' => $cfg->label, 'working_days' => (int) $cfg->working_days,
            'start_at' => $start?->toIso8601String(), 'start_basis' => $basis, 'due_at' => $due?->toIso8601String(), 'status' => $status, 'finished_at' => $finished?->toIso8601String(), 'late_working_days' => $lateDays,
            'working_days_left' => $due !== null && $finished === null && $status !== 'OVERDUE' ? $this->calendar->workingDaysLeft($due) : null];
    }
}
