<?php

namespace App\Console\Commands;

use App\Services\Forecast\ForecastService;
use App\Services\Output\PdfRenderer;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Throwable;

/**
 * Deployment readiness check: everything the server needs besides the code (cron, backup folder, documents folder, Chrome for PDF, Python and PyTorch for the forecast, safe environment, MIMS and EIS
 * settings). Prints PASS / WARN / FAIL per item and never prints a secret value. Exit code 1 when any item FAILS.
 */
class PreflightCommand extends Command
{
    protected $signature = 'distriva:preflight';

    protected $description = 'Memeriksa kesiapan server produksi (cron, backup, dokumen, Chrome PDF, Python/PyTorch, lingkungan aman).';

    /** @var list<array{string, string, string}> */
    private array $rows = [];

    public function handle(ForecastService $forecast, PdfRenderer $pdf): int
    {
        $this->check('Basis data', fn () => DB::select('select 1') ? ['PASS', 'terhubung'] : ['FAIL', 'tidak menjawab']);
        $this->check('Lingkungan', function (): array {
            $prod = app()->environment('production');
            $debug = (bool) config('app.debug');

            return $debug && $prod ? ['FAIL', 'APP_DEBUG menyala di production'] : ($prod ? ['PASS', 'production, debug mati'] : ['WARN', 'APP_ENV='.config('app.env').' (bukan production)']);
        });
        $this->check('Cron schedule:run', function (): array {
            $beat = Cache::get('distriva.scheduler.heartbeat');
            if ($beat === null) {
                return ['FAIL', 'belum pernah berjalan: pasang `* * * * * php artisan schedule:run` di cron'];
            }
            $age = Carbon::parse($beat)->diffInMinutes(now(), true);

            return $age <= 3 ? ['PASS', 'terakhir '.round($age).' menit lalu'] : ['FAIL', 'berhenti '.round($age).' menit lalu: periksa cron'];
        });
        $this->check('Folder backup', function (): array {
            $root = (string) config('distriva.backup.root');
            if (! is_dir($root) && ! @mkdir($root, 0700, true)) {
                return ['FAIL', "tidak ada dan tidak bisa dibuat: {$root}"];
            }
            if (! is_writable($root)) {
                return ['FAIL', "tidak bisa ditulis: {$root}"];
            }
            $free = @disk_free_space($root);
            $inProject = str_starts_with(rtrim($root, '/').'/', rtrim(base_path(), '/').'/');
            if ($inProject) {
                return ['WARN', 'di dalam folder proyek; isi DISTRIVA_BACKUP_ROOT dengan drive lain'];
            }

            return $free !== false && $free < 5 * 1024 ** 3 ? ['WARN', 'ruang kosong tinggal '.round($free / 1024 ** 3, 1).' GB'] : ['PASS', $root];
        });
        $this->check('Backup terakhir', function (): array {
            $last = DB::table('backup_runs')->where('status', 'SUCCEEDED')->max('finished_at');

            return $last === null ? ['WARN', 'belum ada backup berhasil'] : (Carbon::parse($last)->diffInHours(now(), true) > 36 ? ['WARN', 'backup berhasil terakhir '.Carbon::parse($last)->diffForHumans()] : ['PASS', 'terakhir '.Carbon::parse($last)->diffForHumans()]);
        });
        $this->check('Folder dokumen', function (): array {
            $root = (string) config('filesystems.disks.'.config('distriva.documents_disk', 'documents').'.root');

            return is_dir($root) && is_writable($root) ? ['PASS', $root] : ['FAIL', "tidak ada atau tidak bisa ditulis: {$root}"];
        });
        $this->check('Chrome untuk PDF', fn () => ($bin = $pdf->binaryOrNull()) === null ? ['FAIL', 'Chrome/Chromium belum terpasang (atau isi DISTRIVA_PDF_BINARY)'] : ['PASS', $bin]);
        $this->check('Python forecast', function () use ($forecast): array {
            $python = $forecast->pythonBinary();
            if (! is_executable($python)) {
                return ['FAIL', "tidak ada: {$python} (buat venv di tools/forecast, lihat README-nya)"];
            }
            $r = Process::timeout(60)->run([$python, '-c', 'import torch, numpy; print(torch.__version__)']);

            return $r->successful() ? ['PASS', 'PyTorch '.trim($r->output())] : ['FAIL', 'PyTorch/numpy belum terpasang di venv'];
        });
        $this->check('MIMS', fn () => filled(config('distriva.mims.base_url')) ? (config('distriva.mims.verify_ssl') ? ['PASS', 'alamat diisi, verifikasi SSL menyala'] : ['WARN', 'verifikasi SSL MIMS dimatikan (DISTRIVA_MIMS_VERIFY_SSL=false)']) : ['WARN', 'DISTRIVA_MIMS_BASE_URL belum diisi']);
        $this->check('Kunci aplikasi', fn () => filled(config('app.key')) ? ['PASS', 'APP_KEY terisi'] : ['FAIL', 'APP_KEY kosong']);

        $this->table(['Pemeriksaan', 'Hasil', 'Keterangan'], $this->rows);
        $fails = count(array_filter($this->rows, fn (array $r) => $r[1] === 'FAIL'));
        $this->line($fails === 0 ? 'Siap (tanpa FAIL).' : "{$fails} pemeriksaan GAGAL.");

        return $fails === 0 ? self::SUCCESS : self::FAILURE;
    }

    /** @param callable():array{0:string,1:string} $fn */
    private function check(string $name, callable $fn): void
    {
        try {
            [$status, $note] = $fn();
        } catch (Throwable $e) {
            [$status, $note] = ['FAIL', mb_substr($e->getMessage(), 0, 120)];
        }
        $this->rows[] = [$name, $status, $note];
    }
}
