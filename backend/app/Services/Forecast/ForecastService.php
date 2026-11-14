<?php

namespace App\Services\Forecast;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process as SymfonyProcess;
use Throwable;

/**
 * Substation-load forecast (docs/11; owner Nov 2026: deep learning only, the load of the substations is forecast, not only material). The run exports the readings and the substation context to CSV,
 * calls the Python/PyTorch service in tools/forecast (one shared quantile network, see its README), and stores the result with the model, window, metrics and assumptions. The forecast is a
 * recommendation: it is DRAFT until a reviewer marks it REVIEWED. One run at a time.
 */
class ForecastService
{
    public const KIND = 'GARDU_LOAD';

    private const STALE_AFTER_HOURS = 3;

    private const ASSUMPTIONS = 'Prakiraan beban gardu dari riwayat pembacaan (jaringan saraf GRU kuantil, satu model bersama untuk semua gardu). Nilai adalah rasio beban kVA terhadap kapasitas trafo '
        .'pada pembacaan terakhir, dengan rentang p10-p90. Tidak memodelkan pemindahan beban, sisip trafo, atau penggantian trafo setelah pembacaan terakhir. Satu pembacaan per gardu per beberapa bulan '
        .'(sebagian besar pembacaan tahunan) membuat prakiraan per gardu bersifat indikatif; gunakan bersama survei lapangan. Rekomendasi, bukan keputusan pengadaan.';

    /** Registers a run and starts it in a detached process. */
    public function start(User $actor): string
    {
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $actor): void {
            DB::table('forecast_runs')->where('kind', self::KIND)->where('status', 'RUNNING')->where('started_at', '<', now()->subHours(self::STALE_AFTER_HOURS))
                ->update(['status' => 'FAILED', 'error' => 'Run berhenti tanpa hasil (melewati batas waktu).', 'finished_at' => now(), 'updated_at' => now()]);
            if (DB::table('forecast_runs')->where('kind', self::KIND)->where('status', 'RUNNING')->lockForUpdate()->exists()) {
                throw new AssignmentRuleViolation('Masih ada forecast yang sedang berjalan; tunggu sampai selesai.');
            }
            DB::table('forecast_runs')->insert(['id' => $id, 'kind' => self::KIND, 'status' => 'RUNNING', 'started_by' => $actor->getKey(), 'started_at' => now(), 'assumptions' => self::ASSUMPTIONS, 'created_at' => now(), 'updated_at' => now()]);
        });
        if (config('distriva.forecast.detach')) {
            $cmd = sprintf('nohup %s artisan distriva:forecast-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($id));
            SymfonyProcess::fromShellCommandline($cmd, base_path())->run();
        }

        return $id;
    }

    /** Runs a registered forecast to its end (called by the detached process); every failure ends as FAILED with a message. */
    public function execute(string $runId): void
    {
        $run = DB::table('forecast_runs')->where('id', $runId)->where('status', 'RUNNING')->first();
        if ($run === null) {
            return;
        }
        $dir = storage_path('app/forecast/'.$runId);
        try {
            File::makeDirectory($dir, 0700, true);
            $this->export($dir);
            $result = $this->callPython($dir);
            $this->store($runId, $result);
        } catch (Throwable $e) {
            DB::table('forecast_runs')->where('id', $runId)->update(['status' => 'FAILED', 'error' => Str::limit($e->getMessage(), 1500, '…'), 'finished_at' => now(), 'updated_at' => now()]);
        } finally {
            File::deleteDirectory($dir);
        }
    }

    /** Writes readings.csv and substations.csv (no names, addresses or customer data: only numbers). */
    public function export(string $dir): void
    {
        $fh = fopen("{$dir}/readings.csv", 'w');
        fputcsv($fh, ['substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v']);
        foreach (DB::table('substation_readings')->whereNotNull('load_kva')->orderBy('substation_id')->orderBy('measured_on')->select('substation_id', 'measured_on', 'load_kva', 'capacity_kva', 'end_voltage_v')->cursor() as $r) {
            fputcsv($fh, [$r->substation_id, substr((string) $r->measured_on, 0, 10), $r->load_kva, $r->capacity_kva, $r->end_voltage_v]);
        }
        fclose($fh);
        $fh = fopen("{$dir}/substations.csv", 'w');
        fputcsv($fh, ['substation_id', 'unit_id', 'capacity_kva', 'transformer_count', 'customers', 'contracted_kva']);
        $customers = DB::table('customer_connections')->where('status', 'AKTIF')->whereNotNull('substation_id')->groupBy('substation_id')->selectRaw('substation_id, count(*) as n, sum(power_va) / 1000.0 as kva');
        foreach (DB::table('substations as s')->leftJoinSub($customers, 'c', 'c.substation_id', '=', 's.id')->select('s.id', 's.organizational_unit_id', 's.capacity_kva', 's.transformer_count', 'c.n', 'c.kva')->cursor() as $s) {
            fputcsv($fh, [$s->id, $s->organizational_unit_id, $s->capacity_kva, $s->transformer_count, $s->n, $s->kva === null ? null : round((float) $s->kva, 3)]);
        }
        fclose($fh);
    }

    /** @return array<string,mixed> */
    private function callPython(string $dir): array
    {
        $root = base_path('..').'/tools/forecast';
        $python = config('distriva.forecast.python') ?: "{$root}/.venv/bin/python";
        $script = config('distriva.forecast.script') ?: "{$root}/run_gardu_load.py";
        if (! is_executable($python) || ! is_file($script)) {
            throw new AssignmentRuleViolation('Layanan forecast belum terpasang di server ini (tools/forecast dan PyTorch).');
        }
        $result = Process::path(dirname($script))->timeout((int) config('distriva.forecast.timeout_seconds'))->env(['OMP_NUM_THREADS' => (string) config('distriva.forecast.threads')])->run([
            $python, $script, '--readings', "{$dir}/readings.csv", '--substations', "{$dir}/substations.csv", '--out', "{$dir}/result.json",
            '--seeds', (string) config('distriva.forecast.seeds'), '--threads', (string) config('distriva.forecast.threads'),
        ]);
        if (! $result->successful() || ! is_file("{$dir}/result.json")) {
            $line = collect(preg_split('/\R/', trim($result->errorOutput())))->filter()->last();
            throw new AssignmentRuleViolation('Forecast gagal: '.($line ?: 'proses berhenti tanpa pesan.'));
        }

        return json_decode((string) file_get_contents("{$dir}/result.json"), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @param array<string,mixed> $result */
    public function store(string $runId, array $result): void
    {
        DB::transaction(function () use ($runId, $result): void {
            $units = DB::table('substations')->whereIn('id', array_column($result['results'], 'substation_id'))->pluck('organizational_unit_id', 'id')->all();
            $rows = [];
            foreach ($result['results'] as $r) {
                if (! isset($units[$r['substation_id']])) {
                    continue;
                }
                $row = ['run_id' => $runId, 'substation_id' => $r['substation_id'], 'unit_id' => $units[$r['substation_id']], 'capacity_kva' => $r['capacity_kva'], 'last_reading_on' => $r['last_reading_on'],
                    'last_ratio' => $r['last_ratio'], 'history_readings' => $r['history_readings'], 'stale' => (bool) $r['stale'],
                    'exceed80_state' => $r['exceed_80']['state'], 'exceed80_on' => $r['exceed_80']['date'], 'exceed100_state' => $r['exceed_100']['state'], 'exceed100_on' => $r['exceed_100']['date']];
                foreach ([1, 3, 5] as $y) {
                    foreach (['p10', 'p50', 'p90'] as $q) {
                        $row["h{$y}_{$q}"] = $r['horizons'][(string) $y][$q];
                    }
                }
                $rows[] = $row;
                if (count($rows) === 500) {
                    DB::table('forecast_gardu_results')->insert($rows);
                    $rows = [];
                }
            }
            $rows !== [] && DB::table('forecast_gardu_results')->insert($rows);
            DB::table('forecast_runs')->where('id', $runId)->update(['status' => 'SUCCEEDED', 'finished_at' => now(), 'data_cutoff' => $result['window']['last_reading'], 'model' => json_encode($result['model']),
                'data_window' => json_encode($result['window']), 'counts' => json_encode($result['counts'] + ['seconds' => $result['seconds'] ?? null]), 'metrics' => json_encode($result['metrics']), 'updated_at' => now()]);
        });
    }

    public function review(string $runId, string $note, User $actor): void
    {
        DB::transaction(function () use ($runId, $note, $actor): void {
            $run = DB::table('forecast_runs')->where('id', $runId)->lockForUpdate()->first() ?? throw new AssignmentRuleViolation('Forecast tidak ditemukan.');
            if ($run->status !== 'SUCCEEDED') {
                throw new AssignmentRuleViolation('Hanya forecast yang berhasil yang dapat ditelaah.');
            }
            if ($run->review_status === 'REVIEWED') {
                throw new AssignmentRuleViolation('Forecast ini sudah ditelaah.');
            }
            if ($run->started_by === (string) $actor->getKey()) {
                throw new AssignmentRuleViolation('Penelaah tidak boleh orang yang menjalankan forecast.');
            }
            DB::table('forecast_runs')->where('id', $runId)->update(['review_status' => 'REVIEWED', 'reviewed_by' => $actor->getKey(), 'reviewed_at' => now(), 'review_note' => trim($note) === '' ? null : trim($note), 'updated_at' => now()]);
        });
    }
}
