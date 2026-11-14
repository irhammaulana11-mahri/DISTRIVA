<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Documents\DocumentService;
use App\Services\Notifications\WorkflowNotifier;
use App\Services\Output\DocumentDownload;
use App\Services\Output\OutputDocumentService;
use App\Services\WorkOrders\BastpService;
use App\Services\WorkOrders\VendorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\Response;

/**
 * BASTP (docs/62 §36). The preparing/submitting side is the WO's assigned vendor (persisted relation, not a key) or a TEKNIK of the ULP (`bastp.prepare`); the reviewing steps use
 * keys on the application's unit. Every signing step re-confirms the signer's password (electronic signature). Violations -> 409, authorization -> 403/404.
 */
class BastpController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly BastpService $bastp, private readonly DocumentService $documents, private readonly OutputDocumentService $docs, private readonly DocumentDownload $download, private readonly WorkflowNotifier $flow) {}

    public function create(Request $request, string $wo): JsonResponse
    {
        $w = DB::table('work_orders')->where('id', $wo)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->preparer($request, $w);

        return response()->json(['data' => ['id' => $this->bastp->create($wo, $request->user())]], 201);
    }

    public function forWorkOrder(Request $request, string $wo): JsonResponse
    {
        $w = DB::table('work_orders')->where('id', $wo)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, $w);

        return response()->json(['data' => DB::table('bastps')->where('work_order_id', $wo)->orderByDesc('created_at')->get(['id', 'bastp_number', 'status', 'round', 'created_at'])->map(fn ($b) => (array) $b)->all()]);
    }

    public function show(Request $request, string $bastp): JsonResponse
    {
        $b = $this->find($bastp);
        $w = DB::table('work_orders')->where('id', $b->work_order_id)->first();
        $this->viewable($request, $w);
        $materials = DB::table('bastp_materials as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->where('m.bastp_id', $bastp)->orderByRaw('length(k.code), k.code')->get(['k.code', 'm.planned_qty', 'm.installed_qty', 'm.note']);
        $meters = DB::table('bastp_meters')->where('bastp_id', $bastp)->orderBy('meter_number')->get();
        $photos = DB::table('bastp_meter_photos')->whereIn('bastp_meter_id', $meters->pluck('id'))->get()->groupBy('bastp_meter_id');
        $sigs = DB::table('bastp_signatures as s')->join('users as u', 'u.id', '=', 's.signer_user_id')->where('s.bastp_id', $bastp)->orderBy('s.signed_at')->orderByRaw("case s.step when 'SUBMIT' then 1 when 'ULP_MANAGER' then 2 when 'KONSTRUKSI_UP3' then 3 else 4 end")->get(['s.round', 's.step', 's.signer_role', 's.signed_at', 's.signature', 'u.name as signer_name']);
        $events = DB::table('bastp_events as e')->join('users as u', 'u.id', '=', 'e.actor_user_id')->where('e.bastp_id', $bastp)->orderBy('e.occurred_at')->get(['e.event_type', 'e.reason', 'e.occurred_at', 'u.name as actor_name']);

        return response()->json(['data' => ['id' => $b->id, 'work_order_id' => $b->work_order_id, 'wo_number' => $w->wo_number, 'bastp_number' => $b->bastp_number, 'status' => $b->status, 'round' => (int) $b->round, 'notes' => $b->notes,
            'return_reason' => $b->return_reason, 'content_hash' => $b->content_hash, 'closed_at' => $b->closed_at,
            'materials' => $materials->map(fn ($m) => ['khs_code' => $m->code, 'planned_qty' => (float) $m->planned_qty, 'installed_qty' => $m->installed_qty === null ? null : (float) $m->installed_qty, 'note' => $m->note])->all(),
            'meters' => $meters->map(fn ($m) => ['id' => $m->id, 'customer_idpel' => $m->customer_idpel, 'meter_number' => $m->meter_number, 'photo_document_ids' => ($photos[$m->id] ?? collect())->pluck('document_id')->all()])->all(),
            'signatures' => $sigs->map(fn ($s) => ['round' => (int) $s->round, 'step' => $s->step, 'signer_name' => $s->signer_name, 'signer_role' => $s->signer_role, 'signed_at' => $s->signed_at, 'signature' => $s->signature])->all(),
            'events' => $events->map(fn ($e) => (array) $e)->all()]]);
    }

    public function putMaterials(Request $request, string $bastp): JsonResponse
    {
        $b = $this->preparerOf($request, $bastp);
        $d = Validator::make($request->all(), ['materials' => ['present', 'array', 'max:500'], 'materials.*.khs_code' => ['required', 'string', 'max:50'], 'materials.*.installed_qty' => ['required', 'numeric', 'min:0', 'max:1000000000'],
            'materials.*.note' => ['nullable', 'string', 'max:255'], 'notes' => ['nullable', 'string', 'max:2000']])->validate();
        $this->bastp->putMaterials($b->id, $d['materials'], $d['notes'] ?? null);

        return response()->json(['message' => 'Lampiran material terpasang disimpan.']);
    }

    public function putMeters(Request $request, string $bastp): JsonResponse
    {
        $b = $this->preparerOf($request, $bastp);
        $d = Validator::make($request->all(), ['meters' => ['present', 'array', 'max:200'], 'meters.*.customer_idpel' => ['required', 'string', 'max:50'], 'meters.*.meter_number' => ['required', 'string', 'max:60']])->validate();
        $this->bastp->putMeters($b->id, $d['meters']);

        return response()->json(['message' => 'Data kWh meter disimpan.']);
    }

    public function uploadPhoto(Request $request, string $bastp, string $meter): JsonResponse
    {
        $b = $this->preparerOf($request, $bastp);
        $d = Validator::make($request->all(), ['file' => ['required', 'file'], 'title' => ['nullable', 'string', 'max:200']])->validate();
        DB::table('bastp_meters')->where('id', $meter)->where('bastp_id', $b->id)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($b->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("BASTP berstatus {$b->status}; hanya DRAFT yang dapat diubah.");
        }
        $docId = $this->documents->upload($b->application_id, 'METER_INSTALLATION', $request->file('file'), $d['title'] ?? null, null, $request->user());
        $this->bastp->linkPhoto($b->id, $meter, $docId);

        return response()->json(['data' => ['document_id' => $docId]], 201);
    }

    public function submit(Request $request, string $bastp): JsonResponse
    {
        $b = $this->preparerOf($request, $bastp);
        $this->confirmPassword($request);
        $this->bastp->sign($b->id, 'SUBMIT', $request->user(), VendorService::companyOf($request->user()) !== null ? 'VENDOR' : (string) $this->authorizer->roleFor($request->user(), 'bastp.prepare'));
        $this->flow->bastpSigned($b->id, $request->user());

        return response()->json(['message' => 'BASTP diajukan dan ditandatangani.']);
    }

    public function accept(Request $request, string $bastp): JsonResponse
    {
        return $this->step($request, $bastp, 'ULP_MANAGER', 'bastp.accept', 'BASTP diterima Manager ULP.');
    }

    public function signKonstruksi(Request $request, string $bastp): JsonResponse
    {
        return $this->step($request, $bastp, 'KONSTRUKSI_UP3', 'bastp.sign_konstruksi', 'BASTP ditandatangani KONSTRUKSI_UP3.');
    }

    public function close(Request $request, string $bastp): JsonResponse
    {
        return $this->step($request, $bastp, 'ASMAN_KONSTRUKSI', 'bastp.close', 'BASTP ditutup; WO diselesaikan.');
    }

    /** POST /bastp/{id}/return — the holder of the NEXT step's key returns the BASTP with a reason. */
    public function returnBack(Request $request, string $bastp): JsonResponse
    {
        $b = $this->find($bastp);
        $key = BastpService::reviewerKeyFor($b->status);
        if ($key === null) {
            throw new AssignmentRuleViolation("BASTP berstatus {$b->status} tidak dapat dikembalikan.");
        }
        $this->internal($request, $key, $b->application_id);
        $d = Validator::make($request->all(), ['reason' => ['required', 'string', 'max:2000']])->validate();
        $this->bastp->returnBack($b->id, $d['reason'], $request->user());
        $this->flow->bastpReturned($b->id, $d['reason'], $request->user());

        return response()->json(['message' => 'BASTP dikembalikan.']);
    }

    public function document(Request $request, string $bastp): JsonResponse|Response
    {
        $b = $this->find($bastp);
        $this->viewable($request, DB::table('work_orders')->where('id', $b->work_order_id)->first());
        $format = $request->query('format', 'json');
        if (! in_array($format, ['json', ...DocumentDownload::FORMATS], true)) {
            throw new AdministrationDenied('Format tidak dikenal (json, xlsx atau pdf).', 422);
        }
        $doc = $this->docs->bastp($bastp);

        return $format === 'json' ? response()->json(['data' => $doc])
            : $this->download->response($doc, $format, 'BASTP-'.str_replace('/', '-', (string) ($b->bastp_number ?? $b->id)));
    }

    private function step(Request $request, string $bastp, string $step, string $key, string $message): JsonResponse
    {
        $b = $this->find($bastp);
        $this->internal($request, $key, $b->application_id);
        $this->confirmPassword($request);
        $this->bastp->sign($b->id, $step, $request->user(), (string) $this->authorizer->roleFor($request->user(), $key));
        $this->flow->bastpSigned($b->id, $request->user());

        return response()->json(['message' => $message]);
    }

    /** Electronic signature: the signer re-confirms the account password. */
    private function confirmPassword(Request $request): void
    {
        $d = Validator::make($request->all(), ['password' => ['required', 'string']])->validate();
        if (! Hash::check($d['password'], (string) $request->user()->password)) {
            throw new AdministrationDenied('Kata sandi tanda tangan tidak sesuai.', 403);
        }
    }

    /** The assigned vendor (relation) or a TEKNIK of the application's ULP. */
    private function preparer(Request $request, object $wo): void
    {
        $company = VendorService::companyOf($request->user());
        if ($company !== null) {
            if ($wo->vendor_company_id !== $company) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }

            return;
        }
        $this->internal($request, 'bastp.prepare', $wo->application_id);
    }

    private function preparerOf(Request $request, string $bastp): object
    {
        $b = $this->find($bastp);
        $this->preparer($request, DB::table('work_orders')->where('id', $b->work_order_id)->first());

        return $b;
    }

    private function internal(Request $request, string $key, string $applicationId): void
    {
        $unit = (string) (DB::table('applications')->where('id', $applicationId)->value('organizational_unit_id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404));
        $this->authorizer->authorizeScope($request->user(), $key);
        $this->authorizer->authorizeOnUnit($request->user(), $key, $unit);
    }

    private function viewable(Request $request, object $wo): void
    {
        $company = VendorService::companyOf($request->user());
        if ($company !== null) {
            if ($wo->vendor_company_id !== $company) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }

            return;
        }
        $scope = $this->authorizer->authorizeScope($request->user(), 'bastp.view');
        $unit = (string) DB::table('applications')->where('id', $wo->application_id)->value('organizational_unit_id');
        if (! $scope['unrestricted'] && ! in_array($unit, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    private function find(string $id): object
    {
        return DB::table('bastps')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }
}
