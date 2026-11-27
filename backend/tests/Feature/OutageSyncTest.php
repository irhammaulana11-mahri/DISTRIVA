<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Outages\OutageSheetParser;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\OutagePermissionSeeder;
use Illuminate\Http\Client\Factory;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class OutageSyncTest extends PostgresTestCase
{
    private const SHEET = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';

    private OrganizationalUnit $ulpA;

    private User $admin;

    private User $viewer;

    private User $niaga;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        $this->seed(OutagePermissionSeeder::class);
        config(['distriva.outage.run_inline' => true]);
        $up3 = $this->makeUnit('UP3');
        $this->ulpA = $this->makeUnit('ULP', $up3);
        $this->ulpA->forceFill(['name' => 'ULP Mojosari'])->save();
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->admin = $mk('SYS_ADMIN', null);
        $this->viewer = $mk('TEKNIK', $this->ulpA);
        $this->niaga = $mk('NIAGA_RETAIL', $this->ulpA);
        foreach ([['MOJOANYAR', 'MJAN', 'MOJOSARI'], ['BETEK', 'BTK', 'MOJOAGUNG']] as [$name, $code, $gi]) {
            DB::table('distribution_feeders')->insert(['id' => (string) Str::uuid(), 'code' => $code, 'name' => $name, 'gi_name' => $gi, 'owner_unit_id' => $this->ulpA->getKey(), 'status' => 'AKTIF', 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    private function csv(array $extra = []): string
    {
        $head = ['NO', 'TANGGAL', 'Column1', 'TGL', 'BLN', 'TAHUN', 'RAYON', 'GI', 'PENYULANG', 'PMT/RECLOSER', 'RECLOSER/PMCB', 'TGL TRIP', 'JAM', 'WAKTU', 'TGL NORMAL', 'NORMAL', 'LAMA PADAM', 'BEBAN SEBELUM', 'R', 'S', 'T', 'N', 'ENS', 'TEMPORER/ PERMANEN', 'RELAY', 'PENYEBAB', 'CUACA', 'KATEGORI', 'KODE GANGGUAN', 'KODE', 'ZONA', 'SECTION', 'KONSTRUKSI', 'Koordinat (x,y)'];
        $row = fn (array $o) => array_map(fn ($h) => $o[$h] ?? '', $head);
        $rows = array_merge([
            $row(['NO' => '1', 'TANGGAL' => '01 January 2020', 'RAYON' => 'MOJOSARI', 'GI' => 'MOJOSARI', 'PENYULANG' => 'MOJOANYAR', 'PMT/RECLOSER' => 'PMT', 'TGL TRIP' => '01 Jan 2020', 'JAM' => '17:08', 'LAMA PADAM' => '0:01', 'BEBAN SEBELUM' => '202', 'ENS' => '99', 'TEMPORER/ PERMANEN' => 'TEMPORER', 'PENYEBAB' => 'Pohon, tertiup "angin"'.", sambil\nbaris dua", 'KATEGORI' => 'ROW', 'WAKTU' => '#REF!']),
            $row(['NO' => '2', 'TANGGAL' => '02 January 2020', 'RAYON' => 'MOJOSARI', 'GI' => 'MOJOAGUNG', 'PENYULANG' => 'Betek', 'PMT/RECLOSER' => 'RECLOSER', 'TGL TRIP' => '02 Jan 2020', 'JAM' => '1:09', 'LAMA PADAM' => '0:45', 'N' => '35,0', 'ENS' => '2,849', 'TEMPORER/ PERMANEN' => 'PERMANEN']),
            $row(['NO' => '3', 'TANGGAL' => '03 February 2020', 'RAYON' => '#N/A', 'GI' => 'MOJOSARI', 'PENYULANG' => 'MOJOANYAR', 'PMT/RECLOSER' => 'REC NON JURNAL', 'JAM' => '9:05', 'LAMA PADAM' => '1:30', 'ENS' => '#NUM!', 'TEMPORER/ PERMANEN' => 'PERMANEN']),
            $row(['NO' => '4', 'TANGGAL' => '04 January 2020', 'GI' => 'MOJOSARI', 'PENYULANG' => 'MOJOANYAR', 'JAM' => '']),               // no time: rejected
            $row(['NO' => '5', 'TANGGAL' => '05 January 2020', 'GI' => 'MOJOSARI', 'PENYULANG' => '#REF!', 'JAM' => '10:00']),              // no feeder: rejected
            $row(['NO' => '6', 'TANGGAL' => '01 January 2020', 'RAYON' => 'MOJOSARI', 'GI' => 'MOJOSARI', 'PENYULANG' => 'MOJOANYAR', 'PMT/RECLOSER' => 'PMT', 'TGL TRIP' => '01 Jan 2020', 'JAM' => '17:08', 'LAMA PADAM' => '0:01', 'TEMPORER/ PERMANEN' => 'TEMPORER']),   // identical minute, GI, feeder, device: a second event
            $row(['NO' => '7', 'TANGGAL' => '02 Agustus 2020', 'RAYON' => 'MOJOSARI', 'GI' => 'SEKAR PUTIH', 'PENYULANG' => 'BENTENG', 'PMT/RECLOSER' => 'PMT', 'JAM' => '08:00', 'LAMA PADAM' => '0:10', 'TEMPORER/ PERMANEN' => 'TEMPORER']),   // feeder unknown to the master
        ], $extra);
        $out = fopen('php://temp', 'r+');
        fputcsv($out, ['', '', '']);
        fputcsv($out, ['ANALISA GANGGUAN PENYULANG DAN RECLOSER']);
        fputcsv($out, ['AREA MOJOKERTO']);
        fputcsv($out, []);
        fputcsv($out, $head);
        foreach ($rows as $r) {
            fputcsv($out, $r);
        }
        rewind($out);

        return stream_get_contents($out);
    }

    private function fake(?string $csv = null, int $status = 200): void
    {
        Http::swap(new Factory);                                      // a new fake replaces the earlier one (the first matching stub would win)
        Http::fake(['docs.google.com/*' => Http::response($csv ?? $this->csv(), $status, ['Content-Type' => 'text/csv'])]);
    }

    private function configure(array $over = []): void
    {
        $this->as($this->admin)->putJson('/api/outages/sync/settings', $over + ['sheet_url' => 'https://docs.google.com/spreadsheets/d/'.self::SHEET.'/edit?gid=1825838358#gid=1825838358', 'auto_enabled' => false, 'auto_time' => '06:30', 'saidi_min_minutes' => 5, 'saidi_only_permanent' => false])->assertOk();
    }

    #[Test]
    public function the_parser_reads_the_irregular_cells_of_the_sheet(): void
    {
        $r = (new OutageSheetParser)->parse($this->csv(), 'Asia/Jakarta');
        $this->assertSame(7, $r['read']);
        $this->assertCount(2, $r['invalid']);
        $this->assertSame(['tanggal tidak terbaca' => 0, 'jam tidak terbaca' => 1, 'penyulang kosong' => 1], ['tanggal tidak terbaca' => 0] + array_count_values(array_column($r['invalid'], 'reason')));
        [$a, $b, $c] = $r['rows'];
        $this->assertSame('2020-01-01 17:08', $a['occurred_at']->format('Y-m-d H:i'));
        $this->assertSame(['Asia/Jakarta', 1.0, 99.0, 'PMT', 'TEMPORER'], [$a['occurred_at']->getTimezone()->getName(), $a['duration_minutes'], $a['ens_kwh'], $a['device_group'], $a['outage_type']]);
        $this->assertStringContainsString("sambil\nbaris dua", $a['cause']);                       // a quoted cell with a comma, quotes and a line break stays one cell
        $this->assertSame([2849.0, 35.0, 45.0, 'RECLOSER', 'PERMANEN'], [$b['ens_kwh'], $b['current_n'], $b['duration_minutes'], $b['device_group'], $b['outage_type']]);    // "2,849" thousands, "35,0" decimal comma
        $this->assertSame([null, null, 'RECLOSER', 90.0], [$c['ens_kwh'], $c['rayon'], $c['device_group'], $c['duration_minutes']]);                                         // #NUM! and #N/A become empty
        $this->assertSame('2020-08-02', collect($r['rows'])->last()['occurred_at']->format('Y-m-d'));                             // Indonesian month name
    }

    #[Test]
    public function the_sheet_is_read_matched_to_feeders_and_ulps_and_a_second_run_changes_nothing(): void
    {
        $this->fake();
        $this->configure();
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $run = DB::table('outage_sync_runs')->first();
        $this->assertSame('OK', $run->status, (string) $run->message);
        $counts = json_decode($run->counts, true);
        $this->assertSame([7, 5, 0, 0, 2, 1], [$counts['read'], $counts['inserted'], $counts['updated'], $counts['unchanged'], $counts['invalid'], $counts['unmatched_feeders']]);
        $this->assertSame(5, DB::table('outage_events')->count());                              // 5 valid lines, the identical pair stays two events
        $e = DB::table('outage_events')->where('feeder_name', 'Betek')->first();
        $this->assertNotNull($e->feeder_id);                                                      // matched by name ignoring case
        $this->assertSame($this->ulpA->getKey(), $e->organizational_unit_id);                     // RAYON MOJOSARI -> ULP Mojosari
        $this->assertSame(['ULP Mojosari'], DB::table('organizational_units')->where('id', DB::table('outage_events')->where('rayon', null)->value('organizational_unit_id') ?? $this->ulpA->getKey())->pluck('name')->all());
        $this->assertNull(DB::table('outage_events')->where('feeder_name', 'BENTENG')->value('feeder_id'));

        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $second = json_decode(DB::table('outage_sync_runs')->orderByDesc('created_at')->first()->counts, true);
        $this->assertSame([5, 0, 0], [$second['unchanged'], $second['inserted'], $second['updated']]);   // idempotent
        $this->assertSame(5, DB::table('outage_events')->count());
    }

    #[Test]
    public function a_changed_line_is_updated_and_a_vanished_line_is_only_marked_and_a_broken_read_is_refused(): void
    {
        $this->fake();
        $this->configure();
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);

        $edited = str_replace('99', '120', $this->csv());                                         // the ENS of line 1
        $without = array_slice(explode("\n", trim($edited)), 0, -2);
        $this->fake(implode("\n", $without)."\n");
        $this->travel(2)->seconds();     // riwayat diurutkan menurut created_at yang hanya sampai detik
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $run = json_decode(DB::table('outage_sync_runs')->orderByDesc('created_at')->first()->counts, true);
        $this->assertGreaterThanOrEqual(1, $run['updated']);
        $this->assertGreaterThanOrEqual(1, $run['removed']);
        $this->assertSame(5, DB::table('outage_events')->count());                              // nothing is deleted
        $this->assertSame($run['removed'], DB::table('outage_events')->whereNotNull('source_removed_at')->count());

        $this->fake("NO,TANGGAL,PENYULANG\n");                                                    // an (almost) empty sheet must not wipe the data
        $this->travel(2)->seconds();
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $last = DB::table('outage_sync_runs')->orderByDesc('created_at')->first();
        $this->assertSame('FAILED', $last->status);
        $this->assertStringContainsString('dibatalkan', (string) $last->message);
    }

    #[Test]
    public function an_unshared_or_unreachable_sheet_fails_with_a_clear_reason_and_without_leaking_the_address(): void
    {
        $this->configure();
        $this->fake('<!DOCTYPE html><html></html>');
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $run = DB::table('outage_sync_runs')->first();
        $this->assertSame('FAILED', $run->status);
        $this->assertStringContainsString('tidak mengembalikan CSV', (string) $run->message);
        $this->assertStringNotContainsString(self::SHEET, (string) $run->message);
        $this->fake('', 404);
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $this->assertStringContainsString('HTTP 404', (string) DB::table('outage_sync_runs')->orderByDesc('created_at')->first()->message);
    }

    #[Test]
    public function a_run_that_never_started_cannot_lock_the_button_and_a_launch_failure_marks_the_run_failed(): void
    {
        $this->configure();
        // sisa klik yang gagal memulai proses: terdaftar tetapi tidak pernah berjalan
        $stale = (string) Str::uuid();
        $lock = ['trigger' => 'MANUAL', 'status' => 'QUEUED', 'up3_id' => $this->ulpA->parent_id, 'sync_source' => 'gangguan', 'sync_dataset' => 'events'];
        DB::table('outage_sync_runs')->insert(['id' => $stale, 'status' => 'FAILED', 'created_at' => now()] + $lock);
        DB::table('outage_sync_runs')->where('id', $stale)->update(['status' => 'QUEUED', 'created_at' => now()->subMinutes(30)]);
        $fresh = (string) Str::uuid();
        $runs = $this->as($this->admin)->getJson('/api/outages/sync')->assertOk()->json('data.runs');                      // membaca status membersihkan yang macet
        $byId = collect($runs)->keyBy('id');
        $this->assertSame('FAILED', $byId[$stale]['status']);
        $this->assertStringContainsString('proses tidak selesai', $byId[$stale]['message']);
        DB::table('outage_sync_runs')->insert(['id' => $fresh, 'created_at' => now()->subMinute()] + $lock);
        DB::table('sync_locks')->insert(['source' => 'gangguan', 'dataset' => 'events', 'target_id' => $this->ulpA->parent_id, 'run_table' => 'outage_sync_runs', 'run_id' => $fresh]);
        $this->assertSame('QUEUED', $this->as($this->admin)->getJson('/api/outages/sync/runs/'.$fresh)->assertOk()->json('data.status'));   // yang baru masih boleh menunggu
        $this->assertSame('FAILED', $this->as($this->admin)->getJson('/api/outages/sync/runs/'.$stale)->assertOk()->json('data.status'));
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(409);                                      // masih ada yang berjalan: tidak ditumpuk

        // proses tidak dapat dimulai: run tidak dibiarkan Menunggu
        DB::table('outage_sync_runs')->where('id', $fresh)->delete();
        Artisan::shouldReceive('call')->andThrow(new \RuntimeException('boom'));
        $this->withoutExceptionHandling();
        try {
            $this->as($this->admin)->postJson('/api/outages/sync/runs');
            $this->fail('Galat peluncuran seharusnya diteruskan.');
        } catch (\RuntimeException $e) {
            $this->assertSame('boom', $e->getMessage());
        }
        $last = DB::table('outage_sync_runs')->orderByDesc('created_at')->first();
        $this->assertSame('FAILED', $last->status);
        $this->assertStringContainsString('tidak dapat dimulai: boom', (string) $last->message);
        $this->assertFalse(DB::table('outage_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists());              // tombol tidak terkunci
    }

    #[Test]
    public function the_sheet_address_is_validated_and_the_settings_never_return_it_in_full(): void
    {
        $this->as($this->admin)->putJson('/api/outages/sync/settings', ['sheet_url' => 'https://contoh.com/x', 'auto_enabled' => false, 'auto_time' => '06:30', 'saidi_min_minutes' => 5, 'saidi_only_permanent' => false])->assertStatus(409);
        $this->as($this->admin)->putJson('/api/outages/sync/settings', ['auto_enabled' => true, 'auto_time' => '06:30', 'saidi_min_minutes' => 5, 'saidi_only_permanent' => false])->assertStatus(409);   // daily sync needs a source
        $this->configure();
        $r = $this->as($this->admin)->getJson('/api/outages/sync')->assertOk();
        $this->assertSame([1825838358], $r->json('data.settings.gids'));
        $this->assertStringNotContainsString(self::SHEET, $r->getContent());
        $this->assertSame(5, $r->json('data.settings.saidi_min_minutes'));
    }

    #[Test]
    public function the_daily_sync_starts_once_when_due_and_only_the_planning_side_may_change_anything(): void
    {
        $this->fake();
        $this->configure(['auto_enabled' => true, 'auto_time' => '00:00']);
        $this->artisan('distriva:outage-sync-scheduled')->assertSuccessful();
        $this->artisan('distriva:outage-sync-scheduled')->assertSuccessful();
        $this->assertSame(1, DB::table('outage_sync_runs')->where('trigger', 'AUTO')->count());      // once a day
        $this->assertSame('OK', DB::table('outage_sync_runs')->where('trigger', 'AUTO')->value('status'));

        $this->as($this->viewer)->getJson('/api/outages/sync')->assertOk()->assertJsonPath('data.can.sync', false);
        $this->as($this->viewer)->postJson('/api/outages/sync/runs')->assertForbidden();
        $this->as($this->viewer)->putJson('/api/outages/sync/settings', ['auto_enabled' => false, 'auto_time' => '06:30', 'saidi_min_minutes' => 5, 'saidi_only_permanent' => false])->assertForbidden();
        $this->as($this->niaga)->getJson('/api/outages/sync')->assertForbidden();

        // menu di frontend mengikuti peta izin ini
        $this->as($this->viewer)->getJson('/api/planning/access')->assertOk()->assertJson(['can' => ['outages.view' => true, 'outages.sync' => false]]);
        $this->as($this->admin)->getJson('/api/planning/access')->assertOk()->assertJson(['can' => ['outages.sync' => true]]);
        $this->as($this->niaga)->getJson('/api/planning/access')->assertOk()->assertJson(['can' => ['outages.view' => false]]);
    }

    #[Test]
    public function an_unmatched_feeder_can_be_mapped_and_the_existing_events_follow(): void
    {
        $this->fake();
        $this->configure();
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $u = $this->as($this->admin)->getJson('/api/outages/sync')->assertOk()->json('data.unmatched');
        $this->assertSame(['BENTENG', 1], [$u[0]['feeder_name'], $u[0]['events']]);
        $fid = (string) DB::table('distribution_feeders')->where('code', 'BTK')->value('id');
        $this->as($this->admin)->postJson('/api/outages/sync/aliases', ['gi_name' => 'SEKAR PUTIH', 'feeder_name' => 'BENTENG', 'feeder_id' => $fid])->assertOk()->assertJsonPath('data.updated_events', 1);
        $this->assertSame($fid, DB::table('outage_events')->where('feeder_name', 'BENTENG')->value('feeder_id'));
        $this->as($this->admin)->postJson('/api/outages/sync/runs')->assertStatus(202);
        $this->assertSame($fid, DB::table('outage_events')->where('feeder_name', 'BENTENG')->value('feeder_id'));   // the next sync keeps the mapping
        $this->assertSame([], $this->as($this->admin)->getJson('/api/outages/sync')->json('data.unmatched'));
    }
}
