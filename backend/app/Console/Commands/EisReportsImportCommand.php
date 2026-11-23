<?php

namespace App\Console\Commands;

use App\Services\EisReports\EisReportException;
use App\Services\EisReports\EisReportImportService;
use Illuminate\Console\Command;

/** Impor massal laporan EIS dari satu berkas atau satu folder (docs/88): php artisan distriva:eis-import <path>. */
class EisReportsImportCommand extends Command
{
    protected $signature = 'distriva:eis-import {path : berkas atau folder (rekursif) laporan EIS}';

    protected $description = 'Impor laporan bulanan EIS/AP2T (309, DIFI, gangguan, keluhan, piutang, tagihan susulan, ...) secara idempoten';

    public function handle(EisReportImportService $service): int
    {
        $path = (string) $this->argument('path');
        $files = is_dir($path)
            ? array_values(array_filter(iterator_to_array(new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS)), false), fn ($f) => $f->isFile() && preg_match('/\.xlsx?$/i', $f->getFilename())))
            : [new \SplFileInfo($path)];
        $files = array_map(fn ($f) => $f->getPathname(), $files);
        sort($files);
        $count = [];
        foreach ($files as $f) {
            try {
                $r = $service->import($f, basename($f));
                $count[$r['status']] = ($count[$r['status']] ?? 0) + 1;
                foreach ($r['warnings'] as $w) {
                    $this->warn(basename($f).': '.$w);
                }
            } catch (EisReportException $e) {
                $count['GAGAL'] = ($count['GAGAL'] ?? 0) + 1;
                $this->error(basename($f).': '.$e->getMessage());
            }
        }
        $this->info(count($files).' berkas: '.($count === [] ? '-' : implode(', ', array_map(fn ($k, $v) => "{$v} {$k}", array_keys($count), $count))));

        return isset($count['GAGAL']) ? self::FAILURE : self::SUCCESS;
    }
}
