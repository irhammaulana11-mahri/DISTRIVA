<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Mengisi `applications.completed_at` permohonan PB dan PD dari tanggal pertama status PEREMAJAAN di EIS (tanggal sambung atau naik daya): php artisan distriva:applications-backfill-connection-date [--dry-run].
 * Hanya yang masih kosong; permohonan batal atau restitusi tidak diisi. Permohonan yang masih terhubung ke usulan penambahan jaringan mengikuti rancangan awal (diisi saat penutupan BASTP): tidak diisi,
 * dan nilai turunan PEREMAJAAN yang terlanjur terisi pada permohonan seperti itu dikosongkan kembali (hanya yang persis sama dengan tanggal PEREMAJAAN pertama dan belum berstatus COMPLETED).
 * Impor EIS berikutnya mengisinya sendiri.
 */
class ApplicationsBackfillConnectionDateCommand extends Command
{
    protected $signature = 'distriva:applications-backfill-connection-date {--dry-run : hanya hitung, tidak menyimpan}';

    protected $description = 'Isi tanggal sambung (completed_at) permohonan PB dan PD dari status PEREMAJAAN EIS, kecuali yang masuk usulan penambahan jaringan';

    private const FIRST_PEREMAJAAN = "(select application_id, min(observed_at) as at from application_external_status_histories where upper(external_status_code) = 'PEREMAJAAN' and observed_at is not null group by application_id)";

    private const IN_PROPOSAL = 'exists (select 1 from proposal_applications pa where pa.application_id = a.id and pa.released_at is null)';

    public function handle(): int
    {
        $fill = self::FIRST_PEREMAJAAN.' h where h.application_id = a.id and a.application_type in (\'PB\', \'PD\') and a.completed_at is null and a.current_status not in (\'CANCELLED\', \'REFUNDED\') and not '.self::IN_PROPOSAL;
        $clear = self::FIRST_PEREMAJAAN.' h where h.application_id = a.id and a.completed_at = h.at and a.current_status <> \'COMPLETED\' and '.self::IN_PROPOSAL;
        if ($this->option('dry-run')) {
            $toFill = (int) DB::selectOne('select count(*) as n from applications a, '.$fill)->n;
            $toClear = (int) DB::selectOne('select count(*) as n from applications a, '.$clear)->n;
            $this->info("{$toFill} permohonan PB dan PD akan diisi tanggal sambungnya, {$toClear} permohonan dalam usulan akan dikosongkan kembali (uji coba, tidak disimpan).");

            return self::SUCCESS;
        }
        $cleared = DB::update('update applications a set completed_at = null, updated_at = now() from '.$clear);
        $filled = DB::update('update applications a set completed_at = h.at, updated_at = now() from '.$fill);
        $this->info("{$filled} permohonan PB dan PD diisi tanggal sambungnya dari status PEREMAJAAN, {$cleared} permohonan dalam usulan penambahan jaringan dikosongkan kembali.");

        return self::SUCCESS;
    }
}
