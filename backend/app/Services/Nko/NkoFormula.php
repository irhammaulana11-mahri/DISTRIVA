<?php

namespace App\Services\Nko;

use Closure;
use InvalidArgumentException;

/**
 * Rumus realisasi NKO (docs/93): angka, nama besaran, + - * /, kurung, dan fungsi `abs`, `min`, `max`, `atau(x, pengganti)`. Tidak memakai `eval`.
 * Besaran yang datanya belum ada bernilai null dan menular ke hasil (indikator dibiarkan kosong, tidak dianggap 0), kecuali diberi pengganti dengan `atau`.
 * Pembagian dengan nol juga menghasilkan null.
 */
final class NkoFormula
{
    /** nama fungsi => [argumen minimal, argumen maksimal] */
    public const FUNCTIONS = ['abs' => [1, 1], 'min' => [2, 20], 'max' => [2, 20], 'atau' => [2, 2]];

    private const MAX_LENGTH = 500;

    /** @var list<string> */
    private array $tokens = [];

    private int $position = 0;

    /** @var array<string, true> */
    private array $variables = [];

    /** @var array<int, mixed> */
    private array $tree;

    private function __construct(string $source)
    {
        if (strlen($source) > self::MAX_LENGTH) {
            throw new InvalidArgumentException('Rumus terlalu panjang (maksimal '.self::MAX_LENGTH.' karakter).');
        }
        preg_match_all('/\s*(\d+(?:\.\d+)?|[a-z][a-z0-9_]*|[-+*\/(),])/A', $source, $matches);
        if (strlen(implode('', $matches[0])) !== strlen(rtrim($source))) {
            throw new InvalidArgumentException("Rumus memuat karakter yang tidak dikenal: {$source}");
        }
        $this->tokens = $matches[1];
        $this->tree = $this->expression();
        if ($this->position !== count($this->tokens)) {
            throw new InvalidArgumentException("Rumus tidak lengkap atau salah susun: {$source}");
        }
    }

    public static function parse(string $source): self
    {
        return new self($source);
    }

    /** @return list<string> nama besaran dan masukan yang dipakai rumus */
    public function variables(): array
    {
        return array_keys($this->variables);
    }

    /** @param  Closure(string): ?float  $value  nilai satu besaran */
    public function evaluate(Closure $value): ?float
    {
        return $this->run($this->tree, $value);
    }

    private function run(array $node, Closure $value): ?float
    {
        [$type, $a] = $node;
        if ($type === 'number') {
            return $a;
        }
        if ($type === 'variable') {
            return $value($a);
        }
        if ($type === 'negate') {
            $x = $this->run($a, $value);

            return $x === null ? null : -$x;
        }
        if ($type === 'call' && $a === 'atau') {
            return $this->run($node[2][0], $value) ?? $this->run($node[2][1], $value);
        }
        $args = array_map(fn (array $n) => $this->run($n, $value), $type === 'call' ? $node[2] : [$node[2], $node[3]]);
        if (in_array(null, $args, true)) {
            return null;
        }
        if ($type === 'call') {
            return match ($a) {
                'abs' => abs($args[0]),
                'min' => min($args),
                'max' => max($args),
            };
        }

        return match ($a) {
            '+' => $args[0] + $args[1],
            '-' => $args[0] - $args[1],
            '*' => $args[0] * $args[1],
            '/' => $args[1] == 0.0 ? null : $args[0] / $args[1],
        };
    }

    private function expression(): array
    {
        $node = $this->term();
        while (in_array($this->peek(), ['+', '-'], true)) {
            $operator = $this->next();
            $node = ['binary', $operator, $node, $this->term()];
        }

        return $node;
    }

    private function term(): array
    {
        $node = $this->factor();
        while (in_array($this->peek(), ['*', '/'], true)) {
            $operator = $this->next();
            $node = ['binary', $operator, $node, $this->factor()];
        }

        return $node;
    }

    private function factor(): array
    {
        $token = $this->next();
        if ($token === '-') {
            return ['negate', $this->factor()];
        }
        if ($token === '(') {
            $node = $this->expression();
            $this->expect(')');

            return $node;
        }
        if (is_numeric($token)) {
            return ['number', (float) $token];
        }
        if (! preg_match('/^[a-z]/', $token)) {
            throw new InvalidArgumentException("Rumus salah susun di dekat \"{$token}\".");
        }
        if ($this->peek() !== '(') {
            $this->variables[$token] = true;

            return ['variable', $token];
        }
        if (! isset(self::FUNCTIONS[$token])) {
            throw new InvalidArgumentException("Fungsi tidak dikenal: {$token}");
        }
        $this->next();
        $args = [$this->expression()];
        while ($this->peek() === ',') {
            $this->next();
            $args[] = $this->expression();
        }
        $this->expect(')');
        [$min, $max] = self::FUNCTIONS[$token];
        if (count($args) < $min || count($args) > $max) {
            throw new InvalidArgumentException("Jumlah argumen fungsi {$token} salah.");
        }

        return ['call', $token, $args];
    }

    private function peek(): ?string
    {
        return $this->tokens[$this->position] ?? null;
    }

    private function next(): string
    {
        return $this->tokens[$this->position++] ?? throw new InvalidArgumentException('Rumus terpotong.');
    }

    private function expect(string $token): void
    {
        if ($this->next() !== $token) {
            throw new InvalidArgumentException("Rumus kurang tanda \"{$token}\".");
        }
    }
}
