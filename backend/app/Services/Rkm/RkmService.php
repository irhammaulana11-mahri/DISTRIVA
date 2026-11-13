<?php

namespace App\Services\Rkm;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Inventory\StockService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * RKM (docs/12, docs/62 §31). Callers authorize the actor on the right unit first.
 * net requirement = max(0, gross_demand + safety_stock - available_stock - confirmed_incoming)   (docs/12 §4), per KHS item over the warehouses of the UP3 and its ULPs.
 * gross = sum over the ULP proposals of (planner-adjusted total, else work + pipeline + forecast), minus what DISTRIVA allocations already took out of the available
 * stock for the linked work packages (so the same material is never counted twice: once as demand and once as an allocation).
 */
class RkmService
{
    public const STEPS = ['VALIDATE_PERENCANAAN', 'VALIDATE_KONSTRUKSI', 'APPROVE_UP3_MANAGER'];

    public function __construct(private readonly StockService $stock) {}

    public function createPlan(string $up3UnitId, string $type, string $start, User $actor): array
    {
        $up3 = DB::table('organizational_units')->where('id', $up3UnitId)->first() ?? throw new AssignmentRuleViolation('Unit tidak ditemukan.');
        if ($up3->unit_type !== 'UP3') {
            throw new AssignmentRuleViolation('RKM dibuat pada unit UP3.');
        }
        $s = CarbonImmutable::parse($start);
        $ok = match ($type) {
            'MONTH' => $s->day === 1, 'QUARTER' => $s->day === 1 && in_array($s->month, [1, 4, 7, 10], true), 'SEMESTER' => $s->day === 1 && in_array($s->month, [1, 7], true), 'YEAR' => $s->day === 1 && $s->month === 1, default => false,
        };
        if (! $ok) {
            throw new AssignmentRuleViolation('Awal periode harus tanggal 1 awal bulan/triwulan/semester/tahun yang sesuai.');
        }
        $end = match ($type) {
            'MONTH' => $s->endOfMonth(), 'QUARTER' => $s->addMonths(2)->endOfMonth(), 'SEMESTER' => $s->addMonths(5)->endOfMonth(), default => $s->endOfYear(),
        };
        $ulps = DB::table('organizational_units')->where('parent_id', $up3UnitId)->where('unit_type', 'ULP')->where('is_active', true)->pluck('id');
        if ($ulps->isEmpty()) {
            throw new AssignmentRuleViolation('UP3 belum memiliki ULP aktif.');
        }
        $planId = (string) Str::uuid();
        $versionId = (string) Str::uuid();
        try {
            DB::transaction(function () use ($planId, $versionId, $up3, $type, $s, $end, $ulps, $actor): void {
                DB::table('rkm_plans')->insert(['id' => $planId, 'up3_unit_id' => $up3->id, 'period_type' => $type, 'period_start' => $s->toDateString(), 'period_end' => $end->toDateString(),
                    'plan_number' => "RKM/{$up3->code}/{$type}/".$s->toDateString(), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                DB::table('rkm_versions')->insert(['id' => $versionId, 'plan_id' => $planId, 'version_number' => 1, 'status' => 'COLLECTING', 'round' => 1, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                foreach ($ulps as $ulp) {
                    DB::table('rkm_proposals')->insert(['id' => (string) Str::uuid(), 'version_id' => $versionId, 'ulp_unit_id' => $ulp, 'status' => 'DRAFT', 'created_at' => now(), 'updated_at' => now()]);
                }
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('RKM untuk UP3 dan periode ini sudah ada; gunakan amandemen.', 0, $e) : $e;
        }

        return ['plan_id' => $planId, 'version_id' => $versionId];
    }

    public function amend(string $planId, string $reason, User $actor): string
    {
        return DB::transaction(function () use ($planId, $reason, $actor): string {
            DB::table('rkm_plans')->where('id', $planId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $approved = DB::table('rkm_versions')->where('plan_id', $planId)->where('status', 'APPROVED')->first()
                ?? throw new AssignmentRuleViolation('Amandemen hanya untuk RKM yang sudah disetujui.');
            if (DB::table('rkm_versions')->where('plan_id', $planId)->whereIn('status', ['COLLECTING', 'VALIDATING'])->exists()) {
                throw new AssignmentRuleViolation('Masih ada versi RKM yang berjalan untuk rencana ini.');
            }
            $vid = (string) Str::uuid();
            DB::table('rkm_versions')->insert(['id' => $vid, 'plan_id' => $planId, 'version_number' => ((int) DB::table('rkm_versions')->where('plan_id', $planId)->max('version_number')) + 1, 'status' => 'COLLECTING', 'round' => 1,
                'amendment_reason' => trim($reason), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (DB::table('rkm_proposals')->where('version_id', $approved->id)->get() as $p) {
                $pid = (string) Str::uuid();
                DB::table('rkm_proposals')->insert(['id' => $pid, 'version_id' => $vid, 'ulp_unit_id' => $p->ulp_unit_id, 'status' => 'DRAFT', 'created_at' => now(), 'updated_at' => now()]);
                foreach (DB::table('rkm_lines')->where('proposal_id', $p->id)->get() as $l) {
                    DB::table('rkm_lines')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $pid, 'khs_item_id' => $l->khs_item_id, 'qty_work' => $l->qty_work, 'qty_pipeline' => $l->qty_pipeline, 'qty_forecast' => $l->qty_forecast, 'note' => $l->note]);
                }
                foreach (DB::table('rkm_proposal_packages')->where('proposal_id', $p->id)->get() as $pp) {
                    DB::table('rkm_proposal_packages')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $pid, 'mto_package_id' => $pp->mto_package_id]);
                }
            }

            return $vid;
        });
    }

    /** @param list<string> $packageIds */
    public function setPackages(string $proposalId, array $packageIds): void
    {
        DB::transaction(function () use ($proposalId, $packageIds): void {
            $p = $this->openProposal($proposalId);
            $errs = [];
            foreach ($packageIds as $pk) {
                $pkg = DB::table('mto_packages as m')->join('applications as a', 'a.id', '=', 'm.application_id')->where('m.id', $pk)->first(['m.id', 'm.status', 'a.organizational_unit_id', 'a.application_number']);
                if ($pkg === null || $pkg->status !== 'APPROVED' || $pkg->organizational_unit_id !== $p->ulp_unit_id) {
                    $errs[] = "Paket MTO {$pk} tidak ditemukan, belum disetujui, atau bukan milik ULP ini.";

                    continue;
                }
                $taken = DB::table('rkm_proposal_packages as pp')->join('rkm_proposals as pr', 'pr.id', '=', 'pp.proposal_id')->join('rkm_versions as v', 'v.id', '=', 'pr.version_id')
                    ->where('pp.mto_package_id', $pk)->where('pr.id', '<>', $proposalId)->whereIn('v.status', ['COLLECTING', 'VALIDATING', 'APPROVED'])->exists();
                if ($taken) {
                    $errs[] = "Paket MTO permohonan {$pkg->application_number} sudah termuat pada RKM lain.";
                }
            }
            if ($errs !== []) {
                throw new AssignmentRuleViolation(implode(' ', $errs));
            }
            DB::table('rkm_proposal_packages')->where('proposal_id', $proposalId)->delete();
            foreach (array_unique($packageIds) as $pk) {
                DB::table('rkm_proposal_packages')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $proposalId, 'mto_package_id' => $pk]);
            }
            $work = $packageIds === [] ? collect() : DB::table('mto_lines')->whereIn('package_id', $packageIds)->groupBy('khs_item_id')->selectRaw('khs_item_id, sum(material) q')->pluck('q', 'khs_item_id');
            DB::table('rkm_lines')->where('proposal_id', $proposalId)->update(['qty_work' => 0]);
            foreach ($work as $khs => $q) {
                $line = DB::table('rkm_lines')->where('proposal_id', $proposalId)->where('khs_item_id', $khs)->first();
                $line === null
                    ? DB::table('rkm_lines')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $proposalId, 'khs_item_id' => $khs, 'qty_work' => $q])
                    : DB::table('rkm_lines')->where('id', $line->id)->update(['qty_work' => $q]);
            }
            $this->pruneEmpty($proposalId);
        });
    }

    /** @param list<array{khs_code:string,qty_pipeline?:numeric,qty_forecast?:numeric,note?:?string}> $lines */
    public function putLines(string $proposalId, array $lines, User $actor): void
    {
        DB::transaction(function () use ($proposalId, $lines, $actor): void {
            $this->openProposal($proposalId);
            $codes = array_column($lines, 'khs_code');
            if (count($codes) !== count(array_unique($codes))) {
                throw new AssignmentRuleViolation('Kode KHS muncul lebih dari sekali.');
            }
            $items = DB::table('khs_items')->whereIn('code', $codes)->pluck('id', 'code');
            $missing = array_diff($codes, $items->keys()->all());
            if ($missing !== []) {
                throw new AssignmentRuleViolation('Kode KHS tidak ada: '.implode(', ', array_slice($missing, 0, 10)).'.');
            }
            DB::table('rkm_lines')->where('proposal_id', $proposalId)->update(['qty_pipeline' => 0, 'qty_forecast' => 0, 'note' => null]);
            foreach ($lines as $l) {
                $khs = $items[$l['khs_code']];
                $vals = ['qty_pipeline' => (float) ($l['qty_pipeline'] ?? 0), 'qty_forecast' => (float) ($l['qty_forecast'] ?? 0), 'note' => $l['note'] ?? null];
                $row = DB::table('rkm_lines')->where('proposal_id', $proposalId)->where('khs_item_id', $khs)->first();
                $row === null ? DB::table('rkm_lines')->insert(['id' => (string) Str::uuid(), 'proposal_id' => $proposalId, 'khs_item_id' => $khs] + $vals) : DB::table('rkm_lines')->where('id', $row->id)->update($vals);
            }
            $this->pruneEmpty($proposalId);
            DB::table('rkm_proposals')->where('id', $proposalId)->update(['prepared_by' => $actor->getKey(), 'updated_at' => now()]);
        });
    }

    public function submit(string $proposalId, User $actor): void
    {
        DB::transaction(function () use ($proposalId, $actor): void {
            $this->openProposal($proposalId);
            if (! DB::table('rkm_lines')->where('proposal_id', $proposalId)->exists()) {
                throw new AssignmentRuleViolation('Usulan belum memiliki baris kebutuhan.');
            }
            DB::table('rkm_proposals')->where('id', $proposalId)->update(['status' => 'SUBMITTED', 'submitted_by' => $actor->getKey(), 'submitted_at' => now(), 'return_reason' => null, 'updated_at' => now()]);
        });
    }

    public function startValidation(string $versionId): void
    {
        DB::transaction(function () use ($versionId): void {
            $v = $this->version($versionId);
            if ($v->status !== 'COLLECTING') {
                throw new AssignmentRuleViolation('Validasi hanya dapat dimulai dari status COLLECTING.');
            }
            $open = DB::table('rkm_proposals as p')->join('organizational_units as u', 'u.id', '=', 'p.ulp_unit_id')->where('p.version_id', $versionId)->where('p.status', '<>', 'SUBMITTED')->pluck('u.name');
            if ($open->isNotEmpty()) {
                throw new AssignmentRuleViolation('Usulan ULP belum diajukan: '.$open->implode(', ').'.');
            }
            DB::table('rkm_versions')->where('id', $versionId)->update(['status' => 'VALIDATING', 'validation_started_at' => now(), 'updated_at' => now()]);
        });
    }

    public function adjust(string $versionId, string $proposalId, string $khsCode, float $qty, string $reason, User $actor): void
    {
        DB::transaction(function () use ($versionId, $proposalId, $khsCode, $qty, $reason, $actor): void {
            $v = $this->version($versionId);
            if ($v->status !== 'VALIDATING') {
                throw new AssignmentRuleViolation('Kuantitas hanya dapat disesuaikan saat validasi.');
            }
            if (DB::table('rkm_decisions')->where('version_id', $versionId)->where('round', $v->round)->exists()) {
                throw new AssignmentRuleViolation('Sudah ada keputusan pada putaran ini; penyesuaian akan membuat validasi tidak lagi berlaku untuk versi yang sama. Kembalikan versi dulu.');
            }
            $line = DB::table('rkm_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->join('rkm_proposals as p', 'p.id', '=', 'l.proposal_id')->where('p.version_id', $versionId)->where('l.proposal_id', $proposalId)->where('k.code', $khsCode)
                ->first(['l.*']) ?? throw new AssignmentRuleViolation("KHS {$khsCode} tidak ada pada usulan ini.");
            $before = $line->qty_validated !== null ? (float) $line->qty_validated : (float) $line->qty_work + (float) $line->qty_pipeline + (float) $line->qty_forecast;
            DB::table('rkm_lines')->where('id', $line->id)->update(['qty_validated' => $qty]);
            DB::table('rkm_adjustments')->insert(['id' => (string) Str::uuid(), 'version_id' => $versionId, 'proposal_id' => $proposalId, 'khs_item_id' => $line->khs_item_id, 'before_qty' => $before, 'after_qty' => $qty, 'reason' => trim($reason), 'actor_user_id' => $actor->getKey(), 'occurred_at' => now()]);
        });
    }

    /** @param string $role the role name the actor used for this step (kept in the history) */
    public function decide(string $versionId, string $step, string $decision, ?string $notes, User $actor, string $role): void
    {
        try {
            DB::transaction(function () use ($versionId, $step, $decision, $notes, $actor, $role): void {
                $v = $this->version($versionId);
                if ($v->status !== 'VALIDATING') {
                    throw new AssignmentRuleViolation('Keputusan hanya dapat diberikan saat versi berstatus VALIDATING.');
                }
                if ($decision !== 'APPROVED' && trim((string) $notes) === '') {
                    throw new AssignmentRuleViolation('Pengembalian atau penolakan wajib disertai alasan.');
                }
                $done = DB::table('rkm_decisions')->where('version_id', $versionId)->where('round', $v->round)->get();
                if ($done->contains('step', $step)) {
                    throw new AssignmentRuleViolation('Langkah ini sudah diputuskan pada putaran ini.');
                }
                if ($done->contains('decided_by', $actor->getKey())) {
                    throw new AssignmentRuleViolation('Satu pengguna hanya dapat memberi satu keputusan pada satu versi dalam satu putaran.');
                }
                if ($step === 'APPROVE_UP3_MANAGER') {
                    $validated = $done->where('decision', 'APPROVED')->pluck('step')->all();
                    if (! in_array('VALIDATE_PERENCANAAN', $validated, true) || ! in_array('VALIDATE_KONSTRUKSI', $validated, true)) {
                        throw new AssignmentRuleViolation('Persetujuan akhir menunggu validasi PERENCANAAN dan KONSTRUKSI_UP3 pada versi yang sama.');
                    }
                    if (DB::table('rkm_proposals')->where('version_id', $versionId)->where('submitted_by', $actor->getKey())->exists() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pengaju usulan tidak dapat menjadi penyetuju akhir versinya.', 403);
                    }
                }
                DB::table('rkm_decisions')->insert(['id' => (string) Str::uuid(), 'version_id' => $versionId, 'round' => $v->round, 'step' => $step, 'decision' => $decision, 'decided_by' => $actor->getKey(), 'decided_role' => $role, 'notes' => $notes, 'decided_at' => now()]);

                if ($decision === 'RETURNED') {
                    DB::table('rkm_versions')->where('id', $versionId)->update(['status' => 'COLLECTING', 'round' => $v->round + 1, 'updated_at' => now()]);
                    DB::table('rkm_proposals')->where('version_id', $versionId)->update(['status' => 'DRAFT', 'return_reason' => trim((string) $notes), 'updated_at' => now()]);
                    DB::table('rkm_lines')->whereIn('proposal_id', DB::table('rkm_proposals')->where('version_id', $versionId)->select('id'))->update(['qty_validated' => null]);

                    return;
                }
                if ($decision === 'REJECTED') {
                    DB::table('rkm_versions')->where('id', $versionId)->update(['status' => 'REJECTED', 'updated_at' => now()]);

                    return;
                }
                if ($step === 'APPROVE_UP3_MANAGER') {
                    $snapshot = $this->requirements($versionId);
                    DB::table('rkm_versions')->where('plan_id', $v->plan_id)->where('status', 'APPROVED')->update(['status' => 'SUPERSEDED', 'updated_at' => now()]);
                    DB::table('rkm_versions')->where('id', $versionId)->update(['status' => 'APPROVED', 'approved_at' => now(), 'snapshot' => json_encode($snapshot), 'snapshot_hash' => hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR)), 'updated_at' => now()]);
                }
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23505' => new AssignmentRuleViolation('Keputusan ini bentrok dengan keputusan yang sudah ada pada putaran ini.', 0, $e),
                default => $e,
            };
        }
    }

    /**
     * The consolidated requirement of a version (live; frozen into the snapshot at approval).
     *
     * @return array<string,mixed>
     */
    public function requirements(string $versionId, ?string $date = null): array
    {
        $v = $this->version($versionId);
        $plan = DB::table('rkm_plans')->where('id', $v->plan_id)->first();
        $date ??= now(config('distriva.business_timezone'))->toDateString();
        $proposals = DB::table('rkm_proposals as p')->join('organizational_units as u', 'u.id', '=', 'p.ulp_unit_id')->where('p.version_id', $versionId)->get(['p.id', 'p.ulp_unit_id', 'u.code', 'u.name']);
        $lines = DB::table('rkm_lines')->whereIn('proposal_id', $proposals->pluck('id'))->get();
        $linked = DB::table('rkm_proposal_packages')->whereIn('proposal_id', $proposals->pluck('id'))->pluck('mto_package_id');
        $apps = $linked->isEmpty() ? collect() : DB::table('mto_packages')->whereIn('id', $linked)->pluck('application_id');
        $alloc = $apps->isEmpty() ? collect() : DB::table('allocation_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->whereIn('a.application_id', $apps)->whereNotNull('a.materials_confirmed_at')->where('a.status', '<>', 'CANCELLED')
            ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) q')->pluck('q', 'khs_item_id');
        $units = DB::table('organizational_units')->where(fn ($q) => $q->where('id', $plan->up3_unit_id)->orWhere('parent_id', $plan->up3_unit_id))->pluck('id');
        $stock = $this->stock->position(DB::table('warehouses')->whereIn('organizational_unit_id', $units)->where('is_active', true)->pluck('id')->all(), $date);
        $codes = DB::table('khs_items')->whereIn('id', $lines->pluck('khs_item_id')->merge(array_keys($stock))->unique())->pluck('code', 'id');

        $by = [];
        foreach ($lines as $l) {
            $r = &$by[$l->khs_item_id];
            $r ??= ['work' => 0.0, 'pipeline' => 0.0, 'forecast' => 0.0, 'adjusted_total' => 0.0, 'total' => 0.0, 'per_ulp' => []];
            $raw = (float) $l->qty_work + (float) $l->qty_pipeline + (float) $l->qty_forecast;
            $tot = $l->qty_validated !== null ? (float) $l->qty_validated : $raw;
            $r['work'] += (float) $l->qty_work;
            $r['pipeline'] += (float) $l->qty_pipeline;
            $r['forecast'] += (float) $l->qty_forecast;
            $r['total'] += $tot;
            $r['adjusted_total'] += $l->qty_validated !== null ? $tot - $raw : 0.0;
            $r['per_ulp'][$proposals->firstWhere('id', $l->proposal_id)->code] = $tot;
            unset($r);
        }
        $rows = [];
        foreach (collect($by)->keys()->merge(array_keys($stock))->unique() as $khs) {
            $g = $by[$khs] ?? ['work' => 0.0, 'pipeline' => 0.0, 'forecast' => 0.0, 'adjusted_total' => 0.0, 'total' => 0.0, 'per_ulp' => []];
            $s = $stock[$khs] ?? ['on_hand' => 0.0, 'reserved' => 0.0, 'incoming' => 0.0, 'safety' => 0.0, 'allocated_after' => 0.0, 'available' => 0.0];
            $allocated = (float) ($alloc[$khs] ?? 0);
            $gross = max(0.0, $g['total'] - $allocated);
            $rows[] = ['khs_code' => (string) $codes[$khs], 'work' => $g['work'], 'pipeline' => $g['pipeline'], 'forecast' => $g['forecast'], 'planner_adjustment' => $g['adjusted_total'], 'gross_total' => $g['total'],
                'already_allocated' => $allocated, 'gross_demand' => $gross, 'stock' => $s, 'net_requirement' => max(0.0, $gross + $s['safety'] - max(0.0, $s['available']) - ($s['kr_supply'] ?? 0.0) - $s['incoming']), 'per_ulp' => $g['per_ulp']];
        }
        usort($rows, fn ($a, $b) => (int) $a['khs_code'] <=> (int) $b['khs_code']);

        return ['version_id' => $versionId, 'stock_date' => $date, 'formula' => 'net = max(0, gross_demand + safety - available - incoming); gross_demand = proposals - already allocated to the linked work', 'rows' => $rows];
    }

    private function version(string $id): object
    {
        return DB::table('rkm_versions')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** A DRAFT proposal of a COLLECTING version, locked. */
    private function openProposal(string $id): object
    {
        $p = DB::table('rkm_proposals')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $v = $this->version($p->version_id);
        if ($v->status !== 'COLLECTING' || $p->status !== 'DRAFT') {
            throw new AssignmentRuleViolation('Usulan hanya dapat diubah saat versi COLLECTING dan usulan belum diajukan.');
        }

        return $p;
    }

    private function pruneEmpty(string $proposalId): void
    {
        DB::table('rkm_lines')->where('proposal_id', $proposalId)->where('qty_work', 0)->where('qty_pipeline', 0)->where('qty_forecast', 0)->whereNull('qty_validated')->delete();
    }
}
