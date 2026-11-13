<?php

namespace App\Formula;

/**
 * Supplies the values a formula reads. Return null for an empty/missing cell (Excel "empty": equals 0 and "").
 * Ranges are expanded by the evaluator into scalar cell() calls.
 */
interface Resolver
{
    /** @return int|float|string|bool|null */
    public function cell(?string $sheet, string $ref): mixed;

    /** @return int|float|string|bool|null a named input/parameter/row output of the DISTRIVA model */
    public function variable(string $name): mixed;
}
