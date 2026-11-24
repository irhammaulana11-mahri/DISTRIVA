<?php

namespace App\Console\Commands;

use App\Services\EisReports\EisReportImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Membaca ulang berkas laporan EIS aktif dari arsip aslinya dengan aturan baca terbaru dan memperbarui baris yang berbeda (docs/88). */
class EisReportsReparseCommand extends Command
{
    protected $signature = 'distriva:eis-reparse {family?* : jenis laporan (bawaan semua)} {--dry-run : hanya laporkan, tanpa mengubah data}';

    protected $description = 'Baca ulang berkas laporan EIS yang aktif dari arsip aslinya dan perbarui baris yang berbeda dengan parser terbaru.';

    public function handle(EisReportImportService $import): int
    {
        $families = array_map('strtoupper', (array) $this->argument('family'));
        $files = DB::table('eis_report_files')->where('status', 'AKTIF')->when($families !== [], fn ($q) => $q->whereIn('family', $families))->orderBy('family')->orderBy('period')->get();
        $count = ['SAMA' => 0, 'DIPERBARUI' => 0, 'ARSIP_HILANG' => 0, 'GAGAL' => 0];
        foreach ($files as $f) {
            $r = $import->reparse($f, (bool) $this->option('dry-run'));
            $count[$r['status']]++;
            if ($r['status'] !== 'SAMA') {
                $this->line(sprintf('%s %s %s %s%s', $r['status'], $f->family, $f->unit_code, substr((string) $f->period, 0, 7), isset($r['message']) ? ': '.$r['message'] : ''));
            }
        }
        $this->info(sprintf('%d berkas diperiksa: %d sama, %d %s, %d arsip hilang, %d gagal.', $files->count(), $count['SAMA'], $count['DIPERBARUI'], $this->option('dry-run') ? 'akan diperbarui' : 'diperbarui', $count['ARSIP_HILANG'], $count['GAGAL']));

        return $count['GAGAL'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
