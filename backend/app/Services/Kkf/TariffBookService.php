<?php

namespace App\Services\Kkf;

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
 * Tariff books (docs/62 §26): average sale price (Rp/kWh), jam nyala (kWh/kVA/month) and UJL (Rp/VA) per tariff x power, optionally per ULP.
 * Import creates a DRAFT, all-or-nothing; approval needs a different user; approved rows are immutable (triggers). Callers authorize first.
 * CSV columns: tarif, daya_va (empty = tariff without power steps), harga_rata2 (Rp/kWh), jam_nyala, ujl (optional), ulp (optional ULP unit code; empty = all ULPs).
 */
class TariffBookService
{
    /** @return array<string,list<string>> */
    private function headers(): array
    {
        return ['tariff' => ['tarif', 'tariff', 'golongan'], 'power' => ['daya_va', 'daya', 'power_va'], 'price' => ['harga_rata2', 'harga_rata_rata', 'ttl', 'avg_price'],
            'jam' => ['jam_nyala', 'jn'], 'ujl' => ['ujl'], 'ulp' => ['ulp', 'ulp_code', 'kode_ulp']];
    }

    public static function normalizeTariff(string $code): string
    {
        return (string) preg_replace('/[^A-Z0-9]/', '', mb_strtoupper($code));
    }

    /** @return array{summary: array<string,mixed>, rows: list<array<string,mixed>>} */
    public function import(UploadedFile $file, string $name, string $validFrom, ?string $source, bool $dryRun, User $actor): array
    {
        ['rows' => $rows] = CsvTable::read($file, $this->headers(), ['tariff', 'price', 'jam']);
        $max = (int) config('distriva_permissions.master_data_import.max_rows');
        if ($rows === [] || count($rows) > $max) {
            throw new AssignmentRuleViolation($rows === [] ? 'Berkas tidak memuat baris data.' : "Berkas melebihi batas {$max} baris.");
        }
        $codes = array_values(array_unique(array_filter(array_map(fn ($r) => (string) ($r['ulp'] ?? ''), $rows))));
        $units = $codes === [] ? [] : DB::table('organizational_units')->where('unit_type', 'ULP')->whereIn('code', $codes)->pluck('id', 'code')->all();

        $out = [];
        $accepted = [];
        $seen = [];
        foreach ($rows as $r) {
            $errs = [];
            $tariff = self::normalizeTariff($r['tariff']);
            $power = $this->number((string) ($r['power'] ?? ''));
            $price = $this->number($r['price']);
            $jam = $this->number($r['jam']);
            $ujl = isset($r['ujl']) && trim((string) $r['ujl']) !== '' ? $this->number((string) $r['ujl']) : null;
            $ulpCode = (string) ($r['ulp'] ?? '');
            if ($tariff === '') {
                $errs[] = 'tarif kosong.';
            }
            if (($r['power'] ?? '') !== '' && ($power === null || $power <= 0 || floor($power) != $power)) {
                $errs[] = 'daya_va harus bilangan bulat > 0 atau kosong.';
            }
            if ($price === null || $price <= 0) {
                $errs[] = 'harga_rata2 harus angka > 0.';
            }
            if ($jam === null || $jam <= 0) {
                $errs[] = 'jam_nyala harus angka > 0.';
            }
            if (isset($r['ujl']) && trim((string) $r['ujl']) !== '' && ($ujl === null || $ujl < 0)) {
                $errs[] = 'ujl harus angka >= 0.';
            }
            if ($ulpCode !== '' && ! isset($units[$ulpCode])) {
                $errs[] = "kode ULP {$ulpCode} tidak dikenal.";
            }
            $key = $tariff.'|'.($power === null ? '' : (int) $power).'|'.$ulpCode;
            if (isset($seen[$key])) {
                $errs[] = 'kombinasi tarif/daya/ULP muncul lebih dari sekali.';
            }
            $seen[$key] = true;
            $out[] = ['row' => $r['row'], 'tariff' => $tariff, 'power_va' => $power === null ? null : (int) $power, 'ulp' => $ulpCode ?: null, 'status' => $errs === [] ? 'OK' : 'REJECTED', 'errors' => $errs];
            if ($errs === []) {
                $accepted[] = ['ulp_unit_id' => $ulpCode !== '' ? $units[$ulpCode] : null, 'tariff_code' => $tariff, 'power_va' => $power === null ? null : (int) $power, 'avg_price' => $price, 'jam_nyala' => $jam, 'ujl' => $ujl];
            }
        }
        $rejected = count($rows) - count($accepted);
        $summary = ['dry_run' => $dryRun, 'total' => count($rows), 'accepted' => count($accepted), 'rejected' => $rejected, 'tariff_book_id' => null];
        if ($rejected > 0) {
            throw new AssignmentRuleViolation("Impor dibatalkan seluruhnya: {$rejected} baris ditolak. Perbaiki berkas (lihat baris yang ditolak) lalu ulangi.");
        }
        if ($dryRun) {
            return ['summary' => $summary, 'rows' => $out];
        }
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $name, $validFrom, $source, $accepted, $actor): void {
            DB::table('tariff_books')->insert(['id' => $id, 'name' => trim($name), 'valid_from' => $validFrom, 'status' => 'DRAFT', 'source_reference' => $source, 'created_by' => $actor->getKey(), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($accepted, 200) as $chunk) {
                DB::table('tariff_book_rows')->insert(array_map(fn ($a) => ['id' => (string) Str::uuid(), 'tariff_book_id' => $id, 'created_at' => now(), 'updated_at' => now()] + $a, $chunk));
            }
            $this->event($id, 'CREATED', $actor, null, ['rows' => count($accepted)]);
        });
        $summary['tariff_book_id'] = $id;

        return ['summary' => $summary, 'rows' => $out];
    }

    /** @param list<string> $ids @return array{approved:int,auto_closed:int} */
    public function approve(array $ids, User $actor, string $reason): array
    {
        try {
            return DB::transaction(function () use ($ids, $actor, $reason): array {
                $books = DB::table('tariff_books')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
                if ($books->count() !== count(array_unique($ids))) {
                    throw new AssignmentRuleViolation('Sebagian buku tarif tidak ditemukan.');
                }
                foreach ($books as $b) {
                    if ($b->status !== 'DRAFT') {
                        throw new AssignmentRuleViolation('Hanya buku tarif berstatus DRAFT yang dapat disetujui.');
                    }
                    if ($b->created_by === $actor->getKey() && ! $actor->isSysAdmin()) {
                        throw new AdministrationDenied('Pembuat buku tarif tidak dapat menyetujuinya sendiri.', 403);
                    }
                }
                $closed = 0;
                foreach ($books as $b) {
                    $from = CarbonImmutable::parse($b->valid_from);
                    $current = DB::table('tariff_books')->where('status', 'APPROVED')->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $from->toDateString()))->lockForUpdate()->get();
                    foreach ($current as $old) {
                        if (CarbonImmutable::parse($old->valid_from)->greaterThanOrEqualTo($from)) {
                            throw new AssignmentRuleViolation("Buku tarif baru harus berlaku setelah \"{$old->name}\" yang aktif (berlaku sejak {$old->valid_from}).");
                        }
                        DB::table('tariff_books')->where('id', $old->id)->update(['valid_until' => $from->subDay()->toDateString(), 'updated_at' => now()]);
                        $this->event($old->id, 'AUTO_CLOSED', $actor, 'Digantikan buku tarif yang lebih baru.', ['closed_by' => $b->id]);
                        $closed++;
                    }
                    DB::table('tariff_books')->where('id', $b->id)->update(['status' => 'APPROVED', 'approved_by' => $actor->getKey(), 'approved_at' => now(), 'updated_at' => now()]);
                    $this->event($b->id, 'APPROVED', $actor, $reason, null);
                }

                return ['approved' => $books->count(), 'auto_closed' => $closed];
            });
        } catch (QueryException $e) {
            throw match ($e->getCode()) {
                '23P01' => new AssignmentRuleViolation('Rentang berlaku bertabrakan dengan buku tarif aktif lain.', 0, $e),
                '23514' => new AssignmentRuleViolation('Perubahan melanggar aturan integritas buku tarif.', 0, $e),
                default => $e,
            };
        }
    }

    /** Throws a wrong DRAFT away without deleting it (status DISCARDED, immutable, history kept; the events table is append-only). */
    public function discard(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $b = DB::table('tariff_books')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($b->status !== 'DRAFT') {
                throw new AssignmentRuleViolation('Hanya buku tarif berstatus DRAFT yang dapat dibatalkan.');
            }
            DB::table('tariff_books')->where('id', $id)->update(['status' => 'DISCARDED', 'updated_at' => now()]);
            $this->event($id, 'DISCARDED', $actor, $reason, ['name' => $b->name]);
        });
    }

    public function retire(string $id, string $reason, User $actor): void
    {
        DB::transaction(function () use ($id, $reason, $actor): void {
            $b = DB::table('tariff_books')->where('id', $id)->lockForUpdate()->first() ?? throw new AdministrationDenied('Data tidak ditemukan.', 404);
            if ($b->status !== 'APPROVED') {
                throw new AssignmentRuleViolation('Hanya buku tarif yang disetujui yang dapat dinonaktifkan.');
            }
            DB::table('tariff_books')->where('id', $id)->update(['status' => 'INACTIVE', 'valid_until' => $b->valid_until ?? max(CarbonImmutable::today()->toDateString(), $b->valid_from), 'updated_at' => now()]);
            $this->event($id, 'RETIRED', $actor, $reason, null);
        });
    }

    /** The row for (ULP, tariff, power) in the book in force on the date: the ULP's own row, else the all-ULP row. Never guesses a neighbouring power. */
    public function resolve(string $ulpUnitId, string $tariffCode, ?int $powerVa, string $date): object
    {
        $book = DB::table('tariff_books')->where('status', 'APPROVED')->where('valid_from', '<=', $date)->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', $date))->first()
            ?? throw new AssignmentRuleViolation("Belum ada buku tarif yang disetujui dan berlaku pada {$date}.");
        $tariff = self::normalizeTariff($tariffCode);
        $find = function (string $code) use ($book, $ulpUnitId, $powerVa): ?object {
            $q = DB::table('tariff_book_rows')->where('tariff_book_id', $book->id)->where('tariff_code', $code)->where(fn ($w) => $w->where('ulp_unit_id', $ulpUnitId)->orWhereNull('ulp_unit_id'));
            $powerVa === null ? $q->whereNull('power_va') : $q->where('power_va', $powerVa);

            return $q->orderByRaw('ulp_unit_id IS NULL')->first();
        };
        // EIS writes the prepaid (token) variant with a trailing T (B2T, P1T, R3T, LT); the tariff book lists the base tariff, which carries the same price and jam nyala
        $row = $find($tariff) ?? (strlen($tariff) >= 2 && str_ends_with($tariff, 'T') ? $find(substr($tariff, 0, -1)) : null)
            ?? throw new AssignmentRuleViolation("Buku tarif \"{$book->name}\" tidak memuat tarif {$tariff}".($powerVa === null ? '' : " daya {$powerVa} VA").' untuk ULP ini. Jam nyala dan UJL ULP ini belum ada di buku tarif: unggah laporan penjualan ULP ini di Master Data > Impor dari Excel.');
        $row->book_name = $book->name;

        return $row;
    }

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
    private function event(string $id, string $type, User $actor, ?string $reason, ?array $details): void
    {
        DB::table('tariff_book_events')->insert(['id' => (string) Str::uuid(), 'tariff_book_id' => $id, 'event_type' => $type, 'actor_user_id' => $actor->getKey(),
            'reason' => $reason === null ? null : trim($reason), 'details' => $details === null ? null : json_encode($details), 'occurred_at' => now()]);
    }
}
