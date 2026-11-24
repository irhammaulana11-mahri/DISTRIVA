<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Analytics\BusinessMetricService;
use App\Services\Analytics\BusinessTrendBuilder;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Analisa dan tren pengusahaan (docs/91). Butuh pengusahaan.view; ULP dalam cakupan peran, UP3 hanya bila perannya mencakup UP3 itu (atau sistem).
 */
class BusinessAnalyticsController extends Controller
{
    private const PERMISSION = 'pengusahaan.view';

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly BusinessTrendBuilder $builder) {}

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
