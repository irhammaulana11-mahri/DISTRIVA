<?php

namespace Tests\Unit;

use App\Services\Kkf\KkfCalculator;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

class KkfCalculatorTest extends TestCase
{
    /** The example stored in the workbook (ISIAN KKF: PD 16.5 -> 33 kVA, ULP Jombang). The workbook feeds the power AFTER the change (33 kVA); production feeds the delta. */
    private function example(array $override = []): array
    {
        return $override + ['investment' => 54435400, 'connection_fee' => 15955226, 'power_kva' => 33, 'jam_nyala' => 117, 'avg_price' => 1444.7, 'bpp' => 540.98,
            'discount_rate' => 0.0787, 'roe' => 0.0047, 'interest' => 0.0778, 'tax' => 0.25, 'horizon' => 25, 'start_year' => 2026];
    }

    #[Test]
    public function it_reproduces_the_values_the_workbook_stores_for_its_example(): void
    {
        $r = (new KkfCalculator)->calculate($this->example());

        $this->assertCount(26, $r['years']);                                                        // year 0 + 25
        $y1 = $r['years'][1];
        $this->assertEqualsWithDelta(46.332, $y1['energy_sold_mwh'], 1e-9);                         // KAJIAN!I16
        $this->assertEqualsWithDelta(25.06468536e6, $y1['cost_energy'], 1e-3);                      // Z16
        $this->assertEqualsWithDelta(1.088708e6, $y1['cost_om'], 1e-3);                             // AA16: 2 % of the investment
        $this->assertEqualsWithDelta(66.9358404e6, $y1['revenue_total'], 1e-3);                     // AH16
        $this->assertEqualsWithDelta(-38.480174e6, $r['years'][0]['net'], 1e-3);                    // AI15
        $this->assertEqualsWithDelta(105.983009479932, $r['irr_percent'], 1e-6);                    // AH44
        $this->assertEqualsWithDelta(2.19301274767721, $r['bc_ratio'], 1e-9);                       // AH46
        $this->assertSame(['years' => 0, 'months' => 11, 'text' => '0 Tahun 11 Bulan'], $r['payback']);   // AH47
        $this->assertEqualsWithDelta(4.26249777736546, $r['rwacc_percent'], 1e-9);                  // AH43
        $this->assertEqualsWithDelta(0.293103862560025, $r['bp_ratio'], 1e-12);                     // KKF!E53
        $this->assertTrue($r['feasible']);                                                          // AH48 = LAYAK
        // The workbook's NPV() discounts year 0 as well (AH45 = 372.431 million); the owner's rule leaves year 0 undiscounted: exactly (1 + r) times larger.
        $this->assertEqualsWithDelta(372.431150906858e6 * 1.0787, $r['npv'], 1.0);
    }

    #[Test]
    public function it_is_deterministic_and_the_horizon_is_configurable(): void
    {
        $a = (new KkfCalculator)->calculate($this->example());
        $b = (new KkfCalculator)->calculate($this->example());
        $this->assertSame($a, $b);
        $short = (new KkfCalculator)->calculate($this->example(['horizon' => 10]));
        $this->assertCount(11, $short['years']);
        $this->assertSame(2036, $short['years'][10]['year']);
    }

    #[Test]
    public function a_project_that_does_not_pay_back_in_five_years_is_not_feasible_even_with_a_positive_npv(): void
    {
        $r = (new KkfCalculator)->calculate($this->example(['investment' => 300000000, 'connection_fee' => 1000000]));
        $this->assertGreaterThan(5, $r['payback']['years'] + $r['payback']['months'] / 12);
        $this->assertFalse($r['criteria']['payback_within_5_years']);
        $this->assertFalse($r['feasible']);
        $this->assertTrue($r['criteria']['npv_positive']);                                        // long horizon: positive NPV, still not feasible by the 5-year rule
    }

    #[Test]
    public function a_loss_making_connection_has_no_payback_and_a_negative_npv(): void
    {
        $r = (new KkfCalculator)->calculate($this->example(['bpp' => 1500, 'avg_price' => 1000]));
        $this->assertNull($r['payback']);
        $this->assertLessThan(0, $r['npv']);
        $this->assertFalse($r['feasible']);
    }

    #[Test]
    public function a_connection_fee_above_the_investment_gives_the_workbooks_100_percent_irr_and_a_one_year_payback(): void
    {
        $r = (new KkfCalculator)->calculate($this->example(['connection_fee' => 60000000]));
        $this->assertSame(100.0, $r['irr_percent']);
        $this->assertSame(['years' => 1, 'months' => 0, 'text' => '1 Tahun 0 Bulan'], $r['payback']);
    }

    #[Test]
    public function invalid_inputs_are_refused_never_defaulted(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new KkfCalculator)->calculate($this->example(['power_kva' => 0]));
    }

    #[Test]
    public function a_missing_input_is_refused(): void
    {
        $in = $this->example();
        unset($in['bpp']);
        $this->expectException(InvalidArgumentException::class);
        (new KkfCalculator)->calculate($in);
    }

    /**
     * Second workbook case: kkfsetuju_PABRIKBITINGMARJONO (PB 16.5 kVA, ULP Ponorogo), sheet KAJIAN, load factor 0.8, BPP 541. The workbook takes IRR/NPV from years 0-15 and B/C from years 0-25;
     * DISTRIVA uses ONE horizon for everything (owner 2026-11-09). So the formulas are pinned twice: horizon 15 reproduces the workbook's IRR and NPV, horizon 25 its B/C, payback, RWACC and verdict.
     */
    #[Test]
    public function it_reproduces_the_marjono_kajian_case_with_one_horizon_for_everything(): void
    {
        $in = ['investment' => 47632759.6233, 'connection_fee' => 15988500, 'power_kva' => 16.5, 'jam_nyala' => 128, 'avg_price' => 1444.7, 'bpp' => 541, 'discount_rate' => 0.0778, 'om_rate' => 0.02,
            'load_factor' => 0.8, 'roe' => 0.13, 'interest' => 0.12, 'tax' => 0.25];

        $r25 = (new KkfCalculator)->calculate($in + ['horizon' => 25]);
        $this->assertEqualsWithDelta(20.275, $r25['years'][1]['energy_sold_mwh'], 0.001);          // KAJIAN I16 (MWh/year)
        $this->assertEqualsWithDelta(1.88717861, $r25['bc_ratio'], 0.00001);                       // KAJIAN AH46
        $this->assertSame('1 Tahun 10 Bulan', $r25['payback']['text']);                            // KAJIAN AH47
        $this->assertEqualsWithDelta(10.3426474, $r25['rwacc_percent'], 0.0001);                   // KKF (2) D106
        $this->assertTrue($r25['feasible']);                                                       // KAJIAN AH48: DIREKOMENDASIKAN DISAMBUNG

        $r15 = (new KkfCalculator)->calculate($in + ['horizon' => 15]);
        $this->assertEqualsWithDelta(54.8135587, $r15['irr_percent'], 0.0001);                     // KAJIAN AH44
        $this->assertEqualsWithDelta(110458803.0, $r15['npv'] / (1 + 0.0778), 1.0);                // KAJIAN AH45 (Excel NPV() also discounts year 0 once)
    }
}
