<?php

namespace App\Services\Bom;

use App\Formula\Evaluator;
use App\Formula\FormulaException;
use App\Formula\Resolver;
use Illuminate\Support\Facades\DB;

/**
 * Evaluates a BOM version for given construction quantities. Pure read: nothing is stored.
 * Inputs: code => ['psg' => n, 'bkr' => n] (quantity of each construction; absent = 0); params: name => n (declared by the
 * BOM version; absent = its default).
 * Own-sheet references resolve to other lines of the same version (sequence = workbook row): column B = KHS code,
 * H–K = that line's computed material / install / remove / return quantity.
 */
class BomCalculator
{
    /**
     * @param  array<string, array{psg?: int|float, bkr?: int|float}>  $inputs
     * @param  array<string, int|float>  $params
     * @return list<array{sequence:int, khs_code:?string, aggregate:bool, description:?string, material:float, install:float, remove:float, return:float}>
     */
    public function calculate(string $headerId, array $inputs, array $params = []): array
    {
        $defs = json_decode((string) DB::table('bom_headers')->where('id', $headerId)->value('parameters'), true) ?: [];
        $values = [];
        foreach ($defs as $d) {
            if (($d['type'] ?? 'number') === 'text') {      // choice parameter (power range, job type, TUNAI/PLN)
                $v = trim((string) ($params[$d['name']] ?? $d['default'] ?? ''));
                if ($v !== '' && is_array($d['options'] ?? null) && ! in_array($v, $d['options'], true)) {
                    throw new FormulaException("Nilai {$v} bukan pilihan parameter {$d['name']}.");
                }
                $values[$d['name']] = $v;

                continue;
            }
            $values[$d['name']] = (float) ($params[$d['name']] ?? $d['default'] ?? 0);
        }
        $lines = DB::table('bom_lines as l')->leftJoin('khs_items as i', 'i.id', '=', 'l.khs_item_id')->where('l.bom_header_id', $headerId)
            ->orderBy('l.sequence')->get(['l.sequence', 'l.description', 'l.formulas', 'i.code as khs_code']);
        $bySeq = [];
        foreach ($lines as $l) {
            $bySeq[$l->sequence] = ['khs_code' => $l->khs_code, 'description' => $l->description, 'formulas' => json_decode($l->formulas, true)];
        }

        $resolver = new class($bySeq, $inputs, $values) implements Resolver
        {
            /** @var array<string,mixed> */
            private array $memo = [];

            /** @var array<string,bool> */
            private array $busy = [];

            public function __construct(private readonly array $lines, private readonly array $inputs, private readonly array $params) {}

            public function cell(?string $sheet, string $ref): mixed
            {
                if ($sheet !== null) {
                    throw new FormulaException('Referensi sheet lain tidak didukung.');
                }
                if (! preg_match('/^([A-Z]{1,3})(\d+)$/', $ref, $m)) {
                    throw new FormulaException("Referensi tidak valid: {$ref}");
                }
                $row = (int) $m[2];
                if ($m[1] === 'B') {
                    $code = $this->code($row);

                    return $code === null ? null : (is_numeric($code) ? (float) $code : $code);
                }

                return $this->output($row, $m[1]);
            }

            /** KHS code of a line: static, or the result of its column-B formula (null/'' = the line is not active for these inputs). */
            public function code(int $row): mixed
            {
                $ast = $this->lines[$row]['formulas']['B'] ?? null;
                if ($ast === null) {
                    return $this->lines[$row]['khs_code'] ?? null;
                }
                $key = 'B'.$row;
                if (! array_key_exists($key, $this->memo)) {
                    if (isset($this->busy[$key])) {
                        throw new FormulaException("Siklus rumus pada {$key}.");
                    }
                    $this->busy[$key] = true;
                    $v = (new Evaluator($this))->evaluate($ast);
                    unset($this->busy[$key]);
                    $this->memo[$key] = ($v === '' || $v === null || $v === false) ? null : (is_numeric($v) ? (string) (int) $v : (string) $v);
                }

                return $this->memo[$key];
            }

            public function variable(string $name): mixed
            {
                if (str_starts_with($name, 'PARAM:')) {
                    $key = substr($name, 6);
                    if (! array_key_exists($key, $this->params)) {
                        throw new FormulaException("Parameter tidak dideklarasikan: {$key}");
                    }

                    return $this->params[$key];
                }
                if (! preg_match('/^(PSG|BKR):(.+)$/', $name, $m)) {
                    throw new FormulaException("Variabel tidak dikenal: {$name}");
                }

                return (float) ($this->inputs[$m[2]][strtolower($m[1])] ?? 0);
            }

            public function output(int $row, string $col): mixed
            {
                $key = $col.$row;
                if ($col === 'B') {
                    return ($c = $this->code($row)) === null ? null : (is_numeric($c) ? (float) $c : $c);
                }
                if (array_key_exists($key, $this->memo)) {
                    return $this->memo[$key];
                }
                $ast = $this->lines[$row]['formulas'][$col] ?? null;
                if ($ast === null) {
                    return $this->memo[$key] = null;
                }
                if (isset($this->busy[$key])) {
                    throw new FormulaException("Siklus rumus pada {$key}.");
                }
                $this->busy[$key] = true;
                $v = (new Evaluator($this))->evaluate($ast);
                unset($this->busy[$key]);

                return $this->memo[$key] = $v;
            }
        };

        $out = [];
        foreach ($bySeq as $seq => $line) {
            $q = fn (string $c) => (float) ($resolver->output($seq, $c) ?? 0.0);
            // "Asuransi" basis rows: H = SUMIF(B-range, own B, H-range) merely repeats the total of a code already counted in its own rows.
            // They are flagged, never a second material need (the RAB uses them as the insurance basis).
            $h = $line['formulas']['H'] ?? null;
            $aggregate = BomAst::isAggregate($h, $seq);
            $out[] = ['sequence' => $seq, 'khs_code' => $resolver->code($seq), 'aggregate' => $aggregate, 'description' => $line['description'],
                'material' => $q('H'), 'install' => $q('I'), 'remove' => $q('J'), 'return' => $q('K')];
        }

        return $out;
    }
}
