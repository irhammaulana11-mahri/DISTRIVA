<?php

namespace App\Services\Substations;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Moves gardu to another EXISTING feeder from a reviewed list (ulp_code, kode_gardu, kode_penyulang_tujuan), e.g. the proposals that tools/dil_sync derives from the DIL. A gardu is only moved when
 * its ULP and code are found, the target feeder exists and is active (never created here) and differs from the current one; every move goes through SubstationService::update, so it is written to the
 * append-only gardu history with the reason. Idempotent.
 */
class FeederReassignService
{
    public function __construct(private readonly SubstationService $substations) {}

    /** @return array{dry_run:bool,counts:array<string,int>,problems:list<string>} */
    public function apply(string $file, User $actor, string $reason, bool $dryRun = false): array
    {
        $fh = fopen($file, 'r');
        if ($fh === false) {
            throw new \InvalidArgumentException('Berkas tidak dapat dibuka.');
        }
        $head = fgetcsv($fh, null, ',', '"', '');
        $ix = array_flip(is_array($head) ? $head : []);
        foreach (['ulp', 'kode_gardu', 'kode_penyulang_tujuan'] as $need) {
            if (! isset($ix[$need])) {
                throw new \InvalidArgumentException("Kolom {$need} tidak ada pada berkas.");
            }
        }
        $units = DB::table('organizational_units')->pluck('id', 'code');
        $feeders = DB::table('distribution_feeders')->where('status', 'AKTIF')->pluck('id', 'code');
        $scope = ['unrestricted' => true, 'units' => []];
        $counts = ['rows' => 0, 'moved' => 0, 'unchanged' => 0, 'gardu_not_found' => 0, 'feeder_missing' => 0];
        $problems = [];
        while (($r = fgetcsv($fh, null, ',', '"', '')) !== false) {
            $counts['rows']++;
            [$ulp, $code, $target] = [trim((string) $r[$ix['ulp']]), trim((string) $r[$ix['kode_gardu']]), trim((string) $r[$ix['kode_penyulang_tujuan']])];
            $s = isset($units[$ulp]) ? DB::table('substations')->where('organizational_unit_id', $units[$ulp])->where('code', $code)->first(['id', 'feeder_id', 'feeder_code']) : null;
            if ($s === null) {
                $counts['gardu_not_found']++;
                $problems[] = "gardu {$ulp} {$code} tidak ditemukan";

                continue;
            }
            if (! isset($feeders[$target])) {
                $counts['feeder_missing']++;
                $problems[] = "penyulang tujuan {$target} untuk {$code} tidak ada atau tidak aktif";

                continue;
            }
            if ($s->feeder_id === $feeders[$target]) {
                $counts['unchanged']++;

                continue;
            }
            $counts['moved']++;
            $dryRun || $this->substations->update($s->id, ['feeder_code' => $target, 'reason' => $reason], $scope, $actor);
        }
        fclose($fh);

        return ['dry_run' => $dryRun, 'counts' => $counts, 'problems' => $problems];
    }
}
