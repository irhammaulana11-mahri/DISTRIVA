<?php

namespace App\Services\Substations;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Loads the cleaned Maximo WO inspection file (tools/maximo_sync `parse`, tools/maximo_sync/README.md) as readings of EXISTING gardu: one reading per work order with the
 * transformer loading, the lowest base voltage per phase and the peak load of every jurusan. A gardu that is not in the master is reported, never created
 * (the OMT load forms gardu; an inspection only adds readings). Idempotent: a reading is unique per gardu, source and time.
 */
class MaximoWoLoadService
{
    public function __construct(private readonly SubstationService $substations, private readonly FeederService $feeders) {}

    /**
     * @param  bool  $createMissing  form the gardu that are not in the master (from the work order location: code, location code, feeder, ULP of the owner) flagged needs_review
     * @param  string|null  $exportMissing  write the gardu that are not in the master (before forming them) to this CSV
     * @return array{dry_run:bool,counts:array<string,int>,problems:array<string,list<string>>}
     */
    public function load(string $path, User $actor, bool $dryRun = false, bool $createMissing = false, ?string $exportMissing = null): array
    {
        $fh = fopen($path, 'r') ?: throw new \RuntimeException("Berkas tidak dapat dibuka: {$path}");
        $col = array_flip(fgetcsv($fh, 0, ',', '"', '') ?: []);
        foreach (['wonum', 'gardu', 'measured_at'] as $need) {
            if (! isset($col[$need])) {
                throw new \RuntimeException("Kolom wajib tidak ada: {$need} (jalankan `maximo_sync parse` lebih dulu).");
            }
        }
        $gardu = DB::table('substations')->get(['id', 'code', 'capacity_kva'])->keyBy('code')->all();
        $c = ['rows' => 0, 'readings_stored' => 0, 'readings_unchanged' => 0, 'readings_skipped' => 0, 'no_measurement' => 0, 'rejected' => 0, 'unknown_gardu' => 0, 'gardu_created' => 0, 'feeders_created' => 0];
        $problems = $missing = [];
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('id', 'code')->all();
        $feederByName = $feederByCode = [];
        foreach (DB::table('distribution_feeders')->get(['id', 'code', 'name']) as $f) {
            $feederByCode[OmtLoadService::norm($f->code)] = $f;
            $f->name !== null && $feederByName[OmtLoadService::norm($f->name)] = $f;
        }
        DB::beginTransaction();
        try {
            while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
                $d = fn (string $k) => trim((string) ($row[$col[$k] ?? -1] ?? ''));
                $c['rows']++;
                $code = OmtLoadService::code($d('gardu'));
                if (! isset($gardu[$code])) {
                    $info = $this->missingInfo($code, $d, $units, $missing);
                    if ($createMissing && $info['unit_id'] !== null) {
                        $gardu[$code] = $this->createGardu($code, $info, $feederByName, $feederByCode, $actor, $c);
                    } else {
                        $c['unknown_gardu']++;
                        $problems['unknown_gardu'][$code.' (WO '.$d('wonum').')'] = true;

                        continue;
                    }
                }
                if ($d('measured_at') === '') {                          // a work order with no dated field measurement (not inspected yet, or nothing measured): nothing to store
                    $c['no_measurement']++;

                    continue;
                }
                try {
                    $r = $this->substations->storeImportedReading($gardu[$code], $this->reading($d), (string) $actor->getKey());
                } catch (AssignmentRuleViolation $e) {                    // e.g. a time in the future: reported, the rest of the file still loads
                    $c['rejected']++;
                    $problems['rejected'][$code.' (WO '.$d('wonum').'): '.$e->getMessage()] = true;

                    continue;
                }
                $c['readings_'.match ($r['result'] ?? 'skipped') {
                    'stored' => 'stored', 'unchanged' => 'unchanged', default => 'skipped'
                }]++;
            }
            if ($exportMissing !== null) {
                $this->exportMissing($missing, $exportMissing);
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
     * Collects what the work order says about a gardu that is not in the master: `GD01.62555109 GD HL0766 PENYULANG BAGOR` and the owner `51460.INSPEKTOR.10` (ULP code before the dot).
     *
     * @param  callable(string):string  $d
     * @param  array<string,string>  $units  ULP code => id
     * @param  array<string,array<string,mixed>>  $missing
     * @return array<string,mixed>
     */
    private function missingInfo(string $code, callable $d, array $units, array &$missing): array
    {
        $location = $d('location');
        $ulp = explode('.', $d('owner'))[0];
        $measured = $d('measured_at');
        if (! isset($missing[$code])) {
            preg_match('/^(GD\d+\.\d+)\b.*?\bPENYULANG\s+(.+)$/i', $location, $m);
            $missing[$code] = ['code' => $code, 'location_code' => $m[1] ?? '', 'feeder_name' => trim($m[2] ?? ''), 'ulp_code' => $ulp, 'unit_id' => $units[$ulp] ?? null, 'wo_count' => 0, 'first' => '', 'last' => ''];
        }
        $missing[$code]['wo_count']++;
        if ($measured !== '') {
            $missing[$code]['first'] = $missing[$code]['first'] === '' ? $measured : min($missing[$code]['first'], $measured);
            $missing[$code]['last'] = max($missing[$code]['last'], $measured);
        }

        return $missing[$code];
    }

    /**
     * Forms the gardu flagged for review (ownership is not in the work order, so PLN; capacity, coordinates and construction stay empty for the master data to fill).
     *
     * @param  array<string,mixed>  $info
     * @param  array<string,object>  $feederByName
     * @param  array<string,object>  $feederByCode
     * @param  array<string,int>  $c
     */
    private function createGardu(string $code, array $info, array &$feederByName, array &$feederByCode, User $actor, array &$c): object
    {
        $feeder = null;
        $n = OmtLoadService::norm((string) $info['feeder_name']);
        if ($n !== '') {
            $f = $feederByName[$n] ?? $feederByCode[$n] ?? null;
            if ($f === null) {
                $made = $this->feeders->createFromName((string) $info['feeder_name'], (string) $info['unit_id'], (string) $actor->getKey());
                $f = (object) ['id' => $made['id'], 'code' => $made['code'], 'name' => $info['feeder_name']];
                $feederByName[$n] = $feederByCode[OmtLoadService::norm($made['code'])] = $f;
                $c['feeders_created']++;
            }
            $feeder = $f;
        }
        $id = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $id, 'code' => $code, 'location_code' => $info['location_code'] ?: null, 'organizational_unit_id' => $info['unit_id'], 'feeder_code' => $feeder->code ?? null,
            'feeder_id' => $feeder->id ?? null, 'ownership' => 'PLN', 'transformer_count' => 1, 'status' => 'AKTIF', 'needs_review' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('substation_changes')->insert(['id' => (string) Str::uuid(), 'substation_id' => $id, 'changed_by' => (string) $actor->getKey(), 'action' => 'CREATED',
            'reason' => 'Dibentuk dari WO inspeksi Maximo (gardu belum ada di data induk); kapasitas, koordinat, kepemilikan dan alamat perlu dilengkapi.', 'before' => null,
            'after' => json_encode(['code' => $code, 'location_code' => $info['location_code'], 'feeder' => $feeder->code ?? null]), 'created_at' => now()]);
        $c['gardu_created']++;

        return (object) ['id' => $id, 'code' => $code, 'capacity_kva' => null];
    }

    /** @param array<string,array<string,mixed>> $missing */
    private function exportMissing(array $missing, string $path): void
    {
        $fh = fopen($path, 'w') ?: throw new \RuntimeException("Berkas tidak dapat ditulis: {$path}");
        fputcsv($fh, ['kode_gardu', 'kode_lokasi', 'penyulang', 'kode_ulp', 'unit_dikenal', 'jumlah_wo', 'ukur_pertama', 'ukur_terakhir'], ',', '"', '');
        ksort($missing);
        foreach ($missing as $m) {
            fputcsv($fh, [$m['code'], $m['location_code'], $m['feeder_name'], $m['ulp_code'], $m['unit_id'] !== null ? 'ya' : 'tidak', $m['wo_count'], $m['first'], $m['last']], ',', '"', '');
        }
        fclose($fh);
    }

    /** @param callable(string):string $d @return array<string,mixed> */
    private function reading(callable $d): array
    {
        $n = fn (string $k) => is_numeric($d($k)) ? (float) $d($k) : null;
        $feeders = [];
        foreach (str_split('abcdefghijklmnop') as $j) {
            $f = ['label' => strtoupper($j), 'current_r_a' => $n("i{$j}r"), 'current_s_a' => $n("i{$j}s"), 'current_t_a' => $n("i{$j}t"), 'current_n_a' => $n("i{$j}n")];
            if (array_filter([$f['current_r_a'], $f['current_s_a'], $f['current_t_a']], fn ($v) => $v !== null && $v > 0) !== []) {
                $feeders[] = $f;
            }
        }

        return ['measured_at' => $d('measured_at'), 'loading_pct' => $n('pembebanan_trafo_pct'), 'base_voltage_r_v' => $n('vrn'), 'base_voltage_s_v' => $n('vsn'), 'base_voltage_t_v' => $n('vtn'), 'feeders' => $feeders];
    }
}
