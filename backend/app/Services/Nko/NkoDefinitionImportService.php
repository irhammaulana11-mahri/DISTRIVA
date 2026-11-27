<?php

namespace App\Services\Nko;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Memuat master definisi NKO/KPI dari workbook realisasi menjadi set berversi per tahun dan tingkat unit (docs/89).
 * Idempoten: workbook dengan isi sama (SHA-256) tidak membuat versi baru; isi berbeda membuat versi berikutnya dan mengarsipkan yang aktif.
 */
class NkoDefinitionImportService
{
    /** Naik bila pembaca menyimpan lebih banyak/ berbeda dari berkas yang sama, agar versi set ikut diperbarui. */
    public const READER_VERSION = 4;

    public function __construct(private readonly NkoWorkbookReader $reader, private readonly NkoUnitRuleCarry $unitRules) {}

    /**
     * @return array{year: int, sets: list<array{level: string, status: string, version: int, set_id: string, definitions: int, targets: int, units: list<string>, warnings: list<string>}>}
     */
    public function import(string $path, string $originalName, ?User $user = null, ?array $analyzed = null): array
    {
        $book = $analyzed ?? $this->analyze($path);
        $sets = [];
        foreach ($book['levels'] as $level => $plan) {
            $sets[] = $this->importLevel($level, $plan, $book['year'], $book['sha'], $originalName, $user);
        }

        return ['year' => $book['year'], 'sets' => $sets];
    }

    /**
     * Membaca workbook dan menentukan apa yang akan terjadi bila diimpor, tanpa menulis apa pun (dipakai impor dan pratinjau unggahan).
     * `status`: BARU, DIGANTIKAN, DUPLIKAT (sama dengan versi aktif), atau SUDAH_DIGANTIKAN (pernah dimuat lalu diganti).
     *
     * Workbook yang tidak dapat dimuat utuh (lihat `readingErrors()`) ditolak dengan NkoImportException.
     *
     * @param  array<string, mixed>|null  $read  hasil `NkoWorkbookReader::read()` bila sudah dibaca
     * @return array{year: int, sha: string, levels: array<string, array{status: string, active: ?object, previous: ?object, canon: array<string, mixed>, sheets: list<array<string, mixed>>, unit_ids: array<string, string>, warnings: list<string>}>}
     */
    public function analyze(string $path, ?array $read = null): array
    {
        $sha = hash('sha256', hash_file('sha256', $path).'|'.self::READER_VERSION);
        $book = $read ?? $this->reader->read($path);
        $errors = self::readingErrors($book);
        if ($errors !== []) {
            throw new NkoImportException(implode(' ', $errors));
        }
        $units = $this->unitIndex();

        $levels = [];
        foreach (['UP3', 'ULP'] as $level) {
            $sheets = array_values(array_filter($book['sheets'], fn ($s) => $s['level'] === $level));
            if ($sheets === []) {
                continue;
            }
            $levels[$level] = $this->plan($level, $sheets, $book['year'], $sha, $units);
        }

        return ['year' => $book['year'], 'sha' => $sha, 'levels' => $levels];
    }

    /**
     * Masalah yang membuat workbook tidak dapat dimuat: tidak ada tab unit yang terbaca, tab unit gagal dibaca, atau tahun antartab berbeda.
     *
     * @param  array{year: ?int, sheets: list<array<string, mixed>>, tabs: list<array<string, mixed>>}  $read
     * @return list<string>
     */
    public static function readingErrors(array $read): array
    {
        $errors = [];
        if ($read['sheets'] === []) {
            $errors[] = 'Workbook tidak memuat tab unit bertata letak NKO (tab bernama "UP3 <unit>" atau "ULP <unit>" dengan judul NO/KPI pada baris 9).';
            foreach ($read['tabs'] as $tab) {
                if ($tab['status'] === 'DILEWATI' && $tab['reason'] !== 'Bukan tab unit.') {
                    $errors[] = "Tab \"{$tab['sheet']}\": {$tab['reason']}";
                }
            }
        }
        foreach ($read['tabs'] as $tab) {
            if ($tab['status'] === 'GALAT') {
                $errors[] = $tab['reason'];
            }
        }
        foreach (['UP3', 'ULP'] as $level) {
            $sheets = array_filter($read['sheets'], fn (array $s) => $s['level'] === $level);
            if (count($sheets) > 1 && in_array(true, array_column($sheets, 'definition_only'), true)) {
                $errors[] = "Tab \"DEFINISI {$level}\" tidak boleh digabung dengan tab unit {$level}; pakai salah satu.";
            }
        }
        $years = array_values(array_unique(array_column($read['sheets'], 'year')));
        if (count($years) > 1) {
            $errors[] = 'Tab berisi tahun berbeda ('.implode(', ', $years).'); satu workbook untuk satu tahun.';
        }

        return $errors;
    }

    /**
     * @param  list<array<string, mixed>>  $sheets
     * @param  array<string, string>  $units
     * @return array{status: string, active: ?object, previous: ?object, canon: array<string, mixed>, sheets: list<array<string, mixed>>, unit_ids: array<string, string>, warnings: list<string>}
     */
    private function plan(string $level, array $sheets, int $year, string $sha, array $units): array
    {
        $canon = $sheets[0];
        $active = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('status', 'AKTIF')->first();
        $plan = ['status' => $active !== null ? 'DIGANTIKAN' : 'BARU', 'active' => $active, 'previous' => null, 'canon' => $canon, 'sheets' => $sheets, 'unit_ids' => [], 'warnings' => [], 'definition_only' => $canon['definition_only']];
        if ($active !== null && $active->source_sha256 === $sha) {
            return ['status' => 'DUPLIKAT', 'previous' => $active, 'warnings' => json_decode($active->warnings ?? '[]', true) ?: []] + $plan;
        }
        $ever = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('source_sha256', $sha)->first();
        if ($ever !== null) {
            return ['status' => 'SUDAH_DIGANTIKAN', 'previous' => $ever, 'warnings' => ['Isi workbook ini pernah diimpor dan sudah digantikan versi yang lebih baru; tidak diaktifkan ulang.']] + $plan;
        }

        $warnings = $this->consistencyWarnings($canon, $sheets);
        foreach ($sheets as $s) {
            foreach ($s['warnings'] as $w) {
                $warnings[] = preg_replace('/^Tab [^:]+?(?= baris| jumlah)/u', 'Semua tab', $w) ?? $w;
            }
        }
        $warnings = array_values(array_unique($warnings));

        foreach ($plan['definition_only'] ? [] : $sheets as $s) {
            $key = Str::lower($level.' '.$s['unit_name']);
            if (isset($units[$key])) {
                $plan['unit_ids'][$s['sheet']] = $units[$key];
            } else {
                $warnings[] = "Tab {$s['sheet']}: unit tidak ada di master unit; target tab ini tidak dimuat.";
            }
        }

        return ['warnings' => $warnings] + $plan;
    }

    /**
     * @param  array<string, mixed>  $plan  hasil `analyze()` untuk satu tingkat
     * @return array{level: string, status: string, version: int, set_id: string, definitions: int, targets: int, units: list<string>, warnings: list<string>}
     */
    private function importLevel(string $level, array $plan, int $year, string $sha, string $originalName, ?User $user): array
    {
        if (in_array($plan['status'], ['DUPLIKAT', 'SUDAH_DIGANTIKAN'], true)) {
            return $this->summary($level, $plan['status'], (int) $plan['previous']->version, $plan['previous']->id, [], $plan['warnings']);
        }
        ['active' => $active, 'canon' => $canon, 'sheets' => $sheets, 'unit_ids' => $unitIds, 'warnings' => $warnings, 'definition_only' => $definitionOnly] = $plan;

        return DB::transaction(function () use ($level, $year, $sha, $originalName, $user, $active, $canon, $sheets, $unitIds, $warnings, $definitionOnly) {
            $version = (int) (DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->max('version')) + 1;
            if ($active !== null) {
                DB::table('kpi_definition_sets')->where('id', $active->id)->update(['status' => 'ARSIP', 'updated_at' => now()]);
            }
            $setId = (string) Str::uuid7();
            DB::table('kpi_definition_sets')->insert([
                'id' => $setId, 'year' => $year, 'unit_level' => $level, 'version' => $version, 'status' => 'AKTIF',
                'source_name' => mb_substr($originalName, 0, 200), 'source_sha256' => $sha, 'total_weight' => $canon['total_weight'],
                // tab DEFINISI tidak menunjuk unit acuan; nama tab acuan versi sebelumnya dipertahankan agar urutan template lengkap tetap
                'month_rules' => json_encode(['canonical_sheet' => $definitionOnly && $active !== null ? (json_decode($active->month_rules ?? '[]', true)['canonical_sheet'] ?? $canon['sheet']) : $canon['sheet']] + ['months' => $canon['month_rules']]),
                'warnings' => json_encode($warnings), 'imported_by' => $user?->id, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);

            $idByRow = [];
            $idByCode = [];
            $rows = [];
            foreach ($canon['nodes'] as $n) {
                $idByRow[$n['row_no']] = $idByCode[$n['code']] = (string) Str::uuid7();
            }
            foreach ($canon['nodes'] as $n) {
                $rows[] = [
                    'id' => $idByRow[$n['row_no']], 'set_id' => $setId, 'row_no' => $n['row_no'], 'sort_order' => $n['sort_order'], 'level' => $n['level'],
                    'parent_id' => $n['parent_row'] !== null ? $idByRow[$n['parent_row']] : null, 'code' => $n['code'], 'number' => $n['number'], 'name' => mb_substr($n['name'], 0, 300),
                    'polarity' => $n['polarity'], 'unit_label' => $n['unit_label'], 'weight' => $n['weight'], 'weight_note' => $n['weight_note'], 'formula_text' => $n['formula_text'],
                    'source_sheet' => $n['source_sheet'], 'scoring_rule' => $n['scoring_rule'], 'nilai_rule' => $n['nilai_rule'], 'rules' => json_encode($n['rules'], JSON_UNESCAPED_UNICODE),
                ];
            }
            // Parent harus ada lebih dulu karena kunci asing; urutan canon sudah induk-sebelum-anak.
            DB::table('kpi_definitions')->insert($rows);

            $targets = 0;
            $unitNames = [];
            foreach ($sheets as $s) {
                $unitId = $unitIds[$s['sheet']] ?? null;
                if ($unitId === null) {
                    continue;
                }
                $unitNames[] = $s['unit_name'];
                // tiap tab dicocokkan dengan tab acuan menurut kode item, bukan nomor baris
                $byRow = $s['targets'];
                $batch = [];
                foreach ($s['nodes'] as $n) {
                    $defId = $idByCode[$n['code']] ?? null;
                    foreach ($defId === null ? [] : $byRow[$n['row_no']] ?? [] as $month => $t) {
                        $batch[] = ['definition_id' => $defId, 'organizational_unit_id' => $unitId, 'period' => sprintf('%04d-%02d-01', $year, $month), 'target_value' => $t['value'], 'target_text' => $t['text']];
                    }
                }
                foreach (array_chunk($batch, 500) as $chunk) {
                    DB::table('kpi_targets')->insert($chunk);
                }
                $targets += count($batch);
                $this->storeReference($s, $unitId, $year, $setId, $idByCode);
                if ($s['sheet'] !== $canon['sheet']) {
                    $this->storeUnitRules($canon, $s, $unitId, $idByCode);
                }
            }

            $copied = $active === null ? 0 : $this->copyTargets($active->id, $setId);
            if ($definitionOnly && $active !== null) {
                $this->copyUnitData($active->id, $setId, $canon['nodes'], $idByCode);
            }

            return $this->summary($level, $active !== null ? 'DIGANTIKAN' : 'BARU', $version, $setId, ['definitions' => count($rows), 'targets' => $targets, 'targets_copied' => $copied, 'units' => $unitNames], $warnings);
        });
    }

    /**
     * Target versi sebelumnya disalin menurut kode item untuk pasangan item dan unit yang sama sekali tidak diisi workbook (docs/93 §12),
     * sehingga mengubah definisi tidak menghapus target yang diunggah terpisah.
     */
    private function copyTargets(string $fromSetId, string $toSetId): int
    {
        return DB::table('kpi_targets')->insertUsing(
            ['definition_id', 'organizational_unit_id', 'period', 'target_value', 'target_text'],
            DB::table('kpi_targets as t')->join('kpi_definitions as o', 'o.id', '=', 't.definition_id')->join('kpi_definitions as n', 'n.code', '=', 'o.code')
                ->where('o.set_id', $fromSetId)->where('n.set_id', $toSetId)
                ->whereNotExists(fn ($q) => $q->from('kpi_targets as x')->whereColumn('x.definition_id', 'n.id')->whereColumn('x.organizational_unit_id', 't.organizational_unit_id'))
                ->select(['n.id', 't.organizational_unit_id', 't.period', 't.target_value', 't.target_text']),
        );
    }

    /**
     * Definisi tanpa tab unit: aturan khusus unit yang masih berlaku dan angka realisasi acuan (dipakai pratinjau rumus) dibawa dari versi sebelumnya.
     * Angka pencapaian, nilai, dan total acuan tidak dibawa karena bergantung pada rumus versi lama.
     *
     * @param  list<array<string, mixed>>  $nodes
     * @param  array<string, string>  $idByCode
     */
    private function copyUnitData(string $fromSetId, string $toSetId, array $nodes, array $idByCode): void
    {
        $rows = array_map(fn (array $r) => ['definition_id' => $idByCode[$r['code']], 'organizational_unit_id' => $r['organizational_unit_id'], 'rules' => json_encode($r['rules'], JSON_UNESCAPED_UNICODE)],
            $this->unitRules->plan($fromSetId, $nodes)['keep']);
        if ($rows !== []) {
            DB::table('kpi_unit_rules')->insert($rows);
        }
        DB::table('kpi_reference_values')->insertUsing(
            ['definition_id', 'organizational_unit_id', 'period', 'realisasi'],
            DB::table('kpi_reference_values as v')->join('kpi_definitions as o', 'o.id', '=', 'v.definition_id')->join('kpi_definitions as n', 'n.code', '=', 'o.code')
                ->where('o.set_id', $fromSetId)->where('n.set_id', $toSetId)->whereNotNull('v.realisasi')->select(['n.id', 'v.organizational_unit_id', 'v.period', 'v.realisasi']),
        );
    }

    /**
     * Aturan pencapaian/nilai tab unit yang berbeda dari tab acuan disimpan sebagai aturan khusus unit.
     *
     * @param  array<string, mixed>  $canon
     * @param  array<string, mixed>  $sheet
     * @param  array<string, string>  $idByCode
     */
    private function storeUnitRules(array $canon, array $sheet, string $unitId, array $idByCode): void
    {
        $base = [];
        foreach ($canon['nodes'] as $n) {
            $base[$n['code']] = $n;
        }
        $rows = [];
        foreach ($sheet['nodes'] as $n) {
            $c = $base[$n['code']] ?? null;
            if ($c === null) {
                continue;
            }
            $mine = array_intersect_key($n['rules'], array_flip(['pencapaian', 'nilai', 'months']));
            $theirs = array_intersect_key($c['rules'], array_flip(['pencapaian', 'nilai', 'months']));
            if (json_encode($mine) !== json_encode($theirs)) {
                $rows[] = ['definition_id' => $idByCode[$c['code']], 'organizational_unit_id' => $unitId, 'rules' => json_encode($mine, JSON_UNESCAPED_UNICODE)];
            }
        }
        if ($rows !== []) {
            DB::table('kpi_unit_rules')->insert($rows);
        }
    }

    /**
     * Angka acuan workbook per unit (realisasi, pencapaian, nilai per indikator dan bulan; total dan NKO akhir) untuk rekonsiliasi mesin hitung.
     *
     * @param  array<string, mixed>  $sheet
     * @param  array<string, string>  $idByCode
     */
    private function storeReference(array $sheet, string $unitId, int $year, string $setId, array $idByCode): void
    {
        $codes = array_column($sheet['nodes'], 'code', 'row_no');
        $batch = [];
        foreach ($sheet['reference'] as $row => $months) {
            $defId = $idByCode[$codes[$row] ?? ''] ?? null;
            foreach ($defId === null ? [] : $months as $month => $v) {
                $batch[] = ['definition_id' => $defId, 'organizational_unit_id' => $unitId, 'period' => sprintf('%04d-%02d-01', $year, $month), 'realisasi' => $v['real'], 'pencapaian' => $v['capai'], 'nilai' => $v['nilai']];
            }
        }
        foreach (array_chunk($batch, 500) as $chunk) {
            DB::table('kpi_reference_values')->insert($chunk);
        }
        $totals = [];
        foreach ($sheet['month_rules'] as $month => $m) {
            if ($m['total_value'] !== null || $m['final_value'] !== null) {
                $totals[] = ['set_id' => $setId, 'organizational_unit_id' => $unitId, 'period' => sprintf('%04d-%02d-01', $year, $month), 'total' => $m['total_value'], 'nko' => $m['final_value']];
            }
        }
        if ($totals !== []) {
            DB::table('kpi_reference_totals')->insert($totals);
        }
    }

    /**
     * Definisi tiap tab sejenis harus sama dengan tab acuan (kode, polaritas, bobot, satuan, aturan pencapaian); selisih dilaporkan.
     *
     * @param  array<string, mixed>  $canon
     * @param  list<array<string, mixed>>  $sheets
     * @return list<string>
     */
    private function consistencyWarnings(array $canon, array $sheets): array
    {
        $warnings = [];
        $ref = [];
        foreach ($canon['nodes'] as $n) {
            $ref[$n['code']] = $n;
        }
        foreach (array_slice($sheets, 1) as $s) {
            $seen = [];
            foreach ($s['nodes'] as $n) {
                $seen[$n['code']] = true;
                $r = $ref[$n['code']] ?? null;
                if ($r === null) {
                    $warnings[] = "Tab {$s['sheet']}: indikator \"{$n['name']}\" tidak ada di tab acuan {$canon['sheet']}.";

                    continue;
                }
                foreach (['polarity', 'weight', 'unit_label', 'level'] as $f) {
                    if ($f === 'unit_label' && $r['polarity'] === null) {
                        continue;
                    }
                    if ($n[$f] != $r[$f]) {
                        $warnings[] = "Tab {$s['sheet']}: {$f} indikator \"{$n['name']}\" berbeda dari tab acuan ({$n[$f]} vs {$r[$f]}).";
                    }
                }
                if (($n['rules']['pencapaian'] ?? null) !== ($r['rules']['pencapaian'] ?? null) && ($n['scoring_rule'] ?? null) !== ($r['scoring_rule'] ?? null)) {
                    $warnings[] = "Tab {$s['sheet']}: aturan pencapaian \"{$n['name']}\" berbeda dari tab acuan.";
                }
            }
            foreach ($ref as $code => $r) {
                if (! isset($seen[$code])) {
                    $warnings[] = "Tab {$s['sheet']}: indikator \"{$r['name']}\" ada di tab acuan tetapi tidak ada di tab ini.";
                }
            }
        }

        return $warnings;
    }

    /**
     * @return array<string, string> nama unit huruf kecil => id
     */
    private function unitIndex(): array
    {
        $out = [];
        foreach (DB::table('organizational_units')->whereIn('unit_type', ['ULP', 'UP3'])->get(['id', 'name']) as $u) {
            $out[Str::lower(trim($u->name))] = $u->id;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $extra
     * @param  list<string>  $warnings
     * @return array{level: string, status: string, version: int, set_id: string, definitions: int, targets: int, units: list<string>, warnings: list<string>}
     */
    private function summary(string $level, string $status, int $version, string $setId, array $extra, array $warnings): array
    {
        return $extra + ['level' => $level, 'status' => $status, 'version' => $version, 'set_id' => $setId, 'definitions' => 0, 'targets' => 0, 'units' => [], 'warnings' => $warnings];
    }
}
