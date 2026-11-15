<?php

namespace App\Services\Substations;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fills the GADIS number (GD514…) of gardu from the pairs read out of the DIL (tools/dil_sync gadis_pairs.py: ulp_code, code, gadis_number).
 * Only an EMPTY gadis_number is filled and only in the ULP of the pair; a number that is already there is never overwritten (a different one is reported), and every change is written to the
 * append-only gardu history. Idempotent.
 */
class GadisLoadService
{
    /** @return array{dry_run:bool,counts:array<string,int>,conflicts:list<string>,not_found:list<string>} */
    public function load(string $file, User $actor, bool $dryRun = false): array
    {
        $fh = fopen($file, 'r');
        if ($fh === false) {
            throw new \InvalidArgumentException('Berkas tidak dapat dibuka.');
        }
        $head = fgetcsv($fh);
        $ix = array_flip(is_array($head) ? $head : []);
        foreach (['ulp_code', 'code', 'gadis_number'] as $need) {
            if (! isset($ix[$need])) {
                throw new \InvalidArgumentException("Kolom {$need} tidak ada pada berkas.");
            }
        }
        $units = DB::table('organizational_units')->pluck('id', 'code');
        $taken = DB::table('substations')->whereNotNull('gadis_number')->pluck('code', 'gadis_number')->all();
        $counts = ['rows' => 0, 'filled' => 0, 'unchanged' => 0, 'conflicts' => 0, 'not_found' => 0, 'invalid' => 0, 'number_in_use' => 0];
        $conflicts = $notFound = [];
        while (($r = fgetcsv($fh)) !== false) {
            $counts['rows']++;
            [$ulp, $code, $no] = [trim((string) ($r[$ix['ulp_code']] ?? '')), trim((string) ($r[$ix['code']] ?? '')), trim((string) ($r[$ix['gadis_number']] ?? ''))];
            if (! preg_match('/^GD514\d{6}$/', $no) || ! isset($units[$ulp])) {
                $counts['invalid']++;

                continue;
            }
            $s = DB::table('substations')->where('organizational_unit_id', $units[$ulp])->where('code', $code)->first(['id', 'gadis_number']);
            if ($s === null) {
                $counts['not_found']++;
                $notFound[] = "{$ulp} {$code}";

                continue;
            }
            if ($s->gadis_number === $no) {
                $counts['unchanged']++;

                continue;
            }
            if ($s->gadis_number !== null && $s->gadis_number !== '') {
                $counts['conflicts']++;
                $conflicts[] = "{$ulp} {$code}: DISTRIVA {$s->gadis_number}, DIL {$no}";

                continue;
            }
            if (isset($taken[$no])) {
                $counts['number_in_use']++;
                $conflicts[] = "{$ulp} {$code}: nomor {$no} sudah dipakai gardu {$taken[$no]}";

                continue;
            }
            $counts['filled']++;
            $taken[$no] = $code;
            if ($dryRun) {
                continue;
            }
            DB::transaction(function () use ($s, $no, $actor): void {
                DB::table('substations')->where('id', $s->id)->update(['gadis_number' => $no, 'updated_at' => now()]);
                DB::table('substation_changes')->insert(['id' => (string) Str::uuid(), 'substation_id' => $s->id, 'changed_by' => $actor->getKey(), 'action' => 'UPDATED',
                    'reason' => 'Nomor GADIS diisi dari DIL (kode gardu pada nama gardu DIL cocok).', 'before' => json_encode(['gadis_number' => null]), 'after' => json_encode(['gadis_number' => $no]), 'created_at' => now()]);
            });
        }
        fclose($fh);

        return ['dry_run' => $dryRun, 'counts' => $counts, 'conflicts' => $conflicts, 'not_found' => $notFound];
    }
}
