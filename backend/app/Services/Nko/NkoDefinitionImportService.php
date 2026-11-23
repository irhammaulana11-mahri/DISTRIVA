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
    public function __construct(private readonly NkoWorkbookReader $reader) {}

    /**
     * @return array{year: int, sets: list<array{level: string, status: string, version: int, set_id: string, definitions: int, targets: int, units: list<string>, warnings: list<string>}>}
     */
    public function import(string $path, string $originalName, ?User $user = null): array
    {
        $sha = hash_file('sha256', $path);
        $book = $this->reader->read($path);
        $units = $this->unitIndex();

        $sets = [];
        foreach (['UP3', 'ULP'] as $level) {
            $sheets = array_values(array_filter($book['sheets'], fn ($s) => $s['level'] === $level));
            if ($sheets === []) {
                continue;
            }
            $sets[] = $this->importLevel($level, $sheets, $book['year'], $sha, $originalName, $user, $units);
        }

        return ['year' => $book['year'], 'sets' => $sets];
    }

    /**
     * @param  list<array<string, mixed>>  $sheets
     * @param  array<string, string>  $units
     * @return array{level: string, status: string, version: int, set_id: string, definitions: int, targets: int, units: list<string>, warnings: list<string>}
     */
    private function importLevel(string $level, array $sheets, int $year, string $sha, string $originalName, ?User $user, array $units): array
    {
        $active = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('status', 'AKTIF')->first();
        if ($active !== null && $active->source_sha256 === $sha) {
            return $this->summary($level, 'DUPLIKAT', (int) $active->version, $active->id, [], json_decode($active->warnings ?? '[]', true) ?: []);
        }
        $ever = DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->where('source_sha256', $sha)->first();
        if ($ever !== null) {
            return $this->summary($level, 'SUDAH_DIGANTIKAN', (int) $ever->version, $ever->id, [], ['Isi workbook ini pernah diimpor dan sudah digantikan versi yang lebih baru; tidak diaktifkan ulang.']);
        }

        $canon = $sheets[0];
        $warnings = $this->consistencyWarnings($canon, $sheets);
        foreach ($sheets as $s) {
            foreach ($s['warnings'] as $w) {
                $warnings[] = preg_replace('/^Tab [^:]+?(?= baris| jumlah)/u', 'Semua tab', $w) ?? $w;
            }
        }
        $warnings = array_values(array_unique($warnings));

        $unitIds = [];
        foreach ($sheets as $s) {
            $key = Str::lower($level.' '.$s['unit_name']);
            if (isset($units[$key])) {
                $unitIds[$s['sheet']] = $units[$key];
            } else {
                $warnings[] = "Tab {$s['sheet']}: unit tidak ada di master unit; target tab ini tidak dimuat.";
            }
        }

        return DB::transaction(function () use ($level, $year, $sha, $originalName, $user, $active, $canon, $sheets, $unitIds, $warnings) {
            $version = (int) (DB::table('kpi_definition_sets')->where('year', $year)->where('unit_level', $level)->max('version')) + 1;
            if ($active !== null) {
                DB::table('kpi_definition_sets')->where('id', $active->id)->update(['status' => 'ARSIP', 'updated_at' => now()]);
            }
            $setId = (string) Str::uuid7();
            DB::table('kpi_definition_sets')->insert([
                'id' => $setId, 'year' => $year, 'unit_level' => $level, 'version' => $version, 'status' => 'AKTIF',
                'source_name' => mb_substr($originalName, 0, 200), 'source_sha256' => $sha, 'total_weight' => $canon['total_weight'],
                'month_rules' => json_encode(['canonical_sheet' => $canon['sheet']] + ['months' => $canon['month_rules']]),
                'warnings' => json_encode($warnings), 'imported_by' => $user?->id, 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);

            $idByRow = [];
            $rows = [];
            foreach ($canon['nodes'] as $n) {
                $idByRow[$n['row_no']] = (string) Str::uuid7();
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
                $byRow = $s['targets'];
                $batch = [];
                foreach ($s['nodes'] as $n) {
                    $defId = $idByRow[$n['row_no']] ?? null;
                    foreach ($byRow[$n['row_no']] ?? [] as $month => $t) {
                        if ($defId === null || ! isset($idByRow[$n['row_no']])) {
                            continue;
                        }
                        $batch[] = ['definition_id' => $defId, 'organizational_unit_id' => $unitId, 'period' => sprintf('%04d-%02d-01', $year, $month), 'target_value' => $t['value'], 'target_text' => $t['text']];
                    }
                }
                foreach (array_chunk($batch, 500) as $chunk) {
                    DB::table('kpi_targets')->insert($chunk);
                }
                $targets += count($batch);
            }

            return $this->summary($level, $active !== null ? 'DIGANTIKAN' : 'BARU', $version, $setId, ['definitions' => count($rows), 'targets' => $targets, 'units' => $unitNames], $warnings);
        });
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
