<?php

namespace Tests\Unit;

use App\Formula\Evaluator;
use App\Formula\FormulaException;
use App\Formula\Parser;
use App\Formula\Resolver;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

class FormulaEngineTest extends TestCase
{
    private function calc(string $f, array $vars = [], array $cells = []): mixed
    {
        $r = new class($vars, $cells) implements Resolver
        {
            public function __construct(private array $v, private array $c) {}

            public function cell(?string $sheet, string $ref): mixed
            {
                return $this->c[($sheet ? $sheet.'!' : '').$ref] ?? null;
            }

            public function variable(string $name): mixed
            {
                return $this->v[$name] ?? null;
            }
        };

        return (new Evaluator($r))->evaluate(Parser::parse($f));
    }

    #[Test]
    public function arithmetic_precedence_and_percent_follow_excel(): void
    {
        $this->assertSame(7.0, $this->calc('1+2*3'));
        $this->assertSame(9.0, $this->calc('(1+2)*3'));
        $this->assertSame(4.0, $this->calc('-2^2'));          // Excel: unary minus binds tighter than ^
        $this->assertSame(64.0, $this->calc('2^3^2'));         // Excel evaluates ^ left to right: (2^3)^2
        $this->assertSame(0.5, $this->calc('50%'));
        $this->assertSame(true, $this->calc('"A"="a"'));       // text compares case-insensitively
        $this->assertSame('ab1', $this->calc('"a"&"b"&1'));
    }

    #[Test]
    public function rounding_functions_keep_the_workbook_behaviour(): void
    {
        $this->assertSame(3.0, $this->calc('TRUNC(3.99)'));
        $this->assertSame(-3.0, $this->calc('TRUNC(-3.99)'));
        $this->assertSame(1.23, $this->calc('TRUNC(1.239,2)'));
        $this->assertSame(3.0, $this->calc('ROUND(2.5,0)'));
        $this->assertSame(-3.0, $this->calc('ROUND(-2.5,0)'));
        $this->assertSame(4.0, $this->calc('ROUNDUP(3.01,0)'));
        $this->assertSame(3.0, $this->calc('ROUNDUP(3*1.02/1.02,0)'));  // float noise must not add one
        $this->assertSame(6.0, $this->calc('TRUNC(({x}*1.02*3)/1)*1', ['x' => 2.0]));
    }

    #[Test]
    public function empty_cells_equal_zero_and_empty_text(): void
    {
        $this->assertSame(true, $this->calc('B13=""'));
        $this->assertSame(true, $this->calc('B13=0'));
        $this->assertSame(0.0, $this->calc('IF(B13="",0,5)'));
        $this->assertSame(5.0, $this->calc('IF(B13="",0,5)', [], ['B13' => 'x']));
        $this->assertSame(0.0, $this->calc('+B1+C1'));
    }

    #[Test]
    public function sum_sumif_and_logic_functions_work_over_ranges(): void
    {
        $cells = ['A1' => 1.0, 'A2' => 2.0, 'A3' => 'x', 'B1' => 10.0, 'B2' => 20.0, 'B3' => 30.0];
        $this->assertSame(3.0, $this->calc('SUM(A1:A3)', [], $cells));
        $this->assertSame(10.0, $this->calc('SUMIF(A1:A3,1,B1:B3)', [], $cells));
        $this->assertSame(30.0, $this->calc('SUMIF(A1:A3,"x",B1:B3)', [], $cells));
        $this->assertSame(true, $this->calc('OR(A1=2,A2=2)', [], $cells));
        $this->assertSame(false, $this->calc('AND(A1=1,A2=1)', [], $cells));
        $this->assertSame(1.0, $this->calc('IF(1>2,1/0,1)'));   // IF is lazy: the untaken branch is never evaluated
    }

    #[Test]
    public function the_parser_is_a_closed_grammar_that_rejects_code_and_unknown_functions(): void
    {
        foreach (['SYSTEM("ls")', 'EVAL(1)', 'INDIRECT("A1")', '1+', '(1', '1 2', '"a', '', '$$', 'PHP_EOL', '1;2', str_repeat('(', 50).'1'.str_repeat(')', 50)] as $bad) {
            try {
                $this->calc($bad);
                $this->fail("accepted: {$bad}");
            } catch (FormulaException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->expectException(FormulaException::class);
        $this->calc('1/0');
    }

    #[Test]
    public function an_ast_is_plain_json_data_and_survives_a_round_trip(): void
    {
        $ast = Parser::parse('IF({PSG:SUTM-01}>0,TRUNC({PSG:SUTM-01}*1.02),0)');
        $copy = json_decode(json_encode($ast), true);
        $this->assertEquals($ast, $copy);
        $r = new class implements Resolver
        {
            public function cell(?string $sheet, string $ref): mixed
            {
                return null;
            }

            public function variable(string $name): mixed
            {
                return $name === 'PSG:SUTM-01' ? 10.0 : null;
            }
        };
        $this->assertSame(10.0, (new Evaluator($r))->evaluate($copy));
    }
}
