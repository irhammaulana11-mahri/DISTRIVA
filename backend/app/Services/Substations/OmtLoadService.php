<?php

namespace App\Services\Substations;

use App\Models\User;
use Carbon\CarbonImmutable;
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

    /** Old OMT spellings of feeders that were corrected to the official name (docs/83 section 6) => the official name (normalised): older files must not form a second feeder. */
    private const FEEDER_ALIASES = ['ELKISI' => 'ELKISHI', 'SONOPATIK' => 'SENOPATIK', 'SIKEPU' => 'SIKEPUH', 'MOJOKRAPAK' => 'MOJOKRAPYAK', 'MITRASARUTA' => 'MITRASAROTA', 'CATAKGAYAM' => 'GAYAM', 'BENTENG' => 'BENTENGPANCASILA'];

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
                $s = $gardu[$code] ?? null;
                $feeder = $s === null || $s->feeder_id === null ? $this->feeder($d('Nama Penyulang'), $unitId, $feederByName, $feederByCode, $actorId, $c) : null;   // a feeder is only resolved (or formed) when the gardu needs one
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

    /**
     * One-off correction (owner approved 2026-11-17): OMT 2023-2 rows that held the old 60-column layout inside 108 columns were loaded with the voltages in jurusan F/G and no base voltage.
     * Readings are append-only, so the two history triggers are lifted INSIDE one transaction and put back before it ends. Only IMPORT readings with that fingerprint (no base voltage, a jurusan F/G carrying
     * voltage-like values) are touched; their gardu currents, base voltages and jurusan are replaced from the cleaned CSV. Load (kVA) and loading % came from "Beban Trafo", so they stay.
     *
     * @return array<string,int>
     */
    public function repairShifted(string $path, bool $dryRun = false): array
    {
        $fh = fopen($path, 'r') ?: throw new \RuntimeException("Berkas tidak dapat dibuka: {$path}");
        $col = array_flip(fgetcsv($fh, 0, ',', '"', '') ?: []);
        $tz = (string) config('distriva.business_timezone');
        $utc = fn (string $t): string => CarbonImmutable::parse($t, $tz)->utc()->format('Y-m-d H:i:s');
        $suspect = [];
        foreach (DB::select("select distinct r.id, r.substation_id, r.measured_at from substation_readings r join substation_reading_feeders f on f.reading_id = r.id
            where r.source = 'IMPORT' and r.base_voltage_r_v is null and r.measured_at is not null and f.label in ('F', 'G') and f.current_r_a between 150 and 450 and f.current_n_a between 150 and 300") as $r) {
            $suspect[$r->substation_id.'|'.CarbonImmutable::parse($r->measured_at)->utc()->format('Y-m-d H:i:s')] = $r->id;
        }
        $gardu = DB::table('substations')->pluck('id', 'code')->all();
        $c = ['suspect' => count($suspect), 'repaired' => 0, 'not_in_file' => 0];
        $pos = fn (?float $v): ?float => $v !== null && $v > 0 ? $v : null;
        DB::beginTransaction();
        try {
            foreach (['substation_readings' => 'trg_substation_readings_append_only', 'substation_reading_feeders' => 'trg_substation_reading_feeders_append_only'] as $table => $trigger) {
                DB::statement("ALTER TABLE {$table} DISABLE TRIGGER {$trigger}");
            }
            while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
                $d = fn (string $k) => trim((string) ($row[$col[$k] ?? -1] ?? ''));
                $substationId = $gardu[self::code($d('Nama Aset'))] ?? null;
                $id = $substationId === null || $d('Waktu Pengukuran') === '' ? null : ($suspect[$substationId.'|'.$utc($d('Waktu Pengukuran'))] ?? null);
                if ($id === null) {
                    continue;
                }
                unset($suspect[$substationId.'|'.$utc($d('Waktu Pengukuran'))]);
                $new = $this->reading($d, null);
                $n = fn (string $k): ?float => $pos(is_numeric($d($k)) ? (float) $d($k) : null);
                $ph = ['r' => $n('iur'), 's' => $n('ius'), 't' => $n('iut')];
                if (array_filter($ph, fn ($v) => $v !== null) === []) {                  // no gardu-level currents: the sum of the jurusan, as a new reading would do
                    foreach (['r', 's', 't'] as $k) {
                        $sum = array_sum(array_map(fn ($f) => (float) ($f["current_{$k}_a"] ?? 0), $new['feeders']));
                        $ph[$k] = $sum > 0 ? round($sum, 2) : null;
                    }
                }
                $volt = fn (string $k): ?float => ($v = $n($k)) !== null && $v < 1000 ? $v : null;                    // the same bound as a normal load: 2230 V is a typo, not a voltage
                DB::table('substation_readings')->where('id', $id)->update(['current_r_a' => $ph['r'], 'current_s_a' => $ph['s'], 'current_t_a' => $ph['t'], 'current_n_a' => $n('iun'),
                    'base_voltage_r_v' => $volt('vrn'), 'base_voltage_s_v' => $volt('vsn'), 'base_voltage_t_v' => $volt('vtn')]);
                DB::table('substation_reading_feeders')->where('reading_id', $id)->delete();
                foreach ($new['feeders'] as $f) {
                    DB::table('substation_reading_feeders')->insert(['id' => (string) Str::uuid(), 'reading_id' => $id, 'label' => $f['label'], 'current_r_a' => $pos($f['current_r_a']), 'current_s_a' => $pos($f['current_s_a']),
                        'current_t_a' => $pos($f['current_t_a']), 'current_n_a' => $pos($f['current_n_a']), 'end_voltage_v' => null]);
                }
                $c['repaired']++;
            }
            $c['not_in_file'] = count($suspect);
            foreach (['substation_readings' => 'trg_substation_readings_append_only', 'substation_reading_feeders' => 'trg_substation_reading_feeders_append_only'] as $table => $trigger) {
                DB::statement("ALTER TABLE {$table} ENABLE TRIGGER {$trigger}");
            }
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        } finally {
            fclose($fh);
        }

        return $c;
    }

    /** @param array<string,object> $byName @param array<string,object> $byCode @return array{id:string,code:string}|null */
    private function feeder(string $name, string $unitId, array &$byName, array &$byCode, string $actorId, array &$c): ?array
    {
        $n = self::norm($name);
        if ($n === '') {
            return null;
        }
        $n = self::FEEDER_ALIASES[$n] ?? $n;
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
