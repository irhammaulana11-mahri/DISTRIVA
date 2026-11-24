<?php

namespace App\Services\EisReports;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Mengimpor satu berkas laporan EIS (docs/88): baca, tentukan unit dan bulan, simpan baris bernama, dan arsipkan berkas aslinya. Idempoten menurut sidik jari isi;
 * isi berbeda untuk jenis, unit, dan bulan yang sama menggantikan yang aktif (yang lama menjadi DIGANTIKAN).
 */
class EisReportImportService
{
    public function __construct(private readonly EisReportParser $parser) {}

    public static function storageKey(object $file): string
    {
        return sprintf('eis-reports/%s/%s/%s-%s.%s', $file->unit_code, $file->family, substr((string) $file->period, 0, 7), substr($file->sha256, 0, 12), strtolower(pathinfo($file->original_name, PATHINFO_EXTENSION)) ?: 'xls');
    }

    /**
     * @param  list<string>|null  $allowedUnitIds  null = semua unit; selain itu hanya unit ini yang boleh menerima impor
     * @param  array{unit_code?: ?string, period?: ?string}  $hints  unit dan bulan pilihan pengunggah, hanya dipakai bila tidak tertulis di nama maupun isi berkas
     * @return array{status:string,id:?string,family:string,unit:string,period:string,lines:int,warnings:list<string>}
     */
    public function import(string $path, string $originalName, ?User $actor = null, ?array $allowedUnitIds = null, array $hints = []): array
    {
        $parsed = $this->parser->parse($path, $originalName, $hints);
        [$unit, $warnings] = $this->resolveUnit($parsed);
        if ($allowedUnitIds !== null && ! in_array($unit->id, $allowedUnitIds, true)) {
            throw new EisReportException("Anda tidak berwenang mengimpor laporan untuk {$unit->name}.");
        }
        $sha = hash_file('sha256', $path);
        $base = ['family' => $parsed['family'], 'unit' => $unit->name, 'period' => substr($parsed['period'], 0, 7), 'warnings' => $warnings];
        $dup = DB::table('eis_report_files')->where(['family' => $parsed['family'], 'organizational_unit_id' => $unit->id, 'period' => $parsed['period'], 'sha256' => $sha, 'status' => 'AKTIF'])->value('id');
        if ($dup !== null) {
            return $base + ['status' => 'DUPLIKAT', 'id' => $dup, 'lines' => 0];
        }
        $before = DB::table('eis_report_files')->where(['family' => $parsed['family'], 'organizational_unit_id' => $unit->id, 'period' => $parsed['period'], 'sha256' => $sha, 'status' => 'DIGANTIKAN'])->value('id');
        if ($before !== null) {
            return ['status' => 'SUDAH_DIGANTIKAN', 'id' => $before, 'lines' => 0, 'warnings' => [...$warnings, 'Isi sama dengan versi lama yang sudah digantikan; tidak diaktifkan lagi.']] + $base;
        }
        $id = (string) Str::uuid();
        $replaced = false;
        DB::transaction(function () use ($parsed, $unit, $sha, $originalName, $path, $actor, $warnings, $id, &$replaced) {
            $replaced = DB::table('eis_report_files')->where(['family' => $parsed['family'], 'organizational_unit_id' => $unit->id, 'period' => $parsed['period'], 'status' => 'AKTIF'])->update(['status' => 'DIGANTIKAN', 'updated_at' => now()]) > 0;
            DB::table('eis_report_files')->insert(['id' => $id, 'family' => $parsed['family'], 'unit_code' => $unit->code, 'organizational_unit_id' => $unit->id, 'period' => $parsed['period'], 'original_name' => mb_substr($originalName, 0, 200), 'sha256' => $sha,
                'size_bytes' => filesize($path), 'status' => 'AKTIF', 'summary' => $parsed['summary'] === null ? null : json_encode($parsed['summary']), 'line_count' => count($parsed['lines']), 'warnings' => $warnings === [] ? null : json_encode($warnings),
                'uploaded_by' => $actor?->getKey(), 'imported_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($parsed['lines'], 500) as $chunk) {
                DB::table('eis_report_lines')->insert(array_map(fn ($l) => ['file_id' => $id, 'line_no' => $l['line_no'], 'group_label' => $l['group_label'], 'label' => $l['label'], 'code' => $l['code'], 'values' => json_encode($l['values'], JSON_UNESCAPED_UNICODE)], $chunk));
            }
        });
        Storage::disk('documents')->put(self::storageKey((object) ['unit_code' => $unit->code, 'family' => $parsed['family'], 'period' => $parsed['period'], 'sha256' => $sha, 'original_name' => $originalName]), (string) file_get_contents($path));

        return $base + ['status' => $replaced ? 'DIGANTIKAN' : 'BARU', 'id' => $id, 'lines' => count($parsed['lines'])];
    }

    /**
     * Kode unit (dari nama berkas, isi, atau pilihan pengunggah) diutamakan; nama ULP/UP3 di dalam isi berkas harus sama. Tanpa kode, unit dibaca dari nama di isi berkas. Kode yang tidak dikenal (salah ketik) dipulihkan dari nama di isi berkas, dengan peringatan.
     *
     * @param  array<string,mixed>  $parsed
     * @return array{0:object,1:list<string>}
     */
    private function resolveUnit(array $parsed): array
    {
        $units = DB::table('organizational_units')->where('is_active', true)->get(['id', 'code', 'name', 'unit_type', 'parent_id']);
        $byName = fn (string $n) => $units->first(fn ($u) => mb_strtolower($u->name) === mb_strtolower($n));
        $ulp = $parsed['content_units']['ULP'] === null ? null : $byName('ULP '.$parsed['content_units']['ULP']);
        $up3 = $parsed['content_units']['UP3'] === null ? null : $byName('UP3 '.$parsed['content_units']['UP3']);
        $file = $parsed['file_unit_code'] === null ? null : $units->first(fn ($u) => strcasecmp($u->code, $parsed['file_unit_code']) === 0);
        $warnings = [];
        if ($file !== null) {
            if ($parsed['content_units']['ULP'] !== null && $file->unit_type === 'ULP' && ($ulp === null || $ulp->id !== $file->id)) {
                throw new EisReportException("Kode unit {$parsed['file_unit_code']} ({$file->name}) tidak cocok dengan isi berkas (ULP {$parsed['content_units']['ULP']}).");
            }
            if ($file->unit_type === 'UP3' && $parsed['content_units']['UP3'] !== null && ($up3 === null || $up3->id !== $file->id)) {
                throw new EisReportException("Kode unit {$parsed['file_unit_code']} ({$file->name}) tidak cocok dengan isi berkas (UP3 {$parsed['content_units']['UP3']}).");
            }

            return [$file, $warnings];
        }
        $fromContent = $ulp ?? ($parsed['content_units']['ULP'] === null ? $up3 : null);
        if ($fromContent === null) {
            $name = $parsed['content_units']['ULP'] ?? $parsed['content_units']['UP3'];
            throw new EisReportException($name === null ? 'Kode unit '.($parsed['file_unit_code'] ?? '-').' tidak dikenal dan isi berkas tidak menyebut unit.' : "Unit {$name} tidak ada pada master unit aktif.");
        }
        if ($parsed['file_unit_code'] !== null) {
            $where = ['nama' => 'nama berkas', 'isi' => 'isi berkas', 'pilihan' => 'pilihan unit'][$parsed['unit_source'] ?? 'nama'];
            $warnings[] = "Kode unit pada {$where} ({$parsed['file_unit_code']}) tidak dikenal; unit dibaca dari nama unit di isi berkas ({$fromContent->name}).";
        }

        return [$fromContent, $warnings];
    }
}
