<?php

namespace Tests\Feature;

use App\Models\OrganizationalUnit;
use App\Models\Role;
use App\Models\User;
use App\Services\Applications\EisSyncService;
use App\Services\EisReports\ApktSaidiSaifiSync;
use Database\Seeders\ApplicationPermissionSeeder;
use Database\Seeders\EisReportPermissionSeeder;
use Database\Seeders\SurveyPermissionSeeder;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\Attributes\Test;
use Tests\PostgresTestCase;

class EisImportTest extends PostgresTestCase
{
    private const COLS = ['NOAGENDA', 'NO_REGISTRASI', 'TGLMOHON', 'IDPEL', 'NAMA', 'ALAMAT', 'NOTELP_PEMOHON', 'NOTELP_HP_PEMOHON', 'TARIF_LAMA', 'DAYA_LAMA', 'TARIF', 'DAYA', 'JENIS_TRANSAKSI', 'PAKET_SAR',
        'TOTALBIAYA', 'TGLBAYAR', 'DURASI_HARI_KERJA', 'KRITERIA_TMP', 'STATUS_PERMOHONAN', 'TGL_UPDATE_PERMOHONAN', 'NAMAUP', 'UNITTUJUAN'];

    private OrganizationalUnit $upA;

    private OrganizationalUnit $ulpA1;

    private OrganizationalUnit $ulpA2;

    private User $retailA1;

    private User $retailA2;

    private User $manager;

    private User $vendor;

    private User $sysAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(ApplicationPermissionSeeder::class);
        config(['distriva.eis_min_power_va' => 0]);       // the older tests use small powers; the 3-phase scope has its own test below
        config(['distriva.eis_new_statuses' => []]);      // ... and every status; the status scope has its own tests below
        $this->upA = $this->makeUnit('UP3');
        $this->ulpA1 = OrganizationalUnit::query()->create(['code' => '51453', 'name' => 'ULP Jombang', 'unit_type' => 'ULP', 'parent_id' => $this->upA->getKey(), 'is_active' => true]);
        $this->ulpA2 = OrganizationalUnit::query()->create(['code' => '51454', 'name' => 'ULP Mojoagung', 'unit_type' => 'ULP', 'parent_id' => $this->upA->getKey(), 'is_active' => true]);
        $mk = function (string $role, ?OrganizationalUnit $unit): User {
            $u = $this->makeUser();
            $this->assign($u, Role::query()->where('name', $role)->firstOrFail(), $unit);

            return $u;
        };
        $this->retailA1 = $mk('NIAGA_RETAIL', $this->ulpA1);
        $this->retailA2 = $mk('NIAGA_RETAIL', $this->ulpA2);
        $this->manager = $mk('MANAGER_ULP', $this->ulpA1);
        $this->vendor = $mk('VENDOR', $this->ulpA1);
        $this->sysAdmin = $mk('SYS_ADMIN', null);
    }

    private function as(User $u): static
    {
        $this->app['auth']->forgetGuards();
        $token = $u->createToken('t');
        $token->accessToken->forceFill(['mfa_verified_at' => now()])->save();

        return $this->withToken($token->plainTextToken);
    }

    /** @param array<string,string> $over @return array<string,string> */
    private function row(array $over = []): array
    {
        return array_merge(array_fill_keys(self::COLS, ''), [
            'NOAGENDA' => '514539912610278000', 'NO_REGISTRASI' => '5145312117074', 'TGLMOHON' => '27/10/2026', 'IDPEL' => '514532073698', 'NAMA' => 'YOYON SUGIARTO', 'ALAMAT' => 'DN KEDUNG, JOMBANG',
            'NOTELP_HP_PEMOHON' => '6281334022476', 'TARIF' => 'R1MT', 'DAYA' => '900', 'JENIS_TRANSAKSI' => 'PASANG BARU', 'PAKET_SAR' => 'Prabayar', 'TOTALBIAYA' => '863000', 'TGLBAYAR' => '2/11/2026',
            'DURASI_HARI_KERJA' => '4', 'KRITERIA_TMP' => 'Lebih dari 24 Hari', 'STATUS_PERMOHONAN' => 'DISETUJUI', 'TGL_UPDATE_PERMOHONAN' => '5/11/2026', 'NAMAUP' => 'ULP JOMBANG', 'UNITTUJUAN' => '51453',
        ], $over);
    }

    /** @param list<array<string,string>> $rows */
    private function csv(array $rows, array $cols = self::COLS): string
    {
        $h = fopen('php://memory', 'w+');
        fputcsv($h, $cols, ',', '"', '');
        foreach ($rows as $r) {
            fputcsv($h, array_map(fn ($c) => $r[$c] ?? '', $cols), ',', '"', '');
        }
        rewind($h);

        return (string) stream_get_contents($h);
    }

    private function upload(array $rows, ?User $by = null, string $name = 'eis.csv', ?string $content = null)
    {
        return $this->as($by ?? $this->retailA1)->post('/api/applications/imports', ['file' => UploadedFile::fake()->createWithContent($name, $content ?? $this->csv($rows))], ['Accept' => 'application/json']);
    }

    /** @return array{id:string, res:TestResponse} */
    private function stage(array $rows, ?User $by = null): array
    {
        $r = $this->upload($rows, $by)->assertCreated();

        return ['id' => $r->json('data.id'), 'res' => $r];
    }

    private function confirm(string $id, ?User $by = null)
    {
        return $this->as($by ?? $this->retailA1)->postJson("/api/applications/imports/{$id}/confirm");
    }

    private function rows(string $id, ?User $by = null): array
    {
        return collect($this->as($by ?? $this->retailA1)->getJson("/api/applications/imports/{$id}?per_page=200")->assertOk()->json('rows'))->keyBy('row')->all();
    }

    // ---- authorization --------------------------------------------------------------------------

    #[Test]
    public function only_niaga_retail_and_sys_admin_can_import(): void
    {
        $holders = DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.name', 'applications.import')->orderBy('r.name')->pluck('r.name')->all();
        $this->assertSame(['NIAGA_RETAIL', 'SYS_ADMIN'], $holders);
        $this->upload([$this->row()], $this->manager)->assertForbidden();
        $this->upload([$this->row()], $this->vendor)->assertForbidden();
        $this->as($this->manager)->getJson('/api/applications/imports')->assertForbidden();
        $this->as($this->retailA1)->post('/api/applications/imports', [], ['Accept' => 'application/json'])->assertUnprocessable();      // grant first, then validation
        $this->as($this->vendor)->post('/api/applications/imports', [], ['Accept' => 'application/json'])->assertForbidden();
    }

    // ---- staging / classification -------------------------------------------------------------------

    #[Test]
    public function staging_classifies_every_row_and_writes_nothing_to_applications_before_confirmation(): void
    {
        $rows = [
            $this->row(),                                                                                                   // 2 NEW
            $this->row(['NOAGENDA' => '514539922610278000', 'IDPEL' => '514530857574', 'NAMA' => 'HOSEA', 'JENIS_TRANSAKSI' => 'PERUBAHAN DAYA', 'TARIF_LAMA' => 'R1T', 'DAYA_LAMA' => '2200', 'TARIF' => 'R2T', 'DAYA' => '3500']), // 3 NEW PD
            $this->row(['NOAGENDA' => '514539912610268000', 'UNITTUJUAN' => '51455']),                                    // 4 unknown unit
            $this->row(['NOAGENDA' => '514539912610268001', 'JENIS_TRANSAKSI' => 'PINDAH LOKASI']),                        // 5 unmapped type
            $this->row(['NOAGENDA' => '514539912610268002', 'UNITTUJUAN' => '51454']),                                    // 6 other ULP: outside scope
            $this->row(),                                                                                                   // 7 duplicate agenda in file
            $this->row(['NOAGENDA' => '']),                                                                                 // 8 no agenda
            $this->row(['NOAGENDA' => '514539912610268003', 'NAMA' => '']),                                               // 9 no name
        ];
        $s = $this->stage($rows);
        $this->assertSame(['NEW' => 2, 'MATCHED' => 0, 'UNCHANGED' => 0, 'REJECT' => 6, 'OUT_OF_SCOPE' => 0, 'OUT_OF_SCOPE_POWER' => 0, 'OUT_OF_SCOPE_STATUS' => 0], $s['res']->json('data.counts'));
        $this->assertSame(0, DB::table('applications')->count());
        $this->assertSame(0, DB::table('customers')->count());

        $r = $this->rows($s['id']);
        $this->assertSame('NEW', $r[2]['action']);
        $this->assertSame('NEW', $r[3]['action']);
        $this->assertStringContainsString('51455 tidak ada', $r[4]['errors'][0]);
        $this->assertStringContainsString("'PINDAH LOKASI' belum dipetakan", $r[5]['errors'][0]);
        $this->assertStringContainsString('di luar scope', $r[6]['errors'][0]);
        $this->assertStringContainsString('lebih dari sekali', $r[7]['errors'][0]);
        $this->assertStringContainsString('NOAGENDA kosong', $r[8]['errors'][0]);
        $this->assertStringContainsString('NAMA kosong', $r[9]['errors'][0]);
        // the agenda is kept as TEXT, byte for byte
        $this->assertSame('514539912610278000', DB::table('application_import_staging')->where('row_number', 2)->value('source_reference_id'));
        $this->assertSame('514539912610278000', json_decode((string) DB::table('application_import_staging')->where('row_number', 2)->value('payload'), true)['NOAGENDA']);
    }

    #[Test]
    public function missing_required_columns_and_unreadable_files_are_refused(): void
    {
        $cols = array_values(array_diff(self::COLS, ['UNITTUJUAN']));
        $this->upload([$this->row()], null, 'x.csv', $this->csv([$this->row()], $cols))->assertStatus(409);
        $this->upload([], null, 'x.csv', '')->assertStatus(409);
        $this->upload([], null, 'x.xls', "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1".str_repeat("\0", 64))->assertStatus(409);        // a corrupt binary .xls is refused
        $this->upload([], null, 'x.csv', $this->csv([]))->assertStatus(409);                                              // header only
    }

    // ---- confirmation: NEW ------------------------------------------------------------------------------

    #[Test]
    public function confirmation_creates_applications_with_the_owner_status_mapping_and_the_external_references(): void
    {
        $s = $this->stage([
            $this->row(),
            $this->row(['NOAGENDA' => '514539922610278000', 'IDPEL' => '514530857574', 'NAMA' => 'HOSEA', 'NO_REGISTRASI' => '', 'JENIS_TRANSAKSI' => 'PERUBAHAN DAYA', 'TARIF_LAMA' => 'R1T', 'DAYA_LAMA' => '2200', 'TARIF' => 'R2T',
                'DAYA' => '3500', 'STATUS_PERMOHONAN' => 'PEREMAJAAN', 'TGL_UPDATE_PERMOHONAN' => '28/10/2026', 'NOTELP_HP_PEMOHON' => '82245052936']),
            $this->row(['NOAGENDA' => '514539912610268000', 'IDPEL' => '', 'NAMA' => 'NUNUK', 'STATUS_PERMOHONAN' => 'STATUS ANEH', 'NOTELP_HP_PEMOHON' => '6.28565E+12']),
        ]);
        $res = $this->confirm($s['id'])->assertOk();
        $this->assertSame(['APPLIED' => 3, 'SKIPPED' => 0, 'FAILED' => 0], $res->json('result'), json_encode(DB::table('application_import_staging')->where('apply_status', 'FAILED')->pluck('apply_message')));

        $a = DB::table('applications')->where('source_reference_id', '514539912610278000')->first();
        $this->assertSame(['BOT_DAFTUNG', 'APPROVED', 'PB', $this->ulpA1->getKey()], [$a->source_type, $a->current_status, $a->application_type, $a->organizational_unit_id]);
        $this->assertSame('VA', $a->new_power_unit);
        $this->assertEquals(0.9, $a->delta_power_kva);
        $this->assertSame('2026-10-27', substr((string) $a->source_created_at, 0, 10));
        $this->assertEquals(863000, $a->total_cost);

        $pd = DB::table('applications')->where('source_reference_id', '514539922610278000')->first();
        $this->assertSame(['CONNECTION_DONE', 'PD'], [$pd->current_status, $pd->application_type]);   // PEREMAJAAN = selesai penyambungan
        $this->assertEquals(1.3, $pd->delta_power_kva);                                               // 3500 VA - 2200 VA
        $this->assertSame('+6282245052936', DB::table('customers')->where('id', $pd->customer_id)->value('phone'));   // leading 0 lost by a spreadsheet

        $unmapped = DB::table('applications')->where('source_reference_id', '514539912610268000')->first();
        $this->assertSame('APPROVED', $unmapped->current_status);                                      // agenda issued, status not mapped
        $this->assertNull(DB::table('customers')->where('id', $unmapped->customer_id)->value('phone'));   // scientific notation: never trusted

        $this->assertSame(['5145312117074'], DB::table('application_external_references')->where('application_id', $a->id)->where('reference_type', 'PAYMENT_REGISTER')->pluck('reference_number')->all());
        $this->assertSame('514539912610278000', DB::table('application_external_references')->where('application_id', $a->id)->where('reference_type', 'AGENDA')->value('reference_number'));
        $this->assertSame('DISETUJUI', DB::table('application_external_status_histories')->where('application_id', $a->id)->value('external_status_code'));
        $this->assertSame(4, DB::table('application_external_status_histories')->where('application_id', $a->id)->value('service_days'));
        $this->assertSame([[null, 'APPROVED']], DB::table('application_status_histories')->where('application_id', $a->id)->get(['from_status', 'to_status'])->map(fn ($h) => [$h->from_status, $h->to_status])->all());
        $this->assertStringContainsString('belum dipetakan', json_encode($this->rows($s['id'])[4]['warnings']));
        $this->assertSame(0, DB::table('application_external_references')->where('application_id', $unmapped->id)->where('reference_type', 'PAYMENT_REGISTER')->count());   // row 3 repeats row 1's No. Register: not linked twice
    }

    #[Test]
    public function one_customer_per_idpel_applications_link_to_it_and_there_is_no_automatic_merge_without_an_idpel(): void
    {
        $this->confirm($this->stage([$this->row(), $this->row(['NOAGENDA' => '514539912610278001', 'JENIS_TRANSAKSI' => 'PERUBAHAN DAYA', 'DAYA_LAMA' => '900', 'DAYA' => '1300', 'NAMA' => 'NAMA BEDA']),
            $this->row(['NOAGENDA' => '514539912610278002', 'IDPEL' => '']), $this->row(['NOAGENDA' => '514539912610278003', 'IDPEL' => ''])])['id'])->assertOk();

        $this->assertSame(3, DB::table('customers')->count());                                  // 1 for the IDPEL (shared) + 2 customers without IDPEL
        $this->assertSame(2, DB::table('applications')->where('customer_id', DB::table('customer_external_references')->value('customer_id'))->count());
    }

    #[Test]
    public function dates_are_d_m_yyyy_and_excel_serial_numbers_are_never_used(): void
    {
        $s = $this->stage([$this->row(['TGLMOHON' => '46064', 'TGL_UPDATE_PERMOHONAN' => '46153', 'TGLBAYAR' => '31/02/2026'])]);
        $w = json_encode($this->rows($s['id'])[2]['warnings'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $this->assertStringContainsString('angka serial Excel', $w);
        $this->assertStringContainsString('bukan tanggal d/m/yyyy', $w);
        $this->assertStringContainsString('urutan waktu tidak dapat ditentukan', $w);
        $this->confirm($s['id'])->assertOk();
        $a = DB::table('applications')->first();
        $this->assertNull($a->source_created_at);
        $this->assertNull($a->last_external_status_at);
        $this->assertSame('APPROVED', $a->current_status);                                     // no observed date: status not trusted blindly (default APPROVED)
    }

    // ---- synchronisation of existing applications (MATCHED) ------------------------------------------------

    #[Test]
    public function an_existing_application_is_refreshed_only_in_its_working_days_and_status_with_a_change_log(): void
    {
        $this->confirm($this->stage([$this->row()])['id'])->assertOk();
        $id = DB::table('applications')->value('id');
        $before = DB::table('applications')->where('id', $id)->first();
        $name = DB::table('customers')->where('id', $before->customer_id)->value('name');

        $s = $this->stage([$this->row(['NAMA' => 'YOYON S.', 'ALAMAT' => 'JL BARU 9', 'DAYA' => '1300', 'TARIF' => 'R1T', 'TOTALBIAYA' => '900000', 'NO_REGISTRASI' => '5145399999999', 'STATUS_PERMOHONAN' => 'SUDAH BAYAR', 'TGL_UPDATE_PERMOHONAN' => '10/11/2026',
            'DURASI_HARI_KERJA' => '6', 'NOTELP_HP_PEMOHON' => '6289999999999'])]);
        $this->assertSame(1, $s['res']->json('data.counts.MATCHED'));
        $preview = $this->rows($s['id'])[2]['changes'];
        foreach (['service_days', 'status'] as $f) {
            $this->assertArrayHasKey($f, $preview, $f);
        }
        foreach (['customer.name', 'customer.phone', 'service_address', 'new_power', 'new_tariff_code', 'total_cost', 'payment_register'] as $f) {
            $this->assertArrayNotHasKey($f, $preview, $f);                                    // owner 2026-11-13: nothing else of an existing application is touched
        }
        $this->assertSame(0, DB::table('application_change_logs')->count());                  // preview only

        $this->confirm($s['id'])->assertOk()->assertJsonPath('result.APPLIED', 1);
        $a = DB::table('applications')->where('id', $id)->first();
        $this->assertSame(['PAID', 6], [$a->current_status, (int) $a->service_days]);
        $this->assertSame([$before->service_address, $before->new_tariff_code, $before->total_cost], [$a->service_address, $a->new_tariff_code, $a->total_cost]);
        $this->assertSame($name, DB::table('customers')->where('id', $a->customer_id)->value('name'));
        $this->assertSame('2026-11-10', substr((string) $a->last_external_status_at, 0, 10));
        $this->assertSame(0, DB::table('application_change_logs')->where('application_id', $id)->count());   // the working days move daily and the status has its own histories: nothing else was changed to log
        $this->assertSame(2, DB::table('application_external_status_histories')->where('application_id', $id)->count());
        $this->assertSame(['APPROVED', 'PAID'], DB::table('application_status_histories')->where('application_id', $id)->orderBy('changed_at')->get()->pluck('to_status')->slice(-2)->values()->all());

        // the same file again changes nothing
        $again = $this->stage([$this->row(['NAMA' => 'YOYON S.', 'ALAMAT' => 'JL BARU 9', 'DAYA' => '1300', 'TARIF' => 'R1T', 'TOTALBIAYA' => '900000', 'NO_REGISTRASI' => '5145399999999', 'STATUS_PERMOHONAN' => 'SUDAH BAYAR', 'TGL_UPDATE_PERMOHONAN' => '10/11/2026', 'DURASI_HARI_KERJA' => '6'])]);
        $this->assertSame(1, $again['res']->json('data.counts.UNCHANGED'));
    }

    #[Test]
    public function a_power_or_tariff_change_in_the_file_does_not_touch_an_existing_application(): void
    {
        $this->confirm($this->stage([$this->row(['STATUS_PERMOHONAN' => 'SUDAH BAYAR'])])['id'])->assertOk();
        $power = DB::table('applications')->value('new_power_value');
        $again = $this->stage([$this->row(['STATUS_PERMOHONAN' => 'SUDAH BAYAR', 'DAYA' => '2200'])]);
        $this->assertSame(1, $again['res']->json('data.counts.UNCHANGED'));
        $this->confirm($again['id'])->assertOk();
        $this->assertEquals($power, DB::table('applications')->value('new_power_value'));
        $this->assertSame(0, DB::table('application_change_logs')->where('field_name', 'new_power')->count());
    }

    #[Test]
    public function an_older_status_does_not_overwrite_a_newer_one_and_a_terminal_status_is_protected(): void
    {
        $this->confirm($this->stage([$this->row(['STATUS_PERMOHONAN' => 'CETAK PK', 'TGL_UPDATE_PERMOHONAN' => '10/11/2026'])])['id'])->assertOk();
        $id = DB::table('applications')->value('id');

        $old = $this->stage([$this->row(['STATUS_PERMOHONAN' => 'SUDAH BAYAR', 'TGL_UPDATE_PERMOHONAN' => '08/11/2026'])]);
        $this->assertStringContainsString('tidak lebih baru', json_encode($this->rows($old['id'])[2]['warnings']));
        $this->confirm($old['id'])->assertOk();
        $this->assertSame('PK_PRINTED', DB::table('applications')->where('id', $id)->value('current_status'));
        $this->assertSame(2, DB::table('application_external_status_histories')->where('application_id', $id)->count());   // the stale status is still recorded

        $this->confirm($this->stage([$this->row(['STATUS_PERMOHONAN' => 'BATAL', 'TGL_UPDATE_PERMOHONAN' => '12/11/2026'])])['id'])->assertOk();
        $this->assertSame('CANCELLED', DB::table('applications')->where('id', $id)->value('current_status'));
        $this->confirm($this->stage([$this->row(['STATUS_PERMOHONAN' => 'PEREMAJAAN', 'TGL_UPDATE_PERMOHONAN' => '15/11/2026'])])['id'])->assertOk();
        $this->assertSame('CANCELLED', DB::table('applications')->where('id', $id)->value('current_status'));              // terminal: recorded, not applied
        $this->assertSame('RESTITUSI', 'RESTITUSI');
    }

    #[Test]
    public function refund_and_every_mapped_status_follow_the_owner_mapping(): void
    {
        $map = DB::table('external_status_mappings')->pluck('internal_status', 'external_status_code')->all();
        $this->assertSame(['DISETUJUI' => 'APPROVED', 'BAYAR' => 'PAID', 'SUDAH BAYAR' => 'PAID', 'CETAK PK' => 'PK_PRINTED', 'PDL AWAL' => 'CONNECTION_IN_PROGRESS', 'PEREMAJAAN' => 'CONNECTION_DONE', 'BATAL' => 'CANCELLED', 'RESTITUSI' => 'REFUNDED'], $map);
        $i = 0;
        foreach (array_keys($map) as $code) {
            $this->confirm($this->stage([$this->row(['NOAGENDA' => '5145'.str_pad((string) ++$i, 6, '0', STR_PAD_LEFT), 'IDPEL' => '', 'STATUS_PERMOHONAN' => $code])])['id'])->assertOk();
        }
        $got = DB::table('applications')->orderBy('source_reference_id')->pluck('current_status')->all();
        $this->assertSame(array_values($map), $got);
        $this->assertSame('PAID', $map['BAYAR']);                  // the code used by the real EIS download
    }

    #[Test]
    public function matching_conflicts_are_rejected_not_forced(): void
    {
        $this->confirm($this->stage([$this->row(), $this->row(['NOAGENDA' => '514539912610278001', 'IDPEL' => '777', 'NAMA' => 'LAIN'])])['id'])->assertOk();

        $r = $this->rows($this->stage([
            $this->row(['JENIS_TRANSAKSI' => 'PERUBAHAN DAYA']),                           // type can never change
        ])['id']);
        $this->assertSame('REJECT', $r[2]['action']);
        $this->assertStringContainsString('tipe tidak dapat diubah', $r[2]['errors'][0]);

        $r = $this->rows($this->stage([$this->row(['UNITTUJUAN' => '51454'])])['id']);     // other unit than the registered one (outside retailA1's scope too)
        $this->assertSame('REJECT', $r[2]['action']);

        $r = $this->rows($this->stage([$this->row(['IDPEL' => '777'])])['id']);           // owner 2026-11-13: the customer identity of an existing application is no longer synced, so a foreign IDPEL is not even looked at
        $this->assertSame('UNCHANGED', $r[2]['action']);
    }

    #[Test]
    public function an_empty_source_value_never_clears_data_and_an_absent_column_is_ignored(): void
    {
        $this->confirm($this->stage([$this->row()])['id'])->assertOk();
        $cols = ['NOAGENDA', 'NAMA', 'JENIS_TRANSAKSI', 'UNITTUJUAN'];
        $r = $this->upload([], null, 'x.csv', $this->csv([$this->row(['ALAMAT' => '', 'TARIF' => ''])], $cols))->assertCreated();
        $this->assertSame(1, $r->json('data.counts.UNCHANGED'));
        $this->confirm($r->json('data.id'))->assertOk();
        $a = DB::table('applications')->first();
        $this->assertSame(['DN KEDUNG, JOMBANG', 'R1MT'], [$a->service_address, $a->new_tariff_code]);
    }

    // ---- manual flow meets the bot ----------------------------------------------------------------------------

    #[Test]
    public function a_manual_draft_becomes_approved_when_the_agenda_is_filled_and_the_bot_then_synchronises_it(): void
    {
        $r = $this->as($this->retailA1)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA1->getKey(),
            'customer' => ['name' => 'Yoyon Manual', 'idpel' => '514532073698'], 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertCreated();
        $id = $r->json('data.id');
        $this->assertSame('DRAFT', $r->json('data.status'));

        $x = $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'AGENDA', 'reference_number' => '514539912610278000'])->assertCreated();
        $this->assertSame('APPROVED', $x->json('data.status'));
        $this->assertSame('DRAFT', $x->json('data.status_history.0.to_status'));
        $this->assertSame('APPROVED', $x->json('data.status_history.1.to_status'));
        $this->as($this->retailA1)->postJson("/api/applications/{$id}/external-references", ['reference_type' => 'PAYMENT_REGISTER', 'reference_number' => '5145312117074'])->assertCreated();

        $s = $this->stage([$this->row(['NAMA' => 'YOYON SUGIARTO', 'ALAMAT' => 'JL SYNC', 'STATUS_PERMOHONAN' => 'CETAK PK', 'TGL_UPDATE_PERMOHONAN' => '10/11/2026'])]);
        $this->assertSame(1, $s['res']->json('data.counts.MATCHED'));
        $this->confirm($s['id'])->assertOk();
        $a = DB::table('applications')->where('id', $id)->first();
        $this->assertSame(['MANUAL', 'PK_PRINTED', null], [$a->source_type, $a->current_status, $a->service_address]);   // origin stays MANUAL; the address is not taken from the file any more (only status and working days are)
        $this->assertSame(1, DB::table('customers')->count());
    }

    #[Test]
    public function after_the_draft_only_the_contact_phone_can_be_completed_manually(): void
    {
        $this->confirm($this->stage([$this->row(['NOTELP_HP_PEMOHON' => ''])])['id'])->assertOk();
        $id = DB::table('applications')->value('id');
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['service_address' => 'x'])->assertStatus(409);
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['customer' => ['name' => 'x']])->assertStatus(409);
        $this->as($this->retailA1)->patchJson("/api/applications/{$id}", ['customer' => ['phone' => '0812 3456 7890']])->assertOk()->assertJsonPath('data.customer.phone', '+6281234567890');
    }

    // ---- batches ------------------------------------------------------------------------------------------------

    #[Test]
    public function a_batch_is_confirmed_once_can_be_discarded_and_belongs_to_its_initiator_unless_sys_admin(): void
    {
        $s = $this->stage([$this->row()]);
        $this->as($this->retailA2)->getJson("/api/applications/imports/{$s['id']}")->assertNotFound();
        $this->confirm($s['id'], $this->retailA2)->assertNotFound();
        $this->as($this->retailA2)->postJson("/api/applications/imports/{$s['id']}/discard")->assertNotFound();
        $this->assertCount(0, $this->as($this->retailA2)->getJson('/api/applications/imports')->assertOk()->json('data'));
        $this->assertCount(1, $this->as($this->sysAdmin)->getJson('/api/applications/imports')->assertOk()->json('data'));

        $this->confirm($s['id'])->assertOk();
        $this->confirm($s['id'])->assertStatus(409);
        $this->as($this->retailA1)->postJson("/api/applications/imports/{$s['id']}/discard")->assertStatus(409);

        $d = $this->stage([$this->row(['NOAGENDA' => '514539912610278009'])]);
        $this->as($this->retailA1)->postJson("/api/applications/imports/{$d['id']}/discard")->assertOk();
        $this->confirm($d['id'])->assertStatus(409);
        $this->assertSame(1, DB::table('applications')->count());
        $this->assertSame(1, $this->stage([$this->row()])['res']->json('data.counts.UNCHANGED'));
        $this->assertTrue($this->upload([$this->row()])->json('data.same_file_already_confirmed'));
    }

    #[Test]
    public function sys_admin_imports_rows_of_every_unit_and_a_changed_world_between_staging_and_confirmation_is_handled(): void
    {
        $s = $this->stage([$this->row(), $this->row(['NOAGENDA' => '514539912610278010', 'UNITTUJUAN' => '51454', 'IDPEL' => '1'])], $this->sysAdmin);
        $this->assertSame(2, $s['res']->json('data.counts.NEW'));

        // somebody registers the same agenda in the meantime
        $other = $this->stage([$this->row()]);
        $this->confirm($other['id'])->assertOk();

        $res = $this->confirm($s['id'], $this->sysAdmin)->assertOk();
        $this->assertSame(['APPLIED' => 1, 'SKIPPED' => 1, 'FAILED' => 0], $res->json('result'));
        $this->assertSame(2, DB::table('applications')->count());
        $this->assertSame(1, DB::table('applications')->where('organizational_unit_id', $this->ulpA2->getKey())->count());
    }

    #[Test]
    public function a_niaga_retail_of_the_up3_imports_for_every_ulp_below_it_and_for_no_other_unit_while_manual_writes_stay_exact_ulp(): void
    {
        $niagaUp3 = $this->makeUser();
        $this->assign($niagaUp3, Role::query()->where('name', 'NIAGA_RETAIL')->firstOrFail(), $this->upA);
        $ulpOther = $this->makeUnit('ULP', $this->makeUnit('UP3'));

        $s = $this->stage([$this->row(), $this->row(['NOAGENDA' => '514539912610278010', 'UNITTUJUAN' => '51454', 'IDPEL' => '1']),
            $this->row(['NOAGENDA' => '514539912610278020', 'UNITTUJUAN' => $ulpOther->code, 'IDPEL' => '2'])], $niagaUp3);
        $this->assertSame(2, $s['res']->json('data.counts.NEW'));                         // the two ULPs below the UP3
        $this->assertSame(1, $s['res']->json('data.counts.REJECT'));                      // another UP3's ULP is rejected with the out-of-scope message
        $this->assertStringContainsString('di luar scope', json_encode($this->rows($s['id'], $niagaUp3)[4]['messages'] ?? $this->rows($s['id'], $niagaUp3)));

        $res = $this->confirm($s['id'], $niagaUp3)->assertOk();
        $this->assertSame(['APPLIED' => 2, 'SKIPPED' => 0, 'FAILED' => 0], $res->json('result'));
        $this->assertSame(1, DB::table('applications')->where('organizational_unit_id', $this->ulpA1->getKey())->count());
        $this->assertSame(1, DB::table('applications')->where('organizational_unit_id', $this->ulpA2->getKey())->count());
        $this->assertSame(0, DB::table('applications')->where('organizational_unit_id', $ulpOther->getKey())->count());

        // creating an application by hand is still exact-ULP: the UP3 account has no write scope
        $this->as($niagaUp3)->postJson('/api/applications', ['application_type' => 'PB', 'transaction_type' => 'PASANG BARU', 'organizational_unit_id' => $this->ulpA1->getKey(),
            'customer' => ['name' => 'Siti', 'phone' => '081234567890'], 'service_address' => 'Jl. A', 'new_power_value' => 900, 'new_power_unit' => 'VA'])->assertForbidden();
    }

    #[Test]
    public function the_limits_report_the_real_upload_limit_so_a_sync_can_cut_its_files_to_fit(): void
    {
        $r = $this->as($this->retailA1)->getJson('/api/applications/imports/limits')->assertOk();
        $this->assertSame(20000, $r->json('data.max_rows'));
        $this->assertSame(5120 * 1024, $r->json('data.max_bytes_config'));
        $this->assertSame(min(5120 * 1024, ...array_filter([$r->json('data.php_upload_max_bytes'), $r->json('data.php_post_max_bytes') - 65536], fn ($v) => $v > 0)), $r->json('data.effective_max_bytes'));
        $this->assertLessThanOrEqual($r->json('data.max_bytes_config'), $r->json('data.effective_max_bytes'));
        $this->as($this->vendor)->getJson('/api/applications/imports/limits')->assertForbidden();
    }

    #[Test]
    public function the_stale_report_lists_running_eis_applications_older_than_the_synced_range_within_the_scope(): void
    {
        // A: requested 27/10 (inside a range from 1 Oct), B: requested 1/5 and still running, C: requested 1/4 but already peremajaan, D: requested 1/6 in another ULP (running)
        $s = $this->stage([
            $this->row(),
            $this->row(['NOAGENDA' => '514539912610278010', 'TGLMOHON' => '1/5/2026', 'IDPEL' => '11', 'TGLBAYAR' => '', 'TGL_UPDATE_PERMOHONAN' => '5/5/2026']),
            $this->row(['NOAGENDA' => '514539912610278020', 'TGLMOHON' => '1/4/2026', 'IDPEL' => '12', 'STATUS_PERMOHONAN' => 'PEREMAJAAN', 'TGL_UPDATE_PERMOHONAN' => '5/10/2026']),
            $this->row(['NOAGENDA' => '514549912610278030', 'TGLMOHON' => '1/6/2026', 'IDPEL' => '13', 'UNITTUJUAN' => '51454', 'TGL_UPDATE_PERMOHONAN' => '5/6/2026']),
        ], $this->sysAdmin);
        $this->confirm($s['id'], $this->sysAdmin)->assertOk();

        $r = $this->as($this->sysAdmin)->getJson('/api/applications/imports/stale?before=2026-10-01')->assertOk();
        $this->assertSame(2, $r->json('data.total'));                                    // B and D; A is newer, C is closed
        $this->assertSame('2026-05-01', $r->json('data.oldest'));
        $this->assertSame(['51453' => 1, '51454' => 1], collect($r->json('data.by_unit'))->pluck('total', 'unit_code')->all());

        $mine = $this->as($this->retailA1)->getJson('/api/applications/imports/stale?before=2026-10-01')->assertOk();
        $this->assertSame(1, $mine->json('data.total'));                                 // only its own ULP
        $this->assertSame(0, $this->as($this->retailA1)->getJson('/api/applications/imports/stale?before=2026-04-15')->json('data.total'));   // B (1/5) is not older than 15/4
        $this->as($this->retailA1)->getJson('/api/applications/imports/stale')->assertUnprocessable();
        $this->as($this->vendor)->getJson('/api/applications/imports/stale?before=2026-10-01')->assertForbidden();
    }

    #[Test]
    public function the_change_log_and_the_external_status_history_are_append_only(): void
    {
        $this->confirm($this->stage([$this->row()])['id'])->assertOk();
        DB::table('application_change_logs')->insert(['id' => (string) Str::uuid(), 'application_id' => DB::table('applications')->value('id'), 'field_name' => 'x', 'new_value' => 'y', 'source' => 'IMPORT', 'needs_review' => false, 'changed_by' => $this->retailA1->getKey(), 'changed_at' => now()]);
        $this->assertDbRejects(fn () => DB::table('application_change_logs')->update(['new_value' => 'x']));
        $this->assertDbRejects(fn () => DB::table('application_change_logs')->delete());
        $this->assertDbRejects(fn () => DB::table('application_external_status_histories')->update(['external_status_code' => 'X']));
        $this->assertDbRejects(fn () => DB::table('application_external_status_histories')->delete());
        $this->assertDbRejects(fn () => DB::table('applications')->update(['current_status' => 'SOMETHING']));
    }

    // ---- file formats -------------------------------------------------------------------------------------------

    #[Test]
    public function xlsx_xls_and_html_downloads_are_read_with_text_cells_kept_as_text_and_date_cells_as_dates(): void
    {
        $row = $this->row(['TGLMOHON' => '2026-10-27', 'TGLBAYAR' => '2026-11-02', 'TGL_UPDATE_PERMOHONAN' => '2026-11-05']);
        foreach (['Xlsx' => 'xlsx', 'Xls' => 'xls'] as $writer => $format) {
            DB::table('application_import_staging')->delete();
            $r = $this->as($this->retailA1)->post('/api/applications/imports', ['file' => UploadedFile::fake()->createWithContent("eis.{$format}", $this->sheet(self::COLS, [$row], $writer))], ['Accept' => 'application/json'])->assertCreated();
            $this->assertSame([$format, 1], [$r->json('data.format'), $r->json('data.counts.NEW') + $r->json('data.counts.UNCHANGED')], $format);
            $this->assertSame('514539912610278000', DB::table('application_import_staging')->value('source_reference_id'));      // text cell, 18 digits intact
            $n = json_decode((string) DB::table('application_import_staging')->value('normalized'), true);
            $this->assertSame(['2026-10-27', '2026-11-02', '2026-11-05', 900.0], [$n['requested_at'], $n['paid_at'], $n['observed_at'], (float) $n['new_power']]);   // real date cells are dates
            DB::table('application_import_staging')->delete();
            DB::table('application_import_batches')->delete();
        }

        $html = '<html><body><table><tr>'.implode('', array_map(fn ($c) => "<th>{$c}</th>", self::COLS)).'</tr><tr>'.implode('', array_map(fn ($c) => '<td>'.htmlspecialchars($row[$c]).'</td>', self::COLS)).'</tr></table></body></html>';
        DB::table('application_import_staging')->delete();
        DB::table('application_import_batches')->delete();
        $r2 = $this->upload([], null, 'eis.xls', $html)->assertCreated();
        $this->assertSame('html', $r2->json('data.format'));
    }

    #[Test]
    public function the_real_download_shape_is_handled_trailing_spaces_empty_unit_code_other_transaction_types_and_the_bayar_status(): void
    {
        $rows = [
            $this->row(['NOAGENDA' => '514539922611019012 ', 'IDPEL' => '514531412077 ', 'UNITTUJUAN' => '', 'STATUS_PERMOHONAN' => 'BAYAR', 'TGLMOHON' => '2026-11-01', 'TGL_UPDATE_PERMOHONAN' => '2026-11-02']),   // empty UNITTUJUAN -> NAMAUP
            $this->row(['NOAGENDA' => '514539922611019013', 'JENIS_TRANSAKSI' => 'BALIK NAMA']),                                         // another transaction type
            $this->row(['NOAGENDA' => '514539922611019014', 'JENIS_TRANSAKSI' => 'PENERANGAN SEMENTARA']),
            $this->row(['NOAGENDA' => '514539922611019015', 'UNITTUJUAN' => '51450']),                                                  // a unit that is not in DISTRIVA
            $this->row(['NOAGENDA' => '514539922611019016', 'UNITTUJUAN' => '', 'NAMAUP' => 'ULP TIDAK ADA']),                             // empty code and unknown name
            $this->row(['NOAGENDA' => '514539922611019017', 'TGLMOHON' => '2026-11-05', 'TGLBAYAR' => '2026-02-11', 'TGL_UPDATE_PERMOHONAN' => '2026-05-11']),   // swapped day/month signature
        ];
        $s = $this->upload([], null, 'eis.xlsx', $this->sheet(self::COLS, $rows, 'Xlsx'))->assertCreated();
        $this->assertSame(['NEW' => 2, 'MATCHED' => 0, 'UNCHANGED' => 0, 'REJECT' => 4, 'OUT_OF_SCOPE' => 0, 'OUT_OF_SCOPE_POWER' => 0, 'OUT_OF_SCOPE_STATUS' => 0], $s->json('data.counts'));
        $r = $this->rows($s->json('data.id'));
        $this->assertSame('NEW', $r[2]['action']);
        $this->assertSame('514539922611019012', $r[2]['agenda']);                                       // trailing space trimmed
        $this->assertStringContainsString('ditentukan dari NAMAUP', implode(' ', $r[2]['warnings']));
        $this->assertStringContainsString("'BALIK NAMA' belum dipetakan", $r[3]['errors'][0]);
        $this->assertStringContainsString("'PENERANGAN SEMENTARA' belum dipetakan", $r[4]['errors'][0]);
        $this->assertStringContainsString('51450 tidak ada', $r[5]['errors'][0]);
        $this->assertStringContainsString('tidak sama persis', $r[6]['errors'][0]);
        $this->assertStringContainsString('tidak masuk akal', implode(' ', $r[7]['warnings']));

        $this->confirm($s->json('data.id'))->assertOk();
        $paid = DB::table('applications')->where('source_reference_id', '514539922611019012')->first();
        $this->assertSame(['PAID', $this->ulpA1->getKey()], [$paid->current_status, $paid->organizational_unit_id]);
        $this->assertSame('514531412077', DB::table('customer_external_references')->where('customer_id', $paid->customer_id)->value('reference_value'));
        $swapped = DB::table('applications')->where('source_reference_id', '514539922611019017')->first();
        $this->assertNull($swapped->last_external_status_at);                                           // untrusted date: status not moved by it
    }

    /** Spreadsheet bytes written by PhpSpreadsheet: text for everything except DAYA/DAYA_LAMA/TOTALBIAYA (numbers) and the three date columns (real date cells, format m/d/yyyy). */
    private function sheet(array $header, array $rows, string $writer): string
    {
        $ss = new Spreadsheet;
        $ws = $ss->getActiveSheet();
        $dates = ['TGLMOHON', 'TGLBAYAR', 'TGL_UPDATE_PERMOHONAN'];
        $numbers = ['DAYA', 'DAYA_LAMA', 'TOTALBIAYA'];
        foreach ($header as $c => $name) {
            $ws->setCellValueExplicit([$c + 1, 1], $name, DataType::TYPE_STRING);
        }
        foreach ($rows as $r => $row) {
            foreach ($header as $c => $name) {
                $v = (string) ($row[$name] ?? '');
                if ($v === '') {
                    continue;
                }
                $cell = [$c + 1, $r + 2];
                if (in_array($name, $dates, true) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                    $ws->setCellValue($cell, Date::PHPToExcel(new \DateTime($v.' 07:09:00')));
                    $ws->getStyle($cell)->getNumberFormat()->setFormatCode('m/d/yyyy');
                } elseif (in_array($name, $numbers, true) && is_numeric($v)) {
                    $ws->setCellValue($cell, (float) $v);
                } else {
                    $ws->setCellValueExplicit($cell, $v, DataType::TYPE_STRING);
                }
            }
        }
        $path = tempnam(sys_get_temp_dir(), 'x');
        IOFactory::createWriter($ss, $writer)->save($path);
        $bytes = (string) file_get_contents($path);
        unlink($path);

        return $bytes;
    }

    #[Test]
    public function a_new_application_is_taken_only_when_paid_or_pk_printed_and_the_report_says_why_the_others_are_out(): void
    {
        config(['distriva.eis_new_statuses' => ['PAID', 'PK_PRINTED']]);
        $r = fn (string $n, string $status, array $o = []) => $this->row(['NOAGENDA' => '5145399126102783'.$n, 'IDPEL' => '5145300003'.$n, 'NAMA' => 'PELANGGAN '.$n, 'STATUS_PERMOHONAN' => $status] + $o);
        $s = $this->stage([$r('01', 'DISETUJUI'), $r('02', 'BAYAR'), $r('03', 'CETAK PK'), $r('04', 'PEREMAJAAN'), $r('05', 'BATAL'), $r('06', ''), $r('07', 'STATUS ASING')]);
        $c = $s['res']->json('data.counts');
        $this->assertSame([2, 5, 0, 5], [$c['NEW'], $c['OUT_OF_SCOPE'], $c['OUT_OF_SCOPE_POWER'], $c['OUT_OF_SCOPE_STATUS']]);       // an unmapped status is not eligible either
        $this->assertSame(7, $s['res']->json('data.total_rows'));
        $this->assertSame(2, DB::table('application_import_staging')->where('batch_id', $s['id'])->count());
        $this->confirm($s['id'])->assertOk();
        $this->assertEqualsCanonicalizing(['PAID', 'PK_PRINTED'], DB::table('applications')->pluck('current_status')->all());

        // power is judged first: a small, not yet paid row is counted under power, never under status
        config(['distriva.eis_min_power_va' => 6600]);
        $m = $this->stage([$r('08', 'DISETUJUI', ['DAYA' => '900']), $r('09', 'DISETUJUI', ['DAYA' => '11000']), $r('10', 'BAYAR', ['DAYA' => '11000'])])['res']->json('data.counts');
        $this->assertSame([1, 2, 1, 1], [$m['NEW'], $m['OUT_OF_SCOPE'], $m['OUT_OF_SCOPE_POWER'], $m['OUT_OF_SCOPE_STATUS']]);

        // an empty list is "no filter"
        config(['distriva.eis_min_power_va' => 0, 'distriva.eis_new_statuses' => []]);
        $this->assertSame(2, $this->stage([$r('11', 'DISETUJUI'), $r('12', 'BATAL')])['res']->json('data.counts.NEW'));
    }

    #[Test]
    public function a_new_application_of_any_power_is_taken_in_bayar_cetak_pk_pdl_awal_and_peremajaan(): void
    {
        config(['distriva.eis_min_power_va' => 0, 'distriva.eis_new_statuses' => ['PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE']]);   // the new defaults (owner 2026-11-13)
        $r = fn (string $n, string $status) => $this->row(['NOAGENDA' => '5145399126102784'.$n, 'IDPEL' => '5145300004'.$n, 'NAMA' => 'PELANGGAN '.$n, 'STATUS_PERMOHONAN' => $status, 'DAYA' => '900']);   // a single-phase power too
        $s = $this->stage([$r('01', 'BAYAR'), $r('02', 'CETAK PK'), $r('03', 'PDL AWAL'), $r('04', 'PEREMAJAAN'), $r('05', 'DISETUJUI'), $r('06', 'BATAL')]);
        $c = $s['res']->json('data.counts');
        $this->assertSame([4, 2, 0, 2], [$c['NEW'], $c['OUT_OF_SCOPE'], $c['OUT_OF_SCOPE_POWER'], $c['OUT_OF_SCOPE_STATUS']]);
        $this->confirm($s['id'])->assertOk();
        $this->assertEqualsCanonicalizing(['PAID', 'PK_PRINTED', 'CONNECTION_IN_PROGRESS', 'CONNECTION_DONE'], DB::table('applications')->pluck('current_status')->all());
    }

    #[Test]
    public function an_application_already_in_distriva_keeps_syncing_in_every_status(): void
    {
        $row = $this->row(['NOAGENDA' => '514539912610278401', 'IDPEL' => '514530000401', 'NAMA' => 'PELANGGAN LAMA', 'STATUS_PERMOHONAN' => 'DISETUJUI', 'TGL_UPDATE_PERMOHONAN' => '5/11/2026']);
        $this->confirm($this->stage([$row])['id'])->assertOk();                                                              // registered while the filter was off
        config(['distriva.eis_new_statuses' => ['PAID', 'PK_PRINTED']]);
        $s = $this->stage([array_merge($row, ['STATUS_PERMOHONAN' => 'PEREMAJAAN', 'TGL_UPDATE_PERMOHONAN' => '9/11/2026'])]);
        $this->assertSame([0, 1, 0], [$s['res']->json('data.counts.OUT_OF_SCOPE'), $s['res']->json('data.counts.MATCHED'), $s['res']->json('data.counts.OUT_OF_SCOPE_STATUS')]);
        $this->confirm($s['id'])->assertOk();
        $this->assertSame('CONNECTION_DONE', DB::table('applications')->where('source_reference_id', '514539912610278401')->value('current_status'));
    }

    #[Test]
    public function the_service_days_are_kept_on_the_application_refreshed_by_each_import_and_shown(): void
    {
        $row = $this->row(['NOAGENDA' => '514539912610278501', 'IDPEL' => '514530000501', 'NAMA' => 'PELANGGAN HARI', 'STATUS_PERMOHONAN' => 'BAYAR', 'DURASI_HARI_KERJA' => '4']);
        $this->confirm($this->stage([$row])['id'])->assertOk();
        $app = fn () => DB::table('applications')->where('source_reference_id', '514539912610278501')->first();
        $this->assertSame(4, (int) $app()->service_days);
        $this->assertNotNull($app()->service_days_observed_at);

        $same = $this->stage([$row]);
        $this->assertSame([1, 0], [$same['res']->json('data.counts.UNCHANGED'), $same['res']->json('data.counts.MATCHED')]);       // the same figure: nothing to do

        $later = $this->stage([array_merge($row, ['DURASI_HARI_KERJA' => '9'])]);                                          // same status and date, but the service time has grown
        $this->assertSame(1, $later['res']->json('data.counts.MATCHED'));
        $sd = collect($this->rows($later['id']))->first()['changes']['service_days'] ?? [];
        $this->assertSame([4, 9], [$sd['old'] ?? null, $sd['new'] ?? null]);
        $this->confirm($later['id'])->assertOk();
        $this->assertSame(9, (int) $app()->service_days);
        $this->assertSame('PAID', $app()->current_status);                                                                  // the status did not move
        $this->assertSame(0, DB::table('application_change_logs')->where('application_id', $app()->id)->where('field_name', 'service_days')->count());      // a daily-moving figure does not fill the change log

        $this->confirm($this->stage([array_merge($row, ['DURASI_HARI_KERJA' => ''])])['id'])->assertOk();                  // an empty value never erases
        $this->assertSame(9, (int) $app()->service_days);

        $list = $this->as($this->manager)->getJson('/api/applications?search=514530000501')->assertOk()->json('data.0');
        $this->assertSame(9, $list['service_days']);
        $this->assertNotNull($list['service_days_observed_at']);
        $this->assertSame(9, $this->as($this->manager)->getJson('/api/applications/'.$app()->id)->assertOk()->json('data.service_days'));
    }

    #[Test]
    public function only_three_phase_customers_become_new_applications_but_registered_ones_keep_syncing(): void
    {
        config(['distriva.eis_min_power_va' => 6600]);
        $small = $this->row(['NOAGENDA' => '514539912610278101', 'IDPEL' => '514530000101', 'NAMA' => 'PELANGGAN 1 FASA', 'DAYA' => '900']);
        $edge = $this->row(['NOAGENDA' => '514539912610278102', 'IDPEL' => '514530000102', 'NAMA' => 'PELANGGAN BATAS', 'DAYA' => '6600']);
        $big = $this->row(['NOAGENDA' => '514539912610278103', 'IDPEL' => '514530000103', 'NAMA' => 'PELANGGAN 3 FASA', 'DAYA' => '11000']);
        $s = $this->stage([$small, $edge, $big]);
        $counts = $s['res']->json('data.counts');
        $this->assertSame([2, 1], [$counts['NEW'], $counts['OUT_OF_SCOPE']]);                                      // 6600 is in, 900 is out
        $this->assertSame(3, $s['res']->json('data.total_rows'));                                                 // every row of the file is counted
        $this->assertSame(2, DB::table('application_import_staging')->where('batch_id', $s['id'])->count());      // the out-of-scope one is never staged
        $this->confirm($s['id'])->assertOk();
        $this->assertEqualsCanonicalizing(['PELANGGAN BATAS', 'PELANGGAN 3 FASA'], DB::table('customers')->pluck('name')->all());
        $this->assertSame(0, DB::table('applications')->where('source_reference_id', '514539912610278101')->count());

        // out of scope wins over every other problem of the row: a small BALIK NAMA is silently out, a 3-phase one is a real rejection
        $odd = fn (string $va, string $n) => $this->row(['NOAGENDA' => '5145399126102782'.$n, 'IDPEL' => '5145300002'.$n, 'JENIS_TRANSAKSI' => 'BALIK NAMA', 'DAYA' => $va]);
        $mixed = $this->stage([$odd('900', '01'), $odd('11000', '02')])['res']->json('data.counts');
        $this->assertSame([0, 1, 1], [$mixed['NEW'], $mixed['REJECT'], $mixed['OUT_OF_SCOPE']]);

        // an application that is already registered is never cut off by the scope: a later row of a small power still updates it
        config(['distriva.eis_min_power_va' => 0]);
        $this->confirm($this->stage([$small])['id'])->assertOk();                                                // registered while the scope was off
        config(['distriva.eis_min_power_va' => 6600]);
        $again = $this->stage([array_merge($small, ['STATUS_PERMOHONAN' => 'SUDAH BAYAR'])]);
        $this->assertSame(0, $again['res']->json('data.counts.OUT_OF_SCOPE'));
        $this->assertSame(1, $again['res']->json('data.counts.MATCHED'));
    }

    #[Test]
    public function an_applied_import_announces_only_the_new_applications_that_can_be_surveyed_to_the_ulp_that_receives_them(): void
    {
        $this->seed(SurveyPermissionSeeder::class);      // the survey grants decide who is told
        $teknik = $this->makeUser();
        $this->assign($teknik, Role::query()->where('name', 'TEKNIK')->firstOrFail(), $this->ulpA1);
        $open = $this->row(['NOAGENDA' => '514539912610278201', 'IDPEL' => '514530000201', 'NAMA' => 'PELANGGAN A', 'STATUS_PERMOHONAN' => 'DISETUJUI']);
        $done = $this->row(['NOAGENDA' => '514539912610278202', 'IDPEL' => '514530000202', 'NAMA' => 'PELANGGAN B', 'STATUS_PERMOHONAN' => 'PEREMAJAAN']);
        $this->confirm($this->stage([$open, $done])['id'])->assertOk();
        $inbox = fn (User $u) => DB::table('user_notifications')->where('user_id', $u->getKey())->get();

        $this->assertSame(['1 permohonan baru masuk'], $inbox($this->manager)->pluck('title')->all());      // the finished one is history, not news
        $this->assertSame(['1 permohonan baru masuk'], $inbox($teknik)->pluck('title')->all());
        $this->assertCount(0, $inbox($this->retailA2));                                                    // another ULP
        $this->assertCount(0, $inbox($this->retailA1));                                                    // the one who imported
        $this->confirm($this->stage([$done])['id'])->assertOk();
        $this->assertCount(1, $inbox($this->manager));                                                     // an unchanged history row announces nothing
    }

    #[Test]
    public function the_list_can_be_limited_to_a_minimum_power_for_display_without_changing_what_is_stored(): void
    {
        $this->confirm($this->stage([
            $this->row(['NOAGENDA' => '514539912610278401', 'IDPEL' => '514530000401', 'NAMA' => 'TIGAFASA', 'DAYA' => '6600', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
            $this->row(['NOAGENDA' => '514539912610278402', 'IDPEL' => '514530000402', 'NAMA' => 'KECIL', 'DAYA' => '1300', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
        ])['id'])->assertOk();
        $list = fn (string $q) => collect($this->as($this->retailA1)->getJson('/api/applications?'.$q)->assertOk()->json('data'))->pluck('customer.name')->sort()->values()->all();

        $this->assertSame(['KECIL', 'TIGAFASA'], $list('listing=pbpd'));                          // no minimum: every power (the import setting is 0)
        $this->assertSame(['TIGAFASA'], $list('listing=pbpd&min_va=6600'));                       // display filter: 3-phase only
        $this->assertSame(['KECIL', 'TIGAFASA'], $list('listing=pbpd&min_va=1300'));
        $this->assertSame(2, DB::table('applications')->count());                                  // both stay stored: the filter is only a view
    }

    #[Test]
    public function the_list_can_be_limited_to_an_up3_and_to_the_month_of_its_date_column_and_offers_only_the_units_of_the_role(): void
    {
        $this->confirm($this->stage([
            $this->row(['NOAGENDA' => '514539912610278501', 'IDPEL' => '514530000501', 'NAMA' => 'LAMA', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
            $this->row(['NOAGENDA' => '514539912610278502', 'IDPEL' => '514530000502', 'NAMA' => 'BARU', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
        ])['id'])->assertOk();
        DB::table('applications')->whereIn('id', DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->where('c.name', 'LAMA')->select('a.id'))->update(['last_external_status_at' => '2026-03-15 10:00:00']);
        DB::table('applications')->whereIn('id', DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->where('c.name', 'BARU')->select('a.id'))->update(['last_external_status_at' => '2026-05-02 10:00:00']);
        $list = fn (string $q) => collect($this->as($this->retailA1)->getJson('/api/applications?listing=pbpd&'.$q)->assertOk()->json('data'))->pluck('customer.name')->sort()->values()->all();

        $this->assertSame(['LAMA'], $list('month=2026-03'));
        $this->assertSame(['BARU'], $list('month=2026-05'));
        $this->assertSame([], $list('month=2026-04'));
        $this->assertSame(['BARU', 'LAMA'], $list('up3_id='.$this->upA->getKey()));
        $this->assertSame([], $list('up3_id='.$this->ulpA1->getKey()));                            // not the parent of anything
        $units = $this->as($this->retailA1)->getJson('/api/applications/units')->assertOk();
        $this->assertSame('ULP', $units->json('scope'));
        $this->assertSame([$this->ulpA1->getKey()], collect($units->json('ulp_units'))->pluck('id')->all());
        $this->assertSame($this->upA->getKey(), $units->json('default_up3_id'));
        $shared = $this->as($this->retailA1)->getJson('/api/scoped-units?permission=applications.view')->assertOk();                  // the generic endpoint behind every page's UP3/ULP filter
        $this->assertSame([$units->json('scope'), $units->json('ulp_units')], [$shared->json('scope'), $shared->json('ulp_units')]);
        $this->as($this->retailA1)->getJson('/api/scoped-units?permission=users.manage')->assertUnprocessable();                    // only the filter pages' permissions
    }

    #[Test]
    public function the_attention_list_shows_only_paid_and_pk_printed_applications_oldest_first_with_pagination_and_filters(): void
    {
        $this->confirm($this->stage([
            $this->row(['NOAGENDA' => '514539912610278601', 'IDPEL' => '514530000601', 'NAMA' => 'BAYAR LAMA', 'DAYA' => '6600', 'STATUS_PERMOHONAN' => 'BAYAR']),
            $this->row(['NOAGENDA' => '514539912610278602', 'IDPEL' => '514530000602', 'NAMA' => 'CETAK BARU', 'DAYA' => '6600', 'STATUS_PERMOHONAN' => 'CETAK PK']),
            $this->row(['NOAGENDA' => '514539912610278603', 'IDPEL' => '514530000603', 'NAMA' => 'BAYAR 1FASA', 'DAYA' => '1300', 'STATUS_PERMOHONAN' => 'BAYAR']),
            $this->row(['NOAGENDA' => '514539912610278604', 'IDPEL' => '514530000604', 'NAMA' => 'DISETUJUI', 'DAYA' => '6600', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
            $this->row(['NOAGENDA' => '514539912610278605', 'IDPEL' => '514530000605', 'NAMA' => 'SELESAI', 'DAYA' => '6600', 'STATUS_PERMOHONAN' => 'PEREMAJAAN']),
        ])['id'])->assertOk();
        foreach (['BAYAR LAMA' => 30, 'CETAK BARU' => 2, 'BAYAR 1FASA' => 50, 'DISETUJUI' => 70, 'SELESAI' => 90] as $name => $days) {
            DB::table('applications')->whereIn('id', DB::table('applications as a')->join('customers as c', 'c.id', '=', 'a.customer_id')->where('c.name', $name)->select('a.id'))->update(['service_days' => $days]);
        }
        $get = fn (string $q = '') => $this->as($this->retailA1)->getJson('/api/applications/attention'.$q)->assertOk();
        $names = fn (string $q = '') => collect($get($q)->json('data'))->pluck('customer.name')->all();

        $this->assertSame(['BAYAR 1FASA', 'BAYAR LAMA', 'CETAK BARU'], $names());                  // only Bayar / Cetak PK, no limit, oldest first
        $this->assertSame(['BAYAR LAMA', 'CETAK BARU'], $names('?min_va=6600'));
        $this->assertSame(['CETAK BARU'], $names('?status=PK_PRINTED'));
        $this->assertSame(['BAYAR LAMA'], $names('?search=lama'));
        $this->assertSame([], $names('?extension=1'));                                               // none is in an extension proposal
        $this->assertSame(['BAYAR LAMA'], $names('?per_page=1&page=2'));
        $this->assertSame(3, $get('?per_page=1')->json('meta.total'));
        $this->as($this->retailA1)->getJson('/api/applications/attention?status=APPROVED')->assertUnprocessable();
    }

    #[Test]
    public function the_list_shows_eis_applications_and_can_separate_active_ones_from_history(): void
    {
        $this->confirm($this->stage([
            $this->row(['NOAGENDA' => '514539912610278301', 'IDPEL' => '514530000301', 'NAMA' => 'AKTIF', 'STATUS_PERMOHONAN' => 'DISETUJUI']),
            $this->row(['NOAGENDA' => '514539912610278302', 'IDPEL' => '514530000302', 'NAMA' => 'SELESAI', 'STATUS_PERMOHONAN' => 'PEREMAJAAN']),
            $this->row(['NOAGENDA' => '514539912610278303', 'IDPEL' => '514530000303', 'NAMA' => 'BATAL', 'STATUS_PERMOHONAN' => 'BATAL']),
        ])['id'])->assertOk();
        $list = fn (string $q) => collect($this->as($this->retailA1)->getJson('/api/applications?'.$q)->assertOk()->json('data'))->pluck('customer.name')->sort()->values()->all();

        $this->assertSame(['AKTIF', 'BATAL', 'SELESAI'], $list('listing=pbpd'));                  // every status is stored and listed; the page narrows with its own filters
        $this->assertSame(['AKTIF'], $list('listing=pbpd&lifecycle=active'));
        $this->assertSame(['BATAL', 'SELESAI'], $list('listing=pbpd&lifecycle=history'));         // finished/cancelled EIS rows are the history tab, not hidden
        $this->assertSame(['SELESAI'], $list('listing=pbpd&status=CONNECTION_DONE'));             // and a status filter finds Peremajaan
        $this->assertSame(['AKTIF', 'BATAL', 'SELESAI'], collect(array_merge($list('lifecycle=active'), $list('lifecycle=history')))->sort()->values()->all());   // still reachable without the PB/PD listing
        $this->as($this->retailA1)->getJson('/api/applications?lifecycle=semua')->assertUnprocessable();
        $row = collect($this->as($this->retailA1)->getJson('/api/applications?listing=pbpd')->json('data'))->firstWhere('agenda_number', '514539912610278301');   // the list carries what its chips and columns need (rows with the same timestamp have no fixed order)
        foreach (['agenda_number', 'register_number', 'idpel', 'new_tariff_code', 'new_power_value', 'new_power_unit', 'old_tariff_code'] as $k) {
            $this->assertArrayHasKey($k, $row);
        }
        $this->assertSame('514539912610278301', $row['agenda_number']);
        $this->assertSame('514530000301', $row['idpel']);
        $this->assertNotNull($row['register_number']);
        $this->assertGreaterThan(0, $row['new_power_value']);
    }

    // ---- EIS sync started from DISTRIVA: settings, button, automatic run ------------------------------------

    /** A stand-in for tools/eis_sync that records what it was given; "fail" as the EIS user makes it exit 1. */
    private function fakeTool(): string
    {
        $dir = sys_get_temp_dir().'/eis-fake-'.bin2hex(random_bytes(4));
        mkdir($dir);
        file_put_contents($dir.'/main.py', "import os, sys, json\nopen(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seen.json'), 'w').write(json.dumps({'args': sys.argv[1:], 'user': os.environ.get('EIS_USERNAME'), 'pw': os.environ.get('EIS_PASSWORD'), 'min': os.environ.get('EIS_DAYA_MIN'), 'max': os.environ.get('EIS_DAYA_MAX'), 'lookback': os.environ.get('EIS_LOOKBACK_DAYS'), 'token': bool(os.environ.get('DISTRIVA_TOKEN'))}))\nprint('Diterapkan: ok')\nsys.exit(1 if os.environ.get('EIS_USERNAME') == 'fail' else 0)\n");
        config(['distriva.eis_sync.dir' => $dir, 'distriva.eis_sync.run_inline' => true]);

        return $dir;
    }

    /** @param array<string,mixed> $o */
    private function syncBody(array $o = []): array
    {
        return $o + ['eis_username' => 'petugas.eis', 'eis_password' => 'Rahasia#123', 'power_min' => 0, 'power_max' => 99999999, 'lookback_days' => 90, 'auto_enabled' => false, 'auto_time' => '18:13'];
    }

    #[Test]
    public function the_eis_sync_settings_keep_the_password_encrypted_and_never_return_it(): void
    {
        $this->as($this->vendor)->getJson('/api/eis-sync')->assertForbidden();
        $this->as($this->manager)->putJson('/api/eis-sync/settings', $this->syncBody())->assertForbidden();
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['power_min' => 500, 'power_max' => 100]))->assertStatus(409);
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['auto_time' => '25:99']))->assertUnprocessable();
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['eis_username' => '', 'eis_password' => '', 'auto_enabled' => true]))->assertStatus(409);   // nothing to log in with yet

        $saved = $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['power_min' => 450, 'power_max' => 6600, 'auto_enabled' => true]))->assertOk()->json('data');
        $this->assertSame(['petugas.eis', true, 450, 6600, true], [$saved['eis_username'], $saved['has_password'], $saved['power_min'], $saved['power_max'], $saved['auto_enabled']]);
        $this->assertStringNotContainsString('Rahasia#123', json_encode($this->as($this->retailA1)->getJson('/api/eis-sync')->assertOk()->json()));
        $stored = (string) DB::table('eis_sync_settings')->value('eis_password_encrypted');
        $this->assertNotSame('Rahasia#123', $stored);
        $this->assertSame('Rahasia#123', Crypt::decryptString($stored));
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['eis_password' => '', 'lookback_days' => 30]))->assertOk();   // an empty password keeps the saved one
        $this->assertSame($stored, (string) DB::table('eis_sync_settings')->value('eis_password_encrypted'));
    }

    #[Test]
    public function a_sys_admin_can_save_the_eis_settings_and_start_a_run_and_the_run_keeps_the_mfa_state_of_its_starter(): void
    {
        $this->fakeTool();
        $this->assertTrue(Schema::hasColumn('eis_sync_runs', 'mfa_verified_at'));
        $this->as($this->sysAdmin)->putJson('/api/eis-sync/settings', $this->syncBody(['power_min' => 0, 'power_max' => 99999999, 'lookback_days' => 180]))->assertOk();
        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs')->assertStatus(202)->json('data');
        $this->assertSame('MANUAL', $run['trigger']);
        $this->assertNotNull(DB::table('eis_sync_runs')->where('id', $run['id'])->value('mfa_verified_at'));          // the run writes with the same MFA state as the person who pressed the button
    }

    #[Test]
    public function the_sync_can_be_started_for_chosen_units_only_within_the_scope_and_the_tool_gets_exactly_those_units(): void
    {
        $dir = $this->fakeTool();
        $this->as($this->sysAdmin)->putJson('/api/eis-sync/settings', $this->syncBody())->assertOk();
        $codes = fn (User $u) => array_column($this->as($u)->getJson('/api/eis-sync')->assertOk()->json('data.units'), 'code');
        $this->assertSame(['51453'], $codes($this->retailA1));                                              // the choice offers only the units of the account's scope
        $this->assertSame(['51453', '51454'], $codes($this->sysAdmin));

        $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['units' => ['51454']])->assertStatus(409);       // a unit outside the scope
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['units' => ['abc']])->assertUnprocessable();
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['units' => []])->assertUnprocessable();

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['units' => ['51454', '51453', '51454']])->assertStatus(202)->json('data');
        $seen = json_decode((string) file_get_contents($dir.'/seen.json'), true);
        $this->assertContains('--per-unit', $seen['args']);
        $this->assertSame('51454,51453', $seen['args'][array_search('--unit', $seen['args'], true) + 1]);       // the order chosen, once each
        $this->assertSame(['51454', '51453'], $run['units']);

        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs')->assertStatus(202);                         // no choice = every unit
        $this->assertNotContains('--unit', json_decode((string) file_get_contents($dir.'/seen.json'), true)['args']);
    }

    #[Test]
    public function a_receivable_run_hands_the_months_reports_and_units_to_the_tool_and_is_kept_with_its_kind(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        $dir = $this->fakeTool();
        $this->as($this->sysAdmin)->putJson('/api/eis-sync/settings', $this->syncBody())->assertOk();
        $args = fn () => json_decode((string) file_get_contents($dir.'/seen.json'), true)['args'];

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'from_month' => '2026-01', 'to_month' => '2026-10', 'reports' => ['KOGOL', 'PRABAYAR', 'GOLONGAN', 'KOGOL'], 'units' => ['51453']])->assertStatus(202)->json('data');
        $this->assertSame('piutang', $run['kind']);
        $this->assertEquals(['from_month' => '2026-01', 'to_month' => '2026-10', 'reports' => ['KOGOL', 'PRABAYAR', 'GOLONGAN']], $run['options']);
        $seen = $args();
        $this->assertSame('piutang', $seen[0]);
        $this->assertSame('2026-01', $seen[array_search('--dari', $seen, true) + 1]);
        $this->assertSame('2026-10', $seen[array_search('--sampai', $seen, true) + 1]);
        $this->assertSame('KOGOL,PRABAYAR,GOLONGAN', $seen[array_search('--laporan', $seen, true) + 1]);
        $this->assertSame('51453', $seen[array_search('--unit', $seen, true) + 1]);
        $this->assertNotContains('--per-unit', $seen);

        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'to_month' => '2026-10'])->assertStatus(202);                          // a month alone, all reports, all units
        $seen = $args();
        $this->assertSame(['2026-10', '2026-10', 'GOLONGAN,LEMBAR,KOGOL,PRABAYAR'], [$seen[array_search('--dari', $seen, true) + 1], $seen[array_search('--sampai', $seen, true) + 1], $seen[array_search('--laporan', $seen, true) + 1]]);
        $this->assertNotContains('--unit', $seen);

        $kontrol = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'to_month' => '2026-10', 'reports' => ['KONTROL309'], 'units' => ['51453']])->assertStatus(202)->json('data');       // kontrol penjualan 309 diminta sendiri
        $this->assertSame(['KONTROL309'], $kontrol['options']['reports']);
        $this->assertSame('KONTROL309', $args()[array_search('--laporan', $args(), true) + 1]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'to_month' => '2026-10', 'reports' => ['LAINNYA']])->assertUnprocessable();

        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang'])->assertUnprocessable();                                              // the last month is required
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'from_month' => '2026-10', 'to_month' => '2026-01'])->assertUnprocessable();
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'to_month' => '2026-10', 'reports' => ['SEMUA']])->assertUnprocessable();
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'from_month' => '2024-01', 'to_month' => '2026-10'])->assertStatus(409);        // at most 24 months
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'lain'])->assertUnprocessable();
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['kind' => 'piutang', 'to_month' => '2026-10', 'units' => ['51454']])->assertStatus(409);     // a unit outside the scope

        $this->assertSame('permohonan', $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs')->assertStatus(202)->json('data.kind'));                         // the application pull is unchanged
        $this->assertContains('--per-unit', $args());
        $this->assertSame('piutang', $this->as($this->sysAdmin)->getJson('/api/eis-sync')->json('data.runs.1.kind'));
    }

    /** Pohon GraphQL APKT yang kecil tetapi lengkap: satu peralatan, dengan subtotal tiap tingkat. */
    private function apktTree(float $saidi = 0.0219, int $feeder = 5): array
    {
        $v = fn (string $p, int $n) => [$p.'jumlahPelangganPadam' => $n, $p.'jumlahTotalPelanggan' => 194452, $p.'jamXJumlahPelangganPadam' => $n * 2.0, $p.'saidi' => 0.001, $p.'saidiPelanggan' => 0.06, $p.'saifi' => 0.002, $p.'jumlahGangguan' => $feeder, $p.'lamaPadam' => 3.0, $p.'kwhLoss' => 4];

        return ['kelompok' => [['id' => 1, 'nama' => 'Distribusi'] + $v('totalKelompok_', 7) + ['subKelompok' => [['id' => 11, 'nama' => 'Padam Tidak Terencana'] + $v('totalSubKelompok_', 7) + ['fasilitas' => [['id' => 112, 'nama' => 'Penyulang'] + $v('totalFasilitas_', 7) + ['subFasilitas' => [
            ['id' => 1121, 'nama' => 'SUTM'] + $v('totalSubFasilitas_', 7) + ['equipment' => [['id' => 11211, 'nama' => 'Konduktor'] + $v('', 7)]]]]]]]]],
            'totalKeseluruhan' => ['saidi' => $saidi, 'saidiPelanggan' => 1.315, 'saifi' => 0.0153] + $v('', 7)];
    }

    #[Test]
    public function an_apkt_run_pulls_the_monthly_saidi_saifi_report_into_the_difi_import_and_never_keeps_or_returns_the_token(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.graphql_url' => 'https://apkt.test/graphql']);
        Storage::fake('documents');
        $secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        Http::fake(['apkt.test/*' => Http::response(['data' => ['getLaporanSaidiSaifiSE004' => ['status' => true, 'message' => 'ok', 'data' => $this->apktTree()]]])]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => 'Bearer '.$secret])->assertStatus(202)->json('data');

        $this->assertSame('apkt', $run['kind']);
        $this->assertArrayNotHasKey('token_encrypted', $run['options']);
        $this->assertStringNotContainsString($secret, json_encode($run));
        Http::assertSent(fn ($r) => $r->hasHeader('Authorization', 'Bearer '.$secret) && $r['variables']['cmd']['idUlp'] === [51453] && $r['variables']['cmd']['bulan'] === 10 && $r['variables']['cmd']['tahun'] === 2026 && $r['variables']['cmd']['idUp3'] === [149]);

        $row = DB::table('eis_sync_runs')->where('id', $run['id'])->first();
        $this->assertSame('OK', $row->status);
        $this->assertStringContainsString('BARU', (string) $row->log);
        $this->assertStringNotContainsString($secret, (string) $row->log.$row->options);          // the token is gone from the run once it has finished
        $this->assertStringNotContainsString('token_encrypted', (string) $row->options);

        $file = DB::table('eis_report_files')->where('family', 'DIFI')->where('unit_code', '51453')->first();
        $this->assertSame('2026-10-01', $file->period);
        $this->assertSame('DIFI-51453-102026.xlsx', $file->original_name);
        $summary = json_decode($file->summary, true);
        $this->assertEqualsWithDelta(0.0219, $summary['saidi_jam'], 1e-9);
        $this->assertEqualsWithDelta(1.315, $summary['saidi_menit'], 1e-9);
        $this->assertEquals(194452, $summary['pelanggan']);
        $this->assertSame(6, (int) DB::table('eis_report_lines')->where('file_id', $file->id)->count());        // heading rows hold no numbers and are skipped: 1 equipment + 5 subtotals/totals
        $penyulang = json_decode((string) DB::table('eis_report_lines')->where('file_id', $file->id)->where('label', 'SUB TOTAL FASILITAS Penyulang')->value('values'), true);
        $this->assertSame(5, (int) $penyulang['jumlah_gangguan']);

        // the same content again is a duplicate, not a second file
        $again = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202)->json('data.id');
        $this->assertStringContainsString('DUPLIKAT', (string) DB::table('eis_sync_runs')->where('id', $again)->value('log'));
        $this->assertSame(1, DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->count());

        // different content for the same unit and month replaces the old version
        Http::swap(new Factory);                                              // a fresh fake: the first one would keep answering with the old report
        Http::fake(['apkt.test/*' => Http::response(['data' => ['getLaporanSaidiSaifiSE004' => ['status' => true, 'data' => $this->apktTree(3.5688, 9)]]])]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202);
        $this->assertSame(1, DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'AKTIF')->count());
        $this->assertSame(1, DB::table('eis_report_files')->where('family', 'DIFI')->where('status', 'DIGANTIKAN')->count());
    }

    #[Test]
    public function an_apkt_rpt_rct_run_stores_both_clear_temper_variants_per_ulp_and_replaces_the_same_month_on_rerun(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.monalisa_url' => 'https://apkt.test/graphql']);
        $secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        $answer = fn (int $count) => Http::response(['data' => ['monalisaJumlahDurasiRptRctGangguan' => [
            ['id_ulp' => 51453, 'nama_ulp' => 'ULP X', 'total_durasi_response_time_bulan_ini' => 600 * $count, 'count_durasi_response_time_bulan_ini' => $count, 'total_durasi_recovery_time_bulan_ini' => 3000 * $count, 'count_durasi_recovery_time_bulan_ini' => $count],
            ['id_ulp' => 99999, 'nama_ulp' => 'ULP tak dikenal', 'total_durasi_response_time_bulan_ini' => 1, 'count_durasi_response_time_bulan_ini' => 1, 'total_durasi_recovery_time_bulan_ini' => 1, 'count_durasi_recovery_time_bulan_ini' => 1],
        ]]]);
        Http::fake(['apkt.test/*' => fn ($r) => $answer($r['variables']['clearTemper'] === 0 ? 10 : 4)]);       // APKT: 0 = semua laporan (lebih banyak), 1 = tanpa clear temper

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'rpt-rct-gangguan', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202)->json('data');

        $this->assertStringNotContainsString($secret, json_encode($run));
        Http::assertSent(fn ($r) => $r->hasHeader('Authorization', 'Bearer '.$secret) && $r['variables']['idUlp'] === [] && $r['variables']['bulan'] === 10 && $r['variables']['clearTemper'] === 1);
        Http::assertSent(fn ($r) => $r['variables']['clearTemper'] === 0);
        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $run['id'])->value('status'));
        $this->assertSame(2, DB::table('apkt_rpt_rct_records')->count());                       // one ULP x two variants; the unknown ULP is skipped
        $this->assertSame(10, (int) DB::table('apkt_rpt_rct_records')->where('clear_temper', true)->value('rpt_count'));       // dengan clear temper = parameter 0
        $this->assertSame(4, (int) DB::table('apkt_rpt_rct_records')->where('clear_temper', false)->value('rpt_count'));

        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => fn ($r) => $answer($r['variables']['clearTemper'] === 0 ? 12 : 5)]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'rpt-rct-gangguan', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202);
        $this->assertSame(2, DB::table('apkt_rpt_rct_records')->count());
        $this->assertSame(12, (int) DB::table('apkt_rpt_rct_records')->where('clear_temper', true)->value('rct_count'));
    }

    #[Test]
    public function an_apkt_rpt_rct_keluhan_run_stores_one_row_per_ulp_without_clear_temper_and_replaces_the_same_month_on_rerun(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.monalisa_url' => 'https://apkt.test/graphql']);
        $secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        $answer = fn (int $count) => Http::response(['data' => ['monalisaJumlahDurasiRptRctKeluhan' => [
            ['id_ulp' => 51453, 'nama_ulp' => 'ULP X', 'total_durasi_response_time_bulan_ini' => 158, 'count_durasi_response_time_bulan_ini' => $count, 'total_durasi_recovery_time_bulan_ini' => 2131, 'count_durasi_recovery_time_bulan_ini' => $count],
            ['id_ulp' => 99999, 'nama_ulp' => 'ULP tak dikenal', 'total_durasi_response_time_bulan_ini' => 1, 'count_durasi_response_time_bulan_ini' => 1, 'total_durasi_recovery_time_bulan_ini' => 1, 'count_durasi_recovery_time_bulan_ini' => 1],
        ]]]);
        Http::fake(['apkt.test/*' => $answer(355)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'rpt-rct-keluhan', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202)->json('data');

        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $run['id'])->value('status'));
        Http::assertSent(fn ($r) => str_contains((string) $r['query'], 'monalisaJumlahDurasiRptRctKeluhan') && ! array_key_exists('clearTemper', $r['variables']) && $r['variables']['idUlp'] === [] && $r['variables']['bulan'] === 10);
        Http::assertSentCount(1);                                                                   // tanpa varian clear temper
        $this->assertSame(1, DB::table('apkt_rpt_rct_keluhan_records')->count());                   // ULP tak dikenal dilewati
        $this->assertSame(0, DB::table('apkt_rpt_rct_records')->count());
        $this->assertSame(355, (int) DB::table('apkt_rpt_rct_keluhan_records')->value('rpt_count'));

        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => $answer(360)]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'rpt-rct-keluhan', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202);
        $this->assertSame(1, DB::table('apkt_rpt_rct_keluhan_records')->count());
        $this->assertSame(360, (int) DB::table('apkt_rpt_rct_keluhan_records')->value('rct_count'));
    }

    #[Test]
    public function an_apkt_anomali_gangguan_run_pulls_berulang_and_rating_negatif_per_month_and_replaces_on_rerun(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.monalisa_url' => 'https://apkt.test/graphql']);
        $secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        $row = fn (int $id, int $total) => ['id_ulp' => $id, 'nama_ulp' => 'ULP', 'wo_cc123' => 20, 'wo_pln_mobile' => 70, 'wo_loket' => 0, 'wo_lainnya' => 10, 'wo_total' => 100, 'anomali_pln_mobile_marking' => 2, 'anomali_pln_mobile_non_marking' => 1,
            'anomali_cc123_marking' => 1, 'anomali_cc123_non_marking' => 2, 'total_anomali_marking' => $total, 'total_anomali_non_marking' => 3];
        $fake = fn (int $total) => fn ($r) => Http::response(['data' => [
            str_contains((string) $r['query'], 'UnitRatingNegatif') ? 'anomaliPenangananPengaduanGangguanUnitRatingNegatif' : 'anomaliPenangananPengaduanGangguanUnitBerulang' => [$row(51453, $total), $row(99999, 1)],
        ]]);
        Http::fake(['apkt.test/*' => $fake(3)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'anomali-gangguan', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202)->json('data');

        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $run['id'])->value('status'));
        Http::assertSent(fn ($r) => str_contains((string) $r['query'], 'anomaliPenangananPengaduanGangguanUnitBerulang') && $r['variables']['dateFrom'] === '2026-10-01' && $r['variables']['dateTo'] === '2026-10-31' && $r['variables']['idUlp'] === [] && $r->hasHeader('Authorization', 'Bearer '.$secret));
        Http::assertSent(fn ($r) => str_contains((string) $r['query'], 'anomaliPenangananPengaduanGangguanUnitRatingNegatif'));
        Http::assertSentCount(2);
        $this->assertSame(['BERULANG', 'NEGATIF'], DB::table('apkt_anomali_gangguan_records')->orderBy('jenis')->pluck('jenis')->all());   // ULP tak dikenal dilewati
        $this->assertSame(3, (int) DB::table('apkt_anomali_gangguan_records')->where('jenis', 'BERULANG')->value('total_anomali_marking'));

        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => $fake(7)]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'anomali-gangguan', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202);
        $this->assertSame(2, DB::table('apkt_anomali_gangguan_records')->count());
        $this->assertSame(7, (int) DB::table('apkt_anomali_gangguan_records')->where('jenis', 'NEGATIF')->value('total_anomali_marking'));
    }

    #[Test]
    public function an_apkt_anomali_keluhan_run_pulls_berulang_and_rating_negatif_per_month_and_replaces_on_rerun(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.monalisa_url' => 'https://apkt.test/graphql']);
        $secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
        $row = fn (int $id, int $total) => ['id_ulp' => $id, 'nama_ulp' => 'ULP', 'wo_cc123' => 10, 'wo_pln_mobile' => 50, 'wo_loket' => 0, 'wo_lainnya' => 5, 'wo_total' => 65, 'anomali_pln_mobile' => 2, 'anomali_cc123' => 1, 'total_anomali' => $total];
        $fake = fn (int $total) => fn ($r) => Http::response(['data' => [
            str_contains((string) $r['query'], 'UnitRatingNegatif') ? 'anomaliLaporanPenangananPengaduanKeluhanUnitRatingNegatif' : 'anomaliLaporanPenangananPengaduanKeluhanUnitBerulang' => [$row(51453, $total), $row(99999, 1)],
        ]]);
        Http::fake(['apkt.test/*' => $fake(3)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'anomali-keluhan', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202)->json('data');

        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $run['id'])->value('status'));
        Http::assertSent(fn ($r) => str_contains((string) $r['query'], 'anomaliLaporanPenangananPengaduanKeluhanUnitBerulang') && $r['variables']['dateFrom'] === '2026-10-01' && $r['variables']['dateTo'] === '2026-10-31' && $r['variables']['idUlp'] === []);
        Http::assertSent(fn ($r) => str_contains((string) $r['query'], 'anomaliLaporanPenangananPengaduanKeluhanUnitRatingNegatif'));
        Http::assertSentCount(2);
        $this->assertSame(['BERULANG', 'NEGATIF'], DB::table('apkt_anomali_keluhan_records')->orderBy('jenis')->pluck('jenis')->all());
        $this->assertSame(0, DB::table('apkt_anomali_gangguan_records')->count());
        $this->assertSame(3, (int) DB::table('apkt_anomali_keluhan_records')->where('jenis', 'BERULANG')->value('total_anomali'));

        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => $fake(7)]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'dataset' => 'anomali-keluhan', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret])->assertStatus(202);
        $this->assertSame(2, DB::table('apkt_anomali_keluhan_records')->count());
        $this->assertSame(7, (int) DB::table('apkt_anomali_keluhan_records')->where('jenis', 'NEGATIF')->value('total_anomali'));
    }

    /** Isi berkas Excel laporan TAGSUS AP2T yang kecil: dua TS golongan K2 dan satu P3 untuk ULP Jombang. */
    private function ap2tTagsusBody(int $kwh = 115, bool $belumRealisasi = false, int $rows = 3): string
    {
        $sheet = new Spreadsheet;
        $ws = $sheet->getActiveSheet();
        $ws->setCellValue('A1', 'PT. PLN (PERSERO) UID JAWA TIMUR');
        $ws->setCellValue('A2', 'UP3 MOJOKERTO');
        $ws->setCellValue('A3', 'ULP JOMBANG');
        $ws->setCellValue('D3', $belumRealisasi ? 'DAFTAR PENDAPATAN PENETAPAN TAGIHAN SUSULAN YANG BELUM REALISASI' : 'DAFTAR REALISASI PENDAPATAN PENETAPAN TAGIHAN SUSULAN (TUNAI DAN ANGSURAN)');
        $ws->setCellValue('A4', 'BULAN  OKTOBER    TAHUN  2026');
        $ws->setCellValue('A7', 'NO');
        $ws->setCellValue('D7', 'IDPEL');
        foreach (array_slice([['514531503554', 'K2', $kwh], ['514531503555', 'K2', 300], ['514530414505', 'P3', 2479]], 0, $rows) as $i => [$idpel, $gol, $kw]) {
            $r = 10 + $i;
            $ws->setCellValue("A{$r}", $i + 1);
            $ws->setCellValueExplicit("D{$r}", $idpel, 's');
            $ws->setCellValue("H{$r}", $gol);
            foreach (['L' => $kw, 'M' => 0, 'N' => $kw * 400, 'P' => $kw * 400, 'Z' => $kw * 440, 'AB' => $kw * 440, 'AC' => 0] as $col => $v) {
                $ws->setCellValue("{$col}{$r}", $v);
            }
        }
        $path = tempnam(sys_get_temp_dir(), 'ap2tfx');
        (new Xlsx($sheet))->save($path);
        $body = (string) file_get_contents($path);
        @unlink($path);

        return $body;
    }

    #[Test]
    public function an_ap2t_run_downloads_the_tagsus_report_per_ulp_and_month_without_a_token_and_imports_it_idempotently(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.ap2t.pause_ms' => 0, 'distriva.ap2t.report_url' => 'https://ap2t.test/ReportServlet']);
        Storage::fake('documents');
        Http::fake(['ap2t.test/*' => fn ($r) => Http::response($this->ap2tTagsusBody(115, str_contains((string) $r['report'], 'belum_realisasi'), str_contains((string) $r['report'], 'belum_realisasi') ? 1 : 3), 200, ['Content-Type' => 'application/vnd.ms-excel'])]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'from_month' => '2026-10', 'to_month' => '2026-10', 'units' => ['51453']])->assertStatus(202)->json('data');

        $this->assertSame(['ap2t', 'tagsus'], [$run['kind'], $run['options']['dataset']]);
        Http::assertSent(fn ($r) => $r->method() === 'GET' && $r['unitup'] === '51453' && $r['thbl'] === '202610' && $r['unitap'] === '51MJK' && $r['unitupi'] === '51' && $r['jenislaporan'] === 'getlaporantsgab'
            && $r['report'] === 'report/NONREK/rpt_ts_daftar_realisasi_pendapatan_penetapan_ts.xls' && str_starts_with((string) $r['jenislap'], 'DAFTAR REALISASI PENDAPATAN PENETAPAN TAGIHAN SUSULAN') && ! $r->hasHeader('Authorization'));
        $row = DB::table('eis_sync_runs')->where('id', $run['id'])->first();
        $this->assertSame('OK', $row->status);
        $this->assertStringContainsString('BARU', (string) $row->log);

        $file = DB::table('eis_report_files')->where('family', 'TAGSUS')->where('unit_code', '51453')->first();
        $this->assertSame(['2026-10-01', 'TAGSUS-51453-102026.xls'], [$file->period, $file->original_name]);
        $kwh = DB::table('eis_report_lines')->where('file_id', $file->id)->get()->mapWithKeys(fn ($l) => [$l->label => json_decode($l->values, true)]);
        $this->assertEquals([415, 2], [$kwh['K2']['kwh'], $kwh['K2']['jumlah']]);
        $belum = DB::table('eis_report_files')->where('family', 'TAGSUS_BELUM')->where('unit_code', '51453')->first();             // laporan belum realisasi: jenis sendiri, tidak menggantikan realisasi
        $this->assertSame(['2026-10-01', 'TAGSUS_BELUM-51453-102026.xls', 1], [$belum->period, $belum->original_name, (int) $belum->line_count]);
        $this->assertSame('AKTIF', DB::table('eis_report_files')->where('id', $file->id)->value('status'));

        $again = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10', 'units' => ['51453']])->assertStatus(202)->json('data.id');
        $this->assertStringContainsString('DUPLIKAT', (string) DB::table('eis_sync_runs')->where('id', $again)->value('log'));
        $this->assertSame(1, DB::table('eis_report_files')->where('family', 'TAGSUS')->where('status', 'AKTIF')->count());

        Http::swap(new Factory);
        Http::fake(['ap2t.test/*' => Http::response($this->ap2tTagsusBody(200), 200)]);                     // isi berbeda untuk ULP dan bulan sama menggantikan versi lama
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10', 'units' => ['51453'], 'reports' => ['realisasi']])->assertStatus(202);
        $this->assertSame([1, 1], [DB::table('eis_report_files')->where('family', 'TAGSUS')->where('status', 'AKTIF')->count(), DB::table('eis_report_files')->where('family', 'TAGSUS')->where('status', 'DIGANTIKAN')->count()]);
    }

    #[Test]
    public function an_ap2t_run_accepts_a_month_without_any_penetapan_and_rejects_a_report_that_does_not_match_its_type(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.ap2t.pause_ms' => 0, 'distriva.ap2t.report_url' => 'https://ap2t.test/ReportServlet']);
        Storage::fake('documents');
        Http::fake(['ap2t.test/*' => fn ($r) => str_contains((string) $r['report'], 'belum_realisasi') ? Http::response($this->ap2tTagsusBody(115, true, 0), 200) : Http::response($this->ap2tTagsusBody(), 200)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10', 'units' => ['51453']])->assertStatus(202)->json('data');

        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $run['id'])->value('status'));
        $this->assertSame(0, (int) DB::table('eis_report_files')->where('family', 'TAGSUS_BELUM')->value('line_count'));          // bulan tanpa penetapan belum realisasi: laporan sah dengan nol baris

        Http::swap(new Factory);
        Http::fake(['ap2t.test/*' => Http::response($this->ap2tTagsusBody(115, true, 2), 200)]);                                   // AP2T mengembalikan laporan belum realisasi untuk permintaan realisasi
        $wrong = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-09', 'units' => ['51453'], 'reports' => ['realisasi']])->assertStatus(202)->json('data');

        $row = DB::table('eis_sync_runs')->where('id', $wrong['id'])->first();
        $this->assertSame('FAILED', $row->status);
        $this->assertStringContainsString('Isi berkas adalah laporan TAGSUS_BELUM, bukan TAGSUS', (string) $row->log);
        $this->assertSame(0, DB::table('eis_report_files')->where('family', 'TAGSUS')->where('period', '2026-09-01')->count());
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10', 'reports' => ['lainnya']])->assertStatus(422);
    }

    #[Test]
    public function an_ap2t_run_rejects_a_response_that_is_not_an_excel_file_and_a_forbidden_account_cannot_start_one(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.ap2t.pause_ms' => 0, 'distriva.ap2t.report_url' => 'https://ap2t.test/ReportServlet']);
        Http::fake(['ap2t.test/*' => Http::response('<html><body>Terjadi kesalahan pada server</body></html>', 200)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10', 'units' => ['51453']])->assertStatus(202)->json('data');

        $row = DB::table('eis_sync_runs')->where('id', $run['id'])->first();
        $this->assertSame('FAILED', $row->status);
        $this->assertStringContainsString('bukan berkas Excel', (string) $row->log);
        $this->assertSame(0, DB::table('eis_report_files')->where('family', 'TAGSUS')->count());
        $this->as($this->vendor)->postJson('/api/eis-sync/runs', ['kind' => 'ap2t', 'to_month' => '2026-10'])->assertForbidden();
    }

    #[Test]
    public function the_ap2t_download_trusts_the_bundled_intermediate_and_root_ca_by_default(): void
    {
        $bundle = (string) config('distriva.ap2t.verify');

        $this->assertFileExists($bundle);
        $this->assertStringEndsWith('resources/certs/ap2t-ca-bundle.pem', $bundle);
        $certs = (array) preg_split('/(?<=-----END CERTIFICATE-----)\s*/', trim((string) file_get_contents($bundle)), -1, PREG_SPLIT_NO_EMPTY);
        $subjects = array_map(fn (string $pem) => (string) (openssl_x509_parse($pem)['subject']['CN'] ?? ''), $certs);
        $this->assertSame(['GeoTrust TLS RSA CA G1', 'DigiCert Global Root G2'], $subjects);
    }

    #[Test]
    public function an_apkt_token_can_be_saved_per_user_reused_without_pasting_and_forgotten_like_the_mims_token(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.graphql_url' => 'https://apkt.test/graphql']);
        Storage::fake('documents');
        $secret = 'save0123456789abcdef0123456789abcdef0123456789';
        Http::fake(['apkt.test/*' => Http::response(['data' => ['getLaporanSaidiSaifiSE004' => ['status' => true, 'data' => $this->apktTree()]]])]);

        $this->as($this->sysAdmin)->getJson('/api/eis-sync/apkt-token')->assertOk()->assertJsonPath('data.saved', false);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'use_saved_token' => true])->assertStatus(409)->assertJsonFragment(['message' => 'Belum ada token APKT tersimpan; tempel token sesi dan centang "Simpan token".']);

        // pasted and saved: kept encrypted for this user, the run records that APKT accepted it
        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'units' => ['51453'], 'apkt_token' => $secret, 'save_token' => true])->assertStatus(202)->json('data');
        $this->assertSame('pasted', $run['options']['token_source']);
        $stored = (string) DB::table('user_apkt_tokens')->where('user_id', $this->sysAdmin->getKey())->value('token_encrypted');
        $this->assertStringNotContainsString($secret, $stored);
        $this->assertSame($secret, Crypt::decryptString($stored));
        $status = $this->as($this->sysAdmin)->getJson('/api/eis-sync/apkt-token')->assertOk()->json('data');
        $this->assertTrue($status['saved']);
        $this->assertSame('OK', $status['last_result']);
        $this->assertNotNull($status['last_used_at']);
        $this->assertStringNotContainsString($secret, json_encode($status));

        // reused without pasting
        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => Http::response(['data' => ['getLaporanSaidiSaifiSE004' => ['status' => true, 'data' => $this->apktTree()]]])]);
        $again = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'units' => ['51453'], 'use_saved_token' => true])->assertStatus(202)->json('data');
        $this->assertSame('saved', $again['options']['token_source']);
        $this->assertSame('OK', DB::table('eis_sync_runs')->where('id', $again['id'])->value('status'));
        Http::assertSent(fn ($r) => $r->hasHeader('Authorization', 'Bearer '.$secret));
        $this->assertStringNotContainsString('token_encrypted', (string) DB::table('eis_sync_runs')->where('id', $again['id'])->value('options'));

        // another user does not see or use it
        $this->assertNull(DB::table('user_apkt_tokens')->where('user_id', $this->retailA1->getKey())->value('user_id'));

        // a rejected saved token is marked, not deleted: the user decides when to replace it
        Http::swap(new Factory);
        Http::fake(['apkt.test/*' => Http::response(['message' => 'Unauthorized'], 401)]);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'use_saved_token' => true])->assertStatus(202);
        $this->as($this->sysAdmin)->getJson('/api/eis-sync/apkt-token')->assertOk()->assertJsonPath('data.saved', true)->assertJsonPath('data.last_result', 'REJECTED');

        // a pasted token that is not saved leaves the saved one and its result alone
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'apkt_token' => 'other0123456789abcdef0123456789'])->assertStatus(202);
        $this->assertSame($secret, Crypt::decryptString((string) DB::table('user_apkt_tokens')->where('user_id', $this->sysAdmin->getKey())->value('token_encrypted')));

        $this->as($this->sysAdmin)->deleteJson('/api/eis-sync/apkt-token')->assertOk();
        $this->as($this->sysAdmin)->getJson('/api/eis-sync/apkt-token')->assertOk()->assertJsonPath('data.saved', false);
        $this->as($this->retailA1)->getJson('/api/eis-sync/apkt-token')->assertOk()->assertJsonPath('data.saved', false);   // per user: another user's status is their own
        $this->as($this->vendor)->getJson('/api/eis-sync/apkt-token')->assertForbidden();
    }

    #[Test]
    public function an_apkt_workbook_of_the_same_data_is_byte_identical_even_when_built_seconds_apart(): void
    {
        $svc = app(ApktSaidiSaifiSync::class);
        $a = tempnam(sys_get_temp_dir(), 'apkt');
        $b = tempnam(sys_get_temp_dir(), 'apkt');
        $svc->workbook($this->apktTree(), 'ULP JOMBANG', 10, 2026)->save($a);
        sleep(2);                                                                                  // timestamps inside an xlsx (document properties, zip entries) must not leak into the hash that detects duplicates
        $svc->workbook($this->apktTree(), 'ULP JOMBANG', 10, 2026)->save($b);

        $this->assertSame(hash_file('sha256', $a), hash_file('sha256', $b));
        $svc->workbook($this->apktTree(9.9), 'ULP JOMBANG', 10, 2026)->save($b);
        $this->assertNotSame(hash_file('sha256', $a), hash_file('sha256', $b));                    // different data still differs
        @unlink($a);
        @unlink($b);
    }

    #[Test]
    public function an_apkt_run_stops_at_the_first_rejected_token_and_input_is_validated(): void
    {
        $this->seed(EisReportPermissionSeeder::class);
        config(['distriva.eis_sync.run_inline' => true, 'distriva.apkt.pause_ms' => 0, 'distriva.apkt.graphql_url' => 'https://apkt.test/graphql']);
        $secret = 'zzzzzzzz0123456789zzzzzzzz0123456789';
        Http::fake(['apkt.test/*' => Http::response(['message' => 'Unauthorized'], 401)]);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'from_month' => '2026-09', 'to_month' => '2026-10', 'apkt_token' => $secret])->assertStatus(202)->json('data');

        Http::assertSentCount(1);                                                                    // 10 ULP x 2 months would be 20 requests; the rejected token ends the run at once
        $row = DB::table('eis_sync_runs')->where('id', $run['id'])->first();
        $this->assertSame('FAILED', $row->status);
        $this->assertStringContainsString('token APKT ditolak', (string) $row->log);
        $this->assertStringNotContainsString($secret, (string) $row->log.$row->options);
        $this->assertSame(0, DB::table('eis_report_files')->where('family', 'DIFI')->count());

        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10'])->assertUnprocessable();                           // the token is required
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'apkt_token' => 'pendek'])->assertStatus(409);      // not a plausible token
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'from_month' => '2024-01', 'to_month' => '2026-10', 'apkt_token' => $secret])->assertStatus(409);   // at most 24 months
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['kind' => 'apkt', 'to_month' => '2026-10', 'units' => ['51454'], 'apkt_token' => $secret])->assertStatus(409);   // a unit outside the scope
    }

    #[Test]
    public function an_apkt_token_left_on_a_run_that_never_finished_is_wiped_when_the_run_expires(): void
    {
        $id = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $id, 'trigger' => 'MANUAL', 'status' => 'QUEUED', 'started_by' => $this->sysAdmin->getKey(), 'kind' => 'APKT', 'options' => json_encode(['from_month' => '2026-10', 'to_month' => '2026-10', 'token_encrypted' => 'rahasia']), 'created_at' => now()->subDays(2)]);

        app(EisSyncService::class)->expireStale();

        $row = DB::table('eis_sync_runs')->where('id', $id)->first();
        $this->assertSame('FAILED', $row->status);
        $this->assertStringNotContainsString('token_encrypted', (string) $row->options);
    }

    #[Test]
    public function a_run_that_never_started_is_expired_when_the_status_is_read_and_a_launch_failure_marks_it_failed(): void
    {
        $this->fakeTool();
        $this->as($this->sysAdmin)->putJson('/api/eis-sync/settings', $this->syncBody())->assertOk();
        $stale = (string) Str::uuid();
        DB::table('eis_sync_runs')->insert(['id' => $stale, 'trigger' => 'MANUAL', 'status' => 'QUEUED', 'kind' => 'PIUTANG', 'created_at' => now()->subHours(5)]);

        $runs = collect($this->as($this->sysAdmin)->getJson('/api/eis-sync')->assertOk()->json('data.runs'))->keyBy('id');
        $this->assertSame('FAILED', $runs[$stale]['status']);                                                                // dibersihkan saat status dibaca: tombol tidak terkunci
        $this->assertSame('FAILED', $this->as($this->sysAdmin)->getJson('/api/eis-sync/runs/'.$stale)->assertOk()->json('data.status'));
        $this->assertStringContainsString('proses tidak selesai', (string) DB::table('eis_sync_runs')->where('id', $stale)->value('log'));

        Artisan::shouldReceive('call')->andThrow(new \RuntimeException('boom'));
        $this->withoutExceptionHandling();
        try {
            $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs');
            $this->fail('Galat peluncuran seharusnya diteruskan.');
        } catch (\RuntimeException $e) {
            $this->assertSame('boom', $e->getMessage());
        }
        $last = DB::table('eis_sync_runs')->orderByDesc('created_at')->first();
        $this->assertSame('FAILED', $last->status);
        $this->assertStringContainsString('tidak dapat dimulai: boom', (string) $last->log);
        $this->assertFalse(DB::table('eis_sync_runs')->whereIn('status', ['QUEUED', 'RUNNING'])->exists());
    }

    #[Test]
    public function the_older_range_for_running_applications_is_pulled_only_when_the_user_asks_for_it(): void
    {
        $dir = $this->fakeTool();
        $this->as($this->sysAdmin)->putJson('/api/eis-sync/settings', $this->syncBody())->assertOk();
        $args = fn () => json_decode((string) file_get_contents($dir.'/seen.json'), true)['args'];

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs')->assertStatus(202)->json('data');                                       // a plain manual run: no "lengkapi"
        $this->assertContains('--tanpa-lengkapi', $args());
        $this->assertFalse($run['complete_old']);

        $run = $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['complete_old' => true])->assertStatus(202)->json('data');            // the user chose it
        $this->assertNotContains('--tanpa-lengkapi', $args());
        $this->assertTrue($run['complete_old']);
        $this->as($this->sysAdmin)->postJson('/api/eis-sync/runs', ['complete_old' => 'ya'])->assertUnprocessable();
    }

    #[Test]
    public function the_sync_button_runs_the_tool_with_the_saved_account_range_and_a_short_lived_token(): void
    {
        $dir = $this->fakeTool();
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs')->assertStatus(409);                    // no EIS account yet
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['power_min' => 450, 'power_max' => 6600]))->assertOk();
        $this->as($this->vendor)->postJson('/api/eis-sync/runs')->assertForbidden();

        $run = $this->as($this->retailA1)->postJson('/api/eis-sync/runs', ['from' => '2026-10-01', 'to' => '2026-11-10'])->assertStatus(202)->json('data');
        $seen = json_decode((string) file_get_contents($dir.'/seen.json'), true);
        $this->assertSame(['sync', '--metode', 'http', '--konfirmasi', '--per-unit', '--dari', '2026-10-01', '--sampai', '2026-11-10', '--tanpa-lengkapi'], $seen['args']);
        $this->assertSame(['petugas.eis', 'Rahasia#123', '450', '6600', '90', true], [$seen['user'], $seen['pw'], $seen['min'], $seen['max'], $seen['lookback'], $seen['token']]);
        $done = $this->as($this->retailA1)->getJson("/api/eis-sync/runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame(['OK', 0, 'MANUAL'], [$done['status'], $done['exit_code'], $done['trigger']]);
        $this->assertStringContainsString('Diterapkan: ok', $done['log']);
        $this->assertStringNotContainsString('Rahasia#123', json_encode($done));
        $this->assertSame(0, DB::table('personal_access_tokens')->where('name', 'eis-sync')->count());   // the token of the run is revoked

        // the default range when none is given; a failing tool is a FAILED run with its log kept
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs')->assertStatus(202);
        $this->assertNotContains('--dari', json_decode((string) file_get_contents($dir.'/seen.json'), true)['args']);
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['eis_username' => 'fail']))->assertOk();
        $bad = $this->as($this->retailA1)->postJson('/api/eis-sync/runs')->assertStatus(202)->json('data.id');
        $this->assertSame(['FAILED', 1], [DB::table('eis_sync_runs')->where('id', $bad)->value('status'), (int) DB::table('eis_sync_runs')->where('id', $bad)->value('exit_code')]);

        // one run at a time
        DB::table('eis_sync_runs')->insert(['id' => (string) Str::uuid(), 'trigger' => 'MANUAL', 'status' => 'RUNNING', 'started_by' => $this->retailA1->getKey(), 'created_at' => now()]);
        $this->as($this->retailA1)->postJson('/api/eis-sync/runs')->assertStatus(409);
    }

    #[Test]
    public function the_automatic_sync_runs_once_a_day_after_its_time_as_the_user_who_saved_it(): void
    {
        $dir = $this->fakeTool();
        $svc = app(EisSyncService::class);
        $this->assertNull($svc->runScheduledIfDue());                                                      // disabled
        $this->as($this->retailA1)->putJson('/api/eis-sync/settings', $this->syncBody(['auto_enabled' => true, 'auto_time' => '23:59']))->assertOk();
        $this->travelTo(now(config('distriva.business_timezone'))->setTime(10, 0));
        $this->assertNull($svc->runScheduledIfDue());                                                      // not yet its time
        $this->travelTo(now(config('distriva.business_timezone'))->setTime(23, 59, 30));
        $id = $svc->runScheduledIfDue();
        $this->assertNotNull($id);
        $this->assertSame(['AUTO', 'OK', $this->retailA1->getKey()], [DB::table('eis_sync_runs')->where('id', $id)->value('trigger'), DB::table('eis_sync_runs')->where('id', $id)->value('status'), DB::table('eis_sync_runs')->where('id', $id)->value('started_by')]);
        $this->assertFileExists($dir.'/seen.json');
        $this->assertContains('--tanpa-lengkapi', json_decode((string) file_get_contents($dir.'/seen.json'), true)['args']);                  // the schedule pulls the configured range and nothing else
        $this->assertFalse((bool) DB::table('eis_sync_runs')->where('id', $id)->value('complete_old'));
        $this->assertNull($svc->runScheduledIfDue());                                                      // once per business day
    }

    public function test_finished_units_are_folded_so_log_truncation_keeps_every_unit_marker(): void
    {
        $fold = new \ReflectionMethod(EisSyncService::class, 'foldFinishedUnits');
        $svc = (new \ReflectionClass(EisSyncService::class))->newInstanceWithoutConstructor();
        $log = "=== Unit 1/2: 51450 51450 - A ===\nEIS: x\nDiterapkan: batch b [CONFIRMED] 10 baris: baru 3, cocok 0, tak berubah 5, ditolak 2, di luar cakupan 0\nUnit 51450 selesai (1 berkas).\n=== Unit 2/2: 51452 B ===\nberjalan\n";

        $out = $fold->invoke($svc, $log);

        $this->assertStringNotContainsString('EIS: x', $out);
        $this->assertStringContainsString('baru 3, cocok 0, tak berubah 5, ditolak 2', $out);
        $this->assertStringContainsString('Unit 51450 selesai (1 berkas).', $out);
        $this->assertStringContainsString('berjalan', $out);
        $this->assertSame($out, $fold->invoke($svc, $out));
    }
}
