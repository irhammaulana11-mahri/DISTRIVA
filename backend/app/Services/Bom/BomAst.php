<?php

namespace App\Services\Bom;

/** Walks / rewrites formula ASTs for the BOM: translates workbook references into DISTRIVA references and lists dependencies. */
final class BomAst
{
    public const OWN_COLUMNS = ['B', 'H', 'I', 'J', 'K'];

    /**
     * Rewrites GAMBAR quantity cells to {PSG:code}/{BKR:code} variables and checks every other reference.
     *
     * @param  array<string,mixed>  $n
     * @param  array<string,string>  $cellMap  GAMBAR cell => variable name
     * @param  list<string>  $problems
     * @return array<string,mixed>
     */
    public static function translate(array $n, array $cellMap, array &$problems): array
    {
        switch ($n['t']) {
            case 'cell':
                if ($n['sheet'] === null) {
                    $col = preg_replace('/\d+/', '', $n['ref']);
                    if (! in_array($col, self::OWN_COLUMNS, true)) {
                        $problems[] = "Referensi {$n['ref']} ke kolom {$col} tidak didukung (hanya B, H, I, J, K).";
                    }

                    return $n;
                }
                if (strtoupper($n['sheet']) === 'GAMBAR') {
                    if (isset($cellMap[$n['ref']]) && str_starts_with($cellMap[$n['ref']], 'CONST:')) {   // fixed list value (e.g. a power-range label)
                        return ['t' => 'str', 'v' => substr($cellMap[$n['ref']], 6)];
                    }
                    if (isset($cellMap[$n['ref']])) {
                        return ['t' => 'var', 'name' => $cellMap[$n['ref']]];
                    }
                    $problems[] = "Sel GAMBAR!{$n['ref']} bukan jumlah pasang/bongkar jenis konstruksi yang dikenal.";

                    return $n;
                }
                $problems[] = "Referensi ke sheet {$n['sheet']} tidak didukung.";

                return $n;
            case 'range':
                $c1 = preg_replace('/\d+/', '', $n['from']);
                $c2 = preg_replace('/\d+/', '', $n['to']);
                if ($n['sheet'] !== null && strtoupper($n['sheet']) === 'GAMBAR') {
                    return self::gambarRange($n, $c1, $c2, $cellMap, $problems);
                }
                if ($n['sheet'] !== null) {
                    $problems[] = 'Rentang pada sheet lain tidak didukung.';
                } elseif ($c1 !== $c2 || ! in_array($c1, self::OWN_COLUMNS, true)) {
                    $problems[] = "Rentang {$n['from']}:{$n['to']} harus berada dalam satu kolom B atau H–K.";
                } elseif (abs((int) preg_replace('/\D/', '', $n['to']) - (int) preg_replace('/\D/', '', $n['from'])) > 1000) {
                    $problems[] = 'Rentang terlalu besar.';
                }

                return $n;
            case 'bin':
                return ['t' => 'bin', 'op' => $n['op'], 'a' => self::translate($n['a'], $cellMap, $problems), 'b' => self::translate($n['b'], $cellMap, $problems)];
            case 'neg':
            case 'pct':
                return ['t' => $n['t'], 'a' => self::translate($n['a'], $cellMap, $problems)];
            case 'call':
                $args = [];
                foreach ($n['args'] as $a) {            // by-reference $problems must be passed directly (an arrow fn would copy it)
                    $args[] = self::translate($a, $cellMap, $problems);
                }

                return ['t' => 'call', 'fn' => $n['fn'], 'args' => $args];
            case 'var':
                $problems[] = 'Variabel bebas tidak diizinkan pada berkas impor.';

                return $n;
        }

        return $n;
    }

    /**
     * A GAMBAR column range of construction quantities (e.g. SUM(GAMBAR!U6:U9)) becomes a `list` of variables; every cell
     * in it must be a known quantity cell, otherwise the line is reported.
     *
     * @param  array<string,mixed>  $n
     * @param  array<string,string>  $cellMap
     * @param  list<string>  $problems
     * @return array<string,mixed>
     */
    private static function gambarRange(array $n, string $c1, string $c2, array $cellMap, array &$problems): array
    {
        $a = (int) preg_replace('/\D/', '', $n['from']);
        $b = (int) preg_replace('/\D/', '', $n['to']);
        if ($c1 !== $c2 || abs($b - $a) > 200) {
            $problems[] = "Rentang GAMBAR!{$n['from']}:{$n['to']} harus berada dalam satu kolom dan tidak terlalu besar.";

            return $n;
        }
        $names = [];
        for ($r = min($a, $b); $r <= max($a, $b); $r++) {
            if (! isset($cellMap[$c1.$r])) {
                $problems[] = "Rentang GAMBAR!{$n['from']}:{$n['to']} memuat sel {$c1}{$r} yang bukan jumlah jenis konstruksi yang dikenal.";

                return $n;
            }
            $names[] = $cellMap[$c1.$r];
        }

        return ['t' => 'list', 'names' => $names];
    }

    /** @param array<string,mixed> $n @return list<string> variable names used */
    public static function variables(array $n): array
    {
        $out = [];
        self::walk($n, function (array $x) use (&$out): void {
            if ($x['t'] === 'var') {
                $out[] = $x['name'];
            }
        });

        return array_values(array_unique($out));
    }

    /**
     * Own-sheet dependencies as "COL:row" pairs (H–K only; ranges are expanded).
     *
     * @param  array<string,mixed>  $n
     * @return list<string>
     */
    public static function dependencies(array $n): array
    {
        $out = [];
        self::walk($n, function (array $x) use (&$out): void {
            if ($x['t'] === 'cell' && $x['sheet'] === null) {
                $c = preg_replace('/\d+/', '', $x['ref']);
                if (in_array($c, ['H', 'I', 'J', 'K'], true)) {
                    $out[] = $c.':'.preg_replace('/\D/', '', $x['ref']);
                }
            } elseif ($x['t'] === 'range' && $x['sheet'] === null) {
                $c = preg_replace('/\d+/', '', $x['from']);
                $a = (int) preg_replace('/\D/', '', $x['from']);
                $b = (int) preg_replace('/\D/', '', $x['to']);
                for ($r = min($a, $b); $r <= max($a, $b); $r++) {
                    $out[] = $c.':'.$r;
                }
            }
        });

        return array_values(array_unique($out));
    }

    /**
     * KHS codes a column-B formula can return: numeric literals in the value position of IF(cond, code, ...).
     *
     * @param  array<string,mixed>  $n
     * @return list<string>
     */
    public static function codes(array $n): array
    {
        $out = [];
        self::walk($n, function (array $x) use (&$out): void {
            if ($x['t'] === 'call' && $x['fn'] === 'IF' && isset($x['args'][1]) && $x['args'][1]['t'] === 'num') {
                $out[] = (string) (int) $x['args'][1]['v'];
            }
        });

        return array_values(array_unique($out));
    }

    /** An "insurance basis" row: H = SUMIF(B-range, own B, H-range), merely repeating the total of a code counted in its own rows. */
    public static function isAggregate(mixed $h, int $sequence): bool
    {
        return is_array($h) && ($h['t'] ?? null) === 'call' && ($h['fn'] ?? null) === 'SUMIF' && ($h['args'][1]['t'] ?? null) === 'cell'
            && ($h['args'][1]['sheet'] ?? null) === null && ($h['args'][1]['ref'] ?? null) === 'B'.$sequence;
    }

    /** @param array<string,mixed> $n */
    private static function walk(array $n, callable $fn): void
    {
        $fn($n);
        foreach ($n['names'] ?? [] as $name) {
            $fn(['t' => 'var', 'name' => $name]);
        }
        foreach (['a', 'b'] as $k) {
            if (isset($n[$k]) && is_array($n[$k])) {
                self::walk($n[$k], $fn);
            }
        }
        foreach ($n['args'] ?? [] as $a) {
            self::walk($a, $fn);
        }
    }
}
