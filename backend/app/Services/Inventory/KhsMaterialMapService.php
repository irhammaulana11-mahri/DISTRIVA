<?php

namespace App\Services\Inventory;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Support\CsvTable;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Mapping KHS item <-> ERP material number (SKU) (docs/62 §39): the ERP stock file is keyed by SKU, planning by KHS. CSV columns: kode_khs, no_material (leading zeros are ignored), note (optional).
 * All-or-nothing; a SKU maps to ONE KHS item (re-sending the same pair is harmless, a different KHS for a mapped SKU is refused); several SKUs may map to one KHS item. The mapping applies to the
 * stock files imported AFTER it (a stored snapshot keeps the mapping of its import day). Callers authorize `khs.manage` first.
 */
class KhsMaterialMapService
{
    /** @return array<string,list<string>> */
    private function headers(): array
    {
        return ['code' => ['kode_khs', 'khs', 'kode'], 'sku' => ['no_material', 'material_no', 'sku', 'nomor_material'], 'note' => ['note', 'catatan', 'keterangan']];
    }

    /** @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>} */
    public function import(UploadedFile $file, bool $dryRun, User $actor): array
    {
        ['rows' => $rows] = CsvTable::read($file, $this->headers(), ['code', 'sku']);
        if ($rows === [] || count($rows) > 20000) {
            throw new AssignmentRuleViolation($rows === [] ? 'Berkas tidak memuat baris data.' : 'Berkas melebihi batas 20.000 baris.');
        }
        $items = DB::table('khs_items')->whereIn('code', array_column($rows, 'code'))->pluck('id', 'code')->all();
        $existing = DB::table('khs_material_map')->pluck('khs_item_id', 'material_no')->all();
        $exempt = DB::table('khs_sku_exemptions')->whereNull('lifted_at')->pluck('khs_item_id', 'khs_item_id')->all();
        $seen = [];
        $out = [];
        $accepted = [];
        $unchanged = 0;
        foreach ($rows as $r) {
            $errs = [];
            $sku = ltrim(trim((string) $r['sku']), '0');
            if (! isset($items[$r['code']])) {
                $errs[] = "kode KHS {$r['code']} tidak ada.";
            }
            if ($sku === '' || ! ctype_digit($sku)) {
                $errs[] = 'no_material harus angka.';
            }
            if (isset($items[$r['code']]) && isset($exempt[$items[$r['code']]])) {
                $errs[] = "KHS {$r['code']} dikecualikan dari pemetaan SKU.";
            }
            if (isset($seen[$sku]) && $seen[$sku] !== ($items[$r['code']] ?? null)) {
                $errs[] = "no_material {$sku} diarahkan ke dua kode KHS berbeda pada berkas ini.";
            }
            $seen[$sku] = $items[$r['code']] ?? null;
            if ($errs === [] && isset($existing[$sku]) && $existing[$sku] !== $items[$r['code']]) {
                $errs[] = "no_material {$sku} sudah dipetakan ke KHS lain.";
            }
            $out[] = ['row' => $r['row'], 'khs_code' => $r['code'], 'material_no' => $sku, 'status' => $errs === [] ? (isset($existing[$sku]) ? 'UNCHANGED' : 'OK') : 'REJECTED', 'errors' => $errs];
            if ($errs === []) {
                isset($existing[$sku]) ? $unchanged++ : $accepted[$sku] = ['khs_item_id' => $items[$r['code']], 'note' => isset($r['note']) && $r['note'] !== '' ? mb_substr($r['note'], 0, 255) : null];
            }
        }
        $rejected = count(array_filter($out, fn ($o) => $o['status'] === 'REJECTED'));
        if ($rejected > 0) {
            throw new AssignmentRuleViolation("Impor dibatalkan seluruhnya: {$rejected} baris ditolak. Perbaiki berkas lalu ulangi.");
        }
        $summary = ['dry_run' => $dryRun, 'total' => count($rows), 'new' => count($accepted), 'unchanged' => $unchanged];
        if (! $dryRun) {
            DB::transaction(function () use ($accepted, $actor): void {
                foreach ($accepted as $sku => $a) {
                    DB::table('khs_material_map')->insert(['id' => (string) Str::uuid(), 'material_no' => $sku, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()] + $a);
                }
            });
        }

        return ['summary' => $summary, 'rows' => $out];
    }

    public function create(string $khsCode, string $materialNo, ?string $note, User $actor): string
    {
        $khs = DB::table('khs_items')->where('code', $khsCode)->value('id') ?? throw new AssignmentRuleViolation("Kode KHS {$khsCode} tidak ada.");
        $sku = ltrim(trim($materialNo), '0');
        if ($sku === '' || ! ctype_digit($sku)) {
            throw new AssignmentRuleViolation('no_material harus angka.');
        }
        if (DB::table('khs_sku_exemptions')->where('khs_item_id', $khs)->whereNull('lifted_at')->exists()) {
            throw new AssignmentRuleViolation("KHS {$khsCode} dikecualikan dari pemetaan SKU; cabut pengecualiannya dulu bila ingin memetakannya.");
        }
        $current = DB::table('khs_material_map')->where('material_no', $sku)->first();
        if ($current !== null) {
            throw new AssignmentRuleViolation($current->khs_item_id === $khs ? 'Pemetaan ini sudah ada.' : "no_material {$sku} sudah dipetakan ke KHS lain; hapus pemetaan itu dulu.");
        }
        $id = (string) Str::uuid();
        DB::table('khs_material_map')->insert(['id' => $id, 'khs_item_id' => $khs, 'material_no' => $sku, 'note' => $note, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    /** KHS word -> words that name the same thing in the ERP subcategory names (the ERP catalogue speaks English and abbreviates). */
    private const CATEGORY_SYNONYMS = [
        'trafo' => ['transformator', 'transformer'], 'kubikel' => ['cubicle', 'cub'], 'arrester' => ['arrester'], 'kabel' => ['kabel', 'cable'], 'tiang' => ['tiang', 'pole'],
        'meter' => ['meter', 'kwh'], 'kwh' => ['kwh', 'meter'], 'isolator' => ['isolator', 'insulator'], 'insulator' => ['isolator', 'insulator'], 'fuse' => ['fuse', 'sekring'],
        'cut' => ['cut'], 'lvsb' => ['lvsb'], 'ct' => ['ct'], 'pt' => ['pt'], 'termination' => ['terminal', 'konektor'], 'konduktor' => ['konduktor', 'conductor'],
        'steel' => ['grounding', 'pembumian'], 'wire' => ['grounding', 'pembumian'], 'tie' => ['string', 'isolator'], 'gembok' => ['peralatan'], 'baterai' => ['baterai'],
    ];

    /** Subcategory-name words too generic to say anything about what a material is. */
    private const CATEGORY_GENERIC = ['aksesori', 'umum', 'dan', 'peralatan', 'material', 'tegangan', 'menengah', 'rendah', 'tm', 'tr', 'konfirmasi', 'final', 'perlu', 'review', 'per', 'item'];

    /** True while an exemption of the KHS item is in force (deliberately not mapped: see khs_sku_exemptions). */
    private const EXEMPT_SQL = 'exists (select 1 from khs_sku_exemptions e where e.khs_item_id = k.id and e.lifted_at is null)';

    /** Supply of a KHS item in the price book in force today: PLN = supplied by PLN from its warehouses (the only ones that need an ERP SKU), PRICED = bought by the vendor, null = in no approved book. */
    private const SUPPLY_SQL = "(select i.material_status from price_book_items i join price_books pb on pb.id = i.price_book_id where i.khs_item_id = k.id and pb.status = 'APPROVED'
        and pb.valid_from <= current_date and (pb.valid_until is null or pb.valid_until >= current_date) order by pb.valid_from desc limit 1)";

    /** KHS items with their mapped SKUs; `used` = referenced by an APPROVED BOM (the ones the planning needs first); `plnOnly` = only material supplied by PLN. @return \Illuminate\Contracts\Pagination\LengthAwarePaginator */
    public function workbench(string $filter, ?string $search, bool $usedOnly, int $perPage, bool $plnOnly = false)
    {
        $q = DB::table('khs_items as k')->selectRaw("k.id, k.code, (select v.name from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as name,
            (select v.unit_text from khs_item_versions v where v.khs_item_id = k.id order by v.version_number desc limit 1) as unit,
            exists (select 1 from bom_lines l join bom_headers h on h.id = l.bom_header_id where l.khs_item_id = k.id and h.status = 'APPROVED') as used_in_bom,
            (select count(*) from khs_material_map m where m.khs_item_id = k.id) as mapped_count, ".self::SUPPLY_SQL.' as material_status, '.self::EXEMPT_SQL.' as sku_exempt, (select e.reason from khs_sku_exemptions e where e.khs_item_id = k.id and e.lifted_at is null) as exempt_reason')->where('k.is_active', true);
        if ($filter === 'unmapped') {
            $q->whereNotExists(fn ($s) => $s->from('khs_material_map as m')->whereColumn('m.khs_item_id', 'k.id'));
        } elseif ($filter === 'mapped') {
            $q->whereExists(fn ($s) => $s->from('khs_material_map as m')->whereColumn('m.khs_item_id', 'k.id'));
        }
        if ($usedOnly) {
            $q->whereRaw("exists (select 1 from bom_lines l join bom_headers h on h.id = l.bom_header_id where l.khs_item_id = k.id and h.status = 'APPROVED')");
        }
        if ($plnOnly) {
            $q->whereRaw(self::SUPPLY_SQL." = 'PLN'")->whereRaw('not '.self::EXEMPT_SQL);
        }
        if ($search !== null && trim($search) !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($search)).'%';
            $q->where(fn ($w) => $w->where('k.code', 'ilike', $term)->orWhereRaw('exists (select 1 from khs_item_versions v where v.khs_item_id = k.id and v.name ilike ?)', [$term]));
        }

        return $q->orderByRaw('used_in_bom desc, length(k.code), k.code')->paginate($perPage);
    }

    /** @return array<string,list<array<string,mixed>>> khs_item_id => mapped SKUs */
    public function mappedSkus(array $khsIds): array
    {
        return DB::table('khs_material_map')->whereIn('khs_item_id', $khsIds)->orderBy('material_no')->get(['id', 'khs_item_id', 'material_no', 'note'])->groupBy('khs_item_id')
            ->map(fn ($g) => $g->map(fn ($m) => ['id' => $m->id, 'material_no' => $m->material_no, 'note' => $m->note])->all())->all();
    }

    /**
     * Candidate SKUs for a KHS item, from the ERP material catalogue and the SKUs of stock files (not yet mapped), ranked by the words and numbers they share with the KHS name (+ same unit).
     * A SUGGESTION for a person to confirm (the names of the KHS and of the ERP differ a lot): never applied automatically.
     *
     * @return list<array{material_no:string,name:string,unit:?string,score:float,source:string}>
     */
    /**
     * Ranked candidate SKUs for one KHS item. `$categoryId` (a category or a subcategory) keeps only catalogue materials of that branch: with the two-level categories the
     * list shrinks from 1.254 materials to a few dozen. Each candidate carries its subcategory (`category`) so a person can see where it sits.
     *
     * @return list<array<string,mixed>>
     */
    public function suggestions(string $khsCode, int $limit = 10, ?string $categoryId = null): array
    {
        return array_slice($this->scored($khsCode, $categoryId), 0, $limit);
    }

    /**
     * Where the best candidates sit: the subcategories of the top-30 unfiltered candidates with how many each holds (strongest first: ordered by the best candidate score it holds), the hint for a narrower search.
     *
     * @return list<array{id:string,code:string,name:string,parent_name:?string,count:int}>
     */
    public function suggestionCategories(string $khsCode): array
    {
        $facets = [];
        foreach (array_slice($this->scored($khsCode, null), 0, 30) as $c) {
            if ($c['category'] === null) {
                continue;
            }
            $k = $c['category']['id'];
            $facets[$k] ??= ['id' => $k, 'code' => $c['category']['code'], 'name' => $c['category']['name'], 'parent_name' => $c['category']['parent_name'], 'count' => 0, 'best' => 0.0];
            $facets[$k]['count']++;
            $facets[$k]['best'] = max($facets[$k]['best'], $c['score']);
        }
        usort($facets, fn ($a, $b) => $b['best'] <=> $a['best'] ?: $b['count'] <=> $a['count'] ?: strcmp($a['code'], $b['code']));      // by the best candidate it holds: one strong match beats many weak ones

        return array_values(array_map(fn ($f) => ['id' => $f['id'], 'code' => $f['code'], 'name' => $f['name'], 'parent_name' => $f['parent_name'], 'count' => $f['count']], $facets));
    }

    /** @param array<string,int> $want KHS words with their ERP synonyms (as keys) */
    private function categoryMatches(string $categoryName, array $want): bool
    {
        foreach ($this->tokens($categoryName) as $w) {
            if (! in_array($w, self::CATEGORY_GENERIC, true) && isset($want[$w])) {
                return true;
            }
        }

        return false;
    }

    /** @return list<array<string,mixed>> every positive-score candidate, best first */
    private function scored(string $khsCode, ?string $categoryId): array
    {
        $khs = DB::table('khs_items')->where('code', $khsCode)->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        $v = DB::table('khs_item_versions')->where('khs_item_id', $khs->id)->orderByDesc('version_number')->first();
        $kt = $this->tokens((string) ($v->name ?? ''));
        if ($kt === []) {
            return [];
        }
        $mapped = DB::table('khs_material_map')->pluck('material_no')->flip()->all();
        $want = $kt;
        foreach ($kt as $w) {
            $want = array_merge($want, self::CATEGORY_SYNONYMS[$w] ?? []);
        }
        $want = array_flip($want);
        $cands = [];
        $materials = DB::table('materials as m')->leftJoin('material_categories as c', 'c.id', '=', 'm.category_id')->leftJoin('material_categories as p', 'p.id', '=', 'c.parent_id')
            ->select('m.code', 'm.name', 'm.unit', 'c.id as cat_id', 'c.code as cat_code', 'c.name as cat_name', 'p.name as parent_name');
        if ($categoryId !== null) {
            $materials->whereIn('m.category_id', DB::table('material_categories')->where('id', $categoryId)->orWhere('parent_id', $categoryId)->select('id'));
        }
        foreach ($materials->get() as $m) {
            $cands[ltrim((string) $m->code, '0')] ??= ['material_no' => (string) $m->code, 'name' => (string) $m->name, 'unit' => $m->unit, 'source' => 'KATALOG_ERP',
                'category' => $m->cat_id === null ? null : ['id' => $m->cat_id, 'code' => $m->cat_code, 'name' => $m->cat_name, 'parent_name' => $m->parent_name]];
        }
        if ($categoryId === null) {      // a category filter means the ERP catalogue only: stock-file SKUs have no category
            $latest = DB::table('stock_snapshots')->selectRaw('distinct on (warehouse_id) id')->orderBy('warehouse_id')->orderByDesc('as_of')->pluck('id');
            foreach (DB::table('stock_snapshot_materials')->whereIn('snapshot_id', $latest)->get(['material_no', 'material_name', 'unit']) as $m) {
                $cands[ltrim((string) $m->material_no, '0')] ??= ['material_no' => (string) $m->material_no, 'name' => (string) $m->material_name, 'unit' => $m->unit, 'source' => 'STOK_ERP', 'category' => null];
            }
        }
        $out = [];
        foreach ($cands as $key => $c) {
            if (isset($mapped[$key])) {
                continue;
            }
            $t = $this->tokens($c['name']);
            if ($t === [] && $categoryId === null) {
                continue;
            }
            $score = $t === [] ? 0.0 : count(array_intersect($kt, $t)) / count(array_unique(array_merge($kt, $t)));
            $named = $c['category'] !== null && $this->categoryMatches($c['category']['name'], $want);   // the subcategory names what the KHS item is (e.g. "Trafo Distribusi" -> "Transformator Distribusi")
            if ($score <= 0 && ! $named && $categoryId === null) {
                continue;      // unfiltered: only candidates that share a word or sit in the named subcategory; filtered: the whole branch, so a person can browse it
            }
            if ($this->unit((string) ($v->unit_text ?? '')) !== '' && $this->unit((string) ($v->unit_text ?? '')) === $this->unit((string) ($c['unit'] ?? ''))) {
                $score += 0.1;
            }
            if ($named) {
                $score += 0.25;
            }
            $out[] = $c + ['score' => round($score, 3)];
        }
        usort($out, fn ($a, $b) => $b['score'] <=> $a['score']);

        return $out;
    }

    /** @return array{khs_used_total:int,khs_used_mapped:int,khs_used_percent:float,sku_exempt_total:int,sku_needed_total:int,sku_needed_mapped:int,sku_needed_percent:float,latest_snapshots:list<array<string,mixed>>} */
    public function coverage(): array
    {
        $used = DB::table('khs_items as k')->where('k.is_active', true)->whereRaw("exists (select 1 from bom_lines l join bom_headers h on h.id = l.bom_header_id where l.khs_item_id = k.id and h.status = 'APPROVED')");
        $total = (clone $used)->count();
        $mapped = (clone $used)->whereExists(fn ($s) => $s->from('khs_material_map as m')->whereColumn('m.khs_item_id', 'k.id'))->count();
        $plnAll = (clone $used)->whereRaw(self::SUPPLY_SQL." = 'PLN'");
        $exempt = (clone $plnAll)->whereRaw(self::EXEMPT_SQL)->count();
        $pln = (clone $plnAll)->whereRaw('not '.self::EXEMPT_SQL);
        $plnTotal = (clone $pln)->count();
        $plnMapped = (clone $pln)->whereExists(fn ($s) => $s->from('khs_material_map as m')->whereColumn('m.khs_item_id', 'k.id'))->count();
        $snaps = DB::table('stock_snapshots as s')->join('warehouses as w', 'w.id', '=', 's.warehouse_id')->selectRaw('distinct on (s.warehouse_id) s.id, w.code, w.name, s.as_of, s.materials_total, s.materials_mapped')->orderBy('s.warehouse_id')->orderByDesc('s.as_of')->get();

        return ['khs_used_total' => $total, 'khs_used_mapped' => $mapped, 'khs_used_percent' => $total === 0 ? 0.0 : round($mapped * 100 / $total, 1),
            'sku_exempt_total' => $exempt, 'sku_needed_total' => $plnTotal, 'sku_needed_mapped' => $plnMapped, 'sku_needed_percent' => $plnTotal === 0 ? 0.0 : round($plnMapped * 100 / $plnTotal, 1),
            'latest_snapshots' => $snaps->map(fn ($s) => ['snapshot_id' => $s->id, 'warehouse_code' => $s->code, 'warehouse_name' => $s->name, 'as_of' => $s->as_of, 'materials_total' => (int) $s->materials_total, 'materials_mapped' => (int) $s->materials_mapped])->all()];
    }

    /** @return list<string> */
    private function tokens(string $text): array
    {
        $t = preg_replace('/(\d)([a-z])/', '$1 $2', mb_strtolower(str_replace(',', '.', $text))) ?? '';      // 100kVA -> 100 kva, so the number matches "100 kVA" written with a space
        $t = preg_replace('/[^a-z0-9.]+/', ' ', $t) ?? '';

        return array_values(array_unique(array_filter(explode(' ', $t), fn ($w) => $w !== '' && strlen($w) > 1 && ! in_array($w, ['dan', 'atau', 'the', 'of', 'untuk', 'pada', 'dengan', 'type', 'tipe', 'mm2', 'mm', 'kv'], true))));
    }

    private function unit(string $u): string
    {
        $k = preg_replace('/[^a-z]/', '', mb_strtolower($u)) ?? '';

        return ['bh' => 'bh', 'buah' => 'bh', 'pcs' => 'bh', 'b' => 'bh', 'm' => 'm', 'mtr' => 'm', 'meter' => 'm', 'set' => 'set', 's' => 'set', 'btg' => 'btg', 'bt' => 'btg', 'batang' => 'btg', 'u' => 'u', 'unit' => 'u', 'kg' => 'kg'][$k] ?? $k;
    }

    /** Declares a KHS item as deliberately not mapped (it leaves the worklist). A mapped item must have its mappings removed first. */
    public function exempt(string $khsCode, string $reason, User $actor): string
    {
        $khs = DB::table('khs_items')->where('code', $khsCode)->value('id') ?? throw new AssignmentRuleViolation("Kode KHS {$khsCode} tidak ada.");
        if (trim($reason) === '') {
            throw new AssignmentRuleViolation('Pengecualian wajib disertai alasan.');
        }
        if (DB::table('khs_material_map')->where('khs_item_id', $khs)->exists()) {
            throw new AssignmentRuleViolation("KHS {$khsCode} sudah memiliki pemetaan SKU; hapus pemetaannya dulu sebelum mengecualikan.");
        }
        if (DB::table('khs_sku_exemptions')->where('khs_item_id', $khs)->whereNull('lifted_at')->exists()) {
            throw new AssignmentRuleViolation("KHS {$khsCode} sudah dikecualikan.");
        }
        $id = (string) Str::uuid();
        try {
            DB::transaction(fn () => DB::table('khs_sku_exemptions')->insert(['id' => $id, 'khs_item_id' => $khs, 'reason' => trim($reason), 'created_by' => $actor->getKey(), 'created_at' => now()]));   // savepoint: a lost race stays local
        } catch (QueryException $e) {
            throw $e->getCode() === '23505' ? new AssignmentRuleViolation("KHS {$khsCode} sudah dikecualikan.", 0, $e) : $e;
        }

        return $id;
    }

    /** Lifts the exemption in force (kept in the history with who and why). */
    public function lift(string $khsCode, string $reason, User $actor): void
    {
        $khs = DB::table('khs_items')->where('code', $khsCode)->value('id') ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
        if (trim($reason) === '') {
            throw new AssignmentRuleViolation('Pencabutan pengecualian wajib disertai alasan.');
        }
        $n = DB::table('khs_sku_exemptions')->where('khs_item_id', $khs)->whereNull('lifted_at')->update(['lifted_at' => now(), 'lifted_by' => $actor->getKey(), 'lift_reason' => trim($reason)]);
        $n === 1 || throw new AssignmentRuleViolation("KHS {$khsCode} tidak sedang dikecualikan.");
    }

    public function delete(string $id): void
    {
        DB::table('khs_material_map')->where('id', $id)->exists() || throw new AdministrationDenied('Data tidak ditemukan.', 404);
        DB::table('khs_material_map')->where('id', $id)->delete();
    }
}
