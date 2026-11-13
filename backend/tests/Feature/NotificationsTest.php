<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** In-app inbox (docs/62 §44): server-made notifications, readable by their recipient only. */
class NotificationsTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $up3 = $this->makeUnit('UP3');
        $mk = function (string $role) use ($up3): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $up3);

            return $u;
        };
        $this->engineer = $mk('ENGINEERING');
        $this->manager = $mk('UP3_MANAGER');
        $this->viewer = $mk('TEKNIK');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function importKhs(bool $dry = false): void
    {
        $file = UploadedFile::fake()->createWithContent('khs.csv', "code,name,unit\n1,Tiang Beton 11 m,B\n2,Kabel Twisted 3x70,M\n");
        $this->as($this->engineer)->post('/api/master-data/khs/import', ['file' => $file, 'valid_from' => '2026-01-01', 'dry_run' => $dry ? '1' : '0'], ['Accept' => 'application/json'])->assertSuccessful();
    }

    private function inbox(User $u)
    {
        return $this->as($u)->getJson('/api/notifications')->assertOk();
    }

    #[Test]
    public function an_import_tells_the_approvers_but_not_the_creator_nor_viewers_and_a_dry_run_tells_nobody(): void
    {
        $this->importKhs(dry: true);
        $this->assertSame(0, DB::table('user_notifications')->count());

        $this->importKhs();
        $got = $this->inbox($this->manager);
        $got->assertJsonPath('meta.unread_count', 1)->assertJsonPath('data.0.level', 'warning')->assertJsonPath('data.0.tag', 'KHS')->assertJsonPath('data.0.link', '/master-data/khs');
        $this->assertSame('2 draf KHS menunggu persetujuan', $got->json('data.0.title'));
        $this->assertSame(0, $this->inbox($this->engineer)->json('meta.total'));
        $this->assertSame(0, $this->inbox($this->viewer)->json('meta.total'));
    }

    #[Test]
    public function an_approval_tells_the_creator_with_the_reason_but_not_the_approver(): void
    {
        $this->importKhs();
        $ids = DB::table('khs_item_versions')->pluck('id')->all();
        $this->as($this->manager)->postJson('/api/master-data/khs/versions/approve', ['version_ids' => $ids, 'reason' => 'SK 12/2026'])->assertOk();

        $got = $this->inbox($this->engineer);
        $got->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.level', 'success');
        $this->assertStringContainsString('SK 12/2026', $got->json('data.0.body'));
        $this->assertSame(1, $this->inbox($this->manager)->json('meta.total')); // only the earlier "waiting" notice, no self-notice
    }

    #[Test]
    public function the_inbox_is_private_and_reading_is_per_user(): void
    {
        $this->importKhs();
        $mine = $this->inbox($this->manager)->json('data.0.id');

        $this->as($this->viewer)->postJson("/api/notifications/{$mine}/read")->assertNotFound();   // someone else's: 404, not 403
        $this->assertNull(DB::table('user_notifications')->where('id', $mine)->value('read_at'));

        $this->as($this->manager)->postJson("/api/notifications/{$mine}/read")->assertOk();
        $this->assertNotNull(DB::table('user_notifications')->where('id', $mine)->value('read_at'));
        $this->inbox($this->manager)->assertJsonPath('meta.unread_count', 0);
        $this->assertCount(0, $this->as($this->manager)->getJson('/api/notifications?unread=1')->json('data'));
        $this->assertCount(1, $this->as($this->manager)->getJson('/api/notifications')->json('data'));
    }

    #[Test]
    public function read_all_marks_only_the_callers_notifications_and_the_inbox_requires_a_session(): void
    {
        $this->importKhs();
        $this->importKhs();
        $unread = DB::table('user_notifications')->where('user_id', $this->manager->getKey())->whereNull('read_at')->count();
        $this->assertGreaterThan(0, $unread);
        $this->as($this->manager)->postJson('/api/notifications/read-all')->assertOk()->assertJsonPath('data.marked', $unread);
        $this->assertSame(0, DB::table('user_notifications')->where('user_id', $this->manager->getKey())->whereNull('read_at')->count());

        $this->app['auth']->forgetGuards();
        $this->withToken('')->getJson('/api/notifications')->assertUnauthorized();
        $this->as($this->viewer)->getJson('/api/notifications?per_page=500')->assertUnprocessable();
    }
}
