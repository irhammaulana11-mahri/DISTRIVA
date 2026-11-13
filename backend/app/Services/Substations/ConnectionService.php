<?php

namespace App\Services\Substations;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Master pelanggan (owner 2026-11-12, docs/81): customer connections by IDPEL, linked to ULP, gardu (and so feeder) and the applicant.
 * - The DIL is loaded in batches of chunks (upsert by IDPEL, idempotent). A row without a known / in-scope ULP is rejected; a gardu is linked when gardu_ref equals the GADIS number of a gardu of the same ULP, otherwise
 *   the customer stays unlinked (gardu_ref kept, linked later when that gardu is imported). A MANUAL link is never replaced by a load.
 * - Personal data is not accepted here at all (no NIK, NPWP, phone, e-mail, coordinates): see the migration.
 * - A short gardu code of the DIL (HD127) is read as the master's code with the zeros completed (HD0127) when the GADIS number does not match: only the pattern HD + 1-3 digits, only in the customer's own ULP, source DIL_KODE (owner 2026-11-12).
 * - The KKO of an application links the applicant's IDPEL to the chosen gardu, only when the applicant has exactly one IDPEL (never a guess).
 */
class ConnectionService
{
    private const FIELDS = ['name', 'kelurahan', 'kecamatan', 'kabupaten', 'tariff_code', 'power_va', 'service_type', 'phase_code', 'meter_number', 'energized_on', 'status', 'gardu_ref', 'gardu_code_ref'];

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function startBatch(?string $fileName, ?string $month, User $actor): array
    {
        $id = (string) Str::uuid();
        DB::table('customer_connection_batches')->insert(['id' => $id, 'source' => 'DIL', 'file_name' => $fileName, 'snapshot_month' => $month, 'status' => 'RUNNING', 'counts' => json_encode($this->zero()),
            'initiated_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);

        return $this->batch($id, $actor);
    }

    /** @param list<array<string,mixed>> $items @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function addItems(string $batchId, array $items, array $scope, User $actor): array
    {
        $b = $this->ownBatch($batchId, $actor);
        if ($b->status !== 'RUNNING') {
            throw new AssignmentRuleViolation('Batch ini sudah selesai.');
        }
        $counts = $this->zero();
        $problems = [];
        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->pluck('id', 'code')->all();
        $valid = [];
        foreach ($items as $n => $i) {
            $idpel = trim((string) ($i['idpel'] ?? ''));
            $unitId = $units[trim((string) ($i['unit_code'] ?? ''))] ?? null;
            if (! preg_match('/^\d{12}$/', $idpel)) {
                $this->reject($counts, $problems, 'invalid', $n, $idpel, 'IDPEL harus 12 digit.');
            } elseif ($unitId === null) {
                $this->reject($counts, $problems, 'unknown_unit', $n, $idpel, 'Kode ULP tidak dikenal.');
            } elseif (! $scope['unrestricted'] && ! in_array($unitId, $scope['units'], true)) {
                $this->reject($counts, $problems, 'out_of_scope', $n, $idpel, 'ULP di luar cakupan Anda.');
            } else {
                $valid[$idpel] = $this->clean($i) + ['organizational_unit_id' => $unitId];
            }
        }
        if ($valid !== []) {
            DB::transaction(function () use ($valid, $b, &$counts): void {
                $refs = array_values(array_unique(array_filter(array_map(fn ($v) => $v['gardu_ref'] === null ? null : mb_strtoupper($v['gardu_ref']), $valid))));
                $gardu = [];
                foreach ($refs === [] ? [] : DB::table('substations')->whereRaw('upper(trim(gadis_number)) in ('.implode(',', array_fill(0, count($refs), '?')).')', $refs)->get(['id', 'gadis_number', 'organizational_unit_id']) as $s) {
                    $gardu[mb_strtoupper(trim($s->gadis_number)).'|'.$s->organizational_unit_id] = $s->id;
                }
                $codes = [];
                foreach ($refs as $r) {
                    ($c = self::paddedCode($r)) !== null && $codes[] = $c;
                }
                $byCode = [];
                foreach ($valid as $v) {
                    $v['gardu_code_ref'] !== null && $codes[] = $v['gardu_code_ref'];
                }
                $codes = array_values(array_unique($codes));
                foreach ($codes === [] ? [] : DB::table('substations')->whereRaw('upper(code) in ('.implode(',', array_fill(0, count($codes), '?')).')', array_values(array_unique($codes)))->get(['id', 'code', 'organizational_unit_id']) as $s) {
                    $byCode[mb_strtoupper($s->code).'|'.$s->organizational_unit_id] = $s->id;
                }
                $applicants = DB::table('customer_external_references')->where('reference_type', 'IDPEL')->whereIn('reference_value', array_keys($valid))->pluck('customer_id', 'reference_value')->all();
                $existing = DB::table('customer_connections')->whereIn('idpel', array_keys($valid))->get()->keyBy('idpel');
                $new = [];
                foreach ($valid as $idpel => $v) {
                    $sid = $v['gardu_ref'] === null ? null : ($gardu[mb_strtoupper($v['gardu_ref']).'|'.$v['organizational_unit_id']] ?? null);
                    $how = $sid === null ? null : 'DIL';
                    if ($sid === null && $v['gardu_code_ref'] !== null) {                       // the gardu named in NAMA_GARDU ("GD HD0008 PENYULANG DENANYAR"), in the customer's own ULP
                        $sid = $byCode[$v['gardu_code_ref'].'|'.$v['organizational_unit_id']] ?? null;
                        $how = $sid === null ? null : 'DIL_NAMA';
                    }
                    if ($sid === null && $v['gardu_ref'] !== null && ($pc = self::paddedCode($v['gardu_ref'])) !== null) {      // the GADIS number did not match: the short code, completed, in the same ULP
                        $sid = $byCode[$pc.'|'.$v['organizational_unit_id']] ?? null;
                        $how = $sid === null ? null : 'DIL_KODE';
                    }
                    $cur = $existing[$idpel] ?? null;
                    $row = array_intersect_key($v, array_flip(array_merge(self::FIELDS, ['organizational_unit_id']))) + ['snapshot_month' => $b->snapshot_month, 'last_batch_id' => $b->id, 'source' => 'DIL'];
                    if ($cur === null) {
                        $new[] = ['id' => (string) Str::uuid(), 'idpel' => $idpel, 'customer_id' => $applicants[$idpel] ?? null, 'substation_id' => $sid, 'link_source' => $how, 'created_at' => now(), 'updated_at' => now()] + $row;
                        $counts['created']++;
                        in_array($how, ['DIL_KODE', 'DIL_NAMA'], true) && $counts['linked_by_code']++;
                        $counts[$sid === null ? 'gardu_unlinked' : 'gardu_linked']++;

                        continue;
                    }
                    $set = [];
                    foreach (array_merge(self::FIELDS, ['organizational_unit_id']) as $f) {
                        $old = $cur->{$f};
                        $same = is_numeric($old) && is_numeric($row[$f] ?? null) ? abs((float) $old - (float) $row[$f]) < 0.005 : (string) $old === (string) ($row[$f] ?? '');
                        $same || $set[$f] = $row[$f] ?? null;
                    }
                    if ($cur->link_source !== 'MANUAL' && $sid !== null && $cur->substation_id !== $sid) {
                        $set += ['substation_id' => $sid, 'link_source' => $how];
                        in_array($how, ['DIL_KODE', 'DIL_NAMA'], true) && $counts['linked_by_code']++;
                    }
                    ($cur->customer_id === null && isset($applicants[$idpel])) && $set['customer_id'] = $applicants[$idpel];
                    $cur->source !== 'DIL' && $set['source'] = 'DIL';
                    if ($set === []) {
                        $counts['unchanged']++;
                        DB::table('customer_connections')->where('id', $cur->id)->update(['last_batch_id' => $b->id, 'snapshot_month' => $b->snapshot_month]);
                    } else {
                        DB::table('customer_connections')->where('id', $cur->id)->update($set + ['last_batch_id' => $b->id, 'snapshot_month' => $b->snapshot_month, 'updated_at' => now()]);
                        $counts['updated']++;
                    }
                    $counts[($set['substation_id'] ?? $cur->substation_id) === null ? 'gardu_unlinked' : 'gardu_linked']++;
                }
                foreach (array_chunk($new, 500) as $chunk) {
                    DB::table('customer_connections')->insert($chunk);
                }
            });
        }
        $this->addCounts($b->id, $counts);

        return ['counts' => $counts, 'problems' => array_slice($problems, 0, 20), 'received' => count($items)];
    }

    /** @return array<string,mixed> */
    public function complete(string $batchId, User $actor): array
    {
        $this->ownBatch($batchId, $actor);
        DB::table('customer_connection_batches')->where('id', $batchId)->update(['status' => 'COMPLETED', 'completed_at' => now(), 'updated_at' => now()]);

        return $this->batch($batchId, $actor);
    }

    /** @return array<string,mixed> */
    public function batch(string $id, User $actor): array
    {
        $b = $this->ownBatch($id, $actor);

        return ['id' => $b->id, 'source' => $b->source, 'file_name' => $b->file_name, 'snapshot_month' => $b->snapshot_month, 'status' => $b->status, 'counts' => json_decode((string) $b->counts, true), 'created_at' => $b->created_at, 'completed_at' => $b->completed_at];
    }

    /** @param array<string,mixed> $f @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function search(array $f, array $scope): array
    {
        $q = DB::table('customer_connections as c')->join('organizational_units as u', 'u.id', '=', 'c.organizational_unit_id')->leftJoin('substations as s', 's.id', '=', 'c.substation_id')
            ->leftJoin('distribution_feeders as fd', 'fd.id', '=', 's.feeder_id')->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')
            ->select('c.*', 'u.name as unit_name', 's.code as substation_code', 's.name as substation_name', 'fd.id as feeder_id', 'fd.code as feeder_code', 'cu.name as applicant_name');
        $scope['unrestricted'] || $q->whereIn('c.organizational_unit_id', $scope['units']);
        if (! empty($f['q'])) {
            $t = trim((string) $f['q']);
            ctype_digit($t) ? $q->where('c.idpel', 'like', $t.'%') : $q->where(fn ($w) => $w->whereRaw('lower(coalesce(cu.name, c.name, \'\')) like ?', ['%'.mb_strtolower($t).'%'])->orWhere('c.meter_number', $t));
        }
        foreach (['organizational_unit_id' => 'c.organizational_unit_id', 'substation_id' => 'c.substation_id', 'tariff_code' => 'c.tariff_code', 'status' => 'c.status', 'service_type' => 'c.service_type', 'feeder_id' => 's.feeder_id'] as $k => $col) {
            ! empty($f[$k]) && $q->where($col, $f[$k]);
        }
        if (isset($f['linked'])) {
            $f['linked'] ? $q->whereNotNull('c.substation_id') : $q->whereNull('c.substation_id');
        }
        $page = $q->orderBy('c.idpel')->paginate(max(1, min((int) ($f['per_page'] ?? 25), 100)));

        return ['data' => collect($page->items())->map(fn ($r) => $this->present($r))->all(), 'meta' => ['current_page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()]];
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function show(string $id, array $scope): array
    {
        $r = DB::table('customer_connections as c')->join('organizational_units as u', 'u.id', '=', 'c.organizational_unit_id')->leftJoin('substations as s', 's.id', '=', 'c.substation_id')
            ->leftJoin('distribution_feeders as fd', 'fd.id', '=', 's.feeder_id')->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->where('c.id', $id)
            ->select('c.*', 'u.name as unit_name', 's.code as substation_code', 's.name as substation_name', 'fd.id as feeder_id', 'fd.code as feeder_code', 'cu.name as applicant_name')->first();
        if ($r === null || (! $scope['unrestricted'] && ! in_array($r->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        $apps = $r->customer_id === null ? [] : DB::table('applications')->where('customer_id', $r->customer_id)->orderByDesc('created_at')->limit(10)->get(['id', 'application_number', 'application_type', 'current_status', 'created_at'])->all();

        return ['connection' => $this->present($r), 'applications' => array_map(fn ($a) => (array) $a, $apps)];
    }

    /** Fix the gardu of a customer by hand; the link is then MANUAL and a later load keeps it. @param array{unrestricted: bool, units: list<string>} $scope @return array<string,mixed> */
    public function link(string $id, ?string $substationId, array $scope): array
    {
        $c = DB::table('customer_connections')->where('id', $id)->first();
        if ($c === null || (! $scope['unrestricted'] && ! in_array($c->organizational_unit_id, $scope['units'], true))) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
        if ($substationId !== null) {
            $s = DB::table('substations')->where('id', $substationId)->first();
            if ($s === null || (! $scope['unrestricted'] && ! in_array($s->organizational_unit_id, $scope['units'], true))) {
                throw new AdministrationDenied('Data tidak ditemukan.', 404);
            }
            if ($s->organizational_unit_id !== $c->organizational_unit_id) {
                throw new AssignmentRuleViolation('Gardu harus berada di ULP yang sama dengan pelanggan.');
            }
        }
        DB::table('customer_connections')->where('id', $id)->update(['substation_id' => $substationId, 'link_source' => 'MANUAL', 'updated_at' => now()]);      // an unlink is a decision too: a later load or gardu import keeps it

        return $this->show($id, $scope);
    }

    /** What a gardu / feeder carries: active customers and their contracted power. @return array<string,mixed> */
    public function summary(string $by, string $id): array
    {
        $q = DB::table('customer_connections as c')->where('c.status', 'AKTIF');
        $by === 'feeder' ? $q->join('substations as s', 's.id', '=', 'c.substation_id')->where('s.feeder_id', $id) : $q->where('c.substation_id', $id);
        $r = $q->selectRaw('count(*) as n, coalesce(sum(c.power_va), 0) as va, count(*) filter (where c.power_va >= 6600) as three_phase')->first();

        return ['active_customers' => (int) $r->n, 'connected_va' => (float) $r->va, 'connected_kva' => round((float) $r->va / 1000, 2), 'large_customers' => (int) $r->three_phase];
    }

    /**
     * The KKO picked a gardu for an application: link the applicant's IDPEL to it, only when the applicant has exactly one IDPEL. A connection that does not exist yet is created as PROSES.
     * A MANUAL link is kept. Returns what happened so it can be reported, never thrown (the KKO never depends on this).
     *
     * @return array{result: string, idpel?: string}
     */
    public function linkFromKko(string $applicationId, string $substationId): array
    {
        $app = DB::table('applications')->where('id', $applicationId)->first();
        $s = DB::table('substations')->where('id', $substationId)->first();
        if ($app === null || $s === null || $app->customer_id === null) {
            return ['result' => 'no_customer'];
        }
        $idpels = DB::table('customer_external_references')->where('customer_id', $app->customer_id)->where('reference_type', 'IDPEL')->pluck('reference_value')->unique()->values();
        if ($idpels->count() !== 1 || ! preg_match('/^\d{12}$/', (string) $idpels[0])) {
            return ['result' => $idpels->isEmpty() ? 'no_idpel' : 'ambiguous_idpel'];
        }
        $idpel = (string) $idpels[0];
        $cur = DB::table('customer_connections')->where('idpel', $idpel)->first();
        if ($cur === null) {
            $kva = $app->new_power_value === null ? null : (float) $app->new_power_value * (strtoupper((string) $app->new_power_unit) === 'KVA' ? 1000 : 1);
            DB::table('customer_connections')->insert(['id' => (string) Str::uuid(), 'idpel' => $idpel, 'organizational_unit_id' => $app->organizational_unit_id, 'customer_id' => $app->customer_id, 'substation_id' => $substationId, 'link_source' => 'KKO',
                'tariff_code' => $app->new_tariff_code, 'power_va' => $kva !== null && $kva > 0 ? $kva : null, 'status' => 'PROSES', 'source' => 'APPLICATION', 'created_at' => now(), 'updated_at' => now()]);

            return ['result' => 'created', 'idpel' => $idpel];
        }
        if ($cur->link_source === 'MANUAL') {
            return ['result' => 'kept_manual', 'idpel' => $idpel];
        }
        DB::table('customer_connections')->where('id', $cur->id)->update(['substation_id' => $substationId, 'link_source' => 'KKO', 'customer_id' => $cur->customer_id ?? $app->customer_id, 'updated_at' => now()]);

        return ['result' => 'linked', 'idpel' => $idpel];
    }

    /**
     * After a gardu import: customers still unlinked (and not decided by hand) whose gardu_ref equals the GADIS number of a (new) gardu of their ULP, else whose short code (HD127) completes to the gardu's code (HD0127), get linked.
     *
     * @param  list<string>|null  $substationIds  null = every gardu (a one-off catch-up)
     */
    public function linkPending(?array $substationIds = null): int
    {
        if ($substationIds === []) {
            return 0;
        }
        $n = 0;
        foreach ($substationIds === null ? [null] : array_chunk($substationIds, 500) as $ids) {
            $in = $ids === null ? '' : ' and s.id in ('.implode(',', array_fill(0, count($ids), '?')).')';
            $b = $ids ?? [];
            $n += DB::update("update customer_connections c set substation_id = s.id, link_source = 'DIL', updated_at = now() from substations s where c.substation_id is null and c.link_source is distinct from 'MANUAL'{$in}
                and s.gadis_number is not null and upper(trim(c.gardu_ref)) = upper(trim(s.gadis_number)) and c.organizational_unit_id = s.organizational_unit_id", $b);
            $n += DB::update("update customer_connections c set substation_id = s.id, link_source = 'DIL_KODE', updated_at = now() from substations s where c.substation_id is null and c.link_source is distinct from 'MANUAL'{$in}
                and upper(trim(c.gardu_ref)) ~ '^H[A-Z][0-9]{1,3}\$' and upper(s.code) = substring(upper(trim(c.gardu_ref)) from 1 for 2) || lpad(substring(upper(trim(c.gardu_ref)) from '^H[A-Z]([0-9]{1,3})\$'), 4, '0') and c.organizational_unit_id = s.organizational_unit_id", $b);
            $n += DB::update("update customer_connections c set substation_id = s.id, link_source = 'DIL_NAMA', updated_at = now() from substations s where c.substation_id is null and c.link_source is distinct from 'MANUAL'{$in}
                and c.gardu_code_ref is not null and upper(s.code) = upper(c.gardu_code_ref) and c.organizational_unit_id = s.organizational_unit_id", $b);
        }

        return $n;
    }

    /** HD127 -> HD0127, HL141 -> HL0141 (two letters H? and 1-3 digits completed to four); null for any other form. */
    public static function paddedCode(string $ref): ?string
    {
        return preg_match('/^(H[A-Z])(\d{1,3})$/', mb_strtoupper(trim($ref)), $m) ? $m[1].str_pad($m[2], 4, '0', STR_PAD_LEFT) : null;
    }

    /** The gardu code inside a DIL gardu NAME: "GD HD0008 PENYULANG DENANYAR" -> HD0008, "CEWENG-HD742" -> HD0742; null when there is none. */
    public static function codeFromName(?string $name): ?string
    {
        return preg_match('/(?<![A-Z0-9])(H[A-Z])(\d{3,4})(?![0-9])/', mb_strtoupper((string) $name), $m) ? $m[1].str_pad($m[2], 4, '0', STR_PAD_LEFT) : null;
    }

    /** @param array<string,mixed> $i @return array<string,mixed> */
    private function clean(array $i): array
    {
        $t = fn (string $k, int $max) => ($v = trim((string) ($i[$k] ?? ''))) === '' ? null : mb_substr($v, 0, $max);
        $va = is_numeric($i['power_va'] ?? null) && (float) $i['power_va'] > 0 && (float) $i['power_va'] < 1.0E+12 ? round((float) $i['power_va'], 2) : null;
        $status = mb_strtoupper(trim((string) ($i['status'] ?? 'AKTIF')));
        $on = $t('energized_on', 10);

        return ['name' => $t('name', 200), 'kelurahan' => $t('kelurahan', 100), 'kecamatan' => $t('kecamatan', 100), 'kabupaten' => $t('kabupaten', 100), 'tariff_code' => $t('tariff_code', 10), 'power_va' => $va,
            'service_type' => in_array($u = mb_strtoupper((string) $t('service_type', 12)), ['PASKABAYAR', 'PRABAYAR'], true) ? $u : null, 'phase_code' => $t('phase_code', 2), 'meter_number' => $t('meter_number', 30),
            'energized_on' => $on !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $on) && checkdate((int) substr($on, 5, 2), (int) substr($on, 8, 2), (int) substr($on, 0, 4)) ? $on : null,
            'status' => in_array($status, ['AKTIF', 'BONGKAR', 'HAPUS'], true) ? $status : 'AKTIF', 'gardu_ref' => $t('gardu_ref', 40), 'gardu_code_ref' => self::codeFromName($t('gardu_name', 200))];
    }

    /** @param array<string,int> $counts @param list<array<string,mixed>> $problems */
    private function reject(array &$counts, array &$problems, string $kind, int $n, string $idpel, string $msg): void
    {
        $counts[$kind]++;
        $problems[] = ['index' => $n, 'idpel' => $idpel, 'problem' => $msg];
    }

    /** @return array<string,int> */
    private function zero(): array
    {
        return ['created' => 0, 'updated' => 0, 'unchanged' => 0, 'gardu_linked' => 0, 'gardu_unlinked' => 0, 'linked_by_code' => 0, 'invalid' => 0, 'unknown_unit' => 0, 'out_of_scope' => 0];
    }

    /** @param array<string,int> $add */
    private function addCounts(string $batchId, array $add): void
    {
        $b = DB::table('customer_connection_batches')->where('id', $batchId)->lockForUpdate()->first();
        $cur = json_decode((string) $b->counts, true) ?: $this->zero();
        foreach ($add as $k => $v) {
            $cur[$k] = ($cur[$k] ?? 0) + $v;
        }
        DB::table('customer_connection_batches')->where('id', $batchId)->update(['counts' => json_encode($cur), 'updated_at' => now()]);
    }

    private function ownBatch(string $id, User $actor): object
    {
        $b = DB::table('customer_connection_batches')->where('id', $id)->first();
        if ($b === null || $b->initiated_by !== $actor->getKey()) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }

        return $b;
    }

    /** @return array<string,mixed> */
    private function present(object $r): array
    {
        return ['id' => $r->id, 'idpel' => $r->idpel, 'name' => $r->applicant_name ?? $r->name, 'name_masked' => $r->applicant_name === null, 'organizational_unit_id' => $r->organizational_unit_id, 'unit_name' => $r->unit_name ?? null,
            'kelurahan' => $r->kelurahan, 'kecamatan' => $r->kecamatan, 'kabupaten' => $r->kabupaten, 'tariff_code' => $r->tariff_code, 'power_va' => $r->power_va === null ? null : (float) $r->power_va, 'service_type' => $r->service_type,
            'phase_code' => $r->phase_code, 'meter_number' => $r->meter_number, 'energized_on' => $r->energized_on, 'status' => $r->status, 'source' => $r->source, 'snapshot_month' => $r->snapshot_month, 'customer_id' => $r->customer_id,
            'gardu_ref' => $r->gardu_ref, 'substation_id' => $r->substation_id, 'substation_code' => $r->substation_code ?? null, 'substation_name' => $r->substation_name ?? null, 'feeder_id' => $r->feeder_id ?? null,
            'feeder_code' => $r->feeder_code ?? null, 'link_source' => $r->link_source];
    }
}
