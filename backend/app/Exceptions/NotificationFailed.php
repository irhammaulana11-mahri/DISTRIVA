<?php

namespace App\Exceptions;

use App\Services\Notifications\DeliveryReport;
use RuntimeException;

class NotificationFailed extends RuntimeException
{
    public function __construct(public readonly DeliveryReport $report)
    {
        parent::__construct('Notifikasi tidak terkirim pada kanal mana pun.');
    }
}
