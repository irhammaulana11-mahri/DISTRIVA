<?php

namespace Tests\Unit;

use App\Formula\Evaluator;
use App\Formula\Parser;
use App\Formula\Resolver;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Golden test (docs/16: "rumus Excel direkonstruksi dan diuji terhadap contoh tervalidasi").
 * Fixture: tools/golden_vectors.py from MASTER RAB & KKF.xlsx — every volume formula (H-K) of the nine BOM sheets with the
 * result stored by Excel, plus the cells they read. The production engine must reproduce all stored results.
 */
class FormulaGoldenWorkbookTest extends TestCase
{
    /** @var array<string,mixed> */
    private static array $data;

    public static function setUpBeforeClass(): void
    {
        $raw = file_get_contents('compress.zlib://'.__DIR__.'/../fixtures/golden_bom.json.gz');
        self::$data = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
    }

    private function resolver(): Resolver
    {
        return new class(self::$data['sheets']) implements Resolver
        {
            private array $memo = [];

            private array $busy = [];

            public ?string $own = null;

            public function __construct(private readonly array $sheets) {}

            public function cell(?string $sheet, string $ref): mixed
            {
                $sheet ??= $this->own;
                $key = $sheet.'!'.$ref;
                if (array_key_exists($key, $this->memo)) {
                    return $this->memo[$key];
                }
                $c = $this->sheets[$sheet][$ref] ?? null;
                if ($c === null) {
                    return $this->memo[$key] = null;                // missing cell = empty
                }
                [$value, $formula] = $c;
                $col = preg_replace('/\d+/', '', $ref);
                if ($formula !== null && in_array($col, ['H', 'I', 'J', 'K'], true) && $sheet === $this->own) {
                    if (isset($this->busy[$key])) {
                        throw new \RuntimeException("cycle at {$key}");
                    }
                    $this->busy[$key] = true;
                    $v = (new Evaluator($this))->evaluate(Parser::parse($formula));
                    unset($this->busy[$key]);
                } else {
                    $v = self::coerce($value);
                }

                return $this->memo[$key] = $v;
            }

            public function variable(string $name): mixed
            {
                return null;
            }

            public static function coerce(?string $v): mixed
            {
                if ($v === null || $v === '') {
                    return null;
                }

                return is_numeric($v) ? (float) $v : $v;
            }
        };
    }

    #[Test]
    public function every_workbook_volume_formula_is_reproduced_by_the_production_engine(): void
    {
        $this->assertGreaterThan(6000, count(self::$data['formulas']));

        $perSheet = [];
        $mismatch = [];
        foreach (self::$data['formulas'] as [$sheet, $cell]) {
            $r = $this->resolver();   // fresh memo per sheet is enough, but a fresh resolver per formula keeps the test honest
            $r->own = $sheet;
            $got = $r->cell($sheet, $cell);
            $exp = $r::coerce(self::$data['sheets'][$sheet][$cell][0] ?? null) ?? 0.0;
            $got = $got ?? 0.0;
            $same = is_numeric($got) && is_numeric($exp) ? abs((float) $got - (float) $exp) < 1e-9 : $got === $exp;
            $perSheet[$sheet] = ($perSheet[$sheet] ?? 0) + 1;
            if (! $same) {
                $mismatch[] = "{$sheet}!{$cell}: got ".json_encode($got).' expected '.json_encode($exp);
            }
        }

        $this->assertSame([], $mismatch, count($mismatch).' of '.count(self::$data['formulas'])." formulas differ:\n".implode("\n", array_slice($mismatch, 0, 20)));
        $this->assertCount(9, $perSheet);
    }
}
