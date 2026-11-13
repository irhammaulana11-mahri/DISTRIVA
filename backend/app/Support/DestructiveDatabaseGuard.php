<?php

namespace App\Support;

use RuntimeException;

/**
 * Refuses destructive Artisan database commands unless the connection targets
 * a database explicitly listed as disposable (config distriva.disposable_databases).
 * Protects the main database (distriva_db) from migrate:fresh / db:wipe etc.
 */
class DestructiveDatabaseGuard
{
    public const COMMANDS = ['migrate:fresh', 'migrate:refresh', 'migrate:reset', 'migrate:rollback', 'db:wipe'];

    /** @param list<string> $disposable */
    public static function assertAllowed(?string $command, ?string $database, array $disposable): void
    {
        if ($command === null || ! in_array($command, self::COMMANDS, true)) {
            return;
        }

        if ($database === null || ! in_array($database, $disposable, true)) {
            throw new RuntimeException(sprintf(
                "Refusing '%s' on database '%s': only disposable databases (%s) allow destructive commands.",
                $command,
                $database ?? 'unknown',
                implode(', ', $disposable),
            ));
        }
    }
}
