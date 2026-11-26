<?php

namespace App\Console\Commands;

use App\Services\Analytics\WeatherAlert;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Menyimpan prakiraan cuaca BMKG tiga hari per ULP (docs/92 §8.2): php artisan distriva:weather-collect-forecast.
 * Dijadwalkan harian; riwayatnya dipakai menguji tingkat peringatan dini terhadap gangguan sesudahnya. Satu ULP yang gagal tidak menghentikan ULP lain.
 */
class CollectWeatherForecastCommand extends Command
{
    protected $signature = 'distriva:weather-collect-forecast';

    protected $description = 'Simpan prakiraan cuaca BMKG per ULP untuk riwayat uji peringatan dini';

    public function handle(WeatherAlert $alert): int
    {
        if (! config('distriva.weather.bmkg.enabled')) {
            $this->warn('BMKG dinonaktifkan.');

            return self::SUCCESS;
        }
        $units = DB::table('organizational_units')->whereIn('code', array_keys((array) config('distriva.weather.bmkg.locations', [])))->get(['id', 'code']);
        $locations = (array) config('distriva.weather.bmkg.locations', []);
        $now = now();
        $saved = 0;
        $failed = 0;
        foreach ($units as $unit) {
            $adm4 = $locations[$unit->code];
            try {
                $forecast = $alert->forecasts([$unit->id => $adm4], true)[$unit->id] ?? null;
            } catch (\Throwable $e) {
                report($e);
                $failed++;

                continue;
            }
            if ($forecast === null || $forecast['slots'] === []) {
                $failed++;

                continue;
            }
            DB::table('weather_forecast_snapshots')->upsert(
                [['id' => (string) Str::uuid(), 'organizational_unit_id' => $unit->id, 'fetched_on' => $now->toDateString(), 'adm4' => $adm4, 'fetched_at' => $now, 'analysis_date' => $forecast['analysis_date'], 'slots' => json_encode($forecast['slots'])]],
                ['organizational_unit_id', 'fetched_on'],
                ['adm4', 'fetched_at', 'analysis_date', 'slots'],
            );
            $saved++;
        }
        $this->info("Prakiraan tersimpan: {$saved} ULP, gagal: {$failed}.");

        return $failed > 0 && $saved === 0 ? self::FAILURE : self::SUCCESS;
    }
}
