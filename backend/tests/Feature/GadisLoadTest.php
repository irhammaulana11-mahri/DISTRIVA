<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Substations\GadisLoadService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** GADIS numbers from the DIL pairs: only empty numbers are filled, in the right ULP, never overwritten, with history, idempotent. */
class GadisLoadTest extends PostgresTestCase
{
    private function gardu(OrganizationalUnit $ulp, string $code, ?string $gadis = null): string
    {
        DB::table('substations')->insert(['id' => $id = (string) Str::uuid(), 'code' => $code, 'organizational_unit_id' => $ulp->getKey(), 'gadis_number' => $gadis, 'ownership' => 'PLN', 'name' => $code, 'capacity_kva' => 100,
            'status' => 'AKTIF', 'transformer_count' => 1, 'needs_review' => false, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    #[Test]
    public function it_fills_only_empty_numbers_in_the_same_ulp_reports_the_rest_and_is_idempotent(): void
    {
        $up3 = $this->makeUnit('UP3');
        $ulp = OrganizationalUnit::query()->create(['code' => '51453', 'name' => 'ULP Jombang', 'unit_type' => 'ULP', 'parent_id' => $up3->getKey(), 'is_active' => true]);
        $other = OrganizationalUnit::query()->create(['code' => '51454', 'name' => 'ULP Ngoro', 'unit_type' => 'ULP', 'parent_id' => $up3->getKey(), 'is_active' => true]);
        $empty = $this->gardu($ulp, 'HD0001');
        $this->gardu($ulp, 'HD0002', 'GD514530002');                      // already right
        $this->gardu($ulp, 'HD0003', 'GD514530999');                      // a different number: never overwritten
        $this->gardu($ulp, 'HD0004');                                     // the number below is already used by HD0002
        $this->gardu($other, 'HD0005');                                   // same code in another ULP stays untouched
        $path = tempnam(sys_get_temp_dir(), 'gadis');
        file_put_contents($path, implode("\n", ['ulp_code,code,gadis_number', '51453,HD0001,GD514530001', '51453,HD0002,GD514530002', '51453,HD0003,GD514530003', '51453,HD0004,GD514530002', '51453,HD0777,GD514530777', '51453,HD0001,BUKAN']));
        $svc = app(GadisLoadService::class);
        $actor = $this->makeUser();

        $dry = $svc->load($path, $actor, true);
        $this->assertNull(DB::table('substations')->where('id', $empty)->value('gadis_number'));                  // a dry run stores nothing
        $this->assertSame(1, $dry['counts']['filled']);

        $r = $svc->load($path, $actor);
        $this->assertSame(['filled' => 1, 'unchanged' => 1, 'conflicts' => 1, 'not_found' => 1, 'invalid' => 1, 'number_in_use' => 1], array_intersect_key($r['counts'], array_flip(['filled', 'unchanged', 'conflicts', 'not_found', 'invalid', 'number_in_use'])));
        $this->assertSame('GD514530001', DB::table('substations')->where('id', $empty)->value('gadis_number'));
        $this->assertSame('GD514530999', DB::table('substations')->where('code', 'HD0003')->value('gadis_number'));
        $this->assertNull(DB::table('substations')->where('organizational_unit_id', $other->getKey())->value('gadis_number'));
        $this->assertSame(1, DB::table('substation_changes')->where('substation_id', $empty)->count());

        $again = $svc->load($path, $actor);
        $this->assertSame(0, $again['counts']['filled']);
        $this->assertSame(1, DB::table('substation_changes')->where('substation_id', $empty)->count());
    }
}
