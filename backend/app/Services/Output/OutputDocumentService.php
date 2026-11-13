<?php

namespace App\Services\Output;

use App\Exceptions\AdministrationDenied;
use App\Services\Mto\MtoService;
use App\Services\Rab\RabService;
use App\Services\WorkOrders\WorkOrderService;
use App\Support\Terbilang;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Output documents of stage 5D (docs/62 §28), built ONLY from stored runs: REKAP (RAB per group) and REKAP RINCI (per KHS line) from a RAB run; KKF and HPE
 * (BP vs RAB comparison) from a KKF run. Each document is a plain structure (title, header, meta, sections with columns/rows/footer, place+date, signatures)
 * that the front end prints and `XlsxRenderer` exports. Signers are the people who actually verified/approved the MTO (never typed). Numbers are the stored ones.
 */
class OutputDocumentService
{
    private const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    public function __construct(private readonly MtoService $mto, private readonly RabService $rab) {}

    /** @return array<string,mixed> */
    public function rekap(string $rabRunId): array
    {
        $run = DB::table('rab_runs')->where('id', $rabRunId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $ctx = $this->context($run->application_id, $run->mto_package_id, $run->created_at);
        $groups = (array) json_decode((string) $run->groups, true);
        $volumes = $this->volumes($run);
        $rows = [];
        $sum = ['material' => 0.0, 'service' => 0.0, 'commissioning' => 0.0, 'k3l' => 0.0, 'insurance' => 0.0, 'subtotal' => 0.0, 'ppn' => 0.0, 'total' => 0.0];
        $no = 0;
        foreach ((array) config('distriva.document.rekap_rows') as $code => $def) {
            $g = $groups[$code] ?? null;
            $row = [++$no, $def['title'], $def['unit'], $volumes[$code] ?? 0.0];
            foreach (array_keys($sum) as $k) {
                $v = (float) ($g[$k] ?? 0);
                $sum[$k] += $v;
                $row[] = $v;
            }
            $rows[] = $row;
        }

        return $this->frame('RAB PERMOHONAN PB/PD', $ctx, [
            ['columns' => ['NO', 'URAIAN PEKERJAAN', 'SAT', 'VOLUME', 'MATERIAL', 'JASA (BKR+PSG)', 'COMMISSIONING', 'SAFETY COST K3L', 'ASURANSI', 'SUB TOTAL (Rp)', 'PPN 11 % (Rp)', 'JUMLAH TOTAL (Rp)'],
                'rows' => $rows, 'footer' => ['', 'JUMLAH', '', '', ...array_values($sum)]],
        ], ['terbilang' => Terbilang::rupiah($sum['total']), 'grand_total' => $sum['total'], 'source' => ['rab_run_id' => $run->id, 'run_number' => (int) $run->run_number, 'snapshot_hash' => $run->snapshot_hash]]);
    }

    /** @return array<string,mixed> */
    public function rinci(string $rabRunId): array
    {
        $run = DB::table('rab_runs')->where('id', $rabRunId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $ctx = $this->context($run->application_id, $run->mto_package_id, $run->created_at);
        $titles = (array) config('distriva.document.rekap_rows');
        $lines = DB::table('rab_run_lines')->where('rab_run_id', $rabRunId)->orderBy('sequence')->get()->groupBy('group_code');
        $sections = [];
        foreach ($titles as $code => $def) {
            $g = $lines->get($code);
            if ($g === null || $g->isEmpty()) {
                continue;
            }
            $rows = [];
            $tot = ['m' => 0.0, 'i' => 0.0, 'r' => 0.0, 'a' => 0.0];
            foreach ($g as $n => $l) {
                $rows[] = [$n + 1, $l->khs_code, $l->khs_name ?? $l->description, $l->unit_text, (float) $l->qty_material, (float) $l->qty_install, (float) $l->qty_remove, $l->material_status,
                    (float) $l->material_cost, (float) $l->install_cost, (float) $l->remove_cost, (float) $l->insurance_cost, $l->category];
                $tot['m'] += (float) $l->material_cost;
                $tot['i'] += (float) $l->install_cost;
                $tot['r'] += (float) $l->remove_cost;
                $tot['a'] += (float) $l->insurance_cost;
            }
            $sections[] = ['heading' => $def['title'], 'columns' => ['NO', 'KODE KHS', 'URAIAN', 'SAT', 'VOL MATERIAL', 'VOL PASANG', 'VOL BONGKAR', 'STATUS MATERIAL', 'BIAYA MATERIAL', 'BIAYA PASANG', 'BIAYA BONGKAR', 'ASURANSI', 'KATEGORI'],
                'rows' => $rows, 'footer' => ['', '', 'JUMLAH', '', '', '', '', '', $tot['m'], $tot['i'], $tot['r'], $tot['a'], '']];
        }

        return $this->frame('RAB PERMOHONAN PB/PD — REKAP RINCI', $ctx, $sections, ['terbilang' => Terbilang::rupiah((float) $run->grand_total), 'grand_total' => (float) $run->grand_total,
            'source' => ['rab_run_id' => $run->id, 'run_number' => (int) $run->run_number, 'snapshot_hash' => $run->snapshot_hash]]);
    }

    /** @return array<string,mixed> */
    public function kkf(string $kkfRunId): array
    {
        [$k, $in, $src, $res, $rab] = $this->kkfRun($kkfRunId);
        $ctx = $this->context($k->application_id, $rab->mto_package_id, $k->created_at);
        $app = $ctx['app'];
        $vol = $this->volumes($rab);
        $sum = fn (array $codes) => array_sum(array_map(fn ($c) => $vol[$c] ?? 0.0, $codes));
        $power = rtrim(rtrim(number_format((float) $app->new_power_value, 3, '.', ''), '0'), '.').' '.$app->new_power_unit;
        $pb = $res['payback'];
        $criteria = $res['criteria'];
        $idpel = $ctx['idpel'];
        $members = (array) ($src['members'] ?? []);
        $der = $in['connection_fee'] > 0 ? ($in['investment'] - $in['connection_fee']) / $in['connection_fee'] : null;

        $doc = $this->frame('KAJIAN KELAYAKAN INVESTASI (KKF)', $ctx, [
            ['heading' => '1. DATA PEKERJAAN', 'pairs' => [['Nama', count($members) > 1 ? implode('; ', array_column($members, 'customer_name')) : $ctx['customer']], ['IDPEL', count($members) > 1 ? implode('; ', array_filter(array_column($members, 'idpel'))) : $idpel], ['Jenis Pengajuan', $app->transaction_type], ['Tarif/Daya', count($members) > 1 ? count($members).' pelanggan (lihat daftar di bawah)' : $app->new_tariff_code.' / '.$power], ['Lokasi', $ctx['address']], ['ULP', $ctx['ulp_name']],
                ['Volume JTM (Kms)', ($sum(['SUTM', 'MVTIC', 'SKTM'])) / 1000], ['Volume Gardu (Set)', $sum(['GTT_KHUSUS', 'GTT_UMUM', 'KUBIKEL'])], ['Volume JTR (Kms)', $sum(['SUTR']) / 1000], ['Volume APP (Buah)', $sum(['PBPD_53_197', 'PBPD_6_41', 'SR1PH'])]]],
            ...(count($members) > 1 ? [['heading' => 'PELANGGAN DALAM USULAN', 'columns' => ['NO', 'NO. PERMOHONAN', 'NAMA', 'IDPEL', 'TARIF', 'DAYA (VA)', 'DAYA HITUNG (kVA)', 'BIAYA PENYAMBUNGAN (Rp)'],
                'rows' => array_map(fn ($m, $i) => [$i + 1, $m['application_number'], $m['customer_name'], $m['idpel'], $m['tariff_code'], $m['power_va'], $m['delta_kva'], $m['fee']], $members, array_keys($members))]] : []),
            ['heading' => 'PERKIRAAN', 'pairs' => [['Anggaran Biaya (Rp)', $in['investment']], ['Sumber Dana', config('distriva.document.funding_source')]]],
            ['heading' => '2. LATAR BELAKANG & DASAR PENGUSULAN', 'pairs' => array_map(fn ($t, $i) => [chr(97 + $i), $t], (array) config('distriva.document.background'), array_keys((array) config('distriva.document.background')))],
            ['heading' => '4. DATA PERHITUNGAN', 'pairs' => [['Biaya Penyambungan (BP) (Rp)', $in['connection_fee']], ['Biaya UJL (Rp)', $src['ujl_total'] ?? null], ['Biaya Estetika/Sharing Investasi (Rp)', $in['esthetic_fee']], ['Jam Nyala Minimum (Jam)', $in['jam_nyala']],
                ['BPP/Marginal Cost (Rp/kWh)', $in['bpp']], ['Discount Rate (%)', round($in['discount_rate'] * 100, 4)], ['Harga Jual Rata-Rata (Rp)', $in['avg_price']]]],
            ['heading' => '3. KAJIAN KELAYAKAN FINANSIAL', 'columns' => ['NO', 'PERHITUNGAN FINANSIAL', 'NILAI', 'SATUAN', 'KRITERIA', 'KESIMPULAN'], 'rows' => [
                [1, 'RWACC', round((float) ($res['rwacc_percent'] ?? 0), 2), '%', '', $res['feasible'] ? 'LAYAK' : 'TIDAK LAYAK'],
                [2, 'IRR', $res['irr_percent'] === null ? null : round((float) $res['irr_percent'], 4), '%', '> '.round($in['discount_rate'] * 100, 2).' %', $criteria['irr_above_discount'] ? 'Terpenuhi' : 'Tidak terpenuhi'],
                [3, 'NPV', round((float) $res['npv']), 'Rp', '> 0 (positif)', $criteria['npv_positive'] ? 'Terpenuhi' : 'Tidak terpenuhi'],
                [4, 'PBP', $pb === null ? 'Tidak tercapai' : $pb['text'], '', '< '.intdiv((int) $in['payback_limit_months'], 12).' Tahun', $criteria['payback_within_5_years'] ? 'Terpenuhi' : 'Tidak terpenuhi'],
                [5, 'Rasio BP', round((float) $res['bp_ratio'], 6), '', '≥ 1 (informasi)', ''],
            ]],
            ['heading' => 'WACC (indikator)', 'pairs' => [['Nilai Proyek (Rp)', $in['investment']], ['DER', $der], ['Equity (Rp)', $der === null ? null : $in['investment'] / (1 + $der)], ['Debt (Rp)', $der === null ? null : $der / (1 + $der) * $in['investment']],
                ['Required ROE', $in['roe']], ['Interest Rate', $in['interest']], ['WACC (%)', $res['rwacc_percent'] ?? null]]],
            ['heading' => 'ARUS KAS (Rp)', 'columns' => ['TAHUN KE', 'ENERGI TERJUAL (MWh)', 'BIAYA TOTAL', 'PENDAPATAN', 'NET', 'KUMULATIF'],
                'rows' => array_map(fn ($y) => [$y['year_index'], round($y['energy_sold_mwh'], 3), round($y['cost_total']), round($y['revenue_total']), round($y['net']), round($y['cumulative'])], $res['years'])],
        ], ['conclusion' => $res['feasible'] ? 'LAYAK' : 'TIDAK LAYAK', 'extended_required' => (bool) $k->extended_required,
            'source' => ['kkf_run_id' => $k->id, 'run_number' => (int) $k->run_number, 'rab_run_number' => (int) $rab->run_number, 'snapshot_hash' => $k->snapshot_hash, 'parameter_set' => $src['parameter_set_name'] ?? null, 'tariff_book' => $src['tariff_book_name'] ?? null]]);
        $doc['document_number'] = $k->document_number;

        return $doc;
    }

    /** @return array<string,mixed> */
    public function hpe(string $kkfRunId): array
    {
        [$k, $in, , , $rab] = $this->kkfRun($kkfRunId);
        $ctx = $this->context($k->application_id, $rab->mto_package_id, $k->created_at);
        $bp = (float) $in['connection_fee'];
        $rabTotal = (float) $rab->grand_total;
        $ratio = $rabTotal > 0 ? $bp / $rabTotal : null;

        return $this->frame('HARGA PERKIRAAN ENGINEERING (HPE)', $ctx, [
            ['columns' => ['NO', 'URAIAN PEKERJAAN', 'SAT', 'VOLUME', 'BP', 'RAB', 'ANALISA'], 'rows' => [[1, 'ANALISA PERBANDINGAN BP BANDING RAB', 'LOT', 1, $bp, $rabTotal, $ratio]], 'footer' => ['', 'JUMLAH', '', '', $bp, $rabTotal, $ratio]],
        ], ['source' => ['kkf_run_id' => $k->id, 'rab_run_number' => (int) $rab->run_number, 'snapshot_hash' => $k->snapshot_hash]]);
    }

    /** BASTP (docs/62 §36): from the frozen content once submitted (the live data while still a draft), with the electronic signatures. @return array<string,mixed> */
    public function bastp(string $bastpId): array
    {
        $b = DB::table('bastps')->where('id', $bastpId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $wo = DB::table('work_orders')->where('id', $b->work_order_id)->first();
        $ctx = $this->context($b->application_id, $wo->mto_package_id, (string) ($b->closed_at ?? $b->created_at));
        $content = $b->content !== null ? (array) json_decode((string) $b->content, true) : null;
        $tasks = $content['tasks'] ?? DB::table('wo_tasks')->where('work_order_id', $wo->id)->orderBy('sequence')->get()->map(fn ($t) => ['title' => $t->title, 'unit' => $t->unit_text, 'volume' => (float) $t->volume, 'verified_percent' => app(WorkOrderService::class)->verifiedPercent($t)])->all();
        $materials = $content['materials'] ?? DB::table('bastp_materials as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->where('m.bastp_id', $bastpId)->orderByRaw('length(k.code), k.code')->get(['k.code', 'm.planned_qty', 'm.installed_qty', 'm.note'])
            ->map(fn ($m) => ['khs_code' => $m->code, 'planned' => (float) $m->planned_qty, 'installed' => $m->installed_qty === null ? null : (float) $m->installed_qty, 'note' => $m->note])->all();
        $meters = DB::table('bastp_meters')->where('bastp_id', $bastpId)->orderBy('meter_number')->get()->map(fn ($m) => [$m->customer_idpel, $m->meter_number, DB::table('bastp_meter_photos')->where('bastp_meter_id', $m->id)->count()])->all();
        $sigs = DB::table('bastp_signatures as s')->join('users as u', 'u.id', '=', 's.signer_user_id')->where('s.bastp_id', $bastpId)->where('s.round', $b->round)->orderBy('s.signed_at')->orderByRaw("case s.step when 'SUBMIT' then 1 when 'ULP_MANAGER' then 2 when 'KONSTRUKSI_UP3' then 3 else 4 end")->get(['s.step', 's.signer_role', 's.signed_at', 's.signature', 'u.name']);
        $labels = ['SUBMIT' => 'PELAKSANA (PIHAK KEDUA)', 'ULP_MANAGER' => 'MANAGER ULP', 'KONSTRUKSI_UP3' => 'KONSTRUKSI UP3', 'ASMAN_KONSTRUKSI' => 'ASMAN KONSTRUKSI'];

        $doc = $this->frame('BERITA ACARA SERAH TERIMA PEKERJAAN (BASTP)', $ctx, [
            ['heading' => 'REFERENSI', 'pairs' => [['Nomor BASTP', $b->bastp_number ?? 'Belum diajukan'], ['Nomor WO', $wo->wo_number], ['Status', $b->status]]],
            ['heading' => 'URAIAN PEKERJAAN', 'columns' => ['NO', 'PEKERJAAN', 'SAT', 'VOLUME', 'PROGRES TERVERIFIKASI (%)'], 'rows' => array_map(fn ($t, $i) => [$i + 1, $t['title'], $t['unit'], $t['volume'], $t['verified_percent']], $tasks, array_keys($tasks))],
            ['heading' => 'LAMPIRAN: REALISASI MATERIAL TERPASANG', 'columns' => ['NO', 'KODE KHS', 'RENCANA', 'TERPASANG', 'SELISIH', 'CATATAN'],
                'rows' => array_map(fn ($m, $i) => [$i + 1, $m['khs_code'], $m['planned'], $m['installed'], $m['installed'] === null ? null : $m['installed'] - $m['planned'], $m['note']], $materials, array_keys($materials))],
            ['heading' => 'BUKTI KWH METER', 'columns' => ['NO', 'ID PELANGGAN', 'NOMOR KWH METER', 'JUMLAH FOTO'], 'rows' => array_map(fn ($m, $i) => [$i + 1, ...$m], $meters, array_keys($meters))],
        ], ['source' => ['bastp_id' => $b->id, 'content_hash' => $b->content_hash, 'round' => (int) $b->round]]);
        $doc['signatures'] = $sigs->map(fn ($s) => ['title' => $labels[$s->step] ?? $s->step, 'name' => $s->name, 'role' => $s->signer_role, 'signed_at' => $s->signed_at, 'signature' => substr($s->signature, 0, 16), 'electronic' => true])->all();
        $doc['document_number'] = $b->bastp_number;
        $doc['electronic_signature_note'] = 'Ditandatangani secara elektronik dalam sistem DISTRIVA (konfirmasi kata sandi); sidik jari tanda tangan = 16 karakter pertama HMAC atas isi beku BASTP. Bukan tanda tangan elektronik tersertifikasi.';

        return $doc;
    }

    /** @return array{0:object,1:array<string,mixed>,2:array<string,mixed>,3:array<string,mixed>,4:object} */
    private function kkfRun(string $id): array
    {
        $k = DB::table('kkf_runs')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $stored = (array) json_decode((string) $k->inputs, true);
        $rab = DB::table('rab_runs')->where('id', $k->rab_run_id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return [$k, (array) $stored['inputs'], (array) $stored['sources'], (array) json_decode((string) $k->result, true), $rab];
    }

    /** Group volumes of a RAB run (public: also used to build the work-order tasks). @return array<string,float> */
    public function groupVolumes(object $rab): array
    {
        return $this->volumes($rab);
    }

    /** Group volumes from the BOM rows named in config (re-evaluating the verified package at its own date). @return array<string,float> */
    private function volumes(object $rab): array
    {
        $pkg = DB::table('mto_packages')->where('id', $rab->mto_package_id)->first();
        $calc = $this->mto->calculate((string) $rab->mto_package_id, substr((string) $pkg->valid_on, 0, 10));
        $out = [];
        foreach ((array) config('distriva.document.rekap_rows') as $code => $def) {
            $out[$code] = (float) array_sum(array_map(fn ($seq) => $calc['volumes'][$code][$seq]['quantity'] ?? 0.0, $def['volume_rows']));
        }

        return $out;
    }

    /** @return array<string,mixed> */
    private function context(string $applicationId, string $packageId, string $at): array
    {
        $app = DB::table('applications')->where('id', $applicationId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $unit = DB::table('organizational_units')->where('id', $app->organizational_unit_id)->first();
        $up3 = $unit->unit_type === 'UP3' ? $unit : DB::table('organizational_units')->where('id', $unit->parent_id)->first();
        $pkg = DB::table('mto_packages')->where('id', $packageId)->first();
        $name = fn ($id) => $id === null ? null : DB::table('users')->where('id', $id)->value('name');
        $city = trim((string) preg_replace('/^(ULP|UP3)\s+/i', '', (string) $unit->name));
        $date = CarbonImmutable::parse($at)->timezone((string) config('distriva.business_timezone'));

        return ['app' => $app, 'customer' => DB::table('customers')->where('id', $app->customer_id)->value('name'), 'address' => $app->service_address, 'ulp_name' => $unit->name, 'up3_name' => $up3?->name,
            'idpel' => DB::table('customer_external_references')->where('customer_id', $app->customer_id)->where('reference_type', 'IDPEL')->orderByDesc('is_primary')->value('reference_value'),
            'place_date' => mb_convert_case($city, MB_CASE_TITLE).', '.$date->format('d').' '.self::MONTHS[$date->month - 1].' '.$date->year,
            'signatures' => [['title' => 'MANAGER ULP', 'name' => $name($pkg->approved_by)], ['title' => 'SPV TEKNIK', 'name' => $name($pkg->verified_by)]]];
    }

    /** @param list<array<string,mixed>> $sections @param array<string,mixed> $extra @return array<string,mixed> */
    private function frame(string $title, array $ctx, array $sections, array $extra): array
    {
        return array_merge(['title' => $title, 'header' => [...(array) config('distriva.document.company'), $ctx['up3_name']],
            'meta' => [['NAMA', $ctx['customer']], ['LOKASI', $ctx['address']], ['ULP', $ctx['ulp_name']], ['No. Permohonan', $ctx['app']->application_number]],
            'sections' => $sections, 'place_date' => $ctx['place_date'], 'signatures' => $ctx['signatures']], $extra);
    }
}
