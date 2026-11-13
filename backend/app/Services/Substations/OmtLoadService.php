<?php

namespace App\Services\Substations;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Loads the cleaned OMT measurement file (tools/omt_sync `fix`, docs/83) into the masters: gardu that are not in the master yet (code, ULP, coordinates, capacity, construction, feeder), feeders formed from the
 * "Nama Penyulang", and one reading per measurement (time, capacity at that time, load, base voltages, currents of the gardu and of every jurusan).
 * The Maximo master wins: an existing gardu is never overwritten, only an empty capacity, coordinate or feeder is filled. Everything is idempotent (a reading is unique per gardu, source and time).
 */
class OmtLoadService
{
    /** OMT ULP name (normalised) => our ULP name (normalised): OMT says MOJOKERTO KOTA, the organisation has ULP Mojokerto (51452). */
    private const ULP_ALIASES = ['MOJOKERTOKOTA' => 'MOJOKERTO'];

    public function __construct(private readonly SubstationService $substations, private readonly FeederService $feeders) {}

    /** HD762 -> HD0762 (two letters and 1-3 digits); any other form is kept. */
    public static function code(string $asset): string
    {
        $a = mb_strtoupper(trim($asset));

        return preg_match('/^([A-Z]{2})(\d{1,3})$/', $a, $m) ? $m[1].str_pad($m[2], 4, '0', STR_PAD_LEFT) : $a;
    }

    public static function norm(string $v): string
    {
        return preg_replace('/[^A-Z0-9]/', '', mb_strtoupper($v)) ?? '';
    }

    /** Indonesian bounds; 0/0 and swapped values are not coordinates. */
    public static function coordinate(?string $lat, ?string $lon): ?array
    {
        if (! is_numeric($lat) || ! is_numeric($lon)) {
            return null;
        }
        [$la, $lo] = [(float) $lat, (float) $lon];

        return $la >= -11.5 && $la <= 6.5 && $lo >= 94.5 && $lo <= 141.5 ? [round($la, 7), round($lo, 7)] : null;
    }

    /** @return array<string,mixed> counts and problems */
    public function load(string $path, User $actor, bool $dryRun = false): array
    {
        $fh = fopen($path, 'r') ?: throw new \RuntimeException("Berkas tidak dapat dibuka: {$path}");
        $header = fgetcsv($fh, 0, ',', '"', '');
        $col = array_flip($header ?: []);
        foreach (['Nama ULP', 'Nama Aset', 'Waktu Pengukuran', 'Kapasitas Aset'] as $need) {
            if (! isset($col[$need])) {
                throw new \RuntimeException("Kolom wajib tidak ada: {$need} (jalankan `omt_sync fix` lebih dulu).");
            }
        }
        $units = [];
        foreach (DB::table('organizational_units')->where('unit_type', 'ULP')->get(['id', 'name']) as $u) {
            $units[self::norm(preg_replace('/^ULP\s+/i', '', $u->name) ?? $u->name)] = $u->id;
        }
        foreach (self::ULP_ALIASES as $omt => $ours) {          // OMT's ULP name differs from the organisation's
            isset($units[$ours]) && $units[$omt] = $units[$ours];
        }
        $feederByName = $feederByCode = [];
        foreach (DB::table('distribution_feeders')->get(['id', 'code', 'name']) as $f) {
            $feederByCode[self::norm($f->code)] = $f;
            $f->name !== null && $feederByName[self::norm($f->name)] = $f;
        }
        $gardu = DB::table('substations')->get(['id', 'code', 'organizational_unit_id', 'capacity_kva', 'latitude', 'longitude', 'feeder_id', 'feeder_code'])->keyBy('code')->all();
        $c = ['rows' => 0, 'gardu_created' => 0, 'gardu_filled' => 0, 'gardu_matched' => 0, 'feeders_created' => 0, 'readings_stored' => 0, 'readings_unchanged' => 0, 'readings_skipped' => 0, 'unknown_ulp' => 0, 'unit_mismatch' => 0];
        $problems = [];
        $seen = [];
        $actorId = (string) $actor->getKey();
        DB::beginTransaction();
        try {
            while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
                $d = fn (string $k) => trim((string) ($row[$col[$k] ?? -1] ?? ''));
                $c['rows']++;
                $unitId = $units[self::norm($d('Nama ULP'))] ?? null;
                if ($unitId === null) {
                    $c['unknown_ulp']++;
                    $problems['unknown_ulp'][$d('Nama ULP')] = true;

                    continue;
                }
                $code = self::code($d('Nama Aset'));
                $cap = is_numeric($d('Kapasitas Aset')) && (float) $d('Kapasitas Aset') > 0 ? (float) $d('Kapasitas Aset') : null;
                $coord = self::coordinate($d('Latitude Aset'), $d('Longitude Aset'));
                $feeder = $this->feeder($d('Nama Penyulang'), $unitId, $feederByName, $feederByCode, $actorId, $c);
                $s = $gardu[$code] ?? null;
                if ($s === null) {
                    $id = (string) Str::uuid();
                    DB::table('substations')->insert(['id' => $id, 'code' => $code, 'organizational_unit_id' => $unitId, 'feeder_code' => $feeder['code'] ?? null, 'feeder_id' => $feeder['id'] ?? null, 'type_code' => $d('Konstruksi Aset') === '' ? null : mb_substr(mb_strtoupper($d('Konstruksi Aset')), 0, 20),
                        'ownership' => 'PLN', 'latitude' => $coord[0] ?? null, 'longitude' => $coord[1] ?? null, 'capacity_kva' => $cap, 'transformer_count' => 1, 'status' => 'AKTIF', 'needs_review' => false, 'created_at' => now(), 'updated_at' => now()]);
                    DB::table('substation_changes')->insert(['id' => (string) Str::uuid(), 'substation_id' => $id, 'changed_by' => $actorId, 'action' => 'CREATED', 'reason' => 'Dibentuk dari data pengukuran gardu OMT (docs/83); lengkapi nama dan alamat dari data induk Maximo.',
                        'before' => null, 'after' => json_encode(['code' => $code, 'capacity_kva' => $cap, 'feeder' => $feeder['code'] ?? null]), 'created_at' => now()]);
                    $s = $gardu[$code] = (object) ['id' => $id, 'code' => $code, 'organizational_unit_id' => $unitId, 'capacity_kva' => $cap, 'latitude' => $coord[0] ?? null, 'longitude' => $coord[1] ?? null, 'feeder_id' => $feeder['id'] ?? null, 'feeder_code' => $feeder['code'] ?? null];
                    $c['gardu_created']++;
                } else {
                    if ($s->organizational_unit_id !== $unitId) {
                        $c['unit_mismatch']++;
                        $problems['unit_mismatch'][$code] = true;
                    }
                    $fill = [];
                    $s->capacity_kva === null && $cap !== null && $fill['capacity_kva'] = $cap;
                    ($s->latitude === null || $s->longitude === null) && $coord !== null && $fill += ['latitude' => $coord[0], 'longitude' => $coord[1]];
                    $s->feeder_id === null && $feeder !== null && $fill += ['feeder_id' => $feeder['id'], 'feeder_code' => $feeder['code']];
                    if ($fill !== []) {
                        DB::table('substations')->where('id', $s->id)->update($fill + ['updated_at' => now()]);
                        DB::table('substation_changes')->insert(['id' => (string) Str::uuid(), 'substation_id' => $s->id, 'changed_by' => $actorId, 'action' => 'UPDATED', 'reason' => 'Isian kosong dilengkapi dari data pengukuran gardu OMT (docs/83).',
                            'before' => null, 'after' => json_encode($fill), 'created_at' => now()]);
                        foreach ($fill as $k => $v) {
                            $s->{$k} = $v;
                        }
                        $c['gardu_filled']++;
                    }
                    if (! isset($seen[$code])) {          // existing gardu are counted once, not once per reading
                        $seen[$code] = true;
                        $c['gardu_matched']++;
                    }
                }
                $r = $this->substations->storeImportedReading($s, $this->reading($d, $cap), $actorId);
                $c['readings_'.match ($r['result'] ?? 'skipped') {
                    'stored' => 'stored', 'unchanged' => 'unchanged', default => 'skipped'
                }]++;
            }
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        } finally {
            fclose($fh);
        }

        return ['dry_run' => $dryRun, 'counts' => $c, 'problems' => array_map(fn ($p) => array_slice(array_keys($p), 0, 20), $problems)];
    }

    /** @param array<string,object> $byName @param array<string,object> $byCode @return array{id:string,code:string}|null */
    private function feeder(string $name, string $unitId, array &$byName, array &$byCode, string $actorId, array &$c): ?array
    {
        $n = self::norm($name);
        if ($n === '') {
            return null;
        }
        $f = $byName[$n] ?? $byCode[$n] ?? null;
        if ($f === null) {
            $made = $this->feeders->createFromName($name, $unitId, $actorId);
            $f = (object) ['id' => $made['id'], 'code' => $made['code'], 'name' => $name];
            $byName[$n] = $byCode[self::norm($made['code'])] = $f;
            $c['feeders_created']++;
        }

        return ['id' => $f->id, 'code' => $f->code];
    }

    /** @param callable(string):string $d @return array<string,mixed> */
    private function reading(callable $d, ?float $capacity): array
    {
        $n = fn (string $k) => is_numeric($d($k)) ? (float) $d($k) : null;
        $feeders = [];
        foreach (str_split('abcdefghijklmnop') as $j) {
            $f = ['label' => strtoupper($j), 'current_r_a' => $n("i{$j}r"), 'current_s_a' => $n("i{$j}s"), 'current_t_a' => $n("i{$j}t"), 'current_n_a' => $n("i{$j}n")];
            if (array_filter([$f['current_r_a'], $f['current_s_a'], $f['current_t_a']], fn ($v) => $v !== null && $v > 0) !== []) {
                $feeders[] = $f;
            }
        }

        return ['measured_at' => $d('Waktu Pengukuran'), 'capacity_kva' => $capacity, 'load_kva' => $n('Beban Trafo'), 'current_r_a' => $n('iur'), 'current_s_a' => $n('ius'), 'current_t_a' => $n('iut'), 'current_n_a' => $n('iun'),
            'base_voltage_r_v' => $n('vrn'), 'base_voltage_s_v' => $n('vsn'), 'base_voltage_t_v' => $n('vtn'), 'feeders' => $feeders];
    }
}
