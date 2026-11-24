<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Analytics\BusinessInputWorkbook;
use App\Services\Analytics\BusinessMetricService;
use App\Services\Analytics\BusinessTrendBuilder;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Analisa dan tren pengusahaan (docs/91). Membaca butuh pengusahaan.view, mengisi masukan bulanan (kWh beli, E-Min, PSSD) butuh pengusahaan.input pada ULP itu; ULP dalam cakupan peran, UP3 hanya bila perannya mencakup UP3 itu (atau sistem).
 */
class BusinessAnalyticsController extends Controller
{
    private const PERMISSION = 'pengusahaan.view';

    private const INPUT_PERMISSION = 'pengusahaan.input';

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly BusinessTrendBuilder $builder, private readonly BusinessInputWorkbook $workbook) {}

    /** GET /pengusahaan/metrics: katalog metrik dan unit yang boleh dilihat. */
    public function index(Request $request): JsonResponse
    {
        $units = $this->visibleUnits($request);

        return response()->json(['data' => [
            'metrics' => array_map(fn ($code, $d) => ['code' => $code, 'name' => $d['name'], 'source' => $d['source'], 'polarity' => $d['polarity'], 'available' => $d['available'] ?? true, 'breakdown' => $d['breakdown'],
                'series' => array_map(fn ($s) => ['key' => $s['key'], 'name' => $s['name'], 'unit' => $s['unit']], $d['series'])], array_keys(BusinessMetricService::CATALOG), BusinessMetricService::CATALOG),
            'units' => $units->map(fn ($u) => ['id' => $u->id, 'name' => $u->name, 'unit_type' => $u->unit_type, 'parent_id' => $u->parent_id])->values()->all(),
        ]]);
    }

    /** GET /pengusahaan/metrics/{code}?unit_id=&from=YYYY-MM&to=YYYY-MM: deret, ringkasan, rincian, perbandingan ULP, kelengkapan, catatan analisa. */
    public function show(Request $request, string $code): JsonResponse
    {
        if (! isset(BusinessMetricService::CATALOG[$code])) {
            throw new AdministrationDenied('Metrik tidak dikenal.', 404);
        }
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'from' => ['nullable', 'date_format:Y-m'], 'to' => ['nullable', 'date_format:Y-m']]);
        $unit = $this->visibleUnits($request)->firstWhere('id', $d['unit_id']);
        if ($unit === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $ulps = $unit->unit_type === 'UP3'
            ? DB::table('organizational_units')->where('parent_id', $unit->id)->where('unit_type', 'ULP')->orderBy('name')->pluck('name', 'id')->all()
            : [$unit->id => $unit->name];
        $ids = array_keys($ulps);
        $to = $d['to'] ?? $this->builder->latestMonth($code, $ids);
        $from = $d['from'] ?? date('Y-m', strtotime("{$to}-01 -23 month"));
        if ($from > $to) {
            throw new AdministrationDenied('Rentang bulan tidak valid.', 422);
        }
        if ((int) substr($to, 0, 4) * 12 + (int) substr($to, 5) - ((int) substr($from, 0, 4) * 12 + (int) substr($from, 5)) >= 60) {
            throw new AdministrationDenied('Rentang paling panjang 60 bulan.', 422);
        }

        return response()->json(['data' => ['unit' => ['id' => $unit->id, 'name' => $unit->name, 'unit_type' => $unit->unit_type]]
            + $this->builder->build($code, $ids, $unit->unit_type === 'UP3' ? $ulps : [], $from, $to)]);
    }

    /**
     * GET /pengusahaan/inputs?unit_id=&year=: masukan bulanan kWh beli, E-Min, PSSD satu ULP setahun, beserta kWh jual (309) dan susut hasil hitung per bulan dan kumulatif.
     */
    public function inputs(Request $request): JsonResponse
    {
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'year' => ['required', 'integer', 'between:2000,2100']]);
        $unit = $this->visibleUnits($request)->firstWhere('id', $d['unit_id']);
        if ($unit === null || $unit->unit_type !== 'ULP') {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $year = (int) $d['year'];
        $rows = DB::table('business_monthly_inputs as i')->leftJoin('users as u', 'u.id', '=', 'i.entered_by')->where('i.organizational_unit_id', $unit->id)
            ->whereBetween('i.period', ["{$year}-01-01", "{$year}-12-01"])->get(['i.period', 'i.code', 'i.value', 'i.note', 'u.name as entered_by_name', 'i.updated_at'])
            ->groupBy(fn ($r) => substr((string) $r->period, 0, 7));
        $metrics = app(BusinessMetricService::class);
        $sales = $metrics->raw('kwh-jual', [$unit->id], "{$year}-01", "{$year}-12")[$unit->id] ?? [];
        $losses = $metrics->losses([$unit->id], "{$year}-01-01", "{$year}-12-01")[$unit->id] ?? [];
        $months = [];
        $cum = ['beli_net' => 0.0, 'susut_kwh' => 0.0];
        $cumComplete = true;
        for ($m = 1; $m <= 12; $m++) {
            $key = sprintf('%04d-%02d', $year, $m);
            $values = [];
            foreach (BusinessMetricService::INPUT_CODES as $code => $name) {
                $r = ($rows[$key] ?? collect())->firstWhere('code', $code);
                $values[$code] = $r === null ? null : ['value' => (float) $r->value, 'note' => $r->note, 'entered_by' => $r->entered_by_name, 'updated_at' => $r->updated_at];
            }
            $loss = $losses[$key]['raw'] ?? null;
            if ($loss === null) {
                $cumComplete = false;
            } else {
                $cum['beli_net'] += $loss['beli_net'];
                $cum['susut_kwh'] += $loss['susut_kwh'];
            }
            $months[] = ['period' => $key, 'inputs' => $values, 'kwh_jual' => $sales[$key]['raw']['kwh'] ?? null,
                'susut_pct' => $loss !== null && $loss['beli_net'] != 0 ? $loss['susut_kwh'] / $loss['beli_net'] * 100 : null,
                'susut_kumulatif_pct' => $cumComplete && $cum['beli_net'] != 0 ? $cum['susut_kwh'] / $cum['beli_net'] * 100 : null];
        }

        return response()->json(['data' => ['unit' => ['id' => $unit->id, 'name' => $unit->name], 'year' => $year,
            'codes' => array_map(fn ($c, $n) => ['code' => $c, 'name' => $n, 'unit' => 'kWh', 'required' => $c === 'kwh-beli'], array_keys(BusinessMetricService::INPUT_CODES), BusinessMetricService::INPUT_CODES),
            'can_edit' => $this->authorizer->roleFor($request->user(), self::INPUT_PERMISSION) !== null, 'months' => $months]]);
    }

    /** PUT /pengusahaan/inputs {unit_id, items:[{period: YYYY-MM, code, value|null, note?}]}: nilai bulan itu (bukan kumulatif); null menghapus; butir yang tidak berubah dilewati. */
    public function saveInputs(Request $request): JsonResponse
    {
        $d = $request->validate(['unit_id' => ['required', 'uuid'], 'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.period' => ['required', 'date_format:Y-m', 'before_or_equal:'.now()->format('Y-m')], 'items.*.code' => ['required', 'in:'.implode(',', array_keys(BusinessMetricService::INPUT_CODES))],
            'items.*.value' => ['nullable', 'numeric', 'min:0', 'max:1000000000000'], 'items.*.note' => ['nullable', 'string', 'max:300']]);
        $this->authorizer->authorizeOnUnit($request->user(), self::INPUT_PERMISSION, $d['unit_id']);
        if (DB::table('organizational_units')->where('id', $d['unit_id'])->value('unit_type') !== 'ULP') {
            throw new AdministrationDenied('Masukan bulanan hanya untuk ULP.', 422);
        }
        $changed = 0;
        DB::transaction(function () use ($d, $request, &$changed) {
            foreach ($d['items'] as $it) {
                $where = ['organizational_unit_id' => $d['unit_id'], 'period' => $it['period'].'-01', 'code' => $it['code']];
                if (! array_key_exists('value', $it) || $it['value'] === null) {
                    $changed += DB::table('business_monthly_inputs')->where($where)->delete();

                    continue;
                }
                $existing = DB::table('business_monthly_inputs')->where($where)->first();
                if ($existing !== null && (float) $existing->value === (float) $it['value'] && trim((string) $existing->note) === trim((string) ($it['note'] ?? ''))) {
                    continue;
                }
                $changed++;
                $data = ['value' => $it['value'], 'note' => $it['note'] ?? null, 'entered_by' => $request->user()->id, 'updated_at' => now()];
                $existing === null
                    ? DB::table('business_monthly_inputs')->insert($where + $data + ['id' => (string) Str::uuid7(), 'created_at' => now()])
                    : DB::table('business_monthly_inputs')->where('id', $existing->id)->update($data);
            }
        });

        return response()->json(['message' => $changed === 0 ? 'Tidak ada perubahan masukan.' : "{$changed} masukan berubah.", 'changed' => $changed]);
    }

    /** GET /pengusahaan/inputs/template?year=&unit_id=: templat Excel (ULP yang boleh diisi; unit_id ULP atau UP3 membatasi), terisi nilai tersimpan. */
    public function template(Request $request): BinaryFileResponse
    {
        $d = $request->validate(['year' => ['required', 'integer', 'between:2000,2100'], 'unit_id' => ['nullable', 'uuid']]);
        $scope = $this->authorizer->authorizeScope($request->user(), self::INPUT_PERMISSION);
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')
            ->when(! $scope['unrestricted'], fn ($q) => $q->whereIn('id', $scope['units']))
            ->when(! empty($d['unit_id']), fn ($q) => $q->where(fn ($x) => $x->where('id', $d['unit_id'])->orWhere('parent_id', $d['unit_id'])))
            ->orderBy('name')->get(['id', 'code', 'name'])->all();
        if ($units === []) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $path = storage_path('app/kwh-beli-'.Str::uuid().'.xlsx');
        $this->workbook->template($units, (int) $d['year'], $path);

        return response()->download($path, "KWH-BELI-{$d['year']}.xlsx", ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /** POST /pengusahaan/inputs/import (multipart `file`): impor templat; seluruh berkas ditolak bila ada baris salah. */
    public function import(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:5120', 'extensions:xlsx,xls']]);
        $this->authorizer->authorizeScope($request->user(), self::INPUT_PERMISSION);
        $r = $this->workbook->import($request->file('file')->getRealPath(), $request->user());

        return response()->json(['data' => $r, 'message' => "{$r['rows']} nilai dibaca, {$r['changed']} berubah, {$r['unchanged']} sama."]);
    }

    /** ULP dalam cakupan peran dan UP3 yang perannya mencakup UP3 itu; semua untuk peran sistem. */
    private function visibleUnits(Request $request): Collection
    {
        $actor = $request->user();
        $scope = $this->authorizer->authorizeScope($actor, self::PERMISSION);
        $query = DB::table('organizational_units')->whereIn('unit_type', ['ULP', 'UP3'])->orderBy('unit_type', 'desc')->orderBy('name');
        if ($scope['unrestricted']) {
            return $query->get(['id', 'name', 'unit_type', 'parent_id']);
        }
        $up3 = DB::table('organizational_units')->whereIn('id', $scope['units'])->whereNotNull('parent_id')->pluck('parent_id')->unique()
            ->filter(fn ($id) => $this->authorizer->holdsOnUp3($actor, self::PERMISSION, $id))->values()->all();

        return $query->where(fn ($q) => $q->where(fn ($x) => $x->whereIn('id', $scope['units'])->where('unit_type', 'ULP'))->orWhereIn('id', $up3))->get(['id', 'name', 'unit_type', 'parent_id']);
    }
}
