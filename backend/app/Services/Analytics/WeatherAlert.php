<?php

namespace App\Services\Analytics;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Peringatan dini keandalan dari prakiraan cuaca BMKG (API publik, sekitar tiga hari per tiga jam) per ULP (docs/92 §6.6 dan §8.2): tingkat peringatan harian dari curah hujan, hujan petir, dan angin,
 * disertai daftar penyulang prioritas menurut riwayat gangguannya pada hari hujan lebat. Hanya peringatan, bukan prakiraan jumlah gangguan: uji ERA5 (docs/92 §8.1) menunjukkan hari hujan lebat
 * rata-rata 1,66 kali hari kering tetapi daya prediksi harian lemah, sehingga yang ditampilkan adalah tingkat dan rasio historis, bukan angka gangguan. Gagal mengambil data tidak merusak halaman.
 */
class WeatherAlert
{
    /** Kode cuaca BMKG hujan petir. */
    private const THUNDER_CODES = [95, 97];

    /** Kode cuaca BMKG hujan lebat. */
    private const HEAVY_CODES = [63];

    /** Rasio gangguan per ULP-hari menurut kelas curah hujan terhadap hari kering (ERA5 2022-2026, docs/92 §8.1: 0,230; 0,265; 0,345; 0,382 per ULP-hari). */
    public const HISTORICAL_RATE_RATIO = [['max_mm' => 0.5, 'ratio' => 1.0], ['max_mm' => 5.0, 'ratio' => 1.15], ['max_mm' => 20.0, 'ratio' => 1.5], ['max_mm' => INF, 'ratio' => 1.66]];

    private const HISTORY_YEARS = 3;

    private const WATCH_PER_ULP = 5;

    public function __construct(private readonly WeatherContext $weather) {}

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @return array<string, mixed>
     */
    public function earlyWarning(array $units): array
    {
        $base = ['source' => 'BMKG prakiraan cuaca', 'attribution' => 'Sumber data prakiraan: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika), api.bmkg.go.id.', 'heavy_rain_mm' => (float) config('distriva.weather.heavy_rain_mm', 20),
            'very_heavy_rain_mm' => (float) config('distriva.weather.bmkg.very_heavy_mm', 50)];
        if (! config('distriva.weather.bmkg.enabled')) {
            return $base + ['available' => false, 'reason' => 'Peringatan dini BMKG dinonaktifkan.'];
        }
        $names = DB::table('organizational_units')->whereIn('id', $units)->get(['id', 'name', 'code'])->keyBy('id');
        $locations = (array) config('distriva.weather.bmkg.locations', []);
        $targets = [];
        foreach ($units as $u) {
            $code = $names[$u]->code ?? null;
            $code !== null && isset($locations[$code]) && $targets[$u] = $locations[$code];
        }
        if ($targets === []) {
            return $base + ['available' => false, 'reason' => 'Lokasi BMKG untuk ULP pada cakupan ini belum dipetakan.'];
        }
        try {
            $forecasts = $this->fetch($targets);
        } catch (\Throwable $e) {
            report($e);

            return $base + ['available' => false, 'reason' => 'Prakiraan BMKG tidak dapat dihubungi.'];
        }

        $ulps = [];
        $alerted = [];
        foreach ($targets as $u => $adm4) {
            $days = $this->days($forecasts[$u]['slots'] ?? []);
            $levels = array_column($days, 'level');
            $max = in_array('tinggi', $levels, true) ? 'tinggi' : (in_array('waspada', $levels, true) ? 'waspada' : 'normal');
            $max !== 'normal' && $alerted[] = $u;
            $ulps[] = ['unit_id' => $u, 'unit_name' => $names[$u]->name ?? $u, 'adm4' => $adm4, 'location' => $forecasts[$u]['location'] ?? null, 'max_level' => $max, 'days' => $days];
        }
        usort($ulps, fn ($a, $b) => $this->rank($b['max_level']) <=> $this->rank($a['max_level']) ?: strcmp($a['unit_name'], $b['unit_name']));
        $issued = collect($forecasts)->pluck('analysis_date')->filter()->max();

        return $base + ['available' => true, 'issued_at' => $issued, 'horizon_days' => count($ulps[0]['days'] ?? []), 'ulps' => $ulps, 'watchlist' => $this->watchlist($alerted, $names),
            'notes' => ['Tingkat peringatan: waspada bila total hujan harian mencapai '.$base['heavy_rain_mm'].' mm, ada hujan petir, atau hujan lebat pada kode cuaca; tinggi bila total hujan mencapai '.$base['very_heavy_rain_mm'].' mm atau hujan petir disertai hujan '.$base['heavy_rain_mm'].' mm atau lebih. Prakiraan hanya satu titik desa per ULP.',
                '`rate_ratio` adalah rasio historis gangguan hari bercurah hujan sejenis terhadap hari kering (ERA5 2022 sampai 2026), bukan prakiraan jumlah gangguan; daya prediksi harian lemah (docs/92 §8.1).',
                'Penyulang prioritas diurut menurut jumlah gangguan pada hari hujan lebat ('.$base['heavy_rain_mm'].' mm atau lebih, ERA5) selama '.self::HISTORY_YEARS.' tahun; hanya riwayat, bukan jaminan akan terganggu.']];
    }

    /**
     * @param  array<string, string>  $targets  unit_id => adm4
     * @return array<string, array<string, mixed>>
     */
    private function fetch(array $targets): array
    {
        $ttl = now()->addMinutes((int) config('distriva.weather.bmkg.cache_minutes', 60));
        $url = (string) config('distriva.weather.bmkg.url');
        $timeout = (int) config('distriva.weather.timeout_seconds', 20);
        $out = [];
        $missing = [];
        foreach ($targets as $u => $adm4) {
            $cached = Cache::get("weather:bmkg:{$adm4}");
            $cached !== null ? $out[$u] = $cached : $missing[$u] = $adm4;
        }
        if ($missing !== []) {
            $responses = Http::pool(function (Pool $pool) use ($missing, $url, $timeout) {
                foreach ($missing as $u => $adm4) {
                    $pool->as((string) $u)->timeout($timeout)->get($url, ['adm4' => $adm4]);
                }
            });
            foreach ($missing as $u => $adm4) {
                $r = $responses[(string) $u] ?? null;
                if ($r instanceof ConnectionException || $r === null || ! $r->successful()) {
                    throw new \RuntimeException("BMKG gagal untuk {$adm4}.");
                }
                $slots = [];
                $analysis = null;
                foreach ((array) $r->json('data.0.cuaca', []) as $day) {
                    foreach ((array) $day as $slot) {
                        $slots[] = ['at' => (string) ($slot['local_datetime'] ?? ''), 'rain' => (float) ($slot['tp'] ?? 0), 'weather' => (int) ($slot['weather'] ?? 0), 'wind' => (float) ($slot['ws'] ?? 0)];
                        $analysis ??= $slot['analysis_date'] ?? null;
                    }
                }
                $loc = (array) $r->json('lokasi', []);
                $value = ['slots' => $slots, 'analysis_date' => $analysis, 'location' => $loc === [] ? null : ['desa' => $loc['desa'] ?? null, 'kecamatan' => $loc['kecamatan'] ?? null, 'kotkab' => $loc['kotkab'] ?? null]];
                Cache::put("weather:bmkg:{$adm4}", $value, $ttl);
                $out[$u] = $value;
            }
        }

        return $out;
    }

    /**
     * @param  list<array{at: string, rain: float, weather: int, wind: float}>  $slots
     * @return list<array<string, mixed>>
     */
    private function days(array $slots): array
    {
        $heavy = (float) config('distriva.weather.heavy_rain_mm', 20);
        $veryHeavy = (float) config('distriva.weather.bmkg.very_heavy_mm', 50);
        $byDate = [];
        foreach ($slots as $s) {
            $date = substr($s['at'], 0, 10);
            if ($date === '') {
                continue;
            }
            $d = &$byDate[$date];
            $d ??= ['date' => $date, 'rain_mm' => 0.0, 'max_3h_mm' => 0.0, 'thunderstorm' => false, 'heavy_code' => false, 'max_wind_kmh' => 0.0, 'slots' => 0];
            $d['rain_mm'] += $s['rain'];
            $d['max_3h_mm'] = max($d['max_3h_mm'], $s['rain']);
            $d['thunderstorm'] = $d['thunderstorm'] || in_array($s['weather'], self::THUNDER_CODES, true);
            $d['heavy_code'] = $d['heavy_code'] || in_array($s['weather'], self::HEAVY_CODES, true);
            $d['max_wind_kmh'] = max($d['max_wind_kmh'], $s['wind']);
            $d['slots']++;
            unset($d);
        }
        ksort($byDate);

        return array_values(array_map(function ($d) use ($heavy, $veryHeavy) {
            $level = match (true) {
                $d['rain_mm'] >= $veryHeavy, $d['thunderstorm'] && $d['rain_mm'] >= $heavy => 'tinggi',
                $d['rain_mm'] >= $heavy, $d['thunderstorm'], $d['heavy_code'] => 'waspada',
                default => 'normal',
            };
            $ratio = 1.0;
            foreach (self::HISTORICAL_RATE_RATIO as $band) {
                if ($d['rain_mm'] < $band['max_mm']) {
                    $ratio = $band['ratio'];
                    break;
                }
            }

            return ['date' => $d['date'], 'rain_mm' => round($d['rain_mm'], 1), 'max_3h_mm' => round($d['max_3h_mm'], 1), 'thunderstorm' => $d['thunderstorm'], 'max_wind_kmh' => round($d['max_wind_kmh'], 1), 'level' => $level, 'rate_ratio' => $ratio, 'slots' => $d['slots']];
        }, $byDate));
    }

    /**
     * Penyulang prioritas di ULP yang berstatus waspada atau tinggi: jumlah gangguan pada hari hujan lebat selama tiga tahun terakhir (curah hujan ERA5 ULP itu).
     *
     * @param  list<string>  $alerted
     * @return list<array<string, mixed>>
     */
    private function watchlist(array $alerted, $names): array
    {
        if ($alerted === []) {
            return [];
        }
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $end = now($tz)->toDateString();
        $start = date('Y-m-d', (int) strtotime($end.' -'.self::HISTORY_YEARS.' year'));
        $rain = $this->weather->dailyRainByUnit($alerted, $start, date('Y-m-d', (int) strtotime($end.' -6 day')));
        if ($rain === []) {
            return [];
        }
        $heavy = (float) config('distriva.weather.heavy_rain_mm', 20);
        $rows = DB::table('outage_events as e')->leftJoin('distribution_feeders as f', 'f.id', '=', 'e.feeder_id')->whereNull('e.source_removed_at')->whereNotNull('e.feeder_id')->whereIn('e.organizational_unit_id', array_keys($rain))
            ->whereRaw('(e.occurred_at at time zone ?)::date between ? and ?', [$tz, $start, $end])->selectRaw('e.organizational_unit_id as u, e.feeder_id, f.code, f.name, f.gi_name, (e.occurred_at at time zone ?)::date as d', [$tz])->get();
        $acc = [];
        foreach ($rows as $r) {
            $a = &$acc[$r->u][$r->feeder_id];
            $a ??= ['code' => $r->code, 'name' => $r->name, 'gi_name' => $r->gi_name, 'events' => 0, 'heavy' => 0];
            $a['events']++;
            ($rain[$r->u][substr((string) $r->d, 0, 10)] ?? 0) >= $heavy && $a['heavy']++;
            unset($a);
        }
        $out = [];
        foreach ($acc as $u => $feeders) {
            uasort($feeders, fn ($a, $b) => $b['heavy'] <=> $a['heavy'] ?: $b['events'] <=> $a['events']);
            foreach (array_slice($feeders, 0, self::WATCH_PER_ULP, true) as $id => $f) {
                $f['heavy'] > 0 && $out[] = ['unit_id' => $u, 'unit_name' => $names[$u]->name ?? $u, 'feeder_id' => $id, 'code' => $f['code'], 'name' => $f['name'], 'gi_name' => $f['gi_name'], 'events_3y' => $f['events'], 'events_on_heavy_rain_days_3y' => $f['heavy'],
                    'heavy_rain_share_pct' => round($f['heavy'] / $f['events'] * 100, 1)];
            }
        }

        return $out;
    }

    private function rank(string $level): int
    {
        return match ($level) {
            'tinggi' => 2,
            'waspada' => 1,
            default => 0,
        };
    }
}
