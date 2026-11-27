<?php

namespace App\Services\Nko;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Pemeriksaan workbook target sebelum diunggah (docs/93 §12): hasil per tab, galat, peringatan, dan daftar sel yang berubah. Hanya membaca.
 */
class NkoTargetCheckService
{
    /** paling banyak nama atau sel yang disebut dalam satu pesan */
    private const NAMES = 5;

    private const TOLERANCE = 1e-9;

    public function __construct(private readonly NkoTargetWorkbook $workbook) {}

    /**
     * `writes` adalah perubahan yang diterapkan bila disetujui (value dan text keduanya null berarti dihapus); `base_sets` set aktif yang dibandingkan.
     *
     * @return array{report: array{year: int, year_found: ?int, can_upload: bool, errors: list<string>, warnings: list<string>, tabs: list<array<string, mixed>>, changes: list<array<string, mixed>>},
     *     writes: list<array{definition_id: string, organizational_unit_id: string, period: string, target_value: ?float, target_text: ?string}>, base_sets: array<string, string>}
     */
    public function check(string $path, int $year): array
    {
        $report = ['year' => $year, 'year_found' => null, 'can_upload' => false, 'errors' => [], 'warnings' => [], 'tabs' => [], 'changes' => []];
        $writes = [];
        $baseSets = [];
        $done = function () use (&$report, &$writes, &$baseSets): array {
            return ['report' => $report, 'writes' => $writes, 'base_sets' => $baseSets];
        };
        try {
            $read = $this->workbook->read($path);
        } catch (Throwable $e) {
            report($e);
            $report['errors'][] = 'Berkas tidak dapat dibaca sebagai workbook Excel (.xlsx).';

            return $done();
        }
        $report['year_found'] = $read['year'];
        $report['tabs'] = array_map(fn (array $t) => $t + ['unit_found' => null, 'items' => null, 'errors' => [], 'warnings' => []], $read['tabs']);
        foreach ($read['tabs'] as $tab) {
            if ($tab['status'] === 'GALAT') {
                $report['errors'][] = "Tab {$tab['sheet']}: {$tab['reason']}";
            }
        }
        if ($read['sheets'] === []) {
            $report['errors'][] = 'Workbook tidak memuat tab target (tab bernama "UP3 <unit>" atau "ULP <unit>" dengan "KODE" di sel A4).';
        }
        foreach (array_unique(array_column($read['sheets'], 'year')) as $found) {
            if ($found !== $year) {
                $report['errors'][] = "Berkas berisi target tahun {$found} (sel A2), bukan {$year}.";
            }
        }
        if ($report['errors'] !== []) {
            return $done();
        }

        $units = [];
        foreach (DB::table('organizational_units')->whereIn('unit_type', ['ULP', 'UP3'])->get(['id', 'name']) as $u) {
            $units[Str::lower(trim($u->name))] = $u->id;
        }
        $sets = DB::table('kpi_definition_sets')->where('year', $year)->where('status', 'AKTIF')->get(['id', 'unit_level', 'version'])->keyBy('unit_level');
        $definitions = [];
        $bySheet = array_column($read['sheets'], null, 'sheet');

        foreach ($report['tabs'] as &$tab) {
            $sheet = $bySheet[$tab['sheet']] ?? null;
            if ($sheet === null) {
                continue;
            }
            $level = $sheet['level'];
            $unitId = $units[Str::lower($level.' '.$sheet['unit_name'])] ?? null;
            $set = $sets[$level] ?? null;
            $tab['unit_found'] = $unitId !== null;
            $tab['items'] = count($sheet['rows']);
            if ($unitId === null) {
                $tab['errors'][] = "unit \"{$level} {$sheet['unit_name']}\" tidak ada di master unit; periksa ejaan nama tab.";
            }
            if ($set === null) {
                $tab['errors'][] = "belum ada definisi NKO {$level} aktif tahun {$year}.";
            }
            if ($unitId !== null && $set !== null) {
                $definitions[$level] ??= $this->definitions($set->id);
                $baseSets[$level] = $set->id;
                [$cells, $items] = $this->sheet($tab, $sheet, $definitions[$level], $unitId, $year);
                $writes = [...$writes, ...$cells];
                if ($items !== []) {
                    $report['changes'][] = ['level' => $level, 'unit_name' => $sheet['unit_name'], 'compared_with' => "{$year} v{$set->version}", 'cells' => count($cells), 'items' => $items];
                }
            }
            foreach ($tab['errors'] as $error) {
                $report['errors'][] = "Tab {$tab['sheet']}: {$error}";
            }
        }
        unset($tab);

        if ($report['errors'] === [] && $writes === []) {
            $report['errors'][] = 'Target di berkas sama dengan yang berlaku; tidak ada yang berubah.';
        }
        $report['can_upload'] = $report['errors'] === [];
        ksort($baseSets);

        return $done();
    }

    /** @return array<string, object> kode => definisi, dengan penanda `leaf` */
    private function definitions(string $setId): array
    {
        $rows = DB::table('kpi_definitions')->where('set_id', $setId)->orderBy('sort_order')->get(['id', 'parent_id', 'code', 'name', 'polarity', 'weight']);
        $parents = array_flip($rows->pluck('parent_id')->filter()->all());

        foreach ($rows as $d) {
            $d->leaf = ! isset($parents[$d->id]);
        }

        return $rows->keyBy('code')->all();
    }

    /**
     * Mengisi galat dan peringatan tab.
     *
     * @param  array<string, mixed>  $tab
     * @param  array<string, mixed>  $sheet
     * @param  array<string, object>  $definitions
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>} sel yang diterapkan dan rincian per item
     */
    private function sheet(array &$tab, array $sheet, array $definitions, string $unitId, int $year): array
    {
        if ($sheet['invalid'] !== []) {
            $tab['errors'][] = 'sel bukan angka atau rentang ("95 - 105"): '.$this->names($sheet['invalid']).'.';
        }
        if ($sheet['uncached'] !== []) {
            $tab['errors'][] = 'sel berisi rumus tanpa nilai tersimpan: '.$this->names($sheet['uncached']).'. Buka di Excel, perbarui tautan, simpan, lalu unggah lagi.';
        }

        $stored = [];
        foreach (DB::table('kpi_targets')->whereIn('definition_id', array_column($definitions, 'id'))->where('organizational_unit_id', $unitId)->get() as $t) {
            $stored[$t->definition_id][(int) substr($t->period, 5, 2)] = ['value' => $t->target_value === null ? null : (float) $t->target_value, 'text' => $t->target_text];
        }

        $seen = [];
        $unknown = [];
        $duplicate = [];
        $cleared = [];
        $empty = [];
        $partial = [];
        $removed = 0;
        $writes = [];
        $items = [];
        foreach ($sheet['rows'] as $row) {
            $d = $definitions[$row['code']] ?? null;
            if ($d === null) {
                $unknown[] = "{$row['code']} (baris {$row['row']})";

                continue;
            }
            if (isset($seen[$row['code']])) {
                $duplicate[] = $row['code'];

                continue;
            }
            $seen[$row['code']] = true;
            $before = $stored[$d->id] ?? [];
            if ($d->leaf && (float) $d->weight > 0) {
                if ($row['months'] === []) {
                    $before === [] ? $empty[] = $d->name : $cleared[] = $d->name;
                } elseif (count($row['months']) < 12) {
                    $partial[] = $d->name;
                }
            }
            $months = [];
            for ($month = 1; $month <= 12; $month++) {
                $from = $before[$month] ?? null;
                $to = $row['months'][$month] ?? null;
                if ($this->same($from, $to)) {
                    continue;
                }
                $removed += $to === null ? 1 : 0;
                $months[$month] = ['from' => $from === null ? null : $from['text'] ?? $from['value'], 'to' => $to === null ? null : $to['text'] ?? $to['value']];
                $writes[] = ['definition_id' => $d->id, 'organizational_unit_id' => $unitId, 'period' => sprintf('%04d-%02d-01', $year, $month),
                    'target_value' => $to['value'] ?? null, 'target_text' => $to['text'] ?? null];
            }
            if ($months !== []) {
                $items[] = ['code' => $d->code, 'name' => $d->name, 'months' => $months];
            }
        }

        if ($unknown !== []) {
            $tab['errors'][] = 'KODE tidak ada di definisi aktif: '.$this->names($unknown).'. Item baru ditambahkan lewat workbook definisi.';
        }
        if ($duplicate !== []) {
            $tab['errors'][] = 'KODE dipakai lebih dari satu baris: '.$this->names($duplicate).'.';
        }
        if ($cleared !== []) {
            $tab['errors'][] = 'semua target item berbobot dikosongkan: '.$this->names($cleared).'.';
        }
        if ($empty !== []) {
            $tab['warnings'][] = 'target belum ada untuk item berbobot: '.$this->names($empty).'.';
        }
        if ($partial !== []) {
            $tab['warnings'][] = 'target sebagian bulan kosong: '.$this->names($partial).'.';
        }
        if ($removed > 0) {
            $tab['warnings'][] = "{$removed} target bulanan yang sebelumnya terisi akan dihapus.";
        }

        return [$writes, $items];
    }

    /**
     * @param  ?array{value: ?float, text: ?string}  $a
     * @param  ?array{value: ?float, text: ?string}  $b
     */
    private function same(?array $a, ?array $b): bool
    {
        if ($a === null || $b === null) {
            return $a === $b;
        }
        if ($a['value'] === null || $b['value'] === null) {
            return $a['value'] === $b['value'] && $a['text'] === $b['text'];
        }

        return abs($a['value'] - $b['value']) <= self::TOLERANCE * max(1, abs($a['value']));
    }

    /** @param  list<string>  $names */
    private function names(array $names): string
    {
        $shown = implode(', ', array_slice($names, 0, self::NAMES));

        return count($names) > self::NAMES ? $shown.' (dan '.(count($names) - self::NAMES).' lainnya)' : $shown;
    }
}
