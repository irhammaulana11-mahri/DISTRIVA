<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Notifications\WorkflowNotifier;
use App\Support\CsvTable;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;

/**
 * Minimal stock (docs/62 §30): warehouses (one per organizational unit as needed) and dated, immutable stock snapshots imported by CSV, keyed by KHS code.
 * CSV columns: kode_khs, on_hand (stok), reserved (reservasi, optional), incoming (pasokan_masuk, optional), safety_stock (stok_pengaman, optional). All-or-nothing.
 * Availability = on_hand - reserved(ERP) - quantities of allocations whose materials part was confirmed in DISTRIVA after the snapshot date (earlier ones are already in the ERP reservation).
 */
class StockService
{
    /** @return array<string,list<string>> */
    private function headers(): array
    {
        return ['code' => ['kode_khs', 'khs', 'kode'], 'on_hand' => ['on_hand', 'stok', 'stok_ada', 'saldo'], 'reserved' => ['reserved', 'reservasi'], 'incoming' => ['incoming', 'incoming_confirmed', 'pasokan_masuk'], 'safety' => ['safety_stock', 'stok_pengaman']];
    }

    public function createWarehouse(string $code, string $name, string $unitId): string
    {
        $unit = DB::table('organizational_units')->where('id', $unitId)->first() ?? throw new AssignmentRuleViolation('Unit organisasi tidak ditemukan.');
        if (! $unit->is_active) {
            throw new AssignmentRuleViolation('Unit organisasi tidak aktif.');
        }
        $id = (string) Str::uuid();
        try {
            DB::transaction(fn () => DB::table('warehouses')->insert(['id' => $id, 'code' => strtoupper(trim($code)), 'name' => trim($name), 'organizational_unit_id' => $unitId, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]));
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation('Kode gudang sudah dipakai.', 0, $e) : $e;
        }

        return $id;
    }

    /**
     * Imports the ERP list of storage locations ({"gudang":{"data":[{plant, stor_loc, stor_loc_name, unit, jenis}]}} or the bare list). A warehouse is identified by (plant, stor_loc), so the import
     * is repeatable (names and units are updated). `unit` (ERP unit code) must match the code of an active organizational unit (UP3 for GI, ULP for GO); an unknown unit cancels the whole import.
     *
     * @param  list<array<string,mixed>>  $items
     * @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>}
     */
    public function importWarehouses(array $items, bool $dryRun): array
    {
        $units = DB::table('organizational_units')->where('is_active', true)->pluck('id', 'code')->all();
        $out = [];
        $errors = 0;
        foreach ($items as $i) {
            $errs = [];
            $unit = (string) ($i['unit'] ?? '');
            if (! isset($units[$unit])) {
                $errs[] = "kode unit {$unit} tidak dikenal (atau tidak aktif) pada organisasi DISTRIVA.";
            }
            if (! in_array($i['jenis'] ?? null, ['GI', 'GO'], true)) {
                $errs[] = 'jenis harus GI atau GO.';
            }
            $exists = DB::table('warehouses')->where('plant', (string) $i['plant'])->where('stor_loc', (string) $i['stor_loc'])->exists();
            $errors += $errs === [] ? 0 : 1;
            $out[] = ['plant' => (string) $i['plant'], 'stor_loc' => (string) $i['stor_loc'], 'name' => $i['stor_loc_name'], 'unit' => $unit, 'status' => $errs === [] ? ($exists ? 'UPDATE' : 'NEW') : 'REJECTED', 'errors' => $errs];
        }
        if ($errors > 0) {
            throw new AssignmentRuleViolation("Impor dibatalkan seluruhnya: {$errors} gudang bermasalah (mis. ".collect($out)->firstWhere('status', 'REJECTED')['errors'][0].').');
        }
        $summary = ['dry_run' => $dryRun, 'total' => count($out), 'new' => count(array_filter($out, fn ($o) => $o['status'] === 'NEW')), 'updated' => count(array_filter($out, fn ($o) => $o['status'] === 'UPDATE'))];
        if (! $dryRun) {
            DB::transaction(function () use ($items, $units): void {
                foreach ($items as $i) {
                    $key = ['plant' => (string) $i['plant'], 'stor_loc' => (string) $i['stor_loc']];
                    $vals = ['name' => trim((string) $i['stor_loc_name']), 'organizational_unit_id' => $units[(string) $i['unit']], 'kind' => $i['jenis'], 'erp_unit_code' => (string) $i['unit'], 'is_active' => true, 'updated_at' => now()];
                    DB::table('warehouses')->where($key)->exists()
                        ? DB::table('warehouses')->where($key)->update($vals)
                        : DB::table('warehouses')->insert($key + $vals + ['id' => (string) Str::uuid(), 'code' => $key['plant'].'-'.$key['stor_loc'], 'created_at' => now()]);
                }
            });
        }

        return ['summary' => $summary, 'rows' => $out];
    }

    /** @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>} */
    public function import(string $warehouseId, UploadedFile $file, string $asOf, ?string $source, bool $dryRun, User $actor): array
    {
        $wh = DB::table('warehouses')->where('id', $warehouseId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if (! $wh->is_active) {
            throw new AssignmentRuleViolation('Gudang tidak aktif.');
        }
        if (strtolower((string) $file->getClientOriginalExtension()) === 'xlsx') {
            return $this->importErp($wh, $file, $asOf, $source, $dryRun, $actor);
        }
        ['rows' => $rows] = CsvTable::read($file, $this->headers(), ['code', 'on_hand']);
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === [] || count($rows) > $max) {
            throw new AssignmentRuleViolation($rows === [] ? 'Berkas tidak memuat baris data.' : "Berkas melebihi batas {$max} baris.");
        }
        $items = DB::table('khs_items')->whereIn('code', array_column($rows, 'code'))->pluck('id', 'code')->all();
        $counts = array_count_values(array_column($rows, 'code'));
        $out = [];
        $accepted = [];
        foreach ($rows as $r) {
            $errs = [];
            $n = ['on_hand' => $this->num($r['on_hand'] ?? ''), 'reserved' => $this->num($r['reserved'] ?? '0'), 'incoming' => $this->num($r['incoming'] ?? '0'), 'safety' => $this->num($r['safety'] ?? '0')];
            if (! isset($items[$r['code']])) {
                $errs[] = "kode KHS {$r['code']} tidak ada.";
            }
            if (($counts[$r['code']] ?? 0) > 1) {
                $errs[] = 'kode muncul lebih dari sekali.';
            }
            foreach ($n as $k => $v) {
                if ($v === null || $v < 0) {
                    $errs[] = "{$k} harus angka >= 0.";
                }
            }
            $out[] = ['row' => $r['row'], 'khs_code' => $r['code'], 'status' => $errs === [] ? 'OK' : 'REJECTED', 'errors' => $errs];
            if ($errs === []) {
                $accepted[] = ['khs_item_id' => $items[$r['code']], 'on_hand' => $n['on_hand'], 'reserved' => $n['reserved'], 'incoming_confirmed' => $n['incoming'], 'safety_stock' => $n['safety']];
            }
        }
        $rejected = count($rows) - count($accepted);
        if ($rejected > 0) {
            throw new AssignmentRuleViolation("Impor dibatalkan seluruhnya: {$rejected} baris ditolak. Perbaiki berkas lalu ulangi.");
        }
        $summary = ['dry_run' => $dryRun, 'total' => count($rows), 'accepted' => count($accepted), 'snapshot_id' => null];
        if ($dryRun) {
            return ['summary' => $summary, 'rows' => $out];
        }
        $id = (string) Str::uuid();
        try {
            DB::transaction(function () use ($id, $warehouseId, $asOf, $source, $accepted, $actor): void {
                DB::table('stock_snapshots')->insert(['id' => $id, 'warehouse_id' => $warehouseId, 'as_of' => $asOf, 'source_reference' => $source, 'created_by' => $actor->getKey(), 'created_at' => now()]);
                foreach (array_chunk($accepted, 300) as $chunk) {
                    DB::table('stock_snapshot_lines')->insert(array_map(fn ($a) => ['id' => (string) Str::uuid(), 'snapshot_id' => $id] + $a, $chunk));
                }
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation("Gudang ini sudah memiliki cuplikan stok per {$asOf}; stok adalah riwayat, gunakan tanggal lain.", 0, $e) : $e;
        }
        $summary['snapshot_id'] = $id;
        app(WorkflowNotifier::class)->lowStock($warehouseId, $asOf);

        return ['summary' => $summary, 'rows' => $out];
    }

    /**
     * The ERP "Monitoring Stock" workbook (columns No Material, Nama Material, Satuan, Stock Siap, Stock Reservasi, Stock In Transit, Stock Minimum), keyed by SKU. Every SKU row is kept
     * as received; SKUs mapped to a KHS item (khs_material_map) are also summed into the KHS-level lines the planning uses: on hand = Stock Siap + Stock Reservasi (Siap excludes the reserved material), reserved = Stock Reservasi,
     * incoming = Stock In Transit, safety = Stock Minimum. Unmapped SKUs are NOT an error (most of the ERP catalogue is not in the KHS); a malformed row cancels the whole import.
     *
     * @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>}
     */
    private function importErp(object $wh, UploadedFile $file, string $asOf, ?string $source, bool $dryRun, User $actor): array
    {
        $sheet = $this->readSheet($file);
        $header = null;
        $cols = [];
        $rows = [];
        foreach ($sheet as $n => $cells) {
            if ($header === null) {
                $labels = array_map(fn ($c) => mb_strtolower(trim((string) $c)), $cells);
                if (in_array('no material', $labels, true)) {
                    $header = $n;
                    foreach (['material_no' => 'no material', 'name' => 'nama material', 'unit' => 'satuan', 'ready' => 'stock siap', 'reserved' => 'stock reservasi', 'transit' => 'stock in transit', 'minimum' => 'stock minimum', 'warehouse' => 'gudang'] as $k => $label) {
                        $i = array_search($label, $labels, true);
                        $cols[$k] = $i === false ? null : $i;
                    }
                    if ($cols['ready'] === null) {
                        throw new AssignmentRuleViolation('Kolom "Stock Siap" tidak ditemukan pada berkas stok ERP.');
                    }
                }

                continue;
            }
            $sku = trim((string) ($cells[$cols['material_no']] ?? ''));
            if ($sku === '') {
                continue;
            }
            $rows[] = ['row' => $n, 'sku' => $sku, 'name' => trim((string) ($cols['name'] === null ? '' : ($cells[$cols['name']] ?? ''))), 'unit' => trim((string) ($cols['unit'] === null ? '' : ($cells[$cols['unit']] ?? ''))),
                'ready' => $cells[$cols['ready']] ?? null, 'reserved' => $cols['reserved'] === null ? 0 : ($cells[$cols['reserved']] ?? 0), 'transit' => $cols['transit'] === null ? 0 : ($cells[$cols['transit']] ?? 0),
                'minimum' => $cols['minimum'] === null ? 0 : ($cells[$cols['minimum']] ?? 0), 'warehouse' => $cols['warehouse'] === null ? '' : trim((string) ($cells[$cols['warehouse']] ?? ''))];
        }
        if ($header === null) {
            throw new AssignmentRuleViolation('Berkas bukan "Monitoring Stock" ERP: baris judul dengan kolom "No Material" tidak ditemukan.');
        }

        return $this->ingestErpRows($wh, $rows, $asOf, $source, $dryRun, $actor);
    }

    /**
     * The common path of an ERP stock file and of the API pull: $rows = [{row, sku, name, unit, ready, reserved, transit, minimum, warehouse}] (see importErp).
     *
     * @param  list<array<string,mixed>>  $rows
     * @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>}
     */
    public function ingestErpRows(object $wh, array $rows, string $asOf, ?string $source, bool $dryRun, User $actor, string $format = 'ERP_MONITORING_STOCK'): array
    {
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === [] || count($rows) > $max * 10) {
            throw new AssignmentRuleViolation($rows === [] ? 'Berkas tidak memuat baris data.' : 'Berkas melebihi batas baris.');
        }
        $map = DB::table('khs_material_map')->pluck('khs_item_id', 'material_no')->all();
        $seen = [];
        $errors = [];
        $lines = [];
        $raw = [];
        $unmapped = [];
        $labelSet = [];
        foreach ($rows as $r) {
            $key = ltrim($r['sku'], '0');
            $nums = ['ready' => $this->num((string) $r['ready']), 'reserved' => $this->num((string) $r['reserved']), 'transit' => $this->num((string) $r['transit']), 'minimum' => $this->num((string) $r['minimum'])];
            $bad = array_keys(array_filter($nums, fn ($v) => $v === null || $v < 0));
            if ($key === '' || isset($seen[$key]) || $bad !== []) {
                $errors[] = ['row' => $r['row'], 'material_no' => $r['sku'], 'errors' => array_filter([$key === '' ? 'nomor material kosong.' : null, isset($seen[$key]) ? 'nomor material muncul lebih dari sekali.' : null, $bad === [] ? null : implode(', ', $bad).' harus angka >= 0.'])];

                continue;
            }
            $seen[$key] = true;
            $labelSet[$r['warehouse']] = true;
            $khs = $map[$key] ?? null;
            $raw[] = ['material_no' => $key, 'material_name' => mb_substr($r['name'], 0, 255), 'unit' => mb_substr($r['unit'], 0, 20), 'stock_ready' => $nums['ready'], 'stock_reserved' => $nums['reserved'], 'stock_in_transit' => $nums['transit'], 'stock_minimum' => $nums['minimum'], 'khs_item_id' => $khs];
            if ($khs === null) {
                $unmapped[] = ['material_no' => $r['sku'], 'name' => $r['name'], 'unit' => $r['unit']];

                continue;
            }
            $l = &$lines[$khs];
            $l ??= ['khs_item_id' => $khs, 'on_hand' => 0.0, 'reserved' => 0.0, 'incoming_confirmed' => 0.0, 'safety_stock' => 0.0];
            $l['on_hand'] += $nums['ready'] + $nums['reserved'];        // owner 7 Nov 2026: "Stock Siap" is usable stock OUTSIDE the reserved material, so on hand = Siap + Reservasi and available = on hand - reserved = Siap
            $l['reserved'] += $nums['reserved'];
            $l['incoming_confirmed'] += $nums['transit'];
            $l['safety_stock'] += $nums['minimum'];
            unset($l);
        }
        if ($errors !== []) {
            throw new AssignmentRuleViolation('Impor dibatalkan seluruhnya: '.count($errors).' baris bermasalah (mis. baris '.$errors[0]['row'].': '.implode(' ', $errors[0]['errors']).').');
        }
        $label = implode('; ', array_filter(array_keys($labelSet)));
        $summary = ['dry_run' => $dryRun, 'format' => $format, 'total' => count($raw), 'mapped' => count($raw) - count($unmapped), 'unmapped' => count($unmapped), 'khs_lines' => count($lines), 'warehouse_label' => $label, 'snapshot_id' => null];
        if ($dryRun) {
            return ['summary' => $summary, 'rows' => array_slice($unmapped, 0, 50)];
        }
        $id = (string) Str::uuid();
        try {
            DB::transaction(function () use ($id, $wh, $asOf, $source, $label, $raw, $lines, $actor): void {
                DB::table('stock_snapshots')->insert(['id' => $id, 'warehouse_id' => $wh->id, 'as_of' => $asOf, 'source_reference' => $source ?? ($label !== '' ? "ERP Monitoring Stock: {$label}" : 'ERP Monitoring Stock'),
                    'materials_total' => count($raw), 'materials_mapped' => count(array_filter($raw, fn ($r) => $r['khs_item_id'] !== null)), 'created_by' => $actor->getKey(), 'created_at' => now()]);
                foreach (array_chunk($raw, 300) as $chunk) {
                    DB::table('stock_snapshot_materials')->insert(array_map(fn ($r) => ['id' => (string) Str::uuid(), 'snapshot_id' => $id] + $r, $chunk));
                }
                foreach (array_chunk(array_values($lines), 300) as $chunk) {
                    DB::table('stock_snapshot_lines')->insert(array_map(fn ($l) => ['id' => (string) Str::uuid(), 'snapshot_id' => $id] + $l, $chunk));
                }
            });
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation("Gudang ini sudah memiliki cuplikan stok per {$asOf}; stok adalah riwayat, gunakan tanggal lain.", 0, $e) : $e;
        }
        $summary['snapshot_id'] = $id;
        app(WorkflowNotifier::class)->lowStock((string) $wh->id, $asOf);

        return ['summary' => $summary, 'rows' => array_slice($unmapped, 0, 50)];
    }

    /** @return array<int,array<int,mixed>> row number => cells (first worksheet, values as stored) */
    private function readSheet(UploadedFile $file): array
    {
        try {
            $reader = IOFactory::createReader('Xlsx');
            $reader->setReadDataOnly(true);
            $sheet = $reader->load($file->getRealPath())->getSheet(0);
        } catch (\Throwable $e) {
            throw new AssignmentRuleViolation('Berkas Excel tidak dapat dibaca.', 0, $e);
        }
        $out = [];
        foreach ($sheet->toArray(null, false, false, false) as $i => $cells) {
            $out[$i + 1] = $cells;
        }

        return $out;
    }

    /**
     * Stock position per KHS item over the given warehouses on a date: the latest snapshot of each warehouse up to the date, summed.
     *
     * @param  list<string>  $warehouseIds
     * @return array<string,array{on_hand:float,reserved:float,incoming:float,safety:float,allocated_after:float,available:float,kr_supply:float,available_with_kr:float}>
     */
    public function position(array $warehouseIds, string $date): array
    {
        $out = [];
        foreach ($warehouseIds as $wid) {
            $snap = DB::table('stock_snapshots')->where('warehouse_id', $wid)->where('as_of', '<=', $date)->orderByDesc('as_of')->first();
            $after = DB::table('allocation_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->whereNotNull('a.materials_confirmed_at')->where('a.status', '<>', 'CANCELLED')->where('l.warehouse_id', $wid)
                ->when($snap !== null, fn ($q) => $q->whereRaw('(a.materials_confirmed_at at time zone ?)::date > ?', [config('distriva.business_timezone'), $snap->as_of]))
                ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) q')->pluck('q', 'khs_item_id');
            // reservations of connections without extension (docs/95): approved ones not yet in MIMS always count; recorded ones until a newer ERP snapshot carries them
            $srAfter = DB::table('sr_reservation_lines as l')->join('sr_reservations as r', 'r.id', '=', 'l.sr_reservation_id')->where('r.warehouse_id', $wid)
                ->where(fn ($q) => $q->where('r.status', 'APPROVED')->orWhere(fn ($w) => $w->where('r.status', 'RECORDED')
                    ->when($snap !== null, fn ($x) => $x->whereRaw('(r.mims_recorded_at at time zone ?)::date > ?', [config('distriva.business_timezone'), $snap->as_of]))))
                ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) q')->pluck('q', 'khs_item_id');
            foreach ($srAfter as $k => $q) {
                $after[$k] = (float) ($after[$k] ?? 0) + (float) $q;
            }
            // poles plotted from this warehouse (a note on the pole line) after the snapshot also draw its ERP stock down
            $poleAfter = DB::table('allocation_pole_lines as l')->join('allocations as a', 'a.id', '=', 'l.allocation_id')->whereNotNull('a.poles_confirmed_at')->where('a.status', '<>', 'CANCELLED')->where('l.warehouse_id', $wid)->whereNotNull('l.khs_item_id')
                ->when($snap !== null, fn ($q) => $q->whereRaw('(a.poles_confirmed_at at time zone ?)::date > ?', [config('distriva.business_timezone'), $snap->as_of]))
                ->groupBy('l.khs_item_id')->selectRaw('l.khs_item_id, sum(l.quantity) q')->pluck('q', 'khs_item_id');
            foreach ($poleAfter as $k => $q) {
                $after[$k] = (float) ($after[$k] ?? 0) + (float) $q;
            }
            $lines = $snap === null ? collect() : DB::table('stock_snapshot_lines')->where('snapshot_id', $snap->id)->get()->keyBy('khs_item_id');
            foreach ($lines->keys()->merge($after->keys())->unique() as $khs) {
                $l = $lines[$khs] ?? null;
                $o = &$out[$khs];
                $o ??= ['on_hand' => 0.0, 'reserved' => 0.0, 'incoming' => 0.0, 'safety' => 0.0, 'allocated_after' => 0.0, 'available' => 0.0];
                $o['on_hand'] += (float) ($l->on_hand ?? 0);
                $o['reserved'] += (float) ($l->reserved ?? 0);
                $o['incoming'] += (float) ($l->incoming_confirmed ?? 0);
                $o['safety'] += (float) ($l->safety_stock ?? 0);
                $o['allocated_after'] += (float) ($after[$khs] ?? 0);
                $o['available'] = $o['on_hand'] - $o['reserved'] - $o['allocated_after'];
                unset($o);
            }
        }
        // Kontrak Rinci pole lines add supply (warehouse-less) until the ERP stock carries the material; plotting draws it down (docs/62 §49)
        foreach (app(PoleContractService::class)->supplyByItem() as $khs => $q) {
            $o = &$out[$khs];
            $o ??= ['on_hand' => 0.0, 'reserved' => 0.0, 'incoming' => 0.0, 'safety' => 0.0, 'allocated_after' => 0.0, 'available' => 0.0];
            $o['kr_supply'] = (float) $q;
            unset($o);
        }
        foreach ($out as &$o) {
            $o['kr_supply'] ??= 0.0;
            $o['available_with_kr'] = $o['available'] + $o['kr_supply'];
        }
        unset($o);

        return $out;
    }

    private function num(string $s): ?float
    {
        $s = trim($s);
        if ($s === '') {
            return 0.0;
        }
        if (preg_match('/^\d{1,3}(\.\d{3})+(,\d+)?$/', $s) || preg_match('/^\d+,\d+$/', $s)) {
            $s = str_replace(',', '.', str_replace('.', '', $s));
        }

        return preg_match('/^\d+(\.\d+)?$/', $s) ? (float) $s : null;
    }
}
