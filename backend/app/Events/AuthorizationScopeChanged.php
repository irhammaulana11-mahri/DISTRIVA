<?php

namespace App\Events;

/**
 * Dispatched only after the surrounding transaction commits. Cache layers
 * (none exist yet) must invalidate DISTRIVA scope caches on this event.
 */
class AuthorizationScopeChanged
{
    public function __construct(public readonly string $userId) {}
}
