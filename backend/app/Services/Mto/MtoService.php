<?php

namespace App\Services\Mto;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Formula\FormulaException;
use App\Models\User;
use App\Services\Bom\BomCalculator;
use App\Services\Documents\DocumentService;
use App\Services\WorkOrders\MaterialOutbox;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * MTO per drawing version (stage 4A; owner decisions 2026-11-06). Writes only; the controller authorizes the actor first.
 * TEKNIK (author of the drawing version) enters the quantity of every construction; the BOM engine computes the material need from the APPROVED BOM
 * of each group valid on the verification date; the TEKNIK verifies (a frozen snapshot + hash) and MANAGER_ULP approves (verifier != approver; a rejection
 * reopens the package). An APPROVED MTO is the prerequisite of the drawing's ULP_MANAGER approval (docs/26 §4).
 */
class MtoService
{
    private const OPEN_APPLICATION = ['APPROVED', 'PAID', 'PK_PRINTED'];

    /** The two 3-phase SR-APP groups: no construction rows, driven by the drawing's PBPD block. */
    public const PBPD_GROUPS = ['PBPD_6_41', 'PBPD_53_197'];

    /** The 1-phase SR-APP group (APP 1 PHASA: SDES-1 from the drawing's PBPD block, SDES-2 typed as parameter SR1:SDES2). It joins a calculation only when an APPROVED BOM of it is valid, so a 3-phase job never waits for it. */
    public const SR1_GROUP = 'SR1PH';

    /** Every group that has no construction rows (the BOM calculator needs no construction quantities for them). */
    public const PARAM_DRIVEN_GROUPS = ['PBPD_6_41', 'PBPD_53_197', 'SR1PH'];

    public function __construct(private readonly BomCalculator $calculator) {}

    /** @return string package id */
    public function create(string $drawingId, string $versionId, bool $copyFromPrevious, User $actor): string
    {
        try {
            return DB::transaction(function () use ($drawingId, $versionId, $copyFromPrevious, $actor): string {
                [$drawing, $version, $app] = $this->context($drawingId, $versionId);
                $this->requireOpenVersion($version);
                $this->requireAuthor($version, $actor);
                if (DB::table('mto_packages')->where('drawing_version_id', $versionId)->exists()) {
                    throw new AssignmentRuleViolation('Versi gambar ini sudah memiliki paket MTO.');
                }
                $id = (string) Str::uuid();
                DB::table('mto_packages')->insert(['id' => $id, 'application_id' => $app->id, 'drawing_version_id' => $versionId, 'package_number' => "MTO-{$app->application_number}-V{$version->version_number}",
                    'status' => 'DRAFT', 'params' => '{}', 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
                $copied = 0;
                if ($copyFromPrevious) {
                    $prev = DB::table('mto_packages as p')->join('application_drawing_versions as v', 'v.id', '=', 'p.drawing_version_id')->where('v.drawing_id', $drawingId)->where('v.version_number', '<', $version->version_number)
                        ->orderByDesc('v.version_number')->first(['p.id', 'p.params']);
                    if ($prev !== null) {
                        $items = DB::table('mto_items')->where('package_id', $prev->id)->get();
                        foreach ($items as $it) {
                            DB::table('mto_items')->insert(['id' => (string) Str::uuid(), 'package_id' => $id, 'construction_type_id' => $it->construction_type_id, 'group_code' => $it->group_code, 'construction_code' => $it->construction_code,
                                'construction_label' => $it->construction_label, 'psg' => $it->psg, 'bkr' => $it->bkr, 'source' => 'MANUAL', 'note' => $it->note, 'created_at' => now(), 'updated_at' => now()]);
                            $copied++;
                        }
                        DB::table('mto_packages')->where('id', $id)->update(['params' => $prev->params]);
                    }
                }
                $this->event($id, 'CREATED', $actor, null, ['copied_items' => $copied]);

                return $id;
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /**
     * Replaces the whole item set (and parameters) of a DRAFT package. After the first fill a reason is mandatory; the before/after is logged.
     *
     * @param  list<array{construction_code:string, psg?:int|float|string|null, bkr?:int|float|string|null, note?:?string}>  $items
     * @param  array<string,int|float>  $params
     * @param  array<string,array{psg:float,bkr:float}>  $detected  extraction candidates by construction code (kept from the previous rows when not given)
     */
    public function replaceItems(string $packageId, array $items, array $params, ?string $reason, User $actor, array $detected = [], array $eventExtra = []): void
    {
        try {
            DB::transaction(function () use ($packageId, $items, $params, $reason, $actor, $detected, $eventExtra): void {
                $pkg = $this->lockPackage($packageId);
                $this->requireDraft($pkg);
                [, $version] = $this->contextOfPackage($pkg);
                $this->requireOpenVersion($version);
                $this->requireAuthor($version, $actor);

                $today = $this->today();
                $rows = [];
                $seen = [];
                foreach (DB::table('mto_items')->where('package_id', $packageId)->whereNotNull('detected_psg')->get(['construction_code', 'detected_psg', 'detected_bkr']) as $old) {
                    $detected[$old->construction_code] ??= ['psg' => (float) $old->detected_psg, 'bkr' => (float) $old->detected_bkr];
                }
                foreach ($items as $i => $it) {
                    $code = trim((string) ($it['construction_code'] ?? ''));
                    $type = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->where('t.code', $code)->where('t.is_active', true)
                        ->where('v.status', 'APPROVED')->where('v.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('v.valid_until')->orWhere('v.valid_until', '>=', $today))->first(['t.id', 't.group_code', 't.code', 'v.name']);
                    if ($type === null) {
                        throw ValidationException::withMessages(["items.{$i}.construction_code" => "Jenis konstruksi {$code} tidak dikenal atau belum disetujui."]);
                    }
                    if (isset($seen[$type->id])) {
                        throw ValidationException::withMessages(["items.{$i}.construction_code" => "Jenis konstruksi {$code} muncul lebih dari sekali."]);
                    }
                    $seen[$type->id] = true;
                    $psg = (float) ($it['psg'] ?? 0);
                    $bkr = (float) ($it['bkr'] ?? 0);
                    if ($psg < 0 || $bkr < 0) {
                        throw ValidationException::withMessages(["items.{$i}" => 'Jumlah tidak boleh negatif.']);
                    }
                    $det = $detected[$type->code] ?? null;
                    if ($psg == 0.0 && $bkr == 0.0 && $det === null) {
                        continue;                                  // an empty row carries no quantity (a row the extraction saw stays, so the difference is visible)
                    }
                    $rows[] = ['id' => (string) Str::uuid(), 'package_id' => $packageId, 'construction_type_id' => $type->id, 'group_code' => $type->group_code, 'construction_code' => $type->code, 'construction_label' => $type->name,
                        'psg' => $psg, 'bkr' => $bkr, 'detected_psg' => $det['psg'] ?? null, 'detected_bkr' => $det['bkr'] ?? null,
                        'source' => $det !== null && $det['psg'] == $psg && $det['bkr'] == $bkr ? 'EXTRACTED' : 'MANUAL',
                        'note' => isset($it['note']) ? mb_substr(trim((string) $it['note']), 0, 300) : null, 'created_at' => now(), 'updated_at' => now()];
                }
                $this->validateParams($params, $this->withPbpd(array_values(array_unique(array_column($rows, 'group_code'))), $params), $today);

                $before = DB::table('mto_items')->where('package_id', $packageId)->orderBy('construction_code')->get(['construction_code', 'psg', 'bkr'])->map(fn ($r) => ['code' => $r->construction_code, 'psg' => (float) $r->psg, 'bkr' => (float) $r->bkr])->all();
                $filled = DB::table('mto_events')->where('package_id', $packageId)->where('event_type', 'ITEMS_CHANGED')->exists();
                if ($filled && blank($reason)) {
                    throw new AssignmentRuleViolation('Perubahan setelah isian pertama wajib disertai alasan.');
                }
                DB::table('mto_items')->where('package_id', $packageId)->delete();
                if ($rows !== []) {
                    DB::table('mto_items')->insert($rows);
                }
                DB::table('mto_packages')->where('id', $packageId)->update(['params' => json_encode((object) $params), 'updated_at' => now()]);
                $after = array_map(fn ($r) => ['code' => $r['construction_code'], 'psg' => $r['psg'], 'bkr' => $r['bkr']], $rows);
                usort($after, fn ($a, $b) => strcmp($a['code'], $b['code']));
                $this->event($packageId, 'ITEMS_CHANGED', $actor, $reason, ['before' => $before, 'after' => $after, 'params' => $params] + $eventExtra);
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /**
     * Stage 4B: reads the GAMBAR sheet of the MAIN Excel file of the drawing version and fills the DRAFT package with what it found.
     * Constructions are matched by group + name against the APPROVED types; whatever cannot be matched is only reported. The numbers are
     * candidates: TEKNIK may change them (the original detection stays visible) and still verifies the package.
     *
     * @return array{matched:list<array<string,mixed>>, unmatched:list<array<string,mixed>>, warnings:list<array<string,mixed>>, pbpd:list<array<string,mixed>>, file:array<string,mixed>}
     */
    public function extract(string $packageId, ?string $reason, User $actor, DocumentService $documents, ?string $documentId = null): array
    {
        $pkg = DB::table('mto_packages')->where('id', $packageId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        [, $version] = $this->contextOfPackage($pkg);
        $this->requireOpenVersion($version);
        $this->requireAuthor($version, $actor);

        // default: the MAIN file of the version; or one chosen file (xlsx/xls/pdf) of the same drawing version
        $file = DB::table('application_documents as d')->join('application_document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->where('d.drawing_version_id', $pkg->drawing_version_id)->where('d.status', 'ACTIVE')
            ->when($documentId !== null, fn ($q) => $q->where('d.id', $documentId), fn ($q) => $q->where('d.file_role', 'MAIN'))
            ->first(['v.id', 'v.stored_key', 'v.extension', 'v.original_name', 'v.sha256', 'v.lifecycle_status', 'v.version_number', 'd.id as document_id']);
        if ($file === null) {
            throw new AssignmentRuleViolation($documentId === null ? 'Versi gambar belum memiliki berkas utama.' : 'Berkas tidak ditemukan pada versi gambar ini.');
        }
        if (! in_array($file->extension, ['xlsx', 'xls', 'pdf'], true)) {
            throw new AssignmentRuleViolation('Berkas ini bukan Excel (xlsx/xls) atau PDF hasil ekspor Excel; jumlah tidak dapat dibaca otomatis (gambar/foto/DWG tidak dibaca). Isi jumlah secara manual.');
        }
        $disk = Storage::disk($documents->disk());
        $documents->assertReadable($file, $disk);
        $tmp = tempnam(sys_get_temp_dir(), 'gmb');
        try {
            file_put_contents($tmp, $disk->get($file->stored_key));
            $read = $file->extension === 'pdf' ? (new PdfGambarReader)->read($tmp) : (new GambarReader)->read($tmp, $file->extension);
        } catch (\InvalidArgumentException $e) {
            throw new AssignmentRuleViolation($e->getMessage());
        } finally {
            @unlink($tmp);
        }

        $today = $this->today();
        $types = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->where('t.is_active', true)->where('v.status', 'APPROVED')
            ->where('v.valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('v.valid_until')->orWhere('v.valid_until', '>=', $today))->get(['t.group_code', 't.code', 'v.name']);
        $index = [];
        foreach ($types as $t) {
            $index[$t->group_code.'|'.$this->norm($t->name)][] = $t->code;
        }

        $matched = [];
        $unmatched = [];
        $byCode = [];
        foreach ($read['items'] as $it) {
            $codes = $index[$it['group'].'|'.$this->norm($it['label'])] ?? [];
            if (count($codes) !== 1) {
                $unmatched[] = $it + ['reason' => $codes === [] ? 'UNKNOWN_CONSTRUCTION' : 'AMBIGUOUS_CONSTRUCTION'];

                continue;
            }
            $byCode[$codes[0]] = ['psg' => $it['psg'], 'bkr' => $it['bkr']];
            $matched[] = $it + ['construction_code' => $codes[0]];
        }

        [$pbpdParams, $pbpdUnmatched, $pbpdApplied] = $this->pbpdParams($read, $today);
        $params = (array) json_decode((string) $pkg->params, true);
        if ($pbpdApplied) {
            $params = array_filter($params, fn ($k) => ! str_starts_with((string) $k, 'PBPD:'), ARRAY_FILTER_USE_KEY) + $pbpdParams;
        }
        $this->replaceItems($packageId, array_map(fn ($c, $q) => ['construction_code' => $c, 'psg' => $q['psg'], 'bkr' => $q['bkr']], array_keys($byCode), $byCode),
            $params, $reason, $actor, $byCode,
            ['extracted_from' => ['file' => $file->original_name, 'file_version' => (int) $file->version_number, 'sha256' => $file->sha256, 'format' => $file->extension, 'matched' => count($matched), 'unmatched' => count($unmatched), 'warnings' => count($read['warnings']), 'pbpd' => count($read['pbpd']), 'pbpd_applied' => $pbpdApplied, 'pbpd_unmatched' => count($pbpdUnmatched)]]);

        return ['matched' => $matched, 'unmatched' => $unmatched, 'warnings' => $read['warnings'], 'pbpd' => $read['pbpd'], 'pbpd_applied' => $pbpdApplied, 'pbpd_unmatched' => $pbpdUnmatched,
            'file' => ['name' => $file->original_name, 'format' => $file->extension, 'version_number' => (int) $file->version_number, 'sha256' => $file->sha256, 'document_id' => $file->document_id]];
    }

    /**
     * PBPD block -> BOM parameters PBPD:RENTANG_n / PSG_n / BKR_n (+ JENIS, PEMBAYARAN when the file states them). Applied only when both PBPD
     * BOMs are approved and every range label is a known option; 7700 VA is the same range (and price) as 450-5500 VA (owner 2026-11-07).
     *
     * @param  array<string,mixed>  $read
     * @return array{0:array<string,mixed>, 1:list<array<string,mixed>>, 2:bool}
     */
    private function pbpdParams(array $read, string $today): array
    {
        $defs = [];
        foreach (self::PBPD_GROUPS as $g) {
            $h = DB::table('bom_headers')->where('group_code', $g)->where('status', 'APPROVED')->where('valid_from', '<=', $today)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->first();
            if ($h === null) {
                return [[], [], false];                         // PBPD BOM not approved yet: nothing to drive, the block stays a report only
            }
            foreach ((array) json_decode((string) $h->parameters, true) as $d) {
                $defs[$d['name']] = $d;
            }
        }
        $key = fn (string $x): string => preg_replace('/[\s.]+/u', '', mb_strtolower($x));
        $opt = fn (string $name, string $label): ?string => collect($defs[$name]['options'] ?? [])->first(fn ($o) => $key($o) === $key($label));
        $alias = ['7700va' => '450-5500 VA', '450-5500dan7700va' => '450-5500 VA', '450-5500va&7700va' => '450-5500 VA'];
        $params = [];
        $unmatched = [];
        $n = 0;
        foreach ($read['pbpd'] as $row) {
            $label = isset($alias[$key($row['label'])]) ? $alias[$key($row['label'])] : $opt('PBPD:RENTANG_1', $row['label']);
            if ($label === null || $n >= 6) {
                $unmatched[] = $row + ['reason' => $label === null ? 'UNKNOWN_RANGE' : 'TOO_MANY_ROWS'];

                continue;
            }
            $n++;
            $params["PBPD:RENTANG_{$n}"] = $label;
            $params["PBPD:PSG_{$n}"] = (float) $row['psg'];
            $params["PBPD:BKR_{$n}"] = (float) $row['bkr'];
        }
        for ($i = $n + 1; $i <= 6; $i++) {
            $params["PBPD:RENTANG_{$i}"] = '';
            $params["PBPD:PSG_{$i}"] = 0.0;
            $params["PBPD:BKR_{$i}"] = 0.0;
        }
        foreach (['job_type' => 'PBPD:JENIS', 'payment' => 'PBPD:PEMBAYARAN'] as $f => $name) {
            $v = (string) ($read['pbpd_meta'][$f] ?? '');
            if ($v !== '' && ($o = $opt($name, $v)) !== null) {
                $params[$name] = $o;
            }
        }

        return [$params, $unmatched, true];
    }

    private function norm(string $s): string
    {
        return mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $s)));
    }

    /**
     * Pure calculation for the current items on a date. Nothing is stored.
     *
     * @return array{valid_on:string, groups:array<string,array<string,mixed>>, lines:list<array<string,mixed>>, totals:list<array<string,mixed>>}
     */
    public function calculate(string $packageId, ?string $date = null): array
    {
        $pkg = DB::table('mto_packages')->where('id', $packageId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $date ??= $this->today();
        $items = DB::table('mto_items')->where('package_id', $packageId)->get();
        $params = (array) json_decode((string) $pkg->params, true);
        $powerParams = $this->applicationPowerParams((string) $pkg->application_id);
        $groups = [];
        $lines = [];
        $volumes = [];                                         // rows without a KHS code (their H is the group volume the REKAP shows), by group and BOM row

        $byGroup = $items->groupBy('group_code');
        foreach ($this->withPbpd($byGroup->keys()->all(), $params) as $g) {   // PBPD (pasang baru/perubahan daya) has no construction rows: it is driven by the PBPD:* parameters
            if (! $byGroup->has($g)) {
                $byGroup[$g] = collect();
            }
        }
        foreach ($byGroup as $group => $gItems) {
            $header = DB::table('bom_headers')->where('group_code', $group)->where('status', 'APPROVED')->where('valid_from', '<=', $date)
                ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $date))->first();
            if ($header === null) {
                throw new AssignmentRuleViolation("BOM kelompok {$group} belum disetujui/berlaku pada {$date}; MTO tidak dapat dihitung.");
            }
            $inputs = [];
            foreach ($gItems as $it) {
                $inputs[$it->construction_code] = ['psg' => (float) $it->psg, 'bkr' => (float) $it->bkr];
            }
            $declared = array_column((array) json_decode((string) $header->parameters, true), 'name');
            try {
                $res = $this->calculator->calculate($header->id, $inputs, array_intersect_key($powerParams + $params, array_flip($declared)));
            } catch (FormulaException $e) {
                throw new AssignmentRuleViolation("Perhitungan BOM {$group} gagal: ".$e->getMessage());
            }
            $groups[$group] = ['bom_header_id' => $header->id, 'bom_version' => $header->version_number, 'items' => count($inputs)];
            foreach ($res as $l) {
                if ($l['khs_code'] === null && ! $l['aggregate']) {
                    $volumes[$group][$l['sequence']] = ['description' => $l['description'], 'quantity' => (float) $l['material']];
                }
                if ($l['khs_code'] === null || $l['aggregate'] || ($l['material'] == 0.0 && $l['install'] == 0.0 && $l['remove'] == 0.0 && $l['return'] == 0.0)) {
                    continue;                                      // helper/subtotal rows, insurance-basis (aggregate) rows and rows without any quantity
                }
                $lines[] = ['group' => $group, 'bom_header_id' => $header->id, 'sequence' => $l['sequence'], 'khs_code' => (string) $l['khs_code'], 'material' => $l['material'], 'install' => $l['install'], 'remove' => $l['remove'], 'return' => $l['return']];
            }
        }

        $khs = $this->khsInfo(array_values(array_unique(array_column($lines, 'khs_code'))), $date);
        foreach ($lines as &$l) {
            $l['khs_item_id'] = $khs[$l['khs_code']]['id'] ?? null;
            $l['khs_name'] = $khs[$l['khs_code']]['name'] ?? null;
            $l['unit_text'] = $khs[$l['khs_code']]['unit'] ?? null;
        }
        unset($l);
        usort($lines, fn ($a, $b) => [$a['group'], $a['sequence']] <=> [$b['group'], $b['sequence']]);

        $totals = [];
        foreach ($lines as $l) {
            $t = &$totals[$l['khs_code']];
            $t ??= ['khs_code' => $l['khs_code'], 'khs_name' => $l['khs_name'], 'unit_text' => $l['unit_text'], 'material' => 0.0, 'install' => 0.0, 'remove' => 0.0, 'return' => 0.0];
            foreach (['material', 'install', 'remove', 'return'] as $c) {
                $t[$c] += $l[$c];
            }
            unset($t);
        }
        uksort($totals, fn ($a, $b) => (int) $a <=> (int) $b);

        return ['valid_on' => $date, 'groups' => $groups, 'lines' => $lines, 'totals' => array_values($totals), 'volumes' => $volumes];
    }

    public function verify(string $packageId, User $actor): void
    {
        try {
            DB::transaction(function () use ($packageId, $actor): void {
                $pkg = $this->lockPackage($packageId);
                $this->requireDraft($pkg, 'diverifikasi');
                [, $version] = $this->contextOfPackage($pkg);
                $this->requireOpenVersion($version);
                $this->requireAuthor($version, $actor);
                if (! DB::table('mto_items')->where('package_id', $packageId)->exists()) {
                    throw new AssignmentRuleViolation('Isi jumlah konstruksi lebih dulu; MTO kosong tidak dapat diverifikasi.');
                }
                $calc = $this->calculate($packageId);
                $missing = array_filter($calc['lines'], fn ($l) => $l['khs_item_id'] === null);
                if ($missing !== []) {
                    throw new AssignmentRuleViolation('Sebagian kode KHS pada BOM belum memiliki versi KHS yang disetujui dan berlaku pada '.$calc['valid_on'].'.');
                }
                foreach ($calc['lines'] as $l) {
                    DB::table('mto_lines')->insert(['id' => (string) Str::uuid(), 'package_id' => $packageId, 'group_code' => $l['group'], 'bom_header_id' => $l['bom_header_id'], 'sequence' => $l['sequence'], 'khs_item_id' => $l['khs_item_id'],
                        'khs_code' => $l['khs_code'], 'khs_name' => $l['khs_name'], 'unit_text' => $l['unit_text'], 'material' => round($l['material'], 6), 'install' => round($l['install'], 6), 'remove' => round($l['remove'], 6), 'return' => round($l['return'], 6)]);
                }
                $hash = $this->hash($packageId, $calc);
                DB::table('mto_packages')->where('id', $packageId)->update(['status' => 'VERIFIED', 'valid_on' => $calc['valid_on'], 'snapshot_hash' => $hash, 'verified_by' => $actor->getKey(), 'verified_at' => now(), 'updated_at' => now()]);
                $this->event($packageId, 'VERIFIED', $actor, null, ['hash' => $hash, 'valid_on' => $calc['valid_on'], 'lines' => count($calc['lines']), 'boms' => array_map(fn ($g) => $g['bom_version'], $calc['groups'])]);
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /** MANAGER_ULP: APPROVED, or REJECTED (notes required) which reopens the package for the TEKNIK. */
    public function decide(string $packageId, string $decision, ?string $notes, User $actor): string
    {
        if ($decision === 'REJECTED' && blank($notes)) {
            throw new AssignmentRuleViolation('Penolakan wajib disertai alasan.');
        }
        try {
            return DB::transaction(function () use ($packageId, $decision, $notes, $actor): string {
                $pkg = $this->lockPackage($packageId);
                if ($pkg->status !== 'VERIFIED') {
                    throw new AssignmentRuleViolation("MTO berstatus {$pkg->status}; hanya paket VERIFIED yang dapat diputuskan.");
                }
                if (($pkg->verified_by === $actor->getKey() || $pkg->created_by === $actor->getKey()) && ! $actor->isSysAdmin()) {
                    throw new AdministrationDenied('Pemeriksa MTO tidak boleh menyetujuinya sendiri.', 403);
                }
                [, $version] = $this->contextOfPackage($pkg);
                $this->requireOpenVersion($version);
                if ($decision === 'APPROVED') {
                    DB::table('mto_packages')->where('id', $packageId)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($packageId, 'APPROVED', $actor, $notes === null ? null : trim($notes), ['hash' => $pkg->snapshot_hash]);
                    MaterialOutbox::refresh($pkg->application_id);   // the outbox follows the latest approved MTO

                    return 'APPROVED';
                }
                DB::table('mto_packages')->where('id', $packageId)->update(['status' => 'DRAFT', 'valid_on' => null, 'snapshot_hash' => null, 'verified_by' => null, 'verified_at' => null, 'updated_at' => now()]);
                DB::table('mto_lines')->where('package_id', $packageId)->delete();
                $this->event($packageId, 'REJECTED', $actor, trim((string) $notes), ['rejected_hash' => $pkg->snapshot_hash]);

                return 'DRAFT';
            });
        } catch (QueryException $e) {
            throw $this->translate($e);
        }
    }

    /**
     * One decision for drawing + MTO (owner decision 2026-11-11): the MANAGER_ULP approving the drawing at the ULP_MANAGER step approves its VERIFIED MTO in the same
     * transaction. Called inside the drawing decision's transaction; the verifier (TEKNIK) can never be the approver.
     */
    public function approveWithDrawing(string $packageId, User $actor, ?string $notes): void
    {
        $pkg = $this->lockPackage($packageId);
        if ($pkg->status === 'APPROVED') {
            return;
        }
        if ($pkg->status !== 'VERIFIED') {
            throw new AssignmentRuleViolation("MTO berstatus {$pkg->status}; hanya paket VERIFIED yang dapat disetujui bersama gambar.");
        }
        if (($pkg->verified_by === $actor->getKey() || $pkg->created_by === $actor->getKey()) && ! $actor->isSysAdmin()) {
            throw new AdministrationDenied('Pemeriksa MTO tidak boleh menyetujuinya sendiri.', 403);
        }
        DB::table('mto_packages')->where('id', $packageId)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
        $this->event($packageId, 'APPROVED', $actor, $notes === null ? null : trim($notes), ['hash' => $pkg->snapshot_hash, 'with_drawing' => true]);
    }

    /** True when the drawing version has an APPROVED MTO — the gate of the drawing's ULP_MANAGER approval. */
    public static function approvedFor(string $drawingVersionId): bool
    {
        return DB::table('mto_packages')->where('drawing_version_id', $drawingVersionId)->where('status', 'APPROVED')->exists();
    }

    // ------------------------------------------------------------------------------------------------------

    /** @return array{0:object,1:object,2:object} drawing, version, application */
    private function context(string $drawingId, string $versionId): array
    {
        $drawing = DB::table('application_drawings')->where('id', $drawingId)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $version = DB::table('application_drawing_versions')->where('id', $versionId)->where('drawing_id', $drawingId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $app = DB::table('applications')->where('id', $drawing->application_id)->first();
        if (! in_array($app->current_status, self::OPEN_APPLICATION, true)) {
            throw new AssignmentRuleViolation("Permohonan berstatus {$app->current_status}; MTO tidak dapat dilanjutkan.");
        }

        return [$drawing, $version, $app];
    }

    /** @return array{0:object,1:object,2:object} */
    private function contextOfPackage(object $pkg): array
    {
        $version = DB::table('application_drawing_versions')->where('id', $pkg->drawing_version_id)->first();

        return $this->context($version->drawing_id, $version->id);
    }

    /** The package follows its drawing version: editable while the version is a DRAFT or waits at the ULP manager. */
    private function requireOpenVersion(object $version): void
    {
        if (! ($version->status === 'DRAFT' || ($version->status === 'SUBMITTED' && $version->stage === 'ULP_MANAGER'))) {
            throw new AssignmentRuleViolation("Versi gambar berstatus {$version->status}; MTO hanya dapat dikerjakan saat versi DRAFT atau menunggu Manager ULP.");
        }
    }

    /** Role-based (owner 7 Nov 2026): any TEKNIK of the ULP (the controller checked `mto.execute` on the unit) works on the MTO of a customer of the ULP; nothing to check per user here. */
    private function requireAuthor(object $version, User $actor): void {}

    private function lockPackage(string $id): object
    {
        return DB::table('mto_packages')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    private function requireDraft(object $pkg, string $verb = 'diubah'): void
    {
        if ($pkg->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("MTO berstatus {$pkg->status}; hanya DRAFT yang dapat {$verb}.");
        }
    }

    private function today(): string
    {
        return CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();
    }

    /**
     * The power of the application (kVA) as BOM parameters: the APP sheets of the workbook choose their items by the power in 'ISIAN KKF' (F8 after, F7 before). Always taken
     * from the application, never typed; a new connection has no power before (0). Empty when the application has no new power.
     *
     * @return array<string,float>
     */
    private function applicationPowerParams(string $applicationId): array
    {
        $app = DB::table('applications')->where('id', $applicationId)->first(['new_power_value', 'new_power_unit', 'old_power_value', 'old_power_unit']);
        if ($app === null || $app->new_power_value === null) {
            return [];
        }
        $kva = fn ($v, $u) => $v === null ? 0.0 : (float) $v * (strtoupper((string) $u) === 'KVA' ? 1.0 : 0.001);

        return ['PERMOHONAN:DAYA_BARU_KVA' => $kva($app->new_power_value, $app->new_power_unit), 'PERMOHONAN:DAYA_LAMA_KVA' => $kva($app->old_power_value, $app->old_power_unit)];
    }

    /** The PBPD BOM groups join the calculation when any PBPD:* parameter is present; SR1PH when any PBPD:* or SR1:* parameter is present AND its BOM is approved (valid today). */
    private function withPbpd(array $groups, array $params): array
    {
        $pbpd = $sr1 = false;
        foreach (array_keys($params) as $k) {
            $pbpd = $pbpd || str_starts_with((string) $k, 'PBPD:');
            $sr1 = $sr1 || str_starts_with((string) $k, 'SR1:') || str_starts_with((string) $k, 'PBPD:');
        }
        if ($pbpd) {
            $groups = array_merge($groups, self::PBPD_GROUPS);
        }
        if ($sr1 && $this->sr1Approved()) {
            $groups[] = self::SR1_GROUP;
        }

        return array_values(array_unique($groups));
    }

    private function sr1Approved(): bool
    {
        $today = $this->today();

        return DB::table('bom_headers')->where('group_code', self::SR1_GROUP)->where('status', 'APPROVED')->where('valid_from', '<=', $today)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $today))->exists();
    }

    /** @param array<string,mixed> $params @param list<string> $groups */
    private function validateParams(array $params, array $groups, string $date): void
    {
        if ($params === []) {
            return;
        }
        $declared = [];
        foreach ($groups as $g) {
            $h = DB::table('bom_headers')->where('group_code', $g)->where('status', 'APPROVED')->where('valid_from', '<=', $date)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $date))->first();
            foreach ((array) json_decode((string) ($h->parameters ?? '[]'), true) as $d) {
                $declared[$d['name']] = $d;
            }
        }
        foreach ($params as $name => $value) {
            if (! isset($declared[$name])) {
                throw ValidationException::withMessages(['params' => "Parameter {$name} tidak dideklarasikan oleh BOM kelompok yang dipakai."]);
            }
            if (($declared[$name]['type'] ?? 'number') === 'text') {
                $opts = $declared[$name]['options'] ?? null;
                if (! is_string($value) || mb_strlen($value) > 100 || (is_array($opts) && $value !== '' && ! in_array($value, $opts, true))) {
                    throw ValidationException::withMessages(['params' => "Parameter {$name} harus salah satu pilihan yang tersedia."]);
                }

                continue;
            }
            if (! is_numeric($value) || $value < 0) {
                throw ValidationException::withMessages(['params' => "Parameter {$name} harus angka >= 0."]);
            }
        }
    }

    /** @param list<string> $codes @return array<string,array{id:string,name:?string,unit:?string}> */
    private function khsInfo(array $codes, string $date): array
    {
        $out = [];
        if ($codes === []) {
            return $out;
        }
        $rows = DB::table('khs_items as i')->join('khs_item_versions as v', 'v.khs_item_id', '=', 'i.id')->whereIn('i.code', $codes)->where('v.status', 'APPROVED')->where('v.valid_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('v.valid_until')->orWhere('v.valid_until', '>=', $date))->get(['i.id', 'i.code', 'v.name', 'v.unit_text']);
        foreach ($rows as $r) {
            $out[$r->code] = ['id' => $r->id, 'name' => $r->name, 'unit' => $r->unit_text];
        }

        return $out;
    }

    /** @param array<string,mixed> $calc */
    private function hash(string $packageId, array $calc): string
    {
        $items = DB::table('mto_items')->where('package_id', $packageId)->orderBy('construction_code')->get(['construction_code', 'psg', 'bkr'])->map(fn ($r) => [$r->construction_code, (float) $r->psg, (float) $r->bkr])->all();
        $params = (array) json_decode((string) DB::table('mto_packages')->where('id', $packageId)->value('params'), true);
        ksort($params);
        $lines = array_map(fn ($l) => [$l['group'], $l['sequence'], $l['khs_code'], round($l['material'], 6), round($l['install'], 6), round($l['remove'], 6), round($l['return'], 6)], $calc['lines']);

        return hash('sha256', json_encode(['items' => $items, 'params' => $params, 'valid_on' => $calc['valid_on'], 'boms' => array_map(fn ($g) => $g['bom_header_id'], $calc['groups']), 'lines' => $lines], JSON_UNESCAPED_UNICODE));
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $packageId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('mto_events')->insert(['id' => (string) Str::uuid(), 'package_id' => $packageId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(), 'reason' => $reason === null ? null : trim($reason),
            'details' => $details === null ? null : json_encode($details, JSON_UNESCAPED_UNICODE), 'occurred_at' => now()]);
    }

    private function translate(QueryException $e): \Throwable
    {
        return match ($e->getCode()) {
            '23505' => new AssignmentRuleViolation('Data bentrok dengan paket MTO yang sudah ada.', 0, $e),
            '23514', 'P0001' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas MTO.', 0, $e),
            default => $e,
        };
    }
}
