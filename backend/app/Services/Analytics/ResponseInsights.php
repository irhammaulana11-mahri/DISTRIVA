<?php

namespace App\Services\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Wawasan waktu tanggap untuk menu RPT-RCT Gangguan dan Keluhan (docs/92 §6.7), dari data APKT per ULP per bulan: perbandingan ULP pada bulan terpilih (termasuk jarak ke ULP terbaik pada
 * volume WO sebanding), porsi WO clear temper, riwayat 12 bulan, dan hubungan volume WO dengan RPT dan RCT. Tanpa prakiraan: volume WO bukan hasil prakiraan yang sudah lolos uji (docs/92 §6.6),
 * sehingga prakiraan RPT-RCT turunannya ditunda.
 */
class ResponseInsights
{
    /** ULP sebanding bila volume WO-nya antara setengah dan dua kali volume ULP itu. */
    public const PEER_BAND = [0.5, 2.0];

    private const HISTORY_MONTHS = 12;

    private const CORRELATION_MONTHS = 24;

    /** Desimal pembulatan: menit satu desimal, jam (keluhan) dua desimal. */
    private int $precision = 1;

    public function __construct(private readonly BusinessMetricService $metrics) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function detail(string $code, array $units, string $to): array
    {
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $partial = $to === now($tz)->format('Y-m');
        $from = $this->shift($to, -(self::CORRELATION_MONTHS - 1));
        $raw = $this->metrics->raw($code, $units, $from, $to);
        $gangguan = $code === 'rpt-rct-gangguan';
        $unit = $gangguan ? 'menit' : 'jam';
        $this->precision = $gangguan ? 1 : 2;
        $names = DB::table('organizational_units')->whereIn('id', $units)->pluck('name', 'id');

        $ulps = [];
        foreach ($units as $u) {
            $r = $raw[$u][$to]['raw'] ?? null;
            if ($r === null || ($r['rpt_count'] ?? 0) <= 0) {
                continue;
            }
            $row = ['unit_id' => $u, 'unit_name' => $names[$u] ?? $u, 'wo' => (int) $r['rpt_count'], 'rpt' => $this->avg($r, 'rpt_total', 'rpt_count'), 'rct' => $this->avg($r, 'rct_total', 'rct_count')];
            if ($gangguan) {
                $n = (float) ($r['rpt_count_nct'] ?? 0);
                $row += ['wo_nct' => (int) $n, 'rpt_nct' => $this->avg($r, 'rpt_total_nct', 'rpt_count_nct'), 'rct_nct' => $this->avg($r, 'rct_total_nct', 'rct_count_nct'),
                    'clear_temper_share_pct' => isset($r['n_ct']) ? round($r['n_ct'] / $r['rpt_count'] * 100, 1) : null];
            }
            $ulps[] = $row;
        }
        $ulps = $this->withPeers($ulps, $gangguan ? 'rpt_nct' : 'rpt', $gangguan ? 'rct_nct' : 'rct');

        return ['kind' => 'response', 'focus' => $code, 'unit' => $unit, 'month' => $to, 'partial' => $partial, 'basis' => $gangguan ? 'tanpa_clear_temper' : 'semua',
            'ulps' => $ulps, 'history' => $this->history($raw, $units, $to, $gangguan), 'volume_effect' => $this->volumeEffect($raw, $units, $to, $partial, $gangguan),
            'notes' => array_values(array_filter([
                $gangguan ? 'Pembanding antar ULP dan jarak ke terbaik memakai laporan tanpa clear temper, sama dengan ukuran NKO; kolom lain memuat semua laporan.' : null,
                'ULP sebanding adalah ULP lain pada pilihan ini dengan volume WO antara setengah dan dua kali volume ULP itu; jarak ke terbaik dihitung terhadap yang tercepat di antara mereka (kosong bila tidak ada pembanding).',
                'Hubungan volume dan waktu tanggap adalah korelasi, bukan sebab-akibat: dihitung dalam ULP yang sama (menghapus beda tetap antar ULP) pada bulan lengkap.',
                $partial ? 'Bulan berjalan belum lengkap; rata-rata bisa bergeser saat WO bulan itu bertambah.' : null,
                'Prakiraan RPT-RCT belum disediakan: bergantung pada volume WO yang belum punya prakiraan teruji.'])),
        ];
    }

    /**
     * Tambah peringkat, jarak ke ULP terbaik pada volume sebanding, dan jarak ke terbaik secara umum.
     *
     * @param  list<array<string, mixed>>  $ulps
     * @return list<array<string, mixed>>
     */
    private function withPeers(array $ulps, string $rptKey, string $rctKey): array
    {
        foreach ($ulps as $i => $row) {
            $peers = array_filter($ulps, fn ($p) => $p['unit_id'] !== $row['unit_id'] && $p['wo'] >= $row['wo'] * self::PEER_BAND[0] && $p['wo'] <= $row['wo'] * self::PEER_BAND[1]);
            $best = $peers === [] ? null : min(array_column($peers, $rptKey));
            $bestRct = $peers === [] ? null : min(array_column($peers, $rctKey));
            $ulps[$i]['rpt_rank'] = 1 + count(array_filter($ulps, fn ($p) => $p[$rptKey] < $row[$rptKey]));
            $ulps[$i]['rct_rank'] = 1 + count(array_filter($ulps, fn ($p) => $p[$rctKey] < $row[$rctKey]));
            $ulps[$i]['peer_count'] = count($peers);
            $ulps[$i]['rpt_gap_to_peer_best'] = $best === null ? null : round($row[$rptKey] - $best, $this->precision);
            $ulps[$i]['rct_gap_to_peer_best'] = $bestRct === null ? null : round($row[$rctKey] - $bestRct, $this->precision);
        }
        usort($ulps, fn ($a, $b) => $a['rpt_rank'] <=> $b['rpt_rank'] ?: $b['wo'] <=> $a['wo']);

        return $ulps;
    }

    /**
     * Rata-rata tertimbang (menurut jumlah WO) seluruh ULP pilihan, 12 bulan terakhir.
     *
     * @return list<array<string, mixed>>
     */
    private function history(array $raw, array $units, string $to, bool $gangguan): array
    {
        $out = [];
        for ($i = self::HISTORY_MONTHS - 1; $i >= 0; $i--) {
            $m = $this->shift($to, -$i);
            $sum = [];
            foreach ($units as $u) {
                foreach ($raw[$u][$m]['raw'] ?? [] as $k => $v) {
                    $sum[$k] = ($sum[$k] ?? 0) + $v;
                }
            }
            if (($sum['rpt_count'] ?? 0) <= 0) {
                continue;
            }
            $row = ['month' => $m, 'wo' => (int) $sum['rpt_count'], 'rpt' => $this->avg($sum, 'rpt_total', 'rpt_count'), 'rct' => $this->avg($sum, 'rct_total', 'rct_count')];
            if ($gangguan) {
                $row += ['rpt_nct' => $this->avg($sum, 'rpt_total_nct', 'rpt_count_nct'), 'rct_nct' => $this->avg($sum, 'rct_total_nct', 'rct_count_nct'),
                    'clear_temper_share_pct' => isset($sum['n_ct']) ? round($sum['n_ct'] / $sum['rpt_count'] * 100, 1) : null];
            }
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Korelasi dalam-ULP antara volume WO bulanan dan RPT (atau RCT) rata-rata bulan itu, pada bulan lengkap saja.
     *
     * @return array<string, mixed>
     */
    private function volumeEffect(array $raw, array $units, string $to, bool $partial, bool $gangguan): array
    {
        $last = $partial ? $this->shift($to, -1) : $to;
        $xs = [];
        $rpt = [];
        $rct = [];
        $ulpsUsed = 0;
        foreach ($units as $u) {
            $series = [];
            for ($i = 0; $i < self::CORRELATION_MONTHS; $i++) {
                $r = $raw[$u][$this->shift($last, -$i)]['raw'] ?? null;
                if ($r !== null && ($r['rpt_count'] ?? 0) > 0) {
                    $series[] = [(float) $r['rpt_count'], $this->avg($r, 'rpt_total', 'rpt_count'), $this->avg($r, 'rct_total', 'rct_count')];
                }
            }
            if (count($series) < 6) {
                continue;
            }
            $ulpsUsed++;
            $mean = array_map(fn ($k) => array_sum(array_column($series, $k)) / count($series), [0, 1, 2]);
            foreach ($series as $s) {
                $xs[] = $s[0] - $mean[0];
                $rpt[] = $s[1] - $mean[1];
                $rct[] = $s[2] - $mean[2];
            }
        }
        if ($ulpsUsed === 0) {
            return ['available' => false, 'reason' => 'Riwayat bulan lengkap kurang dari enam bulan.'];
        }
        $rRpt = $this->pearson($xs, $rpt);
        $rRct = $this->pearson($xs, $rct);
        $strong = fn (?float $r) => $r !== null && abs($r) >= 0.3;

        return ['available' => true, 'basis' => 'semua', 'ulps' => $ulpsUsed, 'observations' => count($xs), 'rpt_correlation' => $rRpt, 'rct_correlation' => $rRct,
            'reading' => match (true) {
                $strong($rRpt) && $rRpt > 0, $strong($rRct) && $rRct > 0 => 'Waktu tanggap cenderung memburuk saat volume WO naik (posko kewalahan).',
                $strong($rRpt) || $strong($rRct) => 'Waktu tanggap cenderung membaik saat volume WO naik; volume bukan penyebab keterlambatan.',
                default => 'Tidak ada hubungan berarti antara volume WO dan waktu tanggap; keterlambatan lebih mungkin berasal dari faktor lain (jarak, kru, jenis gangguan).',
            }];
    }

    /** @param  list<float>  $x */
    private function pearson(array $x, array $y): ?float
    {
        $sxy = 0.0;
        $sxx = 0.0;
        $syy = 0.0;
        foreach ($x as $i => $v) {
            $sxy += $v * $y[$i];
            $sxx += $v * $v;
            $syy += $y[$i] ** 2;
        }

        return $sxx > 0 && $syy > 0 ? round($sxy / sqrt($sxx * $syy), 3) : null;
    }

    private function avg(array $r, string $num, string $den): ?float
    {
        return ($r[$den] ?? 0) > 0 ? round($r[$num] / $r[$den], $this->precision) : null;
    }

    private function shift(string $month, int $by): string
    {
        return date('Y-m', (int) strtotime($month.'-01 '.($by >= 0 ? '+' : '').$by.' month'));
    }
}
