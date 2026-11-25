<?php

namespace App\Services\Analytics;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Konteks cuaca historis bulanan untuk menjelaskan lonjakan gangguan (docs/92 §8.1): curah hujan bulanan dan jumlah hari hujan lebat per ULP, dari reanalisis ERA5 (Open-Meteo archive) pada titik
 * pusat gardu ULP. Hanya penjelasan: hasil uji menunjukkan cuaca historis terlalu lemah untuk prakiraan, dan embusan angin ERA5 tidak berguna sehingga tidak diambil. Gagal mengambil data tidak
 * boleh merusak halaman: blok dikembalikan `available = false` beserta alasannya.
 */
class WeatherContext
{
    /** ERA5 tertinggal beberapa hari dari hari ini. */
    private const LAG_DAYS = 6;

    public const MONTHS = 12;

    /**
     * @param  list<string>  $units  ULP yang digabung
     * @param  string  $to  bulan akhir (YYYY-MM)
     * @return array<string, mixed>
     */
    public function monthly(array $units, string $to): array
    {
        $base = ['source' => 'ERA5 (Open-Meteo archive)', 'attribution' => 'Data cuaca: ERA5 (Copernicus/ECMWF) lewat Open-Meteo.com, lisensi CC BY 4.0, penggunaan non-komersial.', 'heavy_rain_mm' => (float) config('distriva.weather.heavy_rain_mm', 20)];
        if (! config('distriva.weather.enabled')) {
            return $base + ['available' => false, 'reason' => 'Cuaca historis dinonaktifkan.'];
        }
        $points = $this->points($units);
        if ($points === []) {
            return $base + ['available' => false, 'reason' => 'Koordinat gardu ULP belum tersedia.'];
        }
        $tz = (string) config('distriva.business_timezone', 'Asia/Jakarta');
        $start = date('Y-m-01', (int) strtotime($to.'-01 -'.(self::MONTHS - 1).' month'));
        $end = min(date('Y-m-t', (int) strtotime($to.'-01')), now($tz)->subDays(self::LAG_DAYS)->toDateString());
        if ($end < $start) {
            return $base + ['available' => false, 'reason' => 'Periode belum tercakup data ERA5.'];
        }
        try {
            $series = $this->fetch($points, $start, $end);
        } catch (\Throwable $e) {
            report($e);

            return $base + ['available' => false, 'reason' => 'Sumber cuaca tidak dapat dihubungi.'];
        }
        $events = DB::table('outage_events')->whereNull('source_removed_at')->whereIn('organizational_unit_id', $units)->whereRaw('(occurred_at at time zone ?)::date between ? and ?', [$tz, $start, date('Y-m-t', (int) strtotime($to.'-01'))])
            ->selectRaw("to_char(occurred_at at time zone ?, 'YYYY-MM') as m, count(*) as n", [$tz])->groupBy('m')->pluck('n', 'm');
        $heavy = (float) $base['heavy_rain_mm'];
        $rows = [];
        for ($t = strtotime($start); $t <= strtotime($to.'-01'); $t = strtotime('+1 month', $t)) {
            $month = date('Y-m', $t);
            $rain = [];
            $heavyDays = [];
            $days = 0;
            foreach ($series as $daily) {
                $values = array_filter($daily, fn ($v, $d) => str_starts_with($d, $month) && $v !== null, ARRAY_FILTER_USE_BOTH);
                if ($values === []) {
                    continue;
                }
                $days = max($days, count($values));
                $rain[] = array_sum($values);
                $heavyDays[] = count(array_filter($values, fn ($v) => $v >= $heavy));
            }
            $rows[] = ['month' => $month, 'rain_mm' => $rain === [] ? null : round(array_sum($rain) / count($rain), 1), 'heavy_days' => $heavyDays === [] ? null : round(array_sum($heavyDays) / count($heavyDays), 1),
                'days_covered' => $days, 'events' => (int) ($events[$month] ?? 0)];
        }

        return $base + ['available' => true, 'ulp_count' => count($points), 'rows' => $rows, 'notes' => ['Curah hujan dan hari hujan lebat adalah rata-rata titik pusat gardu tiap ULP yang dipilih; angin tidak ditampilkan karena tidak berhubungan dengan gangguan pada uji data kita.',
            'Hanya penjelasan: pada hari hujan lebat gangguan rata-rata sekitar 1,7 kali hari kering, tetapi cuaca tidak cukup kuat untuk meramal jumlah gangguan.', 'Bulan berjalan belum lengkap (lihat days_covered); data ERA5 tertinggal beberapa hari.']];
    }

    /**
     * Curah hujan harian ERA5 per ULP (kunci tanggal) untuk rentang tertentu; kosong bila cuaca dinonaktifkan, koordinat belum ada, atau sumber gagal.
     *
     * @param  list<string>  $units
     * @return array<string, array<string, ?float>>
     */
    public function dailyRainByUnit(array $units, string $start, string $end): array
    {
        if (! config('distriva.weather.enabled')) {
            return [];
        }
        $points = $this->points($units);
        if ($points === []) {
            return [];
        }
        try {
            $series = $this->fetch($points, $start, $end);
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
        $out = [];
        foreach ($points as $i => $p) {
            $out[$p['unit_id']] = $series[$i] ?? [];
        }

        return $out;
    }

    /**
     * Titik tiap ULP: rata-rata koordinat gardu aktif ULP itu.
     *
     * @return list<array{unit_id: string, lat: float, lon: float}>
     */
    private function points(array $units): array
    {
        return DB::table('substations')->whereIn('organizational_unit_id', $units)->whereNotNull('latitude')->whereNotNull('longitude')->groupBy('organizational_unit_id')->orderBy('organizational_unit_id')
            ->selectRaw('organizational_unit_id as unit_id, avg(latitude) as lat, avg(longitude) as lon')->get()->map(fn ($r) => ['unit_id' => $r->unit_id, 'lat' => round((float) $r->lat, 3), 'lon' => round((float) $r->lon, 3)])->all();
    }

    /**
     * Curah hujan harian tiap titik (kunci tanggal). Disimpan di cache: lama bila periode sudah lampau, satu hari bila mencakup hari-hari terakhir.
     *
     * @param  list<array{unit_id: string, lat: float, lon: float}>  $points
     * @return list<array<string, ?float>>
     */
    private function fetch(array $points, string $start, string $end): array
    {
        $recent = $end >= now()->subDays(40)->toDateString();
        $ttl = $recent ? now()->addDay() : now()->addDays(30);
        $url = (string) config('distriva.weather.archive_url');
        $timeout = (int) config('distriva.weather.timeout_seconds', 20);
        $out = [];
        $missing = [];
        foreach ($points as $i => $p) {
            $cached = Cache::get($this->key($p, $start, $end));
            if ($cached !== null) {
                $out[$i] = $cached;
            } else {
                $missing[$i] = $p;
            }
        }
        if ($missing !== []) {
            $responses = Http::pool(function (Pool $pool) use ($missing, $url, $start, $end, $timeout) {
                foreach ($missing as $i => $p) {
                    $pool->as((string) $i)->timeout($timeout)->get($url, ['latitude' => $p['lat'], 'longitude' => $p['lon'], 'start_date' => $start, 'end_date' => $end, 'daily' => 'precipitation_sum', 'timezone' => 'Asia/Jakarta']);
                }
            });
            foreach ($missing as $i => $p) {
                $response = $responses[(string) $i] ?? null;
                if ($response instanceof ConnectionException || $response === null || ! $response->successful()) {
                    throw new \RuntimeException('Open-Meteo gagal untuk titik ULP.');
                }
                $times = (array) $response->json('daily.time', []);
                $values = (array) $response->json('daily.precipitation_sum', []);
                $daily = [];
                foreach ($times as $k => $d) {
                    $daily[$d] = isset($values[$k]) ? (float) $values[$k] : null;
                }
                Cache::put($this->key($p, $start, $end), $daily, $ttl);
                $out[$i] = $daily;
            }
        }
        ksort($out);

        return array_values($out);
    }

    private function key(array $p, string $start, string $end): string
    {
        return "weather:era5:{$p['lat']}:{$p['lon']}:{$start}:{$end}";
    }
}
