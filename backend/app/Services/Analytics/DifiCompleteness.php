<?php

namespace App\Services\Analytics;

use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Peringatan bahwa laporan DIFI bulan terakhir kemungkinan belum lengkap (docs/91).
 *
 * Data gangguan di APKT/EIS diisi dan divalidasi bertahap, sehingga laporan bulan terbaru sering belum memuat gangguan penyulang tidak terencana
 * (Padam Tidak Terencana dan Bencana Alam pada baris Gardu Induk 20 kV dan Penyulang) dan SAIDI, SAIFI, serta ENS bulan itu terlalu rendah. Tanda yang dipakai:
 * pada bulan DIFI terbaru semua ULP yang dipilih nol kejadian, padahal rata-rata jumlah kejadian tiga bulan sebelumnya (ULP yang sama) sekurang-kurangnya {@see self::MIN_PREVIOUS_AVERAGE}.
 */
class DifiCompleteness
{
    public const CODE = 'difi_latest_month_incomplete';

    /** Rata-rata kejadian per bulan (jumlah seluruh ULP terpilih) pada tiga bulan sebelumnya yang membuat nol dianggap janggal. */
    public const MIN_PREVIOUS_AVERAGE = 3.0;

    private const LOOKBACK = 3;

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP terpilih
     * @param  string  $to  bulan akhir rentang yang ditampilkan (YYYY-MM): peringatan hanya bila rentang mencapai bulan DIFI terbaru
     * @return list<array<string, mixed>>
     */
    public function check(array $units, string $to): array
    {
        if ($units === []) {
            return [];
        }
        $latestDate = DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->whereIn('organizational_unit_id', $units)->max('period');
        if ($latestDate === null) {
            return [];
        }
        $latest = substr((string) $latestDate, 0, 7);
        if ($to < $latest) {
            return [];
        }
        $from = $this->shift($latest, -self::LOOKBACK);
        $raw = $this->metrics->raw('saidi-saifi', $units, $from, $latest);

        $reporting = array_values(array_filter($units, fn ($u) => isset($raw[$u][$latest])));
        if ($reporting === []) {
            return [];
        }
        $events = fn (string $m): float => array_sum(array_map(fn ($u) => (float) ($raw[$u][$m]['raw']['pny_ggn_n'] ?? 0), $reporting));
        if ($events($latest) > 0) {
            return [];
        }
        $previous = [];
        for ($i = 1; $i <= self::LOOKBACK; $i++) {
            $m = $this->shift($latest, -$i);
            if (array_filter($reporting, fn ($u) => isset($raw[$u][$m])) !== []) {
                $previous[$m] = $events($m);
            }
        }
        if ($previous === []) {
            return [];
        }
        $average = array_sum($previous) / count($previous);
        if ($average < self::MIN_PREVIOUS_AVERAGE) {
            return [];
        }

        return [[
            'code' => self::CODE,
            'severity' => 'warning',
            'month' => $latest,
            'message' => sprintf('Laporan DIFI %s kemungkinan belum lengkap: tidak ada gangguan penyulang tidak terencana (0 kejadian), padahal rata-rata %s kejadian per bulan pada %d bulan sebelumnya. SAIDI, SAIFI, dan ENS bulan ini bisa terlalu rendah; tarik ulang laporan setelah data di APKT final.',
                $latest, rtrim(rtrim(number_format($average, 1, ',', '.'), '0'), ','), count($previous)),
            'events_latest' => 0,
            'events_previous_average' => round($average, 1),
            'previous_months' => array_keys($previous),
            'units_reporting' => count($reporting),
        ]];
    }

    private function shift(string $month, int $by): string
    {
        return (new DateTimeImmutable($month.'-01'))->modify(sprintf('%+d months', $by))->format('Y-m');
    }
}
