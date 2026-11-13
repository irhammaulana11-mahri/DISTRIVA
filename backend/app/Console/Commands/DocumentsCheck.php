<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Checks the private documents storage (owner decision 2026-11-06: files live on the media drive). Writes and removes one tiny temp file. */
class DocumentsCheck extends Command
{
    protected $signature = 'distriva:documents-check';

    protected $description = 'Check that the private documents storage exists, is writable, is outside the project and the web root.';

    public function handle(): int
    {
        $disk = (string) config('distriva.documents_disk', 'documents');
        $root = (string) config("filesystems.disks.{$disk}.root");
        $this->line("Disk   : {$disk}");
        $this->line("Folder : {$root}");
        $problems = 0;

        if (! str_starts_with($root, '/')) {
            $this->error('Folder harus berupa path absolut.');

            return self::FAILURE;
        }
        foreach ([public_path(), storage_path('app/public')] as $public) {
            if (str_starts_with(rtrim($root, '/').'/', rtrim($public, '/').'/')) {
                $this->error("Folder berada di area publik ({$public}) — TIDAK AMAN.");
                $problems++;
            }
        }
        if (str_starts_with(rtrim($root, '/').'/', rtrim(base_path(), '/').'/')) {
            $this->warn('Folder berada di dalam folder proyek. Keputusan pemilik: simpan di drive media (isi DISTRIVA_DOCUMENTS_ROOT).');
        }
        if (! is_dir($root)) {
            $this->warn('Folder belum ada; akan dibuat saat unggahan pertama (pastikan drive terpasang dan induknya dapat ditulis).');
        } else {
            $free = @disk_free_space($root);
            $this->line('Ruang kosong: '.($free === false ? 'tidak diketahui' : round($free / 1024 / 1024 / 1024, 1).' GB'));
        }
        try {
            $key = 'check/'.Str::uuid().'.txt';
            Storage::disk($disk)->put($key, 'distriva-documents-check');
            $ok = Storage::disk($disk)->get($key) === 'distriva-documents-check';
            Storage::disk($disk)->delete($key);
            $ok ? $this->info('Tulis/baca/hapus uji: BERHASIL.') : $this->error('Baca ulang tidak cocok.');
            $problems += $ok ? 0 : 1;
        } catch (\Throwable $e) {
            $this->error('Tulis uji GAGAL: '.$e->getMessage());
            $problems++;
        }

        return $problems === 0 ? self::SUCCESS : self::FAILURE;
    }
}
