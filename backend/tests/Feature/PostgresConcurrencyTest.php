<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use PDO;
use PDOException;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/**
 * Two real PostgreSQL sessions, with committed data (no wrapping transaction).
 * Session A holds an uncommitted write; session B must block (lock timeout) and,
 * after A commits, be rejected by the constraint/trigger. Runs only on the
 * guarded disposable test database; created rows are removed in tearDown.
 */
class PostgresConcurrencyTest extends PostgresTestCase
{
    /** @var array<int, PDO> */
    private array $sessions = [];

    public function beginDatabaseTransaction(): void
    {
        // Intentionally no wrapping transaction: other sessions must see committed rows.
    }

    protected function tearDown(): void
    {
        foreach ($this->sessions as $pdo) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        }
        $this->sessions = [];

        DB::table('user_role_assignments')->delete();
        DB::table('organizational_units')->whereNotNull('parent_id')->delete();
        DB::table('organizational_units')->delete();
        DB::table('users')->delete();
        DB::table('roles')->delete();

        parent::tearDown();
    }

    private function openSession(): PDO
    {
        $c = config('database.connections.pgsql');
        $this->assertSame(self::TEST_DATABASE, $c['database']);
        $pdo = new PDO(
            "pgsql:host={$c['host']};port={$c['port']};dbname={$c['database']}",
            $c['username'],
            $c['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );
        $pdo->exec("SET lock_timeout = '400ms'");

        return $this->sessions[] = $pdo;
    }

    private function sqlState(callable $fn): ?string
    {
        try {
            $fn();
        } catch (PDOException $e) {
            return (string) $e->getCode();
        }

        return null;
    }

    private function insertAssignment(PDO $pdo, string $user, int $role, string $unit, string $from, ?string $until): void
    {
        $st = $pdo->prepare('INSERT INTO user_role_assignments (id, user_id, role_id, organizational_unit_id, valid_from, valid_until, is_active, created_at, updated_at) VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, true, now(), now())');
        $st->execute([$user, $role, $unit, $from, $until]);
    }

    #[Test]
    public function concurrent_overlapping_assignments_allow_only_one_to_commit(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');

        $a = $this->openSession();
        $b = $this->openSession();
        $a->beginTransaction();
        $this->insertAssignment($a, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-01-01', null);

        $b->beginTransaction();
        $blocked = $this->sqlState(fn () => $this->insertAssignment($b, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-06-01', null));
        $this->assertSame('55P03', $blocked, 'B must wait on A\'s uncommitted overlapping row');
        $b->rollBack();

        $a->commit();

        $b->beginTransaction();
        $rejected = $this->sqlState(fn () => $this->insertAssignment($b, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-06-01', null));
        $this->assertSame('23P01', $rejected, 'After A commits, B must violate the exclusion constraint');
        $b->rollBack();

        $this->assertSame(1, DB::table('user_role_assignments')->count());
    }

    #[Test]
    public function concurrent_non_overlapping_assignments_do_not_block(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');

        $a = $this->openSession();
        $b = $this->openSession();
        $a->beginTransaction();
        $this->insertAssignment($a, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-01-01', '2026-06-30');
        $b->beginTransaction();
        $this->insertAssignment($b, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-07-01', null);
        $a->commit();
        $b->commit();

        $this->assertSame(2, DB::table('user_role_assignments')->count());
    }

    #[Test]
    public function concurrent_duplicate_unit_code_is_rejected_after_first_commit(): void
    {
        $a = $this->openSession();
        $b = $this->openSession();
        $sql = "INSERT INTO organizational_units (id, code, name, unit_type, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'DUP-1', 'x', 'UP3', true, now(), now())";

        $a->beginTransaction();
        $a->exec($sql);
        $b->beginTransaction();
        $this->assertSame('55P03', $this->sqlState(fn () => $b->exec($sql)));
        $b->rollBack();
        $a->commit();

        $b->beginTransaction();
        $this->assertSame('23505', $this->sqlState(fn () => $b->exec($sql)));
        $b->rollBack();
    }

    #[Test]
    public function deactivating_a_parent_up3_cannot_race_with_adding_an_active_child_ulp(): void
    {
        $up3 = $this->makeUnit('UP3');
        $a = $this->openSession();
        $b = $this->openSession();

        $a->beginTransaction();
        $st = $a->prepare("INSERT INTO organizational_units (id, code, name, unit_type, parent_id, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'ULP-RACE', 'x', 'ULP', ?, true, now(), now())");
        $st->execute([$up3->getKey()]);

        $b->beginTransaction();
        $blocked = $this->sqlState(fn () => $b->prepare('UPDATE organizational_units SET is_active = false WHERE id = ?')->execute([$up3->getKey()]));
        $this->assertSame('55P03', $blocked, 'Deactivation must wait for the child insert (FOR SHARE on parent)');
        $b->rollBack();
        $a->commit();

        $b->beginTransaction();
        $rejected = $this->sqlState(fn () => $b->prepare('UPDATE organizational_units SET is_active = false WHERE id = ?')->execute([$up3->getKey()]));
        $this->assertSame('P0001', $rejected, 'After commit the trigger must reject deactivating a parent with an active child');
        $b->rollBack();
    }

    #[Test]
    public function a_rolled_back_assignment_leaves_no_partial_state(): void
    {
        $user = $this->makeUser();
        $unit = $this->makeUnit('UP3');
        $role = $this->makeRole('TEKNIK');
        $a = $this->openSession();

        $a->beginTransaction();
        $this->insertAssignment($a, $user->getKey(), $role->getKey(), $unit->getKey(), '2026-01-01', null);
        $a->rollBack();

        $this->assertSame(0, DB::table('user_role_assignments')->count());
    }
}
