<?php

namespace App\Services\Analytics;

use App\Exceptions\AdministrationDenied;
use App\Models\User;
use App\Services\Authorization\ApplicationAuthorizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date as ExcelDate;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/**
 * Templat dan impor Excel masukan bulanan kWh beli, PSSD, dan E-Min (opsional) per ULP (docs/91 §3b).
 * Kolom: KODE ULP, NAMA ULP, BULAN (YYYY-MM), KWH BELI, PSSD, E-MIN, CATATAN. Satu baris = satu ULP satu bulan, nilai bulan itu dalam kWh.
 * Sel nilai kosong dilewati (tidak menghapus). Berkas ditolak seluruhnya bila ada baris yang salah, supaya tidak ada impor setengah jadi.
 */
class BusinessInputWorkbook
{
    /** judul kolom => kode masukan */
    public const VALUE_COLUMNS = ['KWH BELI' => 'kwh-beli', 'PSSD' => 'pssd', 'E-MIN' => 'e-min'];

    private const HEADERS = ['KODE ULP', 'NAMA ULP', 'BULAN', 'KWH BELI', 'PSSD', 'E-MIN', 'CATATAN'];

    public function __construct(private readonly ApplicationAuthorizer $authorizer) {}

    /**
     * Templat berisi baris per ULP per bulan setahun, terisi nilai yang sudah tersimpan.
     *
     * @param  list<object{id: string, code: string, name: string}>  $units
     */
    public function template(array $units, int $year, string $path): void
    {
        $existing = [];
        foreach (DB::table('business_monthly_inputs')->whereIn('organizational_unit_id', array_column($units, 'id'))->whereBetween('period', ["{$year}-01-01", "{$year}-12-01"])->get() as $r) {
            $existing[$r->organizational_unit_id][substr((string) $r->period, 0, 7)][$r->code] = $r;
        }
        $ss = new Spreadsheet;
        $ws = $ss->getActiveSheet();
        $ws->setTitle('KWH BELI');
        $ws->fromArray(self::HEADERS, null, 'A1');
        $ws->getStyle('A1:G1')->getFont()->setBold(true);
        $row = 2;
        foreach ($units as $u) {
            for ($m = 1; $m <= 12; $m++) {
                $key = sprintf('%04d-%02d', $year, $m);
                $cell = $existing[$u->id][$key] ?? [];
                $note = collect($cell)->pluck('note')->filter()->first();
                $ws->setCellValueExplicit("A{$row}", (string) $u->code, 's');
                $ws->setCellValue("B{$row}", $u->name);
                $ws->setCellValueExplicit("C{$row}", $key, 's');
                foreach (['D' => 'kwh-beli', 'E' => 'pssd', 'F' => 'e-min'] as $col => $code) {
                    isset($cell[$code]) && $ws->setCellValue("{$col}{$row}", (float) $cell[$code]->value);
                }
                $note !== null && $ws->setCellValue("G{$row}", $note);
                $row++;
            }
        }
        $ws->getStyle('D2:F'.max(2, $row - 1))->getNumberFormat()->setFormatCode('#,##0.00');
        foreach (['A' => 12, 'B' => 24, 'C' => 10, 'D' => 18, 'E' => 16, 'F' => 16, 'G' => 40] as $col => $w) {
            $ws->getColumnDimension($col)->setWidth($w);
        }
        $ws->freezePane('A2');
        (new Xlsx($ss))->save($path);
    }

    /**
     * @return array{rows: int, changed: int, unchanged: int}
     *
     * @throws AdministrationDenied 422 beserta daftar galat per baris
     */
    public function import(string $path, User $actor): array
    {
        try {
            $sheet = IOFactory::load($path)->getSheet(0)->toArray(null, true, false, false);
        } catch (\Throwable) {
            throw new AdministrationDenied('Berkas tidak dapat dibaca sebagai Excel.', 422);
        }
        $headerRow = null;
        foreach (array_slice($sheet, 0, 10, true) as $i => $r) {
            $norm = array_map(fn ($c) => strtoupper(trim((string) $c)), $r);
            if (in_array('BULAN', $norm, true) && in_array('KWH BELI', $norm, true)) {
                $headerRow = $i;
                $cols = array_flip(array_filter($norm, fn ($c) => $c !== ''));
                break;
            }
        }
        if ($headerRow === null || (! isset($cols['KODE ULP']) && ! isset($cols['NAMA ULP']))) {
            throw new AdministrationDenied('Kolom wajib tidak ditemukan: KODE ULP atau NAMA ULP, BULAN, KWH BELI (pakai templat dari DISTRIVA).', 422);
        }
        $ulps = DB::table('organizational_units')->where('unit_type', 'ULP')->get(['id', 'code', 'name']);
        $byCode = $ulps->keyBy(fn ($u) => strtoupper(trim((string) $u->code)));
        $byName = $ulps->keyBy(fn ($u) => strtoupper(trim((string) $u->name)));
        $current = now()->format('Y-m');
        $errors = [];
        $items = [];
        $allowed = [];
        foreach (array_slice($sheet, $headerRow + 1, null, true) as $i => $r) {
            $line = $i + 1;
            $get = fn (string $h) => isset($cols[$h]) ? $r[$cols[$h]] : null;
            $values = [];
            foreach (self::VALUE_COLUMNS as $h => $code) {
                $v = $get($h);
                if ($v === null || trim((string) $v) === '') {
                    continue;
                }
                $num = $this->number($v);
                if ($num === null || $num < 0) {
                    $errors[] = "Baris {$line}: {$h} bukan angka ≥ 0.";

                    continue 2;
                }
                $values[$code] = $num;
            }
            if ($values === []) {
                continue;   // baris tanpa nilai (mis. bulan yang belum diisi pada templat)
            }
            $unit = $byCode[strtoupper(trim((string) $get('KODE ULP')))] ?? $byName[strtoupper(trim((string) $get('NAMA ULP')))] ?? null;
            if ($unit === null) {
                $errors[] = "Baris {$line}: ULP tidak dikenal.";

                continue;
            }
            $period = $this->period($get('BULAN'));
            if ($period === null || $period > $current) {
                $errors[] = "Baris {$line}: BULAN harus YYYY-MM dan tidak setelah bulan berjalan.";

                continue;
            }
            if (! isset($allowed[$unit->id])) {
                try {
                    $this->authorizer->authorizeOnUnit($actor, 'pengusahaan.input', $unit->id);
                    $allowed[$unit->id] = true;
                } catch (AdministrationDenied $e) {
                    if ($e->getCode() === 403 && str_contains($e->getMessage(), 'MFA')) {
                        throw $e;
                    }
                    $allowed[$unit->id] = false;
                }
            }
            if (! $allowed[$unit->id]) {
                $errors[] = "Baris {$line}: {$unit->name} di luar kewenangan Anda.";

                continue;
            }
            foreach ($values as $code => $v) {
                $key = "{$unit->id}|{$period}|{$code}";
                if (isset($items[$key])) {
                    $errors[] = "Baris {$line}: {$unit->name} {$period} {$code} ganda dalam berkas.";

                    continue;
                }
                $items[$key] = ['unit' => $unit->id, 'period' => $period, 'code' => $code, 'value' => $v, 'note' => trim((string) $get('CATATAN')) ?: null];
            }
        }
        if ($errors !== []) {
            throw new AdministrationDenied('Impor dibatalkan, perbaiki baris berikut: '.implode(' ', array_slice($errors, 0, 20)).(count($errors) > 20 ? ' (dan '.(count($errors) - 20).' lainnya)' : ''), 422);
        }
        if ($items === []) {
            throw new AdministrationDenied('Tidak ada nilai yang diimpor.', 422);
        }
        $changed = 0;
        DB::transaction(function () use ($items, $actor, &$changed) {
            foreach ($items as $it) {
                $where = ['organizational_unit_id' => $it['unit'], 'period' => $it['period'].'-01', 'code' => $it['code']];
                $existing = DB::table('business_monthly_inputs')->where($where)->first();
                if ($existing !== null && (float) $existing->value === $it['value'] && trim((string) $existing->note) === (string) $it['note']) {
                    continue;
                }
                $changed++;
                $data = ['value' => $it['value'], 'note' => $it['note'], 'entered_by' => $actor->id, 'updated_at' => now()];
                $existing === null
                    ? DB::table('business_monthly_inputs')->insert($where + $data + ['id' => (string) Str::uuid7(), 'created_at' => now()])
                    : DB::table('business_monthly_inputs')->where('id', $existing->id)->update($data);
            }
        });

        return ['rows' => count($items), 'changed' => $changed, 'unchanged' => count($items) - $changed];
    }

    /** Angka dari sel: numerik apa adanya; teks format Indonesia (1.234.567,89) atau Inggris (1,234,567.89); selain itu null. */
    private function number(mixed $v): ?float
    {
        if (is_int($v) || is_float($v)) {
            return (float) $v;
        }
        $t = str_replace(' ', '', trim((string) $v));
        if (preg_match('/^\d{1,3}(\.\d{3})+(,\d+)?$/', $t) || preg_match('/^\d+,\d+$/', $t)) {
            return (float) str_replace(['.', ','], ['', '.'], $t);
        }
        if (preg_match('/^\d{1,3}(,\d{3})+(\.\d+)?$/', $t)) {
            return (float) str_replace(',', '', $t);
        }

        return is_numeric($t) ? (float) $t : null;
    }

    /** YYYY-MM dari teks "2026-01", "2026/1", "01-2026", atau tanggal Excel. */
    private function period(mixed $v): ?string
    {
        if (is_numeric($v) && (float) $v > 20000) {
            return ExcelDate::excelToDateTimeObject((float) $v)->format('Y-m');
        }
        $t = trim((string) $v);
        if (preg_match('/^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?$/', $t, $m) && (int) $m[2] >= 1 && (int) $m[2] <= 12) {
            return sprintf('%04d-%02d', $m[1], $m[2]);
        }
        if (preg_match('/^(\d{1,2})[-\/.](\d{4})$/', $t, $m) && (int) $m[1] >= 1 && (int) $m[1] <= 12) {
            return sprintf('%04d-%02d', $m[2], $m[1]);
        }

        return null;
    }
}
