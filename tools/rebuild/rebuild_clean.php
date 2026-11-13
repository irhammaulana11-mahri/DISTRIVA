<?php

/**
 * Clean rebuild of distriva_db (owner decision 2026-11-09, docs/62 §52). Run through tinker, one phase at a time:
 *
 *   REBUILD_PHASE=export                         php artisan tinker --execute="require '<this file>';"   (read-only; writes tools/output/rebuild/export.json)
 *   REBUILD_PHASE=wipe REBUILD_DB=<database>     ...   (TRUNCATE of every table except the KEEP list; refuses when the connected database is not REBUILD_DB)
 *   REBUILD_PHASE=load REBUILD_DB=<database>     ...   (KHS with the new codes, construction types + mappings, price book + zones, tariff book, KKF parameter set; all DRAFT)
 *
 * Kept: users, organizational units (+ history), warehouses (ERP storage locations of the units), roles / permissions / grants / assignments, login tokens, MFA, password history,
 * migrations, lookup tables (document categories, external status mappings), backup settings and history.
 * Code rules (owner): material PLN/MDU take the code, name and MDU value of workbook kkfsetuju_PABRIKBITINGMARJONO (tools/output/peta_kode_khs_baru.csv);
 * those that are not in it keep their DISTRIVA name/value and get a new code (JTMR<next number> for cables, A<next number> otherwise); everything else (services, non-MDU material) is unchanged.
 */

use App\Models\User;
use App\Services\ConstructionTypeService;
use App\Services\Kkf\KkfParameterService;
use App\Services\Kkf\TariffBookService;
use App\Services\KhsCatalogService;
use App\Services\Prices\PriceBookService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

$phase = (string) getenv('REBUILD_PHASE');
$dir = '/media/data/PROJECT/DISTRIVA/tools/output/rebuild';
if (! is_dir($dir)) {
    mkdir($dir, 0775, true);
}
$say = function (string $m): void {
    echo $m.PHP_EOL;
};
$csv = function (string $name, array $header, array $rows) use ($dir): UploadedFile {
    $path = "{$dir}/{$name}";
    $h = fopen($path, 'w');
    fputcsv($h, $header, ',', '"', '\\');
    foreach ($rows as $r) {
        fputcsv($h, $r, ',', '"', '\\');
    }
    fclose($h);

    return new UploadedFile($path, $name, 'text/csv', null, true);
};

if ($phase === 'export') {
    $khs = [];
    foreach (DB::table('khs_items')->get() as $i) {
        $v = DB::table('khs_item_versions')->where('khs_item_id', $i->id)->orderByDesc('version_number')->first();
        $khs[$i->code] = ['code' => $i->code, 'name' => $v->name, 'unit' => $v->unit_text, 'category' => $v->category, 'description' => $v->description, 'valid_from' => $v->valid_from];
    }
    $pb = DB::table('price_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
    $items = [];
    foreach (DB::table('price_book_items as p')->join('khs_items as i', 'i.id', '=', 'p.khs_item_id')->where('p.price_book_id', $pb->id)->get(['p.id', 'i.code', 'p.material_status', 'p.material_price', 'p.insured_value']) as $p) {
        $zones = [];
        foreach (DB::table('price_book_service_prices')->where('price_book_item_id', $p->id)->get() as $z) {
            $zones[$z->zone] = [$z->install_price, $z->remove_price];
        }
        $items[$p->code] = ['status' => $p->material_status, 'price' => $p->material_price, 'insured' => $p->insured_value, 'zones' => $zones];
    }
    $zoneRows = DB::table('price_book_zones as z')->join('organizational_units as u', 'u.id', '=', 'z.up3_unit_id')->where('z.price_book_id', $pb->id)->get(['u.code as up3', 'z.zone'])->map(fn ($z) => (array) $z)->all();
    $tb = DB::table('tariff_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first();
    $tariff = DB::table('tariff_book_rows as r')->leftJoin('organizational_units as u', 'u.id', '=', 'r.ulp_unit_id')->where('r.tariff_book_id', $tb->id)->get(['u.code as ulp', 'r.tariff_code', 'r.power_va', 'r.avg_price', 'r.jam_nyala', 'r.ujl'])->map(fn ($r) => (array) $r)->all();
    $kkf = DB::table('kkf_parameter_sets')->orderByDesc('valid_from')->first();
    $types = [];
    foreach (DB::table('construction_types')->get() as $t) {
        $v = DB::table('construction_type_versions')->where('construction_type_id', $t->id)->orderByDesc('version_number')->first();
        $maps = DB::table('construction_khs_mappings as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->where('m.construction_type_version_id', $v->id)->orderBy('m.sequence')->get(['i.code as khs', 'm.sequence', 'm.relation', 'm.note', 'm.source_reference']);
        $types[] = ['group' => $t->group_code, 'code' => $t->code, 'external_code' => $t->external_code, 'name' => $v->name, 'description' => $v->description, 'symbol' => $v->reference_symbol, 'source' => $v->source_reference, 'valid_from' => $v->valid_from,
            'mappings' => $maps->map(fn ($m) => (array) $m)->all()];
    }
    $sku = DB::table('khs_material_map as m')->join('khs_items as i', 'i.id', '=', 'm.khs_item_id')->get(['i.code as khs', 'm.material_no', 'm.note'])->map(fn ($r) => (array) $r)->all();
    $ex = DB::table('khs_sku_exemptions as e')->join('khs_items as i', 'i.id', '=', 'e.khs_item_id')->whereNull('e.lifted_at')->get(['i.code as khs', 'e.reason'])->map(fn ($r) => (array) $r)->all();
    file_put_contents("{$dir}/export.json", json_encode(['khs' => $khs, 'price_book' => ['name' => $pb->name, 'contract' => $pb->contract_reference, 'valid_from' => $pb->valid_from, 'source' => $pb->source_reference, 'items' => $items, 'zones' => $zoneRows],
        'tariff_book' => ['name' => $tb->name, 'valid_from' => $tb->valid_from, 'source' => $tb->source_reference, 'rows' => $tariff], 'kkf' => (array) $kkf, 'types' => $types, 'sku_map' => $sku, 'exemptions' => $ex], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    $say('export: khs '.count($khs).', harga '.count($items).', zona '.count($zoneRows).', tarif '.count($tariff).', tipe '.count($types).', sku '.count($sku).', pengecualian '.count($ex));

    return;
}

$db = (string) getenv('REBUILD_DB');
if ($db === '' || DB::getDatabaseName() !== $db) {
    throw new RuntimeException('Menolak: database terhubung ('.DB::getDatabaseName().') bukan REBUILD_DB ('.$db.').');
}

if ($phase === 'wipe') {
    $keep = ['users', 'organizational_units', 'organizational_unit_histories', 'warehouses', 'roles', 'permissions', 'role_has_permissions', 'model_has_roles', 'model_has_permissions', 'user_role_assignments', 'user_role_assignment_histories',
        'authorization_change_histories', 'personal_access_tokens', 'user_mfa_credentials', 'otp_challenges', 'password_histories', 'migrations', 'document_categories', 'external_status_mappings', 'backup_settings', 'backup_runs', 'backup_events', 'restore_runs', 'units_of_measure'];
    $all = array_map(fn ($r) => $r->tablename, DB::select("select tablename from pg_tables where schemaname = 'public'"));
    $wipe = array_values(array_diff($all, $keep));
    sort($wipe);
    // history / immutability triggers reject DELETE and TRUNCATE by design: switch the user triggers off on the wiped tables only, inside ONE transaction, and switch them back on before it ends
    DB::transaction(function () use ($wipe): void {
        foreach ($wipe as $t) {
            DB::statement('ALTER TABLE "'.$t.'" DISABLE TRIGGER USER');
        }
        DB::statement('TRUNCATE TABLE '.implode(', ', array_map(fn ($t) => '"'.$t.'"', $wipe)).' RESTART IDENTITY');
        foreach ($wipe as $t) {
            DB::statement('ALTER TABLE "'.$t.'" ENABLE TRIGGER USER');
        }
    });
    $off = DB::selectOne("select count(*) c from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgenabled = 'D'")->c;
    if ($off > 0) {
        throw new RuntimeException("Ada {$off} pemicu yang masih nonaktif.");
    }
    $say('wipe: '.count($wipe).' tabel dikosongkan, '.count(array_intersect($keep, $all)).' dipertahankan');
    foreach (['users', 'organizational_units', 'roles', 'permissions', 'user_role_assignments', 'warehouses'] as $t) {
        $say("  {$t}: ".DB::table($t)->count());
    }

    return;
}

if ($phase !== 'load') {
    throw new RuntimeException('REBUILD_PHASE harus export, wipe, atau load.');
}

$x = json_decode((string) file_get_contents("{$dir}/export.json"), true, 512, JSON_THROW_ON_ERROR);
$actor = User::where('email', 'admin@distriva.com')->firstOrFail();
Auth::login($actor);

// ---- code map (tools/rebuild/build_code_plan.py -> tools/output/rebuild/code_plan.csv) -----------------------------------------------------------------------------------------------
$map = [];                                                                       // old code => [new, name, mdu|null, source]
$h = fopen("{$dir}/code_plan.csv", 'r');
$head = fgetcsv($h, 0, ',', '"', '\\');
while (($r = fgetcsv($h, 0, ',', '"', '\\')) !== false) {
    $row = array_combine($head, $r);
    if (! isset($x['khs'][$row['kode_lama']])) {
        continue;
    }
    $map[$row['kode_lama']] = [$row['kode_baru'], $row['nama_baru'], $row['mdu'] === '' ? null : (float) $row['mdu'], $row['asal']];
}
fclose($h);
if (count($map) !== count($x['khs'])) {
    throw new RuntimeException('code_plan.csv tidak memuat semua KHS ('.count($map).' dari '.count($x['khs']).').');
}
$sr1 = [];                                                                       // new KHS of the APP 1 PHASA sheet
$h = fopen("{$dir}/sr1_khs_baru.csv", 'r');
$head = fgetcsv($h, 0, ',', '"', '\\');
while (($r = fgetcsv($h, 0, ',', '"', '\\')) !== false) {
    $sr1[] = array_combine($head, $r);
}
fclose($h);
$newCode = fn (string $old) => $map[$old][0] ?? $old;
$codes = array_merge(array_map(fn ($o) => $newCode((string) $o), array_keys($x['khs'])), array_column($sr1, 'kode_baru'));
foreach (array_count_values($codes) as $c => $n) {
    if ($n > 1) {
        throw new RuntimeException("Kode baru ganda: {$c}");
    }
}

// ---- KHS ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
$khsRows = [];
$from = '2025-01-01';
foreach ($x['khs'] as $old => $k) {
    $khsRows[] = [$newCode((string) $old), $map[$old][1] ?? $k['name'], $k['unit'], $k['category'], $k['description']];
    $from = min($from, (string) $k['valid_from']);
}
foreach ($sr1 as $n) {
    $khsRows[] = [$n['kode_baru'], $n['nama'], $n['satuan'], null, null];
}
$res = app(KhsCatalogService::class)->import($csv('khs_new.csv', ['code', 'name', 'unit', 'category', 'description'], $khsRows), $from, 'Bangun ulang 2026-11-09 (docs/62 §52)', false, false, $actor);
$say('KHS: '.json_encode($res['summary']));

// ---- construction types + mappings -------------------------------------------------------------------------------------------------------------------------------------------------
$tFrom = min(array_column($x['types'], 'valid_from'));
$res = app(ConstructionTypeService::class)->importTypes($csv('types_new.csv', ['group', 'code', 'label', 'description', 'reference_symbol', 'source_reference'],
    array_map(fn ($t) => [$t['group'], $t['code'], $t['name'], $t['description'], $t['symbol'], $t['source']], $x['types'])), $tFrom, 'Bangun ulang 2026-11-09', false, $actor);
$say('Tipe konstruksi: '.json_encode($res['summary']));
$mapRows = [];
foreach ($x['types'] as $t) {
    foreach ($t['mappings'] as $m) {
        $mapRows[] = [$t['group'], $t['code'], $t['name'], $newCode((string) $m['khs']), $m['relation'], $m['note'], $m['source_reference']];
    }
}
$res = app(ConstructionTypeService::class)->importMappings($csv('mappings_new.csv', ['group', 'code', 'label', 'khs_code', 'relation', 'note', 'source_reference'], $mapRows), false, $actor);
$say('Pemetaan tipe-KHS: '.json_encode($res['summary']));

// ---- price book ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
$zonesUsed = [];
foreach ($x['price_book']['items'] as $p) {
    foreach (array_keys($p['zones']) as $z) {
        $zonesUsed[$z] = true;
    }
}
ksort($zonesUsed);
$head = ['kode', 'nama', 'status_material', 'harga_material', 'nilai_asuransi'];
foreach (array_keys($zonesUsed) as $z) {
    $head[] = "z{$z}_pasang";
    $head[] = "z{$z}_bongkar";
}
$priceRows = [];
foreach ($x['price_book']['items'] as $old => $p) {
    $insured = isset($map[$old]) ? $map[$old][2] : $p['insured'];
    $row = [$newCode((string) $old), $map[$old][1] ?? $x['khs'][$old]['name'], $p['status'], $p['status'] === 'PLN' ? '' : $p['price'], $insured ?? ''];
    foreach (array_keys($zonesUsed) as $z) {
        $row[] = $p['zones'][$z][0] ?? '';
        $row[] = $p['zones'][$z][1] ?? '';
    }
    $priceRows[] = $row;
}
foreach ($sr1 as $n) {
    $row = [$n['kode_baru'], $n['nama'], $n['status_material'], $n['status_material'] === 'PLN' ? '' : $n['harga_material'], $n['mdu']];
    foreach (array_keys($zonesUsed) as $z) {
        $row[] = $n['harga_jasa_pasang'] === '' ? 0 : $n['harga_jasa_pasang'];   // a service price of the sheet (0 for materials: their labour is the 'Jasa Kegiatan' line; the sheet has no price for 'Penggeseran APP')
        $row[] = 0;
    }
    $priceRows[] = $row;
}
$pbSvc = app(PriceBookService::class);
$res = $pbSvc->import($csv('price_book_new.csv', $head, $priceRows), $x['price_book']['name'], $x['price_book']['contract'], $x['price_book']['valid_from'], 'Bangun ulang 2026-11-09; MDU/PLN dari kkfsetuju_PABRIKBITINGMARJONO', false, $actor);
$say('Buku harga: '.json_encode($res['summary']));
$bookId = DB::table('price_books')->orderByDesc('created_at')->value('id');
foreach ($x['price_book']['zones'] as $z) {
    $up3 = DB::table('organizational_units')->where('code', $z['up3'])->value('id');
    if ($up3) {
        $pbSvc->setZone($bookId, $up3, (int) $z['zone'], 'Zona UP3 dipulihkan pada bangun ulang 2026-11-09', $actor);
    }
}
$say('Zona UP3 dipulihkan: '.count($x['price_book']['zones']));

// ---- tariff book ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
$res = app(TariffBookService::class)->import($csv('tariff_new.csv', ['tarif', 'daya_va', 'harga_rata2', 'jam_nyala', 'ujl', 'ulp'],
    array_map(fn ($r) => [$r['tariff_code'], $r['power_va'], $r['avg_price'], $r['jam_nyala'], $r['ujl'], $r['ulp']], $x['tariff_book']['rows'])), $x['tariff_book']['name'], $x['tariff_book']['valid_from'], 'Bangun ulang 2026-11-09', false, $actor);
$say('Buku tarif: '.json_encode($res['summary']));

// ---- KKF parameter set (load factor 0.8, owner 2026-11-09) ---------------------------------------------------------------------------------------------------------------------------
$k = $x['kkf'];
app(KkfParameterService::class)->create(['name' => $k['name'], 'valid_from' => $k['valid_from'], 'notes' => $k['notes'], 'reason' => 'Bangun ulang 2026-11-09: faktor beban 0,8',
    'discount_rate' => $k['discount_rate'], 'bpp' => $k['bpp'], 'om_rate' => $k['om_rate'], 'load_factor' => 0.8, 'roe' => $k['roe'], 'interest_rate' => $k['interest_rate'], 'tax_rate' => $k['tax_rate'],
    'horizon_years' => $k['horizon_years'], 'payback_limit_months' => $k['payback_limit_months']], $actor);
$say('Parameter KKF: dibuat (DRAFT, faktor beban 0,8)');

// ---- items to replay later (need the ERP material master, which a stock sync brings back) ---------------------------------------------------------------------------------------------
$csv('pemetaan_sku_dipulihkan.csv', ['kode_khs', 'no_material', 'catatan'], array_map(fn ($r) => [$newCode((string) $r['khs']), $r['material_no'], $r['note']], $x['sku_map']));
$csv('pengecualian_sku_dipulihkan.csv', ['kode_khs', 'alasan'], array_map(fn ($r) => [$newCode((string) $r['khs']), $r['reason']], $x['exemptions']));
$h = fopen("{$dir}/peta_kode_lama_baru.csv", 'w');
fputcsv($h, ['kode_lama', 'kode_baru', 'asal'], ',', '"', '\\');
foreach ($map as $old => $m) {
    fputcsv($h, [$old, $m[0], $m[3]], ',', '"', '\\');
}
fclose($h);
$say('Berkas pemulihan ditulis di '.$dir);
