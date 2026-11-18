<?php

namespace App\Services\Master;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Services\Bom\BomService;
use App\Services\Kkf\KkfCalculator;
use App\Services\Kkf\KkfParameterService;
use App\Services\Kkf\KkfService;
use App\Services\Kkf\TariffBookService;
use App\Services\Notifications\InAppNotifier;
use App\Services\Prices\PriceBookService;
use App\Services\Rab\RabService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process as SymfonyProcess;
use Throwable;
use ZipArchive;

/**
 * Excel master uploaded from the screen (docs/85). The same extractors as tools/runbook.py read the workbook in a private work folder; the result is compared with the APPROVED data and only the
 * differences are applied, always as DRAFT versions that another account approves on the page of that dataset. Nothing here approves anything, and nothing overwrites approved data.
 *
 * Datasets: BOM (formula changes per group), PRICE (price book: the approved book with the changed prices overlaid, so manual corrections such as MDU values and zones are kept) and TARIFF (tariff book).
 * The workbook still carries the OLD KHS codes; they are translated with the code map. A code without a translation is a NEW item: it blocks the rows that need it and is reported (owner decision needed).
 */
class MasterExcelImportService
{
    public const KINDS = ['RAB_KKF', 'TARIF', 'DISTRIVA'];

    private const PRICE_FIELDS = ['status_material', 'harga_material', 'nilai_asuransi'];

    public function __construct(private readonly BomService $bom, private readonly PriceBookService $prices, private readonly TariffBookService $tariffs, private readonly MasterWorkbookReader $workbook) {}

    public function dir(string $id): string
    {
        return storage_path('app/master-excel/'.$id);
    }

    // ---------------------------------------------------------------- upload

    /** @return array<string,mixed> */
    public function store(UploadedFile $file, string $kind, ?string $ulpCode, User $actor): array
    {
        $max = (int) config('distriva.master_excel.max_mb') * 1024 * 1024;
        if ($file->getSize() === false || $file->getSize() > $max || $file->getSize() < 1000) {
            throw new AssignmentRuleViolation('Ukuran berkas tidak wajar (maksimal '.config('distriva.master_excel.max_mb').' MB).');
        }
        $this->assertSafeWorkbook($file->getRealPath());
        if ($kind === 'TARIF' && $ulpCode !== null && ! DB::table('organizational_units')->where('code', $ulpCode)->where('unit_type', 'ULP')->exists()) {
            throw new AssignmentRuleViolation('Kode ULP tidak dikenal.');
        }
        $id = (string) Str::uuid();
        File::ensureDirectoryExists($this->dir($id), 0700);
        File::copy($file->getRealPath(), $this->dir($id).'/source.xlsx');
        DB::table('master_excel_imports')->insert(['id' => $id, 'kind' => $kind, 'file_name' => mb_substr(basename((string) $file->getClientOriginalName()), 0, 255), 'sha256' => hash_file('sha256', $file->getRealPath()),
            'size_bytes' => $file->getSize(), 'ulp_code' => $kind === 'TARIF' ? $ulpCode : null, 'status' => 'UPLOADED', 'uploaded_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);

        return $this->show($id);
    }

    /** An .xlsx is a zip: refuse anything else, macros, and archives that expand absurdly (zip bomb) before any parser touches it. */
    private function assertSafeWorkbook(string $path): void
    {
        if (file_get_contents($path, false, null, 0, 4) !== "PK\x03\x04") {
            throw new AssignmentRuleViolation('Berkas bukan Excel (.xlsx).');
        }
        $zip = new ZipArchive;
        if ($zip->open($path, ZipArchive::RDONLY) !== true) {
            throw new AssignmentRuleViolation('Berkas Excel rusak atau tidak dapat dibuka.');
        }
        $total = 0;
        $hasWorkbook = false;
        if ($zip->numFiles > 3000) {
            $zip->close();
            throw new AssignmentRuleViolation('Isi berkas Excel tidak wajar.');
        }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $name = (string) ($st['name'] ?? '');
            $total += (int) ($st['size'] ?? 0);
            $hasWorkbook = $hasWorkbook || $name === 'xl/workbook.xml';
            if (str_contains($name, 'vbaProject') || str_contains($name, '..')) {
                $zip->close();
                throw new AssignmentRuleViolation('Berkas Excel berisi makro atau jalur tidak aman; simpan sebagai .xlsx biasa.');
            }
        }
        $zip->close();
        if (! $hasWorkbook || $total > 800 * 1024 * 1024) {
            throw new AssignmentRuleViolation('Berkas bukan buku kerja Excel yang wajar.');
        }
    }

    // ---------------------------------------------------------------- process

    public function start(string $id): void
    {
        $imp = $this->find($id);
        if (! in_array($imp->status, ['UPLOADED', 'FAILED', 'READY'], true)) {
            throw new AssignmentRuleViolation('Berkas ini tidak dapat diproses ulang pada statusnya sekarang.');
        }
        if (DB::table('master_excel_imports')->where('status', 'PROCESSING')->where('updated_at', '>', now()->subMinutes(15))->exists()) {
            throw new AssignmentRuleViolation('Masih ada berkas Excel yang diproses; tunggu sampai selesai.');
        }
        DB::table('master_excel_imports')->where('id', $id)->update(['status' => 'PROCESSING', 'report' => null, 'message' => null, 'updated_at' => now()]);
        if (config('distriva.master_excel.detach')) {
            $cmd = sprintf('nohup %s artisan distriva:master-excel-process %s > /dev/null 2>&1 &', escapeshellarg((string) config('distriva.backup.php')), escapeshellarg($id));
            SymfonyProcess::fromShellCommandline($cmd, base_path())->run();
        }
    }

    /** Runs the extractors and builds the report (called by the detached process). */
    public function process(string $id): void
    {
        $imp = DB::table('master_excel_imports')->where('id', $id)->where('status', 'PROCESSING')->first();
        if ($imp === null) {
            return;
        }
        $work = $this->dir($id).'/work';
        try {
            File::deleteDirectory($work);
            File::ensureDirectoryExists($work, 0700);
            $actor = User::query()->findOrFail($imp->uploaded_by);
            $src = $this->dir($id).'/source.xlsx';
            $map = $this->codeMap();
            $report = match ($imp->kind) {
                'TARIF' => $this->processTariff($src, $work, $imp->ulp_code),
                'DISTRIVA' => $this->processDistriva($src, $work, $actor),
                default => $this->processRab($src, $work, $map, $actor),
            };
            DB::table('master_excel_imports')->where('id', $id)->update(['status' => 'READY', 'report' => json_encode(['kind' => $imp->kind, 'generated_at' => now()->toIso8601String()] + $report, JSON_UNESCAPED_UNICODE), 'processed_at' => now(), 'updated_at' => now()]);
        } catch (Throwable $e) {
            DB::table('master_excel_imports')->where('id', $id)->update(['status' => 'FAILED', 'message' => Str::limit($e instanceof AssignmentRuleViolation ? $e->getMessage() : 'Pemrosesan gagal: '.class_basename($e), 400, '…'), 'updated_at' => now()]);
        }
    }

    /** @param list<string> $args */
    private function python(array $args): void
    {
        $tools = (string) config('distriva.master_excel.tools');
        $env = array_fill_keys(array_keys(getenv()), false);                    // nothing of the application's environment (database, tokens) reaches the extractors
        $p = new SymfonyProcess([(string) config('distriva.master_excel.python'), '-I', $tools.'/'.array_shift($args), ...$args], null, ['PATH' => (string) getenv('PATH'), 'LANG' => 'C.UTF-8'] + $env);
        $p->setTimeout((int) config('distriva.master_excel.timeout_seconds'))->run();
        if (! $p->isSuccessful()) {
            $last = trim((string) collect(explode("\n", trim($p->getErrorOutput().$p->getOutput())))->last());
            throw new AssignmentRuleViolation('Pembacaan Excel gagal'.($last !== '' ? ': '.Str::limit(preg_replace('#/[^\s]*#', '…', $last) ?? $last, 160) : '.').' Pastikan berkas adalah Excel master yang benar.');
        }
    }

    /** @return array<string,string> old KHS code => code in use */
    private function codeMap(): array
    {
        $path = (string) config('distriva.master_excel.code_map');
        if (! is_file($path)) {
            throw new AssignmentRuleViolation('Berkas peta kode lama ke baru tidak ditemukan di server.');
        }
        $map = [];
        $fh = fopen($path, 'r');
        fgetcsv($fh, null, ',', '"', '\\');
        while (($r = fgetcsv($fh, null, ',', '"', '\\')) !== false) {
            isset($r[1]) && $map[(string) $r[0]] = (string) $r[1];
        }
        fclose($fh);

        return $map;
    }

    /** @return list<array<string,string>> */
    private function readCsv(string $path): array
    {
        $out = [];
        $fh = fopen($path, 'r');
        $head = fgetcsv($fh, null, ',', '"', '\\');
        while (is_array($head) && ($r = fgetcsv($fh, null, ',', '"', '\\')) !== false) {
            $out[] = array_combine($head, array_pad(array_slice($r, 0, count($head)), count($head), ''));
        }
        fclose($fh);

        return $out;
    }

    /** @param list<list<mixed>> $rows */
    private function writeCsv(string $path, array $head, array $rows): void
    {
        $fh = fopen($path, 'w');
        fputcsv($fh, $head, ',', '"', '\\');
        foreach ($rows as $r) {
            fputcsv($fh, $r, ',', '"', '\\');
        }
        fclose($fh);
    }

    private function num(mixed $v): ?float
    {
        return $v === null || trim((string) $v) === '' || ! is_numeric($v) ? null : round((float) $v, 4);
    }

    // ---------------------------------------------------------------- RAB & KKF

    /**
     * @param  array<string,string>  $map
     * @return array<string,mixed>
     */
    private function processRab(string $src, string $work, array $map, User $actor): array
    {
        $this->python(['extract_khs_csv.py', $src, $work.'/khs.csv']);
        $this->python(['extract_price_csv.py', $src, $work.'/price.csv']);
        $this->python(['extract_bom_json.py', $src, $work]);
        $newKhs = [];
        foreach ($this->readCsv($work.'/khs.csv') as $r) {
            ! isset($map[$r['code']]) && $newKhs[] = ['code' => $r['code'], 'name' => $r['name']];
        }

        return ['bom' => $this->compareBom($work, $map, $actor), 'price' => $this->comparePrice($work, $map),
            'new_khs' => ['count' => count($newKhs), 'items' => array_slice($newKhs, 0, 20), 'note' => 'KHS baru di Excel belum bisa diimpor dari layar ini: butuh keputusan kode oleh pemilik dan nama pilihan pemilik (impor lewat halaman KHS).']];
    }

    /**
     * The DISTRIVA master workbook (docs/85): read by the PHP reader (no Python), compared with the approved BOM by the same comparison, and every changed group must also calculate to the numbers Excel stored.
     *
     * @return array<string,mixed>
     */
    private function processDistriva(string $src, string $work, User $actor): array
    {
        $r = $this->workbook->read($src);
        $report = ['meta' => $r['meta'], 'layout_problems' => array_slice($r['problems'], 0, 40), 'layout_problem_count' => count($r['problems'])];
        if ($r['problems'] !== [] || $r['docs'] === []) {
            return $report + ['bom' => ['groups' => []], 'blocked' => true];
        }
        $known = DB::table('khs_items')->pluck('id', 'code')->all();
        foreach ($r['docs'] as $group => $doc) {
            foreach ($doc['lines'] as &$l) {                       // a line whose code is a formula with exactly ONE KHS code in it keeps that code as its main code (as the Excel extractor does); a chain of several codes has none
                if (($l['khs_code'] ?? null) === null && isset($l['B']) && preg_match_all('/"([^"]+)"/', (string) $l['B'], $m)) {
                    $codes = array_values(array_unique(array_filter($m[1], fn ($lit) => isset($known[$lit]))));
                    count($codes) === 1 && $l['khs_code'] = $codes[0];
                }
            }
            unset($l);
            file_put_contents($work.'/bom_'.$group.'.json', json_encode($doc, JSON_UNESCAPED_UNICODE));
        }

        $out = $report + ['bom' => $this->compareBom($work, [], $actor, false, $r['sim']), 'blocked' => false];

        $codes = array_combine(array_map('strval', array_keys($known)), array_map('strval', array_keys($known)));
        $head = ['kode', 'nama', 'status_material', 'harga_material', 'nilai_asuransi'];
        foreach ($r['price']['zones'] as $z) {
            array_push($head, "z{$z}_pasang", "z{$z}_bongkar");
        }
        if ($r['price']['rows'] !== []) {
            $this->writeCsv($work.'/price.csv', $head, array_map(fn ($row) => array_map(fn ($c) => $row[$c] ?? '', $head), $r['price']['rows']));
            $out['price'] = $this->comparePrice($work, $codes);
        }
        if ($r['tariff']['rows'] !== []) {
            $ulps = DB::table('organizational_units')->where('unit_type', 'ULP')->pluck('code')->all();
            $unknown = collect($r['tariff']['rows'])->pluck('ulp')->filter(fn ($u) => $u !== '' && ! in_array($u, $ulps, true))->unique()->values()->all();
            if ($unknown !== []) {
                $out['layout_problems'][] = 'TARIF: kode ULP tidak dikenal: '.implode(', ', array_slice($unknown, 0, 8)).'.';
                $out['layout_problem_count']++;
                $out['blocked'] = true;
                $out['bom'] = ['groups' => []];
                unset($out['price']);
            } else {
                $out += $this->compareTariff($r['tariff']['rows'], $work, null, true);
            }
        }

        $out['rab'] = $this->compareRab($r['rab_cases']);
        $out['rules'] = $this->compareRules($r['kkf']['rules']);
        $out['kkf'] = $this->compareKkf($r['kkf']);

        return $out;
    }

    /**
     * KKF parameters of the workbook against the set in force, and the sample cases (UJI_KKF) against the engine run with the workbook's own parameters.
     *
     * @param  array{values:array<string,float>,rules:array<string,string>,cases:list<array<string,mixed>>}  $k
     * @return array<string,mixed>
     */
    private function compareKkf(array $k): array
    {
        $cur = app(KkfParameterService::class)->resolve(now()->toDateString());
        $changes = [];
        foreach (KkfParameterService::FIELDS as $f) {
            $old = (float) ($cur->{$f} ?? KkfParameterService::DEFAULTS[$f]);
            $new = $k['values'][$f] ?? null;
            if ($new !== null && abs($new - $old) > 1e-9) {
                $changes[] = ['field' => $f, 'label' => MasterWorkbookExporter::KKF_LABELS[$f][0], 'before' => $old, 'after' => $new];
            }
        }
        $p = fn (string $f) => (float) ($k['values'][$f] ?? KkfParameterService::DEFAULTS[$f]);
        $calc = new KkfCalculator;
        $checked = $skipped = 0;
        $mismatches = [];
        $problems = [];
        foreach ($k['cases'] as $c) {
            $i = array_map(fn ($v) => $v === '' ? null : (float) $v, $c['inputs']);
            try {
                $res = $calc->calculate(['investment' => $i['investment'], 'connection_fee' => $i['connection_fee'], 'power_kva' => $i['power_kva'], 'jam_nyala' => $i['jam_nyala'], 'avg_price' => $i['avg_price'], 'esthetic_fee' => $i['esthetic_fee'] ?? 0.0,
                    'bpp' => $p('bpp'), 'discount_rate' => $p('discount_rate'), 'om_rate' => $p('om_rate'), 'load_factor' => $p('load_factor'), 'horizon' => (int) $p('horizon_years'), 'payback_limit_months' => (int) $p('payback_limit_months')]);
            } catch (\InvalidArgumentException $e) {
                $problems[] = "UJI_KKF!A{$c['row']}: {$e->getMessage()}";

                continue;
            }
            $mine = ['npv' => $res['npv'], 'irr_percent' => $res['irr_percent'], 'payback_months' => $res['payback'] === null ? null : $res['payback']['years'] * 12 + $res['payback']['months']];
            $any = false;
            foreach (['npv' => 'H', 'irr_percent' => 'I', 'payback_months' => 'J'] as $key => $col) {
                if ($i[$key] === null) {
                    continue;
                }
                $any = true;
                $checked++;
                $ok = $mine[$key] !== null && match ($key) {
                    'npv' => abs($i[$key] - $mine[$key]) <= 1.0 + 1e-4 * abs($mine[$key]),
                    'irr_percent' => abs($i[$key] - $mine[$key]) <= 0.01,
                    default => (int) round($i[$key]) === (int) $mine[$key],
                };
                $ok || $mismatches[] = ['cell' => "UJI_KKF!{$col}{$c['row']}", 'case' => $c['name'], 'excel' => $i[$key], 'distriva' => $mine[$key] === null ? null : round($mine[$key], 4)];
            }
            if ($c['feasible'] !== '') {
                $any = true;
                $checked++;
                $mine['feasible'] = $res['feasible'] ? 'YA' : 'TIDAK';
                $c['feasible'] === $mine['feasible'] || $mismatches[] = ['cell' => "UJI_KKF!K{$c['row']}", 'case' => $c['name'], 'excel' => $c['feasible'], 'distriva' => $mine['feasible']];
            }
            $any || $skipped++;
        }
        $status = $cur === null ? 'NEW' : ($changes === [] ? 'UNCHANGED' : 'CHANGED');
        if ($mismatches !== []) {
            $problems[] = count($mismatches).' hasil contoh KKF di Excel berbeda dengan hitungan DISTRIVA (contoh: '.collect($mismatches)->take(3)->map(fn ($m) => "{$m['cell']} Excel={$m['excel']} DISTRIVA={$m['distriva']}")->implode('; ').'). Periksa rumus atau parameter di Excel; bila rumus KKF unit induk memang berubah, program DISTRIVA perlu disesuaikan.';
            $status !== 'UNCHANGED' && $status = 'BLOCKED';
        }

        return ['status' => $status, 'set' => $cur?->name, 'changes' => $changes, 'values' => $k['values'], 'cases' => ['checked' => $checked, 'skipped' => $skipped, 'mismatch_count' => count($mismatches), 'mismatches' => array_slice($mismatches, 0, 15)], 'problems' => $problems];
    }

    /**
     * UJI_RAB against the closing rule of the RAB (PPN and the rounded group total).
     *
     * @param  list<array<string,mixed>>  $cases
     * @return array<string,mixed>
     */
    private function compareRab(array $cases): array
    {
        $checked = 0;
        $mismatches = [];
        foreach ($cases as $c) {
            if ($c['subtotal'] === '') {
                continue;
            }
            $mine = RabService::closeGroup((float) $c['subtotal']);
            foreach (['ppn' => 'C', 'total' => 'D'] as $key => $col) {
                if ($c[$key] === '') {
                    continue;
                }
                $checked++;
                abs((float) $c[$key] - $mine[$key]) <= 0.005 || $mismatches[] = ['cell' => "UJI_RAB!{$col}{$c['row']}", 'case' => $c['name'], 'excel' => (float) $c[$key], 'distriva' => $mine[$key]];
            }
        }

        return ['status' => $mismatches === [] ? 'MATCH' : 'MISMATCH', 'checked' => $checked, 'mismatch_count' => count($mismatches), 'mismatches' => array_slice($mismatches, 0, 15)];
    }

    /**
     * Fixed rules that live in the program (PPN, insurance rate, KKF engine): a different value in the workbook is only reported.
     *
     * @param  array<string,string>  $rules
     * @return array<string,mixed>
     */
    private function compareRules(array $rules): array
    {
        $mine = ['ppn_rate' => [RabService::PPN, 'PPN pada RAB'], 'insurance_rate' => [RabService::INSURANCE, 'Tarif asuransi pada RAB'], 'kkf_engine' => [KkfService::ENGINE, 'Versi mesin hitung KKF']];
        $diff = [];
        foreach ($mine as $key => [$v, $label]) {
            $w = $rules[$key] ?? null;
            if ($w === null || $w === '') {
                continue;
            }
            $same = is_string($v) ? $w === $v : (is_numeric($w) && abs((float) $w - $v) < 1e-9);
            $same || $diff[] = ['rule' => $key, 'label' => $label, 'workbook' => $w, 'distriva' => (string) $v];
        }

        return ['status' => $diff === [] ? 'SAME' : 'DIFFERENT', 'differences' => $diff];
    }

    /**
     * @param  array<string,mixed>  $report
     * @return array<string,mixed>
     */
    private function applyKkf(array $report, string $validFrom, string $name, string $source, User $actor): array
    {
        $k = $report['kkf'] ?? null;
        if (! in_array($k['status'] ?? null, ['CHANGED', 'NEW'], true)) {
            throw new AssignmentRuleViolation('Tidak ada perubahan parameter KKF yang bisa diterapkan'.(($k['status'] ?? '') === 'BLOCKED' ? ' (hasil contoh KKF di Excel belum cocok dengan DISTRIVA)' : '').'.');
        }
        $id = app(KkfParameterService::class)->create(['name' => $name, 'valid_from' => $validFrom, 'notes' => $source, 'reason' => 'Impor template MASTER DISTRIVA'] + $k['values'], $actor);
        $this->notifyApproval('kkf_params.approve', 'kkf_parameter_sets', 'set parameter KKF', $actor, 'Parameter KKF', '/master-data/kkf-parameters');

        return ['status' => 'OK', 'id' => $id, 'message' => 'Set parameter KKF DRAFT dibuat ('.count($k['changes']).' nilai berubah).', 'link' => '/master-data/kkf-parameters'];
    }

    /**
     * Compares what the Excel stored for each formula with what the engine calculates for the same inputs.
     *
     * @param  array{rows:list<array<string,mixed>>, error:?string}  $res
     * @param  array<int,array<string,mixed>>  $expected  line => column => Excel's stored value
     * @return array<string,mixed>
     */
    private function parity(array $res, array $expected, string $group): array
    {
        $by = collect($res['rows'])->keyBy('sequence');
        $out = ['checked' => 0, 'no_stored_value' => 0, 'mismatch_count' => 0, 'mismatches' => []];
        $names = ['H' => 'material', 'I' => 'install', 'J' => 'remove', 'K' => 'return'];
        foreach ($expected as $seq => $cols) {
            $line = $by[$seq] ?? null;
            foreach ($cols as $col => $exp) {
                if ($line === null) {
                    continue;
                }
                if ($col === 'B') {
                    $a = ($exp === null || $exp === '' || $exp === false) ? null : (is_numeric($exp) ? (string) (int) $exp : (string) $exp);
                    $b = $line['khs_code'] === null || $line['khs_code'] === '' ? null : (string) $line['khs_code'];
                    $same = $a === $b;
                } else {
                    if ($exp === null || $exp === '') {
                        $out['no_stored_value']++;

                        continue;
                    }
                    $a = is_numeric($exp) ? (float) $exp : null;
                    $b = (float) $line[$names[$col]];
                    $same = $a !== null && abs($a - $b) <= 1e-6 * max(1.0, abs($a), abs($b));
                }
                $out['checked']++;
                if (! $same) {
                    $out['mismatch_count']++;
                    count($out['mismatches']) < 15 && $out['mismatches'][] = ['cell' => "{$group}!{$col}{$seq}", 'excel' => is_float($a ?? null) ? round($a, 6) : ($a ?? $exp), 'distriva' => is_float($b ?? null) ? round($b, 6) : $b];
                }
            }
        }

        return $out;
    }

    /**
     * @param  array<string,string>  $map
     * @return array<string,mixed>
     */
    private function compareBom(string $work, array $map, User $actor, bool $translate = true, array $sim = []): array
    {
        $groups = [];
        foreach (glob($work.'/bom_*.json') ?: [] as $f) {
            $doc = json_decode((string) file_get_contents($f), true, 512);
            if (! is_array($doc) || ! in_array($doc['group'] ?? '', (array) config('distriva.bom_groups'), true)) {
                continue;
            }
            $unknown = [];
            $translate = $translate && ! ($doc['codes_final'] ?? false);    // SR1PH: the sheet names its materials, the extractor already gives the code in use
            foreach ($doc['lines'] as &$l) {
                if ($translate && ($l['khs_code'] ?? null) !== null) {
                    $c = (string) $l['khs_code'];
                    isset($map[$c]) || $unknown[$c] = true;
                    $l['khs_code'] = $map[$c] ?? $c;
                }
                if ($translate && isset($l['B']) && is_string($l['B'])) {       // KHS code literals inside the column-B formula IF(<condition>, <code>, …)
                    $l['B'] = preg_replace_callback('/,\s*(\d+)\s*,(?=\s*(?:IF\(|""))/', function ($m) use ($map, &$unknown) {
                        isset($map[$m[1]]) || $unknown[$m[1]] = true;

                        return ',"'.($map[$m[1]] ?? $m[1]).'",';
                    }, $l['B']);
                }
            }
            unset($l);
            $group = (string) $doc['group'];
            file_put_contents($work.'/bom_'.$group.'.translated.json', json_encode($doc, JSON_UNESCAPED_UNICODE));
            $row = ['group' => $group, 'excel_lines' => count($doc['lines']), 'current_lines' => 0, 'changed' => 0, 'added' => 0, 'removed' => 0, 'samples' => [], 'problems' => [], 'new_codes' => array_keys($unknown)];
            $cur = $this->currentBomLines($group);
            if ($cur === null) {
                $row['status'] = 'NEW';
            } else {
                $row['current_lines'] = count($cur);
                $new = [];
                foreach ($doc['lines'] as $l) {
                    $new[(int) $l['sequence']] = $this->bomKey($l);
                }
                foreach ($new as $seq => $key) {
                    if (! isset($cur[$seq])) {
                        $row['added']++;
                    } elseif ($cur[$seq] !== $key) {
                        $row['changed']++;
                        count($row['samples']) < 8 && $row['samples'][] = ['sequence' => $seq, 'before' => $this->bomLabel($cur[$seq]), 'after' => $this->bomLabel($key)];
                    }
                }
                $row['removed'] = count(array_diff_key($cur, $new));
                $row['status'] = ($row['changed'] + $row['added'] + $row['removed']) === 0 ? 'UNCHANGED' : 'CHANGED';
            }
            if ($row['new_codes'] !== []) {
                $row['status'] = 'BLOCKED';
                $row['problems'][] = 'Ada kode KHS di Excel yang belum punya kode baru: '.implode(', ', array_slice($row['new_codes'], 0, 8)).'.';
            } elseif ($row['status'] !== 'UNCHANGED') {
                $dry = $this->bom->import($doc, now()->toDateString(), null, true, $actor);
                foreach (array_slice($dry['problems'], 0, 5) as $p) {
                    $row['problems'][] = ($p['where'] ?? '').': '.implode(' ', (array) ($p['messages'] ?? []));
                }
                $dry['problems'] !== [] && $row['status'] = 'BLOCKED';
            }
            if (isset($sim[$group]) && $row['status'] !== 'BLOCKED') {
                $res = $this->bom->simulate($doc, $sim[$group]['typed'], $sim[$group]['params'], $actor);
                if ($res['error'] !== null) {
                    $row['problems'][] = 'Perhitungan uji gagal: '.$res['error'];
                    $row['status'] !== 'UNCHANGED' && $row['status'] = 'BLOCKED';
                } else {
                    $row['parity'] = $this->parity($res, $sim[$group]['expected'], $group);
                    if ($row['parity']['mismatch_count'] > 0) {
                        $row['problems'][] = $row['parity']['mismatch_count'].' sel hasil hitung Excel berbeda dengan hitungan DISTRIVA (contoh: '.collect($row['parity']['mismatches'])->take(3)->map(fn ($m) => "{$m['cell']} Excel={$m['excel']} DISTRIVA={$m['distriva']}")->implode('; ').').';
                        $row['status'] !== 'UNCHANGED' && $row['status'] = 'BLOCKED';
                    }
                }
            }
            $groups[] = $row;
        }
        usort($groups, fn ($a, $b) => strcmp($a['group'], $b['group']));

        return ['groups' => $groups];
    }

    /** @return array<int,array<string,?string>>|null  sequence => comparable line of the approved version (null: the group has none) */
    private function currentBomLines(string $group): ?array
    {
        $h = DB::table('bom_headers')->where('group_code', $group)->where('status', 'APPROVED')->orderByDesc('version_number')->first();
        if ($h === null) {
            return null;
        }
        $out = [];
        foreach (DB::table('bom_lines as l')->leftJoin('khs_items as k', 'k.id', '=', 'l.khs_item_id')->where('l.bom_header_id', $h->id)->get(['l.sequence', 'k.code', 'l.source_formulas']) as $l) {
            $src = json_decode((string) $l->source_formulas, true) ?: [];
            $out[(int) $l->sequence] = $this->bomKey(['khs_code' => $l->code] + $src);
        }

        return $out;
    }

    /**
     * @param  array<string,mixed>  $l
     * @return array<string,?string>
     */
    private function bomKey(array $l): array
    {
        $k = ['khs' => ($l['khs_code'] ?? null) === null ? null : (string) $l['khs_code']];
        foreach (['B', 'H', 'I', 'J', 'K'] as $c) {
            $v = isset($l[$c]) ? $this->normFormula((string) $l[$c]) : '';
            $k[$c] = $v === '' ? null : $v;
        }

        return $k;
    }

    /** Formula text without spaces outside quotes and without a leading "=": Excel rewrites spacing when it saves, which is not a change of the rule. */
    private function normFormula(string $f): string
    {
        $parts = preg_split('/("(?:[^"]|"")*")/', ltrim(trim($f), '='), -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
        foreach ($parts as $i => $part) {
            $i % 2 === 0 && $parts[$i] = preg_replace('/\s+/', '', $part);
        }

        return implode('', $parts);
    }

    /** @param array<string,?string> $k */
    private function bomLabel(array $k): string
    {
        return Str::limit(collect($k)->filter(fn ($v) => $v !== null)->map(fn ($v, $c) => $c.'='.$v)->implode('  '), 160, '…');
    }

    /**
     * @param  array<string,string>  $map
     * @return array<string,mixed>
     */
    private function comparePrice(string $work, array $map): array
    {
        $cur = $this->currentPrice();
        if ($cur === null) {
            return ['status' => 'BLOCKED', 'problems' => ['Belum ada buku harga yang disetujui sebagai dasar perbandingan.']];
        }
        $rows = $this->readCsv($work.'/price.csv');
        $changed = [];
        $newCodes = [];
        $added = 0;
        $unchanged = 0;
        $samples = [];
        $mdu = [];
        foreach ($rows as $r) {
            $code = $map[$r['kode']] ?? null;
            if ($code === null) {
                $newCodes[] = $r['kode'];

                continue;
            }
            if (! isset($cur['items'][$code])) {
                $added++;

                continue;
            }
            $it = $cur['items'][$code];
            $diff = [];
            $exMdu = $this->num($r['nilai_asuransi'] ?? null);                          // MDU is never overwritten from Excel: only reported, decided by hand on the draft book
            if ($exMdu !== null && $exMdu > 0 && ($it['insured'] === null || abs($exMdu - $it['insured']) >= 0.5)) {
                $mdu[] = ['code' => $code, 'name' => $it['name'], 'current' => $it['insured'], 'excel' => $exMdu];
            }
            foreach ($cur['zones_used'] as $z) {
                foreach (['pasang' => 0, 'bongkar' => 1] as $label => $i) {
                    $ex = $this->num($r["z{$z}_{$label}"] ?? null);
                    $db = $it['zones'][$z][$i] ?? null;
                    if ($ex !== null && ($db === null || abs($ex - $db) >= 0.5)) {
                        $diff["z{$z}_{$label}"] = [$db, $ex];
                    }
                }
            }
            $ex = $this->num($r['harga_material'] ?? null);
            if ($it['status'] === 'PRICED' && $ex !== null && ($it['price'] === null || abs($ex - $it['price']) >= 0.5)) {
                $diff['harga_material'] = [$it['price'], $ex];
            }
            if ($diff === []) {
                $unchanged++;

                continue;
            }
            $changed[$code] = $diff;
            count($samples) < 10 && $samples[] = ['code' => $code, 'name' => $it['name'], 'fields' => array_map(fn ($c, $d) => ['field' => $c, 'before' => $d[0], 'after' => $d[1]], array_keys($diff), array_values($diff))];
        }
        $candidate = $work.'/price_candidate.csv';
        $head = ['kode', 'nama', 'status_material', 'harga_material', 'nilai_asuransi'];
        foreach ($cur['zones_used'] as $z) {
            array_push($head, "z{$z}_pasang", "z{$z}_bongkar");
        }
        $out = [];
        foreach ($cur['items'] as $code => $it) {
            $row = [$code, $it['name'], $it['status'] === 'PLN' ? 'PLN' : 'HARGA', $it['status'] === 'PLN' ? '' : ($changed[$code]['harga_material'][1] ?? $it['price']), $it['insured'] ?? ''];
            foreach ($cur['zones_used'] as $z) {
                $row[] = $changed[$code]["z{$z}_pasang"][1] ?? ($it['zones'][$z][0] ?? '');
                $row[] = $changed[$code]["z{$z}_bongkar"][1] ?? ($it['zones'][$z][1] ?? '');
            }
            $out[] = $row;
        }
        $this->writeCsv($candidate, $head, $out);

        return ['status' => $changed === [] ? 'UNCHANGED' : 'CHANGED', 'excel_rows' => count($rows), 'current_rows' => count($cur['items']), 'changed_rows' => count($changed), 'unchanged_rows' => $unchanged, 'added_in_excel' => $added,
            'new_codes' => ['count' => count($newCodes), 'items' => array_slice($newCodes, 0, 15)], 'samples' => $samples, 'book' => $cur['name'], 'problems' => [],
            'mdu_differences' => ['count' => count($mdu), 'items' => array_slice($mdu, 0, 30)],
            'note' => 'Status PLN/HARGA, nilai MDU, dan zona UP3 dari buku yang berlaku dipertahankan; hanya harga jasa/material yang berbeda di Excel yang diubah. Selisih nilai MDU hanya dilaporkan.'];
    }

    /** @return array{name:string,contract:?string,items:array<string,array<string,mixed>>,zones_used:list<int>,zones:array<string,int>}|null */
    private function currentPrice(): ?array
    {
        $pb = DB::table('price_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
        if ($pb === null) {
            return null;
        }
        $names = DB::table('khs_item_versions as v')->whereRaw('v.version_number = (select max(x.version_number) from khs_item_versions x where x.khs_item_id = v.khs_item_id)')->pluck('v.name', 'v.khs_item_id')->all();
        $items = [];
        $used = [];
        foreach (DB::table('price_book_items as p')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')->where('p.price_book_id', $pb->id)->orderBy('i.code')->get(['p.id', 'p.khs_item_id', 'i.code', 'p.material_status', 'p.material_price', 'p.insured_value']) as $p) {
            $zones = [];
            foreach (DB::table('price_book_service_prices')->where('price_book_item_id', $p->id)->get() as $z) {
                $zones[(int) $z->zone] = [$this->num($z->install_price), $this->num($z->remove_price)];
                $used[(int) $z->zone] = true;
            }
            $items[$p->code] = ['name' => (string) ($names[$p->khs_item_id] ?? $p->code), 'status' => $p->material_status, 'price' => $this->num($p->material_price), 'insured' => $this->num($p->insured_value), 'zones' => $zones];
        }
        $zonesUsed = array_keys($used);
        sort($zonesUsed);
        $zones = DB::table('price_book_zones as z')->join('organizational_units as u', 'u.id', '=', 'z.up3_unit_id')->where('z.price_book_id', $pb->id)->pluck('z.zone', 'z.up3_unit_id')->all();

        return ['name' => $pb->name, 'contract' => $pb->contract_reference, 'items' => $items, 'zones_used' => $zonesUsed, 'zones' => array_map('intval', $zones), 'book_id' => $pb->id];
    }

    // ---------------------------------------------------------------- tariff

    /** @return array<string,mixed> */
    private function processTariff(string $src, string $work, ?string $ulp): array
    {
        $this->python(['extract_tariff_csv.py', $src, $work.'/tariff.csv'] + ($ulp !== null ? [3 => '--ulp', 4 => $ulp] : []));
        $rows = $this->readCsv($work.'/tariff.csv');
        if ($rows === []) {
            throw new AssignmentRuleViolation('Tidak ada baris tarif yang terbaca dari Excel.');
        }

        return $this->compareTariff($rows, $work, $ulp, false);
    }

    /**
     * Compares tariff rows (from the Excel extractor or the DISTRIVA workbook) with the approved book; rows of the book that are not in the file stay.
     *
     * @param  list<array<string,string>>  $rows  tarif, daya_va, harga_rata2, jam_nyala, ujl, ulp
     * @param  bool  $ulpPerRow  every row carries its own ULP (the DISTRIVA workbook), so no single ULP has to be chosen
     * @return array<string,mixed>
     */
    private function compareTariff(array $rows, string $work, ?string $ulp, bool $ulpPerRow): array
    {
        $cur = DB::table('tariff_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
        $currentRows = [];
        if ($cur !== null) {
            foreach (DB::table('tariff_book_rows as r')->leftJoin('organizational_units as u', 'u.id', '=', 'r.ulp_unit_id')->where('r.tariff_book_id', $cur->id)->get(['u.code as ulp', 'r.tariff_code', 'r.power_va', 'r.avg_price', 'r.jam_nyala', 'r.ujl']) as $r) {
                $currentRows[$this->tariffKey($r->ulp, $r->tariff_code, $r->power_va)] = ['tarif' => $r->tariff_code, 'daya_va' => $r->power_va, 'harga_rata2' => $this->num($r->avg_price), 'jam_nyala' => $this->num($r->jam_nyala), 'ujl' => $this->num($r->ujl), 'ulp' => $r->ulp];
            }
        }
        $problems = [];
        $changed = $added = $same = 0;
        $samples = [];
        $merged = $currentRows;
        foreach ($rows as $r) {
            $key = $this->tariffKey($r['ulp'] ?? '', $r['tarif'], $r['daya_va'] ?? '');
            $new = ['tarif' => $r['tarif'], 'daya_va' => ($r['daya_va'] ?? '') === '' ? null : (int) $r['daya_va'], 'harga_rata2' => $this->num($r['harga_rata2']), 'jam_nyala' => $this->num($r['jam_nyala']), 'ujl' => $this->num($r['ujl'] ?? null), 'ulp' => ($r['ulp'] ?? '') === '' ? null : $r['ulp']];
            if (($new['jam_nyala'] ?? 0) > 1000) {
                $problems[$new['tarif'].' '.$new['daya_va']] = 'Jam nyala '.$new['jam_nyala'].' tampak bukan satuan jam per bulan (periksa satuan di Excel).';
            }
            $old = $currentRows[$key] ?? null;
            if ($old === null) {
                $added++;
            } elseif ($old['harga_rata2'] !== $new['harga_rata2'] || $old['jam_nyala'] !== $new['jam_nyala'] || $old['ujl'] !== $new['ujl']) {
                $changed++;
                count($samples) < 10 && $samples[] = ['key' => ($new['ulp'] ?? 'semua ULP').' · '.$new['tarif'].' '.($new['daya_va'] ?? ''), 'before' => 'harga '.$old['harga_rata2'].', jam '.$old['jam_nyala'].', UJL '.$old['ujl'], 'after' => 'harga '.$new['harga_rata2'].', jam '.$new['jam_nyala'].', UJL '.$new['ujl']];
            } else {
                $same++;
            }
            $merged[$key] = $new;
        }
        $after = [];
        foreach ($merged as $m) {
            $after[(string) ($m['ulp'] ?? '')] = ($after[(string) ($m['ulp'] ?? '')] ?? 0) + 1;
        }
        $warnings = [];
        if (! $ulpPerRow && $ulp === null && collect($currentRows)->contains(fn ($r) => $r['ulp'] !== null)) {
            $warnings[] = 'ULP tidak dipilih, jadi baris dari Excel berlaku untuk semua ULP. Karena buku berlaku sudah punya baris khusus per ULP, pilih ULP asal laporan penjualan agar jam nyala tidak tercampur.';
        }
        $out = array_map(fn ($m) => [$m['tarif'], $m['daya_va'] ?? '', $m['harga_rata2'] ?? '', $m['jam_nyala'] ?? '', $m['ujl'] ?? '', $m['ulp'] ?? ''], array_values($merged));
        $this->writeCsv($work.'/tariff_candidate.csv', ['tarif', 'daya_va', 'harga_rata2', 'jam_nyala', 'ujl', 'ulp'], $out);

        return ['tariff' => ['status' => $problems !== [] ? 'BLOCKED' : ($changed + $added === 0 ? 'UNCHANGED' : 'CHANGED'), 'excel_rows' => count($rows), 'current_rows' => count($currentRows), 'changed_rows' => $changed, 'added_rows' => $added, 'unchanged_rows' => $same,
            'samples' => $samples, 'problems' => array_values($problems), 'warnings' => $warnings, 'coverage_after' => $this->tariffCoverage($after), 'book' => $cur?->name,
            'note' => 'Baris ULP lain di buku yang berlaku dipertahankan; baris dari Excel menggantikan/menambah baris dengan tarif, daya, dan ULP yang sama.']];
    }

    /**
     * Rows of the tariff book per ULP: which ULPs have jam nyala and UJL and which still wait for their sales report. `rows` of the key "" are the rows that apply to every ULP.
     *
     * @param  array<string,int>|null  $counts  ULP code => rows (null: read the approved book)
     * @return list<array{code:string,name:string,rows:int}>
     */
    public function tariffCoverage(?array $counts = null): array
    {
        if ($counts === null) {
            $book = DB::table('tariff_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
            $counts = $book === null ? [] : DB::table('tariff_book_rows as r')->leftJoin('organizational_units as u', 'u.id', '=', 'r.ulp_unit_id')->where('r.tariff_book_id', $book->id)
                ->selectRaw("coalesce(u.code, '') as code, count(*) as n")->groupBy('code')->pluck('n', 'code')->map(fn ($n) => (int) $n)->all();
        }
        $out = DB::table('organizational_units')->where('unit_type', 'ULP')->where('is_active', true)->orderBy('code')->get(['code', 'name'])->map(fn ($u) => ['code' => $u->code, 'name' => $u->name, 'rows' => (int) ($counts[$u->code] ?? 0)])->all();
        isset($counts['']) && $out[] = ['code' => '', 'name' => 'Berlaku untuk semua ULP', 'rows' => (int) $counts['']];

        return $out;
    }

    private function tariffKey(?string $ulp, string $tariff, mixed $power): string
    {
        return ($ulp ?? '').'|'.strtoupper(trim($tariff)).'|'.($power === null || $power === '' ? '' : (int) $power);
    }

    // ---------------------------------------------------------------- apply

    /**
     * Applies ONE dataset as DRAFT. Returns the result that is kept on the import.
     *
     * @param  array<string,mixed>  $params  valid_from (Y-m-d), name (books), groups (BOM)
     * @return array<string,mixed>
     */
    public function apply(string $id, string $dataset, array $params, User $actor): array
    {
        $imp = $this->find($id);
        if ($imp->status !== 'READY') {
            throw new AssignmentRuleViolation('Berkas belum selesai diperiksa atau gagal diperiksa.');
        }
        $report = json_decode((string) $imp->report, true) ?? [];
        $applied = json_decode((string) $imp->applied, true) ?? [];
        if (($applied[$dataset]['status'] ?? null) === 'OK') {
            throw new AssignmentRuleViolation('Dataset ini sudah diterapkan dari berkas ini.');
        }
        $work = $this->dir($id).'/work';
        $validFrom = (string) $params['valid_from'];
        $source = 'Excel '.$imp->file_name.' (impor layar, sha256 '.substr($imp->sha256, 0, 12).')';
        if (! empty($report['meta']['basis'])) {
            $source = Str::limit($source.'; dasar: '.$report['meta']['basis'], 250, '…');
        }
        $result = match ($dataset) {
            'BOM' => $this->applyBom($report, $work, $validFrom, $source, (array) ($params['groups'] ?? []), $actor),
            'PRICE' => $this->applyPrice($report, $work, $validFrom, (string) $params['name'], $source, $actor),
            'TARIFF' => $this->applyTariff($report, $work, $validFrom, (string) $params['name'], $source, $actor),
            'KKF' => $this->applyKkf($report, $validFrom, (string) $params['name'], $source, $actor),
            default => throw new AssignmentRuleViolation('Dataset tidak dikenal.'),
        };
        $applied[$dataset] = $result + ['at' => now()->toIso8601String(), 'by' => $actor->name];
        DB::table('master_excel_imports')->where('id', $id)->update(['applied' => json_encode($applied, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);

        return $applied[$dataset];
    }

    /**
     * @param  array<string,mixed>  $report
     * @param  list<string>  $groups
     * @return array<string,mixed>
     */
    private function applyBom(array $report, string $work, string $validFrom, string $source, array $groups, User $actor): array
    {
        $rows = collect($report['bom']['groups'] ?? [])->keyBy('group');
        $groups = $groups === [] ? $rows->filter(fn ($g) => $g['status'] === 'CHANGED')->keys()->all() : $groups;
        $done = [];
        $failed = [];
        foreach ($groups as $g) {
            $row = $rows[$g] ?? null;
            if ($row === null || $row['status'] !== 'CHANGED') {
                $failed[$g] = 'tidak ada perubahan yang bisa diterapkan (status '.($row['status'] ?? 'tidak dikenal').')';

                continue;
            }
            try {
                $doc = json_decode((string) file_get_contents($work.'/bom_'.$g.'.translated.json'), true, 512, JSON_THROW_ON_ERROR);
                $this->bom->import($doc, $validFrom, $source, false, $actor);
                $done[] = $g;
            } catch (AssignmentRuleViolation $e) {
                $failed[$g] = $e->getMessage();
            }
        }
        if ($done === [] && $failed !== []) {
            throw new AssignmentRuleViolation('BOM tidak diterapkan: '.collect($failed)->map(fn ($m, $k) => "{$k}: {$m}")->implode('; '));
        }
        $this->notifyApproval('bom.approve', 'bom_headers', 'BOM', $actor, 'BOM', '/master-data/bom');

        return ['status' => 'OK', 'message' => count($done).' kelompok BOM dibuat sebagai DRAFT ('.implode(', ', $done).')'.($failed ? '; tidak diterapkan: '.implode(', ', array_keys($failed)) : '').'.', 'link' => '/master-data/bom'];
    }

    /**
     * @param  array<string,mixed>  $report
     * @return array<string,mixed>
     */
    private function applyPrice(array $report, string $work, string $validFrom, string $name, string $source, User $actor): array
    {
        if (($report['price']['status'] ?? null) !== 'CHANGED') {
            throw new AssignmentRuleViolation('Tidak ada perubahan harga yang bisa diterapkan.');
        }
        $cur = $this->currentPrice() ?? throw new AssignmentRuleViolation('Belum ada buku harga yang disetujui.');
        $file = new UploadedFile($work.'/price_candidate.csv', 'harga-dari-excel.csv', 'text/csv', null, true);
        $r = $this->prices->import($file, $name, $cur['contract'], $validFrom, $source, false, $actor);
        $bookId = (string) $r['summary']['id'];
        foreach (DB::table('price_book_zones')->where('price_book_id', $cur['book_id'])->get(['up3_unit_id', 'zone']) as $z) {      // the zone of every UP3 follows the book it replaces
            $this->prices->setZone($bookId, $z->up3_unit_id, (int) $z->zone, 'Zona disalin dari buku harga yang berlaku (impor Excel).', $actor);
        }
        $this->notifyApproval('prices.approve', 'price_books', 'buku harga', $actor, 'Buku Harga', '/master-data/harga');

        return ['status' => 'OK', 'id' => $bookId, 'message' => 'Buku harga DRAFT dibuat ('.$r['summary']['accepted_rows'].' baris, '.($report['price']['changed_rows'] ?? 0).' berubah).', 'link' => '/master-data/harga'];
    }

    /**
     * @param  array<string,mixed>  $report
     * @return array<string,mixed>
     */
    private function applyTariff(array $report, string $work, string $validFrom, string $name, string $source, User $actor): array
    {
        if (($report['tariff']['status'] ?? null) !== 'CHANGED') {
            throw new AssignmentRuleViolation('Tidak ada perubahan tarif yang bisa diterapkan'.(($report['tariff']['status'] ?? '') === 'BLOCKED' ? ' (ada masalah yang harus dibereskan di Excel)' : '').'.');
        }
        $file = new UploadedFile($work.'/tariff_candidate.csv', 'tarif-dari-excel.csv', 'text/csv', null, true);
        $r = $this->tariffs->import($file, $name, $validFrom, $source, false, $actor);
        $this->notifyApproval('tariffs.approve', 'tariff_books', 'buku tarif', $actor, 'Buku Tarif', '/master-data/tariff-books');

        return ['status' => 'OK', 'id' => (string) ($r['summary']['tariff_book_id'] ?? ''), 'message' => 'Buku tarif DRAFT dibuat ('.($r['summary']['accepted'] ?? '?').' baris).', 'link' => '/master-data/tariff-books'];
    }

    private function notifyApproval(string $permission, string $table, string $label, User $actor, string $title, string $link): void
    {
        app(InAppNotifier::class)->approvalRequested($permission, $table, $label, $actor, $title, $link);
    }

    // ---------------------------------------------------------------- read

    private function find(string $id): object
    {
        return DB::table('master_excel_imports')->where('id', $id)->where('status', '!=', 'DISCARDED')->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
    }

    /** @return array<string,mixed> */
    public function show(string $id): array
    {
        $r = DB::table('master_excel_imports as i')->leftJoin('users as u', 'u.id', '=', 'i.uploaded_by')->where('i.id', $id)->where('i.status', '!=', 'DISCARDED')->first(['i.*', 'u.name as uploaded_by_name']) ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);

        return $this->present($r, true);
    }

    /** @return list<array<string,mixed>> */
    public function list(): array
    {
        return DB::table('master_excel_imports as i')->leftJoin('users as u', 'u.id', '=', 'i.uploaded_by')->where('i.status', '!=', 'DISCARDED')->orderByDesc('i.created_at')->limit(20)->get(['i.*', 'u.name as uploaded_by_name'])->map(fn ($r) => $this->present($r, false))->all();
    }

    public function discard(string $id): void
    {
        $this->find($id);
        DB::table('master_excel_imports')->where('id', $id)->update(['status' => 'DISCARDED', 'report' => null, 'updated_at' => now()]);
        File::deleteDirectory($this->dir($id));
    }

    /** @return array<string,mixed> */
    private function present(object $r, bool $withReport): array
    {
        return ['id' => $r->id, 'kind' => $r->kind, 'file_name' => $r->file_name, 'size_bytes' => (int) $r->size_bytes, 'ulp_code' => $r->ulp_code, 'status' => $r->status, 'message' => $r->message,
            'uploaded_by_name' => $r->uploaded_by_name ?? null, 'created_at' => $r->created_at, 'processed_at' => $r->processed_at, 'applied' => json_decode((string) $r->applied, true) ?: (object) [],
            'report' => $withReport ? (json_decode((string) $r->report, true) ?: null) : null];
    }
}
