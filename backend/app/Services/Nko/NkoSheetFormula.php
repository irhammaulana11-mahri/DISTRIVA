<?php

namespace App\Services\Nko;

/** Olahan teks rumus lembar definisi: bentuk baku untuk dibandingkan dan pemindahan nomor baris. Teks di dalam tanda kutip tidak disentuh. */
class NkoSheetFormula
{
    /** di luar tanda kutip spasi dibuang, huruf dijadikan kapital, dan FALSE()/TRUE() (tulisan LibreOffice) disamakan dengan FALSE/TRUE */
    public static function compact(mixed $rules): mixed
    {
        return self::map($rules, fn (string $part) => str_replace(['FALSE()', 'TRUE()'], ['FALSE', 'TRUE'], strtoupper((string) preg_replace('/\s+/', '', $part))));
    }

    /**
     * @param  array<int, int>  $rows  baris lama => baris baru; baris yang tidak terdaftar dibiarkan
     */
    public static function moveRows(mixed $rules, array $rows): mixed
    {
        return self::map($rules, fn (string $part) => (string) preg_replace_callback('/(?<![A-Za-z])(\$?[A-Za-z]{1,3}\$?)(\d+)(?![\d(A-Za-z])/', fn (array $m) => $m[1].($rows[(int) $m[2]] ?? $m[2]), $part));
    }

    private static function map(mixed $rules, callable $outsideQuotes): mixed
    {
        if (is_array($rules)) {
            return array_map(fn (mixed $r) => self::map($r, $outsideQuotes), $rules);
        }

        return is_string($rules) ? preg_replace_callback('/"[^"]*"|[^"]+/', fn (array $m) => str_starts_with($m[0], '"') ? $m[0] : $outsideQuotes($m[0]), $rules) : $rules;
    }
}
