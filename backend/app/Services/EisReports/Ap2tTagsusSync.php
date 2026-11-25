<?php

namespace App\Services\EisReports;

use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Penarikan laporan TAGSUS ("Daftar realisasi pendapatan penetapan tagihan susulan (tunai dan angsuran)") per ULP per bulan dari AP2T lewat tautan laporan yang tidak memerlukan login.
 * Berkas Excel yang diunduh masuk lewat impor laporan EIS yang sama dengan unggahan manual (idempoten menurut sidik isi; unit dan bulan sama menggantikan versi lama), bernama TAGSUS-<kode ULP>-<BBTTTT>.xls.
 * Laporan kedua, "Daftar penetapan tagihan susulan yang belum realisasi", bertata letak sama tetapi hanya memuat penetapan yang belum terealisasi pada tanggal unduh (potret, berubah dari hari ke hari);
 * disimpan sebagai jenis TAGSUS_BELUM, terpisah dari TAGSUS supaya tidak saling menggantikan, dengan nama TAGSUS_BELUM-<kode ULP>-<BBTTTT>.xls.
 */
class Ap2tTagsusSync
{
    /** @var array<string, array{report: string, title: string, family: string, label: string}> */
    public const REPORTS = [
        'realisasi' => ['report' => 'report/NONREK/rpt_ts_daftar_realisasi_pendapatan_penetapan_ts.xls', 'title' => 'DAFTAR REALISASI PENDAPATAN PENETAPAN TAGIHAN SUSULAN (TUNAI DAN ANGSURAN)', 'family' => 'TAGSUS', 'label' => 'realisasi'],
        'belum_realisasi' => ['report' => 'report/NONREK/rpt_ts_daftar_penetapan_ts_belum_realisasi.xls', 'title' => 'DAFTAR PENETAPAN TAGIHAN SUSULAN YANG BELUM REALISASI', 'family' => 'TAGSUS_BELUM', 'label' => 'belum realisasi'],
    ];

    private const LOG_LIMIT = 30000;

    public function __construct(private readonly EisReportImportService $importer) {}

    /**
     * Menjalankan satu run AP2T sampai selesai.
     *
     * @param  callable(string): void  $flush  dipanggil dengan log terbaru
     * @return array{0: int, 1: string} kode keluar (0 = semua berkas masuk) dan log
     */
    public function run(object $run, callable $flush): array
    {
        $o = (array) json_decode((string) $run->options, true);
        $log = '';
        $last = 0.0;
        $say = function (string $line) use (&$log, &$last, $flush): void {
            $log = strlen($log.$line."\n") > self::LOG_LIMIT ? '…'.substr($log.$line."\n", -self::LOG_LIMIT) : $log.$line."\n";
            if (microtime(true) - $last > 2) {
                $last = microtime(true);
                $flush($log);
            }
        };
        $user = User::query()->find($run->started_by);
        $codes = $run->units === null ? [] : (array) json_decode((string) $run->units, true);
        $ulps = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->when($codes !== [], fn ($q) => $q->whereIn('code', $codes))->orderBy('code')->get(['code', 'name']);
        $months = [];
        for ($d = new \DateTimeImmutable($o['from_month'].'-01'); $d->format('Y-m') <= $o['to_month']; $d = $d->modify('+1 month')) {
            $months[] = $d->format('Y-m');
        }
        $reports = array_values(array_intersect(array_keys(self::REPORTS), (array) ($o['reports'] ?? array_keys(self::REPORTS))));
        $say(sprintf('Penarikan laporan TAGSUS dari AP2T (%s): %d ULP x %d bulan (%s s.d. %s).', implode(', ', array_map(fn ($k) => self::REPORTS[$k]['label'], $reports)), $ulps->count(), count($months), $months[0] ?? '-', end($months) ?: '-'));

        $counts = ['BARU' => 0, 'DIGANTIKAN' => 0, 'DUPLIKAT' => 0, 'SUDAH_DIGANTIKAN' => 0];
        $failed = 0;
        $deadline = microtime(true) + (float) config('distriva.eis_sync.timeout_seconds');
        foreach ($months as $ym) {
            foreach ($ulps as $ulp) {
                foreach ($reports as $report) {
                    $label = sprintf('%s %s%s', $ulp->name, $ym, $report === 'realisasi' ? '' : ' ('.self::REPORTS[$report]['label'].')');
                    if (microtime(true) > $deadline) {
                        $say("GAGAL  {$label}: waktu penarikan habis.");
                        $failed++;

                        continue;
                    }
                    try {
                        $res = $this->pull((string) $ulp->code, $ym, $user, $report);
                        $counts[$res['status']] = ($counts[$res['status']] ?? 0) + 1;
                        $say(sprintf('%-11s %s (%d baris)', $res['status'], $label, $res['lines']));
                    } catch (EisReportException $e) {
                        $failed++;
                        $say("DITOLAK {$label}: {$e->getMessage()}");
                    } catch (\Throwable $e) {
                        $failed++;
                        $say("GAGAL  {$label}: {$e->getMessage()}");
                    }
                    usleep((int) config('distriva.ap2t.pause_ms') * 1000);
                }
            }
        }
        $in = array_sum($counts);
        $say(sprintf('Selesai: %d berkas masuk DISTRIVA (baru %d, menggantikan %d, duplikat %d); %d gagal atau ditolak.', $in, $counts['BARU'], $counts['DIGANTIKAN'], $counts['DUPLIKAT'] + $counts['SUDAH_DIGANTIKAN'], $failed));

        return [$failed === 0 ? 0 : 1, $log];
    }

    /**
     * Mengunduh laporan satu ULP satu bulan lalu mengimpornya.
     *
     * @return array<string, mixed> hasil {@see EisReportImportService::import()}
     */
    public function pull(string $ulpCode, string $ym, ?User $user, string $report = 'realisasi'): array
    {
        $body = $this->download($ulpCode, $ym, $report);
        $path = tempnam(sys_get_temp_dir(), 'ap2t');
        try {
            file_put_contents($path, $body);

            return $this->importer->import($path, sprintf('%s-%s-%s%s.xls', self::REPORTS[$report]['family'], $ulpCode, substr($ym, 5, 2), substr($ym, 0, 4)), $user);
        } finally {
            @unlink($path);
        }
    }

    /** Isi berkas Excel laporan; galat bila respons bukan berkas Excel (mis. halaman galat AP2T). */
    public function download(string $ulpCode, string $ym, string $report = 'realisasi'): string
    {
        $cfg = config('distriva.ap2t');
        $def = self::REPORTS[$report];
        $res = Http::withOptions(['verify' => $cfg['verify']])->timeout((int) $cfg['timeout_seconds'])->retry(2, 1000, fn ($e) => $e instanceof ConnectionException, throw: false)
            ->get((string) $cfg['report_url'], ['jenislaporan' => 'getlaporantsgab', 'report' => $def['report'], 'unitup' => $ulpCode, 'unitap' => $cfg['unitap'], 'unitupi' => $cfg['unitupi'], 'jenislap' => $def['title'], 'thbl' => substr($ym, 0, 4).substr($ym, 5, 2)]);
        if (! $res->ok()) {
            throw new \RuntimeException('HTTP '.$res->status().' dari AP2T.');
        }
        $body = $res->body();
        $isExcel = str_starts_with($body, "\xD0\xCF\x11\xE0") || str_starts_with($body, "PK\x03\x04");       // xls (OLE2) atau xlsx (zip)
        if (! $isExcel) {
            throw new \RuntimeException('respons AP2T bukan berkas Excel: '.mb_substr(trim((string) preg_replace('/\s+/', ' ', strip_tags($body))), 0, 150));
        }

        return $body;
    }
}
