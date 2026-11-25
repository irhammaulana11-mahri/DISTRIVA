<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Analytics\AnomalyInsights;
use App\Services\Analytics\BusinessForecastService;
use App\Services\Analytics\BusinessInputWorkbook;
use App\Services\Analytics\BusinessMetricService;
use App\Services\Analytics\BusinessMetricWorkbook;
use App\Services\Analytics\BusinessSourceHistory;
use App\Services\Analytics\BusinessTargetService;
use App\Services\Analytics\BusinessTrendBuilder;
use App\Services\Analytics\P2tlInsights;
use App\Services\Analytics\ReceivableInsights;
use App\Services\Analytics\ReliabilityInsights;
use App\Services\Analytics\ResponseInsights;
use App\Services\Analytics\SalesInsights;
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

    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly BusinessTrendBuilder $builder, private readonly BusinessInputWorkbook $inputWorkbook, private readonly BusinessMetricWorkbook $workbook,
        private readonly BusinessForecastService $forecaster, private readonly BusinessSourceHistory $history, private readonly BusinessTargetService $targets, private readonly ReliabilityInsights $reliability, private readonly ReceivableInsights $receivable, private readonly SalesInsights $sales, private readonly ResponseInsights $response, private readonly AnomalyInsights $anomaly, private readonly P2tlInsights $p2tl) {}

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

    /** GET /pengusahaan/metrics/{code}?unit_id=&from=YYYY-MM&to=YYYY-MM: deret, ringkasan, rincian, perbandingan ULP, kelengkapan, catatan analisa, pendamping dan rekonsiliasi. */
    public function show(Request $request, string $code): JsonResponse
    {
        return response()->json(['data' => $this->analysis($request, $code)]);
    }

    /** GET /pengusahaan/metrics/{code}/forecast?unit_id=: prakiraan 12 bulan tiap seri beserta analisa teksnya (hanya dari riwayat lengkap berurutan, minimal 24 bulan). */
    public function forecast(Request $request, string $code): JsonResponse
    {
        [$unit, $ulps, $ids] = $this->target($request, $code);

        return response()->json(['data' => ['unit' => ['id' => $unit->id, 'name' => $unit->name, 'unit_type' => $unit->unit_type]] + $this->forecaster->forecast($code, $ids)]);
    }

    /**
     * GET /pengusahaan/metrics/{code}/history?unit_id=&year=: histori sumber data: berkas laporan yang masuk, kelengkapan ULP x bulan (`year` = Januari sampai Desember tahun itu, bawaan 24 bulan terakhir), masukan bulanan (susut), dan sesi sinkronisasi terkait
     * (`syncs`: null bila pemakai tidak berwenang melihatnya).
     */
    public function history(Request $request, string $code): JsonResponse
    {
        [$unit, $ulps, $ids] = $this->target($request, $code);
        $year = $request->validate(['year' => ['nullable', 'integer', 'between:2000,2100']])['year'] ?? null;
        $latest = $this->builder->latestMonth($code, $ids);
        $data = $this->history->history($code, $ulps, $latest, $year === null ? null : (int) $year);
        $data['syncs'] = $this->syncs($request, $code);
        $data['warnings'] = $this->builder->warnings($code, $ids, $latest);

        return response()->json(['data' => ['unit' => ['id' => $unit->id, 'name' => $unit->name, 'unit_type' => $unit->unit_type], 'metric' => ['code' => $code, 'name' => BusinessMetricService::CATALOG[$code]['name'], 'source' => BusinessMetricService::CATALOG[$code]['source']]] + $data]);
    }

    /** GET /pengusahaan/metrics/{code}/export?unit_id=&from=&to=: unduhan Excel dengan angka yang sama dengan layar (seri, rincian, perbandingan ULP, rekonsiliasi, pendamping, prakiraan, catatan). */
    public function export(Request $request, string $code): BinaryFileResponse
    {
        $d = $this->analysis($request, $code);
        [, , $ids] = $this->target($request, $code);
        $path = storage_path('app/pengusahaan-'.Str::uuid().'.xlsx');
        $this->workbook->write($d, $this->forecaster->forecast($code, $ids), $path);

        return response()->download($path, strtoupper('PENGUSAHAAN-'.$code.'-'.$d['from'].'-'.$d['to']).'.xlsx', ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /**
     * Metrik dan unit yang diminta: 404 untuk metrik tidak dikenal atau unit di luar cakupan.
     *
     * @return array{0: object, 1: array<string, string>, 2: list<string>} unit, ULP (id => nama; bila UP3 semua ULP di bawahnya), id ULP
     */
    private function target(Request $request, string $code): array
    {
        if (! isset(BusinessMetricService::CATALOG[$code])) {
            throw new AdministrationDenied('Metrik tidak dikenal.', 404);
        }
        $d = $request->validate(['unit_id' => ['required', 'uuid']]);
        $unit = $this->visibleUnits($request)->firstWhere('id', $d['unit_id']);
        if ($unit === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $ulps = $unit->unit_type === 'UP3'
            ? DB::table('organizational_units')->where('parent_id', $unit->id)->where('unit_type', 'ULP')->orderBy('name')->pluck('name', 'id')->all()
            : [$unit->id => $unit->name];

        return [$unit, $ulps, array_keys($ulps)];
    }

    /** Analisa lengkap satu metrik untuk unit dan rentang yang diminta (dipakai tampilan dan unduhan). @return array<string, mixed> */
    private function analysis(Request $request, string $code): array
    {
        [$unit, $ulps, $ids] = $this->target($request, $code);
        $d = $request->validate(['from' => ['nullable', 'date_format:Y-m'], 'to' => ['nullable', 'date_format:Y-m']]);
        $to = $d['to'] ?? $this->builder->latestMonth($code, $ids);
        $from = $d['from'] ?? date('Y-m', strtotime("{$to}-01 -23 month"));
        if ($from > $to) {
            throw new AdministrationDenied('Rentang bulan tidak valid.', 422);
        }
        if ((int) substr($to, 0, 4) * 12 + (int) substr($to, 5) - ((int) substr($from, 0, 4) * 12 + (int) substr($from, 5)) >= 60) {
            throw new AdministrationDenied('Rentang paling panjang 60 bulan.', 422);
        }

        return ['unit' => ['id' => $unit->id, 'name' => $unit->name, 'unit_type' => $unit->unit_type], 'detail' => match ($code) {
            'gangguan', 'saidi-saifi', 'ens' => $this->reliability->detail($ids, $to),
            'piutang-pascabayar-umur', 'piutang-pascabayar' => $this->receivable->aging($ids, $to),
            'kwh-jual', 'pendapatan' => $this->sales->decomposition($code, $ids, $to),
            'pelunasan-prr' => $this->receivable->repayment('PRR', $ids, $to),
            'pelunasan-ex-prr' => $this->receivable->repayment('EXPRR', $ids, $to),
            'rpt-rct-gangguan', 'rpt-rct-keluhan' => $this->response->detail($code, $ids, $to),
            'anomali-gangguan', 'anomali-keluhan' => $this->anomaly->detail($code, $ids, $to),
            'kwh-p2tl' => $this->p2tl->detail($ids, $to),
            default => null,
        }]
            + $this->builder->build($code, $ids, $unit->unit_type === 'UP3' ? $ulps : [], $from, $to, fn (array $ytd) => $this->targets->targets($code, $unit, $to, $ytd));
    }

    /**
     * Sesi sinkronisasi yang memasok metrik ini: penarikan piutang EIS (piutang), penarikan permohonan EIS (pelanggan, daya, HPL BP), sinkron gangguan dan penarikan APKT (keandalan: SAIDI/SAIFI dan ENS memuat keduanya, RPT-RCT gangguan hanya APKT). Tanpa izin: null.
     *
     * @return list<array<string, mixed>>|null
     */
    private function syncs(Request $request, string $code): ?array
    {
        $user = $request->user();
        $eis = ['pelanggan' => 'PERMOHONAN', 'daya' => 'PERMOHONAN', 'hpl-bp' => 'PERMOHONAN', 'piutang-prabayar' => 'PIUTANG', 'piutang-pascabayar' => 'PIUTANG', 'piutang-pascabayar-umur' => 'PIUTANG'][$code] ?? null;
        $ap2t = ['kwh-p2tl' => [['realisasi', 'belum_realisasi'], true], 'pelunasan-prr' => [['pelunasan_prr'], false], 'pelunasan-ex-prr' => [['pelunasan_ex_prr'], false]][$code] ?? null;      // penarikan AP2T yang memuat laporan menu ini (run TAGSUS lama tanpa `reports` dihitung untuk kWh P2TL)
        if ($ap2t !== null) {
            return $this->authorizer->roleFor($user, 'eis_sync.manage') === null ? null : $this->eisRuns('AP2T', null, $ap2t[0], $ap2t[1]);
        }
        if ($eis !== null) {
            if ($this->authorizer->roleFor($user, 'eis_sync.manage') === null) {
                return null;
            }

            return $this->eisRuns($eis);
        }
        if (isset(BusinessTrendBuilder::APKT_TABLES[$code])) {
            if ($this->authorizer->roleFor($user, 'eis_sync.manage') === null) {
                return null;
            }

            return $this->eisRuns('APKT', $code);
        }
        if (in_array($code, ['gangguan', 'saidi-saifi', 'ens'], true)) {
            $outages = $this->authorizer->roleFor($user, 'outages.view') !== null;
            $apkt = $code !== 'gangguan' && $this->authorizer->roleFor($user, 'eis_sync.manage') !== null;      // penarikan APKT SAIDI/SAIFI masuk sebagai laporan DIFI
            if (! $outages && ! $apkt) {
                return null;
            }
            $runs = $outages ? DB::table('outage_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->orderByDesc('r.created_at')->limit(20)
                ->get(['r.id', 'r.trigger', 'r.status', 'r.counts', 'r.message', 'r.created_at', 'r.started_at', 'r.finished_at', 'u.email as started_by'])
                ->map(fn ($r) => ['source' => 'outage-sync', 'id' => $r->id, 'kind' => 'gangguan', 'trigger' => $r->trigger, 'status' => $r->status, 'started_by' => $r->started_by, 'counts' => $r->counts === null ? null : json_decode((string) $r->counts, true),
                    'message' => $r->message, 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at])->all() : [];
            $runs = array_merge($runs, $apkt ? $this->eisRuns('APKT', 'saidi-saifi') : []);
            usort($runs, fn ($a, $b) => strcmp((string) $b['created_at'], (string) $a['created_at']));

            return array_slice($runs, 0, 20);
        }

        return [];
    }

    /**
     * Penarikan `eis_sync_runs` satu jenis (token APKT tidak pernah ikut). `$dataset` hanya untuk APKT; run lama tanpa `dataset` dianggap SAIDI/SAIFI.
     *
     * @return list<array<string, mixed>>
     */
    private function eisRuns(string $kind, ?string $dataset = null, ?array $reports = null, bool $orWithoutReports = false): array
    {
        return DB::table('eis_sync_runs as r')->leftJoin('users as u', 'u.id', '=', 'r.started_by')->where('r.kind', $kind)
            ->when($dataset !== null, fn ($q) => $q->whereRaw("coalesce(r.options->>'dataset', 'saidi-saifi') = ?", [$dataset]))
            ->when($reports !== null, fn ($q) => $q->whereRaw('('.($orWithoutReports ? "r.options->'reports' is null or " : '')."jsonb_exists_any(r.options->'reports', ?::text[]))", ['{'.implode(',', $reports).'}']))->orderByDesc('r.created_at')->limit(20)
            ->get(['r.id', 'r.trigger', 'r.status', 'r.kind', 'r.options', 'r.range_from', 'r.range_to', 'r.exit_code', 'r.created_at', 'r.started_at', 'r.finished_at', 'u.email as started_by'])
            ->map(fn ($r) => ['source' => 'eis-sync', 'id' => $r->id, 'kind' => strtolower((string) $r->kind), 'trigger' => $r->trigger, 'status' => $r->status, 'started_by' => $r->started_by, 'options' => $r->options === null ? null : array_diff_key((array) json_decode((string) $r->options, true), ['token_encrypted' => 1]),
                'range_from' => $r->range_from, 'range_to' => $r->range_to, 'created_at' => $r->created_at, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at])->all();
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
        $this->inputWorkbook->template($units, (int) $d['year'], $path);

        return response()->download($path, "KWH-BELI-{$d['year']}.xlsx", ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])->deleteFileAfterSend(true);
    }

    /** POST /pengusahaan/inputs/import (multipart `file`): impor templat; seluruh berkas ditolak bila ada baris salah. */
    public function import(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:5120', 'extensions:xlsx,xls']]);
        $this->authorizer->authorizeScope($request->user(), self::INPUT_PERMISSION);
        $r = $this->inputWorkbook->import($request->file('file')->getRealPath(), $request->user());

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
