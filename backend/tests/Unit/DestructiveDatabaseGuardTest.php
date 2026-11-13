<?php

namespace Tests\Unit;

use App\Support\DestructiveDatabaseGuard as Guard;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\NullOutput;
use Tests\TestCase;

class DestructiveDatabaseGuardTest extends TestCase
{
    #[Test]
    public function destructive_commands_are_refused_on_the_main_database(): void
    {
        foreach (Guard::COMMANDS as $command) {
            try {
                Guard::assertAllowed($command, 'distriva_db', ['distriva_backend_test']);
                $this->fail("$command must be refused");
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->expectException(RuntimeException::class);
        Guard::assertAllowed('migrate:fresh', null, ['distriva_backend_test']);
    }

    #[Test]
    public function disposable_databases_and_safe_commands_are_allowed(): void
    {
        Guard::assertAllowed('migrate:fresh', 'distriva_backend_test', ['distriva_backend_test']);
        Guard::assertAllowed('migrate', 'distriva_db', ['distriva_backend_test']);
        Guard::assertAllowed('db:seed', 'distriva_db', ['distriva_backend_test']);
        Guard::assertAllowed(null, 'distriva_db', ['distriva_backend_test']);
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function the_registered_listener_blocks_a_destructive_command_event_for_the_main_database(): void
    {
        // Only dispatches the event; no command ever runs and no database connection is made.
        config(['database.connections.pgsql.database' => 'distriva_db', 'database.default' => 'pgsql']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Refusing');
        Event::dispatch(new CommandStarting('migrate:fresh', new ArrayInput([]), new NullOutput));
    }

    #[Test]
    public function the_registered_listener_ignores_safe_commands(): void
    {
        config(['database.connections.pgsql.database' => 'distriva_db', 'database.default' => 'pgsql']);

        Event::dispatch(new CommandStarting('migrate', new ArrayInput([]), new NullOutput));
        $this->addToAssertionCount(1);
    }
}
