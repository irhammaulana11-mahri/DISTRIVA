<?php

namespace App\Services\Applications;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Support\EisFileReader;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Import of the EIS / Bot Daftung download (stage 1B + 1C, docs/62 §6-§7), through staging:
 * upload -> every row is classified (NEW / MATCHED / UNCHANGED / REJECT) with its warnings and a preview of what would change
 * -> confirm applies it. Nothing is written to applications before the confirmation. Owner decisions 2026-11-06:
 *  - No. Agenda is the matching key (text); UNITTUJUAN is the unit code; power is in VA; only PASANG BARU (PB) and PERUBAHAN DAYA (PD);
 *  - the external STATUS_PERMOHONAN moves the internal status through external_status_mappings (newer TGL_UPDATE_PERMOHONAN only);
 *  - for an application that already exists the sync refreshes ONLY the working days (DURASI_HARI_KERJA) and the status (owner 2026-11-13; before: also
 *    IDPEL, name, address, tariff/power, cost, register no., criteria), and every change is logged with before/after;
 *  - a NEW application is taken in every power, in the statuses of config distriva.eis_new_statuses (Bayar, Cetak PK, PDL Awal, Peremajaan).
 * Never guessed: unknown unit / transaction type / ambiguous date => the row is rejected or the value ignored with a warning.
 * Callers authorize the actor first (scope = units the actor may import for).
 */
class EisImportService
{
    private const SYSTEM = 'EIS_AP2T';

    private const REQUIRED = ['NOAGENDA', 'NAMA', 'JENIS_TRANSAKSI', 'UNITTUJUAN'];

    private const TYPE_MAP = ['PASANG BARU' => 'PB', 'PERUBAHAN DAYA' => 'PD'];

    private const TERMINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

    private const POST_PAYMENT = ['PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE', 'COMPLETED'];

    public function __construct(private readonly ApplicationService $applications) {}

    /**
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array<string,mixed> batch summary
     */
    public function stage(UploadedFile $file, array $scope, User $actor): array
    {
        $parsed = EisFileReader::read($file);
        $missing = array_values(array_diff(self::REQUIRED, $parsed['columns']));
        if ($missing !== []) {
            throw new AssignmentRuleViolation('Kolom wajib tidak ditemukan pada berkas: '.implode(', ', $missing).'.');
        }

        $ctx = $this->context($parsed['rows']);
        $seen = [];
        $rows = [];
        $counts = ['NEW' => 0, 'MATCHED' => 0, 'UNCHANGED' => 0, 'REJECT' => 0, 'OUT_OF_SCOPE' => 0, 'OUT_OF_SCOPE_POWER' => 0, 'OUT_OF_SCOPE_STATUS' => 0];      // OUT_OF_SCOPE = the two reasons together
        foreach ($parsed['rows'] as $r) {
            $res = $this->classify($r['cells'], $scope, $ctx, $seen);
            if ($res['action'] === 'OUT_OF_SCOPE') {      // counted, never staged (see classify)
                $counts['OUT_OF_SCOPE']++;
                $counts[$res['scope_reason'] === 'status' ? 'OUT_OF_SCOPE_STATUS' : 'OUT_OF_SCOPE_POWER']++;

                continue;
            }
            $counts[$res['action']]++;
            $rows[] = ['row' => $r['row'], 'cells' => $r['cells'], 'res' => $res];
        }

        $batchId = (string) Str::uuid();
        DB::transaction(function () use ($batchId, $file, $parsed, $rows, $counts, $actor): void {
            DB::table('application_import_batches')->insert(['id' => $batchId, 'source_system' => self::SYSTEM, 'file_name' => mb_substr($file->getClientOriginalName(), 0, 255), 'file_format' => $parsed['format'],
                'file_sha256' => hash_file('sha256', $file->getRealPath()), 'status' => 'STAGED', 'total_rows' => count($rows) + $counts['OUT_OF_SCOPE'], 'counts' => json_encode($counts), 'initiated_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('application_import_staging')->insert(array_map(fn ($x) => [
                    'id' => (string) Str::uuid(), 'batch_id' => $batchId, 'row_number' => $x['row'], 'source_reference_id' => $x['res']['agenda'], 'payload' => json_encode($x['cells'], JSON_UNESCAPED_UNICODE),
                    'normalized' => json_encode($x['res']['normalized'], JSON_UNESCAPED_UNICODE), 'action' => $x['res']['action'], 'organizational_unit_id' => $x['res']['unit_id'], 'application_id' => $x['res']['application_id'],
                    'errors' => json_encode($x['res']['errors']), 'warnings' => json_encode($x['res']['warnings']), 'changes' => json_encode($x['res']['changes'] ?? new \stdClass, JSON_UNESCAPED_UNICODE),
                    'apply_status' => in_array($x['res']['action'], ['NEW', 'MATCHED'], true) ? 'PENDING' : 'SKIPPED', 'created_at' => now(),
                ], $chunk));
            }
        });

        $duplicate = DB::table('application_import_batches')->where('file_sha256', hash_file('sha256', $file->getRealPath()))->where('id', '<>', $batchId)->where('status', 'CONFIRMED')->exists();

        return ['id' => $batchId, 'file_name' => $file->getClientOriginalName(), 'format' => $parsed['format'], 'status' => 'STAGED', 'total_rows' => count($rows) + $counts['OUT_OF_SCOPE'], 'counts' => $counts,
            'warnings_count' => count(array_filter($rows, fn ($x) => $x['res']['warnings'] !== [])), 'same_file_already_confirmed' => $duplicate];
    }

    /**
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array<string,int>
     */
    public function confirm(string $batchId, array $scope, User $actor): array
    {
        $batch = DB::table('application_import_batches')->where('id', $batchId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->requireOwner($batch, $scope, $actor);
        if ($batch->status !== 'STAGED') {
            throw new AssignmentRuleViolation("Batch berstatus {$batch->status}; hanya batch STAGED yang dapat dikonfirmasi.");
        }
        // One confirmation at a time per batch.
        if (! DB::table('application_import_batches')->where('id', $batchId)->where('status', 'STAGED')->update(['status' => 'CONFIRMED', 'confirmed_by' => $actor->getKey(), 'confirmed_at' => now(), 'updated_at' => now()])) {
            throw new AssignmentRuleViolation('Batch sedang/sudah dikonfirmasi.');
        }

        $out = ['APPLIED' => 0, 'SKIPPED' => 0, 'FAILED' => 0];
        $rows = DB::table('application_import_staging')->where('batch_id', $batchId)->whereIn('action', ['NEW', 'MATCHED'])->orderBy('row_number')->get();
        foreach ($rows as $row) {
            try {
                [$status, $message] = DB::transaction(fn () => $this->apply($row, $batchId, $scope, $actor));
            } catch (\Throwable $e) {
                [$status, $message] = ['FAILED', 'Gagal menerapkan baris: '.mb_substr($e->getMessage(), 0, 200)];
            }
            $out[$status]++;
            DB::table('application_import_staging')->where('id', $row->id)->update(['apply_status' => $status, 'apply_message' => $message, 'processed_at' => now()]);
        }
        $counts = json_decode((string) $batch->counts, true) ?: [];
        DB::table('application_import_batches')->where('id', $batchId)->update(['counts' => json_encode($counts + ['applied' => $out['APPLIED'], 'skipped_on_confirm' => $out['SKIPPED'], 'failed' => $out['FAILED']]), 'updated_at' => now()]);

        return $out;
    }

    /** @param array{unrestricted: bool, units: list<string>} $scope */
    public function discard(string $batchId, array $scope, User $actor): void
    {
        $batch = DB::table('application_import_batches')->where('id', $batchId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $this->requireOwner($batch, $scope, $actor);
        if ($batch->status !== 'STAGED') {
            throw new AssignmentRuleViolation("Batch berstatus {$batch->status}; hanya batch STAGED yang dapat dibuang.");
        }
        DB::table('application_import_batches')->where('id', $batchId)->update(['status' => 'DISCARDED', 'updated_at' => now()]);
    }

    /** A batch belongs to its initiator; an unrestricted importer (SYS_ADMIN) may handle any. */
    public function requireOwner(object $batch, array $scope, User $actor): void
    {
        if ($batch->initiated_by !== $actor->getKey() && ! $scope['unrestricted']) {
            throw new AdministrationDenied('Data tidak ditemukan.', 404);
        }
    }

    // ------------------------------------------------------------------------------------------------------
    // classification

    /**
     * @param  list<array{row:int, cells:array<string,string>}>  $rows
     * @return array<string,mixed>
     */
    private function context(array $rows): array
    {
        $agendas = array_values(array_filter(array_map(fn ($r) => trim($r['cells']['NOAGENDA'] ?? ''), $rows)));
        $existing = [];
        foreach (array_chunk($agendas, 1000) as $chunk) {
            foreach (DB::table('application_external_references')->where('reference_type', 'AGENDA')->where('is_active', true)->whereIn('reference_number', $chunk)->get(['reference_number', 'application_id']) as $e) {
                $existing[$e->reference_number] = $e->application_id;
            }
        }

        $units = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->get();

        return [
            'units' => $units->keyBy('code')->all(),
            'unit_names' => $units->groupBy(fn ($u) => mb_strtolower($u->name))->filter(fn ($g) => $g->count() === 1)->map(fn ($g) => $g->first())->all(),
            'existing' => $existing,
            'mapping' => DB::table('external_status_mappings')->where('external_system', self::SYSTEM)->where('is_active', true)->pluck('internal_status', 'external_status_code')->all(),
        ];
    }

    /**
     * @param  array<string,string>  $c
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @param  array<string,mixed>  $ctx
     * @param  array<string,bool>  $seen
     * @return array<string,mixed>
     */
    private function classify(array $c, array $scope, array $ctx, array &$seen): array
    {
        $errors = [];
        $warnings = [];
        $get = fn (string $k) => trim((string) ($c[$k] ?? ''));
        $agenda = $get('NOAGENDA');
        $n = $this->normalize($c, $ctx['mapping'], $warnings, $errors);
        // Scope (owner 8 Nov 2026): only 3-phase customers (new power >= eis_min_power_va) are of interest. A smaller customer is dropped here, before any database work and whatever
        // else is wrong with the row (an unsupported transaction type, an unknown unit): it is only counted. An application already registered keeps syncing at any power.
        $minVa = (int) config('distriva.eis_min_power_va');
        if ($minVa > 0 && $n['new_power'] !== null && $n['new_power'] < $minVa && ! isset($ctx['existing'][$agenda])) {
            return ['action' => 'OUT_OF_SCOPE', 'scope_reason' => 'power', 'agenda' => $agenda === '' ? null : $agenda, 'errors' => [], 'warnings' => [], 'normalized' => $n, 'unit_id' => null, 'application_id' => null, 'changes' => null];
        }
        // Scope by status (owner 2026-11-14): a new application is taken only when already paid / PK printed (config distriva.eis_new_statuses); an unmapped or other status is only counted.
        $newStatuses = (array) config('distriva.eis_new_statuses');
        if ($newStatuses !== [] && ! isset($ctx['existing'][$agenda]) && ! in_array($n['internal_status'], $newStatuses, true)) {
            return ['action' => 'OUT_OF_SCOPE', 'scope_reason' => 'status', 'agenda' => $agenda === '' ? null : $agenda, 'errors' => [], 'warnings' => [], 'normalized' => $n, 'unit_id' => null, 'application_id' => null, 'changes' => null];
        }
        $unitId = null;
        $appId = null;

        if ($agenda === '') {
            $errors[] = 'NOAGENDA kosong: baris tidak dapat dicocokkan atau dibuat (disimpan di staging untuk audit).';
        } elseif (isset($seen[$agenda])) {
            $errors[] = 'No. Agenda muncul lebih dari sekali dalam berkas ini; hanya baris pertama diproses.';
        } else {
            $seen[$agenda] = true;
        }

        $unit = $ctx['units'][$n['unit_code']] ?? null;
        if ($n['unit_code'] === '') {
            // The real download leaves UNITTUJUAN empty on many rows: fall back to the EXACT (case-insensitive) unit name in NAMAUP, never a fuzzy match.
            $unit = $ctx['unit_names'][mb_strtolower($n['unit_name'])] ?? null;
            if ($unit === null) {
                $errors[] = 'UNITTUJUAN kosong dan NAMAUP tidak sama persis dengan satu ULP aktif di DISTRIVA.';
            } else {
                $warnings[] = "UNITTUJUAN kosong; unit ditentukan dari NAMAUP '{$n['unit_name']}' ({$unit->code}).";
            }
        } elseif ($unit === null) {
            $errors[] = "Kode unit tujuan {$n['unit_code']} tidak ada di DISTRIVA sebagai ULP aktif.";
        }
        if ($unit !== null) {
            $unitId = $unit->id;
            if (! $scope['unrestricted'] && ! in_array($unit->id, $scope['units'], true)) {
                $errors[] = "Unit {$unit->code} ({$unit->name}) di luar scope impor Anda.";
            } elseif ($n['unit_code'] !== '' && $n['unit_name'] !== '' && mb_strtolower($n['unit_name']) !== mb_strtolower($unit->name)) {
                $warnings[] = "NAMAUP '{$n['unit_name']}' berbeda dari nama unit '{$unit->name}' untuk kode {$unit->code}; kode yang dipakai.";
            }
        }

        $changes = null;
        if ($errors === [] && isset($ctx['existing'][$agenda])) {
            $appId = $ctx['existing'][$agenda];
            $app = DB::table('applications')->where('id', $appId)->first();
            if ($app->organizational_unit_id !== $unitId) {
                $errors[] = 'Unit tujuan berbeda dari unit permohonan yang sudah terdaftar dengan No. Agenda ini.';
            } elseif ($app->application_type !== $n['type']) {
                $errors[] = "Jenis transaksi ({$n['transaction_type']}) berbeda dari permohonan terdaftar ({$app->application_type}); tipe tidak dapat diubah.";
            } else {
                [$changes, $notes, $conflict] = $this->diff($app, $n);
                $warnings = array_merge($warnings, $notes);
                if ($conflict !== null) {
                    $errors[] = $conflict;
                }
            }
        } elseif ($errors === [] && $n['idpel'] !== '') {
            $owner = DB::table('customer_external_references')->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $n['idpel']])->whereNull('valid_until')->first();
            if ($owner !== null) {
                $name = DB::table('customers')->where('id', $owner->customer_id)->value('name');
                if ($name !== null && mb_strtolower($name) !== mb_strtolower($n['name'])) {
                    $warnings[] = "IDPEL {$n['idpel']} sudah terdaftar atas nama '{$name}'; permohonan ditautkan ke pelanggan itu (nama tidak diubah pada baris baru).";
                }
            }
        }

        if ($errors !== []) {
            $action = 'REJECT';
        } elseif ($appId === null) {
            $action = 'NEW';
        } else {
            $real = array_filter(array_keys((array) $changes), fn ($k) => ! str_starts_with((string) $k, '__'));
            $action = $real === [] && ! ($changes['__status'] ?? false) && ! ($changes['__history'] ?? false) ? 'UNCHANGED' : 'MATCHED';
        }
        if ($action === 'NEW' && $n['register'] !== '' && DB::table('application_external_references')->where('reference_type', 'PAYMENT_REGISTER')->where('is_active', true)->where('reference_number', $n['register'])->exists()) {
            $warnings[] = "No. Register {$n['register']} sudah dipakai permohonan lain; tidak ditautkan.";
        }
        if ($action === 'NEW' && $n['internal_status'] === null) {
            $warnings[] = 'Status eksternal kosong/belum dipetakan: permohonan dibuat dengan status APPROVED (No. Agenda sudah terbit).';
        }

        return ['action' => $action, 'agenda' => $agenda === '' ? null : $agenda, 'errors' => $errors, 'warnings' => $warnings, 'normalized' => $n, 'unit_id' => $unitId, 'application_id' => $appId,
            'changes' => $action === 'MATCHED' ? $this->previewChanges((array) $changes) : null];
    }

    /**
     * @param  array<string,string>  $c
     * @param  array<string,string>  $mapping
     * @param  list<string>  $warnings
     * @param  list<string>  $errors
     * @return array<string,mixed>
     */
    private function normalize(array $c, array $mapping, array &$warnings, array &$errors): array
    {
        $g = fn (string $k) => trim((string) ($c[$k] ?? ''));
        $tidy = fn (string $s) => trim(preg_replace('/\s+/u', ' ', $s) ?? $s);
        $transaction = strtoupper($tidy($g('JENIS_TRANSAKSI')));
        $type = self::TYPE_MAP[$transaction] ?? null;
        if ($type === null) {
            $errors[] = $transaction === '' ? 'JENIS_TRANSAKSI kosong.' : "Jenis transaksi '{$transaction}' belum dipetakan (hanya PASANG BARU dan PERUBAHAN DAYA).";
        }
        if ($tidy($g('NAMA')) === '') {
            $errors[] = 'NAMA kosong.';
        }

        $status = strtoupper($tidy(str_replace('_', ' ', $g('STATUS_PERMOHONAN'))));
        $internal = $status === '' ? null : ($mapping[$status] ?? null);
        if ($status !== '' && $internal === null) {
            $warnings[] = "Status eksternal '{$status}' belum dipetakan ke status internal; hanya dicatat di riwayat eksternal.";
        }
        $observed = $this->date($g('TGL_UPDATE_PERMOHONAN'), 'TGL_UPDATE_PERMOHONAN', $warnings);
        if ($internal !== null && $observed === null) {
            $warnings[] = 'TGL_UPDATE_PERMOHONAN kosong/tidak terbaca: status internal tidak diubah (urutan waktu tidak dapat ditentukan).';
        }

        $phoneRaw = $g('NOTELP_HP_PEMOHON') !== '' ? $g('NOTELP_HP_PEMOHON') : $g('NOTELP_PEMOHON');
        $phone = null;
        if ($phoneRaw !== '') {
            $phone = preg_match('/[eE]\+?\d/', $phoneRaw) ? null : ApplicationService::normalizePhone($phoneRaw);
            if ($phone === null) {
                $warnings[] = "Nomor telepon '{$phoneRaw}' tidak valid/terpotong; dilengkapi manual oleh NIAGA_RETAIL.";
            }
        }

        $requested = $this->date($g('TGLMOHON'), 'TGLMOHON', $warnings);
        $paid = $this->date($g('TGLBAYAR'), 'TGLBAYAR', $warnings);
        // A date earlier than the application date is impossible; it is the signature of a day/month swap in a re-typed file: ignored, not "fixed".
        if ($requested !== null && $paid !== null && $paid < $requested) {
            $warnings[] = "TGLBAYAR {$paid} lebih awal dari TGLMOHON {$requested}; tidak masuk akal, diabaikan.";
            $paid = null;
        }
        if ($requested !== null && $observed !== null && $observed < $requested) {
            $warnings[] = "TGL_UPDATE_PERMOHONAN {$observed} lebih awal dari TGLMOHON {$requested}; tidak masuk akal, diabaikan.";
            $observed = null;
            if ($internal !== null) {
                $warnings[] = 'TGL_UPDATE_PERMOHONAN tidak dapat dipercaya: status internal tidak diubah.';
            }
        }
        $newPower = $this->number($g('DAYA'), 'DAYA', $warnings);
        $oldPower = $this->number($g('DAYA_LAMA'), 'DAYA_LAMA', $warnings);
        foreach (['DAYA' => $newPower, 'DAYA_LAMA' => $oldPower] as $label => $v) {
            if ($v !== null && $v > 0 && $v < 10) {
                $warnings[] = "{$label} bernilai {$v}: satuan bawaan VA; periksa bila seharusnya kVA.";
            }
        }
        $days = $g('DURASI_HARI_KERJA');

        return [
            'agenda' => $g('NOAGENDA'), 'register' => $g('NO_REGISTRASI'), 'idpel' => preg_replace('/\.0+$/', '', $g('IDPEL')) ?? '', 'name' => $tidy($g('NAMA')), 'address' => $tidy($g('ALAMAT')),
            'phone' => $phone, 'type' => $type, 'transaction_type' => $transaction, 'old_tariff' => $g('TARIF_LAMA'), 'new_tariff' => $g('TARIF'), 'old_power' => $oldPower, 'new_power' => $newPower,
            'sar_package' => $g('PAKET_SAR'), 'total_cost' => $this->number($g('TOTALBIAYA'), 'TOTALBIAYA', $warnings), 'service_criteria' => $g('KRITERIA_TMP'),
            'requested_at' => $requested, 'paid_at' => $paid,
            'ext_status' => $status, 'observed_at' => $observed, 'service_days' => ctype_digit($days) ? (int) $days : null, 'internal_status' => $internal,
            'unit_code' => $g('UNITTUJUAN'), 'unit_name' => $tidy($g('NAMAUP')),
        ];
    }

    /** d/m/yyyy | d-m-yyyy | yyyy-mm-dd [time]; an Excel serial number is AMBIGUOUS (day/month swapped by US locales) and is never used. */
    private function date(string $v, string $label, array &$warnings): ?string
    {
        if ($v === '') {
            return null;
        }
        if (preg_match('/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/', $v, $m) && checkdate((int) $m[2], (int) $m[1], (int) $m[3])) {
            return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/', $v, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return "{$m[1]}-{$m[2]}-{$m[3]}";
        }
        $warnings[] = preg_match('/^\d{4,6}(\.\d+)?$/', $v)
            ? "{$label} '{$v}' adalah angka serial Excel (hari/bulan dapat tertukar oleh pengaturan regional); tidak dipakai. Gunakan berkas unduhan asli atau kolom teks d/m/yyyy."
            : "{$label} '{$v}' bukan tanggal d/m/yyyy; diabaikan.";

        return null;
    }

    private function number(string $v, string $label, array &$warnings): ?float
    {
        if ($v === '') {
            return null;
        }
        if (preg_match('/^\d+(\.\d+)?$/', $v)) {
            return (float) $v;
        }
        $warnings[] = "{$label} '{$v}' bukan angka biasa (notasi ilmiah/format lain); diabaikan.";

        return null;
    }

    /**
     * Compares the source row with the existing application. Only non-empty source values count; phone only fills an empty one.
     *
     * @param  array<string,mixed>  $n
     * @return array{0: array<string,mixed>, 1: list<string>, 2: ?string} changes, notes, conflict
     */
    private function diff(object $app, array $n): array
    {
        $changes = [];
        $notes = [];
        $conflict = null;
        // owner 2026-11-13: an application already in DISTRIVA is only refreshed in its working days and its status; everything else (customer, address, tariff, power, cost, register ...) stays as DISTRIVA has it
        if ($n['service_days'] !== null && $n['service_days'] !== ($app->service_days === null ? null : (int) $app->service_days)) {      // grows while the status stays the same: refreshed by every import
            $changes['service_days'] = ['old' => $app->service_days, 'new' => $n['service_days'], 'review' => false];
        }

        // the payment date (TGLBAYAR) starts the service SLA: filled once when DISTRIVA does not have it yet, never replaced
        if ($n['paid_at'] !== null && $app->paid_at === null) {
            $changes['paid_at'] = ['old' => null, 'new' => $n['paid_at'], 'review' => false];
        }

        // external status: always recorded once (history); moves the internal status only when newer, mapped and not terminal
        $changes['__history'] = false;
        $changes['__status'] = false;
        if ($n['ext_status'] !== '') {
            $changes['__history'] = ! DB::table('application_external_status_histories')->where('application_id', $app->id)->where('external_status_code', $n['ext_status'])
                ->where(fn ($q) => $n['observed_at'] === null ? $q->whereNull('observed_at') : $q->whereDate('observed_at', $n['observed_at']))->exists();
            if ($n['internal_status'] !== null && $n['observed_at'] !== null) {
                $last = $app->last_external_status_at === null ? null : CarbonImmutable::parse($app->last_external_status_at, config('distriva.business_timezone'))->toDateString();
                if (in_array($app->current_status, self::TERMINAL, true)) {
                    $notes[] = "Permohonan sudah {$app->current_status}; status eksternal '{$n['ext_status']}' hanya dicatat (tidak mengubah status).";
                } elseif ($last !== null && $n['observed_at'] <= $last) {
                    $notes[] = "Status eksternal '{$n['ext_status']}' tanggal {$n['observed_at']} tidak lebih baru dari yang tercatat ({$last}); tidak diterapkan.";
                } elseif ($n['internal_status'] !== $app->current_status) {
                    $changes['__status'] = ['old' => $app->current_status, 'new' => $n['internal_status'], 'review' => false];
                }
            }
        }

        return [$changes, $notes, $conflict];
    }

    /** @param array<string,mixed> $changes @return array<string,mixed> */
    private function previewChanges(array $changes): array
    {
        $out = [];
        foreach ($changes as $k => $v) {
            if ($k === '__history') {
                continue;
            }
            if ($k === '__status') {
                if ($v) {
                    $out['status'] = $v;
                }

                continue;
            }
            $out[$k] = $v;
        }

        return $out;
    }

    // ------------------------------------------------------------------------------------------------------
    // apply

    /**
     * @param  array{unrestricted: bool, units: list<string>}  $scope
     * @return array{0:string,1:?string} apply status, message
     */
    private function apply(object $row, string $batchId, array $scope, User $actor): array
    {
        $n = json_decode((string) $row->normalized, true);
        if (! $scope['unrestricted'] && ! in_array($row->organizational_unit_id, $scope['units'], true)) {
            return ['SKIPPED', 'Unit di luar scope impor pada saat konfirmasi.'];
        }
        $agenda = $n['agenda'];
        $existing = DB::table('application_external_references')->where('reference_type', 'AGENDA')->where('is_active', true)->where('reference_number', $agenda)->value('application_id');
        $unit = DB::table('organizational_units')->where('id', $row->organizational_unit_id)->first();

        if ($row->action === 'NEW') {
            if ($existing !== null) {
                return ['SKIPPED', 'No. Agenda sudah terdaftar sejak berkas ini disiapkan; gunakan impor baru untuk menyinkronkan.'];
            }

            return $this->applyNew($n, $unit, $batchId, $actor);
        }

        if ($existing === null || $existing !== $row->application_id) {
            return ['SKIPPED', 'Permohonan tidak ditemukan lagi untuk No. Agenda ini.'];
        }

        return $this->applyMatched($n, $existing, $batchId, $actor);
    }

    /** @param array<string,mixed> $n @return array{0:string,1:?string} */
    private function applyNew(array $n, object $unit, string $batchId, User $actor): array
    {
        $customerId = null;
        if ($n['idpel'] !== '') {
            $customerId = DB::table('customer_external_references')->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $n['idpel']])->whereNull('valid_until')->value('customer_id');
        }
        if ($customerId === null) {
            $customerId = (string) Str::uuid();
            DB::table('customers')->insert(['id' => $customerId, 'customer_number' => $this->applications->newCustomerNumber(), 'name' => $n['name'], 'phone' => $n['phone'], 'created_at' => now(), 'updated_at' => now()]);
            if ($n['idpel'] !== '') {
                DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $customerId, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $n['idpel'], 'is_primary' => true, 'created_at' => now(), 'updated_at' => now()]);
            }
        } elseif ($n['phone'] !== null && blank(DB::table('customers')->where('id', $customerId)->value('phone'))) {
            DB::table('customers')->where('id', $customerId)->update(['phone' => $n['phone'], 'updated_at' => now()]);
        }

        $fields = array_filter([
            'transaction_type' => $n['transaction_type'], 'service_address' => $n['address'] ?: null, 'old_tariff_code' => $n['old_tariff'] ?: null, 'new_tariff_code' => $n['new_tariff'] ?: null,
            'old_power_value' => $n['old_power'], 'old_power_unit' => $n['old_power'] === null ? null : 'VA', 'new_power_value' => $n['new_power'], 'new_power_unit' => $n['new_power'] === null ? null : 'VA',
            'sar_package' => $n['sar_package'] ?: null, 'total_cost' => $n['total_cost'], 'service_criteria' => $n['service_criteria'] ?: null,
            'source_created_at' => $n['requested_at'] === null ? null : CarbonImmutable::parse($n['requested_at'], config('distriva.business_timezone'))->toDateTimeString(),
            'paid_at' => $n['paid_at'],
        ], fn ($v) => $v !== null);
        $status = $n['internal_status'] ?? 'APPROVED';
        $id = $this->applications->createImported($unit, $customerId, $n['type'], $fields, $status, $n['agenda'], $actor, "Diimpor dari EIS (batch {$batchId}), status eksternal: ".($n['ext_status'] ?: 'tidak ada').'.');

        DB::table('application_external_references')->insert(['id' => (string) Str::uuid(), 'application_id' => $id, 'external_system' => 'AP2T', 'reference_type' => 'AGENDA', 'reference_number' => $n['agenda'],
            'registration_source' => 'BOT_DAFTUNG', 'received_at' => now(), 'received_by' => $actor->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        if ($n['register'] !== '' && ! $this->registerTakenByOther($n['register'], $id)) {
            DB::table('application_external_references')->insert(['id' => (string) Str::uuid(), 'application_id' => $id, 'external_system' => 'AP2T', 'reference_type' => 'PAYMENT_REGISTER', 'reference_number' => $n['register'],
                'registration_source' => 'BOT_DAFTUNG', 'received_at' => now(), 'received_by' => $actor->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->externalHistory($id, $n, $batchId, $n['internal_status'] !== null && $n['observed_at'] !== null ? $status : null);
        $n['service_days'] !== null && DB::table('applications')->where('id', $id)->update(['service_days' => $n['service_days'], 'service_days_observed_at' => $n['observed_at'] === null ? now() : CarbonImmutable::parse($n['observed_at'], config('distriva.business_timezone'))->toDateTimeString()]);
        if ($n['internal_status'] !== null && $n['observed_at'] !== null) {
            DB::table('applications')->where('id', $id)->update(['last_external_status_at' => CarbonImmutable::parse($n['observed_at'], config('distriva.business_timezone'))->toDateTimeString()]);
        }

        return ['APPLIED', "Permohonan dibuat (status {$status})."];
    }

    private function registerTakenByOther(string $register, string $appId): bool
    {
        return DB::table('application_external_references')->where('reference_type', 'PAYMENT_REGISTER')->where('is_active', true)->where('reference_number', $register)->where('application_id', '<>', $appId)->exists();
    }

    /** @param array<string,mixed> $n @return array{0:string,1:?string} */
    private function applyMatched(array $n, string $appId, string $batchId, User $actor): array
    {
        $app = DB::table('applications')->where('id', $appId)->lockForUpdate()->first();
        [$changes] = $this->diff($app, $n);
        $log = function (string $field, mixed $old, mixed $new, bool $review) use ($appId, $batchId, $actor): void {
            DB::table('application_change_logs')->insert(['id' => (string) Str::uuid(), 'application_id' => $appId, 'field_name' => $field, 'old_value' => $old === null ? null : (string) $old, 'new_value' => $new === null ? null : (string) $new,
                'source' => 'IMPORT', 'batch_id' => $batchId, 'needs_review' => $review, 'changed_by' => $actor->getKey(), 'changed_at' => now()]);
        };
        $applied = 0;
        $appUpdate = [];
        foreach ($changes as $field => $ch) {
            if (str_starts_with($field, '__')) {
                continue;
            }
            $applied++;
            $field !== 'service_days' && $log($field, $ch['old'], $ch['new'], (bool) $ch['review']);      // a derived duration that moves daily: kept on the application, not in the change log
            switch ($field) {
                case 'customer.name':
                    DB::table('customers')->where('id', $app->customer_id)->update(['name' => $n['name'], 'updated_at' => now()]);
                    break;
                case 'customer.phone':
                    DB::table('customers')->where('id', $app->customer_id)->update(['phone' => $n['phone'], 'updated_at' => now()]);
                    break;
                case 'customer.idpel':
                    DB::table('customer_external_references')->where('customer_id', $app->customer_id)->where(['source_system' => 'AP2T', 'reference_type' => 'IDPEL'])->whereNull('valid_until')->update(['valid_until' => now(), 'is_primary' => false, 'updated_at' => now()]);
                    DB::table('customer_external_references')->insert(['id' => (string) Str::uuid(), 'customer_id' => $app->customer_id, 'source_system' => 'AP2T', 'reference_type' => 'IDPEL', 'reference_value' => $n['idpel'], 'is_primary' => true, 'created_at' => now(), 'updated_at' => now()]);
                    break;
                case 'payment_register':
                    DB::table('application_external_references')->where('application_id', $appId)->where('reference_type', 'PAYMENT_REGISTER')->where('is_active', true)->update(['is_active' => false, 'updated_at' => now()]);
                    DB::table('application_external_references')->insert(['id' => (string) Str::uuid(), 'application_id' => $appId, 'external_system' => 'AP2T', 'reference_type' => 'PAYMENT_REGISTER', 'reference_number' => $n['register'],
                        'registration_source' => 'BOT_DAFTUNG', 'received_at' => now(), 'received_by' => $actor->getKey(), 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
                    break;
                case 'new_power':
                    $appUpdate['new_power_value'] = $n['new_power'];
                    $appUpdate['new_power_unit'] = 'VA';
                    break;
                case 'old_power':
                    $appUpdate['old_power_value'] = $n['old_power'];
                    $appUpdate['old_power_unit'] = 'VA';
                    break;
                default:
                    $appUpdate[$field] = $ch['new'];
            }
        }
        isset($changes['service_days']) && $appUpdate['service_days_observed_at'] = $n['observed_at'] === null ? now() : CarbonImmutable::parse($n['observed_at'], config('distriva.business_timezone'))->toDateTimeString();
        if ($appUpdate !== []) {
            $merged = array_merge((array) $app, $appUpdate);
            $power = $this->applications->derivePower($app->application_type, array_intersect_key($merged, array_flip(['old_power_value', 'old_power_unit', 'new_power_value', 'new_power_unit', 'old_tariff_code'])));
            DB::table('applications')->where('id', $appId)->update(array_merge($appUpdate, ['delta_power_kva' => $power['delta_power_kva']], ['updated_at' => now()]));
        }

        $status = $changes['__status'] ?? false;
        $this->externalHistory($appId, $n, $batchId, $status ? $status['new'] : null);
        if ($status) {
            DB::table('applications')->where('id', $appId)->update(['current_status' => $status['new'], 'last_external_status_at' => CarbonImmutable::parse($n['observed_at'], config('distriva.business_timezone'))->toDateTimeString(), 'updated_at' => now()]);
            $this->applications->recordStatus($appId, $status['old'], $status['new'], $actor, "Status eksternal EIS '{$n['ext_status']}' ({$n['observed_at']}), batch {$batchId}.");
        }

        return ['APPLIED', "{$applied} kolom diperbarui".($status ? ", status {$status['old']} -> {$status['new']}" : '').'.'];
    }

    /** @param array<string,mixed> $n */
    private function externalHistory(string $appId, array $n, string $batchId, ?string $appliedInternal): void
    {
        if ($n['ext_status'] === '') {
            return;
        }
        $exists = DB::table('application_external_status_histories')->where('application_id', $appId)->where('external_status_code', $n['ext_status'])
            ->where(fn ($q) => $n['observed_at'] === null ? $q->whereNull('observed_at') : $q->whereDate('observed_at', $n['observed_at']))->exists();
        if ($exists) {
            return;
        }
        $observed = $n['observed_at'] === null ? null : CarbonImmutable::parse($n['observed_at'], config('distriva.business_timezone'))->toDateTimeString();
        DB::table('application_external_status_histories')->insert(['id' => (string) Str::uuid(), 'application_id' => $appId, 'external_system' => self::SYSTEM, 'external_status_code' => $n['ext_status'],
            'external_status_name' => $n['ext_status'], 'service_days' => $n['service_days'], 'observed_at' => $observed,
            'received_at' => now(), 'batch_id' => $batchId, 'applied_internal_status' => $appliedInternal, 'note' => $n['internal_status'] === null ? 'Belum dipetakan ke status internal.' : null]);
        $this->recordConnectionDate($appId, $n['ext_status'], $observed);
    }

    /**
     * Tanggal sambung permohonan PB dan PD = tanggal pertama status PEREMAJAAN di EIS, disimpan pada `completed_at` (owner 26 Nov 2026; untuk PD itu tanggal naik daya). Hanya mengisi yang masih kosong
     * (penutupan WO internal yang sudah mengisi `completed_at` tidak ditimpa), dan tidak untuk permohonan yang masih terhubung ke usulan penambahan jaringan: `completed_at`-nya mengikuti rancangan awal
     * (diisi saat penutupan BASTP, docs/78), bukan status EIS.
     */
    private function recordConnectionDate(string $appId, string $extStatus, ?string $observed): void
    {
        if ($observed === null || mb_strtoupper(trim($extStatus)) !== 'PEREMAJAAN') {
            return;
        }
        DB::table('applications')->where('id', $appId)->whereIn('application_type', ['PB', 'PD'])->whereNull('completed_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('proposal_applications as pa')->whereColumn('pa.application_id', 'applications.id')->whereNull('pa.released_at'))
            ->update(['completed_at' => $observed, 'updated_at' => now()]);
    }
}
