<?php

namespace Tests;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Base class for tests that need the real PostgreSQL schema.
 *
 * Refuses to run unless the connection is PostgreSQL and the database is the
 * dedicated disposable test database (migrate:fresh runs on it).
 */
abstract class PostgresTestCase extends TestCase
{
    use RefreshDatabase;

    public const TEST_DATABASE = 'distriva_backend_test';

    protected function setUp(): void
    {
        parent::setUp();
    }

    protected function refreshApplication(): void
    {
        parent::refreshApplication();

        $connection = $this->app['config']->get('database.default');
        $database = $this->app['config']->get("database.connections.{$connection}.database");

        if ($connection !== 'pgsql' || $database !== self::TEST_DATABASE) {
            throw new RuntimeException('Refusing to run: target must be pgsql/'.self::TEST_DATABASE.", got {$connection}/{$database}.");
        }
    }

    protected function makeUser(string $status = 'ACTIVE', ?string $email = null): User
    {
        return User::query()->create([
            'name' => 'Test User',
            'email' => $email ?? fake()->unique()->safeEmail(),
            'password' => 'secret-password',
            'account_status' => $status,
        ]);
    }

    protected function makeUnit(string $type = 'UP3', ?OrganizationalUnit $parent = null, bool $active = true): OrganizationalUnit
    {
        return OrganizationalUnit::query()->create([
            'code' => strtoupper(fake()->unique()->bothify('U-####??')),
            'name' => "Unit {$type}",
            'unit_type' => $type,
            'parent_id' => $parent?->getKey(),
            'is_active' => $active,
        ]);
    }

    protected function makeRole(string $name, bool $requiresUnitScope = true): Role
    {
        return Role::query()->firstOrCreate(
            ['name' => $name, 'guard_name' => 'web'],
            ['requires_unit_scope' => $requiresUnitScope],
        );
    }

    protected function assign(User $user, Role $role, ?OrganizationalUnit $unit, string $from = '2026-01-01', ?string $until = null, bool $active = true): UserRoleAssignment
    {
        return UserRoleAssignment::query()->create([
            'user_id' => $user->getKey(),
            'role_id' => $role->getKey(),
            'organizational_unit_id' => $unit?->getKey(),
            'valid_from' => $from,
            'valid_until' => $until,
            'is_active' => $active,
        ]);
    }

    /** Assert the statement fails with a database error inside a savepoint. */
    protected function assertDbRejects(callable $callback): void
    {
        $failed = false;
        DB::beginTransaction();
        try {
            $callback();
        } catch (QueryException) {
            $failed = true;
        } finally {
            DB::rollBack();
        }
        $this->assertTrue($failed, 'Expected the database to reject the statement (called from line '.(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 1)[0]['line'] ?? '?').').');
    }
}
