<?php

namespace App\Services\Rab;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Bom\BomAst;
use App\Services\Drawings\ApprovalLock;
use App\Services\Prices\PriceBookService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * RAB run (docs/62 §21, owner decisions 2026-11-07): prices the FROZEN lines of an APPROVED MTO package with the price book valid on the run
 * date and the service zone of the application's UP3. Per construction group, as in the workbook (REKAP):
 *   material (qty x price; nothing when the material status is PLN) + service (install x install price + remove x remove price, zone price)
 *   + commissioning + K3L (quantity x install price) + insurance (per insured code: ROUND(insured value x 3/1000, 0) x quantity)
 *   = subtotal; PPN = ROUND(subtotal x 11%, 0); group total = ROUNDUP(subtotal + PPN, -2); grand total = sum of the group totals.
 * No rounding happens on a line. Anything that cannot be priced is REPORTED (409), never guessed. Callers authorize the actor first.
 */
class RabService
{
    public const PPN = 0.11;

    public const INSURANCE = 0.003;

    public function __construct(private readonly PriceBookService $prices) {}

    /**
     * Pure calculation. Nothing is stored.
     *
     * @return array<string,mixed>
     */
    public function calculate(string $packageId, ?string $date = null): array
    {
        $pkg = DB::table('mto_packages')->where('id', $packageId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if ($pkg->status !== 'APPROVED') {
            throw new AssignmentRuleViolation("Paket MTO berstatus {$pkg->status}; RAB hanya dapat dihitung dari paket MTO yang APPROVED.");
        }
        ApprovalLock::assertOpen((string) $pkg->application_id, 'RAB');
        $date ??= now(config('distriva.business_timezone'))->toDateString();
        $app = DB::table('applications')->where('id', $pkg->application_id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $ulp = DB::table('organizational_units')->where('id', $app->organizational_unit_id)->first();
        $up3Id = (string) ($ulp->unit_type === 'UP3' ? $ulp->id : ($ulp->parent_id ?? throw new AssignmentRuleViolation('Unit permohonan tidak memiliki UP3.')));
        ['book' => $book, 'zone' => $zone] = $this->prices->resolve($up3Id, $date);

        $mto = DB::table('mto_lines')->where('package_id', $packageId)->orderBy('group_code')->orderBy('sequence')->get();
        if ($mto->isEmpty()) {
            throw new AssignmentRuleViolation('Paket MTO tidak memiliki baris kebutuhan material.');
        }
        $roles = $this->bomRoles($mto->pluck('bom_header_id')->unique()->all());

        $khsIds = $mto->pluck('khs_item_id')->merge(collect($roles)->flatMap(fn ($r) => $r['insured']))->unique()->values();
        $items = DB::table('price_book_items')->where('price_book_id', $book->id)->whereIn('khs_item_id', $khsIds)->get()->keyBy('khs_item_id');
        $service = DB::table('price_book_service_prices')->whereIn('price_book_item_id', $items->pluck('id'))->where('zone', $zone)->get()->keyBy('price_book_item_id');

        $missing = [];
        foreach ($mto as $l) {
            $it = $items[$l->khs_item_id] ?? null;
            $needsService = (float) $l->install != 0.0 || (float) $l->remove != 0.0 || isset($roles[$l->bom_header_id]['commissioning'][$l->sequence]) || isset($roles[$l->bom_header_id]['k3l'][$l->sequence]);
            if ($it === null || ($needsService && ! isset($service[$it->id]))) {
                $missing[$l->khs_code] = $it === null ? 'tidak ada di buku harga' : "tidak memiliki harga jasa zona {$zone}";
            }
        }
        if ($missing !== []) {
            $list = collect($missing)->map(fn ($why, $code) => "{$code} ({$why})")->take(10)->implode('; ');
            throw new AssignmentRuleViolation(count($missing)." kode KHS pada MTO belum dapat dihargai oleh buku harga \"{$book->name}\": {$list}.");
        }

        $names = DB::table('khs_items')->whereIn('id', $khsIds)->pluck('code', 'id');
        $lines = [];
        $groups = [];
        $warnings = [];
        foreach ($mto->groupBy('group_code') as $group => $gl) {
            $g = ['material' => 0.0, 'service' => 0.0, 'commissioning' => 0.0, 'k3l' => 0.0, 'insurance' => 0.0, 'material_pln' => 0.0];   // material_pln = the part of material supplied by PLN/MDU (a breakdown, never added twice)
            $qty = [];
            foreach ($gl as $l) {
                $it = $items[$l->khs_item_id];
                $svc = $service[$it->id] ?? null;
                $role = $roles[$l->bom_header_id] ?? ['commissioning' => [], 'k3l' => [], 'insured' => []];
                $isC = isset($role['commissioning'][$l->sequence]);
                $isK = isset($role['k3l'][$l->sequence]);
                $material = (float) $l->material;
                $install = (float) $l->install;
                $remove = (float) $l->remove;
                $row = ['group' => $group, 'sequence' => (int) $l->sequence, 'category' => $isC ? 'COMMISSIONING' : ($isK ? 'K3L' : 'ITEM'), 'khs_item_id' => $l->khs_item_id, 'khs_code' => $l->khs_code,
                    'khs_name' => $l->khs_name, 'unit_text' => $l->unit_text, 'qty_material' => $material, 'qty_install' => $install, 'qty_remove' => $remove, 'material_status' => $it->material_status,
                    'material_price' => $it->material_price === null ? null : (float) $it->material_price, 'install_price' => $svc ? (float) $svc->install_price : null, 'remove_price' => $svc ? (float) $svc->remove_price : null,
                    'insured_value' => null, 'material_cost' => 0.0, 'install_cost' => 0.0, 'remove_cost' => 0.0, 'insurance_cost' => 0.0];
                if ($isC || $isK) {                                   // priced at the install price, quantity = the volume taken from the drawing page
                    $row['install_cost'] = $material * $row['install_price'];
                    $g[$isC ? 'commissioning' : 'k3l'] += $row['install_cost'];
                } else {
                    if ($it->material_status === 'PRICED') {
                        $row['material_cost'] = $material * (float) $it->material_price;
                    } elseif ($it->insured_value !== null && (float) $it->insured_value > 0.0) {   // PLN/MDU material counts at its MDU value (HS + transport), owner decision 2026-11-09
                        $row['material_price'] = (float) $it->insured_value;
                        $row['material_cost'] = $material * (float) $it->insured_value;
                        $g['material_pln'] += $row['material_cost'];
                    } elseif ($material != 0.0) {
                        $warnings[] = ['group' => $group, 'khs_code' => (string) $l->khs_code, 'code' => 'NO_PLN_VALUE', 'message' => 'Material PLN/MDU ini dipakai tetapi buku harga tidak memiliki nilainya (nilai MDU); biaya materialnya dihitung 0.'];
                    }
                    $row['install_cost'] = $install * ($row['install_price'] ?? 0.0);
                    $row['remove_cost'] = $remove * ($row['remove_price'] ?? 0.0);
                    $g['material'] += $row['material_cost'];
                    $g['service'] += $row['install_cost'] + $row['remove_cost'];
                    $qty[$l->khs_item_id] = ($qty[$l->khs_item_id] ?? 0.0) + $material;
                }
                $lines[] = $row;
            }
            $seen = [];
            foreach ($gl->pluck('bom_header_id')->unique() as $header) {
                foreach ($roles[$header]['insured'] ?? [] as $id) {
                    if (isset($seen[$id]) || ($qty[$id] ?? 0.0) == 0.0) {
                        continue;
                    }
                    $seen[$id] = true;
                    $value = isset($items[$id]) && $items[$id]->insured_value !== null ? (float) $items[$id]->insured_value : null;
                    $cost = $value === null ? 0.0 : round($value * self::INSURANCE, 0) * $qty[$id];
                    if ($value === null || $value == 0.0) {
                        $warnings[] = ['group' => $group, 'khs_code' => $names[$id] ?? $id, 'code' => 'NO_INSURED_VALUE', 'message' => 'Kode ini ada di daftar asuransi BOM tetapi buku harga tidak memiliki nilai asuransinya; asuransi dihitung 0.'];
                    }
                    $g['insurance'] += $cost;
                    $lines[] = ['group' => $group, 'sequence' => 0, 'category' => 'INSURANCE', 'khs_item_id' => $id, 'khs_code' => (string) ($names[$id] ?? ''), 'khs_name' => null, 'unit_text' => null,
                        'qty_material' => $qty[$id], 'qty_install' => 0.0, 'qty_remove' => 0.0, 'material_status' => $items[$id]->material_status ?? null, 'material_price' => null, 'install_price' => null, 'remove_price' => null,
                        'insured_value' => $value, 'material_cost' => 0.0, 'install_cost' => 0.0, 'remove_cost' => 0.0, 'insurance_cost' => $cost];
                }
            }
            $pln = $g['material_pln'];
            unset($g['material_pln']);
            $subtotal = array_sum($g);
            $ppn = round($subtotal * self::PPN, 0);
            $groups[$group] = $g + ['material_pln' => $pln, 'subtotal' => $subtotal, 'ppn' => $ppn, 'total' => ceil(round($subtotal + $ppn, 2) / 100) * 100];
        }
        $grand = array_sum(array_column($groups, 'total'));
        $params = ['ppn_rate' => self::PPN, 'insurance_rate' => self::INSURANCE, 'rounding' => 'PPN ROUND 0; group total ROUNDUP -2 (workbook REKAP)'];
        $hash = hash('sha256', json_encode(['pkg' => $pkg->snapshot_hash, 'book' => $book->id, 'zone' => $zone, 'date' => $date, 'params' => $params, 'lines' => $lines, 'groups' => $groups], JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));

        return ['application_id' => $app->id, 'mto_package_id' => $packageId, 'valid_on' => $date, 'price_book' => ['id' => $book->id, 'name' => $book->name, 'valid_from' => $book->valid_from], 'up3_unit_id' => $up3Id, 'zone' => $zone,
            'parameters' => $params, 'groups' => $groups, 'grand_total' => $grand, 'lines' => $lines, 'warnings' => $warnings, 'snapshot_hash' => $hash];
    }

    /**
     * Calculates and stores a new run (history is never overwritten).
     *
     * @return array<string,mixed>
     */
    public function run(string $packageId, User $actor, ?string $date = null): array
    {
        $calc = $this->calculate($packageId, $date);

        return DB::transaction(function () use ($calc, $actor): array {
            DB::table('applications')->where('id', $calc['application_id'])->lockForUpdate()->first();
            $number = ((int) DB::table('rab_runs')->where('application_id', $calc['application_id'])->max('run_number')) + 1;
            $id = (string) Str::uuid();
            DB::table('rab_runs')->insert(['id' => $id, 'application_id' => $calc['application_id'], 'mto_package_id' => $calc['mto_package_id'], 'run_number' => $number, 'price_book_id' => $calc['price_book']['id'],
                'up3_unit_id' => $calc['up3_unit_id'], 'zone' => $calc['zone'], 'valid_on' => $calc['valid_on'], 'parameters' => json_encode($calc['parameters']), 'groups' => json_encode($calc['groups']),
                'grand_total' => $calc['grand_total'], 'snapshot_hash' => $calc['snapshot_hash'], 'created_by' => $actor->getKey(), 'created_at' => now()]);
            foreach (array_chunk($calc['lines'], 200) as $chunk) {
                DB::table('rab_run_lines')->insert(array_map(fn ($l) => ['id' => (string) Str::uuid(), 'rab_run_id' => $id, 'group_code' => $l['group'], 'sequence' => $l['sequence'], 'category' => $l['category'], 'khs_item_id' => $l['khs_item_id'],
                    'khs_code' => $l['khs_code'], 'khs_name' => $l['khs_name'], 'description' => $l['description'] ?? null, 'unit_text' => $l['unit_text'], 'qty_material' => $l['qty_material'], 'qty_install' => $l['qty_install'], 'qty_remove' => $l['qty_remove'],
                    'material_status' => $l['material_status'], 'material_price' => $l['material_price'], 'install_price' => $l['install_price'], 'remove_price' => $l['remove_price'], 'insured_value' => $l['insured_value'],
                    'material_cost' => $l['material_cost'], 'install_cost' => $l['install_cost'], 'remove_cost' => $l['remove_cost'], 'insurance_cost' => $l['insurance_cost']], $chunk));
            }

            return ['id' => $id, 'run_number' => $number] + $calc;
        });
    }

    /**
     * Roles of the lines of each BOM version, read from its formulas (never from names): COMMISSIONING = H takes a {PARAM:COMMISSIONING:*}
     * volume; K3L = H is a plain reference to a commissioning row's H; insured = KHS ids of the insurance-basis (aggregate) rows.
     *
     * @param  list<string>  $headerIds
     * @return array<string,array{commissioning:array<int,true>,k3l:array<int,true>,insured:list<string>}>
     */
    private function bomRoles(array $headerIds): array
    {
        $out = [];
        foreach ($headerIds as $h) {
            $rows = DB::table('bom_lines')->where('bom_header_id', $h)->get(['sequence', 'khs_item_id', 'formulas']);
            $c = [];
            foreach ($rows as $r) {
                $ast = (json_decode($r->formulas, true) ?: [])['H'] ?? null;
                if ($ast !== null && collect(BomAst::variables($ast))->contains(fn ($v) => str_starts_with($v, 'PARAM:COMMISSIONING:'))) {
                    $c[$r->sequence] = true;
                }
            }
            $k = [];
            $ins = [];
            foreach ($rows as $r) {
                $ast = (json_decode($r->formulas, true) ?: [])['H'] ?? null;
                if (is_array($ast) && ($ast['t'] ?? null) === 'cell' && ($ast['sheet'] ?? null) === null && preg_match('/^H(\d+)$/', (string) ($ast['ref'] ?? ''), $m) && isset($c[(int) $m[1]])) {
                    $k[$r->sequence] = true;
                }
                if (BomAst::isAggregate($ast, (int) $r->sequence) && $r->khs_item_id !== null) {
                    $ins[] = $r->khs_item_id;
                }
            }
            $out[$h] = ['commissioning' => $c, 'k3l' => $k, 'insured' => array_values(array_unique($ins))];
        }

        return $out;
    }
}
