<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Services\Substations\FeederReassignService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Reviewed feeder moves: only existing active feeders, only changes, written to the gardu history, idempotent. */
class FeederReassignTest extends PostgresTestCase
{
    #[Test]
    public function it_moves_gardu_to_existing_feeders_records_history_and_skips_the_rest(): void
    {
        $up3 = $this->makeUnit('UP3');
        $ulp = OrganizationalUnit::query()->create(['code' => '51452', 'name' => 'ULP Mojokerto', 'unit_type' => 'ULP', 'parent_id' => $up3->getKey(), 'is_active' => true]);
        $feeder = function (string $code, string $status = 'AKTIF') use ($up3): string {
            DB::table('distribution_feeders')->insert(['id' => $id = (string) Str::uuid(), 'code' => $code, 'name' => $code.' NAMA', 'owner_unit_id' => $up3->getKey(), 'status' => $status, 'created_at' => now(), 'updated_at' => now()]);

            return $id;
        };
        $old = $feeder('GDG');
        $feeder('EMPNL');
        $feeder('MATI', 'NONAKTIF');
        $gardu = function (string $code, string $feederCode, string $feederId) use ($ulp): string {
            DB::table('substations')->insert(['id' => $id = (string) Str::uuid(), 'code' => $code, 'organizational_unit_id' => $ulp->getKey(), 'feeder_code' => $feederCode, 'feeder_id' => $feederId, 'ownership' => 'PLN', 'name' => $code,
                'capacity_kva' => 100, 'status' => 'AKTIF', 'transformer_count' => 1, 'needs_review' => false, 'created_at' => now(), 'updated_at' => now()]);

            return $id;
        };
        $moving = $gardu('HC0125', 'GDG', $old);
        $gardu('HC0230', 'GDG', $old);
        $path = tempnam(sys_get_temp_dir(), 'fd');
        file_put_contents($path, implode("\n", ['ulp,kode_gardu,kode_penyulang_tujuan', '51452,HC0125,EMPNL', '51452,HC0230,MATI', '51452,HC9999,EMPNL', '51452,HC0125,TIDAKADA']));
        $svc = app(FeederReassignService::class);
        $actor = $this->makeUser();

        $dry = $svc->apply($path, $actor, 'uji', true);
        $this->assertSame($old, DB::table('substations')->where('id', $moving)->value('feeder_id'));                                    // a dry run moves nothing
        $this->assertSame(1, $dry['counts']['moved']);

        $r = $svc->apply($path, $actor, 'Penyulang mengikuti DIL 2026-09');
        $this->assertSame(['moved' => 1, 'gardu_not_found' => 1, 'feeder_missing' => 2], array_intersect_key($r['counts'], array_flip(['moved', 'gardu_not_found', 'feeder_missing'])));
        $this->assertSame('EMPNL', DB::table('substations')->where('id', $moving)->value('feeder_code'));
        $this->assertSame($old, DB::table('substations')->where('code', 'HC0230')->value('feeder_id'));                                // the inactive target is never used
        $change = DB::table('substation_changes')->where('substation_id', $moving)->first();
        $this->assertSame('Penyulang mengikuti DIL 2026-09', $change->reason);
        $this->assertSame('GDG', json_decode($change->before, true)['feeder_code']);

        $again = $svc->apply($path, $actor, 'Penyulang mengikuti DIL 2026-09');
        $this->assertSame([0, 1], [$again['counts']['moved'], $again['counts']['unchanged']]);
        $this->assertSame(1, DB::table('substation_changes')->where('substation_id', $moving)->count());
    }
}
