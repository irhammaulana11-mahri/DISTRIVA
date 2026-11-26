<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Mengisi `applications.completed_at` permohonan PB dari tanggal pertama status PEREMAJAAN di EIS (tanggal sambung): php artisan distriva:applications-backfill-connection-date [--dry-run].
 * Hanya yang masih kosong; permohonan batal atau restitusi dan permohonan PD tidak diisi. Impor EIS berikutnya mengisinya sendiri.
 */
class ApplicationsBackfillConnectionDateCommand extends Command
{
    protected $signature = 'distriva:applications-backfill-connection-date {--dry-run : hanya hitung, tidak menyimpan}';

    protected $description = 'Isi tanggal sambung (completed_at) permohonan PB dari status PEREMAJAAN EIS';

    public function handle(): int
    {
        $candidates = fn () => DB::table('applications as a')->join('application_external_status_histories as h', 'h.application_id', '=', 'a.id')->where('a.application_type', 'PB')->whereNull('a.completed_at')
            ->whereNotIn('a.current_status', ['CANCELLED', 'REFUNDED'])->whereRaw("upper(h.external_status_code) = 'PEREMAJAAN'")->whereNotNull('h.observed_at');
        $total = (clone $candidates())->distinct()->count('a.id');
        if ($this->option('dry-run')) {
            $this->info("{$total} permohonan PB akan diisi tanggal sambungnya (uji coba, tidak disimpan).");

            return self::SUCCESS;
        }
        $updated = DB::update("update applications a set completed_at = h.at, updated_at = now() from (select application_id, min(observed_at) as at from application_external_status_histories
            where upper(external_status_code) = 'PEREMAJAAN' and observed_at is not null group by application_id) h where h.application_id = a.id and a.application_type = 'PB' and a.completed_at is null
            and a.current_status not in ('CANCELLED', 'REFUNDED')");
        $this->info("{$updated} permohonan PB diisi tanggal sambungnya dari status PEREMAJAAN.");

        return self::SUCCESS;
    }
}
