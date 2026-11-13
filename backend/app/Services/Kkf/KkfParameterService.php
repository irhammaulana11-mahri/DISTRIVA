<?php

namespace App\Services\Kkf;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * KKF parameter sets (docs/62 §25): versioned discount rate, BPP, O&M, load factor, ROE, interest, tax, horizon, payback limit.
 * DRAFT (editable) -> APPROVED by a different user (also a CHECK) -> INACTIVE; approved values are immutable (trigger); a new approved
 * set closes the previous one. Rates are fractions (0.0778 = 7.78 %). Callers authorize the actor first.
 */
class KkfParameterService
{
    /** Owner decisions: 2026-11-07 discount rate and BPP; 2026-11-09 load factor 0.8 (KAJIAN sheet). BPP is meant to be changed in a new parameter set whenever it changes. The rest from the KKF workbook. */
    public const DEFAULTS = [
        'discount_rate' => 0.0778, 'bpp' => 552, 'om_rate' => 0.02, 'load_factor' => 0.8, 'roe' => 0.0047,
        'interest_rate' => 0.0778, 'tax_rate' => 0.25, 'horizon_years' => 25, 'payback_limit_months' => 60,
    ];

    public const FIELDS = ['discount_rate', 'bpp', 'om_rate', 'load_factor', 'roe', 'interest_rate', 'tax_rate', 'horizon_years', 'payback_limit_months'];

    /** @param array<string,mixed> $data */
    public function create(array $data, User $actor): string
    {
        $values = array_merge(self::DEFAULTS, array_intersect_key($data, array_flip(self::FIELDS)));
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $data, $values, $actor): void {
            DB::table('kkf_parameter_sets')->insert(['id' => $id, 'name' => trim($data['name']), 'valid_from' => $data['valid_from'], 'status' => 'DRAFT', 'notes' => $data['notes'] ?? null,
                'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()] + $values);
            $this->event($id, 'CREATED', $actor, $data['reason'] ?? null, $values);
        });

        return $id;
    }

    /** @param array<string,mixed> $data */
    public function updateDraft(string $id, array $data, User $actor): void
    {
        DB::transaction(function () use ($id, $data, $actor): void {
            $s = DB::table('kkf_parameter_sets')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($s, 'diubah');
            $changes = array_intersect_key($data, array_flip([...self::FIELDS, 'name', 'valid_from', 'notes']));
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan.');
            }
            DB::table('kkf_parameter_sets')->where('id', $id)->update($changes + ['updated_at' => now()]);
            $this->event($id, 'DRAFT_UPDATED', $actor, $data['reason'] ?? null, $changes);
        });
    }

    /** @param list<string> $ids @return array{approved:int,auto_closed:int} */
    public function approve(array $ids, User $actor, string $reason): array
    {
        try {
            return DB::transaction(function () use ($ids, $actor, $reason): array {
                $sets = DB::table('kkf_parameter_sets')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($sets->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian set parameter tidak ditemukan.');
                }
                foreach ($sets as $s) {
                    $this->requireDraft($s, 'disetujui');
                    if ($s->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat set parameter tidak dapat menyetujuinya sendiri.', 403);
                    }
                }
                $closed = 0;
                foreach ($sets as $s) {
                    $from = CarbonImmutable::parse($s->valid_from);
                    $current = DB::table('kkf_parameter_sets')->where('status', 'APPROVED')->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();
                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Set parameter baru harus berlaku setelah \"{$old->name}\" yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('kkf_parameter_sets')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan set parameter yang lebih baru.', ['closed_by' => $s->id]);
                        $closed++;
                    }
                    DB::table('kkf_parameter_sets')->where('id', $s->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($s->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $sets->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan set parameter aktif lain.', 0, $e),
                '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas set parameter.', 0, $e),
                default => $e,
            };
        }
    }

    public function retire(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $s = DB::table('kkf_parameter_sets')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($s->status !== 'APPROVED') {
                throw new AssignmentRuleViolation('Hanya set parameter yang disetujui yang dapat dinonaktifkan.');
            }
            $until = $s->valid_until !== null ? CarbonImmutable::parse($s->valid_until) : null;
            DB::table('kkf_parameter_sets')->where('id', $id)->update(['status' => 'INACTIVE', 'valid_until' => $until?->toDateString() ?? max(CarbonImmutable::today()->toDateString(), $s->valid_from), 'updated_at' => now()]);
            $this->event($id, 'RETIRED', $actor, $reason, null);
        });
    }

    /** The APPROVED set in force on a date (null if none). */
    public function resolve(string $date): ?object
    {
        return DB::table('kkf_parameter_sets')->where('status', 'APPROVED')->where('valid_from', '<=', $date)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $date))->first();
    }

    private function requireDraft(object $s, string $verb): void
    {
        if ($s->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Hanya set parameter berstatus DRAFT yang dapat {$verb}.");
        }
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $id, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('kkf_parameter_events')->insert(['id' => (string) Str::uuid(), 'parameter_set_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
