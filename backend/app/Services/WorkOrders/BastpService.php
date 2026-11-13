<?php

namespace App\Services\WorkOrders;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * BASTP (docs/62 §36, docs/73). Callers authorize the actor for the step first (vendor relation / keys on the application's unit) and have verified the signing password.
 * DRAFT -> SUBMITTED (vendor or TEKNIK signs) -> ACCEPTED (MANAGER_ULP) -> KONSTRUKSI_SIGNED (KONSTRUKSI_UP3) -> CLOSED (ASMAN_KONSTRUKSI; the WO is completed in the same step).
 * A return (any reviewing step, reason required) reopens the DRAFT as a new round; earlier signatures stay as history. One signature per user per round.
 */
class BastpService
{
    private const STEPS = [
        'SUBMIT' => ['from' => 'DRAFT', 'to' => 'SUBMITTED'],
        'ULP_MANAGER' => ['from' => 'SUBMITTED', 'to' => 'ACCEPTED'],
        'KONSTRUKSI_UP3' => ['from' => 'ACCEPTED', 'to' => 'KONSTRUKSI_SIGNED'],
        'ASMAN_KONSTRUKSI' => ['from' => 'KONSTRUKSI_SIGNED', 'to' => 'CLOSED'],
    ];

    public function __construct(private readonly WorkOrderService $orders) {}

    public function create(string $woId, User $actor): string
    {
        return DB::transaction(function () use ($woId, $actor): string {
            $wo = DB::table('work_orders')->where('id', $woId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($wo->status !== 'IN_PROGRESS') {
                throw new AssignmentRuleViolation("WO berstatus {$wo->status}; BASTP dibuat saat WO berjalan dan seluruh pekerjaan sudah terverifikasi.");
            }
            $open = [];
            foreach (DB::table('wo_tasks')->where('work_order_id', $woId)->orderBy('sequence')->get() as $t) {
                if ($this->orders->verifiedPercent($t) < 100 - 1e-9) {
                    $open[] = "{$t->title} (".$this->orders->verifiedPercent($t).' %)';
                }
            }
            if ($open !== [] || DB::table('wo_progress')->where('work_order_id', $woId)->where('status', 'SUBMITTED')->exists()) {
                throw new AssignmentRuleViolation('BASTP baru dapat dibuat setelah semua tugas terverifikasi 100 % dan tidak ada progres tertunda'.($open === [] ? '.' : ': '.implode('; ', $open).'.'));
            }
            $id = (string) Str::uuid();
            try {
                DB::table('bastps')->insert(['id' => $id, 'work_order_id' => $woId, 'application_id' => $wo->application_id, 'status' => 'DRAFT', 'round' => 1, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            } catch (QueryException $e) {
                throw $e->getCode() === '23505' ? new AssignmentRuleViolation('WO ini sudah memiliki BASTP yang berjalan atau selesai.', 0, $e) : $e;
            }
            foreach (DB::table('wo_materials')->where('work_order_id', $woId)->get() as $m) {
                DB::table('bastp_materials')->insert(['id' => (string) Str::uuid(), 'bastp_id' => $id, 'khs_item_id' => $m->khs_item_id, 'planned_qty' => $m->quantity]);
            }
            $this->event($id, 'CREATED', $actor, null);

            return $id;
        });
    }

    /** @param list<array{khs_code:string,installed_qty:numeric,note?:?string}> $rows */
    public function putMaterials(string $bastpId, array $rows, ?string $notes): void
    {
        DB::transaction(function () use ($bastpId, $rows, $notes): void {
            $this->draft($bastpId);
            $items = DB::table('bastp_materials as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->where('m.bastp_id', $bastpId)->pluck('m.id', 'k.code');
            $codes = array_column($rows, 'khs_code');
            if (count($codes) !== count(array_unique($codes))) {
                throw new AssignmentRuleViolation('Kode KHS muncul lebih dari sekali.');
            }
            foreach ($rows as $r) {
                if (! isset($items[$r['khs_code']])) {
                    throw new AssignmentRuleViolation("KHS {$r['khs_code']} tidak ada pada kebutuhan material WO.");
                }
            }
            foreach ($rows as $r) {
                DB::table('bastp_materials')->where('id', $items[$r['khs_code']])->update(['installed_qty' => (float) $r['installed_qty'], 'note' => $r['note'] ?? null]);
            }
            DB::table('bastps')->where('id', $bastpId)->update(['notes' => $notes ?? DB::raw('notes'), 'updated_at' => now()]);
        });
    }

    /** @param list<array{customer_idpel:string,meter_number:string}> $meters Replaces the meters as a whole (photos of a removed meter are unlinked, the files stay). */
    public function putMeters(string $bastpId, array $meters): void
    {
        DB::transaction(function () use ($bastpId, $meters): void {
            $this->draft($bastpId);
            $numbers = array_map(fn ($m) => trim($m['meter_number']), $meters);
            if (count($numbers) !== count(array_unique($numbers))) {
                throw new AssignmentRuleViolation('Nomor kWh meter muncul lebih dari sekali.');
            }
            $existing = DB::table('bastp_meters')->where('bastp_id', $bastpId)->get()->keyBy('meter_number');
            foreach ($existing as $number => $row) {
                if (! in_array($number, $numbers, true)) {
                    DB::table('bastp_meter_photos')->where('bastp_meter_id', $row->id)->delete();
                    DB::table('bastp_meters')->where('id', $row->id)->delete();
                }
            }
            foreach ($meters as $m) {
                $n = trim($m['meter_number']);
                isset($existing[$n])
                    ? DB::table('bastp_meters')->where('id', $existing[$n]->id)->update(['customer_idpel' => trim($m['customer_idpel'])])
                    : DB::table('bastp_meters')->insert(['id' => (string) Str::uuid(), 'bastp_id' => $bastpId, 'customer_idpel' => trim($m['customer_idpel']), 'meter_number' => $n]);
            }
        });
    }

    public function linkPhoto(string $bastpId, string $meterId, string $documentId): void
    {
        DB::transaction(function () use ($bastpId, $meterId, $documentId): void {
            $this->draft($bastpId);
            $meter = DB::table('bastp_meters')->where('id', $meterId)->where('bastp_id', $bastpId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if (DB::table('bastp_meter_photos')->where('bastp_meter_id', $meter->id)->count() >= 10) {
                throw new AssignmentRuleViolation('Satu kWh meter dapat memiliki paling banyak 10 foto.');
            }
            DB::table('bastp_meter_photos')->insert(['id' => (string) Str::uuid(), 'bastp_meter_id' => $meter->id, 'document_id' => $documentId]);
        });
    }

    /** SUBMIT (vendor / TEKNIK), ULP_MANAGER, KONSTRUKSI_UP3 or ASMAN_KONSTRUKSI signs: electronic signature over the frozen content hash. */
    public function sign(string $bastpId, string $step, User $actor, string $role): void
    {
        try {
            DB::transaction(function () use ($bastpId, $step, $actor, $role): void {
                $b = $this->lock($bastpId);
                $cfg = self::STEPS[$step];
                if ($b->status !== $cfg['from']) {
                    throw new AssignmentRuleViolation("BASTP berstatus {$b->status}; langkah ini hanya untuk status {$cfg['from']}.");
                }
                if (DB::table('bastp_signatures')->where('bastp_id', $bastpId)->where('round', $b->round)->where('signer_user_id', $actor->getKey())->exists()) {
                    throw new AdministrationDenied('Satu pengguna hanya dapat menandatangani satu langkah pada satu putaran BASTP.', 403);
                }
                $set = ['status' => $cfg['to'], 'updated_at' => now()];
                if ($step === 'SUBMIT') {
                    $content = $this->freeze($b);
                    $hash = hash('sha256', json_encode($content, JSON_THROW_ON_ERROR));
                    $set += ['content' => json_encode($content), 'content_hash' => $hash, 'return_reason' => null];
                    if ($b->bastp_number === null) {
                        $set['bastp_number'] = $this->number((string) DB::table('applications')->where('id', $b->application_id)->value('organizational_unit_id'));
                    }
                    $b->bastp_number = $set['bastp_number'] ?? $b->bastp_number;
                    $b->content_hash = $hash;
                }
                $at = now();
                DB::table('bastp_signatures')->insert(['id' => (string) Str::uuid(), 'bastp_id' => $bastpId, 'round' => $b->round, 'step' => $step, 'signer_user_id' => $actor->getKey(), 'signer_role' => $role, 'signed_at' => $at, 'content_hash' => $b->content_hash,
                    'signature' => hash_hmac('sha256', implode('|', [$b->bastp_number, $b->round, $step, $actor->getKey(), $at->toIso8601String(), $b->content_hash]), (string) config('app.key'))]);
                if ($step === 'ASMAN_KONSTRUKSI') {
                    $set += ['closed_at' => $at];
                    $this->orders->completeAfterBastp($b->work_order_id, $actor);          // all work verified + the customer at PEREMAJAAN, else the whole closing is refused
                }
                DB::table('bastps')->where('id', $bastpId)->update($set);
                $this->event($bastpId, match ($step) {
                    'SUBMIT' => 'SUBMITTED', 'ULP_MANAGER' => 'ACCEPTED', 'KONSTRUKSI_UP3' => 'SIGNED', default => 'CLOSED'
                }, $actor, null);
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23505' => new AssignmentRuleViolation('Tanda tangan bentrok dengan tanda tangan lain pada putaran ini.', 0, $e),
                'P0001' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas BASTP.', 0, $e),
                default => $e,
            };
        }
    }

    /** A reviewing step sends the BASTP back to DRAFT (new round). */
    public function returnBack(string $bastpId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($bastpId, $reason, $actor): void {
            $b = $this->lock($bastpId);
            if (! in_array($b->status, ['SUBMITTED', 'ACCEPTED', 'KONSTRUKSI_SIGNED'], true)) {
                throw new AssignmentRuleViolation("BASTP berstatus {$b->status} tidak dapat dikembalikan.");
            }
            if (trim($reason) === '') {
                throw new AssignmentRuleViolation('Pengembalian wajib disertai alasan.');
            }
            DB::table('bastps')->where('id', $bastpId)->update(['status' => 'DRAFT', 'round' => $b->round + 1, 'return_reason' => trim($reason), 'updated_at' => now()]);
            $this->event($bastpId, 'RETURNED', $actor, $reason);
        });
    }

    /** The key a reviewer needs to return a BASTP now (the holder of the NEXT signature step). */
    public static function reviewerKeyFor(string $status): ?string
    {
        return ['SUBMITTED' => 'bastp.accept', 'ACCEPTED' => 'bastp.sign_konstruksi', 'KONSTRUKSI_SIGNED' => 'bastp.close'][$status] ?? null;
    }

    /** Called by the work-order service when the WO is cancelled or superseded. */
    public static function cancelLive(string $woId, User $actor, string $reason): void
    {
        foreach (DB::table('bastps')->where('work_order_id', $woId)->whereIn('status', ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'KONSTRUKSI_SIGNED'])->get() as $b) {
            DB::table('bastps')->where('id', $b->id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);
            DB::table('bastp_events')->insert(['id' => (string) Str::uuid(), 'bastp_id' => $b->id, 'event_type' => 'CANCELLED', 'actor_user_id' => $actor->getKey(), 'reason' => $reason, 'occurred_at' => now()]);
        }
    }

    /** @return array<string,mixed> */
    private function freeze(object $b): array
    {
        $materials = DB::table('bastp_materials as m')->join('khs_items as k', 'k.id', '=', 'm.khs_item_id')->where('m.bastp_id', $b->id)->orderByRaw('length(k.code), k.code')->get(['k.code', 'm.planned_qty', 'm.installed_qty', 'm.note']);
        if ($materials->contains(fn ($m) => $m->installed_qty === null)) {
            throw new AssignmentRuleViolation('Lampiran material belum lengkap: isi jumlah terpasang untuk setiap material.');
        }
        $meters = DB::table('bastp_meters')->where('bastp_id', $b->id)->orderBy('meter_number')->get();
        if ($meters->isEmpty()) {
            throw new AssignmentRuleViolation('Bukti kWh meter belum ada: isi minimal satu kWh meter (ID pelanggan, nomor meter) dengan foto.');
        }
        $meterRows = [];
        foreach ($meters as $m) {
            $photos = DB::table('bastp_meter_photos as p')->join('application_documents as d', 'd.id', '=', 'p.document_id')->join('application_document_versions as v', 'v.id', '=', 'd.current_version_id')->where('p.bastp_meter_id', $m->id)->orderBy('v.sha256')->pluck('v.sha256')->all();
            if ($photos === []) {
                throw new AssignmentRuleViolation("kWh meter {$m->meter_number} belum memiliki foto.");
            }
            $meterRows[] = ['customer_idpel' => $m->customer_idpel, 'meter_number' => $m->meter_number, 'photos_sha256' => $photos];
        }
        $wo = DB::table('work_orders')->where('id', $b->work_order_id)->first();
        $tasks = DB::table('wo_tasks')->where('work_order_id', $b->work_order_id)->orderBy('sequence')->get()->map(fn ($t) => ['group' => $t->group_code, 'title' => $t->title, 'unit' => $t->unit_text, 'volume' => (float) $t->volume, 'verified_percent' => $this->orders->verifiedPercent($t)])->all();

        return ['wo_number' => $wo->wo_number, 'application_id' => $b->application_id, 'tasks' => $tasks, 'materials' => $materials->map(fn ($m) => ['khs_code' => $m->code, 'planned' => (float) $m->planned_qty, 'installed' => (float) $m->installed_qty, 'note' => $m->note])->all(),
            'meters' => $meterRows, 'notes' => $b->notes];
    }

    /** `{sequence}/BASTP/{dd-mm}/{unit code}/{year}` (owner 7 Nov 2026), e.g. 00001/BASTP/07-11/51543/2026; the sequence runs per ULP per year. */
    private function number(string $unitId): string
    {
        $d = CarbonImmutable::now(config('distriva.business_timezone'));
        DB::table('bastp_number_sequences')->insertOrIgnore(['organizational_unit_id' => $unitId, 'year' => $d->year, 'last_number' => 0]);
        $row = DB::table('bastp_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->lockForUpdate()->first();
        DB::table('bastp_number_sequences')->where('organizational_unit_id', $unitId)->where('year', $d->year)->update(['last_number' => $row->last_number + 1]);

        return strtr((string) config('distriva.document.bastp_number_format'), ['{seq}' => str_pad((string) ($row->last_number + 1), 5, '0', STR_PAD_LEFT), '{dm}' => $d->format('d-m'), '{unit}' => (string) DB::table('organizational_units')->where('id', $unitId)->value('code'), '{year}' => (string) $d->year]);
    }

    private function draft(string $id): object
    {
        $b = $this->lock($id);
        if ($b->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("BASTP berstatus {$b->status}; hanya DRAFT yang dapat diubah.");
        }

        return $b;
    }

    private function lock(string $id): object
    {
        return DB::table('bastps')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function event(string $id, string $type, User $actor, ?string $reason): void
    {
        DB::table('bastp_events')->insert(['id' => (string) Str::uuid(), 'bastp_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason), 'occurred_at' => now()]);
    }
}
