<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Bom\BomCalculator;
use App\Services\Proposals\ProposalService;
use App\Services\Surveys\SurveyService;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Connection WITHOUT network extension (docs/95). 1 phase is installed directly once paid, without survey, from ULP stock only; when the connection finds that the network must be extended,
 * TEKNIK records a finding and the application follows the extension path (the reserved APP material stays and is not allocated again). 3 phase needs a survey accepted as "no extension".
 *
 * Reservations are COLLECTIVE and follow MIMS (owner): pick the agendas, total per material, record the MIMS request number (DRAFT -> REQUESTED, stock held), enter per agenda the serial
 * numbers, cable length and seals, then send to SAP (SAP_SENT) — only when every total equals what the agendas realised. No approval step. MIMS and SAP are typed in by hand for now.
 * Callers authorize the actor for the level of the source warehouse first.
 */
class SrReservationService
{
    /** Statuses of a 3-phase application still waiting for the connection (the "siap pasang" statuses of the survey). */
    public const WAITING_STATUSES = ['APPROVED', 'PAID', 'PK_PRINTED'];

    /** A 1-phase application is installed once it is paid. */
    public const ONE_PHASE_STATUSES = ['PAID', 'PK_PRINTED'];

    /** The status in which a field finding keeps the extension path open although EIS already moved on to the connection. */
    private const CONNECTING = 'CONNECTION_IN_PROGRESS';

    public function __construct(private readonly BomCalculator $calculator, private readonly StockService $stock) {}

    /**
     * May survey, drawing, MTO and proposal work proceed for the application? Their usual statuses, or "connection in progress" with a field finding.
     *
     * @param  list<string>  $open
     */
    public static function openForWork(object $application, array $open): bool
    {
        return in_array($application->current_status, $open, true)
            || ($application->current_status === self::CONNECTING && self::activeFinding($application->id)->exists());
    }

    /** The field finding in force ("the network must be extended"); a withdrawn one stays as history only. */
    public static function activeFinding(string $applicationId): Builder
    {
        return DB::table('sr_extension_findings')->where('application_id', $applicationId)->whereNull('cancelled_at');
    }

    /** SQL: the application row `$alias` has a finding in force. */
    public static function hasFindingSql(string $alias = 'a'): string
    {
        return "exists (select 1 from sr_extension_findings f where f.application_id = {$alias}.id and f.cancelled_at is null)";
    }

    /** SQL: the power of the application row `$alias` is a 1-phase step (the SQL form of phaseOf). */
    public static function onePhaseSql(string $alias = 'a'): string
    {
        $va = "({$alias}.new_power_value * (case when upper({$alias}.new_power_unit) = 'KVA' then 1000 else 1 end))";
        $steps = implode(',', array_map('intval', (array) config('distriva.sr_reservation.one_phase_va')));

        return "coalesce({$va} < 6600 or {$va} in ({$steps}), false)";
    }

    /** SQL: `$alias` is a 1-phase application that goes straight to installation: no survey of its own and no finding, so no survey is expected. */
    public static function directInstallSql(string $alias = 'a'): string
    {
        return '('.self::onePhaseSql($alias)." and not exists (select 1 from application_surveys sx where sx.application_id = {$alias}.id and sx.status <> 'CANCELLED') and not ".self::hasFindingSql($alias).')';
    }

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

    /** Warehouses that may supply: 1 phase only the ULP's own; 3 phase also its UP3's. @return list<object> */
    public function warehousesFor(string $unitId, ?int $phase): array
    {
        $parent = $phase === 1 ? null : DB::table('organizational_units')->where('id', $unitId)->value('parent_id');

        return DB::table('warehouses as w')->join('organizational_units as u', 'u.id', '=', 'w.organizational_unit_id')->where('w.is_active', true)
            ->whereIn('w.organizational_unit_id', array_filter([$unitId, $parent]))->orderBy('u.unit_type')->orderBy('w.code')
            ->get(['w.id', 'w.code', 'w.name', 'w.plant', 'w.stor_loc', 'u.unit_type as level'])->all();
    }

    /** The chosen warehouse, or the only one there is when none is named. */
    public function pickWarehouse(string $unitId, int $phase, ?string $chosen): object
    {
        $warehouses = collect($this->warehousesFor($unitId, $phase));
        $warehouse = $chosen === null ? ($warehouses->count() === 1 ? $warehouses->first() : null) : $warehouses->firstWhere('id', $chosen);

        return $warehouse ?? throw new AssignmentRuleViolation($phase === 1
            ? 'Sambungan 1 phasa hanya mengambil stok ULP: pilih gudang aktif milik ULP permohonan.'
            : 'Gudang sumber harus gudang aktif milik ULP permohonan atau UP3 induknya.');
    }

    /**
     * Why an application cannot be put in a reservation (or, with `$existingPlan`, stay in a draft being requested); empty = it can.
     *
     * @return list<string>
     */
    public function blockers(object $application, bool $existingPlan = false): array
    {
        $out = [];
        $power = self::powerVa($application);
        if ($power === null) {
            return ['Daya baru permohonan belum diisi.'];
        }
        $survey = SurveyService::latestOutcome($application->id);
        if (self::phaseOf($power) === 1) {
            $statuses = $existingPlan ? [...self::ONE_PHASE_STATUSES, self::CONNECTING] : self::ONE_PHASE_STATUSES;
            if (self::activeFinding($application->id)->exists()) {
                $out[] = 'Saat penyambungan ditemukan perlu perluasan: lanjutkan lewat survei, usulan, dan alokasi.';
            } elseif ($survey !== null && $survey['status'] !== 'ACCEPTED') {
                $out[] = "Survei {$survey['survey_number']} sedang berjalan: tunggu hasilnya.";
            } elseif ($survey !== null && $survey['outcome'] === 'EXTENSION') {
                $out[] = "Survei {$survey['survey_number']} menyatakan perlu perluasan: reservasi mengikuti jalur gambar, MTO, dan alokasi.";
            }
            if (ProposalService::liveFor($application->id) !== null) {
                $out[] = 'Permohonan berada dalam usulan perluasan yang berjalan.';
            }
        } else {
            $statuses = self::WAITING_STATUSES;
            if ($survey === null || $survey['status'] !== 'ACCEPTED') {
                $out[] = 'Survei belum disetujui: sambungan 3 phasa wajib disurvei untuk menentukan perlu atau tidaknya perluasan.';
            } elseif ($survey['outcome'] !== 'NO_EXTENSION') {
                $out[] = "Survei {$survey['survey_number']} menyatakan perlu perluasan: reservasi mengikuti jalur gambar, MTO, dan alokasi.";
            }
        }
        if (! in_array($application->current_status, $statuses, true)) {
            $out[] = "Status permohonan {$application->current_status}: tidak menunggu pemasangan.";
        }
        if (DB::table('allocations')->where('application_id', $application->id)->where('status', '<>', 'CANCELLED')->exists()) {
            $out[] = 'Permohonan sudah memiliki alokasi material.';
        }
        $mims = $this->mimsReservationNumbers($application->id);
        if ($mims !== []) {
            $out[] = 'Nomor agenda ini sudah punya reservasi di MIMS ('.implode(', ', $mims).'): tidak direservasi dua kali.';
        }

        return $out;
    }

    /** MIMS reservation numbers already tied to the application's agenda, except the ones DISTRIVA itself recorded. @return list<string> */
    public function mimsReservationNumbers(string $applicationId): array
    {
        $agendas = DB::table('application_external_references')->where('application_id', $applicationId)->where('reference_type', 'AGENDA')->where('is_active', true)->pluck('reference_number')->all();
        $numbers = DB::table('mims_reservation_customers')->where('application_id', $applicationId)->pluck('reservation_no')
            ->merge($agendas === [] ? [] : DB::table('mims_reservation_customers')->whereIn('agenda_no', $agendas)->pluck('reservation_no'))
            ->merge($agendas === [] ? [] : DB::table('mims_issue_customers')->whereIn('agenda_no', $agendas)->pluck('reservation_no'))->unique();
        $own = DB::table('sr_reservations as r')->join('sr_reservation_applications as x', 'x.sr_reservation_id', '=', 'r.id')->where('x.application_id', $applicationId)->whereNotNull('r.mims_reservation_no')->pluck('r.mims_reservation_no');

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

    /**
     * One reservation for several agendas of one ULP and one phase, from one warehouse, by one executor. All or nothing: every agenda that cannot join is named.
     *
     * @param  array{application_ids:list<string>,warehouse_id?:?string,vendor_company_id?:?string,sr_length_m?:mixed,notes?:?string}  $in
     */
    public function create(array $in, User $actor): string
    {
        return DB::transaction(function () use ($in, $actor): string {
            $apps = $this->lockApplications($in['application_ids']);
            if ($apps->pluck('organizational_unit_id')->unique()->count() > 1) {
                throw new AssignmentRuleViolation('Satu reservasi hanya untuk satu ULP.');
            }
            $unitId = (string) $apps->first()->organizational_unit_id;
            $phases = $apps->map(fn (object $a): int => self::powerVa($a) === null ? 0 : self::phaseOf(self::powerVa($a)))->unique();
            if ($phases->count() > 1) {
                throw new AssignmentRuleViolation('Satu reservasi tidak boleh mencampur sambungan 1 phasa dan 3 phasa.');
            }
            $this->assertCanJoin($apps);
            $phase = (int) $phases->first();
            $warehouse = $this->pickWarehouse($unitId, $phase, $in['warehouse_id'] ?? null);
            [$vendorId, $contractId] = $this->executor($unitId, $phase, $in['vendor_company_id'] ?? null);
            $length = (float) ($in['sr_length_m'] ?? config('distriva.sr_reservation.default_sr_length_m'));

            $id = (string) Str::uuid();
            DB::table('sr_reservations')->insert(['id' => $id, 'organizational_unit_id' => $unitId, 'status' => 'DRAFT', 'phase' => $phase, 'source_level' => $warehouse->level, 'warehouse_id' => $warehouse->id,
                'vendor_company_id' => $vendorId, 'vendor_contract_id' => $contractId, 'sr_length_m' => $length, 'notes' => $in['notes'] ?? null, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach ($apps as $app) {
                $this->join($id, $app, $length);
            }
            $this->retotal($id);
            $this->event($id, 'CREATED', $actor, null, ['warehouse' => $warehouse->code, 'phase' => $phase, 'agendas' => $apps->count(), 'sr_length_m' => $length]);

            return $id;
        });
    }

    /** @param list<string> $ids */
    private function lockApplications(array $ids): Collection
    {
        $apps = DB::table('applications')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
        if ($apps->count() !== count(array_unique($ids))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $apps;
    }

    private function assertCanJoin(Collection $apps): void
    {
        $running = DB::table('sr_reservation_applications')->whereIn('application_id', $apps->pluck('id'))->whereNull('released_at')->pluck('application_id')->all();
        $errors = [];
        foreach ($apps as $app) {
            $why = $this->blockers($app);
            if (in_array($app->id, $running, true)) {
                $why[] = 'Sudah ada pada reservasi lain yang berjalan.';
            }
            if ($why !== []) {
                $errors[] = $app->application_number.': '.implode(' ', $why);
            }
        }
        if ($errors !== []) {
            throw new AssignmentRuleViolation(implode(' | ', $errors));
        }
    }

    private function join(string $reservationId, object $app, float $length): void
    {
        $power = (int) self::powerVa($app);
        $need = $this->bomNeed($app, $power, $length);
        DB::table('sr_reservation_applications')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $reservationId, 'application_id' => $app->id, 'power_va' => $power,
            'bom_group' => $need['group'], 'bom_header_id' => $need['header_id'], 'needs' => json_encode((object) $need['lines'])]);
    }

    /** The calculated total per material = the sum of the agendas still in; a typed correction keeps its difference from the calculated total. */
    private function retotal(string $reservationId): void
    {
        $sum = [];
        foreach (DB::table('sr_reservation_applications')->where('sr_reservation_id', $reservationId)->whereNull('released_at')->pluck('needs') as $needs) {
            foreach (json_decode($needs, true) as $khs => $q) {
                $sum[$khs] = ($sum[$khs] ?? 0) + (float) $q;
            }
        }
        $lines = DB::table('sr_reservation_lines')->where('sr_reservation_id', $reservationId)->get()->keyBy('khs_item_id');
        foreach ($lines->keys()->merge(array_keys($sum))->unique() as $khs) {
            $line = $lines[$khs] ?? null;
            $calculated = (float) ($sum[$khs] ?? 0);
            $quantity = $line === null || $line->correction_reason === null ? $calculated : max(0.0, (float) $line->quantity + $calculated - (float) $line->quantity_bom);
            if ($line === null) {
                DB::table('sr_reservation_lines')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $reservationId, 'khs_item_id' => $khs, 'quantity_bom' => $calculated, 'quantity' => $quantity]);
            } elseif ($calculated <= 0 && $quantity <= 0) {
                DB::table('sr_reservation_lines')->where('id', $line->id)->delete();
            } else {
                DB::table('sr_reservation_lines')->where('id', $line->id)->update(['quantity_bom' => $calculated, 'quantity' => $quantity]);
            }
        }
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
     * Changes. Draft only: SR length (per customer), 3-phase executor, notes, more agendas. Totals (`corrections`) also after the request, so they can be made equal to what was realised;
     * a material outside the BOM (e.g. a seal supplied by PLN) may be added. A total that differs from the calculated one needs a reason.
     *
     * @param  array{sr_length_m?:mixed,vendor_company_id?:?string,notes?:?string,add_application_ids?:list<string>,corrections?:list<array{khs_code:string,quantity:mixed,reason?:?string}>,materials?:list<array{khs_code:string,items:list<array{material_no:string,quantity:mixed}>}>}  $in
     */
    public function update(string $id, array $in, User $actor): void
    {
        DB::transaction(function () use ($id, $in, $actor): void {
            $r = $this->lock($id, ['DRAFT', 'REQUESTED'], 'diubah');
            if ($r->status !== 'DRAFT' && array_intersect_key($in, array_flip(['sr_length_m', 'vendor_company_id', 'add_application_ids'])) !== []) {
                throw new AssignmentRuleViolation('Sesudah dimohonkan hanya jumlah total dan catatan yang dapat diubah.');
            }
            $changes = [];
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
            $length = (float) ($in['sr_length_m'] ?? $r->sr_length_m);
            if (isset($in['sr_length_m'])) {
                $changes['sr_length_m'] = $length;
                $cables = array_flip($this->itemIds('cable_codes'));
                foreach (DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->whereNull('released_at')->get(['id', 'needs']) as $agenda) {
                    $needs = json_decode($agenda->needs, true);
                    foreach (array_intersect_key($needs, $cables) as $khs => $ignored) {
                        $needs[$khs] = $length;
                    }
                    DB::table('sr_reservation_applications')->where('id', $agenda->id)->update(['needs' => json_encode((object) $needs)]);
                }
                DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->whereIn('khs_item_id', array_keys($cables))->update(['correction_reason' => null]);
            }
            if (! empty($in['add_application_ids'])) {
                $apps = $this->lockApplications($in['add_application_ids']);
                foreach ($apps as $app) {
                    $power = self::powerVa($app);
                    if ($app->organizational_unit_id !== $r->organizational_unit_id || $power === null || self::phaseOf($power) !== (int) $r->phase) {
                        throw new AssignmentRuleViolation("{$app->application_number}: harus dari ULP dan jumlah phasa yang sama dengan reservasi.");
                    }
                }
                $this->assertCanJoin($apps);
                foreach ($apps as $app) {
                    $this->join($id, $app, $length);
                }
                $changes['added'] = $apps->pluck('application_number')->all();
            }
            if (isset($in['sr_length_m']) || ! empty($in['add_application_ids'])) {
                $this->retotal($id);
            }
            $applied = $this->correct($r, $in['corrections'] ?? []);
            $this->followSingleNumbers($id);
            $picked = $this->chooseMaterials($r, $in['materials'] ?? []);
            if ($r->status === 'REQUESTED') {
                $problems = $this->materialProblems($id);
                if ($problems !== []) {
                    throw new AssignmentRuleViolation(implode(' ', $problems));
                }
                $this->assertMaterialStock($r);
            }
            DB::table('sr_reservations')->where('id', $id)->update(array_intersect_key($changes, array_flip(['vendor_company_id', 'notes', 'sr_length_m'])) + ['updated_at' => now()]);
            $this->event($id, 'UPDATED', $actor, null, $changes + ($applied === [] ? [] : ['corrections' => $applied]) + ($picked === [] ? [] : ['materials' => $picked]));
        });
    }

    /**
     * @param  list<array{khs_code:string,quantity:mixed,reason?:?string}>  $corrections
     * @return list<array<string,mixed>>
     */
    private function correct(object $r, array $corrections): array
    {
        $applied = [];
        $increase = [];
        foreach ($corrections as $c) {
            $khs = DB::table('khs_items')->where('code', $c['khs_code'])->value('id') ?? throw new AssignmentRuleViolation("KHS {$c['khs_code']} tidak dikenal.");
            $line = DB::table('sr_reservation_lines')->where('sr_reservation_id', $r->id)->where('khs_item_id', $khs)->first();
            $quantity = (float) $c['quantity'];
            $calculated = (float) ($line->quantity_bom ?? 0);
            $reason = trim((string) ($c['reason'] ?? ''));
            $differs = abs($quantity - $calculated) > 1e-9;
            if ($differs && $reason === '') {
                throw new AssignmentRuleViolation("KHS {$c['khs_code']}: koreksi jumlah wajib disertai alasan.");
            }
            $more = $quantity - (float) ($line->quantity ?? 0);
            if ($more > 1e-9) {
                $increase[$khs] = $more;
            }
            $values = ['quantity' => $quantity, 'correction_reason' => $differs ? $reason : null];
            if ($line === null) {
                DB::table('sr_reservation_lines')->insert(['id' => (string) Str::uuid(), 'sr_reservation_id' => $r->id, 'khs_item_id' => $khs, 'quantity_bom' => 0] + $values);
            } else {
                DB::table('sr_reservation_lines')->where('id', $line->id)->update($values);
            }
            $applied[] = ['khs_code' => $c['khs_code'], 'quantity' => $quantity, 'reason' => $values['correction_reason']];
        }
        if ($r->status === 'REQUESTED' && $increase !== []) {
            $this->assertStock($r->warehouse_id, $increase);
        }

        return $applied;
    }

    /** Takes one agenda out (with a reason): the totals drop by its share and its realisation is discarded. The last one is removed by cancelling. */
    public function removeApplication(string $id, string $applicationId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $applicationId, $reason, $actor): void {
            $this->lock($id, ['DRAFT', 'REQUESTED'], 'diubah');
            $agenda = DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->where('application_id', $applicationId)->whereNull('released_at')->first()
                ?? throw new AssignmentRuleViolation('Agenda itu tidak ada pada reservasi ini.');
            if (DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->whereNull('released_at')->count() === 1) {
                throw new AssignmentRuleViolation('Ini agenda terakhir: batalkan reservasinya.');
            }
            DB::table('sr_reservation_serials')->where('sr_reservation_application_id', $agenda->id)->delete();
            DB::table('sr_reservation_applications')->where('id', $agenda->id)->update(['released_at' => now(), 'released_by' => $actor->getKey(), 'release_reason' => $reason, 'actual_cable_m' => null, 'seal_numbers' => '[]']);
            $this->retotal($id);
            $this->followSingleNumbers($id);
            $this->event($id, 'AGENDA_REMOVED', $actor, $reason, ['application_id' => $applicationId]);
        });
    }

    /** The request number from MIMS: DRAFT -> REQUESTED after the agendas and the stock are re-checked. While REQUESTED it may be corrected. */
    public function request(string $id, string $number, User $actor): void
    {
        DB::transaction(function () use ($id, $number, $actor): void {
            $r = $this->lock($id, ['DRAFT', 'REQUESTED'], 'dimohonkan');
            $number = trim($number);                                     // one MIMS reservation may hold several agendas
            if ($r->status === 'DRAFT') {
                $errors = [];
                foreach (DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->whereNull('released_at')->get() as $agenda) {
                    $app = DB::table('applications')->where('id', $agenda->application_id)->first();
                    $why = $this->blockers($app, existingPlan: true);
                    if (self::powerVa($app) !== (int) $agenda->power_va) {
                        $why[] = 'Daya sudah berubah; keluarkan lalu tambahkan lagi.';
                    }
                    if ($why !== []) {
                        $errors[] = $app->application_number.': '.implode(' ', $why);
                    }
                }
                if ($errors !== []) {
                    throw new AssignmentRuleViolation(implode(' | ', $errors));
                }
                $totals = DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->where('quantity', '>', 0)->pluck('quantity', 'khs_item_id')->map(fn ($q) => (float) $q)->all();
                if ($totals === []) {
                    throw new AssignmentRuleViolation('Reservasi tidak memuat material.');
                }
                $this->assertStock($r->warehouse_id, $totals);
                $this->followSingleNumbers($id);
                $problems = $this->materialProblems($id);
                if ($problems !== []) {
                    throw new AssignmentRuleViolation(implode(' ', $problems));
                }
                $this->assertMaterialStock($r);
            }
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'REQUESTED', 'mims_reservation_no' => $number, 'mims_send_method' => 'MANUAL', 'requested_by' => $r->requested_by ?? $actor->getKey(), 'requested_at' => $r->requested_at ?? now(), 'updated_at' => now()]);
            $this->event($id, 'REQUESTED', $actor, null, ['reservation_no' => $number, 'previous' => $r->mims_reservation_no]);
        });
    }

    /** ERP material numbers a KHS item can be taken as. @param list<string> $khsIds @return array<string,list<string>> */
    public function materialOptions(array $khsIds): array
    {
        return DB::table('khs_material_map')->whereIn('khs_item_id', $khsIds)->orderBy('material_no')->get(['khs_item_id', 'material_no'])
            ->groupBy('khs_item_id')->map(fn ($rows) => $rows->pluck('material_no')->map(fn ($no) => (string) $no)->all())->all();
    }

    /**
     * Name and stock per ERP material number in the warehouse's latest stock pull: `ready` as the ERP has it, `available` after the other reservations made since that pull.
     * Empty when that pull carries no material rows (a stock file keyed by KHS), so nothing can be checked per number.
     *
     * @return array<string,array{name:?string,unit:?string,ready:float,available:float}>
     */
    public function materialStock(string $warehouseId, ?string $exceptReservationId = null): array
    {
        $snapshot = DB::table('stock_snapshots')->where('warehouse_id', $warehouseId)->where('as_of', '<=', $this->today())->orderByDesc('as_of')->first(['id', 'as_of']);
        if ($snapshot === null) {
            return [];
        }
        $held = DB::table('sr_reservation_line_materials as m')->join('sr_reservation_lines as l', 'l.id', '=', 'm.sr_reservation_line_id')->join('sr_reservations as r', 'r.id', '=', 'l.sr_reservation_id')
            ->where('r.warehouse_id', $warehouseId)->whereIn('r.status', ['REQUESTED', 'SAP_SENT'])->when($exceptReservationId, fn ($q) => $q->where('r.id', '<>', $exceptReservationId))
            ->whereRaw('(coalesce(r.sap_sent_at, r.requested_at) at time zone ?)::date > ?', [config('distriva.business_timezone'), $snapshot->as_of])
            ->groupBy('m.material_no')->selectRaw('m.material_no, sum(m.quantity) q')->pluck('q', 'material_no');
        $out = [];
        foreach (DB::table('stock_snapshot_materials')->where('snapshot_id', $snapshot->id)->get(['material_no', 'material_name', 'unit', 'stock_ready']) as $row) {
            $no = ltrim((string) $row->material_no, '0');
            $ready = (float) $row->stock_ready;
            $out[$no] = ['name' => $row->material_name, 'unit' => $row->unit, 'ready' => $ready, 'available' => $ready - (float) ($held[$no] ?? 0)];
        }

        return $out;
    }

    /** @param list<array{khs_code:string,items:list<array{material_no:string,quantity:mixed}>}> $choices @return list<array<string,mixed>> */
    private function chooseMaterials(object $r, array $choices): array
    {
        $applied = [];
        foreach ($choices as $choice) {
            $line = DB::table('sr_reservation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.sr_reservation_id', $r->id)->where('k.code', $choice['khs_code'])->first(['l.id', 'l.khs_item_id', 'l.quantity'])
                ?? throw new AssignmentRuleViolation("KHS {$choice['khs_code']} tidak ada pada reservasi ini.");
            $allowed = $this->materialOptions([$line->khs_item_id])[$line->khs_item_id] ?? [];
            DB::table('sr_reservation_line_materials')->where('sr_reservation_line_id', $line->id)->delete();
            $total = 0.0;
            foreach ($choice['items'] as $item) {
                $no = ltrim(trim($item['material_no']), '0');
                if (! in_array($no, $allowed, true)) {
                    throw new AssignmentRuleViolation("Nomor material {$item['material_no']} tidak dipetakan ke KHS {$choice['khs_code']}.");
                }
                $total += (float) $item['quantity'];
                DB::table('sr_reservation_line_materials')->insert(['id' => (string) Str::uuid(), 'sr_reservation_line_id' => $line->id, 'material_no' => $no, 'quantity' => $item['quantity']]);
            }
            if ($r->status === 'REQUESTED' && abs($total - (float) $line->quantity) > 1e-9) {
                throw new AssignmentRuleViolation("KHS {$choice['khs_code']}: jumlah per nomor material {$total} harus sama dengan total ".(float) $line->quantity.'.');
            }
            $applied[] = ['khs_code' => $choice['khs_code'], 'items' => $choice['items']];
        }

        return $applied;
    }

    /** A material with only one ERP number needs no choosing: its split follows the total. */
    private function followSingleNumbers(string $reservationId): void
    {
        $lines = DB::table('sr_reservation_lines')->where('sr_reservation_id', $reservationId)->get(['id', 'khs_item_id', 'quantity']);
        $options = $this->materialOptions($lines->pluck('khs_item_id')->all());
        foreach ($lines as $line) {
            if (count($options[$line->khs_item_id] ?? []) !== 1) {
                continue;
            }
            DB::table('sr_reservation_line_materials')->where('sr_reservation_line_id', $line->id)->delete();
            if ((float) $line->quantity > 0) {
                DB::table('sr_reservation_line_materials')->insert(['id' => (string) Str::uuid(), 'sr_reservation_line_id' => $line->id, 'material_no' => $options[$line->khs_item_id][0], 'quantity' => $line->quantity]);
            }
        }
    }

    /**
     * What is wrong with the choice of ERP numbers: every total of a mapped material must be split exactly over its numbers (an unmapped material has none to choose).
     *
     * @return list<string>
     */
    public function materialProblems(string $reservationId): array
    {
        $lines = DB::table('sr_reservation_lines as l')->join('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.sr_reservation_id', $reservationId)->orderBy('k.code')->get(['l.id', 'l.khs_item_id', 'l.quantity', 'k.code']);
        $options = $this->materialOptions($lines->pluck('khs_item_id')->all());
        $chosen = DB::table('sr_reservation_line_materials')->whereIn('sr_reservation_line_id', $lines->pluck('id'))->groupBy('sr_reservation_line_id')->selectRaw('sr_reservation_line_id, sum(quantity) q')->pluck('q', 'sr_reservation_line_id');
        $problems = [];
        foreach ($lines as $line) {
            $total = (float) $line->quantity;
            $split = (float) ($chosen[$line->id] ?? 0);
            if (isset($options[$line->khs_item_id]) && abs($total - $split) > 1e-9) {
                $problems[] = "KHS {$line->code}: pilih nomor material SAP; terpilih {$split} dari {$total}.";
            }
        }

        return $problems;
    }

    /** The chosen numbers must be in stock (checked only when the stock pull lists material numbers). */
    private function assertMaterialStock(object $r): void
    {
        $stock = $this->materialStock($r->warehouse_id, $r->id);
        if ($stock === []) {
            return;
        }
        $short = [];
        $chosen = DB::table('sr_reservation_line_materials as m')->join('sr_reservation_lines as l', 'l.id', '=', 'm.sr_reservation_line_id')->where('l.sr_reservation_id', $r->id)->get(['m.material_no', 'm.quantity']);
        foreach ($chosen as $m) {
            $available = (float) ($stock[$m->material_no]['available'] ?? 0);
            if ((float) $m->quantity > $available + 1e-9) {
                $short[] = "Nomor {$m->material_no}: butuh ".(float) $m->quantity.", tersedia {$available}.";
            }
        }
        if ($short !== []) {
            throw new AssignmentRuleViolation('Stok gudang tidak cukup. '.implode(' ', $short));
        }
    }

    /** @param array<string,float> $need quantity per KHS item id */
    private function assertStock(string $warehouseId, array $need): void
    {
        DB::table('warehouses')->where('id', $warehouseId)->lockForUpdate()->first();
        $position = $this->stock->position([$warehouseId], $this->today());
        $codes = DB::table('khs_items')->whereIn('id', array_keys($need))->pluck('code', 'id');
        $short = [];
        foreach ($need as $khs => $quantity) {
            $available = (float) ($position[$khs]['available'] ?? 0);
            if ($quantity > $available + 1e-9) {
                $short[] = "KHS {$codes[$khs]}: butuh {$quantity}, tersedia {$available}.";
            }
        }
        if ($short !== []) {
            throw new AssignmentRuleViolation('Stok gudang tidak cukup. '.implode(' ', $short));
        }
    }

    /**
     * Per agenda, after the request: cable used, seal numbers and serial numbers. Saved piece by piece; a field that is sent replaces what was there.
     *
     * @param  list<array{application_id:string,cable_m?:mixed,seals?:list<string>,serials?:list<array{khs_code:string,serial_number:string,material_no?:?string}>}>  $items
     */
    public function realize(string $id, array $items, User $actor): void
    {
        DB::transaction(function () use ($id, $items, $actor): void {
            $this->lock($id, ['REQUESTED'], 'diisi realisasinya');
            $serialCodes = array_merge(...array_values((array) config('distriva.sr_reservation.serial_codes')));
            foreach ($items as $item) {
                $agenda = DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->where('application_id', $item['application_id'])->whereNull('released_at')->first()
                    ?? throw new AssignmentRuleViolation('Ada agenda yang tidak termasuk reservasi ini.');
                $values = [];
                if (array_key_exists('cable_m', $item)) {
                    $values['actual_cable_m'] = $item['cable_m'];
                }
                if (array_key_exists('seals', $item)) {
                    $seals = array_values(array_filter(array_map('trim', $item['seals'] ?? []), fn (string $s): bool => $s !== ''));
                    $taken = $seals === [] ? false : $this->otherOpenAgendas($agenda->id)->whereRaw('exists (select 1 from jsonb_array_elements_text(x.seal_numbers) s where s = any(?))', ['{'.implode(',', array_map(fn ($s) => '"'.addcslashes($s, '"\\').'"', $seals)).'}'])->exists();
                    if ($taken || count($seals) !== count(array_unique($seals))) {
                        throw new AssignmentRuleViolation('Nomor segel dobel atau sudah dipakai agenda lain.');
                    }
                    $values['seal_numbers'] = json_encode($seals);
                }
                if ($values !== []) {
                    DB::table('sr_reservation_applications')->where('id', $agenda->id)->update($values);
                }
                if (array_key_exists('serials', $item)) {
                    DB::table('sr_reservation_serials')->where('sr_reservation_application_id', $agenda->id)->delete();
                    foreach ($item['serials'] ?? [] as $serial) {
                        if (! in_array($serial['khs_code'], $serialCodes, true)) {
                            throw new AssignmentRuleViolation("KHS {$serial['khs_code']} tidak memakai nomor seri (hanya kWh meter dan MCB).");
                        }
                        $khs = DB::table('khs_items')->where('code', $serial['khs_code'])->value('id') ?? throw new AssignmentRuleViolation("KHS {$serial['khs_code']} tidak dikenal.");
                        $number = trim($serial['serial_number']);
                        $used = $this->otherOpenAgendas(null)->join('sr_reservation_serials as n', 'n.sr_reservation_application_id', '=', 'x.id')->where('n.khs_item_id', $khs)->where('n.serial_number', $number)->exists();
                        if ($used) {
                            throw new AssignmentRuleViolation("Nomor seri {$number} sudah dipakai.");
                        }
                        $material = isset($serial['material_no']) ? ltrim(trim($serial['material_no']), '0') : null;
                        if ($material !== null && ! in_array($material, $this->materialOptions([$khs])[$khs] ?? [], true)) {
                            throw new AssignmentRuleViolation("Nomor material {$serial['material_no']} tidak dipetakan ke KHS {$serial['khs_code']}.");
                        }
                        DB::table('sr_reservation_serials')->insert(['id' => (string) Str::uuid(), 'sr_reservation_application_id' => $agenda->id, 'khs_item_id' => $khs, 'serial_number' => $number, 'material_no' => $material]);
                    }
                }
            }
            DB::table('sr_reservations')->where('id', $id)->update(['updated_at' => now()]);
            $this->event($id, 'REALIZED', $actor, null, ['agendas' => count($items)]);
        });
    }

    /** Agendas still in a running reservation, other than the named one. */
    private function otherOpenAgendas(?string $exceptAgendaId): Builder
    {
        return DB::table('sr_reservation_applications as x')->whereNull('x.released_at')->when($exceptAgendaId, fn (Builder $q) => $q->where('x.id', '<>', $exceptAgendaId));
    }

    /**
     * What still stops "Kirim SAP": an agenda without its serials or cable, or a total that differs from what the agendas realised (the two must be equal).
     *
     * @return array{blockers:list<string>,matches:array<string,float>} `matches` = the totals as realised, per KHS item id, for materials realised per agenda
     */
    public function sapCheck(string $id): array
    {
        $agendas = DB::table('sr_reservation_applications as x')->join('applications as a', 'a.id', '=', 'x.application_id')->where('x.sr_reservation_id', $id)->whereNull('x.released_at')->get(['x.*', 'a.application_number']);
        $totals = DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->pluck('quantity', 'khs_item_id')->map(fn ($q) => (float) $q)->all();
        $serials = DB::table('sr_reservation_serials')->whereIn('sr_reservation_application_id', $agendas->pluck('id'))->get()->groupBy('sr_reservation_application_id');
        $cables = array_flip($this->itemIds('cable_codes'));
        $categories = [];
        foreach (['kwh' => 'kWh meter', 'mcb' => 'MCB'] as $key => $label) {
            $categories[$label] = array_flip(DB::table('khs_items')->whereIn('code', (array) config("distriva.sr_reservation.serial_codes.{$key}"))->pluck('id')->all());
        }
        $serialIds = array_replace(...array_values($categories));

        $blockers = [];
        $realised = [];
        foreach (array_keys(array_intersect_key($totals, $cables + $serialIds)) as $khs) {
            $realised[$khs] = 0.0;
        }
        foreach ($agendas as $agenda) {
            $needs = json_decode($agenda->needs, true);
            $own = $serials[$agenda->id] ?? collect();
            foreach ($categories as $label => $ids) {
                $wanted = array_intersect_key($needs, $ids) !== [] && array_sum(array_intersect_key($totals, $ids)) > 0;
                if ($wanted && $own->whereIn('khs_item_id', array_keys($ids))->isEmpty()) {
                    $blockers[] = "{$agenda->application_number}: nomor seri {$label} belum diisi.";
                }
            }
            foreach ($own as $s) {
                $realised[$s->khs_item_id] = ($realised[$s->khs_item_id] ?? 0) + 1;
            }
            foreach (array_keys(array_intersect_key($needs, $cables)) as $khs) {
                if ($agenda->actual_cable_m === null) {
                    $blockers[] = "{$agenda->application_number}: panjang kabel belum diisi.";
                } else {
                    $realised[$khs] = ($realised[$khs] ?? 0) + (float) $agenda->actual_cable_m;
                }
            }
        }
        $sealCount = $agendas->sum(fn (object $a): int => count(json_decode($a->seal_numbers, true)));
        foreach ($this->itemIds('seal_codes') as $khs) {
            if (isset($totals[$khs])) {
                $realised[$khs] = (float) $sealCount;
            }
        }
        $codes = DB::table('khs_items')->whereIn('id', array_keys($realised))->pluck('code', 'id');
        foreach ($realised as $khs => $actual) {
            $total = (float) ($totals[$khs] ?? 0);
            if (abs($total - $actual) > 1e-9) {
                $blockers[] = "KHS {$codes[$khs]}: total reservasi {$total}, realisasi {$actual}. Samakan totalnya.";
            }
        }

        $blockers = [...$blockers, ...$this->materialProblems($id), ...$this->serialNumberProblems($id)];

        return ['blockers' => $blockers, 'matches' => $realised];
    }

    /** When a material is split over several ERP numbers, every serial names its number and the counts per number equal the split. @return list<string> */
    private function serialNumberProblems(string $reservationId): array
    {
        $serials = DB::table('sr_reservation_serials as n')->join('sr_reservation_applications as x', 'x.id', '=', 'n.sr_reservation_application_id')->join('khs_items as k', 'k.id', '=', 'n.khs_item_id')
            ->where('x.sr_reservation_id', $reservationId)->whereNull('x.released_at')->get(['n.khs_item_id', 'n.material_no', 'n.serial_number', 'k.code']);
        $split = DB::table('sr_reservation_line_materials as m')->join('sr_reservation_lines as l', 'l.id', '=', 'm.sr_reservation_line_id')->where('l.sr_reservation_id', $reservationId)
            ->get(['l.khs_item_id', 'm.material_no', 'm.quantity'])->groupBy('khs_item_id');
        $problems = [];
        foreach ($serials->groupBy('khs_item_id') as $khs => $own) {
            $numbers = $split[$khs] ?? collect();
            if ($numbers->count() === 0) {
                continue;
            }
            if ($numbers->count() === 1) {
                foreach ($own->filter(fn ($s) => $s->material_no !== null && $s->material_no !== (string) $numbers->first()->material_no) as $s) {
                    $problems[] = "Nomor seri {$s->serial_number}: nomor material {$s->material_no} tidak dipilih pada KHS {$s->code}.";
                }

                continue;
            }
            if ($own->contains(fn ($s) => $s->material_no === null)) {
                $problems[] = "KHS {$own->first()->code}: tiap nomor seri harus menyebut nomor materialnya.";

                continue;
            }
            $counted = $own->countBy('material_no');
            foreach ($numbers->pluck('material_no')->merge($counted->keys())->map(fn ($no) => (string) $no)->unique() as $no) {
                $chosen = (float) ($numbers->firstWhere('material_no', $no)->quantity ?? 0);
                if (abs($chosen - (float) ($counted[$no] ?? 0)) > 1e-9) {
                    $problems[] = "Nomor {$no}: dipilih {$chosen}, nomor seri ".(int) ($counted[$no] ?? 0).'.';
                }
            }
        }

        return $problems;
    }

    /** The split of serial materials as the serial numbers say it, when every serial names its number. */
    private function matchSplitToSerials(string $reservationId): bool
    {
        $changed = false;
        foreach (DB::table('sr_reservation_lines')->where('sr_reservation_id', $reservationId)->get(['id', 'khs_item_id']) as $line) {
            $own = DB::table('sr_reservation_serials as n')->join('sr_reservation_applications as x', 'x.id', '=', 'n.sr_reservation_application_id')
                ->where('x.sr_reservation_id', $reservationId)->whereNull('x.released_at')->where('n.khs_item_id', $line->khs_item_id)->get(['n.material_no']);
            if ($own->isEmpty() || $own->contains(fn ($s) => $s->material_no === null)) {
                continue;
            }
            $counted = $own->countBy('material_no')->all();
            $current = DB::table('sr_reservation_line_materials')->where('sr_reservation_line_id', $line->id)->pluck('quantity', 'material_no')->map(fn ($q) => (int) $q)->all();
            ksort($counted);
            ksort($current);
            if ($counted === $current) {
                continue;
            }
            DB::table('sr_reservation_line_materials')->where('sr_reservation_line_id', $line->id)->delete();
            foreach ($counted as $no => $q) {
                DB::table('sr_reservation_line_materials')->insert(['id' => (string) Str::uuid(), 'sr_reservation_line_id' => $line->id, 'material_no' => (string) $no, 'quantity' => $q]);
            }
            $changed = true;
        }

        return $changed;
    }

    /** Sets the totals of the materials realised per agenda (cable, serials, seals) to what was realised, before sending to SAP; MIMS must be corrected the same way. */
    public function matchRealisation(string $id, User $actor): void
    {
        $codes = [];
        DB::transaction(function () use ($id, $actor, &$codes): void {
            $r = $this->lock($id, ['REQUESTED'], 'disamakan');
            $matches = $this->sapCheck($id)['matches'];
            $codes = DB::table('khs_items')->whereIn('id', array_keys($matches))->pluck('code', 'id');
            $lines = DB::table('sr_reservation_lines')->where('sr_reservation_id', $id)->get()->keyBy('khs_item_id');
            $corrections = [];
            foreach ($matches as $khs => $actual) {
                if (abs((float) ($lines[$khs]->quantity ?? 0) - $actual) > 1e-9) {
                    $corrections[] = ['khs_code' => $codes[$khs], 'quantity' => $actual, 'reason' => 'Disamakan dengan realisasi per agenda'];
                }
            }
            $applied = $this->correct($r, $corrections);
            $this->followSingleNumbers($id);
            $split = $this->matchSplitToSerials($id);
            if ($applied === [] && ! $split) {
                throw new AssignmentRuleViolation('Total sudah sama dengan realisasi.');
            }
            $this->assertMaterialStock($r);
            $this->event($id, 'MATCHED', $actor, null, ['corrections' => $applied, 'material_split' => $split]);
            DB::table('sr_reservations')->where('id', $id)->update(['updated_at' => now()]);
        });
    }

    public function sendSap(string $id, ?string $reference, User $actor): void
    {
        DB::transaction(function () use ($id, $reference, $actor): void {
            $this->lock($id, ['REQUESTED'], 'dikirim ke SAP');
            $blockers = $this->sapCheck($id)['blockers'];
            if ($blockers !== []) {
                throw new AssignmentRuleViolation(implode(' ', $blockers));
            }
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'SAP_SENT', 'sap_sent_by' => $actor->getKey(), 'sap_sent_at' => now(), 'sap_reference' => $reference, 'updated_at' => now()]);
            $this->event($id, 'SAP_SENT', $actor, null, ['reference' => $reference]);
        });
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $this->lock($id, ['DRAFT', 'REQUESTED'], 'dibatalkan');
            DB::table('sr_reservation_applications')->where('sr_reservation_id', $id)->whereNull('released_at')->update(['released_at' => now(), 'released_by' => $actor->getKey(), 'release_reason' => $reason]);
            DB::table('sr_reservations')->where('id', $id)->update(['status' => 'CANCELLED', 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => $reason, 'updated_at' => now()]);
            $this->event($id, 'CANCELLED', $actor, $reason);
        });
    }

    /** The connection of a 1-phase customer found that the network must be extended: it leaves a draft reservation; a requested or sent one keeps it (owner: the APP material is still used). */
    public function reportExtension(string $applicationId, string $reason, ?float $distance, User $actor): void
    {
        DB::transaction(function () use ($applicationId, $reason, $distance, $actor): void {
            $app = DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $power = self::powerVa($app);
            if ($power === null || self::phaseOf($power) !== 1) {
                throw new AssignmentRuleViolation('Temuan lapangan ini hanya untuk sambungan 1 phasa; 3 phasa ditentukan oleh survei.');
            }
            if (! in_array($app->current_status, [...self::ONE_PHASE_STATUSES, self::CONNECTING], true)) {
                throw new AssignmentRuleViolation("Status permohonan {$app->current_status}: tidak sedang dalam penyambungan.");
            }
            if (self::activeFinding($applicationId)->exists()) {
                throw new AssignmentRuleViolation('Permohonan sudah dilaporkan perlu perluasan.');
            }
            DB::table('sr_extension_findings')->insert(['id' => (string) Str::uuid(), 'application_id' => $applicationId, 'reason' => $reason, 'distance_m' => $distance, 'reported_by' => $actor->getKey(), 'reported_at' => now()]);
            $draft = DB::table('sr_reservation_applications as x')->join('sr_reservations as r', 'r.id', '=', 'x.sr_reservation_id')->where('x.application_id', $applicationId)->whereNull('x.released_at')->where('r.status', 'DRAFT')->value('r.id');
            if ($draft !== null) {
                $why = 'Saat penyambungan ditemukan perlu perluasan.';
                DB::table('sr_reservation_applications')->where('sr_reservation_id', $draft)->whereNull('released_at')->count() === 1
                    ? $this->cancel($draft, $why, $actor)
                    : $this->removeApplication($draft, $applicationId, $why, $actor);
            }
        });
    }

    /** A finding recorded by mistake is withdrawn, as long as no extension work followed it. What the finding took out of a draft stays out. */
    public function withdrawExtension(string $applicationId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($applicationId, $reason, $actor): void {
            DB::table('applications')->where('id', $applicationId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $finding = self::activeFinding($applicationId)->first() ?? throw new AssignmentRuleViolation('Permohonan ini tidak sedang ditandai perlu perluasan.');
            $followed = match (true) {
                DB::table('application_surveys')->where('application_id', $applicationId)->where('status', '<>', 'CANCELLED')->where('created_at', '>=', $finding->reported_at)->exists() => 'survei (batalkan surveinya dulu)',
                ProposalService::liveFor($applicationId) !== null => 'usulan perluasan',
                DB::table('application_drawings')->where('application_id', $applicationId)->exists() => 'gambar',
                DB::table('allocations')->where('application_id', $applicationId)->where('status', '<>', 'CANCELLED')->exists() => 'alokasi',
                default => null,
            };
            if ($followed !== null) {
                throw new AssignmentRuleViolation("Tanda perlu perluasan tidak dapat dibatalkan karena sudah ada {$followed}.");
            }
            DB::table('sr_extension_findings')->where('id', $finding->id)->update(['cancelled_by' => $actor->getKey(), 'cancelled_at' => now(), 'cancel_reason' => $reason]);
        });
    }

    /** Material already reserved for the application by its requested or sent reservation, per KHS item (cable as used once known): an extension allocation does not repeat it. @return array<string,float> */
    public static function reservedFor(string $applicationId): array
    {
        $agenda = DB::table('sr_reservation_applications as x')->join('sr_reservations as r', 'r.id', '=', 'x.sr_reservation_id')->where('x.application_id', $applicationId)->whereNull('x.released_at')
            ->whereIn('r.status', ['REQUESTED', 'SAP_SENT'])->first(['x.needs', 'x.actual_cable_m']);
        if ($agenda === null) {
            return [];
        }
        $needs = array_map('floatval', json_decode($agenda->needs, true));
        if ($agenda->actual_cable_m !== null) {
            foreach (DB::table('khs_items')->whereIn('code', (array) config('distriva.sr_reservation.cable_codes'))->pluck('id') as $cable) {
                if (isset($needs[$cable])) {
                    $needs[$cable] = (float) $agenda->actual_cable_m;
                }
            }
        }

        return $needs;
    }

    /** @return list<string> KHS item ids of a configured code list */
    private function itemIds(string $key): array
    {
        return DB::table('khs_items')->whereIn('code', (array) config("distriva.sr_reservation.{$key}"))->pluck('id')->all();
    }

    /** @param list<string> $allowed */
    private function lock(string $id, array $allowed, string $verb): object
    {
        $r = DB::table('sr_reservations')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if (! in_array($r->status, $allowed, true)) {
            throw new AssignmentRuleViolation("Reservasi berstatus {$r->status} tidak dapat {$verb}.");
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
