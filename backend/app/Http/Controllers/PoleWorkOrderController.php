<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\UnitFilter;
use App\Services\Documents\DocumentService;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\WorkOrders\PoleWorkOrderService;
use App\Services\WorkOrders\VendorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * WO Tiang (owner 12 Nov 2026). Internal actors act through keys on the UP3 of the WO (`pole_wo.manage` PERENCANAAN, `pole_wo.close` ASMAN_PERENCANAAN); the pole vendor only through
 * the persisted relation account -> company -> the company of an ISSUED/IN_PROGRESS/COMPLETED pole WO. Violations -> 409, authorization -> 403/404.
 */
class PoleWorkOrderController extends Controller
{
    private const VENDOR_VISIBLE = ['ISSUED', 'IN_PROGRESS', 'COMPLETED'];

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly PoleWorkOrderService $orders, private readonly DocumentService $documents, private readonly WorkflowNotifier $flow) {}

    /** GET /pole-work-orders/candidates — pole lines (confirmed poles part) that can still be put on a letter, within the caller's UP3 scope. */
    public function candidates(Request $request): JsonResponse
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'pole_wo.manage');

        return response()->json(['data' => $this->orders->candidates($scope['unrestricted'] ? null : $scope['units'])]);
    }

    public function create(Request $request): JsonResponse
    {
        $d = $this->payload($request);
        $this->internalOnUnits($request, 'pole_wo.manage', $this->unitsOfLines($d['line_ids']));

        return response()->json(['data' => ['id' => $this->orders->create($d['letter_number'], $d['letter_date'], $d['vendor_company_id'] ?? null, $d['notes'] ?? null, $d['line_ids'], $request->user(), $d['line_meta'] ?? [])]], 201);
    }

    public function update(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $d = $this->payload($request);
        $this->internalOnUnits($request, 'pole_wo.manage', $this->unitsOfLines($d['line_ids']));
        $this->orders->update($wo, $d['letter_number'], $d['letter_date'], $d['vendor_company_id'] ?? null, $d['notes'] ?? null, $d['line_ids'], $request->user(), $d['line_meta'] ?? []);

        return response()->json(['message' => 'WO Tiang diperbarui.']);
    }

    public function issue(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $this->orders->issue($wo, $request->user());
        $this->flow->poleWoIssued($wo, $request->user());

        return response()->json(['message' => 'WO Tiang diterbitkan.']);
    }

    /** POST /pole-work-orders/{wo}/amend — revision of an issued pole WO: same letter number, changed location lines. */
    public function amend(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000'], 'line_ids' => ['required', 'array', 'min:1', 'max:200'], 'line_ids.*' => ['uuid'],
            'line_meta' => ['nullable', 'array'], 'line_meta.*.condition' => ['nullable', 'in:BARU,BEKAS,RELOKASI'], 'line_meta.*.note' => ['nullable', 'string', 'max:255']])->validate();
        $this->internalOnUnits($request, 'pole_wo.manage', $this->unitsOfLines($d['line_ids']));
        $rev = $this->orders->amend($wo, $d['reason'], $d['line_ids'], $d['line_meta'] ?? [], $request->user());
        $this->flow->poleWoRevised($wo, $rev, $d['reason'], $request->user());

        return response()->json(['message' => "WO Tiang direvisi (revisi {$rev}).", 'data' => ['revision_number' => $rev]]);
    }

    public function cancel(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:1000']])->validate();
        $this->orders->cancel($wo, $d['reason'], $request->user());
        $this->flow->poleWoCancelled($wo, $d['reason'], $request->user());

        return response()->json(['message' => 'WO Tiang dibatalkan.']);
    }

    /** POST /pole-work-orders/{wo}/letter — optional scan of the request letter (PDF/image, 5 MB). */
    public function uploadLetter(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $request->validate(['file' => ['required', 'file', 'max:5120', 'mimes:pdf,jpg,jpeg,png']]);
        $file = $request->file('file');
        $key = 'pole-wo-letters/'.$wo.'/'.Str::uuid().'.'.strtolower($file->getClientOriginalExtension());
        Storage::disk($this->documents->disk())->put($key, $file->getContent());
        $old = $this->orders->attachLetter($wo, $key, mb_substr($file->getClientOriginalName(), 0, 250), $request->user());
        if ($old !== null) {
            Storage::disk($this->documents->disk())->delete($old);
        }

        return response()->json(['message' => 'Lampiran surat disimpan.'], 201);
    }

    public function letter(Request $request, string $wo)
    {
        $w = $this->visible($request, $wo);
        $w->letter_key !== null || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $disk = Storage::disk($this->documents->disk());
        $disk->exists($w->letter_key) || throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return $disk->download($w->letter_key, $w->letter_name ?? 'surat-permintaan');
    }

    public function submitProgress(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $actor = $request->user();
        $company = VendorService::companyOf($actor);
        if ($company === null) {
            throw new AdministrationDenied('Progres WO Tiang hanya dilaporkan oleh pabrikan tiang (akun vendor); Perencanaan memverifikasinya.', 403);
        }
        if ($w->vendor_company_id !== $company) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $d = Validator::make($request->all(), ['line_id' => ['required', 'uuid'], 'submission_key' => ['required', 'string', 'max:80'], 'cumulative_percent' => ['required', 'numeric', 'min:0', 'max:100'],
            'work_date' => ['required', 'date', 'before_or_equal:today'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $r = $this->orders->submitProgress($wo, $d['line_id'], $d['submission_key'], (float) $d['cumulative_percent'], $d['work_date'], $d['notes'] ?? null, $actor);
        if (! $r['replayed']) {
            $this->flow->poleProgressSubmitted($wo, $actor);
        }

        return response()->json(['data' => ['id' => $r['id']], 'replayed' => $r['replayed']], $r['replayed'] ? 200 : 201);
    }

    public function decideProgress(Request $request, string $progress): JsonResponse
    {
        $p = DB::table('pole_wo_progress')->where('id', $progress)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $w = $this->find($p->pole_work_order_id);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $d = Validator::make($request->all(), ['decision' => ['required', 'in:VERIFIED,RETURNED'], 'reason' => ['nullable', 'string', 'max:2000']])->validate();
        $this->orders->decideProgress($progress, $d['decision'], $d['reason'] ?? null, $request->user());
        $this->flow->poleProgressDecided($progress, $d['decision'], $d['reason'] ?? null, $request->user());

        return response()->json(['message' => 'Keputusan progres dicatat.']);
    }

    public function prepareBastp(Request $request, string $wo): JsonResponse
    {
        $w = $this->find($wo);
        $this->internalOnWo($request, 'pole_wo.manage', $w);
        $d = Validator::make($request->all(), ['bastp_number' => ['required', 'string', 'max:120'], 'bastp_date' => ['required', 'date'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();

        $id = $this->orders->prepareBastp($wo, $d['bastp_number'], $d['bastp_date'], $d['notes'] ?? null, $request->user());
        $this->flow->poleBastpSubmitted($wo, $request->user());

        return response()->json(['data' => ['id' => $id]], 201);
    }

    public function decideBastp(Request $request, string $bastp): JsonResponse
    {
        $b = DB::table('pole_wo_bastp')->where('id', $bastp)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $w = $this->find($b->pole_work_order_id);
        $this->internalOnWo($request, 'pole_wo.close', $w);
        $d = Validator::make($request->all(), ['decision' => ['required', 'in:CLOSE,RETURN'], 'reason' => ['nullable', 'string', 'max:2000']])->validate();
        $this->orders->decideBastp($bastp, $d['decision'], $d['reason'] ?? null, $request->user());
        $this->flow->poleBastpDecided($bastp, $d['decision'], $d['reason'] ?? null, $request->user());

        return response()->json(['message' => $d['decision'] === 'CLOSE' ? 'BASTP tiang ditutup; WO Tiang selesai.' : 'BASTP tiang dikembalikan.']);
    }

    /** GET /pole-work-orders — internal: by UP3 scope; vendor: the ISSUED/IN_PROGRESS/COMPLETED orders of its own company. */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();
        $q = DB::table('pole_work_orders as w')->join('vendor_companies as v', 'v.id', '=', 'w.vendor_company_id')->orderByDesc('w.created_at');
        $company = VendorService::companyOf($actor);
        if ($company !== null) {
            $q->where('w.vendor_company_id', $company)->whereIn('w.status', self::VENDOR_VISIBLE);
        } else {
            $scope = $this->authorizer->authorizeScope($actor, 'pole_wo.view');
            if (! $scope['unrestricted']) {
                $q->whereExists(fn ($s) => $s->select(DB::raw(1))->from('pole_wo_lines as pl')->join('applications as pa', 'pa.id', '=', 'pl.application_id')->whereColumn('pl.pole_work_order_id', 'w.id')->whereIn('pa.organizational_unit_id', $scope['units']));
            }
        }
        $request->validate(UnitFilter::rules());
        if ($request->filled('unit_id') || $request->filled('up3_id')) {
            $q->whereExists(function ($s) use ($request) {
                $s->select(DB::raw(1))->from('pole_wo_lines as fl')->join('applications as fa', 'fa.id', '=', 'fl.application_id')->whereColumn('fl.pole_work_order_id', 'w.id');
                UnitFilter::apply($s, $request, 'fa.organizational_unit_id');
            });
        }
        $rows = $q->get(['w.id', 'w.letter_number', 'w.letter_date', 'w.status', 'w.vendor_company_id', 'v.name as vendor_name', 'w.created_at']);
        $count = DB::table('pole_wo_lines')->whereIn('pole_work_order_id', $rows->pluck('id'))->selectRaw('pole_work_order_id, count(distinct application_id) apps, sum(quantity) poles')->groupBy('pole_work_order_id')->get()->keyBy('pole_work_order_id');

        return response()->json(['data' => $rows->map(fn ($w) => (array) $w + ['locations' => (int) ($count[$w->id]->apps ?? 0), 'poles' => (int) ($count[$w->id]->poles ?? 0)])->all()]);
    }

    public function show(Request $request, string $wo): JsonResponse
    {
        $w = $this->visible($request, $wo);
        $vendor = VendorService::companyOf($request->user()) !== null;
        $lines = DB::table('pole_wo_lines as l')->join('applications as a', 'a.id', '=', 'l.application_id')->join('pole_contracts as c', 'c.id', '=', 'l.pole_contract_id')->leftJoin('customers as cu', 'cu.id', '=', 'a.customer_id')
            ->leftJoin('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.pole_work_order_id', $wo)->orderBy('a.application_number')->orderBy('c.kr_number')->orderBy('l.pole_type')->orderBy('l.id')
            ->get(['l.id', 'l.allocation_pole_line_id', 'l.application_id', 'a.application_number', 'cu.name as customer_name', 'c.kr_number', 'c.vendor_company_id as kr_vendor_id', 'l.pole_condition', 'l.origin_note', 'l.pole_type', 'l.quantity', 'k.code as khs_code']);
        $progress = DB::table('pole_wo_progress as p')->join('users as u', 'u.id', '=', 'p.submitted_by')->where('p.pole_work_order_id', $wo)->orderBy('p.submitted_at')->get(['p.*', 'u.name as submitted_by_name']);
        $bastp = DB::table('pole_wo_bastp as b')->join('users as u', 'u.id', '=', 'b.prepared_by')->where('b.pole_work_order_id', $wo)->orderBy('b.created_at')->get(['b.*', 'u.name as prepared_by_name']);
        $events = $vendor ? collect() : DB::table('pole_wo_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.pole_work_order_id', $wo)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.details', 'e.occurred_at', 'u.name as actor_name']);
        $revisions = DB::table('pole_wo_revisions as r')->join('users as u', 'u.id', '=', 'r.actor_user_id')->where('r.pole_work_order_id', $wo)->orderBy('r.revision_number')->get(['r.revision_number', 'r.reason', 'r.added', 'r.removed', 'r.changed', 'r.created_at', 'u.name as actor_name']);
        $vendorRow = DB::table('vendor_companies')->where('id', $w->vendor_company_id)->first(['name', 'code']);

        return response()->json(['data' => [
            'id' => $w->id, 'letter_number' => $w->letter_number, 'letter_date' => $w->letter_date, 'up3_unit_id' => $w->up3_unit_id, 'status' => $w->status, 'notes' => $w->notes, 'vendor_company_id' => $w->vendor_company_id,
            'revision_number' => (int) $w->revision_number, 'vendor_name' => $vendorRow->name ?? null, 'vendor_code' => $vendorRow->code ?? null, 'has_letter' => $w->letter_key !== null, 'letter_name' => $w->letter_name, 'issued_at' => $w->issued_at, 'completed_at' => $w->completed_at, 'cancel_reason' => $w->cancel_reason,
            'lines' => $lines->map(fn ($l) => ['id' => $l->id, 'allocation_pole_line_id' => $l->allocation_pole_line_id, 'application_id' => $l->application_id, 'application_number' => $l->application_number, 'customer_name' => $l->customer_name, 'kr_number' => $l->kr_number, 'kr_vendor_id' => $l->kr_vendor_id, 'pole_condition' => $l->pole_condition, 'origin_note' => $l->origin_note, 'pole_type' => $l->pole_type,
                'quantity' => (int) $l->quantity, 'khs_code' => $l->khs_code, 'verified_percent' => $this->orders->verifiedPercent($l->id)])->all(),
            'progress' => $progress->map(fn ($p) => ['id' => $p->id, 'line_id' => $p->line_id, 'cumulative_percent' => (float) $p->cumulative_percent, 'work_date' => $p->work_date, 'status' => $p->status, 'notes' => $p->notes,
                'submitted_by_name' => $p->submitted_by_name, 'submitted_at' => $p->submitted_at, 'decided_at' => $p->decided_at, 'return_reason' => $p->return_reason])->all(),
            'revisions' => $revisions->map(fn ($r) => ['revision_number' => (int) $r->revision_number, 'reason' => $r->reason, 'added' => (int) $r->added, 'removed' => (int) $r->removed, 'changed' => (int) $r->changed, 'created_at' => $r->created_at, 'actor_name' => $r->actor_name])->all(),
            'bastp' => $bastp->map(fn ($b) => ['id' => $b->id, 'bastp_number' => $b->bastp_number, 'bastp_date' => $b->bastp_date, 'status' => $b->status, 'notes' => $b->notes, 'prepared_by_name' => $b->prepared_by_name, 'decided_at' => $b->decided_at, 'return_reason' => $b->return_reason])->all(),
            'events' => $events->map(fn ($e) => ['event_type' => $e->event_type, 'reason' => $e->reason, 'details' => json_decode((string) $e->details, true), 'occurred_at' => $e->occurred_at, 'actor_name' => $e->actor_name])->all(),
        ]]);
    }

    /** @return array<string,mixed> */
    private function payload(Request $request): array
    {
        return Validator::make($request->all(), ['letter_number' => ['required', 'string', 'max:120'], 'letter_date' => ['required', 'date'], 'vendor_company_id' => ['nullable', 'uuid'], 'notes' => ['nullable', 'string', 'max:2000'],
            'line_ids' => ['required', 'array', 'min:1', 'max:200'], 'line_ids.*' => ['uuid'],
            'line_meta' => ['nullable', 'array'], 'line_meta.*.condition' => ['nullable', 'in:BARU,BEKAS,RELOKASI'], 'line_meta.*.note' => ['nullable', 'string', 'max:255']])->validate();
    }

    /** @param list<string> $lineIds @return list<string> the units of the applications behind the allocation pole lines */
    private function unitsOfLines(array $lineIds): array
    {
        $units = DB::table('allocation_pole_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->join('applications as ap', 'ap.id', '=', 'a.application_id')->whereIn('l.id', $lineIds)->distinct()->pluck('ap.organizational_unit_id')->all();

        return $units === [] ? throw new AdministrationDenied('Data tidak ditemukan.', 404) : $units;
    }

    /** @param list<string> $unitIds */
    private function internalOnUnits(Request $request, string $key, array $unitIds): void
    {
        $this->authorizer->authorizeScope($request->user(), $key);
        foreach ($unitIds as $unit) {
            $this->authorizer->authorizeOnUnit($request->user(), $key, $unit);
        }
    }

    private function internalOnWo(Request $request, string $key, object $w): void
    {
        $this->internalOnUnits($request, $key, PoleWorkOrderService::unitsOf($w->id) ?: [(string) $w->up3_unit_id]);
    }

    /** The pole WO as the caller may see it: the vendor only its own company's issued orders, internal actors within their UP3 scope. */
    private function visible(Request $request, string $wo): object
    {
        $w = $this->find($wo);
        $company = VendorService::companyOf($request->user());
        if ($company !== null) {
            if ($w->vendor_company_id !== $company || ! in_array($w->status, self::VENDOR_VISIBLE, true)) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
        } else {
            $scope = $this->authorizer->authorizeScope($request->user(), 'pole_wo.view');
            if (! $scope['unrestricted'] && array_intersect(PoleWorkOrderService::unitsOf($w->id), $scope['units']) === []) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
        }

        return $w;
    }

    private function find(string $id): object
    {
        return DB::table('pole_work_orders')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
