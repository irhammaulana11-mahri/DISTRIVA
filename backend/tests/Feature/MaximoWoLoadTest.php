<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\User;
use App\Services\Substations\MaximoWoLoadService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Loading of the cleaned Maximo WO inspection file (tools/maximo_sync/README.md): readings of existing gardu only, idempotent. */
class MaximoWoLoadTest extends PostgresTestCase
{
    private const HEADER = ['wonum', 'gardu', 'measured_at', 'pembebanan_trafo_pct', 'vrn', 'vsn', 'vtn', 'iar', 'ias', 'iat', 'ian', 'icr', 'ics', 'ict', 'location', 'owner'];

    private User $actor;

    private string $gardu;

    protected function setUp(): void
    {
        parent::setUp();
        $up3 = $this->makeUnit('UP3');
        $ulp = OrganizationalUnit::query()->create(['code' => '51453', 'name' => 'ULP Jombang', 'unit_type' => 'ULP', 'parent_id' => $up3->getKey(), 'is_active' => true]);
        $this->actor = $this->makeUser();
        $this->gardu = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $this->gardu, 'code' => 'HD0744', 'organizational_unit_id' => $ulp->getKey(), 'ownership' => 'PLN', 'capacity_kva' => 200, 'status' => 'AKTIF',
            'transformer_count' => 1, 'needs_review' => false, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** @param list<array<string,string>> $rows */
    private function csv(array $rows): string
    {
        $path = tempnam(sys_get_temp_dir(), 'wo');
        $fh = fopen($path, 'w');
        fputcsv($fh, self::HEADER, ',', '"', '');
        foreach ($rows as $r) {
            fputcsv($fh, array_map(fn ($h) => $r[$h] ?? '', self::HEADER), ',', '"', '');
        }
        fclose($fh);

        return $path;
    }

    #[Test]
    public function a_work_order_becomes_a_reading_of_an_existing_gardu_with_the_load_per_jurusan_and_a_gardu_that_is_not_in_the_master_is_only_reported(): void
    {
        $file = $this->csv([
            ['wonum' => '100000001', 'gardu' => 'HD744', 'measured_at' => '2026-08-12 13:13:15', 'pembebanan_trafo_pct' => '52.65', 'vrn' => '226', 'vsn' => '228', 'vtn' => '230',
                'iar' => '55', 'ias' => '82', 'iat' => '60', 'ian' => '42', 'icr' => '10', 'ics' => '12', 'ict' => '11'],
            ['wonum' => '100000002', 'gardu' => 'ZZ999', 'measured_at' => '2026-08-12 14:00:00', 'pembebanan_trafo_pct' => '40'],
            ['wonum' => '100000003', 'gardu' => 'HD744', 'measured_at' => '', 'pembebanan_trafo_pct' => '40'],                                       // no dated measurement: counted, not stored
            ['wonum' => '100000004', 'gardu' => 'HD744', 'measured_at' => '2999-01-01 10:00:00', 'iar' => '10'],                                      // in the future: rejected, the file still loads
        ]);
        $svc = app(MaximoWoLoadService::class);

        $dry = $svc->load($file, $this->actor, true);
        $this->assertSame(0, DB::table('substation_readings')->count());                                                            // a dry run stores nothing
        $this->assertSame([4, 1, 1, 1, 1], [$dry['counts']['rows'], $dry['counts']['readings_stored'], $dry['counts']['unknown_gardu'], $dry['counts']['no_measurement'], $dry['counts']['rejected']]);

        $r = $svc->load($file, $this->actor);
        $this->assertSame(['ZZ0999 (WO 100000002)'], $r['problems']['unknown_gardu']);
        $this->assertSame(1, DB::table('substations')->count());                                                                   // never formed from an inspection
        $reading = DB::table('substation_readings')->where('substation_id', $this->gardu)->first();
        $this->assertSame([226.0, 228.0, 230.0, 52.65, 200.0], [(float) $reading->base_voltage_r_v, (float) $reading->base_voltage_s_v, (float) $reading->base_voltage_t_v, (float) $reading->loading_pct, (float) $reading->capacity_kva]);
        $this->assertSame([65.0, 94.0, 71.0], [(float) $reading->current_r_a, (float) $reading->current_s_a, (float) $reading->current_t_a]);   // no gardu-level current: the sum of the jurusan
        $jur = DB::table('substation_reading_feeders')->where('reading_id', $reading->id)->orderBy('label')->get();
        $this->assertSame(['A', 'C'], $jur->pluck('label')->all());
        $this->assertSame([55.0, 82.0, 60.0, 42.0], [(float) $jur[0]->current_r_a, (float) $jur[0]->current_s_a, (float) $jur[0]->current_t_a, (float) $jur[0]->current_n_a]);
        $this->assertSame('IMPORT', $reading->source);

        $again = $svc->load($file, $this->actor)['counts'];                                                                         // idempotent
        $this->assertSame([0, 1], [$again['readings_stored'], $again['readings_unchanged']]);
        $this->assertSame(1, DB::table('substation_readings')->count());
    }

    #[Test]
    public function missing_gardu_are_exported_and_only_formed_on_request_flagged_for_review_with_their_feeder_and_ulp(): void
    {
        $file = $this->csv([
            ['wonum' => '1', 'gardu' => 'HL0766', 'measured_at' => '2026-08-12 13:00:00', 'pembebanan_trafo_pct' => '40', 'iar' => '10', 'location' => 'GD01.62555109 GD HL0766 PENYULANG BAGOR', 'owner' => '51453.INSPEKTOR.10'],
            ['wonum' => '2', 'gardu' => 'HL0766', 'measured_at' => '2026-08-13 13:00:00', 'pembebanan_trafo_pct' => '41', 'iar' => '11', 'location' => 'GD01.62555109 GD HL0766 PENYULANG BAGOR', 'owner' => '51453.INSPEKTOR.10'],
            ['wonum' => '3', 'gardu' => 'HL0777', 'measured_at' => '2026-08-12 13:00:00', 'pembebanan_trafo_pct' => '40', 'location' => 'GD01.1 GD HL0777 PENYULANG X', 'owner' => 'TIMHAR.1'],   // unknown ULP: never formed
        ]);
        $svc = app(MaximoWoLoadService::class);
        $export = tempnam(sys_get_temp_dir(), 'ex');

        $svc->load($file, $this->actor, false, false, $export);
        $this->assertSame(1, DB::table('substations')->count());                                                                   // not formed without the option
        $lines = array_map('str_getcsv', file($export, FILE_IGNORE_NEW_LINES), array_fill(0, 3, ','), array_fill(0, 3, '"'), array_fill(0, 3, ''));
        $this->assertSame(['HL0766', 'GD01.62555109', 'BAGOR', '51453', 'ya', '2', '2026-08-12 13:00:00', '2026-08-13 13:00:00'], $lines[1]);
        $this->assertSame(['HL0777', 'GD01.1', 'X', 'TIMHAR', 'tidak', '1', '2026-08-12 13:00:00', '2026-08-12 13:00:00'], $lines[2]);

        $r = $svc->load($file, $this->actor, false, true);
        $this->assertSame([1, 1, 2, 1], [$r['counts']['gardu_created'], $r['counts']['feeders_created'], $r['counts']['readings_stored'], $r['counts']['unknown_gardu']]);
        $new = DB::table('substations')->where('code', 'HL0766')->first();
        $this->assertTrue((bool) $new->needs_review);
        $this->assertSame('GD01.62555109', $new->location_code);
        $this->assertSame('BAGOR', DB::table('distribution_feeders')->where('id', $new->feeder_id)->value('name'));
        $this->assertSame(0, DB::table('substations')->where('code', 'HL0777')->count());
        $this->assertSame(2, DB::table('substation_readings')->where('substation_id', $new->id)->count());
        $this->assertSame(0, $svc->load($file, $this->actor, false, true)['counts']['gardu_created']);                               // idempotent
    }

    #[Test]
    public function a_file_without_the_required_columns_is_refused(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'wo');
        file_put_contents($path, "a,b\n1,2\n");
        $this->expectException(\RuntimeException::class);
        app(MaximoWoLoadService::class)->load($path, $this->actor);
    }
}
