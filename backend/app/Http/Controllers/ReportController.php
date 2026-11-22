<?php

namespace App\Http\Controllers;

use App\Exceptions\AdministrationDenied;
use App\Services\Authorization\ApplicationAuthorizer;
use App\Services\Authorization\CatalogAuthorizer;
use App\Services\Authorization\ScopedUnitOptions;
use App\Services\Output\DocumentDownload;
use App\Services\Reports\CustomerGrowthService;
use App\Services\Reports\ReportService;
use App\Services\Reports\ReportSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\Response;

/** Dashboard and reports (docs/62 §41). Scope follows `reports.view` (ULP roles: their ULP; UP3 roles: the child ULPs; SYS_ADMIN: all). `?format=json|xlsx|pdf`. */
class ReportController extends Controller
{
    public function __construct(private readonly ApplicationAuthorizer $authorizer, private readonly ReportService $reports, private readonly DocumentDownload $download, private readonly ReportSettings $settings, private readonly CatalogAuthorizer $catalog) {}

    /** GET /reports/settings: the parameters of the stock and vendor reports (read by every report viewer; `can_edit` for the administrator). */
    public function settings(Request $request): JsonResponse
    {
        $this->authorizer->authorizeScope($request->user(), 'reports.view');

        return response()->json(['data' => $this->settings->get() + ['defaults' => ReportSettings::DEFAULTS, 'can_edit' => $this->catalog->allows($request->user(), 'reports.settings')]]);
    }

    /** PUT /reports/settings (reports.settings: administrator) */
    public function saveSettings(Request $request): JsonResponse
    {
        $this->catalog->authorize($request->user(), 'reports.settings');
        $d = Validator::make($request->all(), [
            'stock.usage_months' => ['required', 'integer', 'between:1,12'],
            'stock.warning_factor' => ['required', 'numeric', 'between:1,5'],
            'vendor.weight_completion' => ['required', 'integer', 'between:0,100'],
            'vendor.weight_timeliness' => ['required', 'integer', 'between:0,100'],
            'vendor.weight_quality' => ['required', 'integer', 'between:0,100'],
            'vendor.weight_discipline' => ['required', 'integer', 'between:0,100'],
            'vendor.stale_days' => ['required', 'integer', 'between:1,60'],
            'vendor.good_min' => ['required', 'integer', 'between:1,100'],
            'vendor.fair_min' => ['required', 'integer', 'between:0,99'],
        ])->validate();

        return response()->json(['data' => $this->settings->save(['stock' => $d['stock'], 'vendor' => $d['vendor']], $request->user()), 'message' => 'Pengaturan laporan disimpan.']);
    }

    public function overview(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $data = $this->reports->overview($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            $rows = [];
            foreach ($data as $section => $values) {
                foreach ((array) $values as $k => $v) {
                    if (is_array($v)) {
                        foreach ($v as $kk => $vv) {
                            $rows[] = [$section.'.'.$k, (string) $kk, $vv];
                        }
                    } else {
                        $rows[] = [$section, (string) $k, $v];
                    }
                }
            }

            return $this->file($this->reports->doc('RINGKASAN OPERASIONAL PB/PD', [['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'kini')]], [['columns' => ['BAGIAN', 'INDIKATOR', 'NILAI'], 'rows' => $rows]]), 'RINGKASAN-OPERASIONAL');
        }

        return response()->json(['data' => $data]);
    }

    public function pipeline(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $rows = $this->reports->pipeline($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('ALUR PEKERJAAN PER ULP', [['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'kini')]], [['columns' => ['KODE ULP', 'ULP', 'PERMOHONAN', 'SURVEY', 'GAMBAR DISETUJUI', 'MTO DISETUJUI', 'RAB', 'KKF', 'WO TERBIT', 'WO SELESAI', 'BASTP DITUTUP'],
                'rows' => array_map(fn ($r) => array_values($r), $rows)]]), 'ALUR-PEKERJAAN');
        }

        return response()->json(['data' => $rows]);
    }

    public function sla(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $data = $this->reports->sla($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            $rows = array_map(function ($r) {
                return [
                    $r['application_number'],
                    $r['unit_code'],
                    $r['customer_name'],
                    $r['tariff_power'],
                    $r['created_at'],
                    $r['current_status'],
                    $r['current_stage'],
                    $r['age_days'],
                    $r['t1_survey_days'] ?? '-',
                    $r['t2_drawing_days'] ?? '-',
                    $r['t3_wo_days'] ?? '-',
                    $r['t4_execution_days'] ?? '-',
                    $r['total_cycle_days'] ?? '-',
                    $r['sla_status'],
                    $r['service_category'] === null ? 'Umum (lebih dari 25 hari / survei lebih dari 3 hari)' : $r['service_category'].' ('.$r['service_working_days'].' hari kerja)',
                    $r['service_due_date'] ?? '-',
                    $r['service_status'] === null ? '-' : $r['service_status'],
                    $r['delay_note'] ?? ($r['needs_note'] ? 'BELUM ADA KETERANGAN' : '-'),
                ];
            }, $data['rows']);

            $meta = [
                ['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'kini')],
                ['Total Permohonan', $data['summary']['total_applications']],
                ['Permohonan Melebihi SLA', $data['summary']['overdue_count']],
                ['Melewati SLA Tanpa Keterangan', $data['summary']['needs_note_count']],
                ['Rata-rata Siklus Selesai (Hari)', $data['summary']['average_total_cycle_days']],
            ];

            return $this->file($this->reports->doc('LAPORAN SLA DAN AGING SIKLUS PENYAMBUNGAN', $meta, [[
                'columns' => ['NO. PERMOHONAN', 'KODE ULP', 'PELANGGAN', 'TARIF & DAYA', 'TGL MOHON', 'STATUS', 'TAHAPAN', 'UMUR (HARI)', 'T1 MOHON-SURVEI', 'T2 SURVEI-GAMBAR', 'T3 GAMBAR-SPK', 'T4 SPK-NYALA', 'TOTAL SIKLUS', 'STATUS SLA', 'ACUAN SLA', 'TENGGAT LAYANAN', 'STATUS LAYANAN', 'KETERANGAN KETERLAMBATAN'],
                'rows' => $rows,
            ]]), 'LAPORAN-SLA');
        }

        return response()->json(['data' => $data]);
    }

    public function costVariance(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $rows = $this->reports->costVariance($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('LAPORAN REALISASI BIAYA RAB VS SPK VS BASTP', [['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'kini')]], [[
                'columns' => ['NO. PERMOHONAN', 'KODE ULP', 'ULP', 'PELANGGAN', 'ESTIMASI RAB (RP)', 'NO. SPK / WO', 'STATUS SPK', 'VENDOR', 'NO. BASTP', 'STATUS BASTP'],
                'rows' => array_map(fn ($r) => array_values($r), $rows),
            ]]), 'REALISASI-BIAYA-RAB-SPK');
        }

        return response()->json(['data' => $rows]);
    }

    public function vendorPerformance(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $rows = $this->reports->vendorPerformance($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('LAPORAN KINERJA DAN EVALUASI VENDOR', [['Tanggal Cetak', now()->toDateString()]], [[
                'columns' => ['KODE MITRA', 'NAMA MITRA / VENDOR', 'TOTAL SPK', 'SELESAI', 'BERJALAN', 'DIBATALKAN', 'REVISI BASTP', 'TINGKAT SELESAI (%)', 'RATA-RATA PROGRES (%)', 'SPK TANPA LAPORAN >7 HARI', 'LAPORAN DITOLAK', 'RATA-RATA HARI SELESAI', 'TEPAT WAKTU', 'TERLAMBAT / LEWAT TARGET', 'SKOR', 'PENILAIAN'],
                'rows' => array_map(fn ($r) => [$r['vendor_code'], $r['vendor_name'], $r['total_wo'], $r['completed_wo'], $r['in_progress_wo'], $r['cancelled_wo'], $r['bastp_revision_count'], $r['completion_rate'], $r['avg_progress'], $r['stale_wo'], $r['rejected_progress'], $r['avg_days_to_complete'], $r['on_time_rate'], $r['late_wo'] + $r['overdue_wo'], $r['score'], $r['rating']], $rows),
            ]]), 'RAPOR-KINERJA-VENDOR');
        }

        return response()->json(['data' => $rows]);
    }

    /** GET /reports/customer-growth: analisis penambahan pelanggan dan daya per bulan dan tahun (realisasi sambung), per UP3/ULP; `?format=xlsx|pdf` untuk ekspor. */
    public function customerGrowth(Request $request, CustomerGrowthService $growth): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $d = $growth->trend($units, $from, $to);
        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            $num = fn ($v) => $v === null ? '' : $v;

            return $this->file($this->reports->doc('ANALISIS PENAMBAHAN PELANGGAN DAN DAYA', [['Periode', ($from ?? 'awal').' s.d. '.($to ?? 'sekarang')], ['Dasar', 'Permohonan tersambung (PEREMAJAAN)'], ['Tanggal Cetak', now()->toDateString()]], [
                ['heading' => 'PER TAHUN', 'columns' => ['TAHUN', 'BULAN TERCAKUP', 'PB (PELANGGAN BARU)', 'DAYA PB (kVA)', 'RATA-RATA kVA/PB', 'PD NAIK (kVA)', 'PD TURUN (kVA)', 'PD NETO (kVA)', 'PERTUMBUHAN PB (%)', 'PERTUMBUHAN DAYA PB (%)'],
                    'rows' => array_map(fn ($y) => [$y['year'], $y['months'], $y['pb_count'], $y['pb_kva'], $num($y['avg_kva_per_pb']), $y['pd_up_kva'], $y['pd_down_kva'], $y['pd_net_kva'], $num($y['yoy_pct']), $num($y['yoy_kva_pct'])], $d['yearly'])],
                ['heading' => 'PER BULAN', 'columns' => ['BULAN', 'PB', 'DAYA PB (kVA)', 'PD NAIK', 'PD TURUN', 'PD SAMA', 'PD NETO (kVA)', 'PERMOHONAN PB MASUK', 'PERMOHONAN PD MASUK', 'BATAL', 'RESTITUSI', 'MoM (%)', 'YoY (%)', 'KETERANGAN'],
                    'rows' => array_map(fn ($m) => [$m['month'], $m['pb_count'], $m['pb_kva'], $m['pd_up_count'], $m['pd_down_count'], $m['pd_same_count'], $m['pd_net_kva'], $m['requests_pb'], $m['requests_pd'], $m['cancelled'], $m['refunded'], $num($m['mom_pct']), $num($m['yoy_pct']), $m['partial'] ? 'bulan berjalan (belum lengkap)' : ''], $d['monthly'])],
                ['heading' => 'PER KELOMPOK TARIF (PB)', 'columns' => ['KELOMPOK', 'PB', 'PORSI (%)', 'DAYA (kVA)', 'PORSI DAYA (%)', 'RATA-RATA kVA'],
                    'rows' => array_map(fn ($g) => [$g['group'], $g['count'], $g['share_pct'], $g['kva'], $g['kva_share_pct'], $num($g['avg_kva'])], $d['by_tariff']['groups'])],
                ['heading' => 'PER ULP (total periode, rata-rata per tahun, 12 bulan terakhir)', 'columns' => ['KODE', 'ULP', 'UP3', 'PB TOTAL PERIODE', 'RATA-RATA PB/TAHUN', 'PB 12 BULAN TERAKHIR', 'DAYA PB TOTAL (kVA)', 'DAYA PB 12 BULAN (kVA)', 'RATA-RATA kVA/PB', 'PD NETO (kVA)', 'BASIS PELANGGAN AKTIF (DIL)', 'BASIS DAYA (kVA)', '12 BULAN TERHADAP BASIS (%)'],
                    'rows' => array_map(fn ($u) => [$u['unit_code'], $u['unit_name'], $u['up3_name'], $u['pb_count'], $num($u['avg_pb_per_year']), $u['l12m_pb'], $u['pb_kva'], $u['l12m_kva'], $num($u['avg_kva_per_pb']), $u['pd_net_kva'], $u['base_customers'], $u['base_kva'], $num($u['l12m_vs_base_pct'])], $d['by_unit'])],
                ['heading' => 'PER ULP PER TAHUN (PB)', 'columns' => array_merge(['ULP'], array_map(fn ($y) => 'PB '.$y['year'], $d['yearly'])),
                    'rows' => array_map(fn ($u) => array_merge([$u['unit_name']], array_map(fn ($y) => collect($u['by_year'])->firstWhere('year', $y['year'])['pb_count'] ?? 0, $d['yearly'])), $d['by_unit'])],
            ]), 'ANALISIS-PELANGGAN-DAYA');
        }

        return response()->json(['data' => $d]);
    }

    public function dashboardSummary(Request $request): JsonResponse
    {
        $data = $this->reports->dashboardSummary($request->user(), $this->authorizer);

        return response()->json(['data' => $data]);
    }

    /** GET /reports/critical-stock */
    public function criticalStock(Request $request): JsonResponse|Response
    {
        [$units] = $this->filters($request);
        $res = $this->reports->criticalStock($units);

        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('MONITORING STOK KRITIS & BUFFER MATERIAL', [['Tanggal Cetak', now()->toDateString()]], [[
                'columns' => ['KODE KHS', 'NAMA MATERIAL', 'SATUAN', 'STOK FISIK', 'TERALOKASI', 'TERSEDIA', 'PEMAKAIAN/BULAN', 'STOK MINIMUM', 'DATANG (1 BULAN)', 'PROYEKSI', 'KEKURANGAN', 'STATUS STOK'],
                'rows' => array_map(fn ($r) => [
                    $r['khs_code'],
                    $r['khs_name'],
                    $r['unit'],
                    $r['on_hand'],
                    $r['reserved'],
                    $r['available'],
                    $r['monthly_usage'],
                    $r['min_stock'],
                    $r['incoming'],
                    $r['projected'],
                    $r['shortage'],
                    $r['stock_status'],
                ], $res['rows']),
            ]]), 'LAPORAN-STOK-KRITIS');
        }

        return response()->json(['data' => $res]);
    }

    /** GET /reports/kkf-feasibility */
    public function kkfFeasibility(Request $request): JsonResponse|Response
    {
        [$units, $from, $to] = $this->filters($request);
        $res = $this->reports->kkfFeasibility($units, $from, $to);

        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('ANALISIS KELAYAKAN KKF & PROYEKSI PENDAPATAN', [['Tanggal Cetak', now()->toDateString()]], [[
                'columns' => ['NO. PERMOHONAN', 'ULP', 'PELANGGAN', 'TARIF & DAYA', 'CAPEX RAB', 'STATUS KKF', 'PBP (BULAN)', 'PBP (TAHUN)', 'NPV', 'IRR (%)', 'PERLUASAN KHUSUS'],
                'rows' => array_map(fn ($r) => [
                    $r['application_number'],
                    $r['unit_code'],
                    $r['customer_name'],
                    $r['tariff_power'],
                    $r['capex_rab'],
                    $r['status_label'],
                    $r['payback_months'] ?? '-',
                    $r['payback_years'] ?? '-',
                    $r['npv'],
                    $r['irr_percent'] ?? '-',
                    $r['extended_required'] ? 'YA (> 60 BLN)' : 'TIDAK',
                ], $res['rows']),
            ]]), 'ANALISIS-KELAYAKAN-KKF');
        }

        return response()->json(['data' => $res]);
    }

    /** GET /reports/erp-anomalies */
    public function erpAnomalies(Request $request): JsonResponse|Response
    {
        [$units] = $this->filters($request);
        $res = $this->reports->erpAnomalies($units);

        if (in_array($request->query('format'), DocumentDownload::FORMATS, true)) {
            return $this->file($this->reports->doc('ANOMALI & REKONSILIASI SELURUH PROSES', [['Tanggal Cetak', now()->toDateString()]], [
                [
                    'heading' => 'Anomali sepanjang proses',
                    'columns' => ['TAHAP', 'JENIS', 'TINGKAT', 'REFERENSI', 'ULP', 'KETERANGAN', 'SEJAK', 'UMUR (HARI)'],
                    'rows' => array_map(fn ($r) => [$r['stage'], $r['category_label'], $r['severity'], $r['reference'], $r['unit_name'], $r['detail'], $r['since'] ?? '-', $r['age_days']], $res['process_anomalies']),
                ],
                [
                    'heading' => 'SKU MIMS belum terpetakan',
                    'columns' => ['SKU ERP', 'NAMA MATERIAL', 'SATUAN', 'STOK SIAP', 'KODE GUDANG', 'NAMA GUDANG', 'TANGGAL CUPLIKAN'],
                    'rows' => array_map(fn ($r) => [
                        $r->material_no,
                        $r->material_name ?? '-',
                        $r->unit ?? '-',
                        $r->stock_ready,
                        $r->warehouse_code,
                        $r->warehouse_name,
                        $r->as_of,
                    ], $res['unmapped_materials']),
                ],
                [
                    'heading' => 'Kegagalan sinkronisasi tarik stok',
                    'columns' => ['KODE GUDANG', 'NAMA GUDANG', 'STATUS', 'PESAN', 'WAKTU'],
                    'rows' => array_map(fn ($r) => [$r->warehouse_code, $r->warehouse_name, $r->status, $r->message ?? '-', $r->started_at], $res['sync_failures']),
                ],
            ]), 'ANOMALI-SELURUH-PROSES');
        }

        return response()->json(['data' => $res]);
    }

    /** GET /rkm/versions/{id}/reports/{type} — type per-ulp | comparison | critical (UP3-level readers of the RKM). */
    public function rkm(Request $request, string $version, string $type): JsonResponse|Response
    {
        $v = DB::table('rkm_versions')->where('id', $version)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $plan = DB::table('rkm_plans')->where('id', $v->plan_id)->first();
        $actor = $request->user();
        if ($this->authorizer->roleFor($actor, 'rkm.view') === null) {
            throw new AdministrationDenied('Tidak berwenang.', 403);
        }
        if (! $this->authorizer->holdsOnUp3($actor, 'rkm.view', $plan->up3_unit_id)) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $doc = $this->reports->rkm($version, $type);

        return in_array($request->query('format'), DocumentDownload::FORMATS, true) ? $this->file($doc, 'RKM-'.$type) : response()->json(['data' => $doc]);
    }

    /** GET /reports/units — Returns accessible UP3 and ULP units for report filters based on user role and scope. */
    public function units(Request $request, ScopedUnitOptions $options): JsonResponse
    {
        return response()->json($options->for($request->user(), 'reports.view'));
    }

    /** @return array{0:list<string>,1:?string,2:?string} */
    private function filters(Request $request): array
    {
        $scope = $this->authorizer->authorizeScope($request->user(), 'reports.view');
        $d = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'unit_id' => ['nullable', 'uuid'],
            'up3_id' => ['nullable', 'uuid'],
            'format' => ['nullable', 'in:json,xlsx,pdf'],
        ]);
        $units = $scope['unrestricted'] ? DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('id')->all() : $scope['units'];

        if (! empty($d['up3_id'])) {
            $childUlps = DB::table('organizational_units')
                ->where('parent_id', $d['up3_id'])
                ->where('unit_type', 'ULP')
                ->pluck('id')
                ->all();
            $units = array_values(array_intersect($units, $childUlps));
        }

        if (! empty($d['unit_id'])) {
            if (! in_array($d['unit_id'], $units, true)) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            $units = [$d['unit_id']];
        }

        return [$units, $d['from'] ?? null, $d['to'] ?? null];
    }

    /** @param array<string,mixed> $doc */
    private function file(array $doc, string $name): Response
    {
        return $this->download->response($doc, (string) request()->query('format'), $name);
    }
}
