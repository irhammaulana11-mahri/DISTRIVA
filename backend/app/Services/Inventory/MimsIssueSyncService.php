<?php

namespace App\Services\Inventory;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Mirrors the material issues (pengeluaran) of ONE warehouse from MIMS, read-only (docs/82 §19.15). Three calls, all with the `auth-token` header:
 * the document list (POST getDataPengeluaranHeader, payload plant/stor_loc/status_sap=S), then per NEW reservation the lines (getDataPengeluaranAll) and the customers (getDataReservasiMapping).
 * Already stored documents are skipped, so a repeat only fetches what is new; only documents inside the window (`days`) are kept. Customers are tied to a DISTRIVA application by the agenda number
 * (name and address are not stored). The reservation number equals the reference of a TUG 7 shipment, which is how the reports avoid counting one issue twice.
 */
class MimsIssueSyncService
{
    /** @return array{status:string,message:?string,documents_new:int,lines:int,matched:int} */
    public function syncWarehouse(object $wh, ?string $token, ?User $triggeredBy = null, ?int $days = null): array
    {
        $started = now();
        $finish = function (string $status, ?string $message, int $docs = 0, int $lines = 0, int $matched = 0) use ($wh, $started, $triggeredBy): array {
            DB::table('mims_issue_sync_runs')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'status' => $status, 'message' => $message === null ? null : mb_substr($message, 0, 1000), 'documents_new' => $docs, 'lines' => $lines, 'matched' => $matched,
                'triggered_by' => $triggeredBy?->getKey(), 'started_at' => $started, 'finished_at' => now()]);

            return ['status' => $status, 'message' => $message, 'documents_new' => $docs, 'lines' => $lines, 'matched' => $matched];
        };
        if ($wh->plant === null || $wh->stor_loc === null) {
            return $finish('SKIPPED', 'Gudang belum memiliki plant dan storage location ERP.');
        }
        $base = rtrim((string) config('distriva.mims.base_url'), '/');
        $http = fn () => Http::withHeaders(['auth-token' => (string) ($token ?? config('distriva.mims.auth_token')), 'Accept' => 'application/json'])->withOptions(['verify' => (bool) config('distriva.mims.verify_ssl')])->timeout((int) config('distriva.mims.mirror_timeout_seconds'));
        $now = CarbonImmutable::now((string) config('distriva.business_timezone'));
        $since = $now->subDays($days ?? (int) config('distriva.mims.issue_days'))->toDateString();
        // The date range goes into the payload (`tanggal` / `tanggal_akhir`, format d-m-Y as the MIMS screen sends it), so MIMS answers with the window only, not the whole history.
        $payload = fn (string $from, string $to) => ['id_pel' => '', 'jenis_pekerjaan' => '', 'no_pemakaian' => '', 'no_pemesanan' => '', 'plant' => (string) $wh->plant, 'status_sap' => 'S', 'stor_loc' => (string) $wh->stor_loc, 'tanggal' => $from, 'tanggal_akhir' => $to];
        try {
            $res = $http()->asJson()->post($base.config('distriva.mims.issue_header_path'), $payload(CarbonImmutable::parse($since)->format('d-m-Y'), $now->format('d-m-Y')));
            if (in_array($res->status(), [400, 422, 500], true)) {
                $res = $http()->asJson()->post($base.config('distriva.mims.issue_header_path'), $payload('', ''));   // MIMS did not accept the dates: ask without them (filtered here instead)
            }
        } catch (\Throwable $e) {
            return $finish('FAILED', MimsStockSyncService::connectionMessage($e));
        }
        if (! $res->successful()) {
            return $finish('FAILED', 'MIMS menjawab status HTTP '.$res->status().($res->status() === 401 || $res->status() === 403 ? ' (token ditolak atau kedaluwarsa).' : '.'));
        }
        $headers = $res->json('data');
        if (! is_array($headers)) {
            return $finish('FAILED', 'Jawaban MIMS tidak memuat daftar pengeluaran (data).');
        }
        $known = DB::table('mims_issue_documents')->where('warehouse_id', $wh->id)->pluck('material_document')->flip();
        $new = [];
        foreach ($headers as $h) {
            $h = (array) $h;
            $doc = trim((string) ($h['material_document'] ?? ''));
            $reservation = trim((string) ($h['no_pemesanan'] ?? ''));
            $date = $this->date($h['tgl_pengeluaran'] ?? $h['tgl_transaksi'] ?? null);
            if ($doc === '' || $reservation === '' || $date === null || $date < $since || isset($known[$doc])) {
                continue;
            }
            $new[$doc] = ['doc' => $doc, 'h' => $h, 'reservation' => $reservation, 'date' => $date];
        }
        $docs = 0;
        $lines = 0;
        $matched = 0;
        $skipped = [];
        foreach (collect($new)->groupBy('reservation') as $reservation => $group) {
            try {
                $detail = MimsStockSyncService::fetch($http, $base.strtr((string) config('distriva.mims.issue_detail_path'), ['{reservation}' => rawurlencode((string) $reservation)]));
                $map = MimsStockSyncService::fetch($http, $base.strtr((string) config('distriva.mims.issue_mapping_path'), ['{reservation}' => rawurlencode((string) $reservation)]));
            } catch (\Throwable $e) {
                return $finish('FAILED', MimsStockSyncService::connectionMessage($e), $docs, $lines, $matched);
            }
            foreach ([$detail, $map] as $r) {
                if (in_array($r->status(), [401, 403], true)) {
                    return $finish('FAILED', 'MIMS menjawab status HTTP '.$r->status().' (token ditolak atau kedaluwarsa).', $docs, $lines, $matched);
                }
                if (! $r->successful()) {
                    $skipped[] = 'reservasi '.$reservation.': HTTP '.$r->status();   // one bad reservation does not stop the others; it is fetched again next time

                    continue 2;
                }
            }
            $rows = (array) ($detail->json('detail.data') ?? []);
            $customers = (array) ($map->json('data') ?? []);
            [$l, $m] = DB::transaction(function () use ($wh, $reservation, $group, $rows, $customers): array {
                foreach ($group as $g) {
                    $h = $g['h'];
                    $doc = $g['doc'];
                    DB::table('mims_issue_documents')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'material_document' => $doc, 'reservation_no' => $reservation, 'sap_document' => $this->str($h['mat_doc_sap'] ?? null, 30), 'sap_reservation' => $this->str($h['reservasi_sap'] ?? null, 30),
                        'issued_on' => $g['date'], 'work_type_code' => $this->str($h['jenis_pekerjaan'] ?? null, 10), 'work_type_name' => $this->str($h['nama_jenis_pekerjaan'] ?? null, 100), 'id_pel' => $this->str($h['id_pel'] ?? null, 30), 'wbs' => $this->str($h['wbs'] ?? null, 60),
                        'text' => $this->str($h['text'] ?? null, 255), 'origin' => $this->str($h['asal_wo'] ?? null, 30), 'fetched_at' => now()]);
                }
                DB::table('mims_issue_lines')->where('warehouse_id', $wh->id)->where('reservation_no', $reservation)->delete();
                $count = 0;
                foreach ($rows as $row) {
                    $row = (array) $row;
                    $no = ltrim(trim((string) ($row['material_no'] ?? '')), '0');
                    $qty = is_numeric($row['jumlah'] ?? null) ? (float) $row['jumlah'] : 0.0;
                    if ($no === '' || $qty <= 0) {
                        continue;
                    }
                    DB::table('mims_issue_lines')->insert(['id' => (string) Str::uuid(), 'warehouse_id' => $wh->id, 'reservation_no' => $reservation, 'material_no' => $no, 'material_name' => $this->str($row['nama_material'] ?? null, 255), 'quantity' => $qty, 'unit' => $this->str($row['satuan'] ?? null, 30)]);
                    $count++;
                }
                $tied = 0;
                foreach ($customers as $c) {
                    $c = (array) $c;
                    $agenda = trim((string) ($c['no_agenda'] ?? ''));
                    if ($agenda === '') {
                        continue;
                    }
                    $app = DB::table('application_external_references')->where('reference_type', 'AGENDA')->where('reference_number', $agenda)->where('is_active', true)->value('application_id');
                    DB::table('mims_issue_customers')->updateOrInsert(['reservation_no' => $reservation, 'agenda_no' => $agenda], ['id' => (string) Str::uuid(), 'id_pel' => $this->str($c['id_pelanggan'] ?? null, 30),
                        'power_va' => is_numeric($c['daya'] ?? null) ? (int) $c['daya'] : null, 'paid_on' => $this->date($c['tgl_bayar'] ?? null), 'application_id' => $app]);
                    $tied += $app === null ? 0 : 1;
                }

                return [$count, $tied];
            });
            $docs += $group->count();
            $lines += $l;
            $matched += $m;
        }

        if ($skipped !== []) {
            $note = count($skipped).' reservasi dilewati ('.implode('; ', array_slice($skipped, 0, 3)).(count($skipped) > 3 ? '; …' : '').').';

            return $finish($docs > 0 ? 'OK' : 'FAILED', $note, $docs, $lines, $matched);
        }

        return $finish('OK', null, $docs, $lines, $matched);
    }

    private function date(mixed $v): ?string
    {
        $v = trim((string) $v);
        if ($v === '') {
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

    private function str(mixed $v, int $max): ?string
    {
        $v = trim((string) $v);

        return $v === '' ? null : mb_substr($v, 0, $max);
    }
}
