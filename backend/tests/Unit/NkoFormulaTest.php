<?php

namespace Tests\Unit;

use App\Services\Nko\NkoFormula;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

class NkoFormulaTest extends TestCase
{
    private function hitung(string $rumus, array $nilai = []): ?float
    {
        return NkoFormula::parse($rumus)->evaluate(fn (string $nama) => $nilai[$nama] ?? null);
    }

    #[Test]
    public function aritmetika_mengikuti_urutan_operator_dan_kurung(): void
    {
        $this->assertSame(7.0, $this->hitung('1 + 2 * 3'));
        $this->assertSame(9.0, $this->hitung('(1 + 2) * 3'));
        $this->assertSame(1.0, $this->hitung('8 / 4 / 2'));
        $this->assertSame(-5.0, $this->hitung('-a - 2', ['a' => 3.0]));
        $this->assertSame(6.0, $this->hitung('max(a, 2) + min(5, 3, 4) - abs(-1) + 1', ['a' => 3.0]));
        $this->assertSame(['kwh_jual', 'ba_penjualan'], NkoFormula::parse('(kwh_jual - ba_penjualan) / 1000000')->variables());
    }

    #[Test]
    public function data_kosong_dan_pembagian_nol_menghasilkan_kosong_kecuali_diberi_pengganti(): void
    {
        $this->assertNull($this->hitung('a + 1'));
        $this->assertNull($this->hitung('max(a, 1)'));
        $this->assertNull($this->hitung('1 / 0'));
        $this->assertSame(5.0, $this->hitung('atau(a, 0) + 5'));
        $this->assertSame(2.0, $this->hitung('atau(a, 0)', ['a' => 2.0]));
    }

    #[Test]
    #[DataProvider('rumusSalah')]
    public function rumus_salah_ditolak(string $rumus): void
    {
        $this->expectException(InvalidArgumentException::class);
        NkoFormula::parse($rumus);
    }

    public static function rumusSalah(): array
    {
        return array_map(fn (string $r) => [$r], ['', '1 +', '(1 + 2', '1 2', 'a b', 'system(1)', 'atau(1)', 'abs(1, 2)', '$a', 'a; b', 'A + 1', '1 ** 2', 'kwh-jual @', str_repeat('1+', 300).'1']);
    }
}
