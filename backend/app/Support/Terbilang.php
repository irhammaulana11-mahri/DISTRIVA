<?php

namespace App\Support;

/** Indonesian number-to-words for rupiah amounts ("terbilang"), e.g. 54695600 => "lima puluh empat juta enam ratus sembilan puluh lima ribu enam ratus rupiah". */
final class Terbilang
{
    private const UNITS = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

    public static function rupiah(float|int $amount): string
    {
        $n = (int) round(abs($amount));

        return trim(($amount < 0 ? 'minus ' : '').($n === 0 ? 'nol' : self::words($n))).' rupiah';
    }

    public static function words(int $n): string
    {
        if ($n < 12) {
            return self::UNITS[$n];
        }
        if ($n < 20) {
            return self::UNITS[$n - 10].' belas';
        }
        if ($n < 100) {
            return trim(self::UNITS[intdiv($n, 10)].' puluh '.self::words($n % 10));
        }
        if ($n < 200) {
            return trim('seratus '.self::words($n - 100));
        }
        if ($n < 1000) {
            return trim(self::UNITS[intdiv($n, 100)].' ratus '.self::words($n % 100));
        }
        if ($n < 2000) {
            return trim('seribu '.self::words($n - 1000));
        }
        foreach ([[1_000_000_000_000, 'triliun'], [1_000_000_000, 'miliar'], [1_000_000, 'juta'], [1000, 'ribu']] as [$base, $name]) {
            if ($n >= $base) {
                return trim(self::words(intdiv($n, $base)).' '.$name.' '.self::words($n % $base));
            }
        }

        return '';
    }
}
