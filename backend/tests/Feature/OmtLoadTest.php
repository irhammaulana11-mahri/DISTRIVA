<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\User;
use App\Services\Substations\OmtLoadService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

/** Loading of the cleaned OMT file (docs/83): gardu and feeders that are missing are formed, the Maximo master is never overwritten, readings carry time and capacity, everything is idempotent. */
class OmtLoadTest extends PostgresTestCase
{
    private const HEADER = ['Nama Unit', 'Nama ULP', 'Nama Penyulang', 'Nama Aset', 'Latitude Aset', 'Longitude Aset', 'Konstruksi Aset', 'Kapasitas Aset', 'Tanggal Pengukuran', 'Waktu Pengukuran', 'Beban Trafo',
        'iar', 'ias', 'iat', 'ibr', 'ibs', 'ibt', 'ifn', 'ifr', 'ifs', 'ift', 'iur', 'ius', 'iut', 'iun', 'vrn', 'vsn', 'vtn'];

    private OrganizationalUnit $up3;

    private OrganizationalUnit $ulp;

    private User $actor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->up3 = $this->makeUnit('UP3');
        $this->ulp = OrganizationalUnit::query()->create(['code' => '51453', 'name' => 'ULP Jombang', 'unit_type' => 'ULP', 'parent_id' => $this->up3->getKey(), 'is_active' => true]);
        $this->actor = $this->makeUser();
    }

    private function csv(array $rows): string
    {
        $path = tempnam(sys_get_temp_dir(), 'omt');
        $fh = fopen($path, 'w');
        fputcsv($fh, self::HEADER, ',', '"', '');
        foreach ($rows as $r) {
            fputcsv($fh, array_map(fn ($h) => $r[$h] ?? '', self::HEADER), ',', '"', '');
        }
        fclose($fh);

        return $path;
    }

    private function row(string $asset, string $at, array $over = []): array
    {
        return $over + ['Nama Unit' => 'MOJOKERTO', 'Nama ULP' => 'JOMBANG', 'Nama Penyulang' => 'WATUGALUH', 'Nama Aset' => $asset, 'Latitude Aset' => '-7.61', 'Longitude Aset' => '112.24', 'Konstruksi Aset' => 'GTT2', 'Kapasitas Aset' => '100',
            'Tanggal Pengukuran' => substr($at, 0, 10), 'Waktu Pengukuran' => $at, 'Beban Trafo' => '61.252', 'iur' => '90', 'ius' => '80', 'iut' => '70', 'vrn' => '229', 'vsn' => '226', 'vtn' => '232'];
    }

    #[Test]
    public function codes_are_padded_coordinates_are_checked_and_names_are_normalised(): void
    {
        $this->assertSame('HD0762', OmtLoadService::code('hd762'));
        $this->assertSame('HH1234', OmtLoadService::code('HH1234'));
        $this->assertSame('GD LB0280', OmtLoadService::code('GD LB0280'));
        $this->assertSame([-7.61, 112.24], OmtLoadService::coordinate('-7.61', '112.24'));
        $this->assertNull(OmtLoadService::coordinate('0', '0'));
        $this->assertNull(OmtLoadService::coordinate('112.24', '-7.61'));            // swapped
        $this->assertNull(OmtLoadService::coordinate('', '112'));
        $this->assertSame('WATUGALUH', OmtLoadService::norm('Watu Galuh'));
    }

    #[Test]
    public function it_forms_missing_gardu_and_feeders_loads_readings_with_time_and_capacity_and_is_idempotent(): void
    {
        $past = now()->subDays(40)->toDateString();
        $feederId = (string) Str::uuid();
        DB::table('distribution_feeders')->insert(['id' => $feederId, 'code' => 'WTGLH', 'name' => 'WATU GALUH', 'owner_unit_id' => $this->up3->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);
        $existing = (string) Str::uuid();
        DB::table('substations')->insert(['id' => $existing, 'code' => 'HD0001', 'organizational_unit_id' => $this->ulp->getKey(), 'ownership' => 'PLN', 'name' => 'GARDU MAXIMO', 'capacity_kva' => 200, 'status' => 'AKTIF',
            'transformer_count' => 1, 'needs_review' => false, 'created_at' => now(), 'updated_at' => now()]);
        $rows = [
            $this->row('HD1', "{$past} 08:15:30", ['Kapasitas Aset' => '100']),                                                         // HD1 -> HD0001: the master gardu (200 kVA) stays, the reading keeps its own 100 kVA
            $this->row('HD1', "{$past} 17:40:00", ['Kapasitas Aset' => '160', 'Beban Trafo' => '96']),                                // transformer management: 160 kVA later the same day
            $this->row('HD762', "{$past} 09:00:00", ['Nama Penyulang' => 'KALI BARU', 'ibr' => '30', 'ibs' => '20', 'ibt' => '10', 'Latitude Aset' => '0', 'Longitude Aset' => '0']),   // new gardu, new feeder, no valid coordinate
            $this->row('HD762', "{$past} 09:00:00"),                                                                                  // an exact duplicate: unchanged
            $this->row('HD9', "{$past} 10:00:00", ['Nama ULP' => 'ULP TIDAK ADA']),                                                  // unknown ULP: reported, not guessed
        ];
        $file = $this->csv($rows);
        $svc = app(OmtLoadService::class);

        $dry = $svc->load($file, $this->actor, true);
        $this->assertTrue($dry['dry_run']);
        $this->assertSame(0, DB::table('substation_readings')->count());                                                             // a dry run stores nothing
        $this->assertSame(1, DB::table('substations')->count());

        $r = $svc->load($file, $this->actor);
        $c = $r['counts'];
        $this->assertSame([5, 1, 1, 1, 3, 1], [$c['rows'], $c['gardu_created'], $c['feeders_created'], $c['unknown_ulp'], $c['readings_stored'], $c['readings_unchanged']]);
        $this->assertSame(2, $c['gardu_matched']);                                                                                    // HD0001 and (on its second row) the HD0762 formed just before, each counted once
        $this->assertSame(2, $c['gardu_filled']);                                                                       // HD0001's empty feeder and HD0762's missing coordinate (a later row has one) are filled
        $this->assertSame(['ULP TIDAK ADA'], $r['problems']['unknown_ulp']);
        $g = DB::table('substations')->where('code', 'HD0762')->first();
        $this->assertSame([$this->ulp->getKey(), 'GTT2', 100.0, -7.61], [$g->organizational_unit_id, $g->type_code, (float) $g->capacity_kva, (float) $g->latitude]);      // the first row had 0/0 (no coordinate); the later row's coordinate fills it
        $this->assertNotNull($g->feeder_id);
        $this->assertSame('KLBR', (string) DB::table('distribution_feeders')->where('id', $g->feeder_id)->value('code'));              // abbreviated from KALI BARU
        $this->assertSame($this->up3->getKey(), DB::table('distribution_feeders')->where('id', $g->feeder_id)->value('owner_unit_id'));
        $m = DB::table('substations')->where('code', 'HD0001')->first();
        $this->assertSame(['GARDU MAXIMO', 200.0], [$m->name, (float) $m->capacity_kva]);                                           // the Maximo master is untouched
        $this->assertSame($feederId, $m->feeder_id);                                                                                  // an empty feeder is filled from the OMT name (WATUGALUH = WATU GALUH)
        $reads = DB::table('substation_readings')->where('substation_id', $m->id)->orderBy('measured_at')->get();
        $this->assertSame([100.0, 160.0], $reads->map(fn ($x) => (float) $x->capacity_kva)->all());                                  // the capacity AT THE TIME of each reading
        $this->assertEquals([61.25, 60.0], $reads->map(fn ($x) => round((float) $x->loading_pct, 2))->all());                        // 61.252 of 100 kVA, 96 of 160 kVA
        $this->assertSame([229.0, 226.0, 232.0], [(float) $reads[0]->base_voltage_r_v, (float) $reads[0]->base_voltage_s_v, (float) $reads[0]->base_voltage_t_v]);
        $this->assertSame('IMPORT', $reads[0]->source);
        $this->assertStringContainsString('08:15:30', (string) CarbonImmutable::parse($reads[0]->measured_at)->setTimezone(config('distriva.business_timezone'))->toTimeString());
        $jur = DB::table('substation_reading_feeders as f')->join('substation_readings as r', 'r.id', '=', 'f.reading_id')->where('r.substation_id', $g->id)->select('f.*')->get();
        $this->assertSame(['B'], $jur->pluck('label')->all());                                                                       // only jurusan with a measured current
        $this->assertSame([30.0, 20.0, 10.0], [(float) $jur[0]->current_r_a, (float) $jur[0]->current_s_a, (float) $jur[0]->current_t_a]);

        // again: nothing new
        $again = $svc->load($file, $this->actor)['counts'];
        $this->assertSame([0, 0, 0, 4], [$again['gardu_created'], $again['feeders_created'], $again['readings_stored'], $again['readings_unchanged']]);
        $this->assertSame(3, DB::table('substation_readings')->count());
    }

    #[Test]
    public function the_shifted_readings_are_corrected_in_one_transaction_and_the_history_triggers_are_back_afterwards(): void
    {
        $day = now()->subDays(40)->toDateString();
        $shifted = $this->csv([
            $this->row('HD7', "{$day} 09:00:00", ['vrn' => '', 'vsn' => '', 'vtn' => '', 'iur' => '', 'ius' => '', 'iut' => '', 'ifn' => '230', 'ifr' => '400', 'ifs' => '231', 'ift' => '400', 'ibr' => '30']),      // voltages sat in jurusan F
            $this->row('HD8', "{$day} 10:00:00", ['ibr' => '20']),                                                                                                                                                 // a normal reading
        ]);
        $fixed = $this->csv([
            $this->row('HD7', "{$day} 09:00:00", ['vrn' => '230', 'vsn' => '231', 'vtn' => '229', 'iur' => '46', 'ius' => '40', 'iut' => '44', 'ibr' => '30']),
            $this->row('HD8', "{$day} 10:00:00", ['ibr' => '25', 'vrn' => '240']),                                                                                                                                  // must not be touched
        ]);
        $svc = app(OmtLoadService::class);
        $svc->load($shifted, $this->actor);
        $hd7 = DB::table('substations')->where('code', 'HD0007')->value('id');
        $id = DB::table('substation_readings')->where('substation_id', $hd7)->value('id');
        $this->assertSame(['B', 'F'], DB::table('substation_reading_feeders')->where('reading_id', $id)->orderBy('label')->pluck('label')->all());

        $dry = $svc->repairShifted($fixed, true);
        $this->assertSame([1, 1], [$dry['suspect'], $dry['repaired']]);
        $this->assertSame(['B', 'F'], DB::table('substation_reading_feeders')->where('reading_id', $id)->orderBy('label')->pluck('label')->all());   // a dry run changes nothing

        $r = $svc->repairShifted($fixed);
        $this->assertSame([1, 1, 0], [$r['suspect'], $r['repaired'], $r['not_in_file']]);
        $this->assertSame(['B'], DB::table('substation_reading_feeders')->where('reading_id', $id)->pluck('label')->all());
        $row = DB::table('substation_readings')->where('id', $id)->first();
        $this->assertSame([230.0, 231.0, 229.0, 46.0, 40.0, 44.0], [(float) $row->base_voltage_r_v, (float) $row->base_voltage_s_v, (float) $row->base_voltage_t_v, (float) $row->current_r_a, (float) $row->current_s_a, (float) $row->current_t_a]);
        $hd8 = DB::table('substation_readings as r')->join('substations as s', 's.id', '=', 'r.substation_id')->where('s.code', 'HD0008')->first();
        $this->assertSame(229.0, (float) $hd8->base_voltage_r_v);                                                                                    // untouched: its fingerprint does not match
        $this->assertSame(0, $svc->repairShifted($fixed)['suspect']);                                                                                  // a second run finds nothing

        $this->expectException(QueryException::class);                                                                           // the history triggers are enforced again
        DB::table('substation_readings')->where('id', $id)->update(['current_r_a' => 1]);
    }

    #[Test]
    public function an_old_feeder_spelling_uses_the_official_feeder_and_no_feeder_is_formed_for_a_gardu_that_already_has_one(): void
    {
        $past = now()->subDays(40)->toDateString();
        $official = (string) Str::uuid();
        $other = (string) Str::uuid();
        DB::table('distribution_feeders')->insert([
            ['id' => $official, 'code' => 'ELKS', 'name' => 'ELKISHI', 'owner_unit_id' => $this->up3->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()],
            ['id' => $other, 'code' => 'WTGLH', 'name' => 'WATU GALUH', 'owner_unit_id' => $this->up3->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('substations')->insert(['id' => (string) Str::uuid(), 'code' => 'HD0001', 'organizational_unit_id' => $this->ulp->getKey(), 'ownership' => 'PLN', 'name' => 'G', 'capacity_kva' => 100, 'status' => 'AKTIF',
            'transformer_count' => 1, 'needs_review' => false, 'feeder_id' => $other, 'feeder_code' => 'WTGLH', 'created_at' => now(), 'updated_at' => now()]);
        $file = $this->csv([
            $this->row('HD1', "{$past} 08:00:00", ['Nama Penyulang' => 'ELKISI']),                    // an existing gardu with a feeder: the (old) feeder name is not even resolved
            $this->row('HD2', "{$past} 08:00:00", ['Nama Penyulang' => 'ELKISI']),                    // a new gardu: the old spelling maps to the official ELKISHI
        ]);

        $c = app(OmtLoadService::class)->load($file, $this->actor)['counts'];

        $this->assertSame(0, $c['feeders_created']);
        $this->assertSame(2, DB::table('distribution_feeders')->count());
        $this->assertSame($official, DB::table('substations')->where('code', 'HD0002')->value('feeder_id'));
        $this->assertSame($other, DB::table('substations')->where('code', 'HD0001')->value('feeder_id'));
    }

    #[Test]
    public function the_gi_name_of_the_feeders_comes_from_the_owners_list_by_name_or_by_the_omt_prefix_and_near_misses_are_only_suggested(): void
    {
        $owner = $this->up3->getKey();
        foreach ([['KLWNG', 'KALIWUNGU'], ['MJA_BANCANG', 'MJA_BANCANG'], ['SKP', 'SIKEPU'], ['TBRNG', 'TEBUIRENG'], ['XYZ', 'LAIN SAMA SEKALI'], ['BNTNG', 'BENTENG PANCASILA']] as [$code, $name]) {
            DB::table('distribution_feeders')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'name' => $name, 'owner_unit_id' => $owner, 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);
        }
        $path = tempnam(sys_get_temp_dir(), 'gi');
        file_put_contents($path, "PENYULANG,RAYON,GARDU INDUK\nKALIWUNGU,JOMBANG,JOMBANG\nBANCANG,PACET,MOJOAGUNG\nSIKEPUH,NGORO,SIMAN\nTEBU IRENG,JOMBANG,JOMBANG\nWIDAS,NGANJUK,NGANJUK\nBENTENG,MOJOKERTO,SEKAR PUTIH\n");
        $email = $this->actor->email;
        $this->artisan('feeders:load-gi', ['file' => $path, '--actor' => $email, '--dry-run' => true])->assertSuccessful();
        $this->assertSame(0, DB::table('distribution_feeders')->whereNotNull('gi_name')->count());                      // a dry run stores nothing
        $this->artisan('feeders:load-gi', ['file' => $path, '--actor' => $email])->assertSuccessful();
        $gi = DB::table('distribution_feeders')->pluck('gi_name', 'code')->all();
        $this->assertEquals(['KLWNG' => 'JOMBANG', 'MJA_BANCANG' => 'MOJOAGUNG', 'SKP' => null, 'TBRNG' => 'JOMBANG', 'XYZ' => null, 'BNTNG' => null], $gi);   // exact, ULP prefix, spaces ignored; SIKEPU ~ SIKEPUH is not applied without the flag
        $this->assertSame(3, DB::table('distribution_feeder_changes')->where('reason', 'like', 'Nama GI dari daftar%')->count());
        $this->artisan('feeders:load-gi', ['file' => $path, '--actor' => $email])->assertSuccessful();                  // again: nothing new
        $this->assertSame(3, DB::table('distribution_feeder_changes')->where('reason', 'like', 'Nama GI dari daftar%')->count());

        // with the flags: the typo is renamed to the official spelling (no merge), missing official feeders are formed, look-alikes are left for the owner
        $this->artisan('feeders:load-gi', ['file' => $path, '--actor' => $email, '--rename-typos' => true, '--create-missing' => true])->assertSuccessful();
        $this->assertSame(['SIKEPUH', 'SIMAN'], [DB::table('distribution_feeders')->where('code', 'SKP')->value('name'), DB::table('distribution_feeders')->where('code', 'SKP')->value('gi_name')]);
        $widas = DB::table('distribution_feeders')->where('name', 'WIDAS')->first();
        $this->assertSame(['NGANJUK', $owner], [$widas->gi_name, $widas->owner_unit_id]);
        $this->assertStringContainsString('rayon NGANJUK', (string) $widas->notes);
        $this->assertSame(0, DB::table('distribution_feeders')->where('name', 'BENTENG')->count());                      // BENTENG ~ BENTENG PANCASILA is not guessed
        $this->assertSame(0, DB::table('distribution_feeders')->where('name', 'LAIN SAMA SEKALI')->whereNotNull('gi_name')->count());
    }
}
