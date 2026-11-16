<?php

namespace App\Services\Reports;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Inventory\StockService;
use App\Services\Rkm\RkmService;
use App\Services\Tasks\ServiceSlaService;
use App\Services\WorkOrders\VendorService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Dashboard and reports (roadmap stage 11, docs/62 §41). Every figure is computed from the stored records of the units the caller may see (the controller passes the allowed ULP ids);
 * nothing is stored. Filters: unit and the creation date of the application (from/to). Output is plain arrays; `document()` wraps them for the XLSX renderer.
 */
class ReportService
{
    public function __construct(private readonly RkmService $rkm) {}

    /**
     * @param  list<string>  $units  allowed ULP ids
     * @return array<string,mixed>
     */
    public function overview(array $units, ?string $from, ?string $to): array
    {
        $apps = fn () => DB::table('applications as a')->whereIn('a.organizational_unit_id', $units)->when($from, fn ($q) => $q->whereDate('a.created_at', '>=', $from))->when($to, fn ($q) => $q->whereDate('a.created_at', '<=', $to));
        $ids = $apps()->select('a.id');            // subquery, not a plucked id list: tens of thousands of ids exceed the 65535 bind-parameter limit
        $count = fn (string $table, string $col = 'status', string $appCol = 'application_id') => DB::table($table)->whereIn($appCol, $ids)->selectRaw("{$col} as k, count(*) as c")->groupBy($col)->pluck('c', 'k')->map(fn ($c) => (int) $c)->all();
        $latestRab = DB::table('rab_runs')->whereIn('id', DB::table('rab_runs')->whereIn('application_id', $ids)->selectRaw('distinct on (application_id) id')->orderBy('application_id')->orderByDesc('run_number'))->get(['grand_total']);
        $latestKkf = DB::table('kkf_runs')->whereIn('id', DB::table('kkf_runs')->whereIn('application_id', $ids)->selectRaw('distinct on (application_id) id')->orderBy('application_id')->orderByDesc('run_number'))->get(['feasible', 'extended_required', 'payback_months']);
        $drawingStatus = DB::table('application_drawing_versions as v')->whereIn('v.id', DB::table('application_drawing_versions as x')->join('application_drawings as d', 'd.id', '=', 'x.drawing_id')->whereIn('d.application_id', $ids)->selectRaw('distinct on (x.drawing_id) x.id')->orderBy('x.drawing_id')->orderByDesc('x.version_number'))->selectRaw('v.status as k, count(*) as c')->groupBy('v.status')->pluck('c', 'k')->map(fn ($c) => (int) $c)->all();

        return [
            'filters' => ['from' => $from, 'to' => $to, 'unit_count' => count($units)],
            'applications' => ['total' => $apps()->count(), 'by_status' => $count('applications', 'current_status', 'id'), 'by_type' => $count('applications', 'application_type', 'id'), 'by_source' => $count('applications', 'source_type', 'id')],
            'proposals' => ['open' => DB::table('proposals')->whereIn('ulp_unit_id', $units)->where('status', 'OPEN')->count(), 'cancelled' => DB::table('proposals')->whereIn('ulp_unit_id', $units)->where('status', 'CANCELLED')->count()],
            'surveys' => ['by_status' => $count('application_surveys')],
            'drawings' => ['latest_version_by_status' => $drawingStatus],
            'mto' => ['by_status' => $count('mto_packages')],
            'rab' => ['applications_with_run' => $latestRab->count(), 'total_value' => (float) $latestRab->sum('grand_total')],
            'kkf' => ['applications_with_run' => $latestKkf->count(), 'feasible' => $latestKkf->where('feasible', true)->count(), 'not_feasible' => $latestKkf->where('feasible', false)->count(), 'extended_required' => $latestKkf->where('extended_required', true)->count()],
            'work_orders' => ['by_status' => $count('work_orders')],
            'bastp' => ['by_status' => $count('bastps')],
            'material_requests' => ['by_status' => $count('material_requests'), 'needs_followup' => DB::table('material_requests')->whereIn('application_id', $ids)->where(fn ($q) => $q->where('needs_followup', true)->orWhere('oversent', true))->count()],
        ];
    }

    /**
     * One row per ULP: how many applications reached each stage.
     *
     * @param  list<string>  $units
     * @return list<array<string,mixed>>
     */
    public function pipeline(array $units, ?string $from, ?string $to): array
    {
        $rows = [];
        foreach (DB::table('organizational_units')->whereIn('id', $units)->orderBy('code')->get(['id', 'code', 'name']) as $u) {
            $ids = DB::table('applications as a')->where('a.organizational_unit_id', $u->id)->when($from, fn ($q) => $q->whereDate('a.created_at', '>=', $from))->when($to, fn ($q) => $q->whereDate('a.created_at', '<=', $to))->pluck('a.id')->all();
            $has = fn (string $table, array $where = []) => $ids === [] ? 0 : DB::table($table)->whereIn('application_id', $ids)->where($where)->distinct()->count('application_id');
            $rows[] = ['unit_code' => $u->code, 'unit_name' => $u->name, 'applications' => count($ids),
                'with_survey' => $has('application_surveys'),
                'drawing_approved' => $ids === [] ? 0 : DB::table('application_drawings as d')->join('application_drawing_versions as v', 'v.drawing_id', '=', 'd.id')->whereIn('d.application_id', $ids)->where('v.status', 'APPROVED')->distinct()->count('d.application_id'),
                'mto_approved' => $has('mto_packages', ['status' => 'APPROVED']), 'rab_run' => $has('rab_runs'), 'kkf_run' => $has('kkf_runs'),
                'wo_issued' => $ids === [] ? 0 : DB::table('work_orders')->whereIn('application_id', $ids)->whereIn('status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED', 'SUPERSEDED'])->distinct()->count('application_id'),
                'wo_completed' => $has('work_orders', ['status' => 'COMPLETED']), 'bastp_closed' => $has('bastps', ['status' => 'CLOSED'])];
        }

        return $rows;
    }

    /** RKM reports (docs/12 §7) of one version: `per-ulp`, `comparison` (proposed / validated / final), `critical` (net requirement or stock below the safety level). @return array<string,mixed> */
    public function rkm(string $versionId, string $type): array
    {
        $v = DB::table('rkm_versions')->where('id', $versionId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $plan = DB::table('rkm_plans')->where('id', $v->plan_id)->first();
        $lines = DB::table('rkm_lines as l')->join('rkm_proposals as p', 'p.id', '=', 'l.proposal_id')->join('organizational_units as u', 'u.id', '=', 'p.ulp_unit_id')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('p.version_id', $versionId)
            ->orderBy('u.code')->orderByRaw('length(k.code), k.code')->get(['u.code as ulp', 'k.code as khs', 'l.qty_work', 'l.qty_pipeline', 'l.qty_forecast', 'l.qty_validated']);
        $title = ['per-ulp' => 'RKM PER ULP', 'comparison' => 'RKM: USULAN, VALIDASI, PERSETUJUAN', 'critical' => 'RKM: MATERIAL KRITIS'][$type] ?? throw new AdministrationDenied('Jenis laporan tidak dikenal.', 404);
        $meta = [['Rencana', $plan->plan_number], ['Versi', (int) $v->version_number.' ('.$v->status.', putaran '.(int) $v->round.')'], ['Periode', $plan->period_start.' s.d. '.$plan->period_end]];
        if ($type === 'per-ulp') {
            $sections = [['heading' => 'Usulan per ULP', 'columns' => ['ULP', 'KODE KHS', 'PEKERJAAN', 'PIPELINE', 'FORECAST', 'USULAN', 'SETELAH VALIDASI'], 'rows' => $lines->map(function ($l) {
                $raw = (float) $l->qty_work + (float) $l->qty_pipeline + (float) $l->qty_forecast;

                return [$l->ulp, $l->khs, (float) $l->qty_work, (float) $l->qty_pipeline, (float) $l->qty_forecast, $raw, $l->qty_validated === null ? $raw : (float) $l->qty_validated];
            })->all()]];

            return $this->doc($title, $meta, $sections);
        }
        $req = $v->status === 'APPROVED' && $v->snapshot !== null ? (array) json_decode((string) $v->snapshot, true) : $this->rkm->requirements($versionId);
        $rows = collect($req['rows']);
        if ($type === 'comparison') {
            $proposed = $lines->groupBy('khs')->map(fn ($g) => $g->sum(fn ($l) => (float) $l->qty_work + (float) $l->qty_pipeline + (float) $l->qty_forecast));
            $validated = $lines->groupBy('khs')->map(fn ($g) => $g->sum(fn ($l) => $l->qty_validated !== null ? (float) $l->qty_validated : (float) $l->qty_work + (float) $l->qty_pipeline + (float) $l->qty_forecast));
            $sections = [['heading' => 'Perbandingan per KHS', 'columns' => ['KODE KHS', 'USULAN ULP', 'SETELAH VALIDASI', 'SELISIH VALIDASI', 'SUDAH DIALOKASIKAN', 'KEBUTUHAN KOTOR (DISETUJUI)', 'KEBUTUHAN BERSIH'],
                'rows' => $rows->map(fn ($r) => [$r['khs_code'], (float) ($proposed[$r['khs_code']] ?? 0), (float) ($validated[$r['khs_code']] ?? 0), (float) (($validated[$r['khs_code']] ?? 0) - ($proposed[$r['khs_code']] ?? 0)), (float) $r['already_allocated'], (float) $r['gross_demand'], (float) $r['net_requirement']])->values()->all()]];

            return $this->doc($title, $meta, $sections);
        }
        $critical = $rows->filter(fn ($r) => $r['net_requirement'] > 0 || ($r['stock']['safety'] > 0 && $r['stock']['available'] < $r['stock']['safety']))->sortByDesc('net_requirement');

        return $this->doc($title, $meta, [['heading' => 'Material yang perlu perhatian (kebutuhan bersih > 0 atau stok tersedia di bawah stok pengaman)', 'columns' => ['KODE KHS', 'KEBUTUHAN KOTOR', 'STOK TERSEDIA', 'STOK PENGAMAN', 'PASOKAN MASUK', 'KEBUTUHAN BERSIH', 'KEKURANGAN TERHADAP PENGAMAN'],
            'rows' => $critical->map(fn ($r) => [$r['khs_code'], (float) $r['gross_demand'], (float) $r['stock']['available'], (float) $r['stock']['safety'], (float) $r['stock']['incoming'], (float) $r['net_requirement'], max(0.0, (float) ($r['stock']['safety'] - $r['stock']['available']))])->values()->all()]]);
    }

    /**
     * SLA and Aging Report.
     *
     * @param  list<string>  $units
     * @return array<string,mixed>
     */
    public function sla(array $units, ?string $from, ?string $to): array
    {
        $apps = DB::table('applications as a')
            ->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->whereIn('a.organizational_unit_id', $units)
            ->when($from, fn ($q) => $q->whereDate('a.created_at', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('a.created_at', '<=', $to))
            ->select([
                'a.id',
                'a.application_number',
                'a.application_type',
                'a.current_status',
                'a.created_at',
                'a.submitted_at',
                'a.completed_at',
                'a.old_tariff_code',
                'a.new_tariff_code',
                'a.new_power_value',
                'a.new_power_unit',
                'u.code as unit_code',
                'u.name as unit_name',
                'c.name as customer_name',
            ])->get();

        $appIds = $apps->pluck('id')->all();

        // ids are chunked: tens of thousands of applications exceed the 65535 bind-parameter limit of one IN list
        $byChunk = fn (callable $query) => collect(array_chunk($appIds, 5000))->flatMap(fn (array $part) => $query($part))->keyBy('application_id');

        $surveys = $byChunk(fn (array $ids) => DB::table('application_surveys as s')
            ->join('application_survey_versions as sv', 'sv.survey_id', '=', 's.id')
            ->whereIn('s.application_id', $ids)
            ->selectRaw('distinct on (s.application_id) s.application_id, sv.status, sv.created_at, sv.accepted_at, sv.survey_date')
            ->orderBy('s.application_id')
            ->orderByDesc('sv.version_number')
            ->get());

        $drawings = $byChunk(fn (array $ids) => DB::table('application_drawings as d')
            ->join('application_drawing_versions as dv', 'dv.drawing_id', '=', 'd.id')
            ->whereIn('d.application_id', $ids)
            ->where('dv.status', 'APPROVED')
            ->selectRaw('distinct on (d.application_id) d.application_id, dv.approved_at')
            ->orderBy('d.application_id')
            ->orderByDesc('dv.version_number')
            ->get());

        $workOrders = $byChunk(fn (array $ids) => DB::table('work_orders as w')
            ->whereIn('w.application_id', $ids)
            ->whereNotNull('w.issued_at')
            ->selectRaw('distinct on (w.application_id) w.application_id, w.wo_number, w.status, w.issued_at, w.completed_at')
            ->orderBy('w.application_id')
            ->orderByDesc('w.version_number')
            ->get());

        $bastps = $byChunk(fn (array $ids) => DB::table('bastps as b')
            ->whereIn('b.application_id', $ids)
            ->whereNotNull('b.closed_at')
            ->selectRaw('distinct on (b.application_id) b.application_id, b.bastp_number, b.status, b.closed_at')
            ->orderBy('b.application_id')
            ->orderByDesc('b.created_at')
            ->get());

        // Service SLA of network extension (14/24/100 working days from payment): where it applies it replaces the general rule below.
        $service = [];
        foreach (array_chunk($appIds, 5000) as $part) {
            $service += app(ServiceSlaService::class)->compute($part);
        }
        $lastNotes = collect(array_chunk(array_keys($service), 5000))->flatMap(fn (array $part) => DB::table('application_sla_notes')->whereIn('application_id', $part)->selectRaw('distinct on (application_id) application_id, note')->orderBy('application_id')->orderByDesc('created_at')->get())->keyBy('application_id');
        $needsNote = 0;

        $rows = [];
        $diffDays = fn ($start, $end) => $start && $end ? max(0, (int) round((strtotime((string) $end) - strtotime((string) $start)) / 86400)) : null;

        $t1Durations = [];
        $t2Durations = [];
        $t3Durations = [];
        $t4Durations = [];
        $totalDurations = [];
        $overdueCount = 0;
        $now = now();

        foreach ($apps as $app) {
            $created = $app->created_at;
            $srv = $surveys->get($app->id);
            $drw = $drawings->get($app->id);
            $wo = $workOrders->get($app->id);
            $ba = $bastps->get($app->id);

            $srvEnd = $srv?->accepted_at ?? ($srv?->survey_date ? $srv->survey_date.' 23:59:59' : null);
            $t1 = $diffDays($created, $srvEnd);
            if ($t1 !== null) {
                $t1Durations[] = $t1;
            }

            $t2 = $srvEnd && $drw?->approved_at ? $diffDays($srvEnd, $drw->approved_at) : null;
            if ($t2 !== null) {
                $t2Durations[] = $t2;
            }

            $t3 = $drw?->approved_at && $wo?->issued_at ? $diffDays($drw->approved_at, $wo->issued_at) : null;
            if ($t3 !== null) {
                $t3Durations[] = $t3;
            }

            $t4 = $wo?->issued_at && $ba?->closed_at ? $diffDays($wo->issued_at, $ba->closed_at) : null;
            if ($t4 !== null) {
                $t4Durations[] = $t4;
            }

            $total = $ba?->closed_at ? $diffDays($created, $ba->closed_at) : null;
            if ($total !== null) {
                $totalDurations[] = $total;
            }

            $isActive = ! in_array($app->current_status, ['COMPLETED', 'CANCELLED'], true) && $ba?->closed_at === null;
            $ageDays = $diffDays($created, $now);

            // Standar SLA PLN: total > 25 hari atau survei > 3 hari tanpa hasil dianggap OVERDUE
            $svc = $service[$app->id] ?? null;
            $isOverdue = false;
            if ($svc !== null) {                                              // TMP: the clock starts at payment; an unpaid application is on track
                $isOverdue = $isActive && $svc['status'] === 'OVERDUE';
            } elseif ($isActive && ($ageDays > 25 || ($srv === null && $ageDays > 3))) {
                $isOverdue = true;
            }
            $isOverdue && $overdueCount++;
            $note = $lastNotes->get($app->id)?->note;
            $noteMissing = $svc !== null && in_array($svc['status'], ['OVERDUE', 'MET_LATE'], true) && $note === null;
            $noteMissing && $needsNote++;

            $currentStage = match ($app->current_status) {
                'DRAFT', 'SUBMITTED' => 'Pendaftaran / Agenda',
                'APPROVED', 'PAID', 'PK_PRINTED' => $srv ? ($drw ? ($wo ? 'Konstruksi Fisik' : 'Penerbitan SPK') : 'Desain Gambar & RAB') : 'Survei Lapangan',
                'COMPLETED' => 'Selesai / Nyala',
                'CANCELLED' => 'Dibatalkan',
                default => $app->current_status,
            };

            $powerStr = ($app->new_tariff_code ? $app->new_tariff_code.' · ' : '').
                ($app->new_power_value !== null ? number_format((float) $app->new_power_value, 0, ',', '.').' '.($app->new_power_unit ?? 'VA') : '-');

            $rows[] = [
                'id' => $app->id,
                'application_number' => $app->application_number,
                'unit_code' => $app->unit_code,
                'unit_name' => $app->unit_name,
                'customer_name' => $app->customer_name,
                'tariff_power' => $powerStr,
                'created_at' => substr((string) $app->created_at, 0, 10),
                'current_status' => $app->current_status,
                'current_stage' => $currentStage,
                'age_days' => $ageDays,
                't1_survey_days' => $t1,
                't2_drawing_days' => $t2,
                't3_wo_days' => $t3,
                't4_execution_days' => $t4,
                'total_cycle_days' => $total,
                'sla_status' => $isOverdue ? 'OVERDUE' : 'ON_TRACK',
                'sla_basis' => $svc !== null ? 'LAYANAN' : 'UMUM',
                'service_category' => $svc['category_label'] ?? null,
                'service_working_days' => $svc['working_days'] ?? null,
                'service_due_date' => isset($svc['due_at']) ? substr((string) $svc['due_at'], 0, 10) : null,
                'service_status' => $svc['status'] ?? null,
                'service_late_working_days' => $svc['late_working_days'] ?? null,
                'delay_note' => $note,
                'needs_note' => $noteMissing,
            ];
        }

        $avg = fn (array $arr) => count($arr) > 0 ? (float) round(array_sum($arr) / count($arr), 1) : 0.0;

        return [
            'summary' => [
                'total_applications' => count($apps),
                'active_applications' => count(array_filter($rows, fn ($r) => ! in_array($r['current_status'], ['COMPLETED', 'CANCELLED'], true))),
                'overdue_count' => $overdueCount,
                'needs_note_count' => $needsNote,
                'average_days_mohon_to_survey' => $avg($t1Durations),
                'average_days_survey_to_drawing' => $avg($t2Durations),
                'average_days_drawing_to_wo' => $avg($t3Durations),
                'average_days_wo_to_nyala' => $avg($t4Durations),
                'average_total_cycle_days' => $avg($totalDurations),
            ],
            'rows' => $rows,
        ];
    }

    /**
     * Cost Variance Report: RAB vs SPK / WO vs BASTP actual material install.
     *
     * @param  list<string>  $units
     * @return list<array<string,mixed>>
     */
    public function costVariance(array $units, ?string $from, ?string $to): array
    {
        $items = DB::table('applications as a')
            ->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->leftJoin('rab_runs as r', fn ($j) => $j->on('r.application_id', '=', 'a.id'))
            ->leftJoin('work_orders as w', fn ($j) => $j->on('w.application_id', '=', 'a.id')->whereIn('w.status', ['ISSUED', 'IN_PROGRESS', 'COMPLETED', 'SUPERSEDED']))
            ->leftJoin('vendor_companies as v', 'v.id', '=', 'w.vendor_company_id')
            ->leftJoin('bastps as b', 'b.work_order_id', '=', 'w.id')
            ->whereIn('a.organizational_unit_id', $units)
            ->whereNotNull('r.id')
            ->when($from, fn ($q) => $q->whereDate('a.created_at', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('a.created_at', '<=', $to))
            ->selectRaw('distinct on (a.id) a.id, a.application_number, u.code as unit_code, u.name as unit_name, c.name as customer_name, r.grand_total as rab_total, w.wo_number, w.status as wo_status, v.name as vendor_name, b.bastp_number, b.status as bastp_status')
            ->orderBy('a.id')
            ->orderByDesc('r.run_number')
            ->get();

        return $items->map(fn ($i) => [
            'application_number' => $i->application_number,
            'unit_code' => $i->unit_code,
            'unit_name' => $i->unit_name,
            'customer_name' => $i->customer_name,
            'rab_total' => (float) $i->rab_total,
            'wo_number' => $i->wo_number ?? '-',
            'wo_status' => $i->wo_status ?? 'BELUM_SPK',
            'vendor_name' => $i->vendor_name ?? '-',
            'bastp_number' => $i->bastp_number ?? '-',
            'bastp_status' => $i->bastp_status ?? 'BELUM_BASTP',
        ])->all();
    }

    /**
     * Vendor Performance Summary over the work orders of the scoped units, optionally of a period (by issue date).
     *
     * Score (0-100) = the weighted completion rate (work orders not cancelled), timeliness (completed by the target date, or still running
     * within it), quality (1 - BASTP revisions per work order) and reporting discipline (running work orders reported recently); the weights,
     * the stale-report days and the rating limits are the administrator's (ReportSettings). A component without data drops out of the average.
     *
     * @param  list<string>  $units
     * @return list<array<string,mixed>>
     */
    public function vendorPerformance(array $units, ?string $from = null, ?string $to = null): array
    {
        $tz = config('distriva.business_timezone');
        $cfg = app(ReportSettings::class)->get()['vendor'];
        $today = now($tz)->startOfDay();
        $vendors = DB::table('vendor_companies')->where('status', 'ACTIVE')->orderBy('name')->get();
        $wos = DB::table('work_orders as w')->join('applications as a', 'a.id', '=', 'w.application_id')->whereIn('a.organizational_unit_id', $units)
            ->when($from, fn ($q) => $q->whereRaw('(coalesce(w.issued_at, w.created_at) at time zone ?)::date >= ?', [$tz, $from]))
            ->when($to, fn ($q) => $q->whereRaw('(coalesce(w.issued_at, w.created_at) at time zone ?)::date <= ?', [$tz, $to]))
            ->get(['w.id', 'w.vendor_company_id', 'w.status', 'w.issued_at', 'w.completed_at', 'w.target_date']);
        $ids = $wos->pluck('id')->all();
        $bastps = DB::table('bastps')->whereIn('work_order_id', $ids)->get(['work_order_id', 'round']);
        $progress = DB::table('wo_progress')->whereIn('work_order_id', $ids)->orderBy('submitted_at')->get(['work_order_id', 'status', 'cumulative_percent', 'submitted_at'])->groupBy('work_order_id');

        $rows = [];
        foreach ($vendors as $vnd) {
            $vndWos = $wos->where('vendor_company_id', $vnd->id);
            $vndBastps = $bastps->whereIn('work_order_id', $vndWos->pluck('id')->all());
            $running = $vndWos->whereIn('status', ['ISSUED', 'IN_PROGRESS']);

            $total = $vndWos->count();
            $completed = $vndWos->where('status', 'COMPLETED')->count();
            $cancelled = $vndWos->where('status', 'CANCELLED')->count();
            $effective = $total - $cancelled;
            $revisions = max(0, (int) ($vndBastps->sum('round') - $vndBastps->count()));
            $rejected = $running->merge($vndWos->where('status', 'COMPLETED'))->sum(fn ($w) => ($progress[$w->id] ?? collect())->where('status', 'REJECTED')->count());

            $verified = $running->map(fn ($w) => (float) (($progress[$w->id] ?? collect())->where('status', 'VERIFIED')->max('cumulative_percent') ?? 0));
            $stale = $running->filter(function ($w) use ($progress, $cfg) {
                $last = ($progress[$w->id] ?? collect())->max('submitted_at') ?? $w->issued_at;

                return $last === null || now()->diffInDays($last, true) > $cfg['stale_days'];
            })->count();
            $days = $vndWos->where('status', 'COMPLETED')->filter(fn ($w) => $w->issued_at && $w->completed_at)->map(fn ($w) => max(0, Carbon::parse($w->issued_at)->diffInDays(Carbon::parse($w->completed_at), true)));

            $late = $vndWos->where('status', 'COMPLETED')->filter(fn ($w) => $w->target_date !== null && $w->completed_at !== null && Carbon::parse($w->completed_at)->setTimezone($tz)->toDateString() > $w->target_date);
            $onTime = $vndWos->where('status', 'COMPLETED')->filter(fn ($w) => $w->target_date !== null && $w->completed_at !== null)->count() - $late->count();
            $overdue = $running->filter(fn ($w) => $w->target_date !== null && $w->target_date < $today->toDateString());
            $timelyBasis = $onTime + $late->count() + $overdue->count();
            $delays = $late->map(fn ($w) => Carbon::parse($w->target_date, $tz)->diffInDays(Carbon::parse($w->completed_at)->setTimezone($tz)->startOfDay(), true))
                ->merge($overdue->map(fn ($w) => Carbon::parse($w->target_date, $tz)->diffInDays($today, true)));

            $completion = $effective > 0 ? $completed / $effective : null;
            $timeliness = $timelyBasis > 0 ? $onTime / $timelyBasis : null;
            $quality = $effective > 0 ? max(0, 1 - $revisions / $effective) : null;
            $discipline = $running->count() > 0 ? 1 - $stale / $running->count() : null;
            $weights = [[$cfg['weight_completion'], $completion], [$cfg['weight_timeliness'], $timeliness], [$cfg['weight_quality'], $quality], [$cfg['weight_discipline'], $discipline]];
            $used = array_filter($weights, fn ($x) => $x[1] !== null && $x[0] > 0);
            $score = $effective > 0 && $used ? round(100 * array_sum(array_map(fn ($x) => $x[0] * $x[1], $used)) / array_sum(array_map(fn ($x) => $x[0], $used))) : null;

            $rows[] = [
                'vendor_id' => $vnd->id,
                'vendor_code' => $vnd->code,
                'vendor_name' => $vnd->name,
                'total_wo' => $total,
                'completed_wo' => $completed,
                'in_progress_wo' => $running->count(),
                'cancelled_wo' => $cancelled,
                'bastp_revision_count' => $revisions,
                'completion_rate' => $total > 0 ? (float) round(($completed / $total) * 100, 1) : 0.0,
                'avg_progress' => $verified->isEmpty() ? null : round($verified->avg(), 1),
                'stale_wo' => $stale,
                'rejected_progress' => (int) $rejected,
                'avg_days_to_complete' => $days->isEmpty() ? null : round($days->avg(), 1),
                'on_time_wo' => $onTime,
                'late_wo' => $late->count(),
                'overdue_wo' => $overdue->count(),
                'on_time_rate' => $timeliness === null ? null : round($timeliness * 100, 1),
                'avg_delay_days' => $delays->isEmpty() ? null : round($delays->avg(), 1),
                'score' => $score,
                'rating' => $score === null ? null : ($score >= $cfg['good_min'] ? 'BAIK' : ($score >= $cfg['fair_min'] ? 'CUKUP' : 'PERLU_PEMBINAAN')),
            ];
        }
        usort($rows, fn ($x, $y) => [-($x['score'] ?? -1), $x['vendor_name']] <=> [-($y['score'] ?? -1), $y['vendor_name']]);

        return $rows;
    }

    /**
     * Direct Dashboard Summary per Role.
     *
     * @return array<string,mixed>
     */
    public function dashboardSummary(User $actor, ApplicationAuthorizer $authorizer): array
    {
        $vendorCompanyId = VendorService::companyOf($actor);
        if ($vendorCompanyId !== null) {
            $wos = DB::table('work_orders')->where('vendor_company_id', $vendorCompanyId)->get();

            return [
                'role_cluster' => 'vendor',
                'kpis' => [
                    ['key' => 'issued', 'label' => 'SPK Diterima (Siap Kerja)', 'value' => $wos->where('status', 'ISSUED')->count(), 'tone' => 'amber', 'to' => '/work-orders'],
                    ['key' => 'in_progress', 'label' => 'Dalam Pengerjaan', 'value' => $wos->where('status', 'IN_PROGRESS')->count(), 'tone' => 'default', 'to' => '/work-orders'],
                    ['key' => 'completed', 'label' => 'Selesai', 'value' => $wos->where('status', 'COMPLETED')->count(), 'tone' => 'default', 'to' => '/work-orders'],
                ],
                'orders' => $wos->whereIn('status', ['ISSUED', 'IN_PROGRESS'])->take(6)->map(fn ($w) => [
                    'id' => $w->id,
                    'wo_number' => $w->wo_number,
                    'status' => $w->status,
                ])->values()->all(),
            ];
        }

        $scope = $authorizer->scopeFor($actor, 'reports.view');
        $units = $scope['unrestricted'] ? DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('id')->all() : $scope['units'];

        if ($units === []) {
            return ['role_cluster' => 'general', 'kpis' => [], 'orders' => []];
        }

        $overview = $this->overview($units, null, null);
        $appsByStatus = $overview['applications']['by_status'] ?? [];
        $drawingsByStatus = $overview['drawings']['latest_version_by_status'] ?? [];
        $wosByStatus = $overview['work_orders']['by_status'] ?? [];
        $bastpByStatus = $overview['bastp']['by_status'] ?? [];
        $materialRequests = $overview['material_requests'] ?? [];

        return [
            'role_cluster' => 'internal',
            'overview' => $overview,
            'summary_kpis' => [
                'total_applications' => $overview['applications']['total'],
                'draft_applications' => $appsByStatus['DRAFT'] ?? 0,
                'waiting_survey' => max(0, (($appsByStatus['APPROVED'] ?? 0) + ($appsByStatus['PAID'] ?? 0) + ($appsByStatus['PK_PRINTED'] ?? 0)) - ($overview['surveys']['by_status']['ACTIVE'] ?? 0)),
                'active_surveys' => $overview['surveys']['by_status']['ACTIVE'] ?? 0,
                'drawings_under_review' => $drawingsByStatus['UNDER_REVIEW'] ?? 0,
                'drawings_submitted' => $drawingsByStatus['SUBMITTED'] ?? 0,
                'active_work_orders' => ($wosByStatus['ISSUED'] ?? 0) + ($wosByStatus['IN_PROGRESS'] ?? 0),
                'pending_work_orders' => $wosByStatus['SUBMITTED'] ?? 0,
                'bastp_in_review' => ($bastpByStatus['SUBMITTED'] ?? 0) + ($bastpByStatus['ACCEPTED'] ?? 0),
                'material_requests_followup' => $materialRequests['needs_followup'] ?? 0,
                'rab_total_value' => $overview['rab']['total_value'] ?? 0,
            ],
        ];
    }

    /**
     * Critical Stock & Material Buffer Report.
     *
     * Per material over the warehouses of the scoped units (and their UP3): the latest ERP snapshot of each warehouse less what was
     * allocated since. The minimum stock is the average monthly usage of the last configured number of months (handed over per TUG 7, else confirmed allocations),
     * or the ERP safety stock when that is higher; confirmed arrivals (expected within a month) count towards the projected position.
     *
     * @param  list<string>  $units
     * @return array<string,mixed>
     */
    public function criticalStock(array $units): array
    {
        $cfg = app(ReportSettings::class)->get()['stock'];
        $months = (int) $cfg['usage_months'];
        $parents = DB::table('organizational_units')->whereIn('id', $units)->whereNotNull('parent_id')->pluck('parent_id')->all();
        $warehouses = DB::table('warehouses')->where('is_active', true)->whereIn('organizational_unit_id', array_values(array_unique(array_merge($units, $parents))))->pluck('id')->all();
        $today = now(config('distriva.business_timezone'))->toDateString();
        $position = app(StockService::class)->position($warehouses, $today);

        // usage: what was actually handed over (TUG 7 shipments) in the window; a material without any handover falls back to what was allocated
        // The real issues mirrored from MIMS count first; a TUG 7 shipment whose reference is a mirrored reservation is the same issue and is not counted twice.
        $since = now()->subMonths($months);
        $mirrored = DB::table('mims_issue_documents')->whereIn('warehouse_id', $warehouses)->where('issued_on', '>=', $since->toDateString())->distinct()->pluck('reservation_no');
        $fromMims = DB::table('mims_issue_lines as l')->join('khs_material_map as m', 'm.material_no', '=', 'l.material_no')
            ->whereIn('l.warehouse_id', $warehouses)->whereIn('l.reservation_no', $mirrored)
            ->groupBy('m.khs_item_id')->selectRaw('m.khs_item_id, sum(l.quantity) as q')->pluck('q', 'khs_item_id');
        $handedOverTug = DB::table('material_request_shipment_lines as sl')->join('material_request_shipments as s', 's.id', '=', 'sl.shipment_id')
            ->whereIn('sl.warehouse_id', $warehouses)->where('s.sent_at', '>=', $since)->whereNotIn('s.reference', $mirrored)
            ->groupBy('sl.khs_item_id')->selectRaw('sl.khs_item_id, sum(sl.quantity) as q')->pluck('q', 'khs_item_id');
        $handedOver = collect($fromMims)->map(fn ($q) => (float) $q);
        foreach ($handedOverTug as $id => $q) {
            $handedOver[$id] = ($handedOver[$id] ?? 0.0) + (float) $q;
        }
        $allocated = DB::table('allocation_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')
            ->whereNotNull('a.materials_confirmed_at')->where('a.status', '<>', 'CANCELLED')->whereIn('l.warehouse_id', $warehouses)
            ->where('a.materials_confirmed_at', '>=', now()->subMonths($months))
            ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) as q')->pluck('q', 'khs_item_id');
        $usage = $allocated->merge($handedOver);

        $ids = collect(array_keys($position))->merge($usage->keys())->unique()->values()->all();
        $items = DB::table('khs_items as i')->whereIn('i.id', $ids)->orderBy('i.code')->get(['i.id', 'i.code'])->keyBy('id');
        $versions = DB::table('khs_item_versions')->whereIn('khs_item_id', $ids)->orderBy('version_number')->get(['khs_item_id', 'name', 'unit_text'])->keyBy('khs_item_id');
        $asOf = DB::table('stock_snapshots')->whereIn('warehouse_id', $warehouses)->selectRaw('max(as_of) as newest, min(as_of) as oldest')->first();

        $rows = [];
        foreach ($items as $id => $item) {
            $p = $position[$id] ?? ['on_hand' => 0.0, 'reserved' => 0.0, 'incoming' => 0.0, 'safety' => 0.0, 'allocated_after' => 0.0, 'available' => 0.0];
            $monthly = round((float) ($usage[$id] ?? 0) / $months, 3);
            $safety = (float) $p['safety'];
            $min = max($monthly, $safety);
            $available = max(0.0, (float) $p['available']);
            $incoming = (float) $p['incoming'];
            $projected = $available + $incoming;
            if ($min <= 0) {
                $status = 'SAFE';
            } elseif ($projected < $min) {
                $status = 'CRITICAL';
            } elseif ($available < $min || $projected < $min * (float) $cfg['warning_factor']) {
                $status = 'WARNING';
            } else {
                $status = 'SAFE';
            }
            if ($available <= 0 && $min <= 0 && $incoming <= 0 && (float) $p['on_hand'] <= 0) {
                continue;
            }

            $rows[] = [
                'khs_id' => $id,
                'khs_code' => $item->code,
                'khs_name' => $versions[$id]->name ?? $item->code,
                'unit' => $versions[$id]->unit_text ?? '-',
                'on_hand' => (float) $p['on_hand'],
                'reserved' => (float) $p['reserved'] + (float) $p['allocated_after'],
                'available' => $available,
                'monthly_usage' => $monthly,
                'safety_stock' => $safety,
                'min_stock' => $min,
                'min_basis' => $safety > $monthly ? 'SAFETY' : ($monthly > 0 ? 'USAGE' : 'NONE'),
                'incoming' => $incoming,
                'projected' => $projected,
                'shortage' => max(0.0, $min - $projected),
                'months_cover' => $monthly > 0 ? round($available / $monthly, 1) : null,
                'stock_status' => $status,
            ];
        }
        $rank = ['CRITICAL' => 0, 'WARNING' => 1, 'SAFE' => 2];
        usort($rows, fn ($x, $y) => [$rank[$x['stock_status']], -$x['shortage'], $x['khs_code']] <=> [$rank[$y['stock_status']], -$y['shortage'], $y['khs_code']]);

        return [
            'summary' => [
                'total_items' => count($rows),
                'critical_items' => count(array_filter($rows, fn ($r) => $r['stock_status'] === 'CRITICAL')),
                'warning_items' => count(array_filter($rows, fn ($r) => $r['stock_status'] === 'WARNING')),
                'safe_items' => count(array_filter($rows, fn ($r) => $r['stock_status'] === 'SAFE')),
                'warehouses' => count($warehouses),
                'usage_months' => $months,
                'snapshot_newest' => $asOf->newest ?? null,
                'snapshot_oldest' => $asOf->oldest ?? null,
            ],
            'rows' => $rows,
        ];
    }

    /**
     * KKF Feasibility & Revenue Projection Report.
     *
     * @param  list<string>  $units
     * @return array<string,mixed>
     */
    public function kkfFeasibility(array $units, ?string $from, ?string $to): array
    {
        $kkfRuns = DB::table('kkf_runs as k')
            ->join('applications as a', 'a.id', '=', 'k.application_id')
            ->join('organizational_units as u', 'u.id', '=', 'a.organizational_unit_id')
            ->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->leftJoin('rab_runs as r', 'r.id', '=', 'k.rab_run_id')
            ->whereIn('a.organizational_unit_id', $units)
            ->when($from, fn ($q) => $q->whereDate('k.created_at', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('k.created_at', '<=', $to))
            ->selectRaw('distinct on (k.application_id) k.id, k.application_id, a.application_number, u.code as unit_code, u.name as unit_name, c.name as customer_name, a.new_tariff_code, a.new_power_value, a.new_power_unit, r.grand_total as capex_rab, k.feasible, k.extended_required, k.npv, k.irr_percent, k.payback_months, k.result, k.created_at')
            ->orderBy('k.application_id')
            ->orderByDesc('k.run_number')
            ->get();

        $rows = [];
        $totalCapex = 0;
        $totalNpv = 0;
        $paybackList = [];
        $irrList = [];

        foreach ($kkfRuns as $k) {
            $capex = (float) ($k->capex_rab ?? 0);
            $npv = (float) $k->npv;
            $payback = $k->payback_months !== null ? (int) $k->payback_months : null;
            $irr = $k->irr_percent !== null ? (float) $k->irr_percent : null;

            $totalCapex += $capex;
            $totalNpv += $npv;
            if ($payback !== null) {
                $paybackList[] = $payback;
            }
            if ($irr !== null) {
                $irrList[] = $irr;
            }

            $powerStr = ($k->new_tariff_code ? $k->new_tariff_code.' · ' : '').
                ($k->new_power_value !== null ? number_format((float) $k->new_power_value, 0, ',', '.').' '.($k->new_power_unit ?? 'VA') : '-');

            $rows[] = [
                'id' => $k->id,
                'application_number' => $k->application_number,
                'unit_code' => $k->unit_code,
                'unit_name' => $k->unit_name,
                'customer_name' => $k->customer_name,
                'tariff_power' => $powerStr,
                'capex_rab' => $capex,
                'feasible' => (bool) $k->feasible,
                'extended_required' => (bool) $k->extended_required,
                'payback_months' => $payback,
                'payback_years' => $payback !== null ? round($payback / 12, 1) : null,
                'npv' => $npv,
                'irr_percent' => $irr,
                'status_label' => $k->feasible ? 'LAYAK' : 'TIDAK LAYAK',
                'created_at' => substr((string) $k->created_at, 0, 10),
            ];
        }

        $avgPayback = count($paybackList) > 0 ? round(array_sum($paybackList) / count($paybackList), 1) : 0.0;
        $avgIrr = count($irrList) > 0 ? round(array_sum($irrList) / count($irrList), 2) : 0.0;

        return [
            'summary' => [
                'total_applications_with_kkf' => count($rows),
                'feasible_count' => count(array_filter($rows, fn ($r) => $r['feasible'] === true)),
                'not_feasible_count' => count(array_filter($rows, fn ($r) => $r['feasible'] === false)),
                'extended_required_count' => count(array_filter($rows, fn ($r) => $r['extended_required'] === true)),
                'total_capex_rab' => $totalCapex,
                'total_npv' => $totalNpv,
                'average_payback_months' => $avgPayback,
                'average_irr_percent' => $avgIrr,
            ],
            'rows' => $rows,
        ];
    }

    /**
     * ERP MIMS Stock Anomaly & Reconciliation Report.
     *
     * @param  list<string>  $units
     * @return array<string,mixed>
     */
    public function erpAnomalies(array $units): array
    {
        $unmapped = DB::table('stock_snapshot_materials as sm')
            ->join('stock_snapshots as s', 's.id', '=', 'sm.snapshot_id')
            ->join('warehouses as w', 'w.id', '=', 's.warehouse_id')
            ->whereIn('w.organizational_unit_id', $units)
            ->whereNull('sm.khs_item_id')
            ->select('sm.material_no', 'sm.material_name', 'sm.unit', 'sm.stock_ready', 'w.code as warehouse_code', 'w.name as warehouse_name', 's.as_of')
            ->orderBy('sm.material_no')
            ->get();

        $syncFailures = DB::table('stock_sync_runs as r')
            ->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->whereIn('w.organizational_unit_id', $units)
            ->where('r.status', 'FAILED')
            ->orderByDesc('r.started_at')
            ->limit(20)
            ->select('w.code as warehouse_code', 'w.name as warehouse_name', 'r.status', 'r.message', 'r.started_at')
            ->get();

        return [
            'summary' => [
                'unmapped_skus_count' => count($unmapped),
                'unmapped_skus_total_qty' => (float) $unmapped->sum('stock_ready'),
                'recent_sync_failures_count' => count($syncFailures),
            ],
            'unmapped_materials' => $unmapped->all(),
            'sync_failures' => $syncFailures->all(),
        ];
    }

    /** @param list<array<string,mixed>> $sections @return array<string,mixed> */
    public function doc(string $title, array $meta, array $sections): array
    {
        return ['title' => $title, 'header' => (array) config('distriva.document.company'), 'meta' => $meta, 'sections' => $sections, 'place_date' => '', 'signatures' => []];
    }
}
