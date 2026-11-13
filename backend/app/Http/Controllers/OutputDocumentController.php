<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Output\OutputDocumentService;
use App\Services\Output\XlsxRenderer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/** Output documents (docs/62 §28): `?format=json` (default) or `xlsx`. Reading follows kkf.view / rab.view and the application scope (outside it: 404). */
class OutputDocumentController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly OutputDocumentService $docs, private readonly XlsxRenderer $xlsx) {}

    /** GET /rab-runs/{run}/documents/{type}  type = rekap | rinci */
    public function rab(Request $request, string $run, string $type): JsonResponse|Response
    {
        $r = DB::table('rab_runs')->where('id', $run)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, 'rab.view', (string) $r->application_id);
        $doc = match ($type) {
            'rekap' => $this->docs->rekap($run), 'rinci' => $this->docs->rinci($run), default => throw new AdministrationDenied('Dokumen tidak dikenal.', 404),
        };

        return $this->respond($request, $doc, "RAB-{$type}-{$r->run_number}");
    }

    /** GET /kkf-runs/{run}/documents/{type}  type = kkf | hpe */
    public function kkf(Request $request, string $run, string $type): JsonResponse|Response
    {
        $k = DB::table('kkf_runs')->where('id', $run)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->viewable($request, 'kkf.view', (string) $k->application_id);
        $doc = match ($type) {
            'kkf' => $this->docs->kkf($run), 'hpe' => $this->docs->hpe($run), default => throw new AdministrationDenied('Dokumen tidak dikenal.', 404),
        };

        return $this->respond($request, $doc, "KKF-{$type}-{$k->run_number}");
    }

    /** @param array<string,mixed> $doc */
    private function respond(Request $request, array $doc, string $name): JsonResponse|Response
    {
        $format = $request->query('format', 'json');
        if (! in_array($format, ['json', 'xlsx'], true)) {
            throw new AdministrationDenied('Format tidak dikenal (json atau xlsx).', 422);
        }
        if ($format === 'json') {
            return response()->json(['data' => $doc]);
        }

        return response($this->xlsx->render($doc), 200, ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition' => 'attachment; filename="'.$name.'.xlsx"']);
    }

    private function viewable(Request $request, string $permission, string $applicationId): void
    {
        $scope = $this->authorizer->authorizeScope($request->user(), $permission);
        $unit = (string) DB::table('applications')->where('id', $applicationId)->value('organizational_unit_id');
        if (! $scope['unrestricted'] && ! in_array($unit, $scope['units'], true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }
}
