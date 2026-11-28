<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Bom\BomCalculator;
use App\Services\Surveys\SurveyService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Connection WITHOUT network extension (docs/95): after the survey is accepted as "no extension" the executor is set (1 phase: the contract of the ULP; 3 phase: chosen by the preparer)
 * and the material is planned from the approved APP BOM, without drawing, MTO, RAB, KKF or SPK. DRAFT -> SUBMITTED -> APPROVED -> RECORDED (the MIMS reservation number is typed in).
 * Who prepares/approves follows the source warehouse (ULP or UP3); callers authorize the actor for that level first.
 */
class SrReservationService
{
    /** Application statuses that are still waiting for the connection (the "siap pasang" statuses). */
    public const WAITING_STATUSES = ['APPROVED', 'PAID', 'PK_PRINTED'];

    public function __construct(private readonly BomCalculator $calculator, private readonly StockService $stock) {}

    /** PLN power steps: below 6600 VA, 7700 and 11000 VA are 1 phase; 6600, 10600, 13200 VA and the rest are 3 phase (owner). */
    public static function phaseOf(int $powerVa): int
    {
        return $powerVa < 6600 || in_array($powerVa, (array) config('distriva.sr_reservation.one_phase_va'), true) ? 1 : 3;
    }

    public static function powerVa(object $application): ?int
    {
        if ($application->new_power_value === null) {
            return null;
        }

        return (int) round((float) $application->new_power_value * (strtoupper((string) $application->new_power_unit) === 'KVA' ? 1000 : 1));
    }

    /** The contract that names the 1-phase executor of a ULP today, only while the company is still active. */
    public function contractFor(string $unitId): ?object
    {
        $today = $this->today();

        return DB::table('sr_vendor_contracts as k')->join('vendor_companies as c', 'c.id', '=', 'k.vendor_company_id')->where('k.organizational_unit_id', $unitId)->where('c.status', 'ACTIVE')
            ->where('k.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('k.valid_until')->orWhere('k.valid_until', '>=', $today))
            ->first(['k.id', 'k.vendor_company_id', 'k.contract_number', 'k.valid_from', 'k.valid_until', 'c.code as vendor_code', 'c.name as vendor_name']);
    }

    /** Warehouses that may supply the application: its ULP's own and its UP3's. @return list<object> */
    public function warehousesFor(string $unitId): array
    {
        $parent = DB::table('organizational_units')->where('id', $unitId)->value('parent_id');

        return DB::table('warehouses as w')->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')->where('w.is_active', true)
            ->whereIn('w.organizational_unit_id', array_filter([$unitId, $parent]))->orderBy('u.unit_type')->orderBy('w.code')
            ->get(['w.id', 'w.code', 'w.name', 'w.plant', 'w.stor_loc', 'u.unit_type as level'])->all();
    }

    /** Why a plan cannot be opened now; empty = it can. @return list<string> */
    public function blockers(object $application): array
    {
        $out = [];
        $survey = SurveyService::latestOutcome($application->id);
        if ($survey === null || $survey['status'] !== 'ACCEPTED') {
            $out[] = 'Survei belum disetujui: hasil survei menentukan perlu atau tidaknya perluasan.';
        } elseif ($survey['outcome'] !== 'NO_EXTENSION') {
            $out[] = "Survei {$survey['survey_number']} menyatakan perlu perluasan: reservasi mengikuti jalur gambar, MTO, dan alokasi.";
        }
        if (! in_array($application->current_status, self::WAITING_STATUSES, true)) {
            $out[] = "Status permohonan {$application->current_status}: tidak lagi menunggu pemasangan.";
        }
        if (self::powerVa($application) === null) {
            $out[] = 'Daya baru permohonan belum diisi.';
        }
        $mims = $this->mimsReservationNumbers($application->id);
        if ($mims !== []) {
            $out[] = 'Nomor agenda ini sudah punya reservasi di MIMS ('.implode(', ', $mims).'): tidak direservasi dua kali.';
        }

        return $out;
    }

    /** MIMS reservation numbers already tied to the application's agenda, except the ones DISTRIVA itself recorded. @return list<string> */
    private function mimsReservationNumbers(string $applicationId): array
    {
        $agendas = DB::table('application_external_references')->where('application_id', $applicationId)->where('reference_type', 'AGENDA')->where('is_active', true)->pluck('reference_number')->all();
        $numbers = DB::table('mims_reservation_customers')->where('application_id', $applicationId)->when($agendas !== [], fn ($q) => $q->orWhereIn('agenda_no', $agendas))->pluck('reservation_no')
            ->merge($agendas === [] ? [] : DB::table('mims_issue_customers')->whereIn('agenda_no', $agendas)->pluck('reservation_no'))->unique();
        $own = DB::table('sr_reservations')->where('application_id', $applicationId)->whereNotNull('mims_reservation_no')->pluck('mims_reservation_no');

        return $numbers->diff($own)->values()->all();
    }

    /**
     * PLN material of one connection from the approved APP BOM valid today; vendor-supplied material (price book PRICED) is left out, and the SR cable takes the planned length.
     *
     * @return array{group:string,header_id:string,lines:array<string,float>} quantity per KHS item id
     */
    public function bomNeed(object $application, int $powerVa, float $srLength): array
    {
        $phase = self::phaseOf($powerVa);
        $group = $phase === 1 ? 'SR1PH' : ($powerVa <= 41500 ? 'PBPD_6_41' : 'PBPD_53_197');
        if ($powerVa > 197000) {
            throw new AssignmentRuleViolation('Daya di atas 197 kVA tidak punya BOM APP; sambungan ini tidak dapat direncanakan otomatis.');
        }
        $today = $this->today();
        $header = DB::table('bom_headers')->where('group_code', $group)->where('status', 'APPROVED')->where('valid_from', '<=', $today)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->value('id')
            ?? throw new AssignmentRuleViolation("Belum ada BOM {$group} yang disetujui dan berlaku hari ini.");
        $oldVa = $application->application_type === 'PB' || $application->old_power_value === null ? 0
            : (float) $application->old_power_value * (strtoupper((string) $application->old_power_unit) === 'KVA' ? 1000 : 1);
        $slot = (int) config("distriva.sr_reservation.drawing_row.{$group}");
        $range = $phase === 1 ? '450-5500 VA' : ($powerVa <= 16500 ? '6,6-16,5 kVA' : str_replace('.', ',', (string) ($powerVa / 1000)).' kVA');
        $params = ["PBPD:RENTANG_{$slot}" => $range, "PBPD:PSG_{$slot}" => 1, 'PBPD:PEMBAYARAN' => 'PLN',
            'PERMOHONAN:DAYA_BARU_KVA' => $powerVa / 1000, 'PERMOHONAN:DAYA_LAMA_KVA' => $oldVa / 1000];
        // A text parameter refuses a value outside its options; a range the BOM does not list is left to the default.
        foreach (json_decode((string) DB::table('bom_headers')->where('id', $header)->value('parameters'), true) ?: [] as $d) {
            if (($d['type'] ?? 'number') === 'text' && isset($params[$d['name']]) && is_array($d['options'] ?? null) && ! in_array($params[$d['name']], $d['options'], true)) {
                unset($params[$d['name']]);
            }
        }
        $byCode = [];
        foreach ($this->calculator->calculate($header, [], $params) as $l) {
            if ($l['khs_code'] !== null && ! $l['aggregate'] && $l['material'] > 0) {
                $byCode[(string) $l['khs_code']] = ($byCode[(string) $l['khs_code']] ?? 0) + (float) $l['material'];
            }
        }
        foreach ((array) config('distriva.sr_reservation.cable_codes') as $code) {
            if (isset($byCode[$code])) {
                $byCode[$code] = $srLength;
            }
        }
        $ids = DB::table('khs_items')->whereIn('code', array_map('strval', array_keys($byCode)))->pluck('id', 'code');
        $vendorSupplied = $this->vendorSupplied($ids->values()->all());
        $lines = [];
        foreach ($byCode as $code => $q) {
            $id = $ids[$code] ?? null;
            if ($id !== null && ! isset($vendorSupplied[$id])) {
                $lines[$id] = $q;
            }
        }
        if ($lines === []) {
            throw new AssignmentRuleViolation("BOM {$group} tidak menghasilkan material PLN untuk daya {$powerVa} VA.");
        }

        return ['group' => $group, 'header_id' => (string) $header, 'lines' => $lines];
    }

    /** @param list<string> $khsIds @return array<string,true> */
    private function vendorSupplied(array $khsIds): array
    {
        $today = $this->today();
        $book = DB::table('price_books')->where('status', 'APPROVED')->where('valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->value('id');
        if ($book === null) {
            return [];
        }

        return DB::table('price_book_items')->where('price_book_id', $book)->whereIn('khs_item_id', $khsIds)->where('material_status', 'PRICED')->pluck('khs_item_id')->mapWithKeys(fn ($id) => [$id => true])->all();
    }

    /** @param array{warehouse_id:string,vendor_company_id?:?string,sr_length_m?:mixed,notes?:?string} $in */
    public function create(string $applicationId, array $in, User $actor): string
    {
        return DB::transaction(function () use ($applicationId, $in, $actor): string {
            $app = DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $blockers = $this->blockers($app);
            if ($blockers !== []) {
                throw new AssignmentRuleViolation(implode(' ', $blockers));
            }
            if (DB::table('sr_reservations')->where('application_id', $applicationId)->where('status', '<>', 'CANCELLED')->exists()) {
                throw new AssignmentRuleViolation('Permohonan sudah punya rencana reservasi yang berjalan; batalkan dulu untuk membuat yang baru.');
            }
            $warehouse = collect($this->warehousesFor($app->organizational_unit_id))->firstWhere('id', $in['warehouse_id'])
                ?? throw new AssignmentRuleViolation('Gudang sumber harus gudang aktif milik ULP permohonan atau UP3 induknya.');
            $power = (int) self::powerVa($app);
            $phase = self::phaseOf($power);
            [$vendorId, $contractId] = $this->executor($app->organizational_unit_id, $phase, $in['vendor_company_id'] ?? null);
            $length = (float) ($in['sr_length_m'] ?? config('distriva.sr_reservation.default_sr_length_m'));
            $need = $this->bomNeed($app, $power, $length);

            $id = (string) Str::uuid();
            DB::table('sr_reservations')->insert(['id' => $id, 'application_id' => $applicationId, 'version_number' => ((int) DB::table('sr_reservations')->where('application_id', $applicationId)->max('version_number')) + 1,
                'status' => 'DRAFT', 'phase' => $phase, 'power_va' => $power, 'source_level' => $warehouse->level, 'warehouse_id' => $warehouse->id, 'vendor_company_id' => $vendorId, 'vendor_contract_id' => $contractId,
                'sr_length_m' => $length, 'bom_group' => $need['group'], 'bom_header_id' => $need['header_id'], 'notes' => $in['notes'] ?? null, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach ($need['lines'] as $khs => $q) {
                DB::table('sr_reservation_lines')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $id, 'khs_item_id' => $khs, 'quantity_bom' => $q, 'quantity' => $q]);
            }
            $this->event($id, 'CREATED', $actor, null, ['warehouse' => $warehouse->code, 'phase' => $phase, 'sr_length_m' => $length]);

            return $id;
        });
    }

    /** 1 phase: the contracted company, never chosen by hand. 3 phase: the preparer's choice among active network companies. @return array{0:string,1:?string} */
    private function executor(string $unitId, int $phase, ?string $chosen): array
    {
        if ($phase === 1) {
            $contract = $this->contractFor($unitId) ?? throw new AssignmentRuleViolation('ULP ini belum punya kontrak pelaksana 1 phasa yang berlaku hari ini.');
            if ($chosen !== null && $chosen !== $contract->vendor_company_id) {
                throw new AssignmentRuleViolation("Pelaksana 1 phasa mengikuti kontrak {$contract->contract_number} ({$contract->vendor_name}).");
            }

            return [$contract->vendor_company_id, $contract->id];
        }
        if ($chosen === null) {
            throw new AssignmentRuleViolation('Sambungan 3 phasa: pelaksana wajib dipilih.');
        }
        $this->assertNetworkVendor($chosen);

        return [$chosen, null];
    }

    public function assertNetworkVendor(string $companyId): void
    {
        $company = DB::table('vendor_companies')->where('id', $companyId)->first();
        if ($company === null || $company->status !== 'ACTIVE' || $company->work_scope === 'TIANG') {
            throw new AssignmentRuleViolation('Pelaksana harus perusahaan vendor aktif dengan lingkup Jaringan atau Keduanya.');
        }
    }

    /**
     * Draft changes. `corrections` sets the quantity of one material (a material outside the BOM may be added); a quantity that differs from the calculated one needs a reason.
     * Changing the SR length resets the cable line to the new length.
     *
     * @param  array{sr_length_m?:mixed,vendor_company_id?:?string,notes?:?string,corrections?:list<array{khs_code:string,quantity:mixed,reason?:?string}>}  $in
     */
    public function update(string $id, array $in, User $actor): void
    {
        DB::transaction(function () use ($id, $in, $actor): void {
            $r = $this->lock($id, ['DRAFT'], 'diubah');
            $changes = [];
            if (isset($in['sr_length_m'])) {
                $length = (float) $in['sr_length_m'];
                $cables = DB::table('khs_items')->whereIn('code', (array) config('distriva.sr_reservation.cable_codes'))->pluck('id');
                DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->whereIn('khs_item_id', $cables)->update(['quantity_bom' => $length, 'quantity' => $length, 'correction_reason' => null]);
                $changes['sr_length_m'] = $length;
            }
            if (isset($in['vendor_company_id']) && $in['vendor_company_id'] !== $r->vendor_company_id) {
                if ((int) $r->phase === 1) {
                    throw new AssignmentRuleViolation('Pelaksana 1 phasa mengikuti kontrak; tidak dapat diganti.');
                }
                $this->assertNetworkVendor($in['vendor_company_id']);
                $changes['vendor_company_id'] = $in['vendor_company_id'];
            }
            if (array_key_exists('notes', $in)) {
                $changes['notes'] = $in['notes'];
            }
            $applied = [];
            foreach ($in['corrections'] ?? [] as $c) {
                $khs = DB::table('khs_items')->where('code', $c['khs_code'])->value('id') ?? throw new AssignmentRuleViolation("KHS {$c['khs_code']} tidak dikenal.");
                $line = DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->where('khs_item_id', $khs)->first();
                $quantity = (float) $c['quantity'];
                $baseline = (float) ($line->quantity_bom ?? 0);
                $reason = trim((string) ($c['reason'] ?? ''));
                $differs = abs($quantity - $baseline) > 1e-9;
                if ($differs && $reason === '') {
                    throw new AssignmentRuleViolation("KHS {$c['khs_code']}: koreksi jumlah wajib disertai alasan.");
                }
                $values = ['quantity' => $quantity, 'correction_reason' => $differs ? $reason : null];
                if ($line === null) {
                    DB::table('sr_reservation_lines')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $id, 'khs_item_id' => $khs, 'quantity_bom' => 0] + $values);
                } else {
                    DB::table('sr_reservation_lines')->where('id', $line->id)->update($values);
                }
                $applied[] = ['khs_code' => $c['khs_code'], 'quantity' => $quantity, 'reason' => $values['correction_reason']];
            }
            DB::table('sr_reservations')->where('id', $id)->update($changes + ['updated_at' => now()]);
            $this->event($id, 'UPDATED', $actor, null, $changes + ($applied === [] ? [] : ['corrections' => $applied]));
        });
    }

    public function submit(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $r = $this->lock($id, ['DRAFT'], 'diajukan');
            $this->assertStillValid($r);
            if (! DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->where('quantity', '>', 0)->exists()) {
                throw new AssignmentRuleViolation('Rencana reservasi tidak memuat material.');
            }
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'SUBMITTED', 'submitted_by' => $actor->getKey(), 'submitted_at' => now(), 'updated_at' => now()]);
            $this->event($id, 'SUBMITTED', $actor);
        });
    }

    /** APPROVE re-checks the stock under lock; RETURN sends the plan back to DRAFT with a reason. */
    public function decide(string $id, string $decision, ?string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $decision, $reason, $actor): void {
            $r = $this->lock($id, ['SUBMITTED'], 'diputus');
            if ($decision === 'RETURN') {
                if (trim((string) $reason) === '') {
                    throw new AssignmentRuleViolation('Alasan pengembalian wajib diisi.');
                }
                DB::table('sr_reservations')->where('id', $id)->update(['status' => 'DRAFT', 'submitted_by' => null, 'submitted_at' => null, 'updated_at' => now()]);
                $this->event($id, 'RETURNED', $actor, trim((string) $reason));

                return;
            }
            $this->assertStillValid($r);
            DB::table('warehouses')->where('id', $r->warehouse_id)->lockForUpdate()->first();
            $position = $this->stock->position([$r->warehouse_id], $this->today());
            $short = [];
            foreach (DB::table('sr_reservation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.sr_reservation_id', $id)->where('l.quantity', '>', 0)->get(['l.khs_item_id', 'l.quantity', 'k.code']) as $l) {
                $available = (float) ($position[$l->khs_item_id]['available'] ?? 0);
                if ((float) $l->quantity > $available + 1e-9) {
                    $short[] = "KHS {$l->code}: butuh ".(float) $l->quantity.", tersedia {$available}.";
                }
            }
            if ($short !== []) {
                throw new AssignmentRuleViolation('Stok gudang tidak cukup. '.implode(' ', $short));
            }
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
            $this->event($id, 'APPROVED', $actor, $reason);
        });
    }

    /** The reservation number typed after the plan was entered in MIMS; may be corrected while RECORDED. */
    public function recordMims(string $id, string $number, User $actor): void
    {
        DB::transaction(function () use ($id, $number, $actor): void {
            $r = $this->lock($id, ['APPROVED', 'RECORDED'], 'dicatat ke MIMS');
            $number = trim($number);                                 // one MIMS reservation may hold several agendas: not unique
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'RECORDED', 'mims_reservation_no' => $number, 'mims_send_method' => 'MANUAL', 'mims_recorded_by' => $actor->getKey(), 'mims_recorded_at' => now(), 'updated_at' => now()]);
            $this->event($id, 'MIMS_RECORDED', $actor, null, ['reservation_no' => $number, 'previous' => $r->mims_reservation_no]);
        });
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $this->lock($id, ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECORDED'], 'dibatalkan');
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'CANCELLED', 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => $reason, 'updated_at' => now()]);
            $this->event($id, 'CANCELLED', $actor, $reason);
        });
    }

    private function assertStillValid(object $reservation): void
    {
        $app = DB::table('applications')->where('id', $reservation->application_id)->first();
        $blockers = $this->blockers($app);
        if (self::powerVa($app) !== (int) $reservation->power_va) {
            $blockers[] = 'Daya permohonan sudah berubah sejak rencana dibuat; batalkan dan buat ulang.';
        }
        if ($blockers !== []) {
            throw new AssignmentRuleViolation(implode(' ', $blockers));
        }
    }

    /** @param list<string> $allowed */
    private function lock(string $id, array $allowed, string $verb): object
    {
        $r = DB::table('sr_reservations')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if (! in_array($r->status, $allowed, true)) {
            throw new AssignmentRuleViolation("Rencana berstatus {$r->status} tidak dapat {$verb}.");
        }

        return $r;
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $id, string $type, User $actor, ?string $reason = null, ?array $details = null): void
    {
        DB::table('sr_reservation_events')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $id, 'event_type' => $type, 'actor_id' => $actor->getKey(), 'reason' => $reason,
            'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }

    private function today(): string
    {
        return now(config('distriva.business_timezone'))->toDateString();
    }
}
