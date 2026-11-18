<?php

namespace App\Console\Commands;

use App\Services\Bom\BomService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Stores the drawing-sheet layout (quantity cells, fixed list values) for BOM versions imported before it was kept, from the extractor's bom_<GROUP>.json files (tools/extract_bom_json.py).
 * Only versions without a map are filled, and only when the file's formulas are the version's (same line count); nothing else is touched.
 */
class BomBackfillInputMaps extends Command
{
    protected $signature = 'bom:backfill-input-maps {dir=tools/output : folder with bom_<GROUP>.json} {--dry-run : only report}';

    protected $description = 'Isi peta sel gambar untuk versi BOM lama dari berkas ekstraksi.';

    public function handle(BomService $bom): int
    {
        $dir = str_starts_with((string) $this->argument('dir'), '/') ? (string) $this->argument('dir') : base_path('../'.$this->argument('dir'));
        $docs = [];
        foreach (glob($dir.'/bom_*.json') ?: [] as $f) {
            $d = json_decode((string) file_get_contents($f), true);
            if (is_array($d) && isset($d['group'])) {
                $docs[(string) $d['group']] = $d;
            }
        }
        $filled = 0;
        foreach (DB::table('bom_headers')->whereNotExists(fn ($q) => $q->selectRaw('1')->from('bom_input_maps as m')->whereColumn('m.bom_header_id', 'bom_headers.id'))->orderBy('group_code')->orderBy('version_number')->get(['id', 'group_code', 'version_number']) as $h) {
            $doc = $docs[$h->group_code] ?? null;
            $lines = DB::table('bom_lines')->where('bom_header_id', $h->id)->count();
            if ($doc === null || count($doc['lines'] ?? []) !== $lines) {
                $this->warn("{$h->group_code} v{$h->version_number}: dilewati (".($doc === null ? 'berkas tidak ada' : 'jumlah baris berbeda: berkas '.count($doc['lines']).' vs database '.$lines).').');

                continue;
            }
            if (! $this->option('dry-run')) {
                $bom->saveInputMap($h->id, (string) $h->group_code, $doc);
            }
            $filled++;
            $this->info("{$h->group_code} v{$h->version_number}: ".count($doc['inputs'] ?? []).' sel masukan'.($this->option('dry-run') ? ' (percobaan)' : ' disimpan').'.');
        }
        $this->line("Selesai: {$filled} versi.");

        return self::SUCCESS;
    }
}
