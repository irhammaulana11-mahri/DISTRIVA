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
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Laporan bulanan EIS/AP2T yang diimpor (docs/88). Membaca butuh eis_reports.view (UP3 melihat ULP di bawahnya dan laporan tingkat UP3 miliknya), mengunggah butuh eis_reports.import
 * pada unit tujuan; unit tujuan dibaca dari berkas, bukan dipilih pengunggah, dan berkas di luar cakupan ditolak per berkas.
 */
class EisReportController extends Controller
{
    /** Batas per berkas Excel, per arsip ZIP, jumlah berkas Excel per arsip, dan ukuran total setelah dibongkar. */
    private const FILE_MAX_KB = 20480;

    private const ZIP_MAX_KB = 102400;

    private const ZIP_MAX_ENTRIES = 400;

    private const ZIP_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

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

    /**
     * GET /eis-reports/coverage?year=2026&unit_id=...: kelengkapan bulan per jenis laporan untuk satu unit (berkas aktif).
     * Dengan up3_id (tanpa unit_id): semua ULP di bawah UP3 itu yang terlihat, beserta daftar laporan yang belum masuk sampai bulan lengkap terakhir.
     */
    public function coverage(Request $request): JsonResponse
    {
        $visible = $this->visibleUnits($request);
        $d = $request->validate(['unit_id' => ['required_without:up3_id', 'nullable', 'uuid'], 'up3_id' => ['required_without:unit_id', 'nullable', 'uuid'], 'year' => ['required', 'integer', 'between:2000,2100']]);
        if (empty($d['unit_id'])) {
            return $this->up3Coverage($d['up3_id'], (int) $d['year'], $visible);
        }
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

    /**
     * Matriks kelengkapan semua ULP satu UP3. Bulan yang diharapkan: tahun lalu dan sebelumnya 12 bulan; tahun berjalan sampai bulan lalu; tahun depan tidak ada.
     *
     * @param  list<string>|null  $visible
     */
    private function up3Coverage(string $up3Id, int $year, ?array $visible): JsonResponse
    {
        $up3 = DB::table('organizational_units')->where('id', $up3Id)->where('unit_type', 'UP3')->first(['id', 'name']);
        $ulps = DB::table('organizational_units')->where('parent_id', $up3Id)->where('unit_type', 'ULP')->where('is_active', true)
            ->when($visible !== null, fn ($q) => $q->whereIn('id', $visible))->orderBy('code')->get(['id', 'code', 'name']);
        if ($up3 === null || $ulps->isEmpty()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $now = now();
        $expectedUntil = $year < $now->year ? 12 : ($year === $now->year ? $now->month - 1 : 0);
        $have = [];
        foreach (DB::table('eis_report_files')->whereIn('organizational_unit_id', $ulps->pluck('id'))->where('status', 'AKTIF')->whereBetween('period', ["{$year}-01-01", "{$year}-12-01"])->get(['organizational_unit_id', 'family', 'period']) as $r) {
            $have[$r->organizational_unit_id][$r->family][(int) substr($r->period, 5, 2)] = true;
        }
        $units = [];
        $missingTotal = 0;
        foreach ($ulps as $u) {
            $families = [];
            $missing = [];
            foreach (EisReportParser::FAMILIES as $f) {
                for ($m = 1; $m <= 12; $m++) {
                    $families[$f][$m] = isset($have[$u->id][$f][$m]);
                    if ($m <= $expectedUntil && ! $families[$f][$m]) {
                        $missing[] = ['family' => $f, 'month' => $m];
                    }
                }
            }
            $missingTotal += count($missing);
            $units[] = ['unit_id' => $u->id, 'unit_code' => $u->code, 'unit_name' => $u->name, 'families' => $families, 'missing_count' => count($missing), 'missing' => $missing];
        }

        return response()->json(['data' => ['up3_id' => $up3->id, 'up3_name' => $up3->name, 'year' => $year, 'expected_until_month' => $expectedUntil, 'families_list' => EisReportParser::FAMILIES,
            'expected_total' => $expectedUntil * count(EisReportParser::FAMILIES) * count($units), 'missing_total' => $missingTotal, 'units' => $units]]);
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

    /**
     * POST /eis-reports/import (multipart files[], opsional unit_id dan period=YYYY-MM): hasil per berkas; berkas yang gagal tidak menghentikan yang lain.
     * Nama berkas bebas (unduhan EIS apa adanya): jenis, unit, dan bulan dibaca dari isi; unit_id/period hanya mengisi yang tidak tertulis di nama maupun isi.
     * Berkas .zip dibongkar dan setiap .xls/.xlsx di dalamnya (termasuk subfolder) diimpor seperti berkas biasa.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, 'eis_reports.import');
        if ($scope['unrestricted'] && ! $this->mfa->satisfied($actor)) {
            throw new AdministrationDenied('Aksi tulis SYS_ADMIN memerlukan verifikasi MFA.', 403);
        }
        $d = $request->validate(['files' => ['required', 'array', 'min:1', 'max:60'], 'files.*' => ['file', 'max:'.self::ZIP_MAX_KB, 'extensions:xls,xlsx,zip'],
            'unit_id' => ['nullable', 'uuid'], 'period' => ['nullable', 'date_format:Y-m']]);
        $allowed = null;
        if (! $scope['unrestricted']) {
            $allowed = $scope['units'];
            foreach (DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->unique() as $up3) {
                $this->authorizer->holdsOnUp3($actor, 'eis_reports.import', $up3) && $allowed[] = $up3;
            }
        }
        $hints = ['period' => $d['period'] ?? null, 'unit_code' => null];
        if (! empty($d['unit_id'])) {
            if ($allowed !== null && ! in_array($d['unit_id'], $allowed, true)) {
                throw new AdministrationDenied('Unit pilihan di luar kewenangan Anda.', 403);
            }
            $hints['unit_code'] = DB::table('organizational_units')->where('id', $d['unit_id'])->value('code') ?? throw new AdministrationDenied('Unit tidak ditemukan.', 404);
        }
        $results = [];
        $importOne = function (string $path, string $label, string $name, array $folderHints = []) use ($actor, $allowed, $hints, &$results) {
            try {
                $results[] = ['name' => $label, 'ok' => true] + $this->import->import($path, $name, $actor, $allowed, array_filter($folderHints) + $hints);
            } catch (EisReportException $e) {
                $results[] = ['name' => $label, 'ok' => false, 'message' => $e->getMessage()];
            }
        };
        foreach ($request->file('files') as $file) {
            $name = $file->getClientOriginalName();
            if (strtolower($file->getClientOriginalExtension()) !== 'zip') {
                $file->getSize() > self::FILE_MAX_KB * 1024
                    ? $results[] = ['name' => $name, 'ok' => false, 'message' => 'Berkas lebih dari '.(self::FILE_MAX_KB / 1024).' MB.']
                    : $importOne($file->getRealPath(), $name, $name);

                continue;
            }
            $this->importZip($file->getRealPath(), $name, $importOne, $results);
        }
        if ($results === []) {
            throw new AdministrationDenied('Tidak ada berkas Excel yang dapat diimpor.', 422);
        }
        $failed = count(array_filter($results, fn ($r) => ! $r['ok']));

        return response()->json(['data' => $results, 'message' => count($results) - $failed.' berkas diproses'.($failed > 0 ? ", {$failed} gagal" : '').'.'], $failed === count($results) ? 422 : 200);
    }

    /**
     * Bongkar arsip ke berkas sementara satu per satu (nama entri tidak pernah dipakai sebagai jalur tujuan). Folder sistem (__MACOSX) dan berkas tersembunyi dilewati diam-diam;
     * berkas bukan Excel dilaporkan dilewati. Ukuran asli dibatasi per entri dan total supaya arsip yang mengembang besar ditolak.
     *
     * @param  list<array<string, mixed>>  $results
     */
    private function importZip(string $path, string $zipName, \Closure $importOne, array &$results): void
    {
        $zip = new \ZipArchive;
        if ($zip->open($path, \ZipArchive::RDONLY) !== true) {
            $results[] = ['name' => $zipName, 'ok' => false, 'message' => 'Arsip ZIP tidak dapat dibuka.'];

            return;
        }
        $excel = [];
        $total = 0;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            $entry = (string) ($stat['name'] ?? '');
            $base = basename(str_replace('\\', '/', $entry));
            if ($entry === '' || str_ends_with($entry, '/') || str_contains($entry, '__MACOSX') || str_starts_with($base, '.') || str_starts_with($base, '~$')) {
                continue;
            }
            $label = "{$zipName} › {$entry}";
            if (! preg_match('/\.xlsx?$/i', $base)) {
                $results[] = ['name' => $label, 'ok' => false, 'message' => 'Bukan berkas Excel; dilewati.'];

                continue;
            }
            if ((int) $stat['size'] > self::FILE_MAX_KB * 1024) {
                $results[] = ['name' => $label, 'ok' => false, 'message' => 'Berkas lebih dari '.(self::FILE_MAX_KB / 1024).' MB.'];

                continue;
            }
            $total += (int) $stat['size'];
            $excel[] = [$i, $label, $base];
        }
        if (count($excel) > self::ZIP_MAX_ENTRIES || $total > self::ZIP_MAX_TOTAL_BYTES) {
            $zip->close();
            $results[] = ['name' => $zipName, 'ok' => false, 'message' => 'Arsip terlalu besar: paling banyak '.self::ZIP_MAX_ENTRIES.' berkas Excel dan '.(self::ZIP_MAX_TOTAL_BYTES / 1024 / 1024).' MB setelah dibongkar; pecah menjadi beberapa ZIP.'];

            return;
        }
        if ($excel === []) {
            $zip->close();
            $results[] = ['name' => $zipName, 'ok' => false, 'message' => 'Arsip tidak berisi berkas Excel.'];

            return;
        }
        $units = DB::table('organizational_units')->where('is_active', true)->orderByRaw("CASE WHEN unit_type = 'ULP' THEN 0 ELSE 1 END")->get(['code', 'name']);
        foreach ($excel as [$index, $label, $base]) {
            $folderHints = $this->folderHints((string) $zip->getNameIndex($index), $units);
            $tmp = tempnam(sys_get_temp_dir(), 'eisz').'.'.strtolower(pathinfo($base, PATHINFO_EXTENSION));
            try {
                $in = $zip->getStream($zip->getNameIndex($index));
                $out = fopen($tmp, 'wb');
                $copied = $in !== false && $out !== false ? stream_copy_to_stream($in, $out, self::FILE_MAX_KB * 1024 + 1) : false;
                is_resource($in) && fclose($in);
                is_resource($out) && fclose($out);
                if ($copied === false || $copied > self::FILE_MAX_KB * 1024) {
                    $results[] = ['name' => $label, 'ok' => false, 'message' => 'Berkas di dalam arsip tidak dapat dibaca.'];

                    continue;
                }
                $importOne($tmp, $label, $base, $folderHints);
            } finally {
                @unlink($tmp);
                @unlink(substr($tmp, 0, strrpos($tmp, '.')));
            }
        }
        $zip->close();
    }

    /**
     * Unit dan bulan dari nama folder entri ZIP (mis. "JOMBANG/2026-10/Rekap.xls", "51453/Oktober 2026/..."): folder bernama kode unit atau nama unit (dengan atau tanpa "ULP "/"UP3 "),
     * folder bulan YYYY-MM, MM-YYYY, BBTTTT, atau "Oktober 2026". Folder terdalam yang cocok dipakai.
     *
     * @param  Collection<int, object>  $units
     * @return array{unit_code?: string, period?: string}
     */
    private function folderHints(string $entry, Collection $units): array
    {
        $months = ['januari' => 1, 'pebruari' => 2, 'februari' => 2, 'maret' => 3, 'april' => 4, 'mei' => 5, 'juni' => 6, 'juli' => 7, 'agustus' => 8, 'september' => 9, 'oktober' => 10, 'nopember' => 11, 'november' => 11, 'desember' => 12];
        $out = [];
        foreach (array_slice(explode('/', str_replace('\\', '/', $entry)), 0, -1) as $seg) {
            $s = strtoupper(trim($seg));
            $plain = trim((string) preg_replace('/^(ULP|UP3)\s+/', '', $s));
            $unit = $units->first(fn ($u) => strtoupper((string) $u->code) === $s || strtoupper((string) $u->name) === $s || strtoupper(trim((string) preg_replace('/^(ULP|UP3)\s+/i', '', (string) $u->name))) === $plain);
            $unit !== null && $out['unit_code'] = (string) $unit->code;
            if (preg_match('/^(20\d{2})[-_. ](0?[1-9]|1[0-2])$/', $s, $m)) {
                $out['period'] = sprintf('%04d-%02d', $m[1], $m[2]);
            } elseif (preg_match('/^(0?[1-9]|1[0-2])[-_. ]?(20\d{2})$/', $s, $m)) {
                $out['period'] = sprintf('%04d-%02d', $m[2], $m[1]);
            } elseif (preg_match('/^([A-Z]+)[-_ ]+(20\d{2})$/', $s, $m) && isset($months[strtolower($m[1])])) {
                $out['period'] = sprintf('%04d-%02d', $m[2], $months[strtolower($m[1])]);
            }
        }

        return $out;
    }
}
