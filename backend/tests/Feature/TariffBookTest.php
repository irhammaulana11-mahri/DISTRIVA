<?php

namespace Tests\Feature;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\Role;
use App\Models\User;
use App\Services\Kkf\TariffBookService;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class TariffBookTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    private User $vendor;

    private $up3;

    private $ulp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $this->ulp = $this->makeUnit('ULP', $this->up3);
        $mk = function (string $role): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $this->up3);

            return $u;
        };
        $this->engineer = $mk('ENGINEERING');
        $this->manager = $mk('UP3_MANAGER');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function csv(string $body): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('tarif.csv', $body);
    }

    private function good(): string
    {
        return "tarif,daya_va,harga_rata2,jam_nyala,ujl,ulp\nR-1,450,415.0,213,72,\nR1,900,605,133,72,\nR1,900,\"700,5\",140,72,{$this->ulp->code}\nC,,707.0,130,,\n";
    }

    private function upload(?string $body = null, array $extra = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->post('/api/master-data/tariff-books/import', array_merge(['file' => $this->csv($body ?? $this->good()), 'name' => 'Tarif Feb 2026', 'valid_from' => '2026-02-01'], $extra), ['Accept' => 'application/json']);
    }

    private function approve(string $id, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/tariff-books/approve', ['book_ids' => [$id], 'reason' => 'Sesuai laporan penjualan']);
    }

    #[Test]
    public function keys_are_granted_to_the_managers_and_the_approver_only(): void
    {
        $this->upload(null, [], $this->vendor)->assertForbidden();
        $this->upload(null, [], $this->viewer)->assertForbidden();
        $this->upload(null, [], $this->manager)->assertForbidden();          // the approver does not manage
        $this->upload()->assertCreated();
        $id = (string) DB::table('tariff_books')->value('id');
        $this->as($this->viewer)->getJson('/api/master-data/tariff-books')->assertOk()->assertJsonCount(1, 'data');
        $this->as($this->vendor)->getJson('/api/master-data/tariff-books')->assertForbidden();
        $this->approve($id, $this->engineer)->assertForbidden();
    }

    #[Test]
    public function import_is_all_or_nothing_normalizes_tariffs_and_a_dry_run_stores_nothing(): void
    {
        $r = $this->upload(null, ['dry_run' => 1])->assertOk();
        $this->assertSame(0, DB::table('tariff_books')->count());
        $this->assertSame(4, $r->json('data.accepted'));
        $this->upload()->assertCreated();
        $this->assertSame(['C', 'R1', 'R1', 'R1'], DB::table('tariff_book_rows')->orderBy('tariff_code')->pluck('tariff_code')->all());     // "R-1" -> R1
        $this->assertSame(4, DB::table('tariff_book_rows')->count());

        $bad = "tarif,daya_va,harga_rata2,jam_nyala,ulp\nR1,450,0,213,\nR1,450,500,213,\nR1,450,500,213,\nS2,900,100,50,TIDAKADA\n";
        $this->upload($bad)->assertStatus(409);
        $this->assertSame(1, DB::table('tariff_books')->count());       // nothing new stored
        $this->upload("tarif,daya_va,harga_rata2\nR1,450,500\n")->assertStatus(409);   // required column jam_nyala missing
    }

    #[Test]
    public function approval_needs_another_user_closes_the_old_book_and_freezes_the_rows(): void
    {
        $this->upload()->assertCreated();
        $a = (string) DB::table('tariff_books')->value('id');
        $this->approve($a)->assertOk();
        $this->assertSame('APPROVED', DB::table('tariff_books')->where('id', $a)->value('status'));
        try {
            DB::transaction(fn () => DB::table('tariff_book_rows')->where('tariff_book_id', $a)->update(['jam_nyala' => 1]));
            $this->fail('approved rows must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->upload(null, ['name' => 'Tarif Mar', 'valid_from' => '2026-02-01'])->assertCreated();
        $same = (string) DB::table('tariff_books')->where('name', 'Tarif Mar')->value('id');
        $this->approve($same)->assertStatus(409);                          // must start after the active book
        $this->upload(null, ['name' => 'Tarif Jul', 'valid_from' => '2026-07-01'])->assertCreated();
        $b = (string) DB::table('tariff_books')->where('name', 'Tarif Jul')->value('id');
        $this->approve($b)->assertOk()->assertJsonPath('data.auto_closed', 1);
        $this->assertSame('2026-06-30', substr((string) DB::table('tariff_books')->where('id', $a)->value('valid_until'), 0, 10));
        $this->as($this->manager)->postJson("/api/master-data/tariff-books/{$b}/retire", ['reason' => 'Salah'])->assertOk();
        $this->as($this->viewer)->getJson("/api/master-data/tariff-books/{$a}/rows?tariff=R-1")->assertOk()->assertJsonCount(3, 'data');
    }

    #[Test]
    public function resolve_prefers_the_ulp_row_never_guesses_a_neighbouring_power_and_needs_an_active_book(): void
    {
        $svc = app(TariffBookService::class);
        try {
            $svc->resolve($this->ulp->getKey(), 'R1', 900, '2026-03-01');
            $this->fail('no approved book yet');
        } catch (AssignmentRuleViolation) {
            $this->addToAssertionCount(1);
        }
        $this->upload()->assertCreated();
        $this->approve((string) DB::table('tariff_books')->value('id'))->assertOk();
        $own = $svc->resolve($this->ulp->getKey(), 'r-1', 900, '2026-03-01');
        $this->assertEquals(700.5, (float) $own->avg_price);            // the ULP's own row wins over the all-ULP row (605)
        $other = $svc->resolve($this->makeUnit('ULP', $this->up3)->getKey(), 'R1', 900, '2026-03-01');
        $this->assertEquals(605, (float) $other->avg_price);
        $this->assertEquals(130, (float) $svc->resolve($this->ulp->getKey(), 'C', null, '2026-03-01')->jam_nyala);
        // EIS writes the prepaid (token) variant with a trailing T: R1T finds the R1 row, but a code the book lacks (S9T) still never resolves
        $this->assertEquals(700.5, (float) $svc->resolve($this->ulp->getKey(), 'R1T', 900, '2026-03-01')->avg_price);
        foreach ([['R1', 1300, '2026-03-01'], ['R1', 450, '2026-01-01'], ['S9', 450, '2026-03-01'], ['S9T', 450, '2026-03-01']] as [$t, $p, $d]) {
            try {
                $svc->resolve($this->ulp->getKey(), $t, $p, $d);
                $this->fail("{$t} {$p} {$d} must not resolve");
            } catch (AssignmentRuleViolation) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
