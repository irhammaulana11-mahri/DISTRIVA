<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\Inventory\MimsIssueSyncService;
use App\Services\Inventory\MimsReceiptSyncService;
use App\Services\Inventory\MimsStockSyncService;
use Database\Seeders\MasterDataPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class InventoryTest extends PostgresTestCase
{
    private User $perencanaan;

    private User $konstruksi;

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
        $this->perencanaan = $mk('PERENCANAAN');
        $this->konstruksi = $mk('KONSTRUKSI_UP3');
        $this->viewer = $mk('TEKNIK');
        $this->vendor = $mk('VENDOR');
        foreach ([1, 2, 3] as $code) {
            $id = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $id, 'code' => (string) $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($u->createToken('t')->plainTextToken);
    }

    private function warehouse(): string
    {
        return $this->as($this->konstruksi)->postJson('/api/master-data/warehouses', ['code' => 'gd-1', 'name' => 'Gudang 1', 'organizational_unit_id' => $this->up3->getKey()])->assertCreated()->json('data.id');
    }

    private function upload(string $wh, string $body, array $extra = [], ?User $by = null)
    {
        return $this->as($by ?? $this->konstruksi)->post("/api/master-data/warehouses/{$wh}/stock-snapshots", array_merge(['file' => UploadedFile::fake()->createWithContent('stok.csv', $body), 'as_of' => '2026-11-01'], $extra), ['Accept' => 'application/json']);
    }

    #[Test]
    public function warehouses_and_stock_import_belong_to_the_konstruksi_gudang_role_and_the_kr_to_perencanaan(): void
    {
        $this->as($this->perencanaan)->postJson('/api/master-data/warehouses', ['code' => 'X', 'name' => 'X', 'organizational_unit_id' => $this->up3->getKey()])->assertForbidden();   // poles are Perencanaan's, stock is Konstruksi's
        $this->as($this->konstruksi)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-1', 'qty_tm' => 1, 'qty_tr' => 1])->assertForbidden();
        $this->as($this->vendor)->postJson('/api/master-data/warehouses', ['code' => 'X', 'name' => 'X', 'organizational_unit_id' => $this->up3->getKey()])->assertForbidden();
        $this->as($this->viewer)->postJson('/api/master-data/warehouses', ['code' => 'X', 'name' => 'X', 'organizational_unit_id' => $this->up3->getKey()])->assertForbidden();
        $wh = $this->warehouse();
        $this->as($this->konstruksi)->postJson('/api/master-data/warehouses', ['code' => 'GD-1', 'name' => 'Dobel', 'organizational_unit_id' => $this->up3->getKey()])->assertStatus(409);   // codes are upper-cased and unique
        $this->as($this->viewer)->getJson('/api/master-data/warehouses')->assertOk()->assertJsonPath('data.0.code', 'GD-1');
        $this->as($this->vendor)->getJson('/api/master-data/warehouses')->assertForbidden();
        $this->upload($wh, "kode_khs,stok\n1,5\n", [], $this->viewer)->assertForbidden();
        $this->upload($wh, "kode_khs,stok\n1,5\n", [], $this->perencanaan)->assertForbidden();
    }

    #[Test]
    public function a_stock_snapshot_is_all_or_nothing_dated_and_immutable(): void
    {
        $wh = $this->warehouse();
        $good = "kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman\n1,10,2,5,3\n2,\"1.250,5\",0,0,0\n";
        $this->upload($wh, $good, ['dry_run' => 1])->assertOk()->assertJsonPath('data.accepted', 2);
        $this->assertSame(0, DB::table('stock_snapshots')->count());
        $this->upload($wh, $good)->assertCreated();
        $this->assertSame(2, DB::table('stock_snapshot_lines')->count());
        $this->assertEquals(1250.5, DB::table('stock_snapshot_lines')->orderByDesc('on_hand')->value('on_hand'));
        $this->upload($wh, $good)->assertStatus(409);                                         // same date again: stock is history
        $this->upload($wh, "kode_khs,stok\n1,5\n77,3\n", ['as_of' => '2026-11-02'])->assertStatus(409);   // unknown KHS code: nothing is stored
        $this->upload($wh, "kode_khs,stok\n1,-5\n", ['as_of' => '2026-11-02'])->assertStatus(409);
        $this->upload($wh, "kode_khs,stok\n1,5\n1,6\n", ['as_of' => '2026-11-02'])->assertStatus(409);
        $this->upload($wh, $good, ['as_of' => '2999-01-01'])->assertUnprocessable();            // not in the future
        $this->assertSame(1, DB::table('stock_snapshots')->count());
        try {
            DB::transaction(fn () => DB::table('stock_snapshot_lines')->update(['on_hand' => 0]));
            $this->fail('snapshot lines must be immutable');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->as($this->viewer)->getJson("/api/master-data/warehouses/{$wh}/stock-snapshots")->assertOk()->assertJsonPath('data.0.lines', 2);
        $snap = (string) DB::table('stock_snapshots')->value('id');
        $this->as($this->viewer)->getJson("/api/master-data/stock-snapshots/{$snap}")->assertOk()->assertJsonCount(2, 'data.lines');
        $pos = $this->as($this->viewer)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}&date=2026-11-05")->assertOk()->json('data');
        $this->assertEquals(8, $pos[0]['available']);                                         // 10 on hand - 2 reserved
        $this->assertEquals(3, $pos[0]['safety']);
        $this->as($this->viewer)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}&date=2026-10-01")->assertOk()->assertJsonCount(0, 'data');   // before the first snapshot
    }

    #[Test]
    public function pole_contracts_count_tm_and_tr_poles_per_kr_and_cannot_drop_below_what_is_allocated(): void
    {
        $this->as($this->viewer)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-9', 'qty_tm' => 1, 'qty_tr' => 1])->assertForbidden();
        $id = $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-9', 'qty_tm' => 10, 'qty_tr' => 4])->assertCreated()->json('data.id');
        $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-9', 'qty_tm' => 1, 'qty_tr' => 1])->assertStatus(409);
        $this->as($this->perencanaan)->postJson('/api/master-data/pole-contracts', ['kr_number' => 'KR-8', 'qty_tm' => -1, 'qty_tr' => 1])->assertUnprocessable();
        $this->as($this->perencanaan)->putJson("/api/master-data/pole-contracts/{$id}", ['qty_tm' => 12])->assertUnprocessable();   // a reason is required
        $this->as($this->perencanaan)->putJson("/api/master-data/pole-contracts/{$id}", ['qty_tm' => 12, 'reason' => 'Addendum kontrak'])->assertOk();
        $row = $this->as($this->viewer)->getJson("/api/master-data/pole-contracts/{$id}")->assertOk()->json('data');
        $this->assertSame(12, $row['tm']['total']);
        $this->assertEqualsCanonicalizing(['CREATED', 'UPDATED'], array_column($row['events'], 'event_type'));
        $this->as($this->perencanaan)->postJson("/api/master-data/pole-contracts/{$id}/close", ['reason' => 'Selesai'])->assertOk();
        $this->as($this->perencanaan)->putJson("/api/master-data/pole-contracts/{$id}", ['qty_tm' => 20, 'reason' => 'x'])->assertStatus(409);   // closed
    }

    private function erpXlsx(array $rows, array $header = ['No', 'Gudang', 'No Material', 'Nama Material', 'Valuation Type', 'Satuan', 'Stock Siap', 'Stock Fisik Unit', 'Stock Reservasi', 'Stock In Transit', 'Stock Minimum']): UploadedFile
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet();
        foreach ($header as $i => $h) {
            $sheet->setCellValue([$i + 1, 1], $h);
        }
        foreach ($rows as $r => $row) {
            foreach ($row as $i => $v) {
                $sheet->setCellValueExplicit([$i + 1, $r + 2], $v, is_numeric($v) && ! in_array($i, [2], true) ? DataType::TYPE_NUMERIC : DataType::TYPE_STRING);
            }
        }
        $stream = fopen('php://temp', 'w+b');
        (new Xlsx($book))->save($stream);
        rewind($stream);

        return UploadedFile::fake()->createWithContent('Monitoring_Stock_07-11-2026.xlsx', (string) stream_get_contents($stream));
    }

    #[Test]
    public function the_erp_monitoring_stock_file_is_kept_by_sku_and_summed_into_khs_through_the_mapping(): void
    {
        $wh = $this->warehouse();
        $map = fn (string $body, array $extra = [], ?User $by = null) => $this->as($by ?? $this->perencanaan)->post('/api/master-data/khs-material-map/import', array_merge(['file' => UploadedFile::fake()->createWithContent('map.csv', $body)], $extra), ['Accept' => 'application/json']);
        $map("kode_khs,no_material\n1,000000000003110025\n", [], $this->konstruksi)->assertForbidden();                    // mapping KHS <-> SKU is master-data work (khs.manage)
        $map("kode_khs,no_material\n1,000000000003110025\n1,3110026\n2,000000000002190224\n", ['dry_run' => 1])->assertOk()->assertJsonPath('data.new', 3);
        $this->assertSame(0, DB::table('khs_material_map')->count());
        $map("kode_khs,no_material\n1,000000000003110025\n1,3110026\n2,000000000002190224\n")->assertCreated();
        $this->assertSame(3, DB::table('khs_material_map')->count());
        $map("kode_khs,no_material\n1,3110025\n")->assertCreated()->assertJsonPath('data.unchanged', 1);                      // the same pair again is harmless
        $map("kode_khs,no_material\n2,000000000003110025\n")->assertStatus(409);                                              // a mapped SKU cannot point to another KHS
        $map("kode_khs,no_material\n77,5\n")->assertStatus(409);                                                              // unknown KHS code
        $this->as($this->viewer)->getJson('/api/master-data/khs-material-map?search=3110026')->assertOk()->assertJsonCount(1, 'data');

        $row = fn (string $sku, string $name, float $ready, float $res = 0, float $transit = 0, float $min = 0) => [1, 'Gd Ry Jombang', $sku, $name, 'NORMAL', 'BH', $ready, $ready, $res, $transit, $min];
        $file = $this->erpXlsx([$row('000000000003110025', 'CABLE PWR;NFA2X;2X10mm2', 100, 10, 5, 8), $row('000000000003110026', 'CABLE PWR;NFA2X;2X16mm2', 20), $row('000000000002190224', 'MTR;kWH E-PR', 7), $row('000000000009999999', 'ITEM TANPA KHS', 3)]);
        $this->as($this->konstruksi)->post("/api/master-data/warehouses/{$wh}/stock-snapshots", ['file' => $file, 'as_of' => '2026-11-07', 'dry_run' => 1], ['Accept' => 'application/json'])->assertOk()
            ->assertJsonPath('data.mapped', 3)->assertJsonPath('data.unmapped', 1)->assertJsonPath('data.khs_lines', 2)->assertJsonPath('data.warehouse_label', 'Gd Ry Jombang');
        $this->assertSame(0, DB::table('stock_snapshots')->count());
        $res = $this->as($this->konstruksi)->post("/api/master-data/warehouses/{$wh}/stock-snapshots", ['file' => $this->erpXlsx([$row('000000000003110025', 'CABLE PWR;NFA2X;2X10mm2', 100, 10, 5, 8), $row('000000000003110026', 'CABLE PWR;NFA2X;2X16mm2', 20), $row('000000000002190224', 'MTR;kWH E-PR', 7), $row('000000000009999999', 'ITEM TANPA KHS', 3)]), 'as_of' => '2026-11-07'], ['Accept' => 'application/json'])->assertCreated();
        $snap = $res->json('data.snapshot_id');
        $this->assertSame(4, DB::table('stock_snapshot_materials')->where('snapshot_id', $snap)->count());                       // every SKU row is kept as received
        $this->assertSame(2, DB::table('stock_snapshot_lines')->where('snapshot_id', $snap)->count());                           // KHS level: SKUs of the same KHS are summed
        $pos = collect($this->as($this->viewer)->getJson("/api/master-data/stock-position?warehouse_ids[]={$wh}&date=2026-11-07")->assertOk()->json('data'))->keyBy('khs_code');
        $this->assertEquals(130, $pos['1']['on_hand']);                                                                          // (100 Siap + 10 Reservasi) + 20 Siap: Stock Siap excludes the reserved material
        $this->assertEquals(10, $pos['1']['reserved']);
        $this->assertEquals(5, $pos['1']['incoming']);                                                                           // Stock In Transit
        $this->assertEquals(8, $pos['1']['safety']);                                                                             // Stock Minimum
        $this->assertEquals(120, $pos['1']['available']);                                                                        // on hand - reserved = the Stock Siap (100 + 20)
        $this->assertEquals(7, $pos['2']['on_hand']);
        $un = $this->as($this->viewer)->getJson("/api/master-data/stock-snapshots/{$snap}/unmapped")->assertOk()->json();
        $this->assertSame(['9999999'], array_map(fn ($m) => ltrim($m['material_no'], '0'), $un['data']));
        $this->as($this->viewer)->getJson("/api/master-data/warehouses/{$wh}/stock-snapshots")->assertOk()->assertJsonPath('data.0.materials_total', 4)->assertJsonPath('data.0.materials_mapped', 3);

        // malformed files cancel everything
        $bad = fn (array $rows, array $header = ['No', 'Gudang', 'No Material', 'Nama Material', 'Valuation Type', 'Satuan', 'Stock Siap', 'Stock Fisik Unit', 'Stock Reservasi', 'Stock In Transit', 'Stock Minimum']) => $this->as($this->konstruksi)
            ->post("/api/master-data/warehouses/{$wh}/stock-snapshots", ['file' => $this->erpXlsx($rows, $header), 'as_of' => '2026-11-05'], ['Accept' => 'application/json']);
        $bad([$row('000000000003110025', 'A', -5)])->assertStatus(409);
        $bad([$row('000000000003110025', 'A', 5), $row('3110025', 'A', 6)])->assertStatus(409);                                  // the same SKU twice (zeros ignored)
        $bad([$row('000000000003110025', 'A', 5)], ['No', 'Gudang', 'Kode', 'Nama'])->assertStatus(409);                          // not an ERP monitoring file
        $this->assertSame(1, DB::table('stock_snapshots')->count());
    }

    #[Test]
    public function the_erp_list_of_storage_locations_becomes_warehouses_linked_to_the_units_by_code(): void
    {
        $this->up3->forceFill(['code' => '51MJK'])->save();
        $jombang = $this->makeUnit('ULP', $this->up3);
        $jombang->forceFill(['code' => '51453'])->save();
        $payload = ['gudang' => ['data' => [
            ['plant' => '5118', 'stor_loc' => '2080', 'stor_loc_name' => 'PLN Area Mojokerto', 'unit' => '51MJK', 'jenis' => 'GI'],
            ['plant' => '5118', 'stor_loc' => '2810', 'stor_loc_name' => 'Gd Ry Jombang', 'unit' => '51453', 'jenis' => 'GO'],
        ], 'msg' => '1']];
        $import = fn (array $body, ?User $by = null) => $this->as($by ?? $this->konstruksi)->postJson('/api/master-data/warehouses/import', $body);

        $import($payload, $this->perencanaan)->assertForbidden();                                                // warehouses are the Konstruksi/Gudang side
        $import($payload + ['dry_run' => 1])->assertOk()->assertJsonPath('data.new', 2);
        $this->assertSame(0, DB::table('warehouses')->count());
        $import($payload)->assertCreated()->assertJsonPath('data.new', 2);
        $row = collect($this->as($this->viewer)->getJson('/api/master-data/warehouses')->assertOk()->json('data'))->firstWhere('stor_loc', '2810');
        $this->assertSame('Gd Ry Jombang', $row['name']);
        $this->assertSame('GO', $row['kind']);
        $this->assertSame('5118-2810', $row['code']);
        $this->assertSame($jombang->getKey(), $row['unit']['id']);                                                  // linked to the ULP whose code is the ERP unit code
        $payload['gudang']['data'][1]['stor_loc_name'] = 'Gd Ry Jombang (baru)';
        $import($payload)->assertCreated()->assertJsonPath('data.updated', 2);                                      // repeatable: identified by plant + storage location
        $this->assertSame(2, DB::table('warehouses')->count());
        $this->assertSame('Gd Ry Jombang (baru)', DB::table('warehouses')->where('stor_loc', '2810')->value('name'));
        $payload['gudang']['data'][] = ['plant' => '5118', 'stor_loc' => '2999', 'stor_loc_name' => 'Gd Tidak Dikenal', 'unit' => '99999', 'jenis' => 'GO'];
        $import($payload)->assertStatus(409);                                                                       // an unknown unit cancels everything
        $this->assertSame(2, DB::table('warehouses')->count());
        $import(['gudang' => ['data' => [['plant' => '5118', 'stor_loc' => '2810', 'stor_loc_name' => 'X', 'unit' => '51453', 'jenis' => 'ZZ']]]])->assertUnprocessable();
    }

    #[Test]
    public function the_mapping_workbench_lists_khs_items_to_map_suggests_candidates_and_reports_the_coverage(): void
    {
        $khs = DB::table('khs_items')->where('code', '3')->value('id');
        DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $khs, 'version_number' => 1, 'name' => 'Plastic Strap', 'unit_text' => 'B', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
            'created_by' => $this->perencanaan->getKey(), 'approved_by' => $this->konstruksi->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ([['000000000004190081', 'UNIV ACC;PLASTIC STRAP 200mm', 'BH'], ['000000000003250056', 'MCB;230/400V;1P;20A;50Hz;', 'BH']] as [$code, $name, $unit]) {
            DB::table('materials')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'name' => $name, 'unit' => $unit, 'created_at' => now(), 'updated_at' => now()]);
        }
        $wb = fn (string $q = '') => $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/workbench'.$q)->assertOk();

        $this->as($this->vendor)->getJson('/api/master-data/khs-material-map/workbench')->assertForbidden();
        $this->assertContains('3', array_column($wb()->json('data'), 'khs_code'));                                  // unmapped by default
        $sug = $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/suggestions?khs_code=3')->assertOk()->json('data');
        $this->assertSame('000000000004190081', $sug[0]['material_no']);                                            // shares "plastic strap" and the unit
        $this->assertSame('KATALOG_ERP', $sug[0]['source']);
        $this->assertNotContains('000000000003250056', array_column($sug, 'material_no'));                         // no shared words: not offered
        $this->as($this->viewer)->postJson('/api/master-data/khs-material-map', ['khs_code' => '3', 'material_no' => '4190081'])->assertForbidden();
        $this->as($this->perencanaan)->postJson('/api/master-data/khs-material-map', ['khs_code' => '3', 'material_no' => '000000000004190081', 'note' => 'dipilih dari saran'])->assertCreated();
        $this->as($this->perencanaan)->postJson('/api/master-data/khs-material-map', ['khs_code' => '3', 'material_no' => '4190081'])->assertStatus(409);        // already mapped
        $this->as($this->perencanaan)->postJson('/api/master-data/khs-material-map', ['khs_code' => '1', 'material_no' => '4190081'])->assertStatus(409);        // to another KHS
        $this->assertNotContains('3', array_column($wb()->json('data'), 'khs_code'));
        $mapped = collect($wb('?filter=mapped')->json('data'))->firstWhere('khs_code', '3');
        $this->assertSame('4190081', $mapped['mapped'][0]['material_no']);
        $this->assertSame('Plastic Strap', $mapped['name']);
        $this->assertSame([], $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/suggestions?khs_code=3')->json('data'));   // a mapped SKU is no longer offered
        $cov = $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/coverage')->assertOk()->json('data');
        $this->assertSame(0, $cov['khs_used_total']);                                                                // no approved BOM in this fixture

        // supply filter: only material the price book in force marks PLN needs an ERP SKU
        $this->assertEquals([0, 0, 0], [$cov['sku_needed_total'], $cov['sku_needed_mapped'], $cov['sku_needed_percent']]);
        $book = (string) Str::uuid();
        DB::table('price_books')->insert(['id' => $book, 'name' => 'Kontrak uji', 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        $one = DB::table('khs_items')->where('code', '1')->value('id');
        $two = DB::table('khs_items')->where('code', '2')->value('id');
        DB::table('price_book_items')->insert([
            ['id' => (string) Str::uuid(), 'price_book_id' => $book, 'khs_item_id' => $one, 'material_status' => 'PLN', 'material_price' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => (string) Str::uuid(), 'price_book_id' => $book, 'khs_item_id' => $two, 'material_status' => 'PRICED', 'material_price' => 1000, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('price_books')->where('id', $book)->update(['status' => 'APPROVED', 'approved_by' => $this->konstruksi->getKey(), 'approved_at' => now()]);   // items are immutable once approved
        $all = collect($wb()->json('data'));
        $this->assertSame('PLN', $all->firstWhere('khs_code', '1')['material_status']);
        $this->assertSame('PRICED', $all->firstWhere('khs_code', '2')['material_status']);
        $this->assertSame(['1'], array_column($wb('?supply=pln')->json('data'), 'khs_code'));                         // PRICED and un-booked items drop out
        $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/workbench?supply=semua')->assertUnprocessable();
        $this->assertSame([], $cov['latest_snapshots']);
    }

    #[Test]
    public function the_mims_issue_mirror_fetches_new_documents_once_ties_lines_to_the_reservation_and_never_stores_the_token(): void
    {
        $secret = 'rahasia-token-pengeluaran';
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-issue.test']);
        $today = now(config('distriva.business_timezone'))->format('d-m-Y');
        $header = fn (string $doc, string $res, string $date) => ['material_document' => $doc, 'no_pemesanan' => $res, 'tgl_pengeluaran' => $date, 'mat_doc_sap' => '4933740853', 'reservasi_sap' => '0020844046', 'jenis_pekerjaan' => '14', 'nama_jenis_pekerjaan' => 'PERUBAHAN DAYA', 'id_pel' => '514532044168', 'wbs' => 'I.5118.26', 'text' => 'x', 'asal_wo' => 'AP2T'];
        Http::fake([
            'mims-issue.test/*getDataPengeluaranHeader*' => Http::response(['data' => [$header('5145326111', '514532611125828', $today), $header('5145326222', '514532611199999', '01-01-2020'), $header('', 'x', $today)], 'msg' => '1']),
            'mims-issue.test/*getDataPengeluaranAll/514532611125828*' => Http::response(['detail' => ['data' => [
                ['material_no' => '000000000003250050', 'nama_material' => 'MCB', 'jumlah' => '4', 'satuan' => 'BH'], ['material_no' => '000000000002190224', 'nama_material' => 'METER', 'jumlah' => '6', 'satuan' => 'BH'], ['material_no' => '000000000009', 'jumlah' => '0']]], 'header' => ['data' => []]]),
            'mims-issue.test/*getDataReservasiMapping/514532611125828*' => Http::response(['data' => [['nomor_reservasi' => '514532611125828', 'no_agenda' => '514530522610198789', 'nama' => 'JANGAN DISIMPAN', 'alamat' => 'JANGAN DISIMPAN', 'daya' => '900', 'tgl_bayar' => '02-11-2026', 'id_pelanggan' => '514530040526']]]),
        ]);
        $svc = app(MimsIssueSyncService::class);
        $row = DB::table('warehouses')->where('id', $wh)->first();

        $r = $svc->syncWarehouse($row, $secret, $this->konstruksi);
        $this->assertSame(['OK', 1, 2, 0], [$r['status'], $r['documents_new'], $r['lines'], $r['matched']]);          // the 2020 document is outside the window, the blank one is skipped
        Http::assertSent(fn ($q) => $q->method() === 'POST' && $q->hasHeader('auth-token', $secret) && $q['plant'] === '5118' && $q['stor_loc'] === '2810' && $q['status_sap'] === 'S'
            && $q['tanggal'] === now(config('distriva.business_timezone'))->subDays(90)->format('d-m-Y') && $q['tanggal_akhir'] === now(config('distriva.business_timezone'))->format('d-m-Y'));
        $this->assertSame(['3250050', '2190224'], DB::table('mims_issue_lines')->where('reservation_no', '514532611125828')->pluck('material_no')->all());
        $this->assertSame(1, DB::table('mims_issue_customers')->count());
        $this->assertStringNotContainsString('JANGAN DISIMPAN', json_encode(DB::table('mims_issue_customers')->get()));   // no name or address
        $r = $svc->syncWarehouse($row, $secret, $this->konstruksi);                                                      // known documents are not fetched again
        $this->assertSame([0, 0], [$r['documents_new'], $r['lines']]);
        $this->assertSame(2, DB::table('mims_issue_lines')->count());
        $this->assertStringNotContainsString($secret, json_encode(DB::table('mims_issue_sync_runs')->get()));

        Http::fake(['mims-issue-expired.test/*' => Http::response([], 401)]);
        config(['distriva.mims.base_url' => 'https://mims-issue-expired.test']);
        $r = $svc->syncWarehouse($row, $secret, $this->konstruksi);
        $this->assertSame('FAILED', $r['status']);
        $this->assertStringContainsString('token ditolak', $r['message']);
    }

    #[Test]
    public function the_mims_receipt_mirror_keeps_received_deliveries_with_their_lines_and_picks_up_pending_ones_when_received(): void
    {
        $secret = 'rahasia-token-penerimaan';
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-receipt.test']);
        $today = now(config('distriva.business_timezone'))->format('d-m-Y');
        $head = fn (string $doc, string $status, ?string $date = null) => ['material_document' => $doc, 'stor_loc_asal' => '2080', 'stor_loc_asal_name' => 'PLN Area Mojokerto', 'material_document_permintaan' => '514532611113105', 'material_document_penerimaan' => $status === 'DITERIMA' ? '514532611125697' : null,
            'tgl_pengiriman' => $date ?? $today, 'status_penerimaan' => $status, 'mat_doc_sap' => '4933722307'];
        $detail = ['Detail' => ['data' => [['material_no' => '000000000003110025', 'material_desc' => 'CABLE', 'satuan' => 'M', 'qty_pengiriman' => '6000', 'qty_penerimaan' => '5990'], ['material_no' => '000000000003250058', 'material_desc' => 'MCB', 'satuan' => 'BH', 'qty_pengiriman' => '15', 'qty_penerimaan' => '15']]],
            'Header' => ['data' => [['material_document' => '514532611125697', 'tgl_penerimaan' => $today]]]];
        Http::fake([
            'mims-receipt.test/*getDataPengirimanForPenerimaan/5118&&2810*' => Http::sequence()
                ->push(['data' => [$head('51MJK0001', 'DITERIMA'), $head('51MJK0002', 'BELUM'), $head('51MJK0003', 'DITERIMA', '01-01-2020')], 'msg' => '1'])
                ->push(['data' => [$head('51MJK0001', 'DITERIMA'), $head('51MJK0002', 'DITERIMA')], 'msg' => '1']),
            'mims-receipt.test/*getDataPenerimaanAll/*' => Http::response($detail),
        ]);
        $svc = app(MimsReceiptSyncService::class);
        $row = DB::table('warehouses')->where('id', $wh)->first();

        $r = $svc->syncWarehouse($row, $secret, $this->konstruksi);
        $this->assertSame(['OK', 2, 2], [$r['status'], $r['documents_new'], $r['lines']]);                                // the 2020 delivery is outside the window; the pending one has no lines yet
        Http::assertSent(fn ($q) => $q->method() === 'GET' && $q->hasHeader('auth-token', $secret) && str_contains($q->url(), '/getDataPengirimanForPenerimaan/5118&&2810&'.now(config('distriva.business_timezone'))->subDays(90)->format('d-m-Y').'&'.now(config('distriva.business_timezone'))->format('d-m-Y').'&&S&&/'));
        $one = DB::table('mims_receipt_documents')->where('delivery_document', '51MJK0001')->first();
        $this->assertSame('DITERIMA', $one->status);
        $this->assertSame('2080', $one->origin_stor_loc);
        $this->assertEquals([5990.0, 6000.0], [(float) DB::table('mims_receipt_lines')->where('material_no', '3110025')->value('quantity_received'), (float) DB::table('mims_receipt_lines')->where('material_no', '3110025')->value('quantity_sent')]);
        $this->assertSame('BELUM', DB::table('mims_receipt_documents')->where('delivery_document', '51MJK0002')->value('status'));
        $this->assertSame(0, DB::table('mims_receipt_lines')->where('delivery_document', '51MJK0002')->count());

        $r = $svc->syncWarehouse($row, $secret, $this->konstruksi);                                                       // the pending one is now received: its lines arrive, nothing is duplicated
        $this->assertSame(['OK', 0, 2], [$r['status'], $r['documents_new'], $r['lines']]);
        $this->assertSame(2, DB::table('mims_receipt_documents')->count());
        $this->assertSame(4, DB::table('mims_receipt_lines')->count());
        $this->assertStringNotContainsString($secret, json_encode(DB::table('mims_receipt_sync_runs')->get()));

        Http::fake(['mims-receipt-expired.test/*' => Http::response([], 403)]);
        config(['distriva.mims.base_url' => 'https://mims-receipt-expired.test']);
        $this->assertStringContainsString('token ditolak', $svc->syncWarehouse($row, $secret, $this->konstruksi)['message']);
    }

    #[Test]
    public function an_unreachable_mims_is_explained_without_secrets_and_certificate_checking_follows_the_setting(): void
    {
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $row = DB::table('warehouses')->where('id', $wh)->first();
        config(['distriva.mims.base_url' => 'https://mims-down.test']);
        Http::fake(fn () => throw new ConnectionException('cURL error 60: SSL certificate OpenSSL verify result: certificate has expired (10) for https://mims-down.test'));

        foreach ([app(MimsIssueSyncService::class), app(MimsReceiptSyncService::class)] as $svc) {
            $r = $svc->syncWarehouse($row, 'rahasia-token-x', $this->konstruksi);
            $this->assertSame('FAILED', $r['status']);
            $this->assertStringContainsString('sertifikat SSL', $r['message']);
            $this->assertStringNotContainsString('rahasia-token-x', $r['message']);
        }
        $this->assertStringContainsString('nama server tidak dikenali', MimsStockSyncService::connectionMessage(new \RuntimeException('cURL error 6: Could not resolve host: x')));

    }

    #[Test]
    public function mims_endpoints_that_refuse_get_are_retried_as_post_and_one_bad_reservation_does_not_stop_the_rest(): void
    {
        DB::table('warehouses')->insert(['id' => $wh = (string) Str::uuid(), 'code' => '5118-2850', 'name' => 'Gd Ry Pacet', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2850', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-405.test']);
        Http::fake(function ($request) {
            $url = $request->url();
            if (str_contains($url, 'getDataPengeluaranHeader')) {
                return Http::response(['data' => [['material_document' => 'D1', 'no_pemesanan' => 'R-POST', 'tgl_pengeluaran' => now(config('distriva.business_timezone'))->format('d-m-Y')], ['material_document' => 'D2', 'no_pemesanan' => 'R-BAD', 'tgl_pengeluaran' => now(config('distriva.business_timezone'))->format('d-m-Y')]]]);
            }
            if (str_contains($url, 'R-BAD')) {
                return Http::response('boom', 500);
            }
            if ($request->method() === 'GET') {
                return Http::response('Method Not Allowed', 405);                                                       // only POST works for this reservation
            }

            return str_contains($url, 'getDataPengeluaranAll') ? Http::response(['detail' => ['data' => [['material_no' => '0003250050', 'jumlah' => '2', 'satuan' => 'BH']]]]) : Http::response(['data' => []]);
        });

        $r = app(MimsIssueSyncService::class)->syncWarehouse(DB::table('warehouses')->where('id', $wh)->first(), 'token-uji-123456', $this->konstruksi);
        $this->assertSame(['OK', 1, 1], [$r['status'], $r['documents_new'], $r['lines']]);                              // the POST retry worked; the 500 reservation was skipped
        $this->assertStringContainsString('1 reservasi dilewati', $r['message']);
        $this->assertStringContainsString('R-BAD', $r['message']);
        $r = app(MimsIssueSyncService::class)->syncWarehouse(DB::table('warehouses')->where('id', $wh)->first(), 'token-uji-123456', $this->konstruksi);
        $this->assertSame(0, $r['documents_new']);                                                                       // the good one is known; the bad one fails again
    }

    #[Test]
    public function a_pull_run_collects_the_results_per_warehouse_without_keeping_the_token_and_only_one_runs_at_a_time(): void
    {
        $secret = 'rahasia-token-run-123';
        foreach ([['2810', 'Jombang'], ['2850', 'Pacet']] as [$loc, $name]) {
            DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => '5118-'.$loc, 'name' => 'Gd Ry '.$name, 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => $loc, 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        config(['distriva.mims.base_url' => 'https://mims-run.test', 'distriva.mims.run_inline' => true]);
        Http::fake(['mims-run.test/*getDataPengeluaranHeader*' => Http::response(['data' => []]), 'mims-run.test/*' => Http::response(['data' => []])]);

        $res = $this->as($this->konstruksi)->postJson('/api/master-data/stock-sync/runs', ['token' => $secret, 'sync_stock' => false, 'sync_issues' => true, 'save_token' => true])->assertStatus(202);
        $id = $res->json('data.id');
        $run = $this->as($this->konstruksi)->getJson("/api/master-data/stock-sync/runs/{$id}")->assertOk()->json('data');
        $this->assertSame('OK', $run['status']);
        $this->assertSame(2, $run['warehouses_total']);
        $this->assertSame(['OK', 'OK'], array_column(array_column($run['results'], 'issues'), 'status'));
        $this->assertStringNotContainsString($secret, json_encode(DB::table('mims_pull_runs')->get()));                // the token is not kept in the run
        Http::assertSent(fn ($q) => $q->hasHeader('auth-token', $secret));
        $this->assertTrue(DB::table('user_mims_tokens')->where('user_id', $this->konstruksi->getKey())->exists());       // only because the user ticked "save"

        $this->as($this->konstruksi)->postJson('/api/master-data/stock-sync/runs', ['use_saved_token' => true, 'sync_stock' => false, 'sync_receipts' => true])->assertStatus(202)->assertJsonPath('data.status', 'OK');   // the saved token works with no token in the request
        DB::table('mims_pull_runs')->insert(['id' => (string) Str::uuid(), 'status' => 'RUNNING', 'options' => '{}', 'started_by' => $this->konstruksi->getKey(), 'created_at' => now()]);
        $this->as($this->konstruksi)->postJson('/api/master-data/stock-sync/runs', ['token' => $secret, 'sync_issues' => true])->assertStatus(409);   // one at a time
        $this->as($this->viewer)->postJson('/api/master-data/stock-sync/runs', ['token' => $secret])->assertForbidden();
        $this->as($this->konstruksi)->getJson('/api/master-data/stock-sync/runs/'.Str::uuid())->assertNotFound();
    }

    #[Test]
    public function the_manual_pull_lets_the_user_choose_stock_issues_and_receipts(): void
    {
        DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-choice.test']);
        Http::fake([
            'mims-choice.test/*getMonitoringStock*' => Http::response(['data' => []]),
            'mims-choice.test/*getDataPengeluaranHeader*' => Http::response(['data' => []]),
            'mims-choice.test/*getDataPengirimanForPenerimaan*' => Http::response(['data' => []]),
        ]);
        $pull = fn (array $b) => $this->as($this->konstruksi)->postJson('/api/master-data/stock-sync', ['token' => 'token-uji-123456'] + $b);
        $called = fn (string $part) => Http::recorded(fn ($q) => str_contains($q->url(), $part))->count();

        $pull(['sync_stock' => false, 'sync_issues' => true, 'sync_receipts' => false])->assertOk()->assertJsonPath('data.0.issues.status', 'OK')->assertJsonMissingPath('data.0.receipts');
        $this->assertSame([0, 1, 0], [$called('getMonitoringStock'), $called('getDataPengeluaranHeader'), $called('getDataPengirimanForPenerimaan')]);
        $pull(['sync_stock' => false, 'sync_issues' => false, 'sync_receipts' => true])->assertOk()->assertJsonPath('data.0.receipts.status', 'OK');
        $this->assertSame([0, 1, 1], [$called('getMonitoringStock'), $called('getDataPengeluaranHeader'), $called('getDataPengirimanForPenerimaan')]);
        $pull([])->assertOk();                                                                                          // default: stock only
        $this->assertSame([1, 1, 1], [$called('getMonitoringStock'), $called('getDataPengeluaranHeader'), $called('getDataPengirimanForPenerimaan')]);
        $pull(['sync_stock' => false])->assertStatus(409);                                                              // nothing chosen
        $pull(['sync_stock' => false, 'sync_issues' => true, 'dry_run' => true])->assertStatus(409);                    // a dry run is for stock only
    }

    #[Test]
    public function the_scheduled_mims_pull_uses_the_saved_token_of_the_user_who_switched_it_on_once_a_day(): void
    {
        $secret = 'rahasia-token-otomatis';
        DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-auto.test/api']);
        Http::fake(['mims-auto.test/*' => Http::response(['data' => [['No Material' => '000000000003110025', 'Nama Material' => 'CABLE', 'Satuan' => 'M', 'Stock Siap' => 10, 'Stock Reservasi' => 0, 'Stock In Transit' => 0, 'Stock Minimum' => 0]], 'msg' => '1'])]);

        $this->as($this->konstruksi)->putJson('/api/master-data/stock-sync/settings', ['auto_enabled' => true, 'auto_time' => '00:00'])->assertStatus(409);   // no saved token yet
        $this->as($this->konstruksi)->postJson('/api/master-data/stock-sync', ['token' => $secret, 'save_token' => true, 'dry_run' => true])->assertOk();
        $this->as($this->konstruksi)->putJson('/api/master-data/stock-sync/settings', ['auto_enabled' => true, 'auto_time' => '00:00'])->assertOk()->assertJsonPath('data.auto_enabled', true);
        $this->as($this->viewer)->getJson('/api/master-data/stock-sync/settings')->assertForbidden();

        $this->artisan('distriva:mims-sync-auto')->assertSuccessful();
        Http::assertSent(fn ($r) => $r->hasHeader('auth-token', $secret));
        $this->assertSame(1, DB::table('stock_snapshots')->count());
        $this->assertSame($this->konstruksi->getKey(), DB::table('stock_sync_runs')->value('triggered_by'));
        $this->artisan('distriva:mims-sync-auto')->assertSuccessful();                                                // already ran today
        $this->assertSame(1, DB::table('stock_sync_runs')->count());

        Carbon::setTestNow(now()->addDay());                                                         // next day, token now rejected
        config(['distriva.mims.base_url' => 'https://mims-auto-expired.test/api']);
        Http::fake(['mims-auto-expired.test/*' => Http::response([], 401)]);
        $this->artisan('distriva:mims-sync-auto')->assertSuccessful();
        $this->assertSame('REJECTED', DB::table('user_mims_tokens')->value('last_result'));
        $this->assertGreaterThan(0, DB::table('user_notifications')->where('title', 'like', 'Sinkron stok MIMS gagal%')->count());
        $this->assertStringNotContainsString($secret, json_encode(DB::table('stock_sync_runs')->get()));
        Carbon::setTestNow();
    }

    #[Test]
    public function the_automatic_mims_pull_stores_the_days_snapshot_reports_failures_and_never_records_the_token(): void
    {
        $secret = 'rahasia-token-uji';
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $this->as($this->perencanaan)->post('/api/master-data/khs-material-map/import', ['file' => UploadedFile::fake()->createWithContent('m.csv', "kode_khs,no_material\n1,3110025\n")], ['Accept' => 'application/json'])->assertCreated();
        $robot = $this->makeUser(email: 'sinkron@example.test');
        $stock = ['data' => [['No' => 1, 'Gudang' => 'Gd Ry Jombang', 'No Material' => '000000000003110025', 'Nama Material' => 'CABLE PWR;NFA2X;2X10mm2', 'Satuan' => 'M', 'Stock Siap' => 6957, 'Stock Reservasi' => 12, 'Stock In Transit' => 5, 'Stock Minimum' => 100],
            ['No' => 2, 'Gudang' => 'Gd Ry Jombang', 'No Material' => '000000000009999999', 'Nama Material' => 'TANPA KHS', 'Satuan' => 'BH', 'Stock Siap' => 3, 'Stock Reservasi' => 0, 'Stock In Transit' => 0, 'Stock Minimum' => 0]], 'msg' => '1'];

        config(['distriva.mims.base_url' => null, 'distriva.mims.auth_token' => null]);
        $this->artisan('distriva:mims-sync-stock')->assertFailed();                                                   // not configured: refuses to run
        config(['distriva.mims.base_url' => 'https://mims.test/api', 'distriva.mims.auth_token' => $secret, 'distriva.mims.sync_user_email' => 'sinkron@example.test']);

        Http::fake(['mims.test/*' => Http::response($stock)]);
        $this->artisan('distriva:mims-sync-stock', ['--dry-run' => true])->assertSuccessful();
        $this->assertSame(0, DB::table('stock_snapshots')->count());                                                  // a dry run stores nothing
        $this->artisan('distriva:mims-sync-stock')->assertSuccessful();
        Http::assertSent(fn ($r) => $r->hasHeader('auth-token', $secret) && str_contains($r->url(), '/getMonitoringStock/04&51&5118&2810&NORMAL&&0/'));
        $snap = DB::table('stock_snapshots')->first();
        $this->assertSame(now(config('distriva.business_timezone'))->toDateString(), substr((string) $snap->as_of, 0, 10));
        $this->assertSame(2, (int) $snap->materials_total);
        $this->assertSame(1, (int) $snap->materials_mapped);
        $line = DB::table('stock_snapshot_lines')->where('snapshot_id', $snap->id)->first();
        $this->assertEquals(6957 + 12, (float) $line->on_hand);                                                       // Stock Siap excludes the reserved material
        $this->assertEquals(12, (float) $line->reserved);
        $this->assertEquals(100, (float) $line->safety_stock);
        $this->artisan('distriva:mims-sync-stock')->assertSuccessful();                                               // the day's snapshot exists: skipped
        $this->assertSame(1, DB::table('stock_snapshots')->count());
        $this->assertSame(1, DB::table('stock_sync_runs')->where('status', 'OK')->count());
        $this->assertSame(1, DB::table('stock_sync_runs')->where('status', 'SKIPPED')->count());

        // failures: expired token, an unknown JSON shape
        config(['distriva.mims.base_url' => 'https://mims-expired.test/api']);                                         // stubs accumulate and the first match wins: one host per scenario
        Http::fake(['mims-expired.test/*' => Http::response(['msg' => 'unauthorized'], 401)]);
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-01', '--dry-run' => true])->assertFailed();
        $alerts = fn () => DB::table('user_notifications')->where('title', 'like', 'Sinkron stok MIMS gagal%');
        $this->assertSame(0, $alerts()->count());                                                                    // a dry run only reports
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-01'])->assertFailed();
        $this->assertGreaterThan(0, $alerts()->count());                                                             // the stock importers hear about the rejected token
        $this->assertTrue($alerts()->where('user_id', $this->konstruksi->getKey())->exists());
        $this->assertFalse($alerts()->where('user_id', $this->viewer->getKey())->exists());                          // only holders of stock.import
        $this->assertStringNotContainsString($secret, json_encode($alerts()->get()));                                // the token is never in the alert
        $count = $alerts()->count();
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-01'])->assertFailed();
        $this->assertSame($count, $alerts()->count());                                                               // refreshed while unread, not piled up
        config(['distriva.mims.base_url' => 'https://mims-shape.test/api']);
        Http::fake(['mims-shape.test/*' => Http::response(['data' => [['foo' => 1, 'bar' => 2]]])]);
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-02'])->assertFailed();
        // an empty "data" is a warehouse without ERP stock (SKIPPED, no empty snapshot); a missing "data" is a FAILURE that names the keys received (never values)
        config(['distriva.mims.base_url' => 'https://mims-empty.test/api']);
        Http::fake(['mims-empty.test/*' => Http::response(['data' => [], 'msg' => 1])]);
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-03'])->assertSuccessful();
        $empty = DB::table('stock_sync_runs')->where('status', 'SKIPPED')->where('message', 'like', '%tanpa baris stok%')->first();
        $this->assertNotNull($empty);
        $this->assertStringContainsString('msg=1', $empty->message);
        $this->assertSame(0, DB::table('stock_snapshots')->where('as_of', '2026-11-03')->count());
        config(['distriva.mims.base_url' => 'https://mims-html.test']);
        Http::fake(['mims-html.test/*' => Http::response('<!doctype html><html></html>', 200, ['Content-Type' => 'text/html'])]);
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-05'])->assertFailed();
        $this->assertSame(1, DB::table('stock_sync_runs')->where('message', 'like', '%halaman web (HTML)%')->count());
        Http::assertSent(fn ($r) => str_contains($r->url(), 'mims-html.test/project-i-agodist-api//getMonitoringStock/04&51&5118&2810&NORMAL&&0/'));   // the real API path of MIMS
        config(['distriva.mims.base_url' => 'https://mims-nokey.test/api']);
        Http::fake(['mims-nokey.test/*' => Http::response(['status' => 'ok', 'result' => 'rahasia-isi'])]);
        $this->artisan('distriva:mims-sync-stock', ['--date' => '2026-11-04'])->assertFailed();
        $messages = DB::table('stock_sync_runs')->where('status', 'FAILED')->pluck('message')->implode(' | ');
        $this->assertStringContainsString('kunci: status, result', $messages);
        $this->assertStringNotContainsString('rahasia-isi', $messages);
        $this->assertStringContainsString('token ditolak atau kedaluwarsa', $messages);
        $this->assertStringContainsString('Kolom yang diterima: foo, bar', $messages);                              // column NAMES only, never values
        $this->assertStringNotContainsString($secret, $messages);                                                    // the token is never recorded
        $runs = $this->as($this->viewer)->getJson('/api/master-data/stock-sync-runs')->assertOk();
        $this->assertTrue($runs->json('sync_configured'));
        $this->assertGreaterThanOrEqual(7, count($runs->json('data')));
        $this->assertStringNotContainsString($secret, json_encode($runs->json()));
        $this->as($this->vendor)->getJson('/api/master-data/stock-sync-runs')->assertForbidden();
    }

    #[Test]
    public function an_on_demand_pull_uses_the_signed_in_users_mims_token_for_that_call_only(): void
    {
        $secret = 'token-sesi-pengguna-uji-123456';
        foreach (['2810' => 'Gd Ry Jombang', '2800' => 'Gd Ry Mojokerto Kota'] as $loc => $name) {
            DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => "5118-{$loc}", 'name' => $name, 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => $loc, 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        $stock = ['data' => [['No Material' => '000000000003110025', 'Nama Material' => 'CABLE', 'Satuan' => 'M', 'Stock Siap' => 10, 'Stock Reservasi' => 0, 'Stock In Transit' => 0, 'Stock Minimum' => 0]]];
        $pull = fn (array $body, ?User $by = null) => $this->as($by ?? $this->konstruksi)->postJson('/api/master-data/stock-sync', $body);

        config(['distriva.mims.base_url' => null]);
        $pull(['token' => $secret])->assertStatus(409);                                                                     // the server must know the MIMS address
        config(['distriva.mims.base_url' => 'https://mims-ondemand.test/api', 'distriva.mims.auth_token' => null]);       // no service credential at all: only the user's token
        $pull(['token' => $secret], $this->vendor)->assertForbidden();
        $pull(['token' => $secret], $this->viewer)->assertForbidden();
        $pull([])->assertUnprocessable();                                                                                   // the token is required
        $pull(['token' => 'pendek'])->assertUnprocessable();
        $pull(['token' => $secret, 'date' => '2999-01-01'])->assertUnprocessable();

        Http::fake(['mims-ondemand.test/*' => Http::response($stock)]);
        $res = $pull(['token' => $secret])->assertOk();
        Http::assertSent(fn ($r) => $r->hasHeader('auth-token', $secret) && str_contains($r->url(), '&5118&2810&NORMAL&&0/'));
        $this->assertSame(['OK', 'OK'], array_column($res->json('data'), 'status'));
        $this->assertSame(2, DB::table('stock_snapshots')->count());
        $this->assertSame(2, DB::table('stock_sync_runs')->where('triggered_by', $this->konstruksi->getKey())->count());      // who pulled is recorded
        $this->assertStringNotContainsString($secret, $res->getContent());                                                  // never returned
        $this->assertStringNotContainsString($secret, json_encode(DB::table('stock_sync_runs')->get()));                    // never stored
        $this->assertSame(0, DB::table('stock_snapshots')->where('source_reference', 'like', "%{$secret}%")->count());
        $only = (string) DB::table('warehouses')->where('stor_loc', '2810')->value('id');
        $pull(['token' => $secret, 'warehouse_ids' => [$only]])->assertOk()->assertJsonPath('data.0.status', 'SKIPPED');       // today's snapshot exists

        config(['distriva.mims.base_url' => 'https://mims-expired2.test/api']);
        Http::fake(['mims-expired2.test/*' => Http::response(['msg' => 'unauthorized'], 401)]);
        $r = $pull(['token' => $secret, 'date' => '2026-11-01'])->assertOk()->json('data');
        $this->assertCount(1, $r);                                                                                           // an expired token stops at the first warehouse
        $this->assertSame('FAILED', $r[0]['status']);
        $this->assertStringContainsString('token ditolak atau kedaluwarsa', $r[0]['message']);
        $this->assertStringNotContainsString($secret, json_encode(DB::table('stock_sync_runs')->get()));
    }

    #[Test]
    public function a_user_may_keep_their_mims_token_encrypted_and_reuse_it_for_later_pulls(): void
    {
        $secret = 'token-tersimpan-uji-987654321';
        DB::table('warehouses')->insert(['id' => (string) Str::uuid(), 'code' => '5118-2810', 'name' => 'Gd Ry Jombang', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2810', 'kind' => 'GO', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        config(['distriva.mims.base_url' => 'https://mims-saved.test/api', 'distriva.mims.auth_token' => null]);
        $stock = ['data' => [['No Material' => '000000000003110025', 'Nama Material' => 'CABLE', 'Satuan' => 'M', 'Stock Siap' => 10, 'Stock Reservasi' => 0, 'Stock In Transit' => 0, 'Stock Minimum' => 0]]];
        $url = '/api/master-data/stock-sync';
        $status = fn (?User $by = null) => $this->as($by ?? $this->konstruksi)->getJson($url.'/token');

        $this->assertFalse($status()->assertOk()->json('data.saved'));
        $this->as($this->konstruksi)->postJson($url, ['use_saved_token' => true])->assertStatus(409);                       // nothing kept yet
        $status($this->vendor)->assertForbidden();

        Http::fake(['mims-saved.test/*' => Http::response($stock)]);
        $this->as($this->konstruksi)->postJson($url, ['token' => $secret, 'dry_run' => true])->assertOk();
        $this->assertFalse($status()->json('data.saved'));                                                                    // not kept unless asked
        $this->as($this->konstruksi)->postJson($url, ['token' => $secret, 'save_token' => true])->assertOk();
        $st = $status()->assertOk()->json();
        $this->assertTrue($st['data']['saved']);
        $this->assertStringNotContainsString($secret, json_encode($st));                                                      // the token is never returned
        $this->assertStringNotContainsString($secret, (string) DB::table('user_mims_tokens')->value('token_encrypted'));      // encrypted at rest
        $this->assertSame($secret, Crypt::decryptString((string) DB::table('user_mims_tokens')->value('token_encrypted')));
        $this->assertStringNotContainsString($secret, json_encode(DB::table('stock_sync_runs')->get()));
        $this->assertFalse($status($this->viewer)->status() === 200 && $status($this->viewer)->json('data.saved'));           // a token belongs to its owner

        Http::fake(['mims-saved.test/*' => Http::response($stock)]);
        $this->as($this->konstruksi)->postJson($url, ['use_saved_token' => true, 'date' => '2026-11-01'])->assertOk();
        Http::assertSent(fn ($r) => $r->hasHeader('auth-token', $secret));                                                    // the kept token is what was sent

        config(['distriva.mims.base_url' => 'https://mims-saved-expired.test/api']);
        Http::fake(['mims-saved-expired.test/*' => Http::response(['msg' => 'unauthorized'], 401)]);
        $this->as($this->konstruksi)->postJson($url, ['use_saved_token' => true, 'date' => '2026-10-01'])->assertOk()->assertJsonPath('data.0.status', 'FAILED');
        $this->assertSame('REJECTED', $status()->json('data.last_result'));                                                   // kept, but flagged so the user replaces it
        $this->as($this->konstruksi)->deleteJson($url.'/token')->assertOk();
        $this->assertFalse($status()->json('data.saved'));
    }

    #[Test]
    public function the_real_mims_response_shape_is_read_by_its_own_column_names(): void
    {
        $wh = (string) Str::uuid();
        DB::table('warehouses')->insert(['id' => $wh, 'code' => '5118-2080', 'name' => 'PLN Area Mojokerto', 'organizational_unit_id' => $this->up3->getKey(), 'plant' => '5118', 'stor_loc' => '2080', 'kind' => 'GI', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $json = json_decode((string) file_get_contents(base_path('tests/fixtures/mims_stock_sample.json')), true);      // 12 rows copied from the real UP3 Mojokerto response
        $first = collect($json['data'])->first(fn ($r) => $r['stock_SIAP'] > 0);
        config(['distriva.mims.base_url' => 'https://mims-real.test/api', 'distriva.mims.auth_token' => 'rahasia-uji-123456', 'distriva.mims.sync_user_email' => 'sinkron2@example.test']);
        $this->makeUser(email: 'sinkron2@example.test');
        DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => DB::table('khs_items')->where('code', '1')->value('id'), 'material_no' => ltrim($first['material_NO'], '0'), 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        Http::fake(['mims-real.test/*' => Http::response($json)]);

        $this->artisan('distriva:mims-sync-stock')->assertSuccessful();
        Http::assertSent(fn ($r) => str_contains($r->url(), '/getMonitoringStock/04&51&5118&2080&NORMAL&&0/'));          // the URL of the UP3 warehouse (storage location 2080)
        $snap = DB::table('stock_snapshots')->first();
        $this->assertSame(12, (int) $snap->materials_total);
        $this->assertSame(1, (int) $snap->materials_mapped);
        $raw = DB::table('stock_snapshot_materials')->where('snapshot_id', $snap->id)->where('material_no', ltrim($first['material_NO'], '0'))->first();
        $this->assertEquals($first['stock_SIAP'], (float) $raw->stock_ready);                                             // usable stock = stock_SIAP
        $this->assertSame($first['material_DESC'], $raw->material_name);                                                   // material_DESC
        $this->assertSame($first['satuan'], $raw->unit);
        $this->assertSame('MIMS API 5118/2080', $snap->source_reference);
        $this->assertSame('OK', DB::table('stock_sync_runs')->value('status'));
        $line = DB::table('stock_snapshot_lines')->where('snapshot_id', $snap->id)->first();
        $this->assertEquals($first['stock_SIAP'] + $first['stock_RESERVASI'], (float) $line->on_hand);                    // on hand = Siap + Reservasi
        $this->assertEquals($first['minimum_STOCK'], (float) $line->safety_stock);                                         // minimum_STOCK (the key that was not recognised before)
    }

    #[Test]
    public function a_snapshot_below_the_safety_stock_alerts_the_stock_importers_of_the_unit_once_and_refreshes_the_unread_alert(): void
    {
        $wh = $this->warehouse();
        $mine = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();

        $this->upload($wh, "kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman\n1,10,0,0,3\n2,5,0,0,0\n", ['as_of' => '2026-11-01'])->assertCreated();
        $this->assertCount(0, $mine($this->konstruksi));                                       // available 10 >= safety 3: nothing to say

        $this->upload($wh, "kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman\n1,10,2,0,9\n2,5,0,0,6\n", ['as_of' => '2026-11-02'])->assertCreated();
        $alerts = $mine($this->konstruksi);
        $this->assertCount(1, $alerts);
        $this->assertSame('Stok menipis: Gudang 1', $alerts[0]->title);
        $this->assertStringContainsString('2 material', $alerts[0]->body);
        $this->assertSame('warning', $alerts[0]->level);
        $this->assertCount(0, $mine($this->viewer));                                           // not a stock importer
        $this->assertCount(0, $mine($this->perencanaan));

        $this->upload($wh, "kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman\n1,10,2,0,9\n2,9,0,0,6\n", ['as_of' => '2026-11-03'])->assertCreated();
        $alerts = $mine($this->konstruksi);
        $this->assertCount(1, $alerts);                                                        // refreshed, not duplicated
        $this->assertStringContainsString('1 material', $alerts[0]->body);
    }

    #[Test]
    public function a_khs_item_can_be_exempted_from_sku_mapping_with_a_reason_and_leaves_the_pln_worklist_until_lifted(): void
    {
        $book = (string) Str::uuid();
        DB::table('price_books')->insert(['id' => $book, 'name' => 'Kontrak uji', 'valid_from' => '2025-01-01', 'status' => 'DRAFT', 'created_by' => $this->perencanaan->getKey(), 'created_at' => now(), 'updated_at' => now()]);
        foreach (['1', '2'] as $code) {
            DB::table('price_book_items')->insert(['id' => (string) Str::uuid(), 'price_book_id' => $book, 'khs_item_id' => DB::table('khs_items')->where('code', $code)->value('id'), 'material_status' => 'PLN', 'material_price' => null, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('price_books')->where('id', $book)->update(['status' => 'APPROVED', 'approved_by' => $this->konstruksi->getKey(), 'approved_at' => now()]);
        DB::table('materials')->insert(['id' => (string) Str::uuid(), 'code' => '000000000004190081', 'name' => 'UNIV ACC;PLASTIC STRAP 200mm', 'unit' => 'BH', 'created_at' => now(), 'updated_at' => now()]);
        $wb = fn (string $q = '') => $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/workbench'.$q)->assertOk();
        $ex = fn (array $b, ?User $by = null) => $this->as($by ?? $this->perencanaan)->postJson('/api/master-data/khs-material-map/exemptions', $b);
        $lift = fn (string $code, array $b, ?User $by = null) => $this->as($by ?? $this->perencanaan)->postJson("/api/master-data/khs-material-map/exemptions/{$code}/lift", $b);

        $this->assertSame(['1', '2'], array_column($wb('?supply=pln')->json('data'), 'khs_code'));
        $ex(['khs_code' => '1', 'reason' => 'Kubikel paket: diminta setelah pelanggan bayar'], $this->viewer)->assertForbidden();   // only the KHS managers
        $ex(['khs_code' => '1', 'reason' => 'x'], $this->vendor)->assertForbidden();
        $ex(['khs_code' => '1'])->assertUnprocessable();                                                                          // a reason is mandatory
        $ex(['khs_code' => '99', 'reason' => 'x'])->assertStatus(409);                                                            // unknown code
        $ex(['khs_code' => '1', 'reason' => 'Kubikel paket: diminta setelah pelanggan bayar'])->assertCreated();
        $ex(['khs_code' => '1', 'reason' => 'lagi'])->assertStatus(409);                                                          // already exempted

        $this->assertSame(['2'], array_column($wb('?supply=pln')->json('data'), 'khs_code'));                                     // leaves the PLN worklist
        $row = collect($wb()->json('data'))->firstWhere('khs_code', '1');
        $this->assertTrue($row['sku_exempt']);
        $this->assertSame('Kubikel paket: diminta setelah pelanggan bayar', $row['exempt_reason']);
        $this->assertFalse(collect($wb()->json('data'))->firstWhere('khs_code', '2')['sku_exempt']);
        $cov = $this->as($this->viewer)->getJson('/api/master-data/khs-material-map/coverage')->assertOk()->json('data');
        $this->assertArrayHasKey('sku_exempt_total', $cov);

        $this->as($this->perencanaan)->postJson('/api/master-data/khs-material-map', ['khs_code' => '1', 'material_no' => '4190081'])->assertStatus(409);   // exempt: cannot be mapped
        $csv = UploadedFile::fake()->createWithContent('m.csv', "kode_khs,no_material\n1,4190081\n");
        $this->as($this->perencanaan)->post('/api/master-data/khs-material-map/import', ['file' => $csv, 'dry_run' => 1], ['Accept' => 'application/json'])->assertStatus(409);

        $lift('1', [])->assertUnprocessable();                                                                                    // a reason is mandatory
        $lift('1', ['reason' => 'salah'], $this->viewer)->assertForbidden();
        $lift('1', ['reason' => 'Ternyata dikelola sebagai stok gudang'])->assertOk();
        $lift('1', ['reason' => 'lagi'])->assertStatus(409);                                                                      // not exempted any more
        $this->assertSame(['1', '2'], array_column($wb('?supply=pln')->json('data'), 'khs_code'));                                // back on the worklist
        $this->assertSame(1, DB::table('khs_sku_exemptions')->whereNotNull('lifted_at')->count());                                // the history is kept
        $this->assertSame($this->perencanaan->getKey(), DB::table('khs_sku_exemptions')->value('lifted_by'));

        $this->as($this->perencanaan)->postJson('/api/master-data/khs-material-map', ['khs_code' => '2', 'material_no' => '4190081'])->assertCreated();
        $ex(['khs_code' => '2', 'reason' => 'x'])->assertStatus(409);                                                             // a mapped item cannot be exempted
        $ex(['khs_code' => '1', 'reason' => 'Diadakan per proyek'])->assertCreated();                                             // exempting again after a lift is allowed
        $this->assertSame(2, DB::table('khs_sku_exemptions')->count());
    }
}
