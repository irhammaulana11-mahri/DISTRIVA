<?php

namespace Tests\Unit;

use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * Penjaga: `Process::fromShellCommandline()` hanya ada pada Symfony Process. Fasad `Illuminate\Support\Facades\Process` tidak punya metode itu, dan kekeliruan impor ini baru terlihat saat
 * proses terpisah benar-benar dijalankan (tes memakai mode inline), yaitu sinkronisasi gangguan yang gagal dengan "Call to undefined method PendingProcess::fromShellCommandline()".
 */
class ProcessImportTest extends TestCase
{
    #[Test]
    public function every_file_that_builds_a_shell_process_imports_the_symfony_process_class(): void
    {
        $bad = [];
        $users = 0;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(dirname(__DIR__, 2).'/app', RecursiveDirectoryIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $code = (string) file_get_contents($file->getPathname());
            if (! preg_match_all('/\b(\w*Process)::fromShellCommandline\(/', $code, $m)) {
                continue;
            }
            $users++;
            foreach (array_unique($m[1]) as $alias) {
                $imported = preg_match('/^use Symfony\\\\Component\\\\Process\\\\Process(?: as '.preg_quote($alias, '/').')?;$/m', $code) === 1;
                $imported || $bad[] = str_replace(dirname(__DIR__, 2).'/', '', $file->getPathname()).' ('.$alias.')';
            }
        }

        $this->assertGreaterThan(1, $users, 'Pemindaian tidak menemukan layanan yang memakai proses terpisah.');
        $this->assertSame([], $bad, 'Gunakan Symfony\Component\Process\Process untuk fromShellCommandline().');
    }
}
