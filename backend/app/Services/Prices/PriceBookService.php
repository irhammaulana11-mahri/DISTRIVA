<?php

namespace App\Services\Prices;

use App\Exceptions\AdministrationDenied;
use App\Exceptions\AssignmentRuleViolation;
use App\Models\User;
use App\Support\CsvTable;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Price books (docs/62 §19): one contract's material status/prices and per-zone service prices. Import only creates a DRAFT (several drafts may coexist; a draft that is not wanted is simply never approved; all-or-nothing:
 * any bad row cancels the import); approval needs a different user (also a CHECK) and every KHS item approved on the start date; approved
 * content is immutable (triggers). The zone of each UP3 is data of the book (a new contract may change it). Callers authorize the actor first.
 */
class PriceBookService
{
    public const ZONES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    /** @return array<string,list<string>> */
    private function headers(): array
    {
        $h = ['code' => ['code', 'kode', 'kode_khs'], 'name' => ['name', 'nama', 'uraian'], 'status' => ['material_status', 'status_material', 'status'], 'price' => ['material_price', 'harga_material'], 'insured' => ['insured_value', 'nilai_asuransi']];
        foreach (self::ZONES as $z) {
            $h["z{$z}_install"] = ["z{$z}_pasang", "zona{$z}_pasang", "zona_{$z}_pasang", "z{$z}_install"];
            $h["z{$z}_remove"] = ["z{$z}_bongkar", "zona{$z}_bongkar", "zona_{$z}_bongkar", "z{$z}_remove"];
        }

        return $h;
    }

    /**
     * @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>}
     */
    public function import(UploadedFile $file, string $name, ?string $contract, string $validFrom, ?string $source, bool $dryRun, User $actor): array
    {
        ['rows' => $rows, 'columns' => $columns] = CsvTable::read($file, $this->headers(), ['code', 'status']);
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === [] || count($rows) > $max) {
            throw new AssignmentRuleViolation($rows === [] ? 'Berkas tidak memuat baris data.' : "Berkas melebihi batas {$max} baris.");
        }
        $zones = array_values(array_filter(self::ZONES, fn ($z) => in_array("z{$z}_install", $columns, true) && in_array("z{$z}_remove", $columns, true)));
        if ($zones === []) {
            throw new AssignmentRuleViolation('Berkas tidak memuat satu pun pasangan kolom harga jasa zona (z1_pasang/z1_bongkar, dst.).');
        }

        $counts = array_count_values(array_column($rows, 'code'));
        $items = DB::table('khs_items')->whereIn('code', array_keys($counts))->pluck('id', 'code')->all();
        $out = [];
        $accepted = [];
        foreach ($rows as $r) {
            $errs = [];
            $code = $r['code'];
            if ($code === '' || ($counts[$code] ?? 0) > 1) {
                $errs[] = $code === '' ? 'kode KHS kosong.' : "kode {$code} muncul lebih dari sekali.";
            } elseif (! isset($items[$code])) {
                $errs[] = "kode KHS {$code} tidak ada di katalog.";
            }
            $status = strtoupper($r['status']);
            $status = in_array($status, ['PLN'], true) ? 'PLN' : (in_array($status, ['PRICED', 'HARGA', 'VENDOR', 'TUNAI'], true) ? 'PRICED' : null);
            $price = null;
            if ($status === null) {
                $errs[] = 'status_material harus PLN atau HARGA.';
            } elseif ($status === 'PLN') {
                if (($r['price'] ?? '') !== '') {
                    $errs[] = 'material berstatus PLN tidak boleh memiliki harga_material.';
                }
            } else {
                $price = $this->number($r['price'] ?? '');
                if ($price === null) {
                    $errs[] = 'harga_material wajib berupa angka >= 0 untuk status HARGA.';
                }
            }
            $insured = null;
            if (($r['insured'] ?? '') !== '') {
                $insured = $this->number($r['insured']);
                if ($insured === null) {
                    $errs[] = 'nilai_asuransi harus berupa angka >= 0.';
                }
            }
            $service = [];
            foreach ($zones as $z) {
                $i = $r["z{$z}_install"] ?? '';
                $b = $r["z{$z}_remove"] ?? '';
                if ($i === '' && $b === '') {
                    continue;
                }
                $iv = $this->number($i);
                $bv = $this->number($b);
                if ($iv === null || $bv === null) {
                    $errs[] = "zona {$z}: harga pasang dan bongkar harus keduanya angka >= 0.";

                    continue;
                }
                $service[$z] = [$iv, $bv];
            }
            if ($service === [] && $errs === []) {
                $errs[] = 'baris tanpa harga jasa pada zona mana pun.';
            }
            $out[] = ['row' => $r['row'], 'code' => $code, 'name' => $r['name'] ?? '', 'status' => $status, 'zones' => array_keys($service), 'messages' => $errs];
            if ($errs === []) {
                $accepted[] = ['khs_item_id' => $items[$code], 'status' => $status, 'price' => $price, 'insured' => $insured, 'service' => $service];
            }
        }
        $rejected = count($out) - count($accepted);
        $summary = ['total_rows' => count($out), 'accepted_rows' => count($accepted), 'rejected_rows' => $rejected, 'zones' => $zones,
            'priced' => count(array_filter($accepted, fn ($a) => $a['status'] === 'PRICED')), 'pln' => count(array_filter($accepted, fn ($a) => $a['status'] === 'PLN')), 'dry_run' => $dryRun, 'created' => false];
        if ($dryRun) {
            return ['summary' => $summary, 'rows' => $out];
        }
        if ($rejected > 0) {
            throw new AssignmentRuleViolation("{$rejected} baris tidak dapat diimpor; seluruh impor dibatalkan. Perbaiki lalu ulangi (gunakan dry_run untuk daftar lengkap).");
        }

        $id = DB::transaction(function () use ($name, $contract, $validFrom, $source, $accepted, $actor, $file): string {
            $id = (string) Str::uuid();
            DB::table('price_books')->insert(['id' => $id, 'name' => $name, 'contract_reference' => $contract, 'valid_from' => $validFrom, 'status' => 'DRAFT',
                'source_reference' => $source ?? mb_substr($file->getClientOriginalName(), 0, 255), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($accepted, 200) as $chunk) {
                $itemRows = [];
                $svcRows = [];
                foreach ($chunk as $a) {
                    $iid = (string) Str::uuid();
                    $itemRows[] = ['id' => $iid, 'price_book_id' => $id, 'khs_item_id' => $a['khs_item_id'], 'material_status' => $a['status'], 'material_price' => $a['price'], 'insured_value' => $a['insured'], 'created_at' => now(), 'updated_at' => now()];
                    foreach ($a['service'] as $z => [$ins, $rem]) {
                        $svcRows[] = ['id' => (string) Str::uuid(), 'price_book_item_id' => $iid, 'zone' => $z, 'install_price' => $ins, 'remove_price' => $rem];
                    }
                }
                DB::table('price_book_items')->insert($itemRows);
                DB::table('price_book_service_prices')->insert($svcRows);
            }
            $this->event($id, 'CREATED', $actor, null, ['items' => count($accepted)]);

            return $id;
        });

        return ['summary' => array_merge($summary, ['id' => $id, 'created' => true]), 'rows' => $out];
    }

    /**
     * A DRAFT that starts as a COPY of the book in force (items, service prices per zone and the UP3 zones), so MDU values (or anything else the book allows) can be adjusted on the
     * draft without a new price file. The copy is only a draft: approval by another account is still required, and it closes the previous book like any other draft.
     *
     * @return array{id:string, items:int, copied_from:string}
     */
    public function createDraftFromActive(string $name, ?string $contract, string $validFrom, string $reason, User $actor): array
    {
        $from = DB::table('price_books')->where('status', 'APPROVED')->orderByDesc('valid_from')->first()
            ?? throw new AssignmentRuleViolation('Belum ada buku harga yang disetujui untuk disalin.');

        return DB::transaction(function () use ($from, $name, $contract, $validFrom, $reason, $actor): array {
            $id = (string) Str::uuid();
            DB::table('price_books')->insert(['id' => $id, 'name' => $name, 'contract_reference' => $contract ?? $from->contract_reference, 'valid_from' => $validFrom, 'status' => 'DRAFT',
                'source_reference' => mb_substr('Salinan dari '.$from->name, 0, 255), 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            $items = 0;
            foreach (DB::table('price_book_items')->where('price_book_id', $from->id)->orderBy('id')->get()->chunk(200) as $chunk) {
                $itemRows = [];
                $svcRows = [];
                $services = DB::table('price_book_service_prices')->whereIn('price_book_item_id', $chunk->pluck('id'))->get()->groupBy('price_book_item_id');
                foreach ($chunk as $it) {
                    $iid = (string) Str::uuid();
                    $itemRows[] = ['id' => $iid, 'price_book_id' => $id, 'khs_item_id' => $it->khs_item_id, 'material_status' => $it->material_status, 'material_price' => $it->material_price, 'insured_value' => $it->insured_value, 'created_at' => now(), 'updated_at' => now()];
                    foreach ($services->get($it->id, collect()) as $sv) {
                        $svcRows[] = ['id' => (string) Str::uuid(), 'price_book_item_id' => $iid, 'zone' => $sv->zone, 'install_price' => $sv->install_price, 'remove_price' => $sv->remove_price];
                    }
                }
                DB::table('price_book_items')->insert($itemRows);
                $svcRows === [] || DB::table('price_book_service_prices')->insert($svcRows);
                $items += count($itemRows);
            }
            $zones = DB::table('price_book_zones')->where('price_book_id', $from->id)->get()
                ->map(fn ($z) => ['id' => (string) Str::uuid(), 'price_book_id' => $id, 'up3_unit_id' => $z->up3_unit_id, 'zone' => $z->zone, 'created_at' => now(), 'updated_at' => now()])->all();
            $zones === [] || DB::table('price_book_zones')->insert($zones);
            $this->event($id, 'CREATED', $actor, $reason, ['items' => $items, 'copied_from' => $from->id, 'copied_from_name' => $from->name, 'zones' => count($zones)]);

            return ['id' => $id, 'items' => $items, 'copied_from' => $from->id];
        });
    }

    /** Sets the service zone of one UP3 in a DRAFT book (a zone the book has prices for). */
    public function setZone(string $bookId, string $up3UnitId, int $zone, string $reason, User $actor): void
    {
        DB::transaction(function () use ($bookId, $up3UnitId, $zone, $reason, $actor): void {
            $book = DB::table('price_books')->where('id', $bookId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($book, 'diubah');
            $unit = DB::table('organizational_units')->where('id', $up3UnitId)->first();
            if ($unit === null || $unit->unit_type !== 'UP3' || ! $unit->is_active) {
                throw new AssignmentRuleViolation('Zona hanya dapat ditetapkan untuk UP3 yang aktif.');
            }
            $has = DB::table('price_book_service_prices as s')->join('price_book_items as i', 'i.id', '=', 's.price_book_item_id')->where('i.price_book_id', $bookId)->where('s.zone', $zone)->exists();
            if (! $has) {
                throw new AssignmentRuleViolation("Buku harga ini tidak memiliki harga jasa untuk zona {$zone}.");
            }
            $before = DB::table('price_book_zones')->where(['price_book_id' => $bookId, 'up3_unit_id' => $up3UnitId])->value('zone');
            DB::table('price_book_zones')->upsert([['id' => (string) Str::uuid(), 'price_book_id' => $bookId, 'up3_unit_id' => $up3UnitId, 'zone' => $zone, 'created_at' => now(), 'updated_at' => now()]],
                ['price_book_id', 'up3_unit_id'], ['zone', 'updated_at']);
            $this->event($bookId, 'ZONE_SET', $actor, $reason, ['up3_unit_id' => $up3UnitId, 'up3' => $unit->code, 'before' => $before, 'after' => $zone]);
        });
    }

    /**
     * Sets (or clears, null) the MDU / insured value of ONE item of a DRAFT book. The reason is required and the before/after values are kept in the book's history;
     * an approved book never changes (database trigger), a new book is made through an import.
     */
    public function setInsuredValue(string $bookId, string $khsCode, ?float $value, string $reason, User $actor): void
    {
        DB::transaction(function () use ($bookId, $khsCode, $value, $reason, $actor): void {
            $book = DB::table('price_books')->where('id', $bookId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            $this->requireDraft($book, 'diubah');
            $item = DB::table('price_book_items as p')->join('khs_items as k', 'k.id', '=', 'p.khs_item_id')->where('p.price_book_id', $bookId)->where('k.code', $khsCode)
                ->first(['p.id', 'p.insured_value']) ?? throw new AdministrationDenied('Kode KHS tidak ada pada buku harga ini.', 404);
            $before = $item->insured_value === null ? null : (float) $item->insured_value;
            if ($before === $value) {
                throw new AssignmentRuleViolation('Nilai MDU tidak berubah.');
            }
            DB::table('price_book_items')->where('id', $item->id)->update(['insured_value' => $value, 'updated_at' => now()]);
            $this->event($bookId, 'MDU_SET', $actor, $reason, ['khs_code' => $khsCode, 'before' => $before, 'after' => $value]);
        });
    }

    /**
     * @param  list<string>  $ids
     * @return array{approved:int, auto_closed:int}
     */
    public function approve(array $ids, User $actor, string $reason): array
    {
        try {
            return DB::transaction(function () use ($ids, $actor, $reason): array {
                $books = DB::table('price_books')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($books->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian buku harga tidak ditemukan.');
                }
                foreach ($books as $b) {
                    $this->requireDraft($b, 'disetujui');
                    if ($b->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat buku harga tidak dapat menyetujuinya sendiri.', 403);
                    }
                    $this->requireReady($b);
                }
                $closed = 0;
                foreach ($books as $b) {
                    $from = CarbonImmutable::parse($b->valid_from);
                    $current = DB::table('price_books')->where('status', 'APPROVED')->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();
                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Buku harga baru harus berlaku setelah \"{$old->name}\" yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('price_books')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan buku harga yang lebih baru.', ['closed_by' => $b->id]);
                        $closed++;
                    }
                    DB::table('price_books')->where('id', $b->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($b->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $books->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan buku harga aktif lain.', 0, $e),
                '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas buku harga.', 0, $e),
                default => $e,
            };
        }
    }

    public function retire(string $bookId, string $reason, User $actor): void
    {
        DB::transaction(function () use ($bookId, $reason, $actor): void {
            $b = DB::table('price_books')->where('id', $bookId)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($b->status !== 'APPROVED') {
                throw new AssignmentRuleViolation("Buku harga berstatus {$b->status}; hanya APPROVED yang dapat dinonaktifkan.");
            }
            DB::table('price_books')->where('id', $bookId)->update(['status' => 'INACTIVE', 'valid_until' => DB::raw('COALESCE(valid_until, CURRENT_DATE)'), 'updated_at' => now()]);
            $this->event($bookId, 'RETIRED', $actor, $reason, null);
        });
    }

    /**
     * The book valid on a date and the service zone of an UP3 in it — what a RAB run needs. Throws (409) when there is none: never a guess.
     *
     * @return array{book: object, zone: int}
     */
    public function resolve(string $up3UnitId, string $date): array
    {
        $book = DB::table('price_books')->where('status', 'APPROVED')->where('valid_from', '<=', $date)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $date))->first()
            ?? throw new AssignmentRuleViolation("Belum ada buku harga yang disetujui dan berlaku pada {$date}.");
        $zone = DB::table('price_book_zones')->where(['price_book_id' => $book->id, 'up3_unit_id' => $up3UnitId])->value('zone')
            ?? throw new AssignmentRuleViolation("Zona jasa UP3 ini belum ditetapkan pada buku harga \"{$book->name}\".");

        return ['book' => $book, 'zone' => (int) $zone];
    }

    private function requireDraft(object $b, string $verb): void
    {
        if ($b->status !== 'DRAFT') {
            throw new AssignmentRuleViolation("Buku harga berstatus {$b->status}; hanya DRAFT yang dapat {$verb} (buat buku harga baru lewat impor).");
        }
    }

    private function requireReady(object $b): void
    {
        $items = DB::table('price_book_items')->where('price_book_id', $b->id)->pluck('khs_item_id');
        if ($items->isEmpty()) {
            throw new AssignmentRuleViolation('Buku harga belum memiliki item; tidak dapat disetujui.');
        }
        if (! DB::table('price_book_zones')->where('price_book_id', $b->id)->exists()) {
            throw new AssignmentRuleViolation('Belum ada UP3 yang ditetapkan zonanya; tidak dapat disetujui.');
        }
        $ready = DB::table('khs_item_versions')->whereIn('khs_item_id', $items)->where('status', 'APPROVED')->where('valid_from', '<=', $b->valid_from)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $b->valid_from))->pluck('khs_item_id')->all();
        $missing = $items->reject(fn ($id) => in_array($id, $ready, true));
        if ($missing->isNotEmpty()) {
            $codes = DB::table('khs_items')->whereIn('id', $missing)->orderBy('code')->limit(5)->pluck('code')->implode(', ');
            throw new AssignmentRuleViolation("{$missing->count()} kode KHS pada buku harga belum memiliki versi KHS yang disetujui dan berlaku pada {$b->valid_from} (contoh: {$codes}).");
        }
    }

    /** Plain "12345.67", Indonesian "1.234,56" or "1234,56"; null when not a number >= 0. */
    private function number(string $s): ?float
    {
        $s = trim($s);
        if ($s === '') {
            return null;
        }
        if (preg_match('/^\d{1,3}(\.\d{3})+(,\d+)?$/', $s) || preg_match('/^\d+,\d+$/', $s)) {
            $s = str_replace(',', '.', str_replace('.', '', $s));
        }

        return preg_match('/^\d+(\.\d+)?$/', $s) ? (float) $s : null;
    }

    /** @param array<string,mixed>|null $details */
    private function event(string $bookId, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('price_book_events')->insert(['id' => (string) Str::uuid(), 'price_book_id' => $bookId, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
