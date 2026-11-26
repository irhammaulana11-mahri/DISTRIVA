<?php

namespace App\Services\Nko;

use RuntimeException;

/** Usulan aturan atau unggahan definisi yang tidak sah (422) atau bertabrakan dengan keadaan sekarang (409). */
class NkoRuleException extends RuntimeException
{
    /** @param  array<string, mixed>|null  $data  rincian untuk ditampilkan (mis. hasil pemeriksaan workbook) */
    public function __construct(string $message, public readonly int $status = 422, public readonly ?array $data = null)
    {
        parent::__construct($message);
    }
}
