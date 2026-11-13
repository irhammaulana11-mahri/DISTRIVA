<?php

namespace App\Services\Kkf;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Drawings\ApprovalLock;
use App\Services\Proposals\ProposalService;
use App\Services\Surveys\SurveyService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * KKF run of one application (docs/62 §26). Typed by the runner only: the esthetic fee (and, for a power change to a POSTPAID meter, the PREVIOUS meter mode, which the data does not hold).
 * The meter mode comes from the synced PAKET_SAR (`applications.sar_package`: Prabayar / Pascabayar). The connection fee (BP) is the synced EIS TOTALBIAYA (`applications.total_cost`);
 * for a POSTPAID meter the UJL is deducted, for PREPAID it is not (owner 2026-11-07). UJL = tariff-book Rp/VA x power in VA, where the power is the DELTA old -> new, except
 * a new connection (PB) or a change from prepaid to postpaid, which count from zero to the current power. The rest: investment = grand total of the
 * chosen (default: latest) RAB run; discount rate, BPP, O&M, load factor, ROE, interest, tax, horizon and payback limit = the approved parameter set
 * in force; average price and jam nyala = the approved tariff book row of the NEW tariff/power and the application's ULP; power = delta kVA.
 * A stored run is immutable (trigger) and carries the full input snapshot + hash. A run only RECORDS feasibility: the approval chain stays in the drawing
 * approval (docs/41 §3.1); `extended_required` says that chain needs the extended step (not feasible, including payback over the limit).
 */
class KkfService
{
    public const ENGINE = 'kkf-1';

    public function __construct(private readonly KkfCalculator $calculator, private readonly KkfParameterService $parameters, private readonly TariffBookService $tariffs) {}

    /**
     * KKF of ONE application, or of a PROPOSAL with several customers (owner 7 Nov 2026): `$in['members']` = [{application_id, previous_meter_payment?}] limits/annotates the members; the
     * investment is the latest RAB run of the representative application. For several members the existing formulas stay exact with power-weighted aggregates: power = sum of the delta
     * powers, jam nyala = power-weighted mean, average price = energy-weighted mean (so energy and revenue equal the sum of the customers'), connection fee = sum of the customers' fees.
     *
     * @param  array{previous_meter_payment?: 'PRABAYAR'|'PASCABAYAR'|null, members?: list<array{application_id:string,previous_meter_payment?:?string}>, esthetic_fee?: numeric|null, rab_run_id?: string|null, date?: string|null}  $in
     * @return array<string,mixed>
     */
    public function calculate(string $applicationId, array $in, ?string $proposalId = null): array
    {
        $rep = DB::table('applications')->where('id', $applicationId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        self::assertExtensionApplies($applicationId);
        ApprovalLock::assertOpen($applicationId, 'KKF');
        $date = $in['date'] ?? CarbonImmutable::today()->toDateString();
        $ids = $proposalId === null ? [$applicationId] : ProposalService::memberIds($proposalId);
        $prev = [];
        foreach ((array) ($in['members'] ?? []) as $m) {
            if (! in_array($m['application_id'], $ids, true)) {
                throw new AssignmentRuleViolation('Anggota '.$m['application_id'].' bukan bagian dari usulan ini.');
            }
            $prev[$m['application_id']] = $m['previous_meter_payment'] ?? null;
        }
        $rabQuery = DB::table('rab_runs')->where('application_id', $applicationId);
        $rab = isset($in['rab_run_id']) ? (clone $rabQuery)->where('id', $in['rab_run_id'])->first() : (clone $rabQuery)->orderByDesc('run_number')->first();
        if ($rab === null) {
            throw new AssignmentRuleViolation(isset($in['rab_run_id']) ? 'Run RAB tidak ditemukan pada permohonan ini.' : 'Permohonan belum memiliki run RAB.');
        }
        $params = $this->parameters->resolve($date) ?? throw new AssignmentRuleViolation("Belum ada set parameter KKF yang disetujui dan berlaku pada {$date}.");

        $members = [];
        foreach ($ids as $id) {
            $members[] = $this->member(DB::table('applications')->where('id', $id)->first(), $date, $proposalId === null ? ($in['previous_meter_payment'] ?? null) : ($prev[$id] ?? null));
        }
        $one = count($members) === 1;
        $sumDelta = array_sum(array_column($members, 'delta_kva'));
        $energyBase = array_sum(array_map(fn ($m) => $m['delta_kva'] * $m['jam_nyala'], $members));
        $jam = $one ? $members[0]['jam_nyala'] : $energyBase / $sumDelta;
        $price = $one ? $members[0]['avg_price'] : array_sum(array_map(fn ($m) => $m['delta_kva'] * $m['jam_nyala'] * $m['avg_price'], $members)) / $energyBase;
        $fee = array_sum(array_column($members, 'fee'));
        // load factor: the planner may set it per run (owner 2026-11-09, usually 0.8); otherwise the parameter set's value. The source is recorded in the snapshot.
        $manualLoad = isset($in['load_factor']) && $in['load_factor'] !== '';
        $loadFactor = $manualLoad ? (float) $in['load_factor'] : (float) $params->load_factor;

        $inputs = [
            'investment' => (float) $rab->grand_total, 'connection_fee' => $fee, 'esthetic_fee' => (float) ($in['esthetic_fee'] ?? 0),
            'power_kva' => (float) $sumDelta, 'jam_nyala' => (float) $jam, 'avg_price' => (float) $price,
            'bpp' => (float) $params->bpp, 'discount_rate' => (float) $params->discount_rate, 'om_rate' => (float) $params->om_rate, 'load_factor' => $loadFactor,
            'roe' => (float) $params->roe, 'interest' => (float) $params->interest_rate, 'tax' => (float) $params->tax_rate, 'horizon' => (int) $params->horizon_years,
            'payback_limit_months' => (int) $params->payback_limit_months, 'start_year' => (int) CarbonImmutable::parse($date)->year,
        ];
        try {
            $result = $this->calculator->calculate($inputs);
        } catch (\InvalidArgumentException $e) {
            throw new AssignmentRuleViolation($e->getMessage(), 0, $e);
        }
        $first = $members[0];
        $same = fn (string $k) => count(array_unique(array_column($members, $k))) === 1 ? $first[$k] : 'MIXED';
        $sources = ['application_id' => $applicationId, 'proposal_id' => $proposalId, 'rab_run_id' => $rab->id, 'rab_run_number' => (int) $rab->run_number, 'rab_snapshot_hash' => $rab->snapshot_hash, 'parameter_set_id' => $params->id, 'parameter_set_name' => $params->name, 'load_factor_source' => $manualLoad ? 'MANUAL' : 'PARAMETER_SET',
            'tariff_book_id' => $first['row']->tariff_book_id, 'tariff_book_name' => $first['row']->book_name, 'tariff_row_id' => $first['row']->id, 'tariff_code' => $same('tariff_code'), 'power_va' => $one ? $first['row']->power_va : null,
            'tariff_row_ulp_specific' => $first['row']->ulp_unit_id !== null, 'meter_payment' => $same('mode'), 'meter_payment_source' => $one ? 'PAKET_SAR: '.$first['sar_package'] : 'PAKET_SAR per pelanggan', 'previous_meter_payment' => $one ? $first['previous'] : null,
            'ujl_basis' => $same('basis'), 'total_cost' => array_sum(array_column($members, 'total_cost')), 'ujl_per_va' => $one ? $first['ujl_per_va'] : null, 'ujl_total' => array_sum(array_map(fn ($m) => $m['ujl_total'] ?? 0, $members)),
            'ujl_power_va' => array_sum(array_column($members, 'ujl_power_va')), 'valid_on' => $date, 'engine' => self::ENGINE,
            'members' => array_map(fn ($m) => array_diff_key($m, ['row' => 1]) + ['tariff_row_id' => $m['row']->id], $members)];
        $hash = hash('sha256', json_encode(['inputs' => $inputs, 'sources' => $sources], JSON_THROW_ON_ERROR));

        return ['application_id' => $applicationId, 'proposal_id' => $proposalId, 'valid_on' => $date, 'inputs' => $inputs, 'sources' => $sources, 'result' => $result,
            'feasible' => (bool) $result['feasible'], 'extended_required' => ! $result['feasible'], 'snapshot_hash' => $hash];
    }

    /**
     * What the KKF form shows BEFORE a dry run: the connection fee (BP) the calculation will use (EIS total cost minus the UJL of a postpaid meter), its breakdown, and what still blocks the run
     * (the KKF needs a RAB run, which needs an approved MTO package). Never throws for a missing piece: each one becomes a blocker text.
     *
     * @return array<string,mixed>
     */
    public function preview(string $applicationId, ?string $date = null, ?string $previous = null): array
    {
        $app = DB::table('applications')->where('id', $applicationId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $date ??= CarbonImmutable::today()->toDateString();
        $blockers = [];
        try {
            self::assertExtensionApplies($applicationId);
        } catch (AssignmentRuleViolation $e) {
            $blockers[] = $e->getMessage();
        }
        $out = ['application_type' => $app->application_type, 'sar_package' => $app->sar_package, 'meter_mode' => null, 'total_cost' => $app->total_cost === null ? null : (float) $app->total_cost, 'ujl_per_va' => null, 'ujl_power_va' => null, 'ujl_total' => null,
            'ujl_basis' => null, 'connection_fee' => null, 'needs_previous_meter' => false, 'valid_on' => $date];
        try {
            $out['meter_mode'] = $this->meterMode((string) $app->sar_package);
        } catch (AssignmentRuleViolation $e) {
            $blockers[] = $e->getMessage();
        }
        $out['needs_previous_meter'] = $out['meter_mode'] === 'PASCABAYAR' && $app->application_type !== 'PB';
        if ($out['meter_mode'] !== null && ! ($out['needs_previous_meter'] && $previous === null)) {
            try {
                $m = $this->member($app, $date, $previous);
                $out = ['ujl_per_va' => $m['ujl_per_va'], 'ujl_power_va' => $m['ujl_power_va'], 'ujl_total' => $m['ujl_total'], 'ujl_basis' => $m['basis'], 'connection_fee' => $m['fee']] + $out;
            } catch (AssignmentRuleViolation $e) {
                $blockers[] = $e->getMessage();
            }
        }
        $rab = DB::table('rab_runs')->where('application_id', $applicationId)->orderByDesc('run_number')->first(['id', 'run_number']);
        $mto = DB::table('mto_packages')->where('application_id', $applicationId)->orderByDesc('created_at')->first(['id', 'status']);
        if ($rab === null) {
            $blockers[] = $mto === null
                ? 'Belum ada run RAB: paket MTO belum dibuat. Selesaikan survei dan gambar, susun MTO, setujui, lalu jalankan RAB.'
                : ($mto->status === 'APPROVED' ? 'Belum ada run RAB. Jalankan RAB dari paket MTO yang sudah disetujui, lalu hitung KKF.' : "Belum ada run RAB: paket MTO masih berstatus {$mto->status}. Selesaikan persetujuan MTO, lalu jalankan RAB.");
        }

        return $out + ['rab_run' => $rab === null ? null : ['id' => $rab->id, 'run_number' => (int) $rab->run_number], 'mto_package' => $mto === null ? null : ['id' => $mto->id, 'status' => $mto->status],
            'ready' => $rab !== null && $blockers === [], 'blockers' => array_values(array_unique($blockers))];
    }

    /** One customer's share of a KKF: tariff row (new tariff and power, the ULP), delta power, connection fee (EIS total cost minus the UJL of a postpaid meter). @return array<string,mixed> */
    private function member(object $app, string $date, ?string $previous): array
    {
        $label = $app->application_number;
        if ($app->new_tariff_code === null || $app->new_power_value === null || $app->new_power_unit === null) {
            throw new AssignmentRuleViolation("Permohonan {$label}: tarif dan daya sesudah perubahan belum lengkap.");
        }
        if ($app->delta_power_kva === null || (float) $app->delta_power_kva <= 0) {
            throw new AssignmentRuleViolation("Permohonan {$label}: daya hitung (selisih daya) belum ada atau tidak positif.");
        }
        $powerVa = (int) round((float) $app->new_power_value * (strtoupper((string) $app->new_power_unit) === 'KVA' ? 1000 : 1));
        $row = $this->tariffs->resolve((string) $app->organizational_unit_id, (string) $app->new_tariff_code, $powerVa, $date);
        if ($app->total_cost === null || (float) $app->total_cost <= 0) {
            throw new AssignmentRuleViolation("Permohonan {$label}: total biaya (TOTALBIAYA dari sinkronisasi EIS) belum ada; biaya penyambungan tidak dapat ditentukan.");
        }
        $mode = $this->meterMode((string) $app->sar_package);
        $prepaid = $mode === 'PRABAYAR';
        $powerVaForUjl = (float) $app->delta_power_kva * 1000;
        $basis = 'DELTA';
        if ($mode === 'PASCABAYAR') {
            if ($app->application_type === 'PB') {
                $powerVaForUjl = (float) $powerVa;
                $basis = 'NEW_CONNECTION';
            } elseif ($previous === null) {
                throw new AssignmentRuleViolation("Permohonan {$label}: perubahan daya ke kWh meter pascabayar — pilih jenis kWh meter sebelumnya (previous_meter_payment: PRABAYAR atau PASCABAYAR); data permohonan tidak memuatnya.");
            } elseif ($previous === 'PRABAYAR') {
                $powerVaForUjl = (float) $powerVa;
                $basis = 'FROM_ZERO';
            }
        }
        $ujlPerVa = $row->ujl === null ? null : (float) $row->ujl;
        $ujlTotal = $ujlPerVa === null ? null : $ujlPerVa * $powerVaForUjl;
        if (! $prepaid && $ujlTotal === null) {
            throw new AssignmentRuleViolation("Permohonan {$label}: buku tarif tidak memuat UJL untuk tarif ini; biaya penyambungan kWh meter pascabayar (total biaya dikurangi UJL) tidak dapat ditentukan.");
        }
        $fee = $prepaid ? (float) $app->total_cost : (float) $app->total_cost - $ujlTotal;
        if ($fee < 0) {
            throw new AssignmentRuleViolation("Permohonan {$label}: total biaya lebih kecil dari UJL; biaya penyambungan menjadi negatif. Periksa data permohonan.");
        }
        $customer = DB::table('customers')->where('id', $app->customer_id)->value('name');
        $idpel = DB::table('customer_external_references')->where('customer_id', $app->customer_id)->where('reference_type', 'IDPEL')->orderByDesc('is_primary')->value('reference_value');

        return ['application_id' => $app->id, 'application_number' => $label, 'customer_name' => $customer, 'idpel' => $idpel, 'tariff_code' => $row->tariff_code, 'power_va' => $powerVa, 'delta_kva' => (float) $app->delta_power_kva,
            'jam_nyala' => (float) $row->jam_nyala, 'avg_price' => (float) $row->avg_price, 'fee' => $fee, 'mode' => $mode, 'sar_package' => $app->sar_package, 'previous' => $previous, 'basis' => $basis, 'total_cost' => (float) $app->total_cost,
            'ujl_per_va' => $ujlPerVa, 'ujl_total' => $ujlTotal, 'ujl_power_va' => $powerVaForUjl, 'row' => $row];
    }

    /** PRABAYAR | PASCABAYAR from the synced PAKET_SAR text; anything else is refused, never guessed. */
    private function meterMode(string $sarPackage): string
    {
        $t = mb_strtolower($sarPackage);
        if (str_contains($t, 'pascabayar')) {
            return 'PASCABAYAR';
        }
        if (str_contains($t, 'prabayar') || str_contains($t, 'prepaid')) {
            return 'PRABAYAR';
        }

        throw new AssignmentRuleViolation($sarPackage === '' ? 'PAKET_SAR permohonan kosong; jenis kWh meter (prabayar/pascabayar) tidak diketahui.' : "PAKET_SAR \"{$sarPackage}\" tidak dikenali sebagai Prabayar atau Pascabayar.");
    }

    /** KKF is issued only when the network is extended (owner 2026-11-14): a survey accepted as "no extension" needs none. */
    public static function assertExtensionApplies(string $applicationId): void
    {
        $s = SurveyService::latestOutcome($applicationId);
        if ($s !== null && $s['status'] === 'ACCEPTED' && $s['outcome'] === 'NO_EXTENSION') {
            throw new AssignmentRuleViolation("Survei {$s['survey_number']} menyatakan tanpa perluasan jaringan: KKF tidak diterbitkan.");
        }
    }

    /** @param array<string,mixed> $in @return array<string,mixed> */
    public function run(string $applicationId, array $in, User $actor, ?string $proposalId = null): array
    {
        $calc = $this->calculate($applicationId, $in, $proposalId);

        return DB::transaction(function () use ($calc, $actor, $applicationId): array {
            DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first();
            $number = ((int) DB::table('kkf_runs')->where('application_id', $applicationId)->max('run_number')) + 1;
            $id = (string) Str::uuid();
            $s = $calc['sources'];
            $pb = $calc['result']['payback'];
            $docNumber = $this->documentNumber((string) DB::table('applications')->where('id', $applicationId)->value('organizational_unit_id'), $calc['valid_on']);
            DB::table('kkf_runs')->insert(['id' => $id, 'application_id' => $applicationId, 'document_number' => $docNumber, 'rab_run_id' => $s['rab_run_id'], 'parameter_set_id' => $s['parameter_set_id'], 'tariff_book_id' => $s['tariff_book_id'], 'tariff_row_id' => $s['tariff_row_id'], 'proposal_id' => $s['proposal_id'],
                'run_number' => $number, 'valid_on' => $calc['valid_on'], 'inputs' => json_encode(['inputs' => $calc['inputs'], 'sources' => $s]), 'result' => json_encode($calc['result']), 'feasible' => $calc['feasible'], 'extended_required' => $calc['extended_required'],
                'npv' => round((float) $calc['result']['npv'], 2), 'irr_percent' => $calc['result']['irr_percent'], 'payback_months' => $pb === null ? null : $pb['years'] * 12 + $pb['months'],
                'snapshot_hash' => $calc['snapshot_hash'], 'created_by' => $actor->getKey(), 'created_at' => now()]);

            return ['id' => $id, 'run_number' => $number, 'document_number' => $docNumber] + $calc;
        });
    }

    /** `{sequence}/{yyyymm}/{unit code}` (owner 7 Nov 2026): the sequence runs per ULP per year; every stored run (also a recalculation) takes the next number. */
    private function documentNumber(string $unitId, string $date): string
    {
        $d = CarbonImmutable::parse($date);
        DB::table('kkf_number_sequences')->insertOrIgnore(['organizational_unit_id' => $unitId, 'year' => $d->year, 'last_number' => 0]);
        $row = DB::table('kkf_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->lockForUpdate()->first();
        DB::table('kkf_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->update(['last_number' => $row->last_number + 1]);
        $unit = (string) DB::table('organizational_units')->where('id', $unitId)->value('code');

        return strtr((string) config('distriva.document.kkf_number_format'), ['{seq}' => str_pad((string) ($row->last_number + 1), 3, '0', STR_PAD_LEFT), '{ym}' => $d->format('Ym'), '{unit}' => $unit]);
    }
}
