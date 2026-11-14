<?php

namespace App\Services\Applications;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Manual PB/PD applications (stage 1A). Writes only; callers authorize the actor first (ApplicationAuthorizer).
 * Rules (docs/16, docs/24): PB treats the old power as zero, PD uses new - old; power keeps its source unit (VA|kVA) and the
 * delta is derived in kVA; the customer phone is mandatory before submit; IDPEL belongs to the customer, No. Agenda /
 * No. Register to the application (history kept, nothing overwritten); every status change is appended to the history.
 */
class ApplicationService
{
    private const FIELDS = ['transaction_type', 'service_address', 'old_tariff_code', 'new_tariff_code', 'old_power_value', 'old_power_unit', 'new_power_value', 'new_power_unit',
        'sar_package', 'total_cost', 'service_criteria', 'requires_drawing', 'requires_feasibility_study', 'requires_network_extension'];

    /**
     * @param  array<string,mixed>  $data  validated request
     * @return string application id
     */
    public function create(array $data, User $actor): string
    {
        try {
            return DB::transaction(function () use ($data, $actor): string {
                $unit = DB::table('organizational_units')->where('id', $data['organizational_unit_id'])->first();
                if ($unit === null || $unit->unit_type !== 'ULP' || ! $unit->is_active) {
                    throw new AssignmentRuleViolation('Permohonan harus ditujukan ke unit ULP yang aktif.');
                }
                $customerId = $this->resolveCustomer($data, $actor);
                $row = $this->power($data['application_type'], $this->only($data));

                $id = (string) Str::uuid();
                DB::table('applications')->insert($row + [
                    'id' => $id, 'application_number' => $this->nextNumber($unit), 'application_type' => $data['application_type'], 'customer_id' => $customerId,
                    'organizational_unit_id' => $unit->id, 'source_type' => 'MANUAL', 'current_status' => 'DRAFT', 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now(),
                ]);
                $this->history($id, null, 'DRAFT', $actor, 'Draf dibuat.');

                return $id;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** @param array<string,mixed> $data */
    public function update(string $id, array $data, User $actor): void
    {
        try {
            DB::transaction(function () use ($id, $data): void {
                $app = $this->lock($id);
                $changes = $this->only($data);
                if ($app->current_status !== 'DRAFT') {
                    // After the draft only the contact data can be completed (e.g. the phone of an imported application).
                    $contact = array_intersect_key($data['customer'] ?? [], ['phone' => 1, 'email' => 1, 'idpel' => 1]);
                    if (in_array($app->current_status, ['CANCELLED', 'REFUNDED'], true) || $changes !== [] || array_diff_key($data['customer'] ?? [], $contact) !== [] || $contact === []) {
                        throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; hanya nomor telepon, email, dan IDPEL pelanggan yang dapat dilengkapi.");
                    }
                    $this->updateCustomer($app->customer_id, array_diff_key($contact, ['idpel' => 1]));
                    $this->completeIdpel($app->customer_id, $contact['idpel'] ?? null);

                    return;
                }
                if (isset($data['customer'])) {
                    $this->updateCustomer($app->customer_id, array_diff_key($data['customer'], ['idpel' => 1]));
                    $this->completeIdpel($app->customer_id, $data['customer']['idpel'] ?? null);
                }
                if ($changes !== []) {
                    $merged = array_merge((array) $app, $changes);
                    $row = $this->power($app->application_type, $this->only($merged));
                    DB::table('applications')->where('id', $id)->update($row + ['updated_at' => now()]);
                } elseif (! isset($data['customer'])) {
                    throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
                }
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    public function submit(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $app = $this->lock($id);
            $this->requireDraft($app, 'diajukan');
            $customer = DB::table('customers')->where('id', $app->customer_id)->first();
            $missing = [];
            if (blank($customer->phone)) {
                $missing[] = 'nomor telepon pelanggan';
            }
            if (blank($app->service_address)) {
                $missing[] = 'alamat layanan';
            }
            if ($app->new_power_value === null) {
                $missing[] = 'daya baru';
            }
            if (blank($app->transaction_type)) {
                $missing[] = 'jenis transaksi';
            }
            if ($app->application_type === 'PD' && $app->old_power_value === null) {
                $missing[] = 'daya lama (PD)';
            }
            if ($missing !== []) {
                throw new AssignmentRuleViolation('Permohonan belum lengkap; lengkapi: '.implode(', ', $missing).'.');
            }
            DB::table('applications')->where('id', $id)->update(['current_status' => 'SUBMITTED', 'submitted_at' => now(), 'updated_at' => now()]);
            $this->history($id, 'DRAFT', 'SUBMITTED', $actor, 'Diajukan; menunggu No. Agenda, lalu survey.');
        });
    }

    public function cancel(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $app = $this->lock($id);
            if (! in_array($app->current_status, ['DRAFT', 'SUBMITTED', 'APPROVED'], true)) {
                throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; tidak dapat dibatalkan (setelah pembayaran, perubahan status datang dari EIS).");
            }
            DB::table('applications')->where('id', $id)->update(['current_status' => 'CANCELLED', 'updated_at' => now()]);
            $this->history($id, $app->current_status, 'CANCELLED', $actor, trim($reason));
        });
    }

    /** Adds the No. Agenda / No. Register issued by the other system; an earlier active number of the same type is kept as history. */
    public function addExternalReference(string $id, string $type, string $number, User $actor): string
    {
        try {
            return DB::transaction(function () use ($id, $type, $number, $actor): string {
                $app = $this->lock($id);
                if (in_array($app->current_status, ['CANCELLED', 'REFUNDED'], true)) {
                    throw new AssignmentRuleViolation('Permohonan sudah dibatalkan/direstitusi; nomor referensi tidak dapat ditambahkan.');
                }
                $number = trim($number);
                $current = DB::table('application_external_references')->where('application_id', $id)->where('reference_type', $type)->where('is_active', true)->first();
                if ($current !== null && $current->reference_number === $number) {
                    throw new AssignmentRuleViolation('Nomor yang sama sudah tercatat aktif pada permohonan ini.');
                }
                if ($current !== null) {
                    DB::table('application_external_references')->where('id', $current->id)->update(['is_active' => false, 'updated_at' => now()]);
                }
                $refId = (string) Str::uuid();
                DB::table('application_external_references')->insert(['id' => $refId, 'application_id' => $id, 'external_system' => 'AP2T', 'reference_type' => $type, 'reference_number' => $number,
                    'registration_source' => 'MANUAL', 'received_at' => now(), 'received_by' => $actor->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
                // Owner decision 2026-11-06: once the No. Agenda exists the application is "disetujui" (approved, not yet paid).
                if ($type === 'AGENDA' && in_array($app->current_status, ['DRAFT', 'SUBMITTED'], true)) {
                    DB::table('applications')->where('id', $id)->update(['current_status' => 'APPROVED', 'updated_at' => now()]);
                    $this->history($id, $app->current_status, 'APPROVED', $actor, 'No. Agenda diterbitkan: permohonan disetujui, belum dibayar.');
                }

                return $refId;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    public static function normalizePhone(string $raw): ?string
    {
        $p = preg_replace('/[\s().\-]/', '', trim($raw)) ?? '';
        if (str_starts_with($p, '00')) {
            $p = '+'.substr($p, 2);
        } elseif (str_starts_with($p, '0')) {
            $p = '+62'.substr($p, 1);
        } elseif (str_starts_with($p, '62')) {
            $p = '+'.$p;
        } elseif (preg_match('/^8[0-9]{8,11}$/', $p)) {
            $p = '+62'.$p;               // Indonesian mobile number saved without its leading 0 (e.g. by a spreadsheet)
        }

        return preg_match('/^\+[1-9][0-9]{7,14}$/', $p) ? $p : null;
    }

    /** @param array<string,mixed> $data @return string customer id */
    private function resolveCustomer(array $data, User $actor): string
    {
        if (! empty($data['customer_id'])) {
            return DB::table('customers')->where('id', $data['customer_id'])->value('id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $c = $data['customer'] ?? throw new AssignmentRuleViolation('Pelanggan wajib diisi (customer_id atau customer).');
        $idpel = isset($c['idpel']) ? trim((string) $c['idpel']) : null;
        if ($idpel !== null && $idpel !== '' && DB::table('customer_external_references')->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel])->whereNull('valid_until')->exists()) {
            throw new AssignmentRuleViolation('IDPEL sudah terdaftar pada pelanggan lain; pilih pelanggan yang ada (customer_id) atau hubungi administrator untuk rekonsiliasi. Pelanggan tidak digabung otomatis.');
        }
        $id = (string) Str::uuid();
        DB::table('customers')->insert(['id' => $id, 'customer_number' => $this->nextCustomerNumber(), 'name' => $this->tidy($c['name']),
            'phone' => ($c['phone'] ?? null) === null || $c['phone'] === '' ? null : $this->phone((string) $c['phone']), 'email' => $c['email'] ?? null, 'created_at' => now(), 'updated_at' => now()]);
        if ($idpel !== null && $idpel !== '') {
            DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $id, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel, 'is_primary' => true, 'created_at' => now(), 'updated_at' => now()]);
        }

        return $id;
    }

    /**
     * A manually entered customer has no IDPEL at first (owner 8 Nov 2026); it is completed later, once. An IDPEL already on record is never replaced here (a wrong one is a reconciliation
     * for the administrator), and one that belongs to another customer is refused: customers are never merged automatically.
     */
    private function completeIdpel(string $customerId, mixed $idpel): void
    {
        $idpel = $idpel === null ? '' : trim((string) $idpel);
        if ($idpel === '') {
            return;
        }
        $mine = DB::table('customer_external_references')->where(['customer_id' => $customerId, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL'])->whereNull('valid_until')->get();
        if ($mine->contains('reference_value', $idpel)) {
            return;
        }
        if ($mine->isNotEmpty()) {
            throw new AssignmentRuleViolation("Pelanggan ini sudah memiliki IDPEL {$mine->first()->reference_value}; perubahan IDPEL dilakukan administrator lewat rekonsiliasi.");
        }
        if (DB::table('customer_external_references')->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel])->whereNull('valid_until')->exists()) {
            throw new AssignmentRuleViolation('IDPEL sudah terdaftar pada pelanggan lain; pilih pelanggan yang ada (customer_id) atau hubungi administrator untuk rekonsiliasi. Pelanggan tidak digabung otomatis.');
        }
        DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $customerId, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel, 'is_primary' => true, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** @param array<string,mixed> $c */
    private function updateCustomer(string $customerId, array $c): void
    {
        $set = [];
        if (isset($c['name'])) {
            $set['name'] = $this->tidy($c['name']);
        }
        if (array_key_exists('phone', $c)) {
            $set['phone'] = $c['phone'] === null || $c['phone'] === '' ? null : $this->phone((string) $c['phone']);
        }
        if (array_key_exists('email', $c)) {
            $set['email'] = $c['email'] === '' ? null : $c['email'];
        }
        if ($set !== []) {
            DB::table('customers')->where('id', $customerId)->update($set + ['updated_at' => now()]);
        }
        $idpel = isset($c['idpel']) ? trim((string) $c['idpel']) : '';
        if ($idpel !== '') {
            $existing = DB::table('customer_external_references')->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel])->whereNull('valid_until')->first();
            if ($existing !== null && $existing->customer_id !== $customerId) {
                throw new AssignmentRuleViolation('IDPEL sudah terdaftar pada pelanggan lain; rekonsiliasi dilakukan administrator, tidak digabung otomatis.');
            }
            if ($existing === null) {
                DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $customerId, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $idpel,
                    'is_primary' => ! DB::table('customer_external_references')->where('customer_id', $customerId)->exists(), 'created_at' => now(), 'updated_at' => now()]);
            }
        }
    }

    private function phone(string $raw): string
    {
        return self::normalizePhone($raw) ?? throw new AssignmentRuleViolation('Nomor telepon tidak valid (gunakan format 08xx…, 62xx… atau +62xx…).');
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function only(array $data): array
    {
        $out = [];
        foreach (self::FIELDS as $f) {
            if (array_key_exists($f, $data)) {
                $out[$f] = $data[$f];
            }
        }

        return $out;
    }

    /**
     * Derives delta_power_kva (PB: old = 0; PD: new - old) from values WITH their units; never guesses a unit.
     *
     * @param  array<string,mixed>  $row
     * @return array<string,mixed>
     */
    private function power(string $type, array $row): array
    {
        $kva = function (?string $value, ?string $unit): ?float {
            if ($value === null || $value === '') {
                return null;
            }

            return (float) $value / ($unit === 'VA' ? 1000 : 1);
        };
        if ($type === 'PB') {
            $row['old_power_value'] = null;
            $row['old_power_unit'] = null;
            $row['old_tariff_code'] = null;
        }
        $new = $kva(isset($row['new_power_value']) ? (string) $row['new_power_value'] : null, $row['new_power_unit'] ?? null);
        $old = $kva(isset($row['old_power_value']) ? (string) $row['old_power_value'] : null, $row['old_power_unit'] ?? null);
        $row['delta_power_kva'] = $new === null ? null : round($new - ($old ?? 0.0), 3);
        if ($type === 'PD' && $row['delta_power_kva'] !== null && $old === null) {
            $row['delta_power_kva'] = null;   // PD needs both values before a delta exists
        }
        foreach (['old_power_value', 'new_power_value', 'total_cost'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] === '') {
                $row[$k] = null;
            }
        }

        return $row;
    }

    /**
     * Creates an application from an imported source row (stage 1B). The caller has authorized the actor and validated the row.
     *
     * @param  array<string,mixed>  $fields  FIELDS columns (+ source_created_at)
     */
    public function createImported(object $unit, string $customerId, string $type, array $fields, string $status, ?string $sourceReferenceId, User $actor, string $reason): string
    {
        $id = (string) Str::uuid();
        $row = $this->power($type, $fields);
        $extra = array_intersect_key($fields, ['source_created_at' => 1, 'paid_at' => 1]);
        DB::table('applications')->insert($row + $extra + [
            'id' => $id, 'application_number' => $this->nextNumber($unit), 'application_type' => $type, 'customer_id' => $customerId, 'organizational_unit_id' => $unit->id,
            'source_type' => 'BOT_DAFTUNG', 'source_reference_id' => $sourceReferenceId, 'imported_at' => now(), 'current_status' => $status, 'created_by' => $actor->getKey(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->history($id, null, $status, $actor, $reason);

        return $id;
    }

    public function recordStatus(string $id, ?string $from, string $to, User $actor, ?string $reason): void
    {
        $this->history($id, $from, $to, $actor, $reason);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    public function derivePower(string $type, array $row): array
    {
        return $this->power($type, $row);
    }

    public function newCustomerNumber(): string
    {
        return $this->nextCustomerNumber();
    }

    private function nextNumber(object $unit): string
    {
        $year = (int) now(config('distriva.business_timezone'))->format('Y');
        DB::statement('INSERT INTO application_number_sequences (organizational_unit_id, year, last_number) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', [$unit->id, $year]);
        $n = DB::table('application_number_sequences')->where('organizational_unit_id', $unit->id)->where('year', $year)->lockForUpdate()->value('last_number') + 1;
        DB::table('application_number_sequences')->where('organizational_unit_id', $unit->id)->where('year', $year)->update(['last_number' => $n]);

        return sprintf('PBPD-%s-%d-%05d', $unit->code, $year, $n);
    }

    private function nextCustomerNumber(): string
    {
        do {
            $n = 'CUST-'.strtoupper(Str::random(10));
        } while (DB::table('customers')->where('customer_number', $n)->exists());

        return $n;
    }

    private function lock(string $id): object
    {
        return DB::table('applications')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function requireDraft(object $app, string $verb = 'diubah'): void
    {
        if ($app->current_status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; hanya DRAFT yang dapat {$verb}.");
        }
    }

    private function history(string $id, ?string $from, string $to, User $actor, ?string $reason): void
    {
        DB::table('application_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $id, 'from_status' => $from, 'to_status' => $to,
            'changed_by' => $actor->getKey(), 'changed_at' => now(), 'reason' => $reason]);
    }

    private function tidy(string $s): string
    {
        return trim(preg_replace('/\s+/u', ' ', $s) ?? $s);
    }

    private function translate(QueryException $e): \Throwable
    {
        return match ($e->getCode()) {
            '23505' => new AssignmentRuleViolation('Data bentrok dengan data yang sudah ada (nomor referensi atau IDPEL sudah dipakai).', 0, $e),
            '23514', 'P0001' => new AssignmentRuleViolation('Data melanggar aturan integritas permohonan.', 0, $e),
            default => $e,
        };
    }
}
