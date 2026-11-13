<?php

namespace Tests\Feature;

use App\Services\Bom\BomCalculator;
use App\Services\Bom\BomService;
use App\Services\Mto\MtoService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use ReflectionMethod;
use Tests\PostgresTestCase;

/**
 * BOM group SR1PH = sheet 'APP 1 PHASA' of the master workbook (owner 2026-11-09, docs/62 §52): SDES-1 customers from the drawing (rows labelled 450-5500 VA), SDES-2 customers typed
 * as SR1:SDES2, every material counted once on the total, one 'Jasa Kegiatan' per SDES type. The fixture is the very document that is imported into distriva_db (tools/output/bom_SR1PH.json).
 */
class Sr1phBomTest extends PostgresTestCase
{
    /** @return array{id:string,codes:array<string,string>} */
    private function approvedBom(): array
    {
        $doc = json_decode((string) file_get_contents(base_path('tests/fixtures/bom_SR1PH.json')), true, 512, JSON_THROW_ON_ERROR);
        $creator = $this->makeUser();
        $approver = $this->makeUser();
        $codes = [];
        foreach ($doc['lines'] as $l) {
            if (($l['khs_code'] ?? null) !== null) {
                $codes[(string) $l['khs_code']] = (string) $l['khs_code'];
            }
        }
        foreach ($codes as $code) {
            $id = (string) Str::uuid();
            DB::table('khs_items')->insert(['id' => $id, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('khs_item_versions')->insert(['id' => (string) Str::uuid(), 'khs_item_id' => $id, 'version_number' => 1, 'name' => "Butir {$code}", 'unit_text' => 'B', 'valid_from' => '2025-01-01', 'status' => 'APPROVED',
                'created_by' => $creator->getKey(), 'approved_by' => $approver->getKey(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        }
        $r = app(BomService::class)->import($doc, '2025-01-01', 'uji', false, $creator);
        $this->assertSame(0, $r['summary']['rejected_lines']);
        $this->assertTrue($r['summary']['created']);
        $id = (string) DB::table('bom_headers')->where('group_code', 'SR1PH')->value('id');
        app(BomService::class)->approve([$id], $approver, 'uji');

        return ['id' => $id, 'codes' => $codes];
    }

    /** @return array<string,array{material:float,install:float}> by KHS code */
    private function calc(string $bomId, array $params): array
    {
        $out = [];
        foreach (app(BomCalculator::class)->calculate($bomId, [], $params) as $l) {
            $l = (array) $l;
            if (($l['khs_code'] ?? null) !== null) {
                $out[(string) $l['khs_code']] = ['material' => (float) $l['material'], 'install' => (float) $l['install']];
            }
        }

        return $out;
    }

    #[Test]
    public function sdes1_comes_from_the_450_5500_va_row_sdes2_is_typed_and_every_material_is_counted_once_on_the_total(): void
    {
        $b = $this->approvedBom();
        $base = ['PBPD:RENTANG_1' => '450-5500 VA', 'PBPD:PSG_1' => 3, 'SR1:SDES2' => 1];
        $q = $this->calc($b['id'], $base);
        $by = fn (string $name) => collect($b['codes'])->first(fn ($c) => $c === $name);
        $doc = json_decode((string) file_get_contents(base_path('tests/fixtures/bom_SR1PH.json')), true);
        $seq = collect($doc['lines'])->filter(fn ($l) => $l['khs_code'] ?? null)->mapWithKeys(fn ($l) => [$l['sequence'] => (string) $l['khs_code']]);

        $this->assertEquals(['material' => 0, 'install' => 3], $q[$seq[19]]);              // Jasa Kegiatan SDES-1 = SDES-1 customers
        $this->assertEquals(['material' => 0, 'install' => 1], $q[$seq[30]]);              // Jasa Kegiatan SDES-2 = SDES-2 customers
        foreach ([20 => 1, 21 => 2, 22 => 1, 23 => 3, 24 => 2, 26 => 2, 27 => 2, 28 => 2, 37 => 1, 38 => 1, 39 => 30, 42 => 1, 43 => 2] as $row => $factor) {
            $this->assertEquals(['material' => 4 * $factor, 'install' => 0], $q[$seq[$row]], "baris {$row}: jumlah total (3 + 1) x {$factor}, dihitung sekali");
        }
        $this->assertCount(15, $q);                                                         // no Angkutan Material, no other activity
    }

    #[Test]
    public function only_the_row_labelled_450_5500_va_counts_as_sdes1_and_no_customers_means_no_quantities(): void
    {
        $b = $this->approvedBom();
        $doc = json_decode((string) file_get_contents(base_path('tests/fixtures/bom_SR1PH.json')), true);
        $seq = collect($doc['lines'])->filter(fn ($l) => $l['khs_code'] ?? null)->mapWithKeys(fn ($l) => [$l['sequence'] => (string) $l['khs_code']]);

        $q = $this->calc($b['id'], ['PBPD:RENTANG_1' => '23 kVA', 'PBPD:PSG_1' => 5, 'PBPD:RENTANG_3' => '450-5500 VA', 'PBPD:PSG_3' => 2]);   // the 23 kVA row is a 3-phase job, the third row is SR 1 phase
        $this->assertEquals(['material' => 0, 'install' => 2], $q[$seq[19]]);
        $this->assertEquals(['material' => 2, 'install' => 0], $q[$seq[20]]);

        $none = $this->calc($b['id'], ['PBPD:RENTANG_1' => '23 kVA', 'PBPD:PSG_1' => 5]);
        foreach ($none as $code => $x) {
            $this->assertEquals(['material' => 0, 'install' => 0], $x, "kode {$code}");
        }
        $onlyTwo = $this->calc($b['id'], ['SR1:SDES2' => 2]);                                 // SDES-2 alone is enough
        $this->assertEquals(['material' => 0, 'install' => 2], $onlyTwo[$seq[30]]);
        $this->assertEquals(['material' => 2, 'install' => 0], $onlyTwo[$seq[20]]);
    }

    #[Test]
    public function the_sr1_group_joins_a_calculation_only_when_its_bom_is_approved_and_never_blocks_a_3_phase_job(): void
    {
        $with = new ReflectionMethod(MtoService::class, 'withPbpd');
        $svc = app(MtoService::class);
        $this->assertSame(['SUTM', 'PBPD_6_41', 'PBPD_53_197'], $with->invoke($svc, ['SUTM'], ['PBPD:PSG_1' => 1]));    // not approved yet: a 3-phase job is unaffected
        $this->assertSame(['SUTM'], $with->invoke($svc, ['SUTM'], ['SR1:SDES2' => 1]));
        $this->assertSame(['SUTM'], $with->invoke($svc, ['SUTM'], []));

        $this->approvedBom();
        $this->assertSame(['SUTM', 'PBPD_6_41', 'PBPD_53_197', 'SR1PH'], $with->invoke($svc, ['SUTM'], ['PBPD:PSG_1' => 1]));
        $this->assertSame(['SUTM', 'SR1PH'], $with->invoke($svc, ['SUTM'], ['SR1:SDES2' => 1]));                       // SDES-2 alone brings in only the 1-phase group
        $this->assertContains('SR1PH', MtoService::PARAM_DRIVEN_GROUPS);
    }
}
