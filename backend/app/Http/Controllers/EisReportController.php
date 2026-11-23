<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\EisReports\EisReportException;
use App\Services\EisReports\EisReportImportService;
use App\Services\EisReports\EisReportParser;
use App\Services\MfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Laporan bulanan EIS/AP2T yang diimpor (docs/88). Membaca butuh eis_reports.view (UP3 melihat ULP di bawahnya dan laporan tingkat UP3 miliknya), mengunggah butuh eis_reports.import
 * pada unit tujuan; unit tujuan dibaca dari berkas, bukan dipilih pengunggah, dan berkas di luar cakupan ditolak per berkas.
 */
class EisReportController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly EisReportImportService $import, private readonly MfaService $mfa) {}

    /** @return list<string>|null unit (ULP dan UP3) yang boleh dibaca; null = semua */
    private function visibleUnits(Request $request): ?array
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'eis_reports.view');
        if ($scope['unrestricted']) {
            return null;
        }

        return array_values(array_unique([...$scope['units'], ...DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->all()]));
    }

    public function index(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['family' => ['nullable', 'in:'.implode(',', EisReportParser::FAMILIES)], 'unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid'], 'from' => ['nullable', 'date_format:Y-m'], 'to' => ['nullable', 'date_format:Y-m'], 'status' => ['nullable', 'in:AKTIF,DIGANTIKAN'], 'per_page' => ['nullable', 'integer', 'between:1,200']]);
        $q = DB::table('eis_report_files as f')->join('organizational_units as u', 'u.id', '=', 'f.organizational_unit_id')
            ->when($visible !== null, fn ($w) => $w->whereIn('f.organizational_unit_id', $visible))
            ->when(! empty($d['family']), fn ($w) => $w->where('f.family', $d['family']))
            ->when(! empty($d['unit_id']), fn ($w) => $w->where('f.organizational_unit_id', $d['unit_id']))
            ->when(! empty($d['up3_id']), fn ($w) => $w->where(fn ($x) => $x->where('u.parent_id', $d['up3_id'])->orWhere('u.id', $d['up3_id'])))
            ->when(! empty($d['from']), fn ($w) => $w->where('f.period', '>=', $d['from'].'-01'))
            ->when(! empty($d['to']), fn ($w) => $w->where('f.period', '<=', $d['to'].'-01'))
            ->where('f.status', $d['status'] ?? 'AKTIF');
        $page = $q->orderByDesc('f.period')->orderBy('u.name')->orderBy('f.family')->select('f.id', 'f.family', 'f.period', 'f.original_name', 'f.status', 'f.line_count', 'f.warnings', 'f.imported_at', 'f.organizational_unit_id', 'u.name as unit_name', 'u.unit_type')->paginate((int) ($d['per_page'] ?? 50));

        return response()->json(['data' => collect($page->items())->map(fn ($r) => ['id' => $r->id, 'family' => $r->family, 'period' => substr($r->period, 0, 7), 'unit_id' => $r->organizational_unit_id, 'unit_name' => $r->unit_name, 'unit_type' => $r->unit_type, 'original_name' => $r->original_name,
            'status' => $r->status, 'line_count' => (int) $r->line_count, 'warnings' => $r->warnings === null ? [] : json_decode($r->warnings, true), 'imported_at' => $r->imported_at])->all(),
            'meta' => ['total' => $page->total(), 'per_page' => $page->perPage(), 'current_page' => $page->currentPage(), 'last_page' => $page->lastPage()], 'families' => EisReportParser::FAMILIES]);
    }

    /** GET /eis-reports/coverage?year=2026&unit_id=...: kelengkapan bulan per jenis laporan untuk satu unit (berkas aktif). */
    public function coverage(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'year' => ['required', 'integer', 'between:2000,2100']]);
        if ($visible !== null && ! in_array($d['unit_id'], $visible, true)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $rows = DB::table('eis_report_files')->where('organizational_unit_id', $d['unit_id'])->where('status', 'AKTIF')->whereBetween('period', ["{$d['year']}-01-01", "{$d['year']}-12-01"])->get(['family', 'period']);
        $matrix = array_fill_keys(EisReportParser::FAMILIES, array_fill(1, 12, false));
        foreach ($rows as $r) {
            $matrix[$r->family][(int) substr($r->period, 5, 2)] = true;
        }

        return response()->json(['data' => ['unit_id' => $d['unit_id'], 'year' => (int) $d['year'], 'families' => $matrix]]);
    }

    public function lines(Request $request, string $file): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $f = DB::table('eis_report_files as f')->join('organizational_units as u', 'u.id', '=', 'f.organizational_unit_id')->where('f.id', $file)->first(['f.*', 'u.name as unit_name']);
        if ($f === null || ($visible !== null && ! in_array($f->organizational_unit_id, $visible, true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $lines = DB::table('eis_report_lines')->where('file_id', $file)->orderBy('line_no')->orderBy('id')->get(['line_no', 'group_label', 'label', 'code', 'values']);

        return response()->json(['data' => ['file' => ['id' => $f->id, 'family' => $f->family, 'period' => substr($f->period, 0, 7), 'unit_name' => $f->unit_name, 'status' => $f->status, 'original_name' => $f->original_name, 'summary' => $f->summary === null ? null : json_decode($f->summary, true)],
            'lines' => $lines->map(fn ($l) => ['line_no' => (int) $l->line_no, 'group_label' => $l->group_label, 'label' => $l->label, 'code' => $l->code, 'values' => json_decode($l->values, true)])->all()]]);
    }

    /** POST /eis-reports/import (multipart files[]): hasil per berkas; berkas yang gagal tidak menghentikan yang lain. */
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, 'eis_reports.import');
        if ($scope['unrestricted'] && ! $this->mfa->satisfied($actor)) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }
        $request->validate(['files' => ['required', 'array', 'min:1', 'max:60'], 'files.*' => ['file', 'max:20480', 'extensions:xls,xlsx']]);
        $allowed = null;
        if (! $scope['unrestricted']) {
            $allowed = $scope['units'];
            foreach (DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->unique() as $up3) {
                $this->authorizer->holdsOnUp3($actor, 'eis_reports.import', $up3) && $allowed[] = $up3;
            }
        }
        $results = [];
        foreach ($request->file('files') as $file) {
            $name = $file->getClientOriginalName();
            try {
                $results[] = ['name' => $name, 'ok' => true] + $this->import->import($file->getRealPath(), $name, $actor, $allowed);
            } catch (EisReportException $e) {
                $results[] = ['name' => $name, 'ok' => false, 'message' => $e->getMessage()];
            }
        }
        $failed = count(array_filter($results, fn ($r) => ! $r['ok']));

        return response()->json(['data' => $results, 'message' => count($results) - $failed.' berkas diproses'.($failed > 0 ? ", {$failed} gagal" : '').'.'], $failed === count($results) ? 422 : 200);
    }
}
