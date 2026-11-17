<?php

namespace App\Services\Kko;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Kkf\KkfParameterService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * KKO (docs/62 §51, owner 2026-11-09): technical study of one application, from the SURVEY result.
 * - Transformer loading: before = measured load / capacity; after = (measured load + added power x load factor) / capacity. Classes: <= 40 % UNDERLOAD, > 40 to 80 % NORMAL,
 *   > 80 to 100 % OVERLOAD, > 100 % OVERBLAST. A dedicated transformer proposed for a new connection of 53 kVA or more is not loaded on the PLN transformer (no loading computed).
 * - Voltage at the location: shown as information; flagged `voltage_low` when it is below 198 V = 220 V minus the 10 % tolerance (owner 2026-11-16; a new load lowers it further).
 * - TEKNIK decides LAYAK / TIDAK LAYAK (TIDAK LAYAK needs the reason; an improvement proposal is optional). The study NEVER blocks the flow: nothing else reads the decision.
 * The load factor comes from the request or the active KKF parameter set (default 0.8). Every change is an append-only event with a snapshot.
 */
class KkoService
{
    public const UNDERLOAD_MAX = 40.0;

    public const NORMAL_MAX = 80.0;

    public const OVERLOAD_MAX = 100.0;

    /** 220 V nominal - 10 % tolerance (owner 2026-11-16): below this the voltage at the location is low. */
    public const MIN_VOLTAGE = 198.0;

    public const DEDICATED_FROM_KVA = 53.0;

    public static function classify(float $pct): string
    {
        return match (true) {
            $pct <= self::UNDERLOAD_MAX => 'UNDERLOAD',
            $pct <= self::NORMAL_MAX => 'NORMAL',
            $pct <= self::OVERLOAD_MAX => 'OVERLOAD',
            default => 'OVERBLAST',
        };
    }

    /** @return array{r:?float,s:?float,t:?float} */
    private static function phases(mixed $v): array
    {
        $n = fn ($x) => ($x === null || $x === '' || ! is_numeric($x)) ? null : (float) $x;

        return ['r' => $n($v['r'] ?? null), 's' => $n($v['s'] ?? null), 't' => $n($v['t'] ?? null)];
    }

    /** Mean absolute deviation / mean of the three phase currents, in %; null unless all three are known and the mean is positive. */
    public static function imbalance(array $p): ?float
    {
        if (in_array(null, [$p['r'], $p['s'], $p['t']], true)) {
            return null;
        }
        $mean = ($p['r'] + $p['s'] + $p['t']) / 3;

        return $mean <= 0 ? null : round((abs($p['r'] - $mean) + abs($p['s'] - $mean) + abs($p['t'] - $mean)) / 3 / $mean * 100, 2);
    }

    /**
     * The numbers of the paper KKO from the per-phase data (docs/82 §12): the transformer loading is 3 x V x Imax / kVA with V the base voltage of the phase that carries the largest current (230 V when unknown);
     * "after operation" adds the planned phase currents. Returns {before, after} each {max_a, load_kva, loading_pct, imbalance_pct, loads}; null parts when the data is missing.
     *
     * @param  array<string,mixed>  $pd
     * @return array{before:?array<string,mixed>,after:?array<string,mixed>}
     */
    public static function phaseResult(array $pd, ?float $capacity): array
    {
        $base = self::phases($pd['base_voltage'] ?? []);
        $at = function (array $loads) use ($base, $capacity): ?array {
            if (in_array(null, [$loads['r'], $loads['s'], $loads['t']], true)) {
                return null;
            }
            $max = max($loads);
            $phase = array_search($max, $loads, true);
            $v = $base[$phase] ?? null;
            $v ??= ($known = array_filter($base, fn ($x) => $x !== null)) === [] ? 230.0 : array_sum($known) / count($known);
            $kva = 3 * $v * $max / 1000;

            return ['loads' => $loads, 'max_a' => $max, 'voltage_ref_v' => round($v, 1), 'load_kva' => round($kva, 2), 'loading_pct' => $capacity ? round($kva / $capacity * 100, 2) : null, 'imbalance_pct' => self::imbalance($loads)];
        };
        $before = self::phases($pd['load'] ?? []);
        $added = self::phases($pd['added'] ?? []);
        $after = ['r' => null, 's' => null, 't' => null];
        if (! in_array(null, $before, true)) {
            foreach (['r', 's', 't'] as $k) {
                $after[$k] = $before[$k] + ($added[$k] ?? 0.0);
            }
        }

        return ['before' => $at($before), 'after' => $at($after)];
    }

    /** What the system suggests for the added phase current of the application (docs/82 §12): a 1-phase connection goes on the lightest phase, a 3-phase one is shared; amps = VA / 230 V per phase. @return array{r:?float,s:?float,t:?float} */
    public static function suggestAdded(?float $addedKva, bool $threePhase, array $loads): array
    {
        $out = ['r' => 0.0, 's' => 0.0, 't' => 0.0];
        if ($addedKva === null || $addedKva <= 0) {
            return $out;
        }
        $amps = $addedKva * 1000 / 230;
        if ($threePhase) {
            return ['r' => round($amps / 3, 1), 's' => round($amps / 3, 1), 't' => round($amps / 3, 1)];
        }
        $known = array_filter($loads, fn ($x) => $x !== null);
        $lightest = $known === [] ? 'r' : array_search(min($known), $known, true);
        $out[$lightest] = round($amps, 1);

        return $out;
    }

    /** The study of an application: the stored record (null before it is recorded), its status and the application's context. @return array<string,mixed> */
    public function show(string $applicationId): array
    {
        $app = $this->application($applicationId);
        $row = DB::table('application_kko as k')->leftJoin('users as d', 'd.id', '=', 'k.decided_by')->join('users as r', 'r.id', '=', 'k.recorded_by')->where('k.application_id', $applicationId)
            ->first(['k.*', 'd.name as decided_by_name', 'r.name as recorded_by_name']);
        $context = $this->context($app);

        return ['application_id' => $applicationId, 'status' => $row === null ? 'NOT_RECORDED' : ($row->decision ?? 'RECORDED'), 'context' => $context,
            'record' => $row === null ? null : $this->present($row), 'events' => $row === null ? [] : $this->events($row->id)];
    }

    /** Records (or replaces) the survey result. A recorded decision is reset (event DECISION_RESET) because the data it judged changed. @param array<string,mixed> $in @return array<string,mixed> */
    public function record(string $applicationId, array $in, User $actor): array
    {
        $app = $this->application($applicationId);
        $context = $this->context($app);
        $dedicated = (bool) ($in['dedicated_transformer'] ?? false);
        if ($dedicated && empty($in['dedicated_transformer_kva'])) {
            throw new AssignmentRuleViolation('Kapasitas trafo khusus yang diusulkan wajib diisi.');
        }
        $capacity = $in['transformer_capacity_kva'] ?? null;
        $load = $in['measured_load_kva'] ?? null;
        $factor = (float) ($in['load_factor'] ?? $context['load_factor_default']);
        $added = $context['added_power_kva'];
        $before = $after = null;
        if (! $dedicated && $capacity !== null && $load !== null) {
            $before = round((float) $load / (float) $capacity * 100, 2);
            $after = round(((float) $load + ($added ?? 0.0) * $factor) / (float) $capacity * 100, 2);
        }
        $voltage = $in['voltage_location_v'] ?? null;
        $pd = isset($in['phase_detail']) && is_array($in['phase_detail']) ? $in['phase_detail'] : null;
        if ($pd !== null) {                                   // the per-phase form of the paper KKO decides the loading and the voltage at the location
            $res = self::phaseResult($pd, $capacity === null ? null : (float) $capacity);
            if ($res['before'] !== null && ! $dedicated) {
                $load = $res['before']['load_kva'];
                if ($capacity !== null) {
                    $before = $res['before']['loading_pct'];
                    $after = $res['after']['loading_pct'];
                }
            }
            $existing = array_filter(self::phases($pd['existing_voltage'] ?? []), fn ($x) => $x !== null);
            if ($existing !== []) {
                $voltage = min($existing);
            }
        }
        $values = ['substation_id' => $in['substation_id'] ?? null, 'substation_code' => $this->text($in['substation_code'] ?? null), 'substation_name' => $this->text($in['substation_name'] ?? null), 'transformer_capacity_kva' => $capacity, 'measured_load_kva' => $load,
            'measured_at' => $in['measured_at'] ?? null, 'voltage_location_v' => $voltage, 'dedicated_transformer' => $dedicated, 'dedicated_transformer_kva' => $dedicated ? $in['dedicated_transformer_kva'] : null,
            'added_power_kva' => $added, 'load_factor' => $factor, 'loading_before_pct' => $before, 'loading_after_pct' => $after, 'class_before' => $before === null ? null : self::classify($before),
            'class_after' => $after === null ? null : self::classify($after), 'voltage_low' => $voltage === null ? null : (float) $voltage < self::MIN_VOLTAGE,
            'phase_detail' => $pd === null ? null : json_encode($pd)];

        return DB::transaction(function () use ($applicationId, $values, $actor): array {
            $existing = DB::table('application_kko')->where('application_id', $applicationId)->lockForUpdate()->first();
            if ($existing === null) {
                $id = (string) Str::uuid();
                DB::table('application_kko')->insert(['id' => $id, 'application_id' => $applicationId, 'recorded_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()] + $values);
            } else {
                $id = $existing->id;
                $reset = $existing->decision !== null;
                DB::table('application_kko')->where('id', $id)->update($values + ['recorded_by' => $actor->getKey(), 'updated_at' => now()]
                    + ($reset ? ['decision' => null, 'decision_notes' => null, 'improvement_proposal' => null, 'decided_by' => null, 'decided_at' => null] : []));
                if ($reset) {
                    $this->event($id, 'DECISION_RESET', $actor, ['previous_decision' => $existing->decision, 'previous_notes' => $existing->decision_notes, 'previous_improvement_proposal' => $existing->improvement_proposal]);
                }
            }
            $this->event($id, 'RECORDED', $actor, $values);

            return $this->show($applicationId);
        });
    }

    /** TEKNIK's decision. TIDAK_LAYAK needs the reason; the improvement proposal is optional. @return array<string,mixed> */
    public function decide(string $applicationId, string $decision, ?string $notes, ?string $improvement, User $actor): array
    {
        $this->application($applicationId);
        $notes = $this->text($notes);
        if ($decision === 'TIDAK_LAYAK' && $notes === null) {
            throw new AssignmentRuleViolation('Alasan wajib diisi untuk keputusan TIDAK LAYAK.');
        }

        return DB::transaction(function () use ($applicationId, $decision, $notes, $improvement, $actor): array {
            $row = DB::table('application_kko')->where('application_id', $applicationId)->lockForUpdate()->first()
                ?? throw new AssignmentRuleViolation('Hasil survei KKO belum dicatat; catat dulu sebelum memutuskan.');
            if ($row->decision !== null) {            // final: a new decision needs a new record of the survey result (which resets this one and keeps it in the history)
                throw new AssignmentRuleViolation('Keputusan KKO sudah ada ('.$row->decision.'); catat ulang hasil survei bila datanya berubah untuk membuka keputusan baru.');
            }
            $values = ['decision' => $decision, 'decision_notes' => $notes, 'improvement_proposal' => $this->text($improvement), 'decided_by' => $actor->getKey(), 'decided_at' => now(), 'updated_at' => now()];
            DB::table('application_kko')->where('id', $row->id)->update($values);
            $this->event($row->id, 'DECIDED', $actor, ['decision' => $decision, 'decision_notes' => $notes, 'improvement_proposal' => $values['improvement_proposal']]);

            return $this->show($applicationId);
        });
    }

    /** @return array<string,mixed> */
    private function context(object $app): array
    {
        $params = app(KkfParameterService::class)->resolve(CarbonImmutable::today()->toDateString());
        $newKva = $app->new_power_value === null ? null : (float) $app->new_power_value * (strtoupper((string) $app->new_power_unit) === 'KVA' ? 1 : 0.001);
        $isNew = $app->application_type === 'PB';

        return ['application_number' => $app->application_number, 'application_type' => $app->application_type, 'added_power_kva' => $app->delta_power_kva === null ? null : (float) $app->delta_power_kva,
            'new_power_kva' => $newKva, 'load_factor_default' => $params === null ? (float) KkfParameterService::DEFAULTS['load_factor'] : (float) $params->load_factor,
            'dedicated_expected' => $isNew && $newKva !== null && $newKva >= self::DEDICATED_FROM_KVA,
            'thresholds' => ['underload_max' => self::UNDERLOAD_MAX, 'normal_max' => self::NORMAL_MAX, 'overload_max' => self::OVERLOAD_MAX, 'min_voltage_v' => self::MIN_VOLTAGE]];
    }

    private function application(string $id): object
    {
        return DB::table('applications')->where('id', $id)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function text(mixed $v): ?string
    {
        $v = trim((string) $v);

        return $v === '' ? null : mb_substr($v, 0, 4000);
    }

    /** @return array<string,mixed> */
    private function present(object $k): array
    {
        $num = fn ($v) => $v === null ? null : (float) $v;

        return ['id' => $k->id, 'substation_id' => $k->substation_id ?? null, 'substation_code' => $k->substation_code, 'substation_name' => $k->substation_name, 'transformer_capacity_kva' => $num($k->transformer_capacity_kva), 'measured_load_kva' => $num($k->measured_load_kva),
            'measured_at' => $k->measured_at, 'voltage_location_v' => $num($k->voltage_location_v), 'dedicated_transformer' => (bool) $k->dedicated_transformer, 'dedicated_transformer_kva' => $num($k->dedicated_transformer_kva),
            'added_power_kva' => $num($k->added_power_kva), 'load_factor' => $num($k->load_factor), 'loading_before_pct' => $num($k->loading_before_pct), 'loading_after_pct' => $num($k->loading_after_pct),
            'class_before' => $k->class_before, 'class_after' => $k->class_after, 'voltage_low' => $k->voltage_low === null ? null : (bool) $k->voltage_low, 'decision' => $k->decision, 'decision_notes' => $k->decision_notes,
            'phase_detail' => ($pd = json_decode((string) ($k->phase_detail ?? ''), true)) ?: null, 'phase_result' => $pd === null ? null : self::phaseResult($pd, $num($k->transformer_capacity_kva)),
            'improvement_proposal' => $k->improvement_proposal, 'decided_by_name' => $k->decided_by_name, 'decided_at' => $k->decided_at, 'recorded_by_name' => $k->recorded_by_name, 'updated_at' => $k->updated_at];
    }

    /** @return list<array<string,mixed>> */
    private function events(string $kkoId): array
    {
        return DB::table('application_kko_events as e')->join('users as u', 'u.id', '=', 'e.actor_id')->where('e.kko_id', $kkoId)->orderByDesc('e.created_at')->limit(50)
            ->get(['e.action', 'e.created_at', 'u.name as actor_name'])->map(fn ($e) => ['action' => $e->action, 'created_at' => $e->created_at, 'actor_name' => $e->actor_name])->all();
    }

    /** @param array<string,mixed> $snapshot */
    private function event(string $kkoId, string $action, User $actor, array $snapshot): void
    {
        DB::table('application_kko_events')->insert(['id' => (string) Str::uuid(), 'kko_id' => $kkoId, 'action' => $action, 'actor_id' => $actor->getKey(), 'snapshot' => json_encode($snapshot), 'created_at' => now()]);
    }
}
