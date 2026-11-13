<?php

namespace Tests\Unit;

use App\Support\Terbilang;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

class TerbilangTest extends TestCase
{
    #[Test]
    public function it_spells_rupiah_amounts_in_indonesian(): void
    {
        $this->assertSame('nol rupiah', Terbilang::rupiah(0));
        $this->assertSame('satu rupiah', Terbilang::rupiah(1));
        $this->assertSame('sebelas rupiah', Terbilang::rupiah(11));
        $this->assertSame('lima belas rupiah', Terbilang::rupiah(15));
        $this->assertSame('seratus rupiah', Terbilang::rupiah(100));
        $this->assertSame('seratus dua puluh tiga rupiah', Terbilang::rupiah(123));
        $this->assertSame('seribu rupiah', Terbilang::rupiah(1000));
        $this->assertSame('dua ribu lima ratus rupiah', Terbilang::rupiah(2500));
        $this->assertSame('sepuluh ribu rupiah', Terbilang::rupiah(10000));
        $this->assertSame('seratus sebelas ribu seratus sebelas rupiah', Terbilang::rupiah(111111));
        $this->assertSame('satu juta rupiah', Terbilang::rupiah(1_000_000));
        $this->assertSame('lima puluh empat juta enam ratus sembilan puluh lima ribu enam ratus rupiah', Terbilang::rupiah(54_695_600));
        $this->assertSame('dua miliar satu juta rupiah', Terbilang::rupiah(2_001_000_000));
        $this->assertSame('satu triliun rupiah', Terbilang::rupiah(1_000_000_000_000));
        $this->assertSame('dua puluh tujuh ribu tiga ratus rupiah', Terbilang::rupiah(27300.4));
    }
}
