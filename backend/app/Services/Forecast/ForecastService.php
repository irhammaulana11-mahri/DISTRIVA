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

    public const DEMAND = 'DEMAND';

    public const KINDS = [self::KIND, self::DEMAND];

    private const STALE_AFTER_HOURS = 3;

    private const ASSUMPTIONS = 'Prakiraan beban gardu dari riwayat pembacaan (model kuantil bersama untuk semua gardu: GRU, LightGBM, atau gabungan keduanya, dipilih dari galat validasi terkecil; skenario tanpa sisipan atau pecah beban sehingga beban tidak turun). Nilai adalah rasio beban kVA terhadap kapasitas trafo '
        .'pada pembacaan terakhir, dengan rentang p10-p90. Tidak memodelkan pemindahan beban, sisip trafo, atau penggantian trafo setelah pembacaan terakhir. Satu pembacaan per gardu per beberapa bulan '
        .'(sebagian besar pembacaan tahunan) membuat prakiraan per gardu bersifat indikatif; gunakan bersama survei lapangan. Rekomendasi, bukan keputusan pengadaan.';

    private const DEMAND_ASSUMPTIONS = 'Prakiraan bulanan 12 bulan ke depan untuk pelanggan baru (permohonan PB), tambahan daya tersambung (kVA, dari permohonan PB dan PD) per ULP, dan pemakaian material '
        .'(pengeluaran MIMS) per ULP dan material. Jaringan saraf GRU kuantil bersama untuk semua deret; setiap deret diskalakan menurut tingkatnya sendiri. Pelanggan dan daya hanya mencakup permohonan yang '
        .'tercatat di DISTRIVA (cakupan impor EIS), bukan seluruh pelanggan. Material adalah pemakaian aktual, bukan kebutuhan pengadaan. Deret yang riwayatnya kurang dari 24 bulan (atau kurang dari 6 bulan '
        .'beraktivitas) tidak diprakirakan. Rentang total 3/6/12 bulan adalah jumlah rentang bulanan, sengaja lebar. Rekomendasi, bukan keputusan pengadaan.';

    /** Registers a run and starts it in a detached process. */
    public function start(User $actor, string $kind = self::KIND, string $trigger = 'MANUAL'): string
    {
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $actor, $kind, $trigger): void {
            DB::table('forecast_runs')->where('kind', $kind)->where('status', 'RUNNING')->where('started_at', '<', now()->subHours(self::STALE_AFTER_HOURS))
                ->update(['status' => 'FAILED', 'error' => 'Run berhenti tanpa hasil (melewati batas waktu).', 'finished_at' => now(), 'updated_at' => now()]);
            if (DB::table('forecast_runs')->where('kind', $kind)->where('status', 'RUNNING')->lockForUpdate()->exists()) {
                throw new AssignmentRuleViolation('Masih ada forecast yang sedang berjalan; tunggu sampai selesai.');
            }
            DB::table('forecast_runs')->insert(['id' => $id, 'kind' => $kind, 'status' => 'RUNNING', 'trigger' => $trigger, 'started_by' => $actor->getKey(), 'started_at' => now(), 'assumptions' => $kind === self::DEMAND ? self::DEMAND_ASSUMPTIONS : self::ASSUMPTIONS, 'created_at' => now(), 'updated_at' => now()]);
        });
        if (config('distriva.forecast.detach')) {
            $cmd = sprintf('nohup %s artisan distriva:forecast-execute %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($id));
            SymfonyProcess::fromShellCommandline($cmd, base_path())->run();
        }

        return $id;
    }

    /** @return array{auto_enabled: bool, day_of_month: int, run_time: string, updated_by_name: ?string, updated_at: ?string, last_auto: array<string, ?string>} */
    public function schedule(): array
    {
        $s = DB::table('forecast_settings as f')->leftJoin('users as u', 'u.id', '=', 'f.updated_by')->where('f.id', 1)->first(['f.*', 'u.name as updated_by_name']);
        $last = [];
        foreach (self::KINDS as $kind) {
            $last[$kind] = DB::table('forecast_runs')->where('kind', $kind)->where('trigger', 'AUTO')->max('started_at');
        }

        return ['auto_enabled' => (bool) $s->auto_enabled, 'day_of_month' => (int) $s->day_of_month, 'run_time' => $s->run_time, 'updated_by_name' => $s->updated_by_name, 'updated_at' => $s->updated_at, 'last_auto' => $last];
    }

    public function saveSchedule(User $actor, bool $enabled, int $day, string $time): void
    {
        DB::table('forecast_settings')->where('id', 1)->update(['auto_enabled' => $enabled, 'day_of_month' => $day, 'run_time' => $time, 'updated_by' => $actor->getKey(), 'updated_at' => now()]);
    }

    /**
     * Called every minute by the scheduler. Once a month, from the chosen day and time, each kind runs once (substation load first, then the demand forecast, never two at once). A run that
     * failed or had too little data still counts for the month: nothing retries in a loop. Returns the started run id.
     */
    public function runScheduledIfDue(): ?string
    {
        $s = DB::table('forecast_settings')->where('id', 1)->first();
        if (! $s->auto_enabled || $s->updated_by === null) {
            return null;
        }
        $now = now(config('distriva.business_timezone'));
        if ($now->day < (int) $s->day_of_month || ($now->day === (int) $s->day_of_month && $now->format('H:i') < $s->run_time)) {
            return null;
        }
        $actor = User::query()->find($s->updated_by);
        if ($actor === null || DB::table('forecast_runs')->where('status', 'RUNNING')->where('started_at', '>=', now()->subHours(self::STALE_AFTER_HOURS))->exists()) {
            return null;
        }
        $monthStart = $now->copy()->startOfMonth()->utc();
        foreach (self::KINDS as $kind) {
            if (DB::table('forecast_runs')->where('kind', $kind)->where('trigger', 'AUTO')->where('started_at', '>=', $monthStart)->exists()) {
                continue;
            }
            try {
                return $this->start($actor, $kind, 'AUTO');
            } catch (AssignmentRuleViolation) {
                return null;
            }
        }

        return null;
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
            if ($run->kind === self::DEMAND) {
                $cutoff = now(config('distriva.business_timezone'))->subMonthNoOverflow()->format('Y-m');                 // the last complete month
                $this->exportDemand($dir, $cutoff);
                $this->storeDemand($runId, $this->callMonthly($dir, $cutoff));
            } else {
                $this->export($dir);
                $this->store($runId, $this->callPython($dir));
            }
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
        return $this->call($dir, 'run_gardu_load.py', config('distriva.forecast.script'), fn (string $script) => ['--readings', "{$dir}/readings.csv", '--substations', "{$dir}/substations.csv"]);
    }

    /** @return array<string,mixed> */
    private function callMonthly(string $dir, string $cutoff): array
    {
        return $this->call($dir, 'run_monthly.py', config('distriva.forecast.monthly_script'), fn (string $script) => ['--series', "{$dir}/series.csv", '--cutoff', $cutoff]);
    }

    /** The Python of the forecast service (configured, or the virtual environment in tools/forecast). */
    public function pythonBinary(): string
    {
        return config('distriva.forecast.python') ?: base_path('..').'/tools/forecast/.venv/bin/python';
    }

    /** @param callable(string):list<string> $args @return array<string,mixed> */
    private function call(string $dir, string $default, ?string $configured, callable $args): array
    {
        $root = base_path('..').'/tools/forecast';
        $python = $this->pythonBinary();
        $script = $configured ?: "{$root}/{$default}";
        if (! is_executable($python) || ! is_file($script)) {
            throw new AssignmentRuleViolation('Layanan forecast belum terpasang di server ini (tools/forecast dan PyTorch).');
        }
        $result = Process::path(dirname($script))->timeout((int) config('distriva.forecast.timeout_seconds'))->env(['OMP_NUM_THREADS' => (string) config('distriva.forecast.threads')])->run([
            $python, $script, ...$args($script), '--out', "{$dir}/result.json",
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

    /**
     * Writes series.csv: complete months only (up to `$cutoff`, YYYY-MM). Customers and kVA per ULP come from the applications recorded in DISTRIVA (not cancelled, refunded or draft), by request month;
     * material consumption per ULP and material comes from the MIMS issues (one reservation counted once, in the month of its first document).
     */
    public function exportDemand(string $dir, string $cutoff): void
    {
        $tz = (string) config('distriva.business_timezone');
        $fh = fopen("{$dir}/series.csv", 'w');
        fputcsv($fh, ['series_id', 'kind', 'unit_id', 'item_code', 'item_label', 'month', 'value']);
        $month = "to_char(coalesce(a.source_created_at, a.created_at) at time zone '{$tz}', 'YYYY-MM')";
        $apps = DB::table('applications as a')->whereNotIn('a.current_status', ['DRAFT', 'CANCELLED', 'REFUNDED'])->whereRaw("{$month} <= ?", [$cutoff])->groupBy('a.organizational_unit_id', DB::raw($month))
            ->selectRaw("a.organizational_unit_id as unit, {$month} as month, sum(case when a.application_type = 'PB' then 1 else 0 end) as customers, sum(greatest(coalesce(a.delta_power_kva, 0), 0)) as kva");
        foreach ($apps->cursor() as $r) {
            fputcsv($fh, ["CUSTOMERS_ADDED|{$r->unit}", 'CUSTOMERS_ADDED', $r->unit, '', 'Pelanggan baru (PB)', $r->month, (int) $r->customers]);
            fputcsv($fh, ["VA_ADDED|{$r->unit}", 'VA_ADDED', $r->unit, '', 'Tambahan daya tersambung (kVA)', $r->month, round((float) $r->kva, 3)]);
        }
        $first = DB::table('mims_issue_documents')->groupBy('warehouse_id', 'reservation_no')->selectRaw('warehouse_id, reservation_no, min(issued_on) as day');
        $issues = DB::table('mims_issue_lines as l')->joinSub($first, 'd', fn ($j) => $j->on('d.warehouse_id', '=', 'l.warehouse_id')->on('d.reservation_no', '=', 'l.reservation_no'))->join('warehouses as w', 'w.id', '=', 'l.warehouse_id')
            ->whereRaw("to_char(d.day, 'YYYY-MM') <= ?", [$cutoff])->groupBy('w.organizational_unit_id', 'l.material_no', DB::raw("to_char(d.day, 'YYYY-MM')"))
            ->selectRaw("w.organizational_unit_id as unit, l.material_no as item, min(l.material_name) as label, to_char(d.day, 'YYYY-MM') as month, sum(l.quantity) as qty");
        foreach ($issues->cursor() as $r) {
            fputcsv($fh, ["MATERIAL_ISSUE|{$r->unit}|{$r->item}", 'MATERIAL_ISSUE', $r->unit, $r->item, $r->label, $r->month, (float) $r->qty]);
        }
        fclose($fh);
    }

    /** @param array<string,mixed> $result */
    public function storeDemand(string $runId, array $result): void
    {
        DB::transaction(function () use ($runId, $result): void {
            $common = ['model' => json_encode($result['model']), 'data_window' => json_encode(['cutoff' => $result['cutoff'], 'coverage' => $result['coverage']]), 'counts' => json_encode($result['counts'] + ['seconds' => $result['seconds'] ?? null]),
                'data_cutoff' => $result['cutoff'].'-01', 'finished_at' => now(), 'updated_at' => now()];
            if ($result['status'] !== 'SUCCEEDED') {
                DB::table('forecast_runs')->where('id', $runId)->update($common + ['status' => 'INSUFFICIENT', 'error' => $result['message'] ?? 'Riwayat data belum cukup.']);

                return;
            }
            $rows = [];
            foreach ($result['results'] as $r) {
                if ($r['unit_id'] === null) {
                    continue;
                }
                $row = ['run_id' => $runId, 'series_id' => $r['series_id'], 'kind' => $r['kind'], 'unit_id' => $r['unit_id'], 'item_code' => $r['item_code'], 'item_label' => $r['item_label'], 'history_months' => $r['history_months'],
                    'last_12_months' => $r['last_12_months'], 'months' => json_encode($r['months'])];
                foreach ([3, 6, 12] as $n) {
                    foreach (['p10', 'p50', 'p90'] as $q) {
                        $row["t{$n}_{$q}"] = $r['totals'][(string) $n][$q];
                    }
                }
                $rows[] = $row;
                if (count($rows) === 500) {
                    DB::table('forecast_series_results')->insert($rows);
                    $rows = [];
                }
            }
            $rows !== [] && DB::table('forecast_series_results')->insert($rows);
            DB::table('forecast_runs')->where('id', $runId)->update($common + ['status' => 'SUCCEEDED', 'metrics' => json_encode($result['metrics'])]);
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
