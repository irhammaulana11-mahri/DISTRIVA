<?php

namespace App\Services\Nko;

use RuntimeException;

/** Usulan aturan atau unggahan definisi yang tidak sah (422) atau bertabrakan dengan keadaan sekarang (409). */
class NkoRuleException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
