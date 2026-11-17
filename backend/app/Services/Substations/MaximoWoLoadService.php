<?php

namespace App\Services\Substations;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Loads the cleaned Maximo WO inspection file (tools/maximo_sync `parse`, tools/maximo_sync/README.md) as readings of EXISTING gardu: one reading per work order with the
 * transformer loading, the lowest base voltage per phase and the peak load of every jurusan. A gardu that is not in the master is reported, never created
 * (the OMT load forms gardu; an inspection only adds readings). Idempotent: a reading is unique per gardu, source and time.
 */
class MaximoWoLoadService
{
    public function __construct(private readonly SubstationService $substations) {}

    /** @return array{dry_run:bool,counts:array<string,int>,problems:array<string,list<string>>} */
    public function load(string $path, User $actor, bool $dryRun = false): array
    {
        $fh = fopen($path, 'r') ?: throw new \RuntimeException("Berkas tidak dapat dibuka: {$path}");
        $col = array_flip(fgetcsv($fh, 0, ',', '"', '') ?: []);
        foreach (['wonum', 'gardu', 'measured_at'] as $need) {
            if (! isset($col[$need])) {
                throw new \RuntimeException("Kolom wajib tidak ada: {$need} (jalankan `maximo_sync parse` lebih dulu).");
            }
        }
        $gardu = DB::table('substations')->get(['id', 'code', 'capacity_kva'])->keyBy('code')->all();
        $c = ['rows' => 0, 'readings_stored' => 0, 'readings_unchanged' => 0, 'readings_skipped' => 0, 'no_measurement' => 0, 'rejected' => 0, 'unknown_gardu' => 0];
        $problems = [];
        DB::beginTransaction();
        try {
            while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
                $d = fn (string $k) => trim((string) ($row[$col[$k] ?? -1] ?? ''));
                $c['rows']++;
                $code = OmtLoadService::code($d('gardu'));
                if (! isset($gardu[$code])) {
                    $c['unknown_gardu']++;
                    $problems['unknown_gardu'][$code.' (WO '.$d('wonum').')'] = true;

                    continue;
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
            $dryRun ? DB::rollBack() : DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        } finally {
            fclose($fh);
        }

        return ['dry_run' => $dryRun, 'counts' => $c, 'problems' => array_map(fn ($p) => array_slice(array_keys($p), 0, 20), $problems)];
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
