<?php

/**
 * Imports the BOM documents of tools/output/bom_*.json with the NEW KHS codes (docs/62 §52): the KHS code of every line AND the KHS code literal inside a column-B formula
 * IF(<condition>, <code>, "") are translated through tools/output/rebuild/peta_kode_lama_baru.csv. Run through tinker:
 *   REBUILD_DB=<database> BOM_DRY=1|0 php artisan tinker --execute="require '<this file>';"
 * Needs APPROVED KHS and construction types (the owner's approval comes first); imports as DRAFT; the approval of the BOMs is a person's.
 */

use App\Models\User;
use App\Services\Bom\BomService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

$db = (string) getenv('REBUILD_DB');
if ($db === '' || DB::getDatabaseName() !== $db) {
    throw new RuntimeException('Menolak: database terhubung ('.DB::getDatabaseName().') bukan REBUILD_DB ('.$db.').');
}
$dry = getenv('BOM_DRY') !== '0';
$only = getenv('BOM_ONLY') ? explode(',', (string) getenv('BOM_ONLY')) : null;
$map = [];
$h = fopen('/media/data/PROJECT/DISTRIVA/tools/output/rebuild/peta_kode_lama_baru.csv', 'r');
fgetcsv($h, 0, ',', '"', '\\');
while (($r = fgetcsv($h, 0, ',', '"', '\\')) !== false) {
    $map[$r[0]] = $r[1];
}
fclose($h);
$admin = User::where('email', 'admin@distriva.com')->firstOrFail();
Auth::login($admin);
foreach (glob('/media/data/PROJECT/DISTRIVA/tools/output/bom_*.json') as $f) {
    $doc = json_decode((string) file_get_contents($f), true, 512, JSON_THROW_ON_ERROR);
    if ($only !== null && ! in_array($doc['group'], $only, true)) {
        continue;
    }
    foreach ($doc['lines'] as &$l) {
        if (($l['khs_code'] ?? null) !== null) {
            $c = (string) $l['khs_code'];
            $l['khs_code'] = $map[$c] ?? $c;
        }
        if (isset($l['B']) && is_string($l['B'])) {
            // every KHS code literal of a nested IF(<condition>, <code>, IF(...)) / IF(<condition>, <code>, "") (the same shape the extractor reads: ,<digits>,IF( or ,<digits>,"")
            $l['B'] = preg_replace_callback('/,\s*(\d+)\s*,(?=\s*(?:IF\(|""))/', fn ($m) => ',"'.($map[$m[1]] ?? $m[1]).'",', $l['B']);
        }
    }
    unset($l);
    try {
        $r = app(BomService::class)->import($doc, '2026-11-01', 'tools/output/'.basename($f).' (kode baru)', $dry, $admin);
        echo ($dry ? 'DRY ' : 'REAL '), str_pad($doc['group'], 12), ' baris ', $r['summary']['accepted_lines'], '/', $r['summary']['total_lines'], ' masalah ', count($r['problems']), PHP_EOL;
        foreach (array_slice($r['problems'], 0, 4) as $p) {
            echo '    ', json_encode($p, JSON_UNESCAPED_UNICODE), PHP_EOL;
        }
    } catch (Throwable $e) {
        echo $doc['group'], ' ERR ', $e->getMessage(), PHP_EOL;
    }
}
