<?php

namespace App\Services\Inventory;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Read-only mirror of the MIMS material reservations (POST getDataReservasiHeader, same payload shape as the issue header) — what is reserved,
 * whether or not it was issued. New reservations get their customers (GET getDataReservasiMapping/{reservation}); the agenda number ties a reservation
 * to a DISTRIVA application. A reservation already known is only updated (its status moves on), never fetched again.
 *
 * The answer's field names were not seen on a real MIMS reply when this was written: they are read from the likely keys, and a list whose rows carry
 * none of them fails with the key NAMES it did get (never values), so the mapping can be corrected.
 */
class MimsReservationSyncService
{
    private const RESERVATION_KEYS = ['no_pemesanan', 'nomor_reservasi', 'no_reservasi', 'reservasi'];

    private const DATE_KEYS = ['tgl_pemesanan', 'tgl_reservasi', 'tanggal_reservasi', 'tgl_dokumen', 'tgl_transaksi', 'tanggal'];

    private const STATUS_KEYS = ['status_pemakaian', 'status_reservasi', 'status', 'status_sap'];

    /** @return array{status:string,message:?string,documents_new:int,matched:int} */
    public function syncWarehouse(object $wh, ?string $token, ?User $triggeredBy = null, ?int $days = null, ?string $from = null, ?string $to = null): array
    {
        $started = now();
        $finish = function (string $status, ?string $message, int $docs = 0, int $matched = 0) use ($wh, $started, $triggeredBy): array {
            DB::table('mims_reservation_sync_runs')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'status' => $status, 'message' => $message === null ? null : mb_substr($message, 0, 1000), 'documents_new' => $docs, 'matched' => $matched,
                'triggered_by' => $triggeredBy?->getKey(), 'started_at' => $started, 'finished_at' => now()]);

            return ['status' => $status, 'message' => $message, 'documents_new' => $docs, 'matched' => $matched];
        };
        if ($wh->plant === null || $wh->stor_loc === null) {
            return $finish('SKIPPED', 'Gudang belum memiliki plant dan storage location ERP.');
        }
        $base = rtrim((string) config('distriva.mims.base_url'), '/');
        $make = fn (int $seconds) => Http::withHeaders(['auth-token' => (string) ($token ?? config('distriva.mims.auth_token')), 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])->timeout($seconds);
        $http = fn () => $make((int) config('distriva.mims.mirror_timeout_seconds'));
        $one = fn () => $make((int) config('distriva.mims.detail_timeout_seconds'));
        $now = CarbonImmutable::now((string) config('distriva.business_timezone'));
        $since = $from ?? $now->subDays($days ?? (int) config('distriva.mims.issue_days'))->toDateString();
        $until = $to ?? $now->toDateString();
        $payload = fn (string $a, string $b) => ['id_pel' => '', 'jenis_pekerjaan' => '', 'no_pemakaian' => '', 'no_pemesanan' => '', 'plant' => (string) $wh->plant, 'status_sap' => '', 'stor_loc' => (string) $wh->stor_loc, 'tanggal' => $a, 'tanggal_akhir' => $b];
        // MIMS answers a short range in seconds but times out on a wide one, so the list is requested in windows (default 7 days).
        $window = max(1, (int) config('distriva.mims.reservation_window_days'));
        $rows = [];
        $failedWindows = [];
        $okWindows = 0;
        $cursor = CarbonImmutable::parse($since);
        $end = CarbonImmutable::parse($until);
        while ($cursor->lte($end)) {
            $to2 = $cursor->addDays($window - 1)->min($end);
            $label = $cursor->format('d-m-Y').' s/d '.$to2->format('d-m-Y');
            try {
                $res = $http()->asJson()->post($base.config('distriva.mims.reservation_header_path'), $payload($cursor->format('d-m-Y'), $to2->format('d-m-Y')));
            } catch (\Throwable $e) {
                $failedWindows[] = $label.': '.MimsStockSyncService::connectionMessage($e, 'mengambil daftar reservasi');
                $cursor = $to2->addDay();

                continue;
            }
            if (in_array($res->status(), [401, 403], true)) {
                return $finish('FAILED', 'MIMS menjawab status HTTP '.$res->status().' (token ditolak atau kedaluwarsa).');
            }
            if (! $res->successful()) {
                $failedWindows[] = $label.': HTTP '.$res->status();
                $cursor = $to2->addDay();

                continue;
            }
            $part = $res->json('data');
            if (! is_array($part)) {
                return $finish('FAILED', 'Jawaban MIMS tidak memuat daftar reservasi (data).');
            }
            array_push($rows, ...array_values($part));
            $okWindows++;
            $cursor = $to2->addDay();
        }
        if ($okWindows === 0) {
            return $finish('FAILED', 'Daftar reservasi MIMS gagal diambil di semua rentang ('.implode(' | ', array_slice($failedWindows, 0, 2)).').');
        }
        $parsed = [];
        foreach ($rows as $r) {
            $r = (array) $r;
            $no = $this->first($r, self::RESERVATION_KEYS);
            if ($no === null) {
                continue;
            }
            $date = $this->date($this->first($r, self::DATE_KEYS));
            if ($date !== null && ($date < $since || $date > $until)) {
                continue;
            }
            $parsed[$no] = ['no' => $no, 'date' => $date, 'status' => $this->first($r, self::STATUS_KEYS), 'sap' => $this->first($r, ['reservasi_sap', 'no_reservasi_sap']),
                'work' => $this->first($r, ['nama_jenis_pekerjaan', 'jenis_pekerjaan_nama']), 'text' => $this->first($r, ['text', 'keterangan'])];
        }
        if ($rows !== [] && $parsed === [] && ! $this->anyKey((array) $rows[array_key_first($rows)], self::RESERVATION_KEYS)) {
            return $finish('FAILED', 'Daftar reservasi MIMS tidak memuat nomor reservasi di kolom yang dikenal. Kolom yang diterima: '.implode(', ', array_slice(array_keys((array) $rows[array_key_first($rows)]), 0, 30)).'.');
        }
        $known = DB::table('mims_reservations')->where('warehouse_id', $wh->id)->pluck('id', 'reservation_no');
        $docs = 0;
        $matched = 0;
        $skipped = [];
        $slow = 0;
        foreach ($parsed as $no => $p) {
            $row = ['status' => $p['status'] === null ? null : mb_substr($p['status'], 0, 60), 'reserved_on' => $p['date'], 'sap_reservation' => $p['sap'] === null ? null : mb_substr($p['sap'], 0, 30),
                'work_type_name' => $p['work'] === null ? null : mb_substr($p['work'], 0, 100), 'text' => $p['text'] === null ? null : mb_substr($p['text'], 0, 255), 'fetched_at' => now()];
            if (isset($known[$no])) {
                DB::table('mims_reservations')->where('id', $known[$no])->update($row);

                continue;
            }
            try {
                $map = MimsStockSyncService::fetch($one, $base.strtr((string) config('distriva.mims.issue_mapping_path'), ['{reservation}' => rawurlencode((string) $no)]));
                $slow = 0;
            } catch (\Throwable $e) {
                $skipped[] = 'reservasi '.$no.': '.MimsStockSyncService::connectionMessage($e, 'mengambil pelanggan reservasi');
                if (++$slow >= 2) {
                    return $finish($docs > 0 ? 'OK' : 'FAILED', 'MIMS tidak menjawab pelanggan reservasi dua kali berturut-turut ('.implode(' | ', array_slice($skipped, -2)).'). Sisanya ditarik pada penarikan berikutnya.', $docs, $matched);
                }

                continue;
            }
            if (in_array($map->status(), [401, 403], true)) {
                return $finish('FAILED', 'MIMS menjawab status HTTP '.$map->status().' (token ditolak atau kedaluwarsa).', $docs, $matched);
            }
            if (! $map->successful()) {
                $skipped[] = 'reservasi '.$no.': HTTP '.$map->status();

                continue;
            }
            $customers = (array) ($map->json('data') ?? []);
            $matched += DB::transaction(function () use ($wh, $no, $row, $customers): int {
                DB::table('mims_reservations')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'reservation_no' => $no] + $row);
                $tied = 0;
                foreach ($customers as $c) {
                    $agenda = trim((string) (((array) $c)['no_agenda'] ?? ''));
                    if ($agenda === '') {
                        continue;
                    }
                    $app = DB::table('application_external_references')->where('reference_type', 'AGENDA')->where('reference_number', $agenda)->where('is_active', true)->value('application_id');
                    DB::table('mims_reservation_customers')->updateOrInsert(['reservation_no' => $no, 'agenda_no' => $agenda], ['id' => (string) Str::uuid(), 'application_id' => $app]);
                    $tied += $app === null ? 0 : 1;
                }

                return $tied;
            });
            $docs++;
        }
        foreach ($failedWindows as $w) {
            $skipped[] = 'rentang '.$w;
        }
        if ($skipped !== []) {
            return $finish($docs > 0 ? 'OK' : 'FAILED', count($skipped).' reservasi dilewati ('.implode('; ', array_slice($skipped, 0, 3)).(count($skipped) > 3 ? '; …' : '').').', $docs, $matched);
        }

        return $finish('OK', null, $docs, $matched);
    }

    /**
     * Verifies the answer of getDataReservasiHeader on ONE warehouse without saving anything: the HTTP status, the number of rows, the KEY NAMES of the first row (never values) and which of
     * the expected fields they cover, so the key mapping above can be confirmed or corrected.
     *
     * @return array{status:string,http:?int,rows:int,keys:list<string>,covered:array<string,?string>,message:?string}
     */
    public function probe(object $wh, string $token, int $days = 30): array
    {
        $base = rtrim((string) config('distriva.mims.base_url'), '/');
        $now = CarbonImmutable::now((string) config('distriva.business_timezone'));
        $payload = ['id_pel' => '', 'jenis_pekerjaan' => '', 'no_pemakaian' => '', 'no_pemesanan' => '', 'plant' => (string) $wh->plant, 'status_sap' => '', 'stor_loc' => (string) $wh->stor_loc,
            'tanggal' => $now->subDays($days)->format('d-m-Y'), 'tanggal_akhir' => $now->format('d-m-Y')];
        try {
            $res = Http::withHeaders(['auth-token' => $token, 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])
                ->timeout((int) config('distriva.mims.mirror_timeout_seconds'))->asJson()->post($base.config('distriva.mims.reservation_header_path'), $payload);
        } catch (\Throwable $e) {
            return ['status' => 'FAILED', 'http' => null, 'rows' => 0, 'keys' => [], 'covered' => [], 'message' => MimsStockSyncService::connectionMessage($e, 'mengambil daftar reservasi')];
        }
        if (! $res->successful()) {
            return ['status' => 'FAILED', 'http' => $res->status(), 'rows' => 0, 'keys' => [], 'covered' => [], 'message' => 'MIMS menjawab status HTTP '.$res->status().'.'];
        }
        $rows = $res->json('data');
        if (! is_array($rows)) {
            return ['status' => 'FAILED', 'http' => $res->status(), 'rows' => 0, 'keys' => [], 'covered' => [], 'message' => 'Jawaban tidak memuat daftar reservasi (data).'];
        }
        $keys = $rows === [] ? [] : array_map('strval', array_keys((array) $rows[array_key_first($rows)]));
        $cover = fn (array $wanted): ?string => collect($wanted)->first(fn (string $k) => in_array($k, $keys, true));
        $covered = ['nomor reservasi' => $cover(self::RESERVATION_KEYS), 'tanggal' => $cover(self::DATE_KEYS), 'status' => $cover(self::STATUS_KEYS), 'reservasi SAP' => $cover(['reservasi_sap', 'no_reservasi_sap']),
            'jenis pekerjaan' => $cover(['nama_jenis_pekerjaan', 'jenis_pekerjaan_nama']), 'keterangan' => $cover(['text', 'keterangan'])];

        return ['status' => $rows === [] ? 'EMPTY' : ($covered['nomor reservasi'] === null ? 'UNKNOWN_KEYS' : 'OK'), 'http' => $res->status(), 'rows' => count($rows), 'keys' => $keys, 'covered' => $covered, 'message' => null];
    }

    /** @param  array<string,mixed>  $row  @param  list<string>  $keys */
    private function first(array $row, array $keys): ?string
    {
        foreach ($keys as $k) {
            $v = trim((string) ($row[$k] ?? ''));
            if ($v !== '') {
                return $v;
            }
        }

        return null;
    }

    /** @param  array<string,mixed>  $row  @param  list<string>  $keys */
    private function anyKey(array $row, array $keys): bool
    {
        return array_intersect($keys, array_keys($row)) !== [];
    }

    private function date(?string $v): ?string
    {
        if ($v === null) {
            return null;
        }
        foreach (['d-m-Y', 'Y-m-d'] as $f) {
            $d = \DateTimeImmutable::createFromFormat('!'.$f, $v);
            if ($d !== false && $d->format($f) === $v) {
                return $d->format('Y-m-d');
            }
        }

        return null;
    }
}
