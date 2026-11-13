<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\Backup\BackupService;
use Database\Seeders\BackupPermissionSeeder;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Symfony\Component\Process\Process;
use Tests\PostgresTestCase;

class BackupTest extends PostgresTestCase
{
    private string $root;

    private User $admin;

    private User $other;

    /** @var list<string> scratch databases to drop */
    private array $scratch = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('documents');
        $this->root = sys_get_temp_dir().'/distriva_backup_test_'.Str::lower(Str::random(8));
        config(['distriva.backup.root' => $this->root, 'distriva.backup.run_inline' => true]);
        $this->seed(BackupPermissionSeeder::class);
        $this->admin = $this->makeUser();
        $this->admin->forceFill(['password' => Hash::make('Rahasia-123!')])->save();
        $this->assign($this->admin, Role::query()->where('name', 'SYS_ADMIN')->firstOrFail(), null);
        $this->other = $this->makeUser();
        $this->assign($this->other, Role::query()->where('name', 'MANAGER_ULP')->firstOrFail(), $this->makeUnit('ULP', $this->makeUnit('UP3')));
    }

    protected function tearDown(): void
    {
        foreach ($this->scratch as $db) {
            $this->psql('postgres', 'DROP DATABASE IF EXISTS '.$db);
        }
        foreach ([$this->root] as $dir) {
            if (str_starts_with($dir, sys_get_temp_dir().'/distriva_backup_test_') && is_dir($dir)) {
                (new Process(['rm', '-rf', $dir]))->run();
            }
        }
        parent::tearDown();
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function psql(string $db, string $sql): string
    {
        $c = config('database.connections.pgsql');
        $p = new Process(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', $db, '-c', $sql], null, ['PGHOST' => $c['host'], 'PGPORT' => (string) $c['port'], 'PGUSER' => $c['username'], 'PGPASSWORD' => (string) $c['password']]);
        $p->run();
        $this->assertTrue($p->isSuccessful(), $p->getErrorOutput());

        return trim($p->getOutput());
    }

    /** A throw-away database that holds a copy of the backup, standing in for "the live database" of a restore. */
    private function scratchFrom(string $backupId): string
    {
        $db = 'distriva_scratch_'.Str::lower(Str::random(8));
        $this->scratch[] = $db;
        $this->psql('postgres', 'CREATE DATABASE '.$db);
        $c = config('database.connections.pgsql');
        $file = app(BackupService::class)->absolute(DB::table('backup_runs')->where('id', $backupId)->value('db_file'));
        $p = new Process(['pg_restore', '--no-owner', '-d', $db, $file], null, ['PGHOST' => $c['host'], 'PGPORT' => (string) $c['port'], 'PGUSER' => $c['username'], 'PGPASSWORD' => (string) $c['password']]);
        $p->run();
        $this->assertTrue($p->isSuccessful(), $p->getErrorOutput());

        return $db;
    }

    private function backup(bool $docs = false): string
    {
        $r = $this->as($this->admin)->postJson('/api/backups', ['include_documents' => $docs, 'notes' => 'uji'])->assertStatus(202);

        return $r->json('data.id');
    }

    #[Test]
    public function only_sys_admin_holds_the_backup_keys_and_everyone_else_is_refused_before_validation(): void
    {
        $holders = fn (string $k) => DB::table('role_has_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->join('roles as r', 'r.id', '=', 'rp.role_id')->where('p.name', $k)->pluck('r.name')->all();
        foreach (array_keys(config('distriva_permissions.backups')) as $key) {
            $this->assertSame(['SYS_ADMIN'], $holders($key), $key);
        }
        $this->as($this->other)->getJson('/api/backups')->assertForbidden();
        $this->as($this->other)->getJson('/api/backups/status')->assertForbidden();
        $this->as($this->other)->postJson('/api/backups', [])->assertForbidden();
        $this->as($this->other)->putJson('/api/backups/settings', [])->assertForbidden();
        $id = $this->backup();
        foreach (['verify', 'restore', 'remove'] as $action) {
            $this->as($this->other)->postJson("/api/backups/{$id}/{$action}", [])->assertForbidden();
        }
        $this->as($this->other)->getJson("/api/backups/{$id}/download?file=database")->assertForbidden();
        $this->assertFalse($this->as($this->other)->getJson('/api/backups/access')->json('can')['backups.restore']);
        $this->assertTrue($this->as($this->admin)->getJson('/api/backups/access')->json('can')['backups.restore']);
    }

    #[Test]
    public function a_backup_writes_a_private_dump_with_checksum_counts_and_events_and_can_be_downloaded(): void
    {
        $id = $this->backup();
        $r = $this->as($this->admin)->getJson("/api/backups/{$id}")->assertOk()->json('data');
        $this->assertSame('SUCCEEDED', $r['status']);
        $this->assertSame('MANUAL', $r['trigger']);
        $this->assertGreaterThan(0, $r['db_size']);
        $this->assertGreaterThan(50, $r['db_entries']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $r['db_sha256']);
        $this->assertSame(DB::table('migrations')->orderByDesc('id')->value('migration'), $r['schema_version']);
        $this->assertArrayHasKey('migrations', $r['table_counts']);
        $this->assertSame(['BACKUP_STARTED', 'BACKUP_SUCCEEDED'], array_column($r['events'], 'event_type'));

        $file = $this->root.'/'.DB::table('backup_runs')->where('id', $id)->value('db_file');
        $this->assertFileExists($file);
        $this->assertSame('0600', substr(sprintf('%o', fileperms($file)), -4));
        $this->assertSame($r['db_sha256'], hash_file('sha256', $file));

        $dl = $this->as($this->admin)->get("/api/backups/{$id}/download?file=database")->assertOk();
        $this->assertSame('nosniff', $dl->headers->get('X-Content-Type-Options'));
        $this->as($this->admin)->getJson("/api/backups/{$id}/download?file=documents")->assertNotFound();      // none requested
        $this->as($this->admin)->getJson("/api/backups/{$id}/download?file=zzz")->assertUnprocessable();
        $this->assertSame(1, DB::table('backup_events')->where('backup_run_id', $id)->where('event_type', 'DOWNLOADED')->count());
        $this->assertSame('SUCCEEDED', $this->as($this->admin)->getJson('/api/backups/status')->json('data.last_success.status'));
    }

    #[Test]
    public function the_dump_never_contains_the_backup_history_tables(): void
    {
        $id = $this->backup();
        $file = $this->root.'/'.DB::table('backup_runs')->where('id', $id)->value('db_file');
        $list = (new Process(['pg_restore', '-l', $file]))->mustRun()->getOutput();
        $this->assertStringContainsString(' users ', $list);
        foreach (['backup_runs', 'restore_runs', 'backup_settings', 'backup_events'] as $t) {
            $this->assertStringNotContainsString(' '.$t.' ', $list, $t);
        }
    }

    #[Test]
    public function documents_are_archived_on_request_and_only_one_backup_runs_at_a_time(): void
    {
        Storage::disk('documents')->put('2026/aa/foto.png', 'isi-foto');
        $id = $this->backup(true);
        $r = DB::table('backup_runs')->where('id', $id)->first();
        $this->assertNotNull($r->docs_file);
        $this->assertSame(hash_file('sha256', $this->root.'/'.$r->docs_file), $r->docs_sha256);
        $this->assertStringContainsString('2026/aa/foto.png', (new Process(['tar', '-tzf', $this->root.'/'.$r->docs_file]))->mustRun()->getOutput());

        DB::table('backup_runs')->insert(['id' => (string) Str::uuid(), 'backup_number' => 'BKP-X', 'trigger' => 'MANUAL', 'status' => 'RUNNING', 'started_at' => now()]);
        $this->as($this->admin)->postJson('/api/backups', [])->assertStatus(409);
    }

    #[Test]
    public function a_failing_dump_is_recorded_as_failed_leaves_no_file_and_hides_the_password(): void
    {
        config(['distriva.backup.pg_dump' => 'pg_dump_tidak_ada']);
        $id = $this->backup();
        $r = DB::table('backup_runs')->where('id', $id)->first();
        $this->assertSame('FAILED', $r->status);
        $this->assertNotNull($r->error);
        $secret = (string) config('database.connections.pgsql.password');
        if ($secret !== '') {
            $this->assertStringNotContainsString($secret, $r->error);
        }
        $this->assertSame([], glob($this->root.'/*/*.dump') ?: []);
        $this->assertSame('BACKUP_FAILED', DB::table('backup_events')->where('backup_run_id', $id)->orderByDesc('seq')->value('event_type'));
    }

    #[Test]
    public function the_backup_folder_cannot_be_public_or_inside_the_documents_folder(): void
    {
        config(['distriva.backup.root' => public_path('cadangan')]);
        $this->as($this->admin)->postJson('/api/backups', [])->assertStatus(409);
        $this->assertFalse($this->as($this->admin)->getJson('/api/backups/status')->json('data.health.ok'));
        config(['distriva.backup.root' => app(BackupService::class)->docsRoot().'/backups']);
        $this->as($this->admin)->postJson('/api/backups', [])->assertStatus(409);
        config(['distriva.backup.root' => 'relatif/path']);
        $this->as($this->admin)->postJson('/api/backups', [])->assertStatus(409);
    }

    #[Test]
    public function verification_restores_into_a_throw_away_database_and_removes_it_afterwards(): void
    {
        $id = $this->backup();
        $before = $this->psql('postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'distriva_verify_%'");
        $r = $this->as($this->admin)->postJson("/api/backups/{$id}/verify")->assertOk();
        $this->assertTrue($r->json('result.passed'), json_encode($r->json('result')));
        $this->assertTrue($r->json('result.checks.migrations_count_matches'));
        $this->assertNotNull($r->json('data.verified_at'));
        $this->assertSame($before, $this->psql('postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'distriva_verify_%'"));
        $this->assertSame('VERIFIED', DB::table('backup_events')->where('backup_run_id', $id)->orderByDesc('seq')->value('event_type'));

        // a corrupted file fails the verification and the backup does not count as verified
        $other = DB::table('backup_runs')->where('id', $this->backup())->first();
        file_put_contents($this->root.'/'.$other->db_file, 'rusak', FILE_APPEND);
        $bad = $this->as($this->admin)->postJson("/api/backups/{$other->id}/verify")->assertOk();
        $this->assertFalse($bad->json('result.passed'));
        $this->assertNull($bad->json('data.verified_at'));
        $this->assertSame($before, $this->psql('postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'distriva_verify_%'"));
    }

    #[Test]
    public function a_restore_needs_a_verified_backup_the_typed_phrase_the_password_and_the_same_schema(): void
    {
        $id = $this->backup();
        $number = DB::table('backup_runs')->where('id', $id)->value('backup_number');
        $ok = ['confirm' => "PULIHKAN {$number}", 'reason' => 'Uji pemulihan', 'password' => 'Rahasia-123!'];

        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", $ok)->assertStatus(409);                       // not verified yet
        $this->as($this->admin)->postJson("/api/backups/{$id}/verify")->assertOk();
        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['confirm' => 'PULIHKAN'] + $ok)->assertUnprocessable()->assertJsonValidationErrors('confirm');
        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['password' => 'salah'] + $ok)->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['restore_documents' => true] + $ok)->assertStatus(409);   // no documents inside
        DB::table('backup_runs')->where('id', $id)->update(['schema_version' => '2020_01_01_000000_lama']);
        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", $ok)->assertStatus(409);                        // other schema version
        $this->assertSame(0, DB::table('restore_runs')->count());
    }

    #[Test]
    public function a_restore_replaces_the_data_after_a_safety_backup_and_keeps_the_history(): void
    {
        Storage::disk('documents')->put('2026/bb/dok.pdf', 'isi');
        $id = $this->backup(true);
        $number = DB::table('backup_runs')->where('id', $id)->value('backup_number');
        $this->as($this->admin)->postJson("/api/backups/{$id}/verify")->assertOk();
        $expected = (int) $this->psql(DB::connection()->getDatabaseName(), 'SELECT count(*) FROM migrations');

        $db = $this->scratchFrom($id);
        $this->psql($db, 'DELETE FROM migrations');                                                  // the "damage" to repair
        $this->assertSame('0', $this->psql($db, 'SELECT count(*) FROM migrations'));
        Storage::disk('documents')->delete('2026/bb/dok.pdf');
        config(['distriva.backup.target_database' => $db]);

        $r = $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['confirm' => "PULIHKAN {$number}", 'reason' => 'Pemulihan uji', 'password' => 'Rahasia-123!', 'restore_documents' => true])->assertStatus(202);
        $restore = DB::table('restore_runs')->where('id', $r->json('data.id'))->first();
        $this->assertSame('SUCCEEDED', $restore->status, (string) $restore->error);
        $this->assertSame((string) $expected, $this->psql($db, 'SELECT count(*) FROM migrations'));
        $this->assertTrue(Storage::disk('documents')->exists('2026/bb/dok.pdf'));                    // missing document came back

        $safety = DB::table('backup_runs')->where('id', $restore->safety_backup_id)->first();
        $this->assertSame('PRE_RESTORE', $safety->trigger);
        $this->assertSame('SUCCEEDED', $safety->status);
        $this->assertSame(['RESTORE_STARTED', 'RESTORE_SUCCEEDED'], DB::table('backup_events')->where('restore_run_id', $restore->id)->orderBy('seq')->pluck('event_type')->all());
        $this->assertSame(1, $this->as($this->admin)->getJson('/api/backups/restores')->json('meta.total'));
        $this->assertSame($id, $this->as($this->admin)->getJson("/api/backups/restores/{$restore->id}")->json('data.backup_run_id'));
        $this->assertNotNull(DB::table('backup_runs')->where('id', $id)->value('db_file'));          // the history tables were not rewound
    }

    #[Test]
    public function a_tampered_backup_file_stops_the_restore_before_anything_is_changed(): void
    {
        $id = $this->backup();
        $number = DB::table('backup_runs')->where('id', $id)->value('backup_number');
        $this->as($this->admin)->postJson("/api/backups/{$id}/verify")->assertOk();
        $db = $this->scratchFrom($id);
        $this->psql($db, 'DELETE FROM migrations');
        file_put_contents($this->root.'/'.DB::table('backup_runs')->where('id', $id)->value('db_file'), 'x', FILE_APPEND);
        config(['distriva.backup.target_database' => $db]);

        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['confirm' => "PULIHKAN {$number}", 'reason' => 'Uji berkas rusak', 'password' => 'Rahasia-123!'])->assertStatus(202);
        $restore = DB::table('restore_runs')->first();
        $this->assertSame('FAILED', $restore->status);
        $this->assertStringContainsString('sha256', $restore->error);
        $this->assertSame('0', $this->psql($db, 'SELECT count(*) FROM migrations'));                 // untouched
        $this->assertNull($restore->safety_backup_id);
        $this->assertSame(0, DB::table('backup_runs')->where('trigger', 'PRE_RESTORE')->count());
    }

    #[Test]
    public function a_failing_restore_changes_nothing_because_it_runs_in_one_transaction(): void
    {
        $id = $this->backup();
        $number = DB::table('backup_runs')->where('id', $id)->value('backup_number');
        $this->as($this->admin)->postJson("/api/backups/{$id}/verify")->assertOk();
        $db = $this->scratchFrom($id);
        $this->psql($db, 'DELETE FROM migrations');
        config(['distriva.backup.target_database' => $db, 'distriva.backup.pg_restore' => 'pg_restore_tidak_ada']);
        $this->as($this->admin)->postJson("/api/backups/{$id}/restore", ['confirm' => "PULIHKAN {$number}", 'reason' => 'Uji gagal', 'password' => 'Rahasia-123!'])->assertStatus(202);
        $this->assertSame('FAILED', DB::table('restore_runs')->value('status'));
        $this->assertSame('0', $this->psql($db, 'SELECT count(*) FROM migrations'));
    }

    #[Test]
    public function the_scheduled_backup_runs_once_per_day_when_enabled_and_due(): void
    {
        $svc = app(BackupService::class);
        $this->assertNull($svc->runScheduledIfDue());                                                // disabled by default
        $this->as($this->admin)->putJson('/api/backups/settings', ['enabled' => true, 'run_at' => '00:00', 'include_documents' => false, 'retention_count' => 3])->assertOk();
        $first = $svc->runScheduledIfDue();
        $this->assertNotNull($first);
        $this->assertSame('SCHEDULED', DB::table('backup_runs')->where('id', $first)->value('trigger'));
        $this->assertSame('SUCCEEDED', DB::table('backup_runs')->where('id', $first)->value('status'));
        $this->assertNull($svc->runScheduledIfDue());                                                // already done today

        $this->as($this->admin)->putJson('/api/backups/settings', ['enabled' => true, 'run_at' => '25:99', 'include_documents' => false, 'retention_count' => 3])->assertUnprocessable();
        $this->as($this->admin)->putJson('/api/backups/settings', ['enabled' => true, 'run_at' => '03:30', 'include_documents' => true, 'retention_count' => 0])->assertUnprocessable();
        $this->assertSame(1, DB::table('backup_events')->where('event_type', 'SETTINGS_CHANGED')->count());
    }

    #[Test]
    public function retention_removes_the_oldest_files_but_keeps_their_record_and_a_backup_can_be_removed_with_a_reason(): void
    {
        $this->as($this->admin)->putJson('/api/backups/settings', ['enabled' => false, 'run_at' => '02:00', 'include_documents' => false, 'retention_count' => 2])->assertOk();
        $ids = [];
        foreach (range(1, 3) as $i) {
            $ids[] = $this->backup();
            DB::table('backup_runs')->where('id', end($ids))->update(['started_at' => now()->subHours(10 - $i)]);   // deterministic age
        }
        app(BackupService::class)->prune();
        $this->assertSame('DELETED', DB::table('backup_runs')->where('id', $ids[0])->value('status'));
        $this->assertSame(['SUCCEEDED', 'SUCCEEDED'], [DB::table('backup_runs')->where('id', $ids[1])->value('status'), DB::table('backup_runs')->where('id', $ids[2])->value('status')]);
        $this->assertFileDoesNotExist($this->root.'/'.DB::table('backup_runs')->where('id', $ids[0])->value('db_file'));

        $this->as($this->admin)->postJson("/api/backups/{$ids[1]}/remove", [])->assertUnprocessable();
        $this->as($this->admin)->postJson("/api/backups/{$ids[1]}/remove", ['reason' => 'Tidak diperlukan'])->assertOk();
        $this->as($this->admin)->postJson("/api/backups/{$ids[1]}/remove", ['reason' => 'Lagi'])->assertStatus(409);
        $this->as($this->admin)->getJson("/api/backups/{$ids[1]}/download?file=database")->assertNotFound();
    }

    #[Test]
    public function backup_events_are_append_only(): void
    {
        $id = $this->backup();
        $this->assertDbRejects(fn () => DB::table('backup_events')->where('backup_run_id', $id)->update(['event_type' => 'DELETED']));
        $this->assertDbRejects(fn () => DB::table('backup_events')->where('backup_run_id', $id)->delete());
    }
}
