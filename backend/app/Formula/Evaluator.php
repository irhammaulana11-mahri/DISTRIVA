<?php

namespace App\Formula;

/**
 * Deterministic evaluator for {@see Parser} ASTs (no eval, no dynamic dispatch beyond a fixed function list).
 * Semantics follow the workbook (owner decision K-3): arithmetic on doubles, TRUNC toward zero, ROUND half away from
 * zero, ROUNDUP away from zero (1e-12 tolerance absorbs binary noise, e.g. 3*1.02/1.02), empty cell = 0 = "",
 * ordering numbers < text < booleans with case-insensitive text.
 */
final class Evaluator
{
    public function __construct(private readonly Resolver $resolver) {}

    /** @param array<string,mixed> $ast */
    public function evaluate(array $ast): mixed
    {
        return $this->ev($ast);
    }

    /** @param array<string,mixed> $n */
    private function ev(array $n): mixed
    {
        switch ($n['t'] ?? null) {
            case 'num':
                return (float) $n['v'];      // JSON turns 0.0 into 0: normalise
            case 'str':
                return (string) $n['v'];
            case 'cell':
                return $this->resolver->cell($n['sheet'], $n['ref']);
            case 'var':
                return $this->resolver->variable($n['name']);
            case 'range':
                return $this->range($n);
            case 'list':   // DISTRIVA: a column of named variables (a GAMBAR quantity range), shaped like a range
                return array_map(fn ($name) => [$this->resolver->variable((string) $name)], $n['names']);
            case 'neg':
                return -$this->num($this->ev($n['a']));
            case 'pct':
                return $this->num($this->ev($n['a'])) / 100;
            case 'bin':
                return $this->bin($n['op'], $this->ev($n['a']), $this->ev($n['b']));
            case 'call':
                return $this->call($n['fn'], $n['args']);
        }
        throw new FormulaException('Node rumus tidak dikenal.');
    }

    /** @param array<string,mixed> $n @return list<list<mixed>> */
    private function range(array $n): array
    {
        [$c1, $r1] = $this->split($n['from']);
        [$c2, $r2] = $this->split($n['to']);
        $rows = [];
        for ($r = min($r1, $r2); $r <= max($r1, $r2); $r++) {
            $row = [];
            for ($c = min($c1, $c2); $c <= max($c1, $c2); $c++) {
                $row[] = $this->resolver->cell($n['sheet'], $this->colName($c).$r);
            }
            $rows[] = $row;
        }
        if (count($rows) * count($rows[0]) > 5000) {
            throw new FormulaException('Rentang terlalu besar.');
        }

        return $rows;
    }

    /** @return array{0:int,1:int} */
    private function split(string $ref): array
    {
        if (! preg_match('/^([A-Z]{1,3})(\d+)$/', $ref, $m)) {
            throw new FormulaException("Referensi tidak valid: {$ref}");
        }
        $n = 0;
        foreach (str_split($m[1]) as $ch) {
            $n = $n * 26 + ord($ch) - 64;
        }

        return [$n, (int) $m[2]];
    }

    private function colName(int $n): string
    {
        $s = '';
        while ($n > 0) {
            $r = ($n - 1) % 26;
            $s = chr(65 + $r).$s;
            $n = intdiv($n - 1, 26);
        }

        return $s;
    }

    private function num(mixed $v): float
    {
        if ($v === null || $v === '') {
            return 0.0;
        }
        if (is_bool($v)) {
            return $v ? 1.0 : 0.0;
        }
        if (is_int($v) || is_float($v)) {
            return (float) $v;
        }
        if (is_string($v) && is_numeric(trim($v))) {
            return (float) $v;
        }
        throw new FormulaException('Operand bukan angka.');
    }

    private function bin(string $op, mixed $a, mixed $b): mixed
    {
        switch ($op) {
            case '+': return $this->num($a) + $this->num($b);
            case '-': return $this->num($a) - $this->num($b);
            case '*': return $this->num($a) * $this->num($b);
            case '/':
                $d = $this->num($b);
                if ($d == 0.0) {
                    throw new FormulaException('Pembagian dengan nol.');
                }

                return $this->num($a) / $d;
            case '^': return $this->num($a) ** $this->num($b);
            case '&': return $this->text($a).$this->text($b);
        }

        return $this->compare($op, $a, $b);
    }

    private function text(mixed $v): string
    {
        if ($v === null) {
            return '';
        }
        if (is_bool($v)) {
            return $v ? 'TRUE' : 'FALSE';
        }
        if (is_float($v) && floor($v) === $v && abs($v) < 1e15) {
            return (string) (int) $v;
        }

        return (string) $v;
    }

    private function compare(string $op, mixed $a, mixed $b): bool
    {
        // An empty cell takes the type of the other operand: 0 against a number, "" against text, FALSE against a boolean.
        if ($a === null) {
            $a = is_string($b) ? '' : (is_bool($b) ? false : 0.0);
        }
        if ($b === null) {
            $b = is_string($a) ? '' : (is_bool($a) ? false : 0.0);
        }
        $rank = static fn ($x): int => is_bool($x) ? 2 : (is_string($x) ? 1 : 0);
        $ra = $rank($a);
        $rb = $rank($b);
        $ka = $ra === 1 ? mb_strtolower((string) $a) : (is_bool($a) ? (int) $a : (float) $a);
        $kb = $rb === 1 ? mb_strtolower((string) $b) : (is_bool($b) ? (int) $b : (float) $b);
        $cmp = $ra !== $rb ? $ra <=> $rb : $ka <=> $kb;

        return match ($op) {
            '=' => $cmp === 0, '<>' => $cmp !== 0, '<' => $cmp < 0, '>' => $cmp > 0, '<=' => $cmp <= 0, '>=' => $cmp >= 0,
            default => throw new FormulaException("Operator tidak dikenal: {$op}"),
        };
    }

    private function truthy(mixed $v): bool
    {
        if ($v === null) {
            return false;
        }
        if (is_string($v)) {
            return $v !== '';
        }

        return (bool) $v;
    }

    /** @return \Generator<mixed> */
    private function flat(mixed $v): \Generator
    {
        if (is_array($v)) {
            foreach ($v as $x) {
                yield from $this->flat($x);
            }
        } else {
            yield $v;
        }
    }

    /** @param list<array<string,mixed>> $args */
    private function call(string $fn, array $args): mixed
    {
        if (! in_array($fn, Parser::FUNCTIONS, true)) {
            throw new FormulaException("Fungsi tidak diizinkan: {$fn}");
        }
        if ($fn === 'IF') {
            if (count($args) < 2 || count($args) > 3) {
                throw new FormulaException('IF memerlukan 2 atau 3 argumen.');
            }

            return $this->truthy($this->ev($args[0])) ? $this->ev($args[1]) : (isset($args[2]) ? $this->ev($args[2]) : false);
        }
        $a = array_map(fn ($x) => $this->ev($x), $args);
        switch ($fn) {
            case 'OR':
                foreach ($a as $v) {
                    foreach ($this->flat($v) as $x) {
                        if ($this->truthy($x)) {
                            return true;
                        }
                    }
                }

                return false;
            case 'AND':
                foreach ($a as $v) {
                    foreach ($this->flat($v) as $x) {
                        if (! $this->truthy($x)) {
                            return false;
                        }
                    }
                }

                return true;
            case 'SUM':
                $t = 0.0;
                foreach ($a as $v) {
                    foreach ($this->flat($v) as $x) {
                        if ((is_int($x) || is_float($x))) {
                            $t += $x;
                        }
                    }
                }

                return $t;
            case 'ABS':
                $this->arity($fn, $a, 1, 1);

                return abs($this->num($a[0]));
            case 'TRUNC':
                $this->arity($fn, $a, 1, 2);
                $p = 10 ** (int) $this->num($a[1] ?? 0);

                return $this->trunc($this->num($a[0]) * $p) / $p;
            case 'ROUND':
                $this->arity($fn, $a, 2, 2);
                $p = 10 ** (int) $this->num($a[1]);
                $x = $this->num($a[0]) * $p;

                return ($x >= 0 ? 1 : -1) * floor(abs($x) + 0.5) / $p;
            case 'ROUNDUP':
                $this->arity($fn, $a, 2, 2);
                $p = 10 ** (int) $this->num($a[1]);
                $x = $this->num($a[0]) * $p;

                return ($x >= 0 ? 1 : -1) * ceil(abs($x) - 1e-12) / $p;
            case 'SUMIF':
                $this->arity($fn, $a, 2, 3);

                return $this->sumif($a);
        }
        throw new FormulaException("Fungsi tidak diizinkan: {$fn}");
    }

    /** @param list<mixed> $a */
    private function arity(string $fn, array $a, int $min, int $max): void
    {
        if (count($a) < $min || count($a) > $max) {
            throw new FormulaException("Jumlah argumen {$fn} tidak sesuai.");
        }
    }

    private function trunc(float $x): float
    {
        return $x < 0 ? ceil($x) : floor($x);
    }

    /** @param list<mixed> $a */
    private function sumif(array $a): float
    {
        $crit = iterator_to_array($this->flat($a[0]), false);
        $sum = isset($a[2]) ? iterator_to_array($this->flat($a[2]), false) : $crit;
        $c = $a[1];
        $t = 0.0;
        foreach ($crit as $i => $cv) {
            $ok = is_int($c) || is_float($c)
                ? ((is_int($cv) || is_float($cv)) && (float) $cv === (float) $c)
                : trim((string) ($cv ?? '')) === trim((string) ($c ?? ''));
            $sv = $sum[$i] ?? null;
            if ($ok && (is_int($sv) || is_float($sv))) {
                $t += $sv;
            }
        }

        return $t;
    }
}
