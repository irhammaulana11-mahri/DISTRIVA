<?php

namespace Tests\Feature;

use App\Exceptions\AssignmentRuleViolation;
use App\Models\Role;
use App\Models\User;
use App\Services\Prices\PriceBookService;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class PriceBookTest extends PostgresTestCase
{
    private User $engineer;

    private User $manager;

    private User $viewer;

    private User $vendor;

    private $up3;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(MasterDataPermissionSeeder::class);
        $this->up3 = $this->makeUnit('UP3');
        $mk = function (string $role): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $this->up3);

            return $u;
        };
        $this->engineer = $mk('ASMAN_JARINGAN');
        $this->manager = $mk('MANAGER_UP3');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function khs(array $codes, string $from = '2025-01-01'): void
    {
        foreach ($codes as $code) {
            $id = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $id, 'code' => (string) $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => "KHS {$code}", 'unit_text' => 'B', 'valid_from' => $from,
                'status' => 'APPROVED', 'created_by' => $this->engineer->getKey(), 'approved_by' => $this->manager->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function assertDatabaseTriggerBlocks(callable $fn): void
    {
        try {
            DB::transaction($fn);
            $this->fail('The database accepted a change that must be blocked.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    private function csv(string $body): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('harga.csv', $body);
    }

    private const GOOD = "kode,nama,status_material,harga_material,z1_pasang,z1_bongkar,z2_pasang,z2_bongkar\n1,Konduktor,PLN,,2966,1779,3009,1806\n2,Tiang,HARGA,\"1.250.000,50\",1000,500,1100,550\n";

    private function upload(string $body = self::GOOD, array $extra = [], ?User $by = null)
    {
        return $this->as($by ?? $this->engineer)->post('/api/master-data/price-books/import', array_merge(['file' => $this->csv($body), 'name' => 'Kontrak 2026', 'valid_from' => '2026-01-01'], $extra), ['Accept' => 'application/json']);
    }

    private function approve(string $id, ?User $by = null)
    {
        return $this->as($by ?? $this->manager)->postJson('/api/master-data/price-books/approve', ['book_ids' => [$id], 'reason' => 'Sesuai kontrak']);
    }

    private function zone(string $id, int $zone = 2)
    {
        return $this->as($this->engineer)->putJson("/api/master-data/price-books/{$id}/zones", ['up3_unit_id' => $this->up3->getKey(), 'zone' => $zone, 'reason' => 'Zona kontrak']);
    }

    #[Test]
    public function keys_are_granted_to_the_managers_and_the_approver_only(): void
    {
        $this->khs([1, 2]);
        $this->upload(self::GOOD, [], $this->vendor)->assertForbidden();
        $this->upload(self::GOOD, [], $this->viewer)->assertForbidden();
        $this->upload(self::GOOD, [], $this->manager)->assertForbidden();           // the approver does not manage
        $this->upload()->assertCreated();
        $id = (string) DB::table('price_books')->value('id');
        $this->as($this->viewer)->getJson('/api/master-data/price-books')->assertOk()->assertJsonCount(1, 'data');
        $this->as($this->vendor)->getJson('/api/master-data/price-books')->assertForbidden();
        $this->approve($id, $this->engineer)->assertForbidden();
    }

    #[Test]
    public function the_import_reads_material_status_and_zone_prices_and_is_all_or_nothing(): void
    {
        $this->khs([1, 2]);
        $dry = $this->upload(self::GOOD, ['dry_run' => 1])->assertOk();
        $this->assertSame([2, 1], [$dry->json('data.accepted_rows'), $dry->json('data.pln')]);
        $this->assertSame(0, DB::table('price_books')->count());

        $this->upload()->assertCreated()->assertJsonPath('data.priced', 1);
        $book = (string) DB::table('price_books')->value('id');
        $items = collect($this->as($this->viewer)->getJson("/api/master-data/price-books/{$book}/items")->assertOk()->json('data'))->keyBy('khs_code');
        $this->assertSame('PLN', $items['1']['material_status']);
        $this->assertNull($items['1']['material_price']);
        $this->assertEquals(1250000.50, $items['2']['material_price']);                    // Indonesian number format
        $this->assertEquals(1806, $items['1']['service']['2']['remove']);

        $before = DB::table('price_books')->count();
        $bad = "kode,nama,status_material,harga_material,z1_pasang,z1_bongkar\n1,A,PLN,500,10,5\n99,B,HARGA,100,10,5\n2,C,HARGA,,10,5\n2,D,HARGA,5,10,5\n";
        $r = $this->upload($bad, ['dry_run' => 1])->assertOk();
        $this->assertSame(4, $r->json('data.rejected_rows'));
        $msgs = collect($r->json('rows'))->pluck('messages')->flatten()->implode(' | ');
        $this->assertStringContainsString('PLN tidak boleh', $msgs);
        $this->assertStringContainsString('tidak ada di katalog', $msgs);
        $this->assertStringContainsString('lebih dari sekali', $msgs);
        $this->upload($bad)->assertStatus(409);
        $this->assertSame($before, DB::table('price_books')->count());                   // nothing stored
        $this->upload("kode,nama,status_material,harga_material\n1,A,PLN,\n")->assertStatus(409);   // no zone columns
    }

    #[Test]
    public function the_insured_value_is_optional_numeric_and_listed_with_the_items(): void
    {
        $this->khs([1, 2]);
        $csv = "kode,nama,status_material,harga_material,nilai_asuransi,z2_pasang,z2_bongkar\n1,A,PLN,,\"219.570,50\",10,5\n2,B,HARGA,100,,10,5\n";
        $this->upload($csv)->assertCreated();
        $book = (string) DB::table('price_books')->value('id');
        $items = collect($this->as($this->viewer)->getJson("/api/master-data/price-books/{$book}/items")->assertOk()->json('data'))->keyBy('khs_code');
        $this->assertEquals(219570.50, $items['1']['insured_value']);
        $this->assertNull($items['2']['insured_value']);
        $bad = $this->upload("kode,nama,status_material,harga_material,nilai_asuransi,z2_pasang,z2_bongkar\n1,A,PLN,,abc,10,5\n", ['dry_run' => 1])->assertOk();
        $this->assertStringContainsString('nilai_asuransi', $bad->json('rows.0.messages.0'));
    }

    #[Test]
    public function the_insured_value_of_one_item_of_a_draft_book_is_changed_with_a_reason_and_leaves_a_history(): void
    {
        $this->khs([1, 2]);
        $csv = "kode,nama,status_material,harga_material,nilai_asuransi,z2_pasang,z2_bongkar\n1,A,PLN,,\"1.000,00\",10,5\n2,B,HARGA,100,,10,5\n";
        $this->upload($csv)->assertCreated();
        $book = (string) DB::table('price_books')->value('id');
        $url = fn (string $code) => "/api/master-data/price-books/{$book}/items/{$code}/insured";
        $value = fn (string $code) => DB::table('price_book_items as p')->join('khs_items as k', 'k.id', '=', 'p.khs_item_id')->where('k.code', $code)->value('p.insured_value');

        $this->as($this->engineer)->patchJson($url('JTMR1'), ['insured_value' => 2500, 'reason' => 'x'])->assertNotFound();                          // the book has codes 1 and 2 as the test catalogue names them
        $codes = DB::table('khs_items')->orderBy('code')->pluck('code')->all();
        $c1 = $codes[0];
        $this->as($this->viewer)->patchJson($url($c1), ['insured_value' => 2500, 'reason' => 'x'])->assertForbidden();                           // viewer: no prices.manage
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => 2500])->assertUnprocessable();                                      // reason is required
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => -5, 'reason' => 'x'])->assertUnprocessable();
        $this->as($this->engineer)->patchJson($url($c1), ['reason' => 'x'])->assertUnprocessable();                                               // the value must be sent (null clears it)

        $before = (float) $value($c1);
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => 2500.5, 'reason' => 'Selaras Excel revisi'])->assertOk()->assertJsonPath('data.insured_value', 2500.5);
        $this->assertEquals(2500.5, $value($c1));
        $event = DB::table('price_book_events')->where('price_book_id', $book)->where('event_type', 'MDU_SET')->first();
        $this->assertSame('Selaras Excel revisi', $event->reason);
        $this->assertEquals([$before, 2500.5], [json_decode($event->details, true)['before'], json_decode($event->details, true)['after']]);
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => 2500.5, 'reason' => 'sama'])->assertStatus(409);                       // no change is not recorded
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => null, 'reason' => 'dikosongkan'])->assertOk();
        $this->assertNull($value($c1));

        $this->zone($book)->assertOk();
        $this->approve($book)->assertOk();
        $this->as($this->engineer)->patchJson($url($c1), ['insured_value' => 1, 'reason' => 'terlambat'])->assertStatus(409);                       // an approved book is immutable
        $this->assertNull($value($c1));
    }

    #[Test]
    public function a_zone_needs_an_up3_and_a_zone_the_book_has_prices_for(): void
    {
        $this->khs([1, 2]);
        $this->upload()->assertCreated();
        $id = (string) DB::table('price_books')->value('id');
        $this->zone($id, 2)->assertOk();
        $this->zone($id, 3)->assertStatus(409);                                            // no prices for zone 3
        $this->as($this->engineer)->putJson("/api/master-data/price-books/{$id}/zones", ['up3_unit_id' => (string) Str::uuid(), 'zone' => 1, 'reason' => 'x'])->assertStatus(409);
        $this->as($this->engineer)->putJson("/api/master-data/price-books/{$id}/zones", ['up3_unit_id' => $this->up3->getKey(), 'zone' => 1])->assertUnprocessable();   // reason is mandatory
        $this->zone($id, 1)->assertOk();                                                   // changing the zone of a draft is allowed and logged
        $this->assertSame(1, (int) DB::table('price_book_zones')->value('zone'));
        $show = $this->as($this->viewer)->getJson("/api/master-data/price-books/{$id}")->assertOk();
        $this->assertSame([1, 2], $show->json('data.available_zones'));
        $this->assertSame(2, collect($show->json('data.events'))->where('event_type', 'ZONE_SET')->count());
    }

    #[Test]
    public function approval_needs_another_user_a_zone_and_approved_khs_and_then_the_book_is_immutable(): void
    {
        $this->khs([1, 2]);
        $this->upload()->assertCreated();
        $id = (string) DB::table('price_books')->value('id');
        $this->approve($id)->assertStatus(409);                                            // no zone yet
        $this->zone($id)->assertOk();
        $this->as($this->manager)->postJson('/api/master-data/price-books/approve', ['book_ids' => [$id]])->assertUnprocessable();   // reason
        $this->approve($id)->assertOk()->assertJsonPath('data.approved', 1);
        $this->approve($id)->assertStatus(409);                                            // no longer a draft
        $this->zone($id, 1)->assertStatus(409);

        $this->assertDatabaseTriggerBlocks(fn () => DB::table('price_book_items')->where('price_book_id', $id)->update(['material_price' => 1]));
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('price_book_zones')->where('price_book_id', $id)->update(['zone' => 1]));
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('price_books')->where('id', $id)->update(['name' => 'ubah']));
        $this->assertDatabaseTriggerBlocks(fn () => DB::table('price_book_events')->update(['reason' => 'x']));
    }

    #[Test]
    public function a_creator_cannot_approve_and_a_khs_without_an_approved_version_blocks_approval(): void
    {
        $this->khs([1]);
        $this->khs([2], '2027-01-01');                                                      // approved only from 2027, book starts 2026
        $this->upload()->assertCreated();
        $id = (string) DB::table('price_books')->value('id');
        $this->zone($id)->assertOk();
        $this->approve($id)->assertStatus(409)->assertJsonFragment(['message' => '1 kode KHS pada buku harga belum memiliki versi KHS yang disetujui dan berlaku pada 2026-01-01 (contoh: 2).']);
        $this->as($this->engineer)->postJson('/api/master-data/price-books/approve', ['book_ids' => [$id], 'reason' => 'x'])->assertForbidden();   // the creator (403 before any rule)
        $this->upload(self::GOOD, ['valid_from' => '2027-02-01', 'name' => 'Kontrak 2027'])->assertCreated();   // from 2027 both KHS items are approved
        $ok = (string) DB::table('price_books')->where('valid_from', '2027-02-01')->value('id');
        $this->zone($ok)->assertOk();
        $this->approve($ok)->assertOk();
    }

    #[Test]
    public function a_newer_book_closes_the_active_one_and_resolve_returns_the_book_and_zone_of_the_up3(): void
    {
        $this->khs([1, 2]);
        $this->upload()->assertCreated();
        $first = (string) DB::table('price_books')->value('id');
        $this->zone($first, 2)->assertOk();
        $this->approve($first)->assertOk();

        $this->upload(self::GOOD, ['name' => 'Kontrak 2027', 'valid_from' => '2027-01-01'])->assertCreated();
        $second = (string) DB::table('price_books')->where('status', 'DRAFT')->value('id');
        $this->zone($second, 1)->assertOk();                                                // a new contract may use another zone
        $this->approve($second)->assertOk()->assertJsonPath('data.auto_closed', 1);
        $this->assertSame('2026-12-31', DB::table('price_books')->where('id', $first)->value('valid_until'));

        $svc = app(PriceBookService::class);
        $a = $svc->resolve($this->up3->getKey(), '2026-06-01');
        $this->assertSame([$first, 2], [$a['book']->id, $a['zone']]);
        $b = $svc->resolve($this->up3->getKey(), '2027-03-01');
        $this->assertSame([$second, 1], [$b['book']->id, $b['zone']]);
        $this->expectException(AssignmentRuleViolation::class);
        $svc->resolve($this->up3->getKey(), '2025-06-01');                                  // before any book: never a guess
    }

    #[Test]
    public function retiring_an_approved_book_needs_the_approve_key_and_a_reason(): void
    {
        $this->khs([1, 2]);
        $this->upload()->assertCreated();
        $id = (string) DB::table('price_books')->value('id');
        $this->zone($id)->assertOk();
        $this->approve($id)->assertOk();
        $this->as($this->engineer)->postJson("/api/master-data/price-books/{$id}/retire", ['reason' => 'x'])->assertForbidden();
        $this->as($this->manager)->postJson("/api/master-data/price-books/{$id}/retire", [])->assertUnprocessable();
        $this->as($this->manager)->postJson("/api/master-data/price-books/{$id}/retire", ['reason' => 'Kontrak berakhir'])->assertOk();
        $this->assertSame('INACTIVE', DB::table('price_books')->where('id', $id)->value('status'));
        $this->expectException(AssignmentRuleViolation::class);
        app(PriceBookService::class)->resolve($this->up3->getKey(), '2026-06-01');
    }
}
