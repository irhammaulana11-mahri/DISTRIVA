<?php

namespace App\Console\Commands;

use App\Services\Nko\NkoMappingCheckService;
use Illuminate\Console\Command;

/** Periksa pemetaan definisi NKO terhadap aturan realisasi (docs/93): php artisan distriva:nko-mapping <tahun>. */
class NkoMappingCommand extends Command
{
    protected $signature = 'distriva:nko-mapping {year : tahun definisi NKO}';

    protected $description = 'Tampilkan item NKO yang bertambah, hilang, belum punya aturan realisasi, dan aturan yang kehilangan itemnya';

    public function handle(NkoMappingCheckService $service): int
    {
        $r = $service->check((int) $this->argument('year'));
        if ($r['changes'] === []) {
            $this->warn("Belum ada definisi NKO aktif tahun {$r['year']}.");

            return self::SUCCESS;
        }
        foreach ($r['changes'] as $level => $change) {
            if ($change['compared_with'] === null) {
                continue;
            }
            $this->info("{$level}: dibanding {$change['compared_with']}, ".count($change['added']).' item bertambah, '.count($change['removed']).' item hilang.');
            foreach (['added' => '+', 'removed' => '-'] as $key => $sign) {
                foreach ($change[$key] as $item) {
                    $this->line("  {$sign} {$item['name']} [{$item['code']}]");
                }
            }
        }
        if ($r['orphaned'] !== []) {
            $this->warn('Aturan realisasi yang itemnya tidak ada lagi (dihapus atau berganti nama):');
            foreach ($r['orphaned'] as $o) {
                $this->line('  ! '.($o['name'] ?? '(belum pernah ada di definisi)')." [{$o['code']}] rumus: {$o['formula']}");
                $o['manual_inputs'] > 0 && $this->line("      {$o['manual_inputs']} masukan manual tahun ini masih memakai kode lama");
                $o['linked_menus'] !== [] && $this->line('      target menu pengusahaan masih menunjuk kode ini: '.implode(', ', $o['linked_menus']));
                foreach ($o['suggestions'] as $s) {
                    $this->line("      mungkin menjadi: {$s['name']} [{$s['code']}] (kemiripan {$s['score']})");
                }
            }
        }
        if ($r['unmapped'] !== []) {
            $this->line('Item tanpa aturan realisasi (diisi manual): '.count($r['unmapped']));
            foreach ($r['unmapped'] as $u) {
                $this->line("  ? {$u['name']} [{$u['code']}] ".implode(', ', $u['levels']));
            }
        }
        if ($r['orphaned'] === [] && $r['unmapped'] === []) {
            $this->info('Semua item yang butuh realisasi sudah punya aturan.');
        }

        return self::SUCCESS;
    }
}
