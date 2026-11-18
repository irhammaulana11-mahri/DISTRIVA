<?php

namespace App\Services\Bom;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Formula\FormulaException;
use App\Formula\Parser;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * BOM versions (docs/60): imports only create a DRAFT per group; a draft is approved by a different user (also a CHECK);
 * approved versions and their lines are immutable (triggers). Formulas are parsed by the closed-grammar Parser; GAMBAR
 * quantity cells become {PSG:code}/{BKR:code}; anything that cannot be translated is REPORTED and the whole import is
 * refused — never guessed (docs/23). Callers must authorize the actor first.
 */
class BomService
{
    /**
     * @param  array<string,mixed>  $doc  decoded tools/extract_bom_json.py output
     * @return array{summary: array<string,mixed>, problems: list<array<string,mixed>>}
     */
    public function import(array $doc, string $validFrom, ?string $source, bool $dryRun, User $actor): array
    {
        $group = (string) ($doc['group'] ?? '');
        if (! in_array($group, (array) config('distriva.bom_groups'), true)) {
            throw new AssignmentRuleViolation('Kelompok BOM tidak dikenal.');
        }
        $lines = $doc['lines'] ?? null;
        $inputs = $doc['inputs'] ?? [];
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if (! is_array($lines) || $lines === [] || count($lines) > $max || ! is_array($inputs) || count($inputs) > 2000) {
            throw new AssignmentRuleViolation('Berkas BOM tidak berisi baris yang valid atau melebihi batas.');
        }

        $cellMap = $this->cellMap($group, $inputs);
        foreach ((array) ($doc['constants'] ?? []) as $cell => $text) {   // fixed lists of the workbook (power ranges, job types) used as string literals
            if (is_string($cell) && preg_match('/^[A-Z]{1,3}\d+$/', $cell) && is_string($text) && $text !== '' && mb_strlen($text) <= 100) {
                $cellMap[$cell] = 'CONST:'.$text;
            }
        }
        [$params, $paramProblems] = $this->parameters($group, $doc['params'] ?? [], $cellMap);
        foreach ($params as $cell => $def) {
            $cellMap[$cell] = 'PARAM:'.$def['name'];
        }
        $khs = DB::table('khs_items')->pluck('id', 'code')->all();
        $problems = [];
        $prepared = [];
        $seen = [];
        $formulaCells = 0;

        foreach ($lines as $i => $line) {
            if (! is_array($line)) {
                $problems[] = ['row' => null, 'where' => 'baris #'.($i + 1), 'messages' => ['baris bukan objek.']];

                continue;
            }
            $seq = $line['sequence'] ?? null;
            $where = is_int($seq) ? "baris {$seq}" : 'baris #'.($i + 1);
            $errs = [];
            if (! is_int($seq) || $seq < 1 || $seq > 100000 || isset($seen[$seq])) {
                $errs[] = 'sequence tidak valid atau duplikat.';
            } else {
                $seen[$seq] = true;
            }
            $khsId = null;
            if (($line['khs_code'] ?? null) !== null) {
                $code = (string) $line['khs_code'];
                $khsId = $khs[$code] ?? null;
                if ($khsId === null) {
                    $errs[] = "kode KHS {$code} tidak ada di katalog.";
                }
            }
            $asts = [];
            $texts = [];
            foreach (['B', 'H', 'I', 'J', 'K'] as $col) {
                $text = $line[$col] ?? null;
                if ($text === null || trim((string) $text) === '') {
                    continue;
                }
                $texts[$col] = (string) $text;
                $formulaCells++;
                try {
                    $local = [];
                    $asts[$col] = BomAst::translate(Parser::parse((string) $text), $cellMap, $local);
                    foreach ($local as $p) {
                        $errs[] = "{$col}: {$p}";
                    }
                } catch (FormulaException $e) {
                    $errs[] = "{$col}: {$e->getMessage()}";
                }
            }
            foreach (isset($asts['B']) ? BomAst::codes($asts['B']) : [] as $c) {
                if (! isset($khs[$c])) {
                    $errs[] = "B: kode KHS {$c} (hasil rumus) tidak ada di katalog.";
                }
            }
            if ($asts === [] && $khsId === null && $errs === []) {
                $errs[] = 'baris tanpa rumus dan tanpa kode KHS.';
            }
            if ($errs !== []) {
                $problems[] = ['row' => is_int($seq) ? $seq : null, 'where' => $where, 'messages' => $errs];

                continue;
            }
            $prepared[] = ['sequence' => $seq, 'khs_item_id' => $khsId, 'description' => isset($line['description']) ? mb_substr(trim((string) $line['description']), 0, 500) : null,
                'formulas' => $asts, 'source' => $texts, 'source_reference' => isset($line['source']) ? mb_substr((string) $line['source'], 0, 100) : null];
        }

        $summary = ['group' => $group, 'total_lines' => count($lines), 'accepted_lines' => count($prepared), 'rejected_lines' => count($problems),
            'with_khs' => count(array_filter($prepared, fn ($p) => $p['khs_item_id'] !== null)), 'formula_cells' => $formulaCells, 'dry_run' => $dryRun, 'created' => false];

        foreach ($paramProblems as $msg) {
            $problems[] = ['row' => null, 'where' => 'params', 'messages' => [$msg]];
        }
        $summary['rejected_lines'] = count($problems);
        $summary['parameters'] = count($params);

        if ($problems !== [] || $dryRun) {
            if ($problems !== [] && ! $dryRun) {
                throw new AssignmentRuleViolation(count($problems).' baris BOM tidak dapat diimpor; seluruh impor dibatalkan (BOM saling bergantung antarbaris). Perbaiki dan ulangi; gunakan dry_run untuk daftar lengkap.');
            }

            return ['summary' => $summary, 'problems' => $problems];
        }

        $versionId = DB::transaction(function () use ($group, $validFrom, $source, $doc, $prepared, $params, $actor): string {
            DB::table('bom_headers')->where('group_code', $group)->lockForUpdate()->get();
            if (DB::table('bom_headers')->where('group_code', $group)->where('status', 'DRAFT')->exists()) {
                throw new AssignmentRuleViolation("Kelompok {$group} sudah memiliki draf BOM; setujui atau hapus draf itu lebih dulu.");
            }
            $id = (string) Str::uuid();
            $next = ((int) DB::table('bom_headers')->where('group_code', $group)->max('version_number')) + 1;
            DB::table('bom_headers')->insert(['id' => $id, 'group_code' => $group, 'version_number' => $next, 'name' => 'BOM '.(config('distriva.bom_group_names')[$group] ?? $group), 'valid_from' => $validFrom, 'status' => 'DRAFT',
                'source_reference' => $source ?? ($doc['source'] ?? null), 'parameters' => json_encode(array_values($params)), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($prepared, 200) as $chunk) {
                DB::table('bom_lines')->insert(array_map(fn ($p) => ['id' => (string) Str::uuid(), 'bom_header_id' => $id, 'sequence' => $p['sequence'], 'khs_item_id' => $p['khs_item_id'],
                    'description' => $p['description'], 'formulas' => json_encode((object) $p['formulas']), 'source_formulas' => json_encode((object) $p['source']),
                    'source_reference' => $p['source_reference'], 'created_at' => now(), 'updated_at' => now()], $chunk));
            }
            $this->saveInputMap($id, $group, $doc);
            $this->event($id, 'CREATED', $actor, null, ['lines' => count($prepared), 'version_number' => $next]);

            return $id;
        });

        return ['summary' => array_merge($summary, ['id' => $versionId, 'created' => true]), 'problems' => []];
    }

    /** @param array<string,mixed> $changes */
    public function updateDraft(string $headerId, array $changes, string $reason, User $actor): void
    {
        DB::transaction(function () use ($headerId, $changes, $reason, $actor): void {
            $h = DB::table('bom_headers')->where('id', $headerId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($h);
            $before = array_intersect_key((array) $h, $changes);
            $changes = array_filter($changes, fn ($v, $k) => $before[$k] !== $v, ARRAY_FILTER_USE_BOTH);
            if ($changes === []) {
                throw new AssignmentRuleViolation('Tidak ada perubahan yang dikirimkan.');
            }
            DB::table('bom_headers')->where('id', $headerId)->update($changes + ['updated_at' => now()]);
            $this->event($headerId, 'DRAFT_UPDATED', $actor, $reason, ['before' => array_intersect_key($before, $changes), 'after' => $changes]);
        });
    }

    /**
     * @param  list<string>  $ids
     * @return array{approved:int, auto_closed:int}
     */
    public function approve(array $ids, User $actor, string $reason): array
    {
        try {
            return DB::transaction(function () use ($ids, $actor, $reason): array {
                $headers = DB::table('bom_headers')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($headers->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian versi tidak ditemukan.');
                }
                foreach ($headers as $h) {
                    $this->requireDraft($h, 'disetujui');
                    if ($h->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat versi tidak dapat menyetujui versinya sendiri.', 403);
                    }
                    $this->requireReady($h);
                }
                $closed = 0;
                foreach ($headers as $h) {
                    $from = CarbonImmutable::parse($h->valid_from);
                    $current = DB::table('bom_headers')->where('group_code', $h->group_code)->where('status', 'APPROVED')
                        ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();
                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Versi baru harus berlaku setelah versi {$old->version_number} yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('bom_headers')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan versi yang lebih baru.', ['closed_by_version' => $h->id]);
                        $closed++;
                    }
                    DB::table('bom_headers')->where('id', $h->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($h->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $headers->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan versi BOM aktif lain untuk kelompok yang sama.', 0, $e),
                '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas versi.', 0, $e),
                default => $e,
            };
        }
    }

    public function retire(string $headerId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($headerId, $reason, $actor): void {
            $h = DB::table('bom_headers')->where('id', $headerId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($h->status !== 'APPROVED') {
                throw new AssignmentRuleViolation("Versi berstatus {$h->status}; hanya versi APPROVED yang dapat dinonaktifkan.");
            }
            $today = CarbonImmutable::now(config('distriva.business_timezone'))->toDateString();
            $until = $h->valid_until === null || $h->valid_until > $today ? max($today, $h->valid_from) : $h->valid_until;
            DB::table('bom_headers')->where('id', $headerId)->update(['status' => 'INACTIVE', 'valid_until' => $until, 'updated_at' => now()]);
            $this->event($headerId, 'RETIRED', $actor, $reason, ['valid_until' => $until]);
        });
    }

    /**
     * Calculates a document exactly as the engine would after approval, without keeping anything: the version is imported inside a transaction that is rolled back.
     * `typed` = GAMBAR cell => number (the drawing inputs typed in the workbook), `paramValues` = parameter name => value.
     *
     * @param  array<string,mixed>  $doc
     * @param  array<string,float>  $typed
     * @param  array<string,mixed>  $paramValues
     * @return array{rows:list<array<string,mixed>>, error:?string}
     */
    public function simulate(array $doc, array $typed, array $paramValues, User $actor): array
    {
        DB::beginTransaction();
        try {
            $created = $this->import($doc, now()->toDateString(), null, false, $actor);
            $cellMap = $this->cellMap((string) $doc['group'], (array) ($doc['inputs'] ?? []));
            $inputs = [];
            foreach ($typed as $cell => $v) {
                if (isset($cellMap[$cell]) && preg_match('/^(PSG|BKR):(.+)$/', $cellMap[$cell], $m)) {
                    $inputs[$m[2]][strtolower($m[1])] = (float) $v;
                }
            }

            return ['rows' => (new BomCalculator)->calculate((string) $created['summary']['id'], $inputs, $paramValues), 'error' => null];
        } catch (AssignmentRuleViolation|FormulaException $e) {
            return ['rows' => [], 'error' => $e->getMessage()];
        } finally {
            DB::rollBack();
        }
    }

    /** Keeps the drawing-sheet layout of the import (quantity cells and fixed list values) next to the version, for the master workbook. @param array<string,mixed> $doc */
    public function saveInputMap(string $headerId, string $group, array $doc): void
    {
        $inputs = [];
        foreach ((array) ($doc['inputs'] ?? []) as $in) {
            if (is_array($in) && ($in['group'] ?? null) === $group && in_array($in['kind'] ?? null, ['PSG', 'BKR'], true) && preg_match('/^[A-Z]{1,3}\d+$/', (string) ($in['cell'] ?? ''))) {
                $inputs[] = ['cell' => (string) $in['cell'], 'label' => mb_substr((string) ($in['label'] ?? ''), 0, 200), 'kind' => $in['kind']];
            }
        }
        $constants = [];
        foreach ((array) ($doc['constants'] ?? []) as $cell => $text) {
            if (is_string($cell) && preg_match('/^[A-Z]{1,3}\d+$/', $cell) && is_string($text) && $text !== '' && mb_strlen($text) <= 100) {
                $constants[$cell] = $text;
            }
        }
        DB::table('bom_input_maps')->updateOrInsert(['bom_header_id' => $headerId], ['inputs' => json_encode($inputs, JSON_UNESCAPED_UNICODE), 'constants' => json_encode((object) $constants, JSON_UNESCAPED_UNICODE), 'created_at' => now()]);
    }

    /**
     * @param  list<array<string,mixed>>  $inputs
     * @return array<string,string> GAMBAR cell => variable name
     */
    private function cellMap(string $group, array $inputs): array
    {
        $types = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')
            ->where('t.group_code', $group)->get(['t.code', 'v.name'])->groupBy(fn ($r) => $this->norm($r->name))->map(fn ($g) => $g->first()->code);
        $map = [];
        foreach ($inputs as $in) {
            if (! is_array($in) || ($in['group'] ?? null) !== $group || ! in_array($in['kind'] ?? null, ['PSG', 'BKR'], true) || ! preg_match('/^[A-Z]{1,3}\d+$/', (string) ($in['cell'] ?? ''))) {
                continue;
            }
            $code = $types[$this->norm((string) ($in['label'] ?? ''))] ?? null;
            if ($code !== null) {
                $map[$in['cell']] = "{$in['kind']}:{$code}";
            }
        }

        return $map;
    }

    /**
     * Declared inputs (doc.params): [{cell, name, description?, default?}] — a GAMBAR cell that is NOT a construction quantity
     * (e.g. the commissioning-test volume) the user fills on the drawing page. Declared explicitly, never inferred.
     *
     * @param  array<string,string>  $cellMap
     * @return array{0: array<string,array<string,mixed>>, 1: list<string>} cell => definition, problems
     */
    private function parameters(string $group, mixed $raw, array $cellMap): array
    {
        $out = [];
        $problems = [];
        $names = [];
        foreach (is_array($raw) ? $raw : [] as $p) {
            $cell = is_array($p) ? (string) ($p['cell'] ?? '') : '';
            $name = is_array($p) ? (string) ($p['name'] ?? '') : '';
            if (! preg_match('/^[A-Z]{1,3}\d+$/', $cell) || ! preg_match('/^[A-Za-z0-9_.\-]{1,60}(:[A-Za-z0-9_.\-]{1,30})?$/', $name)) {
                $problems[] = 'parameter tidak valid: '.json_encode($p);

                continue;
            }
            if (isset($cellMap[$cell]) || isset($out[$cell]) || isset($names[$name])) {
                $problems[] = "parameter {$name} ({$cell}) bentrok dengan jumlah konstruksi atau parameter lain.";

                continue;
            }
            $default = $p['default'] ?? 0;
            $text = ($p['type'] ?? 'number') === 'text';
            $options = null;
            if ($text) {   // choice parameter: a string, optionally limited to a list (e.g. power range, job type, TUNAI/PLN)
                $options = isset($p['options']) && is_array($p['options']) ? array_values(array_filter(array_map(fn ($o) => is_string($o) ? trim($o) : '', $p['options']), fn ($o) => $o !== '')) : null;
                if (! is_string($default) || mb_strlen($default) > 100 || ($options !== null && $default !== '' && ! in_array($default, $options, true))) {
                    $problems[] = "parameter {$name}: nilai bawaan harus teks dan termasuk pilihan.";

                    continue;
                }
            } elseif (! is_numeric($default) || $default < 0) {
                $problems[] = "parameter {$name}: nilai bawaan harus angka >= 0.";

                continue;
            }
            $names[$name] = true;
            $out[$cell] = ['name' => $name, 'cell' => $cell, 'description' => isset($p['description']) ? mb_substr(trim((string) $p['description']), 0, 300) : null,
                'default' => $text ? $default : (float) $default, 'group' => $group] + ($text ? ['type' => 'text', 'options' => $options] : []);
        }

        return [$out, $problems];
    }

    private function norm(string $s): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $s) ?? $s));
    }

    /** Approvable only when formulas are acyclic and every KHS item / construction used is itself approved on the start date. */
    private function requireReady(object $h): void
    {
        $lines = DB::table('bom_lines')->where('bom_header_id', $h->id)->get(['sequence', 'khs_item_id', 'formulas']);
        $dynamic = [];
        if ($lines->isEmpty()) {
            throw new AssignmentRuleViolation("BOM {$h->group_code} versi {$h->version_number} belum memiliki baris; tidak dapat disetujui.");
        }

        $graph = [];
        $vars = [];
        foreach ($lines as $l) {
            foreach (json_decode($l->formulas, true) as $col => $ast) {
                $graph["{$col}:{$l->sequence}"] = BomAst::dependencies($ast);
                $vars = array_merge($vars, BomAst::variables($ast));
                if ($col === 'B') {
                    $dynamic = array_merge($dynamic, BomAst::codes($ast));
                }
            }
        }
        if (($cycle = $this->findCycle($graph)) !== null) {
            throw new AssignmentRuleViolation("Rumus BOM bersiklus (mis. {$cycle}); tidak dapat disetujui.");
        }

        $items = $lines->pluck('khs_item_id')->merge($dynamic === [] ? [] : DB::table('khs_items')->whereIn('code', array_unique($dynamic))->pluck('id'))->filter()->unique()->values();
        $ready = DB::table('khs_item_versions')->whereIn('khs_item_id', $items)->where('status', 'APPROVED')->where('valid_from', '<=', $h->valid_from)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $h->valid_from))->pluck('khs_item_id')->all();
        $missing = $items->reject(fn ($id) => in_array($id, $ready, true));
        if ($missing->isNotEmpty()) {
            $codes = DB::table('khs_items')->whereIn('id', $missing)->orderBy('code')->limit(5)->pluck('code')->implode(', ');
            throw new AssignmentRuleViolation("{$missing->count()} kode KHS pada BOM belum memiliki versi KHS yang disetujui dan berlaku pada {$h->valid_from} (contoh: {$codes}).");
        }

        $codes = collect($vars)->filter(fn ($v) => str_starts_with($v, 'PSG:') || str_starts_with($v, 'BKR:'))->map(fn ($v) => substr($v, 4))->unique()->values();
        if ($codes->isNotEmpty()) {
            $okTypes = DB::table('construction_types as t')->join('construction_type_versions as v', 'v.construction_type_id', '=', 't.id')->whereIn('t.code', $codes)
                ->where('v.status', 'APPROVED')->where('v.valid_from', '<=', $h->valid_from)->where(fn ($q) => $q->whereNull('v.valid_until')->orWhere('v.valid_until', '>=', $h->valid_from))->pluck('t.code')->all();
            $bad = $codes->reject(fn ($c) => in_array($c, $okTypes, true));
            if ($bad->isNotEmpty()) {
                throw new AssignmentRuleViolation("{$bad->count()} jenis konstruksi yang dipakai rumus belum disetujui dan berlaku pada {$h->valid_from} (contoh: ".$bad->take(5)->implode(', ').').');
            }
        }
    }

    /**
     * @param  array<string,list<string>>  $graph
     * @return ?string a node on a cycle
     */
    private function findCycle(array $graph): ?string
    {
        $state = [];
        foreach (array_keys($graph) as $start) {
            if (isset($state[$start])) {
                continue;
            }
            $stack = [[$start, 0]];
            $state[$start] = 1;
            while ($stack) {
                [$node, $i] = array_pop($stack);
                $deps = $graph[$node] ?? [];
                if ($i < count($deps)) {
                    $stack[] = [$node, $i + 1];
                    $next = $deps[$i];
                    if (($state[$next] ?? 0) === 1) {
                        return $next;
                    }
                    if (! isset($state[$next]) && isset($graph[$next])) {
                        $state[$next] = 1;
                        $stack[] = [$next, 0];
                    }
                } else {
                    $state[$node] = 2;
                }
            }
        }

        return null;
    }

    private function requireDraft(object $h, string $verb = 'diubah'): void
    {
        if ($h->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Versi berstatus {$h->status}; hanya DRAFT yang dapat {$verb} (versi yang disetujui bersifat immutable — buat versi baru).");
        }
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $headerId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('bom_events')->insert(['id' => (string) Str::uuid(), 'bom_header_id' => $headerId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
