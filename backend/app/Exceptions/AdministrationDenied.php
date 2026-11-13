<?php

namespace App\Exceptions;

use RuntimeException;

/** Authorization/administration rule failure carrying the HTTP status to return (403/404/409). */
class AdministrationDenied extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 403)
    {
        parent::__construct($message);
    }
}
