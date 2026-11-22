<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Outages\OutageAnalysisService;
use App\Services\Outages\OutageForecastService;
use App\Services\Output\DocumentDownload;
use App\Services\Reports\ReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/** Analisis gangguan penyulang (docs/86). Cakupan mengikuti outages.view: ULP melihat ULP-nya, UP3 melihat ULP di bawahnya, SYS_ADMIN semuanya (termasuk peristiwa tanpa ULP). */
class OutageAnalysisController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly OutageAnalysisService $analysis, private readonly OutageForecastService $forecast, private readonly ReportService $reports, private readonly DocumentDownload $download) {}

    public function index(Request $request): JsonResponse|Response
    {
        [$units, $unassigned, $from, $to] = $this->filters($request);
        $d = $this->analysis->analysis($units, $unassigned, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            $num = fn ($v) => $v === null ? '' : $v;

            return $this->download->response($this->reports->doc('ANALISIS GANGGUAN PENYULANG', [['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'sekarang')], ['Tanggal Cetak', now()->toDateString()], ['Definisi SAIFI/SAIDI', 'Pelanggan terdampak = seluruh pelanggan aktif penyulang; ambang '.$d['settings']['saidi_min_minutes'].' menit']], [
                ['heading' => 'PER TAHUN', 'columns' => ['TAHUN', 'BULAN', 'GANGGUAN', 'PERMANEN', 'TEMPORER', 'MENIT PADAM', 'ENS (kWh)', 'SAIFI', 'SAIDI (menit)', 'PERTUMBUHAN GANGGUAN (%)', 'PERTUMBUHAN ENS (%)'],
                    'rows' => array_map(fn ($y) => [$y['year'], $y['months'], $y['events'], $y['permanent'], $y['temporary'], $y['minutes'], $y['ens_kwh'], $y['saifi'], $y['saidi'], $num($y['events_yoy_pct']), $num($y['ens_yoy_pct'])], $d['yearly'])],
                ['heading' => 'PER BULAN', 'columns' => ['BULAN', 'GANGGUAN', 'PERMANEN', 'TEMPORER', 'MENIT PADAM', 'ENS (kWh)', 'SAIFI', 'SAIDI (menit)', 'KETERANGAN'],
                    'rows' => array_map(fn ($m) => [$m['month'], $m['events'], $m['permanent'], $m['temporary'], $m['minutes'], $m['ens_kwh'], $m['saifi'], $m['saidi'], $m['partial'] ? 'bulan berjalan' : ''], $d['monthly'])],
                ['heading' => 'PER ULP', 'columns' => ['ULP', 'UP3', 'GANGGUAN', 'PERMANEN', 'TEMPORER', 'ENS (kWh)', 'PELANGGAN AKTIF', 'SAIFI', 'SAIDI (menit)'],
                    'rows' => array_map(fn ($u) => [$u['unit_name'], $u['up3_name'], $u['events'], $u['permanent'], $u['temporary'], $u['ens_kwh'], $u['customers'], $u['saifi'], $u['saidi']], $d['by_unit'])],
                ['heading' => 'PENYULANG (40 TERBANYAK)', 'columns' => ['PENYULANG', 'GI', 'GANGGUAN', 'PERMANEN', 'TEMPORER', 'ENS (kWh)', 'GANGGUAN 12 BULAN', '12 BULAN SEBELUMNYA', 'TREN (%)', 'PELANGGAN', 'GARDU', 'KONTRIBUSI SAIFI', 'KONTRIBUSI SAIDI'],
                    'rows' => array_map(fn ($f) => [$f['name'], $f['gi_name'], $f['events'], $f['permanent'], $f['temporary'], $f['ens_kwh'], $f['l12m_events'], $f['prev12m_events'], $num($f['trend_pct']), $f['customers'], $f['gardu'], $num($f['saifi_contribution']), $num($f['saidi_contribution'])], $d['by_feeder'])],
                ['heading' => 'PENYEBAB', 'columns' => ['KATEGORI', 'GANGGUAN', 'PORSI (%)', 'PERMANEN', 'ENS (kWh)'], 'rows' => array_map(fn ($c) => [$c['label'], $c['events'], $c['share_pct'], $c['permanent'], $c['ens_kwh']], $d['by_cause'])],
            ]), (string) $request->query('format'), 'ANALISIS-GANGGUAN-PENYULANG');
        }

        return response()->json(['data' => $d]);
    }

    public function feeder(Request $request, string $feeder): JsonResponse
    {
        [$units, $unassigned] = $this->filters($request);
        $d = $this->analysis->feederDetail($feeder, $units, $unassigned);
        if ($d === null) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return response()->json(['data' => $d]);
    }

    public function forecast(Request $request): JsonResponse
    {
        [$units, $unassigned] = $this->filters($request, false);

        return response()->json(['data' => $this->forecast->forecast($units, $unassigned)]);
    }

    /** @return array{0:list<string>,1:bool,2:?string,3:?string} */
    private function filters(Request $request, bool $withDates = true): array
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'outages.view');
        $d = $request->validate(['from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'], 'unit_id' => ['nullable', 'uuid'], 'up3_id' => ['nullable', 'uuid'], 'format' => ['nullable', 'in:json,xlsx,pdf']]);
        $units = $scope['unrestricted'] ? DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('id')->all() : $scope['units'];
        $narrowed = false;
        if (! empty($d['up3_id'])) {
            $units = array_values(array_intersect($units, DB::table('organizational_units')->where('parent_id', $d['up3_id'])->where('unit_type', 'ULP')->pluck('id')->all()));
            $narrowed = true;
        }
        if (! empty($d['unit_id'])) {
            if (! in_array($d['unit_id'], $units, true)) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            $units = [$d['unit_id']];
            $narrowed = true;
        }

        return [$units, $scope['unrestricted'] && ! $narrowed, $withDates ? ($d['from'] ?? null) : null, $withDates ? ($d['to'] ?? null) : null];
    }
}
