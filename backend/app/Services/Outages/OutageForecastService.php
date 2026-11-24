<?php

namespace App\Services\Outages;

use App\Services\Forecast\SeasonalForecaster;
use Illuminate\Support\Facades\DB;

/**
 * Prakiraan gangguan 12 bulan ke depan (docs/87), statistik dan dihitung saat diminta (tanpa pekerjaan latar): per metrik bulanan (gangguan permanen, temporer, ENS, SAIFI, SAIDI)
 * dengan tingkat dasar 12 bulan terakhir, tren teredam, dan indeks musiman dari tahun yang lengkap. Rentang p10-p90 bulanan berasal dari rasio aktual/prakiraan pada uji mundur (origin bergulir, 1-3 bulan); rentang total 12 bulan menggabungkan galat bulanan sebagai saling bebas,
 * dan mutunya dibandingkan dengan pembanding sederhana "bulan yang sama tahun lalu". Selain itu perkiraan jumlah gangguan 12 bulan per penyulang dari laju historis (Poisson).
 * Ini prakiraan pola, bukan jaminan: peristiwa luar biasa (badai, pekerjaan besar) tidak bisa diprakirakan.
 */
class OutageForecastService
{
    private const METRICS = ['permanent' => 'Gangguan permanen', 'temporary' => 'Gangguan temporer', 'ens_kwh' => 'Energi tidak tersalur (kWh)', 'saifi' => 'SAIFI', 'saidi' => 'SAIDI (menit)'];

    public function __construct(private readonly OutageAnalysisService $analysis, private readonly SeasonalForecaster $forecaster) {}

    /** @return array<string,mixed> */
    public function forecast(array $units, bool $withUnassigned): array
    {
        $monthly = $this->analysis->analysis($units, $withUnassigned, null, null)['monthly'];
        $full = array_values(array_filter($monthly, fn ($m) => ! $m['partial']));
        $notes = ['Prakiraan pola dari riwayat bulanan; peristiwa luar biasa tidak bisa diprakirakan. Rentang p10-p90 dari uji mundur 1-3 bulan.', 'SAIFI dan SAIDI memakai definisi dan ambang pada pengaturan sinkronisasi gangguan (batas atas; pelanggan terdampak = seluruh pelanggan penyulang).'];
        if (count($full) < 24) {
            return ['status' => 'INSUFFICIENT', 'message' => 'Riwayat belum cukup: butuh minimal 24 bulan lengkap ('.count($full).' tersedia).', 'history_months' => count($full), 'metrics' => [], 'feeders' => [], 'notes' => $notes];
        }
        $metrics = [];
        foreach (self::METRICS as $key => $label) {
            $metrics[] = ['key' => $key, 'label' => $label] + $this->forecaster->series(array_column($full, $key), array_column($full, 'month'));
        }

        return ['status' => 'OK', 'history_months' => count($full), 'last_full_month' => end($full)['month'], 'seasonal_years' => $this->fullYears($full), 'metrics' => $metrics, 'feeders' => $this->feeders($units, $withUnassigned), 'notes' => $notes];
    }

    /** @param list<array<string,mixed>> $full @return int jumlah tahun lengkap */
    private function fullYears(array $full): int
    {
        $c = [];
        foreach ($full as $m) {
            $c[substr($m['month'], 0, 4)] = ($c[substr($m['month'], 0, 4)] ?? 0) + 1;
        }

        return count(array_filter($c, fn ($n) => $n === 12));
    }

    /** Perkiraan jumlah gangguan per penyulang 12 bulan ke depan dari laju historis (campuran 12 bulan terakhir dan 12 bulan sebelumnya). @return list<array<string,mixed>> */
    private function feeders(array $units, bool $withUnassigned): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $last = now($tz)->subMonthNoOverflow()->endOfMonth();
        $l12 = $last->copy()->subMonthsNoOverflow(11)->startOfMonth()->toDateString();
        $p12 = $last->copy()->subMonthsNoOverflow(23)->startOfMonth()->toDateString();
        $p12To = $last->copy()->subMonthsNoOverflow(12)->endOfMonth()->toDateString();
        $rows = DB::table('outage_events as e')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->where(fn ($w) => $w->whereIn('e.organizational_unit_id', $units)->when($withUnassigned, fn ($x) => $x->orWhereNull('e.organizational_unit_id')))
            ->selectRaw("e.feeder_id, count(*) filter (where (e.occurred_at at time zone ?)::date >= ?) as l12, count(*) filter (where (e.occurred_at at time zone ?)::date between ? and ?) as p12,
                count(*) filter (where (e.occurred_at at time zone ?)::date >= ? and e.outage_type = 'PERMANEN') as perm12", [$tz, $l12, $tz, $p12, $p12To, $tz, $l12])->groupBy('e.feeder_id')->havingRaw('count(*) filter (where (e.occurred_at at time zone ?)::date >= ?) > 0', [$tz, $p12])->get();
        $meta = DB::table('distribution_feeders')->whereIn('id', $rows->pluck('feeder_id'))->get(['id', 'name', 'gi_name'])->keyBy('id');
        $matrix = $this->analysis->customerMatrix();
        $out = [];
        foreach ($rows as $r) {
            $lam = 0.65 * $r->l12 + 0.35 * $r->p12;
            $spread = 1.2816 * sqrt(max($lam, 0.0001));
            $cust = array_sum(array_intersect_key($matrix[$r->feeder_id] ?? [], array_flip($units)));
            $out[] = ['feeder_id' => $r->feeder_id, 'name' => $meta[$r->feeder_id]->name ?? '-', 'gi_name' => $meta[$r->feeder_id]->gi_name ?? null, 'customers' => $cust, 'l12m_events' => (int) $r->l12, 'prev12m_events' => (int) $r->p12,
                'expected_12m' => round($lam, 1), 'p10' => round(max(0, $lam - $spread), 1), 'p90' => round($lam + $spread, 1), 'expected_permanent_12m' => round($r->l12 > 0 ? $lam * $r->perm12 / $r->l12 : 0, 1),
                'risk' => $lam >= 24 ? 'KRITIS' : ($lam >= 12 ? 'TINGGI' : ($lam >= 6 ? 'WASPADA' : 'AMAN'))];
        }
        usort($out, fn ($a, $b) => $b['expected_12m'] <=> $a['expected_12m']);

        return array_slice($out, 0, 40);
    }
}
