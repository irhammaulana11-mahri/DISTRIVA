<?php

namespace App\Formula;

/**
 * Parses the controlled Excel subset used by the BOM workbook into a JSON-serialisable AST. Nothing is ever executed
 * as code: the output is data, evaluated by {@see Evaluator}.
 *
 * Node shapes: {t:num,v} {t:str,v} {t:cell,sheet,ref} {t:range,sheet,from,to} {t:var,name}
 *              {t:neg,a} {t:pct,a} {t:bin,op,a,b} {t:call,fn,args[]}
 * Grammar (low -> high): comparison, concatenation (&), + -, * /, ^, unary + -, atom [%].
 * `var` nodes are written `{name}` in the text form and are the way DISTRIVA formulas address inputs.
 */
final class Parser
{
    public const MAX_LENGTH = 2000;

    public const MAX_DEPTH = 40;

    public const FUNCTIONS = ['IF', 'OR', 'AND', 'SUM', 'TRUNC', 'ROUND', 'ROUNDUP', 'SUMIF'];

    private const TOKEN = '/\G\s*(?:(?<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<str>"(?:[^"]|"")*")|(?<var>\{[A-Za-z0-9_.:\-]+\})|(?<ref>(?:(?:\'[^\']+\'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(?<fn>[A-Z][A-Z0-9.]*)\(|(?<op><=|>=|<>|[-+*\/^(),=<>&%]))/';

    /** @var list<array{0:string,1:string}> */
    private array $tokens = [];

    private int $pos = 0;

    private int $depth = 0;

    /** @return array<string,mixed> */
    public static function parse(string $formula): array
    {
        return (new self)->run($formula);
    }

    /** @return array<string,mixed> */
    private function run(string $formula): array
    {
        $text = ltrim(trim($formula), '=');
        if (strlen($text) > self::MAX_LENGTH) {
            throw new FormulaException('Rumus terlalu panjang.');
        }
        $this->tokens = $this->tokenize($text);
        $this->pos = 0;
        $this->depth = 0;
        if ($this->tokens === []) {
            throw new FormulaException('Rumus kosong.');
        }
        $ast = $this->expr();
        if ($this->pos !== count($this->tokens)) {
            throw new FormulaException('Token berlebih pada rumus.');
        }

        return $ast;
    }

    /** @return list<array{0:string,1:string}> */
    private function tokenize(string $s): array
    {
        $out = [];
        $pos = 0;
        $len = strlen($s);
        while ($pos < $len) {
            if (! preg_match(self::TOKEN, $s, $m, PREG_UNMATCHED_AS_NULL, $pos) || strlen($m[0]) === 0) {
                if (trim(substr($s, $pos)) === '') {
                    break;
                }
                throw new FormulaException('Token tidak dikenal: '.substr($s, $pos, 12));
            }
            $pos += strlen($m[0]);
            foreach (['num', 'str', 'var', 'ref', 'fn', 'op'] as $k) {
                if (($m[$k] ?? null) !== null) {
                    $out[] = [$k, $m[$k]];
                    break;
                }
            }
        }

        return $out;
    }

    private function peek(): ?string
    {
        return $this->tokens[$this->pos][1] ?? null;
    }

    /** @return array{0:string,1:string} */
    private function take(): array
    {
        if (! isset($this->tokens[$this->pos])) {
            throw new FormulaException('Rumus berakhir tak terduga.');
        }

        return $this->tokens[$this->pos++];
    }

    /** @return array<string,mixed> */
    private function expr(): array
    {
        if (++$this->depth > self::MAX_DEPTH) {
            throw new FormulaException('Rumus terlalu dalam.');
        }
        $a = $this->concat();
        while (in_array($this->peek(), ['=', '<>', '<', '>', '<=', '>='], true)) {
            $op = $this->take()[1];
            $a = ['t' => 'bin', 'op' => $op, 'a' => $a, 'b' => $this->concat()];
        }
        $this->depth--;

        return $a;
    }

    /** @return array<string,mixed> */
    private function concat(): array
    {
        $a = $this->add();
        while ($this->peek() === '&') {
            $this->take();
            $a = ['t' => 'bin', 'op' => '&', 'a' => $a, 'b' => $this->add()];
        }

        return $a;
    }

    /** @return array<string,mixed> */
    private function add(): array
    {
        $a = $this->mul();
        while (in_array($this->peek(), ['+', '-'], true)) {
            $op = $this->take()[1];
            $a = ['t' => 'bin', 'op' => $op, 'a' => $a, 'b' => $this->mul()];
        }

        return $a;
    }

    /** @return array<string,mixed> */
    private function mul(): array
    {
        $a = $this->pow();
        while (in_array($this->peek(), ['*', '/'], true)) {
            $op = $this->take()[1];
            $a = ['t' => 'bin', 'op' => $op, 'a' => $a, 'b' => $this->pow()];
        }

        return $a;
    }

    /** @return array<string,mixed> */
    private function pow(): array
    {
        $a = $this->unary();
        while ($this->peek() === '^') {
            $this->take();
            $a = ['t' => 'bin', 'op' => '^', 'a' => $a, 'b' => $this->unary()];
        }

        return $a;
    }

    /** @return array<string,mixed> */
    private function unary(): array
    {
        if (in_array($this->peek(), ['+', '-'], true)) {
            $op = $this->take()[1];
            $v = $this->unary();

            return $op === '-' ? ['t' => 'neg', 'a' => $v] : $v;
        }

        return $this->atom();
    }

    /** @return array<string,mixed> */
    private function atom(): array
    {
        [$kind, $val] = $this->take();
        if ($kind === 'num') {
            $node = ['t' => 'num', 'v' => (float) $val];
        } elseif ($kind === 'str') {
            $node = ['t' => 'str', 'v' => str_replace('""', '"', substr($val, 1, -1))];
        } elseif ($kind === 'var') {
            $node = ['t' => 'var', 'name' => substr($val, 1, -1)];
        } elseif ($kind === 'ref') {
            $node = $this->ref($val);
        } elseif ($kind === 'fn') {
            if (! in_array($val, self::FUNCTIONS, true)) {
                throw new FormulaException("Fungsi tidak diizinkan: {$val}");
            }
            $args = [];
            if ($this->peek() !== ')') {
                $args[] = $this->expr();
                while ($this->peek() === ',') {
                    $this->take();
                    $args[] = $this->expr();
                }
            }
            if (($this->take()[1] ?? null) !== ')') {
                throw new FormulaException('Tanda ) hilang.');
            }
            $node = ['t' => 'call', 'fn' => $val, 'args' => $args];
        } elseif ($val === '(') {
            $node = $this->expr();
            if (($this->take()[1] ?? null) !== ')') {
                throw new FormulaException('Tanda ) hilang.');
            }
        } else {
            throw new FormulaException("Token tak terduga: {$val}");
        }
        if ($this->peek() === '%') {
            $this->take();
            $node = ['t' => 'pct', 'a' => $node];
        }

        return $node;
    }

    /** @return array<string,mixed> */
    private function ref(string $text): array
    {
        $sheet = null;
        if (str_contains($text, '!')) {
            [$sheet, $text] = explode('!', $text, 2);
            $sheet = trim($sheet, "'");
        }
        $text = str_replace('$', '', $text);
        if (str_contains($text, ':')) {
            [$from, $to] = explode(':', $text, 2);

            return ['t' => 'range', 'sheet' => $sheet, 'from' => $from, 'to' => $to];
        }

        return ['t' => 'cell', 'sheet' => $sheet, 'ref' => $text];
    }
}
